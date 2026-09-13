// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Next.js 16 config — Turbopack is the default bundler.
 *
 * Cesium's runtime assets are copied to `public/cesium` before each build
 * (`scripts/copy-cesium.mjs`); in development they are served from
 * node_modules by `src/app/cesium/[...path]/route.ts`.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // Pin the workspace root so Turbopack never picks a parent checkout's lockfile.
  turbopack: { root: projectRoot },
};

export default nextConfig;
