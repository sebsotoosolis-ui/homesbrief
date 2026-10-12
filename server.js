import { randomUUID } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { clerkMiddleware, getAuth } from '@clerk/express';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createCheckoutSession, createPortalSession, getAccess, getStripe } from './billing.js';
import { runListingJob } from './engine.js';

const jobs = new Map();

const PORT = Number(process.env.PORT) || 3456;
const HOST = process.env.HOST || '0.0.0.0';
const app = express();
const UPLOADS = resolve('uploads');
const DEMO_DIR = resolve('web', 'demo');
mkdirSync(UPLOADS, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => cb(null, req.uploadDir),
    filename: (_req, file, cb) => cb(null, file.originalname),
  }),
  limits: { files: 20, fileSize: 20 * 1024 * 1024 },
});

const clerkEnabled = Boolean(process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY);

app.disable('x-powered-by');
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripe || !secret) {
    res.status(400).end();
    return;
  }
  try {
    stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
    res.json({ received: true });
  } catch (error) {
    res.status(400).send(`Webhook error: ${error.message}`);
  }
});
app.use(express.urlencoded({ extended: true }));
if (clerkEnabled) {
  app.use(clerkMiddleware());
}
app.use('/demo', express.static(DEMO_DIR, { fallthrough: false, maxAge: '7d' }));
app.get('/clerk-client.js', (_req, res) => {
  res.sendFile(resolve('web', 'clerk-client.js'));
});

function requireUser(req, res, next) {
  if (!clerkEnabled) return next();
  const auth = getAuth(req);
  if (!auth.isAuthenticated) {
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: 'Inicia sesión para generar fichas.' });
      return;
    }
    res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return;
  }
  next();
}

app.get('/', (_req, res) => {
  res.sendFile(resolve('web', 'landing.html'));
});

app.get('/app', requireUser, (_req, res) => {
  res.sendFile(resolve('web', 'app.html'));
});

app.get('/registro', (_req, res) => {
  res.sendFile(resolve('web', 'registro.html'));
});

app.get('/login', (_req, res) => {
  res.sendFile(resolve('web', 'login.html'));
});

app.get('/ficha', (_req, res) => {
  const page = resolve('web', 'index.html');
  if (!existsSync(page)) {
    res.redirect('/');
    return;
  }
  res.sendFile(page);
});

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /\nSitemap: https://homesbrief.com/sitemap.xml\n');
});

app.get('/sitemap.xml', (_req, res) => {
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://homesbrief.com/</loc></url>
  <url><loc>https://homesbrief.com/registro</loc></url>
  <url><loc>https://homesbrief.com/login</loc></url>
</urlset>
`);
});

app.get('/api/clerk-config', (_req, res) => {
  res.json({ publishableKey: process.env.CLERK_PUBLISHABLE_KEY || '' });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'homesbrief' });
});

app.get('/checkout/:plan', requireUser, async (req, res) => {
  try {
    const session = await createCheckoutSession({
      req,
      planId: req.params.plan,
      userId: getAuth(req).userId,
    });
    res.redirect(303, session.url);
  } catch (error) {
    res.status(400).send(error.message || 'No se pudo abrir Stripe.');
  }
});

app.post('/api/billing/portal', requireUser, async (req, res) => {
  try {
    const session = await createPortalSession(req, getAuth(req).userId);
    res.json({ url: session.url });
  } catch (error) {
    res.status(400).json({ error: error.message || 'No se pudo abrir el portal.' });
  }
});

app.get('/api/billing/access', requireUser, async (req, res) => {
  try {
    res.json(await getAccess(getAuth(req).userId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/jobs/:id', requireUser, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Ese trabajo ya no está. Vuelve a generar.' });
    return;
  }
  res.json(job);
});

app.get('/media/:name', (req, res) => {
  const name = basename(req.params.name);
  const listing = readListing();
  const dir = resolvePhotoDir(listing);
  const filePath = join(dir, name);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.status(404).end();
    return;
  }
  res.sendFile(filePath);
});

app.post(
  '/api/generate',
  requireUser,
  (req, _res, next) => {
    req.uploadDir = join(UPLOADS, String(Date.now()));
    mkdirSync(req.uploadDir, { recursive: true });
    next();
  },
  upload.array('photos', 20),
  async (req, res) => {
    try {
      const airbnbUrl = String(req.body.airbnbUrl || '').trim();
      const photos = req.files || [];
      const access = await getAccess(getAuth(req).userId);
      if (!access.ok) {
        res.status(402).json({ error: access.error });
        return;
      }

      if (!airbnbUrl && photos.length === 0) {
        res.status(400).json({ error: 'Pega un link de Airbnb o sube fotos.' });
        return;
      }

      const jobId = randomUUID();
      const options = {
        airbnbUrl: airbnbUrl || undefined,
        photoDir: photos.length ? req.uploadDir : undefined,
        preferences: {
          zone: req.body.zone,
          goal: req.body.goal,
          askingPrice: req.body.askingPrice,
          currency: req.body.currency,
          notes: req.body.notes,
        },
        log: true,
      };
      jobs.set(jobId, { status: 'running' });
      res.json({ ok: true, jobId });

      runListingJob(options)
        .then((listing) => {
          jobs.set(jobId, { status: 'done', title: listing.titles?.es });
        })
        .catch((error) => {
          console.error(error);
          jobs.set(jobId, { status: 'error', error: error.message || 'Error al generar la ficha' });
        });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Error al generar la ficha' });
    }
  }
);

app.listen(PORT, HOST, () => {
  console.log(`HomesBrief en http://localhost:${PORT}`);
  if (!clerkEnabled) console.log('Clerk desactivado: faltan CLERK_PUBLISHABLE_KEY y CLERK_SECRET_KEY');
});

function readListing() {
  for (const file of [resolve('ficha.json'), resolve('web', 'ficha.json')]) {
    if (!existsSync(file)) continue;
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

function resolvePhotoDir(listing) {
  const raw = listing?.meta?.photo_dir;
  if (raw) {
    const candidate = resolve(raw);
    if (existsSync(candidate)) return candidate;
  }
  if (existsSync(DEMO_DIR)) return DEMO_DIR;
  return resolve('fotos');
}
