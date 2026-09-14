/**
 * DEM (Digital Elevation Model) loading utilities.
 *
 * Source: AWS Terrain Tiles (Terrarium PNG encoding, free, global, up to z15).
 * These functions use browser APIs (fetch, OffscreenCanvas) and must be
 * called from client code.
 */

import type { BBox, ElevationGrid, TileRange } from '@/types/geo';
import { TILE_URLS } from '@/lib/constants';

export const TERRARIUM_NO_DATA = -32768;
const TILE_PX = 256;

/* ================================================================== */
/*  Tile math                                                          */
/* ================================================================== */

/** Convert geographic coordinates to slippy-map (XYZ) tile indices. */
export function latLonToTile(
  lat: number,
  lon: number,
  zoom: number,
): { x: number; y: number; z: number } {
  const latRad = (lat * Math.PI) / 180;
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y, z: zoom };
}

/** Geographic extent of a Web-Mercator XYZ tile. */
export function tileBounds(x: number, y: number, z: number): BBox {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const nRad = Math.PI - (2 * Math.PI * y) / n;
  const sRad = Math.PI - (2 * Math.PI * (y + 1)) / n;
  const north = (180 / Math.PI) * Math.atan(Math.sinh(nRad));
  const south = (180 / Math.PI) * Math.atan(Math.sinh(sRad));
  return { west, east, north, south };
}

/** Inclusive tile range covering a bbox at a zoom level. */
export function tileRangeForBBox(bbox: BBox, zoom: number): TileRange {
  const n = 2 ** zoom;
  const tl = latLonToTile(bbox.north, bbox.west, zoom);
  const br = latLonToTile(bbox.south, bbox.east, zoom);
  return {
    x0: Math.max(0, Math.min(tl.x, br.x)),
    y0: Math.max(0, Math.min(tl.y, br.y)),
    x1: Math.min(n - 1, Math.max(tl.x, br.x)),
    y1: Math.min(n - 1, Math.max(tl.y, br.y)),
    zoom,
  };
}

/** Geographic extent of a whole tile range. */
export function tileRangeBounds(r: TileRange): BBox {
  const tl = tileBounds(r.x0, r.y0, r.zoom);
  const br = tileBounds(r.x1, r.y1, r.zoom);
  return { west: tl.west, north: tl.north, east: br.east, south: br.south };
}

export function tileRangeCount(r: TileRange): number {
  return (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
}

/**
 * Pick the highest zoom whose tile range covering `bbox` stays within
 * `maxTiles`. Higher zoom = finer terrain but more requests and vertices.
 */
export function chooseDemZoom(
  bbox: BBox,
  { maxTiles = 16, maxZoom = 14, minZoom = 2 } = {},
): number {
  for (let z = maxZoom; z > minZoom; z--) {
    if (tileRangeCount(tileRangeForBBox(bbox, z)) <= maxTiles) return z;
  }
  return minZoom;
}

/* ================================================================== */
/*  Tile fetching / decoding                                           */
/* ================================================================== */

/**
 * Fetch a Terrarium-encoded terrain tile and decode it into raw RGBA pixels.
 *
 * Terrarium encoding: elevation (m) = (r * 256 + g + b / 256) - 32768
 * See: https://github.com/tilezen/joerd/blob/master/docs/formats.md
 */
export async function loadTerrainTile(
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<ImageData> {
  const url = TILE_URLS.terrain
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(
      `Failed to load terrain tile ${z}/${x}/${y}: ${response.status} ${response.statusText}`,
    );
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire 2D context from OffscreenCanvas');
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return imageData;
}

/** Decode a single Terrarium RGB pixel to elevation in meters. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/* ================================================================== */
/*  Multi-tile stitching                                               */
/* ================================================================== */

/**
 * Load all terrain tiles covering a bounding box at `zoom` and stitch them
 * into a single `ElevationGrid` whose bbox is the tile-aligned extent
 * (always at least as large as the requested bbox).
 *
 * @param clampOcean   Elevations below -100 m are clamped to 0 (deep ocean → flat).
 */
export async function loadMultiTileDEM(
  bbox: BBox,
  zoom: number,
  {
    clampOcean = true,
    signal,
    onProgress,
  }: {
    clampOcean?: boolean;
    signal?: AbortSignal;
    /** Called as each tile settles, so the UI can show real progress. */
    onProgress?: (loaded: number, total: number) => void;
  } = {},
): Promise<ElevationGrid> {
  const range = tileRangeForBBox(bbox, zoom);
  const tilesX = range.x1 - range.x0 + 1;
  const tilesY = range.y1 - range.y0 + 1;

  const totalW = tilesX * TILE_PX;
  const totalH = tilesY * TILE_PX;
  const stitched = new Float32Array(totalW * totalH);

  const total = tilesX * tilesY;
  let settled = 0;
  onProgress?.(0, total);

  const promises: Promise<{ tx: number; ty: number; imgData: ImageData | null }>[] = [];
  for (let ty = range.y0; ty <= range.y1; ty++) {
    for (let tx = range.x0; tx <= range.x1; tx++) {
      promises.push(
        loadTerrainTile(zoom, tx, ty, signal)
          .then((imgData) => ({ tx, ty, imgData }))
          .catch(() => ({ tx, ty, imgData: null }))
          .then((result) => {
            settled++;
            if (!signal?.aborted) onProgress?.(settled, total);
            return result;
          }),
      );
    }
  }

  const results = await Promise.all(promises);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  let loaded = 0;
  for (const { tx, ty, imgData } of results) {
    if (!imgData) continue;
    loaded++;
    const offX = (tx - range.x0) * TILE_PX;
    const offY = (ty - range.y0) * TILE_PX;

    for (let row = 0; row < TILE_PX; row++) {
      const dstRow = (offY + row) * totalW + offX;
      const srcRow = row * TILE_PX * 4;
      for (let col = 0; col < TILE_PX; col++) {
        const s = srcRow + col * 4;
        let elev = decodeTerrarium(imgData.data[s], imgData.data[s + 1], imgData.data[s + 2]);
        if (clampOcean && elev < -100) elev = 0;
        stitched[dstRow + col] = elev;
      }
    }
  }

  if (loaded === 0) {
    throw new Error('No terrain tiles could be loaded for this region.');
  }

  const gridBBox = tileRangeBounds(range);
  const latSpan = gridBBox.north - gridBBox.south;

  return {
    width: totalW,
    height: totalH,
    data: stitched,
    bbox: gridBBox,
    noDataValue: TERRARIUM_NO_DATA,
    resolution: (latSpan / totalH) * 111320,
    tileRange: range,
  };
}

/* ================================================================== */
/*  Sampling & statistics                                              */
/* ================================================================== */

/** Bilinear sample at fractional pixel coordinates. Returns null on no-data. */
export function sampleGridPixel(
  grid: ElevationGrid,
  px: number,
  py: number,
): number | null {
  const { width, height, data, noDataValue } = grid;
  if (px < 0 || px > width - 1 || py < 0 || py > height - 1) return null;

  const x0 = Math.floor(px);
  const x1 = Math.min(x0 + 1, width - 1);
  const y0 = Math.floor(py);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = px - x0;
  const fy = py - y0;

  const v00 = data[y0 * width + x0];
  const v10 = data[y0 * width + x1];
  const v01 = data[y1 * width + x0];
  const v11 = data[y1 * width + x1];
  if (v00 === noDataValue || v10 === noDataValue || v01 === noDataValue || v11 === noDataValue) {
    return null;
  }
  return (
    v00 * (1 - fx) * (1 - fy) +
    v10 * fx * (1 - fy) +
    v01 * (1 - fx) * fy +
    v11 * fx * fy
  );
}

/** Bilinear elevation at a lon/lat inside the grid's bbox. Returns null outside / no-data. */
export function sampleElevation(
  grid: ElevationGrid,
  lon: number,
  lat: number,
): number | null {
  const { width, height, bbox } = grid;
  const px = ((lon - bbox.west) / (bbox.east - bbox.west)) * (width - 1);
  const py = ((bbox.north - lat) / (bbox.north - bbox.south)) * (height - 1);
  return sampleGridPixel(grid, px, py);
}

/**
 * Min / max / mean over valid cells, optionally restricted to the part of the
 * grid inside `within` (the grid is tile-aligned and usually larger than the
 * user's selection).
 */
export function gridStats(
  grid: ElevationGrid,
  within?: BBox,
): { min: number; max: number; mean: number } {
  const { data, noDataValue, width, height, bbox } = grid;

  let c0 = 0;
  let c1 = width - 1;
  let r0 = 0;
  let r1 = height - 1;
  if (within) {
    const lonSpan = bbox.east - bbox.west;
    const latSpan = bbox.north - bbox.south;
    c0 = Math.max(0, Math.floor(((within.west - bbox.west) / lonSpan) * (width - 1)));
    c1 = Math.min(width - 1, Math.ceil(((within.east - bbox.west) / lonSpan) * (width - 1)));
    r0 = Math.max(0, Math.floor(((bbox.north - within.north) / latSpan) * (height - 1)));
    r1 = Math.min(height - 1, Math.ceil(((bbox.north - within.south) / latSpan) * (height - 1)));
  }

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (let r = r0; r <= r1; r++) {
    const rowOff = r * width;
    for (let c = c0; c <= c1; c++) {
      const v = data[rowOff + c];
      if (v === noDataValue) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      count++;
    }
  }
  if (count === 0) return { min: 0, max: 0, mean: 0 };
  return { min, max, mean: sum / count };
}

/** Approximate area of a geographic bbox in km². */
export function bboxAreaKm2(b: BBox): number {
  const midLat = ((b.north + b.south) / 2) * (Math.PI / 180);
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.cos(midLat);
  return (b.east - b.west) * kmPerDegLon * (b.north - b.south) * kmPerDegLat;
}
