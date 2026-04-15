/**
 * DEM (Digital Elevation Model) loading utilities.
 *
 * Supports:
 *  - AWS Terrain Tiles (Terrarium PNG encoding, free, global, ~30m near equator)
 *  - Local / remote GeoTIFF rasters (e.g. OpenTopography SRTM GL1)
 *
 * These functions use browser APIs (fetch, OffscreenCanvas) and must be
 * called from client code. Importing this module from a Server Component
 * won't error — it will only fail at call time if the APIs are missing.
 */

import { fromArrayBuffer } from 'geotiff';
import type { BBox, ElevationGrid } from '@/types/geo';
import { TILE_URLS } from '@/lib/constants';

const TERRARIUM_NO_DATA = -32768;

/**
 * Fetch a Terrarium-encoded terrain tile from AWS Terrain Tiles and
 * decode it into raw `ImageData` (RGBA pixel buffer).
 *
 * Terrarium encoding:
 *   elevation (m) = (r * 256 + g + b / 256) - 32768
 *
 * See: https://github.com/tilezen/joerd/blob/master/docs/formats.md
 */
export async function loadTerrainTile(
  z: number,
  x: number,
  y: number,
): Promise<ImageData> {
  const url = TILE_URLS.terrain
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to load terrain tile ${z}/${x}/${y}: ${response.status} ${response.statusText}`,
    );
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D context from OffscreenCanvas');
  }
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

/**
 * Decode a single Terrarium RGB pixel to elevation in meters.
 */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Convert a decoded RGBA `ImageData` buffer into an `ElevationGrid`.
 * The input bbox describes the geographic extent of the tile.
 */
export function tileToElevationGrid(
  imageData: ImageData,
  bbox: BBox,
): ElevationGrid {
  const { width, height, data } = imageData;
  const elevations = new Float32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    elevations[i] = decodeTerrarium(r, g, b);
  }

  const latSpan = bbox.north - bbox.south;
  // Approximate meters per pixel at tile latitude.
  // 1° of latitude ≈ 111320 m on the WGS84 ellipsoid.
  const resolution = (latSpan / height) * 111320;

  return {
    width,
    height,
    data: elevations,
    bbox,
    noDataValue: TERRARIUM_NO_DATA,
    resolution,
  };
}

/**
 * Load a GeoTIFF DEM from a URL (e.g. OpenTopography export, local asset)
 * and return it as an `ElevationGrid`.
 *
 * Reads the first raster band. Multi-band GeoTIFFs (RGB, multispectral)
 * should use a dedicated loader.
 */
export async function loadGeoTiffDEM(url: string): Promise<ElevationGrid> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to load GeoTIFF ${url}: ${response.status} ${response.statusText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const tiff = await fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();

  const width = image.getWidth();
  const height = image.getHeight();

  const rasters = await image.readRasters();
  // readRasters returns an array of typed arrays, one per band.
  const firstBand = rasters[0] as ArrayLike<number>;

  const [west, south, east, north] = image.getBoundingBox();

  return {
    width,
    height,
    data: new Float32Array(firstBand),
    bbox: { west, south, east, north },
    noDataValue: image.getGDALNoData() ?? -9999,
    resolution: ((east - west) / width) * 111320,
  };
}

/**
 * Convert geographic coordinates to slippy-map (XYZ) tile indices.
 * Uses the standard Web Mercator tiling scheme.
 */
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

/* ================================================================== */
/*  Multi-tile stitching                                               */
/* ================================================================== */

/** Geographic extent of a Web-Mercator XYZ tile. */
function tileBounds(x: number, y: number, z: number): BBox {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const nRad = Math.PI - (2 * Math.PI * y) / n;
  const sRad = Math.PI - (2 * Math.PI * (y + 1)) / n;
  const north = (180 / Math.PI) * Math.atan(Math.sinh(nRad));
  const south = (180 / Math.PI) * Math.atan(Math.sinh(sRad));
  return { west, east, north, south };
}

/**
 * Load **all** terrain tiles that cover a bounding box and stitch
 * them into a single `ElevationGrid`.
 *
 * This is the key function for accurate rendering: instead of a
 * single 256×256 tile, we fetch a grid of tiles (e.g. 3×3 at z=11
 * → 768×768 pixels) covering the full bbox.
 *
 * @param bbox         Geographic extent to cover.
 * @param zoom         Tile zoom level (higher = more detail, more tiles).
 * @param clampOcean   If true, elevations ≤ 0 in ocean areas are clamped to 0.
 */
export async function loadMultiTileDEM(
  bbox: BBox,
  zoom: number,
  clampOcean = true,
): Promise<ElevationGrid> {
  // Tile range covering the bbox
  const tl = latLonToTile(bbox.north, bbox.west, zoom);
  const br = latLonToTile(bbox.south, bbox.east, zoom);

  const tilesX = br.x - tl.x + 1;
  const tilesY = br.y - tl.y + 1;
  const TILE_PX = 256;

  // Total stitched dimensions
  const totalW = tilesX * TILE_PX;
  const totalH = tilesY * TILE_PX;
  const stitched = new Float32Array(totalW * totalH);

  // Fetch all tiles in parallel
  const promises: Promise<{ tx: number; ty: number; imgData: ImageData | null }>[] = [];
  for (let ty = tl.y; ty <= br.y; ty++) {
    for (let tx = tl.x; tx <= br.x; tx++) {
      promises.push(
        loadTerrainTile(zoom, tx, ty)
          .then((imgData) => ({ tx, ty, imgData }))
          .catch(() => ({ tx, ty, imgData: null })),
      );
    }
  }

  const results = await Promise.all(promises);

  // Stitch tile pixels into the combined grid
  for (const { tx, ty, imgData } of results) {
    if (!imgData) continue;
    const offX = (tx - tl.x) * TILE_PX;
    const offY = (ty - tl.y) * TILE_PX;

    for (let row = 0; row < TILE_PX; row++) {
      for (let col = 0; col < TILE_PX; col++) {
        const srcIdx = (row * TILE_PX + col) * 4;
        const r = imgData.data[srcIdx];
        const g = imgData.data[srcIdx + 1];
        const b = imgData.data[srcIdx + 2];
        let elev = decodeTerrarium(r, g, b);
        if (clampOcean && elev < -100) elev = 0; // deep ocean → flat
        stitched[(offY + row) * totalW + (offX + col)] = elev;
      }
    }
  }

  // The actual geographic extent of the stitched grid
  const topLeft = tileBounds(tl.x, tl.y, zoom);
  const bottomRight = tileBounds(br.x, br.y, zoom);
  const gridBBox: BBox = {
    west: topLeft.west,
    east: bottomRight.east,
    north: topLeft.north,
    south: bottomRight.south,
  };

  const latSpan = gridBBox.north - gridBBox.south;

  return {
    width: totalW,
    height: totalH,
    data: stitched,
    bbox: gridBBox,
    noDataValue: TERRARIUM_NO_DATA,
    resolution: (latSpan / totalH) * 111320,
  };
}
