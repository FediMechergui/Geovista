/**
 * Satellite imagery stitcher.
 *
 * Fetches Esri World Imagery tiles covering a DEM's tile range and stitches
 * them onto an OffscreenCanvas that maps 1:1 onto the terrain mesh's UVs.
 *
 * Because Web-Mercator tiles nest exactly, imagery at `demZoom + k` covers
 * the DEM extent with `2^k` imagery tiles per DEM tile, so the canvas edges
 * coincide with the DEM's bbox with no resampling.
 */

import type { ElevationGrid, TileRange } from '@/types/geo';
import { TILE_URLS } from '@/lib/constants';

const TILE_PX = 256;

export interface ImageryOptions {
  /** Upper bound on tiles fetched (controls texture size: 256 tiles → 4096²). */
  maxTiles?: number;
  /** Esri World Imagery tops out around z19 in cities, lower elsewhere. */
  maxZoom?: number;
  /** Parallel requests. */
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

export interface ImageryResult {
  canvas: OffscreenCanvas;
  zoom: number;
  tilesLoaded: number;
  tilesTotal: number;
}

/** Highest zoom offset `k` such that the imagery tile count stays within budget. */
function chooseZoomOffset(range: TileRange, maxTiles: number, maxZoom: number): number {
  const n = range.x1 - range.x0 + 1;
  const m = range.y1 - range.y0 + 1;
  let k = 0;
  while (
    k < 6 &&
    range.zoom + k + 1 <= maxZoom &&
    n * m * 4 ** (k + 1) <= maxTiles
  ) {
    k++;
  }
  return k;
}

async function fetchTileBitmap(
  url: string,
  signal?: AbortSignal,
): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/** Simple promise pool. */
async function runPool<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

/**
 * Load satellite imagery aligned to `grid.tileRange`.
 * Throws if the grid was not built from tiles.
 */
export async function loadImageryForGrid(
  grid: ElevationGrid,
  {
    maxTiles = 256,
    maxZoom = 19,
    concurrency = 12,
    signal,
    onProgress,
  }: ImageryOptions = {},
): Promise<ImageryResult> {
  const range = grid.tileRange;
  if (!range) throw new Error('Grid has no tile range; cannot align imagery.');

  const k = chooseZoomOffset(range, maxTiles, maxZoom);
  const zoom = range.zoom + k;
  const scale = 2 ** k;

  const x0 = range.x0 * scale;
  const y0 = range.y0 * scale;
  const cols = (range.x1 - range.x0 + 1) * scale;
  const rows = (range.y1 - range.y0 + 1) * scale;

  const canvas = new OffscreenCanvas(cols * TILE_PX, rows * TILE_PX);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire 2D context');

  // Neutral base so missing tiles don't render black.
  ctx.fillStyle = '#8a9a7a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const total = cols * rows;
  let loaded = 0;

  const tasks: (() => Promise<void>)[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tasks.push(async () => {
        const url = TILE_URLS.satellite
          .replace('{z}', String(zoom))
          .replace('{x}', String(x0 + c))
          .replace('{y}', String(y0 + r));
        const bmp = await fetchTileBitmap(url, signal);
        if (bmp) {
          ctx.drawImage(bmp, c * TILE_PX, r * TILE_PX, TILE_PX, TILE_PX);
          bmp.close();
          loaded++;
        }
        onProgress?.(loaded, total);
      });
    }
  }

  await runPool(tasks, concurrency);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  return { canvas, zoom, tilesLoaded: loaded, tilesTotal: total };
}
