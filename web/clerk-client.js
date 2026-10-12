const clerkAppearance = {
  variables: {
    colorPrimary: '#c4a265',
    colorBackground: '#fffcf7',
    colorText: '#14242e',
    borderRadius: '14px',
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

async function bootClerk() {
  const config = await fetch('/api/clerk-config').then((response) => response.json());
  if (!config.publishableKey) {
    throw new Error('Falta configurar Clerk. Añade CLERK_PUBLISHABLE_KEY en Render.');
  }
  const frontendApi = clerkFrontendApi(config.publishableKey);
  await loadScript(`https://${frontendApi}/npm/@clerk/ui@1/dist/ui.browser.js`);
  await loadScript(`https://${frontendApi}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, {
    'data-clerk-publishable-key': config.publishableKey,
  });
  await window.Clerk.load({
    ui: { ClerkUI: window.__internal_ClerkUICtor },
  });
  return window.Clerk;
}

async function clerkAuthHeader() {
  const token = await window.Clerk?.session?.getToken();
  return token ? { Authorization: 'Bearer ' + token } : {};
}
