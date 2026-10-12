import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeListingPage(listing, { photoDir } = {}) {
  mkdirSync(join(process.cwd(), 'web'), { recursive: true });
  if (photoDir) listing.meta = { ...listing.meta, photo_dir: photoDir };
  writeFileSync(join(process.cwd(), 'web', 'index.html'), renderHtml(listing), 'utf8');
  writeFileSync(join(process.cwd(), 'web', 'ficha.json'), JSON.stringify(listing, null, 2), 'utf8');
}

export function renderHtml(listing, { mediaPrefix = '/media', chrome = false } = {}) {
  const photos = listing.meta?.photos ?? [];
  const media = (name) => `${mediaPrefix}/${encodeURIComponent(name)}`;
  const rent = listing.rent_estimate;
  const money = (value) =>
    rent ? `${rent.currency} ${Number(value).toLocaleString('en-US')}` : '';

  const whatsapp = buildWhatsApp(listing);
  const portalBullets = listing.visual_features ?? [];
  const reels = buildReels(listing);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(listing.titles?.es ?? 'Ficha de propiedad')}</title>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=4" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=4" />
  <link rel="shortcut icon" href="/favicon.ico?v=4" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=4" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Manrope:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --navy: #10202b;
      --ink: #1b2c36;
      --sand: #f4efe6;
      --gold: #b08d57;
      --paper: #fffdf8;
      --line: rgba(16, 32, 43, 0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Manrope, sans-serif;
      background: var(--sand);
      color: var(--ink);
    }
    h1, h2, h3 { font-family: "Cormorant Garamond", serif; font-weight: 600; margin: 0; }
    .hero {
      min-height: 72vh;
      background:
        linear-gradient(180deg, rgba(16,32,43,.15), rgba(16,32,43,.72)),
        url("${photos[0] ? media(photos[0]) : ''}") center/cover;
      color: white;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      padding: 40px 8vw 48px;
    }
    .kicker { letter-spacing: .18em; text-transform: uppercase; font-size: 12px; color: var(--gold); }
    .hero h1 { font-size: clamp(32px, 5vw, 64px); max-width: 16ch; line-height: .95; margin: 12px 0 16px; }
    .meta { opacity: .9; }
    .wrap { width: min(1120px, calc(100% - 48px)); margin: 0 auto; }
    .pills { display: flex; gap: 10px; flex-wrap: wrap; margin: -28px auto 32px; width: min(1120px, calc(100% - 48px)); }
    .pill { background: white; border-radius: 999px; padding: 10px 16px; box-shadow: 0 8px 24px rgba(16,32,43,.08); font-size: 14px; }
    section { background: var(--paper); border-radius: 24px; padding: 28px; margin: 0 auto 20px; width: min(1120px, calc(100% - 48px)); box-shadow: 0 10px 40px rgba(16,32,43,.04); }
    .row { display: grid; gap: 18px; }
    @media (min-width: 860px) { .row-2 { grid-template-columns: 1.2fr .8fr; } .gallery { grid-template-columns: repeat(4, 1fr); } }
    .gallery { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .gallery img { width: 100%; height: 140px; object-fit: cover; border-radius: 14px; }
    .copy { white-space: pre-wrap; line-height: 1.65; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
    button.copy, .lang {
      border: 1px solid var(--line); background: white; border-radius: 999px; padding: 8px 14px; cursor: pointer; font: inherit;
    }
    button.copy:hover { border-color: var(--gold); color: var(--gold); }
    ul { margin: 8px 0 0; padding-left: 18px; }
    li { margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 10px 0; border-bottom: 1px solid var(--line); }
    .muted { color: #66747c; font-size: 13px; }
    .en { display: none; }
    body.en .es { display: none; }
    body.en .en { display: block; }
    body.en li.es { display: none; }
    body.en li.en { display: list-item; }
    footer { text-align: center; padding: 40px 20px 60px; color: #66747c; font-size: 13px; }
    .chrome {
      position: sticky; top: 0; z-index: 20;
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
      padding: 12px 7vw; background: rgba(244,239,230,.92); backdrop-filter: blur(14px);
      border-bottom: 1px solid var(--line);
    }
    .chrome a { color: inherit; text-decoration: none; font-size: 13px; font-weight: 600; }
    .chrome .logo { font-family: "Cormorant Garamond", serif; font-size: 22px; }
    .chrome nav { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
    .chrome .gold { color: var(--gold); }
    .chrome .logo { display: inline-flex; align-items: center; gap: 8px; }
    .chrome .logo img { width: 22px; height: 22px; border-radius: 6px; }
  </style>
</head>
<body>
  ${chrome ? `<div class="chrome"><a class="logo" href="/"><img src="/logo.svg" alt="" />HomesBrief</a><nav><a href="/fichas">Mis propiedades</a><a class="gold" href="/app">Nueva ficha</a></nav></div>` : ''}
  <header class="hero">
    <div class="kicker">HomesBrief · listing brief</div>
    <h1 class="es">${esc(listing.titles?.es)}</h1>
    <h1 class="en">${esc(listing.titles?.en)}</h1>
    <p class="meta">${esc(listing.property_type)} · ${esc(listing.inferred_location)}</p>
  </header>

  <div class="pills">
    ${(listing.meta?.source?.title ? `<div class="pill">${esc(listing.meta.source.title)}</div>` : '')}
    <div class="pill">${esc(listing.style_and_vibe)}</div>
    <button class="lang" type="button" id="langBtn">ES / EN</button>
  </div>

  <section>
    <div class="toolbar"><h2>Galería</h2><span class="muted">${photos.length} fotos listas para publicar</span></div>
    <div class="gallery">
      ${photos.map((name) => `<img src="${media(name)}" alt="${esc(name)}" />`).join('')}
    </div>
  </section>

  <section class="row row-2">
    <div>
      <div class="toolbar"><h2 class="es">Ficha comercial</h2><h2 class="en">Listing copy</h2>
        <button class="copy" data-copy="${escAttr(listing.listing?.es)}">Copiar ES</button>
      </div>
      <p class="copy es">${esc(listing.listing?.es)}</p>
      <p class="copy en">${esc(listing.listing?.en)}</p>
    </div>
    <div>
      <h2>Puntos fuertes</h2>
      <ul>${(listing.highlights ?? []).map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
    </div>
  </section>

  ${rent ? `<section>
    <h2>Estimado de renta vacacional</h2>
    <p>${esc(rent.positioning)}</p>
    <table>
      <tr><td>Temporada baja</td><td>${money(rent.nightly_low_season)} / noche</td></tr>
      <tr><td>Temporada media</td><td>${money(rent.nightly_shoulder)} / noche</td></tr>
      <tr><td>Temporada alta</td><td>${money(rent.nightly_high_season)} / noche</td></tr>
      <tr><td>Pico (Navidad / Semana Santa)</td><td>${money(rent.nightly_peak)} / noche</td></tr>
      <tr><td>Semana alta</td><td>${money(rent.weekly_high_season)}</td></tr>
      <tr><td>Mensual</td><td>${money(rent.monthly_low_season)}</td></tr>
      <tr><td>Ocupación estimada</td><td>${rent.assumed_occupancy_pct}%</td></tr>
      <tr><td>Bruto anual estimado</td><td>${money(rent.estimated_annual_gross)}</td></tr>
    </table>
    <p class="muted">${esc(rent.disclaimer)}</p>
  </section>` : ''}

  <section>
    <div class="toolbar"><h2>WhatsApp (listo para enviar)</h2><button class="copy" data-copy="${escAttr(whatsapp)}">Copiar</button></div>
    <p class="copy">${esc(whatsapp)}</p>
  </section>

  <section>
    <div class="toolbar"><h2>Instagram</h2><button class="copy" data-copy="${escAttr(socialBlock(listing.social?.instagram))}">Copiar</button></div>
    <p class="copy">${esc(socialBlock(listing.social?.instagram))}</p>
  </section>

  <section>
    <div class="toolbar"><h2>Facebook</h2><button class="copy" data-copy="${escAttr(socialBlock(listing.social?.facebook))}">Copiar</button></div>
    <p class="copy">${esc(socialBlock(listing.social?.facebook))}</p>
  </section>

  <section>
    <div class="toolbar"><h2>Reels / TikTok (15s)</h2><button class="copy" data-copy="${escAttr(reels)}">Copiar</button></div>
    <p class="copy">${esc(reels)}</p>
  </section>

  <section>
    <h2>Bullets para portales (Inmuebles24, Airbnb, MLS)</h2>
    <ul>${portalBullets.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
  </section>

  <section>
    <h2>Espacios detectados</h2>
    <ul>${(listing.spaces_visible ?? []).map((item) => `<li><strong>${esc(item.space)}:</strong> ${esc(item.details)}</li>`).join('')}</ul>
  </section>

  <footer>Ficha generada para que el agente copie y publique. No reemplaza un avalúo ni una visita.</footer>
  <script>
    document.getElementById('langBtn').addEventListener('click', () => {
      document.body.classList.toggle('en');
    });
    document.querySelectorAll('button.copy').forEach((button) => {
      button.addEventListener('click', async () => {
        await navigator.clipboard.writeText(button.dataset.copy || '');
        button.textContent = 'Copiado';
        setTimeout(() => { button.textContent = 'Copiar'; }, 1400);
      });
    });
  </script>
</body>
</html>`;
}

function buildWhatsApp(listing) {
  const bullets = (listing.highlights ?? []).slice(0, 4).map((item) => `• ${item}`).join('\n');
  return `${listing.titles?.es ?? ''}

${listing.inferred_location ?? ''}
${listing.property_type ?? ''}

${bullets}

¿Te mando ficha completa y disponibilidad?`;
}

function buildReels(listing) {
  return `0-3s: vista al mar / terraza
3-7s: sala abriéndose a la terraza
7-11s: recámara principal y cocina
11-15s: alberca o amenidad + texto: "${listing.titles?.es ?? ''}"
CTA: Escríbeme por WhatsApp`;
}

function socialBlock(social) {
  if (!social) return '';
  return `${social.caption ?? ''}\n\n${(social.hashtags ?? []).join(' ')}`;
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escAttr(value) {
  return esc(value).replaceAll('"', '&quot;').replaceAll('\n', '&#10;');
}
