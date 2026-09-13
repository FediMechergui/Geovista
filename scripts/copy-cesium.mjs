/**
 * Copies CesiumJS's runtime assets (Workers, Assets, ThirdParty, Widgets)
 * from node_modules into `public/cesium` so they are served as static files.
 *
 * Runs automatically before `next build` (see package.json "prebuild").
 * In development the route `src/app/cesium/[...path]/route.ts` serves the
 * same files straight from node_modules, so no copy is needed.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const cesiumPkg = require.resolve('cesium/package.json');
const version = JSON.parse(readFileSync(cesiumPkg, 'utf8')).version;
const src = path.join(path.dirname(cesiumPkg), 'Build', 'Cesium');
const dest = path.join(root, 'public', 'cesium');
const stamp = path.join(dest, '.version');

if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === version) {
  console.log(`[copy-cesium] public/cesium already at ${version}, skipping.`);
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
for (const dir of ['Workers', 'Assets', 'ThirdParty', 'Widgets']) {
  cpSync(path.join(src, dir), path.join(dest, dir), { recursive: true });
}
writeFileSync(stamp, version);
console.log(`[copy-cesium] Copied Cesium ${version} runtime assets to public/cesium.`);
