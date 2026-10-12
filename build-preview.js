import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeListingPage } from './render-page.js';

const listing = JSON.parse(readFileSync('ficha.json', 'utf8'));
const photoDir = resolve('fotos', `airbnb-${listing.meta?.source?.roomId ?? ''}`);
writeListingPage(listing, { photoDir });
console.log('web/index.html listo');
