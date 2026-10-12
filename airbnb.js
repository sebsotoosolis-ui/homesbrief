import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export function parseAirbnbUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (!/(^|\.)airbnb\./i.test(url.hostname)) return null;

  const match = url.pathname.match(/\/rooms\/(?:plus\/)?(\d+)/);
  if (!match) return null;

  return {
    roomId: match[1],
    listingUrl: `https://${url.hostname}/rooms/${match[1]}`,
  };
}

export async function importAirbnbListing(listingUrl, destFolder, maxPhotos = 20) {
  const parsed = parseAirbnbUrl(listingUrl);
  if (!parsed) {
    throw new Error('Esa URL no parece un listing de Airbnb. Usa algo como https://www.airbnb.mx/rooms/123');
  }

  console.log(`Importando Airbnb ${parsed.roomId}...`);
  const html = await fetchText(parsed.listingUrl);
  const facts = extractListingFacts(html);
  const photoUrls = extractPhotoUrls(html, parsed.roomId).slice(0, maxPhotos);

  mkdirSync(destFolder, { recursive: true });
  const alreadySaved = readdirSync(destFolder).filter((name) => /\.(jpe?g|png|webp)$/i.test(name));
  if (alreadySaved.length >= 5) {
    console.log(`Ya hay ${alreadySaved.length} fotos locales; no las vuelvo a bajar.`);
    return { ...parsed, ...facts, photoUrls, saved: alreadySaved.map((name) => join(destFolder, name)) };
  }

  if (photoUrls.length === 0) {
    throw new Error('Airbnb no dejó leer las fotos de esa página. Prueba de nuevo o sube las imágenes a la carpeta fotos.');
  }
  const saved = [];

  for (const [index, photoUrl] of photoUrls.entries()) {
    const fileName = `${String(index + 1).padStart(2, '0')}.jpg`;
    const filePath = join(destFolder, fileName);
    const buffer = await fetchBuffer(photoUrl);
    writeFileSync(filePath, buffer);
    saved.push(filePath);
    console.log(`  • ${fileName} (${Math.round(buffer.length / 1024)} KB)`);
  }

  return { ...parsed, ...facts, photoUrls, saved };
}

function extractListingFacts(html) {
  const title = decode(metaContent(html, 'og:title') ?? '').replace(/\s+[-–].*$/, '').trim();
  const description = decode(metaContent(html, 'og:description') ?? '').trim();
  const location =
    html.match(/alojamiento entero:[^<]*en\s+([^,<]+)/i)?.[1]?.trim() ??
    html.match(/Bucer[ií]as[^<,]*/)?.[0] ??
    '';
  const guests = firstNumber(html, /(\d+)\s*huéspedes/i);
  const bedrooms = firstNumber(html, /(\d+)\s*(?:habitaciones|recámaras)/i);
  const baths = firstNumber(html, /(\d+)\s*baños/i);
  const rating = html.match(/★\s*([0-9.]+)/)?.[1] ?? '';
  const price = extractAirbnbPrice(html);

  return { title, description, location, guests, bedrooms, baths, rating, price };
}

function extractAirbnbPrice(html) {
  const found = [];
  for (const match of html.matchAll(/"amount"\s*:\s*(\d+(?:\.\d+)?)\s*,\s*"currency"\s*:\s*"(USD|MXN)"/g)) {
    found.push({ amount: Number(match[1]), currency: match[2] });
  }
  for (const match of html.matchAll(/"currency"\s*:\s*"(USD|MXN)"\s*,\s*"amount"\s*:\s*(\d+(?:\.\d+)?)/g)) {
    found.push({ amount: Number(match[2]), currency: match[1] });
  }

  const display = html.match(/(?:MX\$|\$)\s*([\d,]+)[^\n]{0,40}noche/i);
  if (display) {
    found.push({
      amount: Number(display[1].replaceAll(',', '')),
      currency: display[0].includes('MX') ? 'MXN' : 'USD',
    });
  }

  const usable = found.filter((item) => item.amount > 20 && item.amount < 500000);
  if (usable.length === 0) return null;
  usable.sort((a, b) => a.amount - b.amount);
  return usable[Math.floor(usable.length / 2)];
}

function firstNumber(html, pattern) {
  const match = html.match(pattern);
  return match ? Number(match[1]) : null;
}

function extractPhotoUrls(html, roomId) {
  const matches = [...html.matchAll(/https:\/\/a0\.muscache\.com\/im\/pictures\/[^"'\\\s<>]+/g)].map((m) =>
    m[0].replaceAll('&amp;', '&')
  );

  const originals = matches
    .map((url) => url.split('?')[0])
    .filter((url) => url.includes(`/hosting/Hosting-${roomId}/original/`))
    .filter((url) => !url.includes('airbnb-platform-assets'))
    .filter((url) => !url.includes('AirbnbPlatformAssets'));

  return [...new Set(originals)].map((url) => `${url}?im_w=1440`);
}

function metaContent(html, property) {
  const regex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    'i'
  );
  return html.match(regex)?.[1] ?? html.match(alt)?.[1] ?? '';
}

function decode(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&nbsp;', ' ');
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
    },
  });
  if (!response.ok) {
    throw new Error(`No pude abrir el listing de Airbnb (${response.status}).`);
  }
  return response.text();
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`No pude bajar una foto de Airbnb (${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}
