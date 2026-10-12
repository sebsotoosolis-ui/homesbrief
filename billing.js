import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Stripe from 'stripe';
import { clerkClient } from '@clerk/express';

const TRIAL_MS = 14 * 24 * 60 * 60 * 1000;

export const PLANS = {
  agente: {
    id: 'agente',
    name: 'HomesBrief Agente',
    amount: 4900,
    interval: 'month',
  },
  agencia: {
    id: 'agencia',
    name: 'HomesBrief Agencia',
    amount: 14900,
    interval: 'month',
  },
};

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key);
}

export function publicOrigin(req) {
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3456';
  const proto = req.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function createCheckoutSession({ req, planId, userId }) {
  const plan = PLANS[planId];
  if (!plan) throw new Error('Ese plan no existe.');
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe no está configurado.');

  const email = await clerkEmail(userId);
  const customer = await getOrCreateCustomer(stripe, userId, email);
  const origin = publicOrigin(req);

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customer.id,
    client_reference_id: userId,
    success_url: `${origin}/app?checkout=success`,
    cancel_url: `${origin}/#precios`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: plan.amount,
          recurring: { interval: plan.interval },
          product_data: { name: plan.name },
        },
      },
    ],
    subscription_data: {
      metadata: { clerkUserId: userId, plan: plan.id },
    },
    allow_promotion_codes: true,
  });
}

export async function createPortalSession(req, userId) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe no está configurado.');
  const customer = await findCustomer(stripe, userId);
  if (!customer) throw new Error('Aún no tienes una suscripción.');
  return stripe.billingPortal.sessions.create({
    customer: customer.id,
    return_url: `${publicOrigin(req)}/app`,
  });
}

export function planLimit(plan) {
  if (plan === 'agencia') return { max: Infinity, period: 'none' };
  if (plan === 'agente' || plan === 'paid') return { max: 40, period: 'month' };
  if (plan === 'trial') return { max: 3, period: 'total' };
  if (plan === 'open') return { max: Infinity, period: 'none' };
  return { max: 0, period: 'none' };
}

export function normalizePromo(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function validPromoCodes() {
  const raw = process.env.BETA_PROMO_CODE || 'HOMESBRIEF-BETA';
  return raw.split(',').map(normalizePromo).filter(Boolean);
}

export async function redeemPromo(userId, code) {
  const normalized = normalizePromo(code);
  if (!validPromoCodes().includes(normalized)) {
    throw new Error('Ese código no es válido.');
  }
  await savePlanGrant(userId, 'agencia', normalized);
  return { ok: true, plan: 'agencia' };
}

export async function getAccess(userId) {
  const grant = await readPlanGrant(userId);
  if (grant) return { ok: true, plan: grant, source: 'promo' };

  const stripe = getStripe();
  if (!stripe) return { ok: true, plan: 'open' };

  const subscription = await findActiveSubscription(stripe, userId);
  if (subscription) {
    return { ok: true, plan: subscription.metadata?.plan || 'agente' };
  }

  if (await isInTrial(userId)) {
    return { ok: true, plan: 'trial' };
  }

  return {
    ok: false,
    plan: 'none',
    error: 'Tu trial de 14 días terminó. Elige Agente o Agencia para seguir generando fichas.',
  };
}

async function readPlanGrant(userId) {
  try {
    const user = await clerkClient.users.getUser(userId);
    const plan = user.privateMetadata?.homesbriefPlan;
    if (plan === 'agencia' || plan === 'agente') return plan;
  } catch {
    /* local / sin Clerk */
  }
  try {
    const file = join(resolve(process.env.DATA_DIR || 'data'), String(userId).replace(/[^a-zA-Z0-9_-]/g, ''), 'access.json');
    if (!existsSync(file)) return null;
    const plan = JSON.parse(readFileSync(file, 'utf8')).plan;
    return plan === 'agencia' || plan === 'agente' ? plan : null;
  } catch {
    return null;
  }
}

async function savePlanGrant(userId, plan, promoCode) {
  try {
    await clerkClient.users.updateUserMetadata(userId, {
      privateMetadata: {
        homesbriefPlan: plan,
        promoCode,
        promoAt: new Date().toISOString(),
      },
    });
  } catch {
    /* Clerk no disponible: se guarda en disco */
  }
  const dir = join(resolve(process.env.DATA_DIR || 'data'), String(userId).replace(/[^a-zA-Z0-9_-]/g, '') || 'local');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ plan, promoCode, at: new Date().toISOString() }, null, 2), 'utf8');
}

async function isInTrial(userId) {
  try {
    const user = await clerkClient.users.getUser(userId);
    return Date.now() - new Date(user.createdAt).getTime() < TRIAL_MS;
  } catch {
    return false;
  }
}

async function clerkEmail(userId) {
  try {
    const user = await clerkClient.users.getUser(userId);
    return user.emailAddresses?.[0]?.emailAddress;
  } catch {
    return undefined;
  }
}

async function findCustomer(stripe, userId) {
  const result = await stripe.customers.search({
    query: `metadata['clerkUserId']:'${userId}'`,
    limit: 1,
  });
  return result.data[0] ?? null;
}

async function getOrCreateCustomer(stripe, userId, email) {
  const existing = await findCustomer(stripe, userId);
  if (existing) return existing;
  return stripe.customers.create({
    email,
    metadata: { clerkUserId: userId },
  });
}

async function findActiveSubscription(stripe, userId) {
  const customer = await findCustomer(stripe, userId);
  if (!customer) return null;
  const subs = await stripe.subscriptions.list({
    customer: customer.id,
    status: 'all',
    limit: 10,
  });
  return subs.data.find((item) => item.status === 'active' || item.status === 'trialing') ?? null;
}
