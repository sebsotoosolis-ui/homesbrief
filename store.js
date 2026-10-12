import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const DATA_DIR = resolve(process.env.DATA_DIR || 'data');

export function safeId(value) {
  return String(value || 'local').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'local';
}

export function saveUserListing(userId, listing, sourcePhotoDir) {
  const uid = safeId(userId);
  const listingId = Date.now().toString();
  const listingDir = join(DATA_DIR, uid, listingId);
  const photoDir = join(listingDir, 'photos');
  mkdirSync(photoDir, { recursive: true });

  if (sourcePhotoDir && existsSync(sourcePhotoDir)) {
    const files = readdirSync(sourcePhotoDir).filter((name) => statSync(join(sourcePhotoDir, name)).isFile());
    for (const name of files) {
      cpSync(join(sourcePhotoDir, name), join(photoDir, basename(name)));
    }
  }

  listing.meta = {
    ...listing.meta,
    listingId,
    ownerId: uid,
    photo_dir: photoDir,
    photos: listing.meta?.photos ?? filesIn(photoDir),
  };
  writeFileSync(join(listingDir, 'ficha.json'), JSON.stringify(listing, null, 2), 'utf8');
  writeFileSync(join(DATA_DIR, uid, 'latest.json'), JSON.stringify({ listingId }), 'utf8');
  return { listingId, listing };
}

export function loadUserListing(userId, listingId) {
  const file = join(DATA_DIR, safeId(userId), safeId(listingId), 'ficha.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function latestUserListing(userId) {
  const latestFile = join(DATA_DIR, safeId(userId), 'latest.json');
  if (!existsSync(latestFile)) return null;
  const { listingId } = JSON.parse(readFileSync(latestFile, 'utf8'));
  return listingId ? loadUserListing(userId, listingId) : null;
}

export function userPhotoPath(userId, listingId, name) {
  return join(DATA_DIR, safeId(userId), safeId(listingId), 'photos', basename(name));
}

export function countUserListings(userId, { since } = {}) {
  const dir = join(DATA_DIR, safeId(userId));
  if (!existsSync(dir)) return 0;
  return readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, 'ficha.json')))
    .filter((name) => {
      if (!since) return true;
      const generated = loadUserListing(userId, name)?.meta?.generated_at;
      return generated ? new Date(generated).getTime() >= since : true;
    }).length;
}

function filesIn(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((name) => statSync(join(folder, name)).isFile());
}
