/**
 * A keyless global terrain provider for the Cesium globe.
 *
 * Cesium World Terrain needs an Ion token. Without one the globe falls back to
 * a perfectly smooth ellipsoid — no relief, and, because the fallback is
 * silent, no sign that anything is missing. This provider closes that gap
 * using the same free AWS Terrain Tiles (Terrarium PNGs) the Terrain view
 * already draws from, so the globe has real elevation out of the box.
 *
 * Terrarium tiles are Web Mercator XYZ, so the provider is given a
 * `WebMercatorTilingScheme` and Cesium's (x, y, level) map one-to-one onto
 * slippy tile coordinates. Above `MAX_SOURCE_ZOOM` the source has nothing
 * more to give, so a parent tile is resampled over the sub-window the
 * requested tile covers — the mesh keeps subdividing, it just stops gaining
 * new detail, which is what every raster-backed terrain source does.
 */

import {
  Credit,
  CustomHeightmapTerrainProvider,
  WebMercatorTilingScheme,
} from 'cesium';
import { decodeTerrarium, loadTerrainTile } from '@/lib/terrain/demLoader';

/** Highest zoom AWS Terrain Tiles publishes. */
const MAX_SOURCE_ZOOM = 15;

/** Samples per tile edge handed back to Cesium. 65 is Cesium's own default. */
const HEIGHTMAP_SIZE = 65;

/** Source tile edge in pixels. */
const TILE_PX = 256;

/** Decoded tiles kept in memory. Each is 256 KB as a Float32Array. */
const CACHE_LIMIT = 160;

const cache = new Map<string, Float32Array>();
const inflight = new Map<string, Promise<Float32Array | null>>();

/** Elevations for one source tile, row-major, `TILE_PX²` samples. */
async function sourceTile(z: number, x: number, y: number): Promise<Float32Array | null> {
  const key = `${z}/${x}/${y}`;

  const cached = cache.get(key);
  if (cached) {
    // Refresh LRU position.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = loadTerrainTile(z, x, y)
    .then((image) => {
      const { data, width, height } = image;
      const heights = new Float32Array(width * height);
      for (let i = 0; i < heights.length; i++) {
        const o = i * 4;
        heights[i] = decodeTerrarium(data[o], data[o + 1], data[o + 2]);
      }
      cache.set(key, heights);
      while (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return heights;
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, task);
  return task;
}

/** Drop every cached tile — call when tearing the globe down. */
export function clearTerrariumCache(): void {
  cache.clear();
}

/**
 * Bilinear sample of a source tile over a normalised sub-window.
 * `u`/`v` run 0→1 across the window, which itself covers
 * `[offX, offX + span] × [offY, offY + span]` of the tile.
 */
function sampleWindow(
  tile: Float32Array,
  offX: number,
  offY: number,
  span: number,
  u: number,
  v: number,
): number {
  const fx = (offX + u * span) * (TILE_PX - 1);
  const fy = (offY + v * span) * (TILE_PX - 1);

  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, TILE_PX - 1);
  const y1 = Math.min(y0 + 1, TILE_PX - 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const a = tile[y0 * TILE_PX + x0];
  const b = tile[y0 * TILE_PX + x1];
  const c = tile[y1 * TILE_PX + x0];
  const d = tile[y1 * TILE_PX + x1];

  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * Build the provider. Tiles that fail to load resolve to sea level rather
 * than rejecting, so one 404 over the ocean never stalls the globe.
 */
export function createTerrariumTerrainProvider(): CustomHeightmapTerrainProvider {
  return new CustomHeightmapTerrainProvider({
    width: HEIGHTMAP_SIZE,
    height: HEIGHTMAP_SIZE,
    tilingScheme: new WebMercatorTilingScheme(),
    credit: new Credit(
      'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a>',
      true,
    ),
    callback: async (x: number, y: number, level: number) => {
      const out = new Float32Array(HEIGHTMAP_SIZE * HEIGHTMAP_SIZE);

      const sourceZ = Math.min(level, MAX_SOURCE_ZOOM);
      const shift = level - sourceZ;
      const tile = await sourceTile(sourceZ, x >> shift, y >> shift);
      if (!tile) return out; // sea level — better than a stalled tile queue

      // Where inside the parent tile this tile sits (both 0 when shift === 0).
      const divisions = 1 << shift;
      const span = 1 / divisions;
      const offX = (x - ((x >> shift) << shift)) * span;
      const offY = (y - ((y >> shift) << shift)) * span;

      for (let row = 0; row < HEIGHTMAP_SIZE; row++) {
        const v = row / (HEIGHTMAP_SIZE - 1);
        for (let col = 0; col < HEIGHTMAP_SIZE; col++) {
          const u = col / (HEIGHTMAP_SIZE - 1);
          const h = sampleWindow(tile, offX, offY, span, u, v);
          // Terrarium encodes deep ocean as large negatives; flatten them so
          // coastlines do not fall into a pit.
          out[row * HEIGHTMAP_SIZE + col] = h < -100 ? 0 : h;
        }
      }
      return out;
    },
  });
}
