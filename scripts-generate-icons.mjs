import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = fileURLToPath(new URL('./assets/zutnik-logo.svg', import.meta.url));
const assetsDir = fileURLToPath(new URL('./assets/', import.meta.url));
const outputDir = fileURLToPath(new URL('./public/icons/', import.meta.url));

await mkdir(assetsDir, { recursive: true });
await mkdir(outputDir, { recursive: true });

await sharp(source)
  .resize(512, 512, { fit: 'cover' })
  .png({ quality: 95 })
  .toFile(`${assetsDir}/zutnik-logo.png`);

await sharp(source)
  .resize(512, 512, { fit: 'cover' })
  .png({ quality: 95 })
  .toFile(`${assetsDir}/android-icon.png`);

await sharp(source)
  .resize(512, 512, { fit: 'cover' })
  .png({ quality: 95 })
  .toFile(`${outputDir}/zutnik-logo.png`);

// ── Regular icon (192px) ─────────────────────────────────────────────────
// Used on desktop, browser tabs, etc.
await sharp(source)
  .resize(192, 192, { fit: 'cover' })
  .png({ quality: 95 })
  .toFile(`${outputDir}/icon-192.png`);

// ── Regular icon (512px) ─────────────────────────────────────────────────
await sharp(source)
  .resize(512, 512, { fit: 'cover' })
  .png({ quality: 95 })
  .toFile(`${outputDir}/icon-512.png`);

// ── Maskable icon (512px) ────────────────────────────────────────────────
// The Z mark is already kept inside the Android maskable safe zone.
await sharp(source)
  .resize(512, 512, { fit: 'cover' })
  .png({ quality: 95 })
  .toFile(`${outputDir}/icon-maskable-512.png`);

console.log('Generated ZUTnik logo assets and PWA icons');
