import { NextRequest, NextResponse } from 'next/server';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

/**
 * Development fallback: serves CesiumJS's runtime files (Workers, Assets,
 * ThirdParty, Widgets) straight from `node_modules/cesium/Build/Cesium`.
 *
 * Cesium loads these at runtime from `window.CESIUM_BASE_URL` (`/cesium`).
 * Production builds copy the same files to `public/cesium` (see
 * `scripts/copy-cesium.mjs`, run by the `prebuild` script); static files in
 * `public/` are served before this route, so it only answers in `next dev`.
 */

const CESIUM_BUILD_DIR = path.join(process.cwd(), 'node_modules', 'cesium', 'Build', 'Cesium');

const ALLOWED_ROOTS = new Set(['Workers', 'Assets', 'ThirdParty', 'Widgets']);

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ktx2': 'image/ktx2',
  '.bin': 'application/octet-stream',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await context.params;

  if (!segments?.length || !ALLOWED_ROOTS.has(segments[0])) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Resolve and make sure we never escape the Cesium build directory.
  const filePath = path.resolve(CESIUM_BUILD_DIR, ...segments);
  if (!filePath.startsWith(CESIUM_BUILD_DIR + path.sep)) {
    return new NextResponse('Not found', { status: 404 });
  }

  let size: number;
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return new NextResponse('Not found', { status: 404 });
    size = stat.size;
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;

  return new NextResponse(stream, {
    headers: {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': String(size),
      'Cache-Control':
        process.env.NODE_ENV === 'production'
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
    },
  });
}
