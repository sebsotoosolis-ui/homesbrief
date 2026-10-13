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

async function bootClerk(redirectTo = '/app') {
  fetch('/health').catch(() => {});
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

const NAME_KEY = 'homesbrief-name';

function clerkDisplayName(clerk) {
  const first = String(clerk?.user?.firstName || '').trim();
  if (!first || /[0-9@]/.test(first)) return '';
  return first;
}

async function rememberDisplayName(clerk) {
  const user = clerk?.user;
  if (!user) return '';
  const current = clerkDisplayName(clerk);
  if (current) return current;
  const pending = sessionStorage.getItem(NAME_KEY)?.trim() || '';
  if (!pending || /[0-9@]/.test(pending)) return '';
  await user.update({ firstName: pending });
  sessionStorage.removeItem(NAME_KEY);
  return pending;
}

function mountNameAsk(clerk, anchor) {
  if (!anchor || clerkDisplayName(clerk) || anchor.parentElement?.querySelector('.name-ask')) return;
  const form = document.createElement('form');
  form.className = 'name-ask';
  form.innerHTML = '<label>¿Cómo te llamamos?</label><div class="name-ask-row"><input name="firstName" autocomplete="given-name" placeholder="Tu nombre" required /><button class="btn btn-navy" type="submit">Guardar</button></div>';
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = String(new FormData(form).get('firstName') || '').trim();
    if (!value) return;
    await clerk.user.update({ firstName: value });
    sessionStorage.removeItem(NAME_KEY);
    const hello = document.getElementById('hello-name') || document.getElementById('hello');
    if (hello) hello.textContent = 'Hola, ' + value + '.';
    form.remove();
  });
  anchor.insertAdjacentElement('afterend', form);
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
