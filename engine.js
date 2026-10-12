import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, basename, join, resolve } from 'node:path';
import convertHeic from 'heic-convert';
import { GoogleGenAI, Type } from '@google/genai';
import sharp from 'sharp';
import { importAirbnbListing, parseAirbnbUrl } from './airbnb.js';
import { writeListingPage } from './render-page.js';

loadLocalEnv();

const MODELS = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-2.0-flash'];
const MAX_RETRIES = 4;
const MAX_PHOTOS = 20;
const MAX_IMAGE_EDGE = 1600;
const MIN_IMAGE_EDGE = 400;
const DEFAULT_FOLDER = resolve('fotos');
const OUTPUT_PATH = resolve('ficha.json');
const API_KEY = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim();

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.heic', '.heif', '.bmp', '.tif', '.tiff',
]);

const listingSchema = {
  type: Type.OBJECT,
  properties: {
    property_type: { type: Type.STRING },
    inferred_location: { type: Type.STRING },
    style_and_vibe: { type: Type.STRING },
    spaces_visible: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          space: { type: Type.STRING },
          details: { type: Type.STRING },
        },
        required: ['space', 'details'],
      },
    },
    visual_features: { type: Type.ARRAY, items: { type: Type.STRING } },
    highlights: { type: Type.ARRAY, items: { type: Type.STRING } },
    titles: {
      type: Type.OBJECT,
      properties: { es: { type: Type.STRING }, en: { type: Type.STRING } },
      required: ['es', 'en'],
    },
    listing: {
      type: Type.OBJECT,
      properties: { es: { type: Type.STRING }, en: { type: Type.STRING } },
      required: ['es', 'en'],
    },
    social: {
      type: Type.OBJECT,
      properties: {
        instagram: {
          type: Type.OBJECT,
          properties: {
            caption: { type: Type.STRING },
            hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['caption', 'hashtags'],
        },
        facebook: {
          type: Type.OBJECT,
          properties: {
            caption: { type: Type.STRING },
            hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['caption', 'hashtags'],
        },
      },
      required: ['instagram', 'facebook'],
    },
    rent_estimate: {
      type: Type.OBJECT,
      properties: {
        currency: { type: Type.STRING },
        nightly_low_season: { type: Type.INTEGER },
        nightly_shoulder: { type: Type.INTEGER },
        nightly_high_season: { type: Type.INTEGER },
        nightly_peak: { type: Type.INTEGER },
        weekly_high_season: { type: Type.INTEGER },
        monthly_low_season: { type: Type.INTEGER },
        assumed_occupancy_pct: { type: Type.INTEGER },
        estimated_annual_gross: { type: Type.INTEGER },
        positioning: { type: Type.STRING },
        drivers: { type: Type.ARRAY, items: { type: Type.STRING } },
        disclaimer: { type: Type.STRING },
      },
      required: [
        'currency', 'nightly_low_season', 'nightly_shoulder', 'nightly_high_season',
        'nightly_peak', 'weekly_high_season', 'monthly_low_season', 'assumed_occupancy_pct',
        'estimated_annual_gross', 'positioning', 'drivers', 'disclaimer',
      ],
    },
  },
  required: [
    'property_type', 'inferred_location', 'style_and_vibe', 'spaces_visible',
    'visual_features', 'highlights', 'titles', 'listing', 'social', 'rent_estimate',
  ],
};

export { OUTPUT_PATH, DEFAULT_FOLDER, MAX_PHOTOS };

export async function runListingJob({
  airbnbUrl,
  photoDir,
  preferences = {},
  persist = true,
  log = false,
} = {}) {
  if (!API_KEY) {
    throw new Error('Falta GEMINI_API_KEY en .env');
  }

  mkdirSync(DEFAULT_FOLDER, { recursive: true });

  let inputPath = photoDir ? resolve(photoDir) : DEFAULT_FOLDER;
  let sourceMeta = null;
  const context = {
    mercado: 'Puerto Vallarta y Riviera Nayarit',
    estilo: preferences.tone || 'lujo / vacacional',
    publico: 'agencias e independientes',
    zonaSugerida: preferences.zone || 'el mercado local de la propiedad',
    datosExtra: '',
  };

  const airbnb = airbnbUrl ? parseAirbnbUrl(airbnbUrl) : null;
  if (airbnb) {
    const downloadDir = photoDir
      ? resolve(photoDir)
      : join(DEFAULT_FOLDER, `airbnb-${airbnb.roomId}`);
    sourceMeta = await importAirbnbListing(airbnb.listingUrl, downloadDir, MAX_PHOTOS);
    inputPath = downloadDir;
    context.zonaSugerida = sourceMeta.location || context.zonaSugerida;
  }

  context.datosExtra = [
    sourceMeta?.title && `Título Airbnb: ${sourceMeta.title}`,
    sourceMeta?.location && `Ubicación Airbnb: ${sourceMeta.location}`,
    sourceMeta?.bedrooms && `Recámaras (Airbnb): ${sourceMeta.bedrooms}`,
    sourceMeta?.baths && `Baños (Airbnb): ${sourceMeta.baths}`,
    sourceMeta?.guests && `Huéspedes (Airbnb): ${sourceMeta.guests}`,
    sourceMeta?.price && `Precio anclado Airbnb: ${sourceMeta.price.amount} ${sourceMeta.price.currency}`,
    sourceMeta?.description && `Descripción Airbnb: ${sourceMeta.description}`,
    preferences.zone && `Zona que indica el agente: ${preferences.zone}`,
    preferences.goal && `Objetivo: ${preferences.goal}`,
    preferences.askingPrice && `Precio / tarifa que el agente quiere usar: ${preferences.askingPrice} ${preferences.currency || ''}`.trim(),
    preferences.notes && `Notas del agente: ${preferences.notes}`,
  ]
    .filter(Boolean)
    .join('\n');

  const images = await loadImages(inputPath);
  if (images.length === 0) {
    throw new Error('Sube fotos o pega un link de Airbnb para generar la ficha.');
  }

  if (log) {
    console.log(`Fotos: ${images.length}`);
    for (const image of images) console.log(`  • ${image.name} (${image.width}x${image.height})`);
  }

  const ai = new GoogleGenAI({
    apiKey: API_KEY,
    httpOptions: { timeout: 90_000 },
  });
  const parts = [{ text: buildPrompt(context, images) }];
  for (const image of images) {
    parts.push({ text: `Foto: ${image.name}` });
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  }

  const { response, model } = await generateWithFallback(ai, parts);
  const listing = parseJsonResponse(response.text);
  listing.meta = {
    model,
    photos: images.map((image) => image.name),
    generated_at: new Date().toISOString(),
    source: sourceMeta
      ? { type: 'airbnb', url: sourceMeta.listingUrl, roomId: sourceMeta.roomId, title: sourceMeta.title }
      : { type: 'upload' },
    photo_dir: inputPath,
    preferences,
  };

  if (persist) {
    writeFileSync(OUTPUT_PATH, JSON.stringify(listing, null, 2), 'utf8');
    writeListingPage(listing, { photoDir: inputPath });
  }
  return listing;
}

function isRetryableModelError(raw) {
  const text = String(raw);
  return (
    text.includes('503') ||
    text.includes('UNAVAILABLE') ||
    text.includes('fetch failed') ||
    text.includes('timeout') ||
    text.includes('UND_ERR') ||
    text.includes('ECONNRESET')
  );
}

async function generateWithFallback(ai, parts) {
  let lastError;
  for (const model of MODELS) {
    try {
      return { response: await generateWithRetry(ai, model, parts), model };
    } catch (error) {
      lastError = error;
      const raw = error?.message ?? String(error);
      if (isRetryableModelError(raw) || raw.includes('404') || raw.includes('NOT_FOUND') || raw.includes('no longer available')) {
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function generateWithRetry(ai, model, parts) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: { responseMimeType: 'application/json', responseSchema: listingSchema },
      });
    } catch (error) {
      lastError = error;
      const raw = error?.message ?? String(error);
      if (!isRetryableModelError(raw)) throw error;
      if (attempt === MAX_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function loadImages(inputPath) {
  if (!existsSync(inputPath)) return [];
  const files = statSync(inputPath).isDirectory() ? listImageFiles(inputPath) : [inputPath];
  const images = [];
  for (const filePath of files.slice(0, MAX_PHOTOS)) {
    try {
      images.push(await prepareImage(filePath));
    } catch (error) {
      console.log(`No pude leer ${basename(filePath)}: ${error.message}`);
    }
  }
  return images;
}

async function prepareImage(filePath) {
  const name = basename(filePath);
  const jpeg = await toGeminiJpeg(readFileSync(filePath), name);
  const meta = await sharp(jpeg).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  return {
    path: filePath,
    name,
    width,
    height,
    tooSmall: Math.min(width, height) < MIN_IMAGE_EDGE,
    mimeType: 'image/jpeg',
    data: jpeg.toString('base64'),
  };
}

async function toGeminiJpeg(buffer, name) {
  try {
    return await sharp(buffer)
      .rotate()
      .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    try {
      const fromHeic = Buffer.from(await convertHeic({ buffer, format: 'JPEG', quality: 0.82 }));
      return sharp(fromHeic)
        .rotate()
        .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
    } catch {
      throw new Error(`formato no soportado (${name})`);
    }
  }
}

function listImageFiles(folderPath) {
  if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) return [];
  return readdirSync(folderPath)
    .map((name) => join(folderPath, name))
    .filter((filePath) => statSync(filePath).isFile() && looksLikeImage(filePath))
    .sort((a, b) => basename(a).localeCompare(basename(b), undefined, { numeric: true }));
}

function looksLikeImage(filePath) {
  if (IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) return true;
  try {
    const bytes = readFileSync(filePath).subarray(0, 16);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return true;
    if (bytes.toString('ascii', 4, 8) === 'ftyp') return true;
  } catch {
    return false;
  }
  return false;
}

function buildPrompt(context, images) {
  return `Eres un copywriter senior de bienes raíces de lujo en ${context.mercado}.
Analiza este set de ${images.length} fotos de la MISMA propiedad y genera copy listo para que un agente lo publique sin editar.

Contexto:
- Posicionamiento: ${context.estilo}
- Zona sugerida: ${context.zonaSugerida}
${context.datosExtra ? `- Datos del agente / listing:\n${context.datosExtra}` : '- Sin datos extra; infiere de las imágenes.'}

Reglas:
- Lista solo lo visible. No inventes recámaras, m² ni amenidades.
- Español natural del mercado de la zona. Inglés para comprador internacional.
- Hashtags locales del mercado de ${context.zonaSugerida} (no fuerces Puerto Vallarta si la zona es otra).
- rent_estimate es orientativo, no avalúo. Temporadas según el mercado de ${context.zonaSugerida}: baja, media, alta y pico local.
- Si el agente dio un precio, respétalo como ancla y arma temporadas alrededor.
- Conservador, creíble, listo para publicar.`;
}

function parseJsonResponse(raw) {
  if (!raw) throw new Error('Gemini no devolvió texto.');
  return JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
}

export function loadLocalEnv() {
  const envPath = new URL('./.env', import.meta.url);
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
