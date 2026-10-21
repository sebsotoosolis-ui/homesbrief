const clerkAppearance = {
  variables: {
    colorPrimary: '#c4a265',
    colorBackground: '#fffdf8',
    colorText: '#14242e',
    borderRadius: '16px',
    fontFamily: 'Outfit, sans-serif',
  },
  elements: {
    formButtonPrimary: {
      borderRadius: '999px',
      boxShadow: '0 12px 28px rgba(196, 162, 101, .32)',
    },
    formButtonReset: {
      borderRadius: '999px',
    },
  },
};

function clerkFrontendApi(publishableKey) {
  const encoded = publishableKey.split('_')[2];
  return atob(encoded).slice(0, -1);
}

function loadScript(src, attrs = {}) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    Object.entries(attrs).forEach(([key, value]) => script.setAttribute(key, value));
    script.onload = resolve;
    script.onerror = () => reject(new Error('No se pudo cargar Clerk'));
    document.head.appendChild(script);
  });
}

async function bootClerk(redirectTo = '/app') {
  fetch('/health').catch(() => {});
  const config = await fetch('/api/clerk-config').then((response) => response.json());
  if (!config.publishableKey) {
    throw new Error('No se pudo abrir el registro.');
  }
  const frontendApi = clerkFrontendApi(config.publishableKey);
  await loadScript(`https://${frontendApi}/npm/@clerk/ui@1/dist/ui.browser.js`);
  await loadScript(`https://${frontendApi}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, {
    'data-clerk-publishable-key': config.publishableKey,
  });
  await window.Clerk.load({
    ui: { ClerkUI: window.__internal_ClerkUICtor },
    touchSession: true,
    signInForceRedirectUrl: redirectTo,
    signUpForceRedirectUrl: redirectTo,
  });
  return window.Clerk;
}

async function clerkAuthHeader() {
  const token = await window.Clerk?.session?.getToken();
  return token ? { Authorization: 'Bearer ' + token } : {};
}

function clerkDisplayName(clerk) {
  const user = clerk?.user;
  if (!user) return '';
  const first = String(user.firstName || '').trim();
  if (first) return first;
  const full = String(user.fullName || '').trim();
  if (full) return full.split(/\s+/)[0];
  const email = user.primaryEmailAddress?.emailAddress || user.emailAddresses?.[0]?.emailAddress || '';
  const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  if (!local) return '';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

async function applySavedName(clerk) {
  const user = clerk?.user;
  const saved = sessionStorage.getItem('homesbrief-name')?.trim() || '';
  if (user && saved && !String(user.firstName || '').trim()) {
    await user.update({ firstName: saved });
    sessionStorage.removeItem('homesbrief-name');
    return saved;
  }
  return clerkDisplayName(clerk);
}

function greetSignedIn(clerk, { hello, lead, namedLead }) {
  const name = clerkDisplayName(clerk);
  if (hello) {
    hello.textContent = name ? `Hola, ${name}.` : 'Hola.';
  }
  if (lead) {
    lead.textContent = name ? (namedLead || lead.textContent) : lead.textContent;
  }
}

function mountSignedInNav(clerk) {
  const guest = document.getElementById('nav-guest');
  const user = document.getElementById('nav-user');
  if (!clerk.isSignedIn) {
    guest?.classList.remove('off');
    user?.classList.add('off');
    return;
  }
  guest?.classList.add('off');
  user?.classList.remove('off');
  const button = document.getElementById('user-button');
  if (button) {
    clerk.mountUserButton(button, {
      appearance: clerkAppearance,
      afterSignOutUrl: '/',
    });
  }
}
