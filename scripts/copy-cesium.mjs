/**
 * Copies CesiumJS into `public/cesium` so it is served as a static file:
 * the library (`Cesium.js`) plus the runtime assets it fetches at run time
 * (Workers, Assets, ThirdParty, Widgets).
 *
 * Runs automatically before `next build` (see package.json "prebuild").
 * In development the route `src/app/cesium/[...path]/route.ts` serves the
 * same files straight from node_modules, so no copy is needed.
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
// The library itself, loaded with a script tag instead of bundled — Turbopack's
// minifier corrupts Cesium's embedded decoder binary. See src/lib/cesium/index.ts.
copyFileSync(path.join(src, 'Cesium.js'), path.join(dest, 'Cesium.js'));
writeFileSync(stamp, version);
console.log(`[copy-cesium] Copied Cesium ${version} runtime assets to public/cesium.`);
