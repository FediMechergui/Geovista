/**
 * Tile-based progressive terrain loader with LOD support.
 *
 * Splits a BBox into a grid of sub-tiles, fetching the closest
 * (highest-zoom) tile first for the viewport center, then
 * progressively loading surrounding tiles.
 *
 * LOD strategy:
 *   - Near camera:   zoom 12 (~30m resolution)
 *   - Mid range:     zoom 10 (~120m)
 *   - Distant tiles: zoom 8  (~500m)
 */

import type { BBox, ElevationGrid } from "@/types/geo";
import {
  latLonToTile,
  loadTerrainTile,
  tileToElevationGrid,
} from "./demLoader";

/* ------------------------------------------------------------------ */
/*  LOD helpers                                                        */
/* ------------------------------------------------------------------ */

export type LODLevel = "high" | "medium" | "low";

const LOD_ZOOM: Record<LODLevel, number> = {
  high: 12,
  medium: 10,
  low: 8,
};

/**
 * Determine the LOD level for a tile based on its distance (in tiles)
 * from the center of the requested area.
 */
function lodForDistance(distTiles: number, totalTiles: number): LODLevel {
  const ratio = distTiles / Math.max(totalTiles, 1);
  if (ratio < 0.3) return "high";
  if (ratio < 0.65) return "medium";
  return "low";
}

/* ------------------------------------------------------------------ */
/*  Tile math                                                          */
/* ------------------------------------------------------------------ */

function tileBBox(x: number, y: number, z: number): BBox {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  const n2 = Math.PI - (2 * Math.PI * (y + 1)) / 2 ** z;
  return {
    west: (x / 2 ** z) * 360 - 180,
    east: ((x + 1) / 2 ** z) * 360 - 180,
    north: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
    south: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n2) - Math.exp(-n2))),
  };
}

/* ------------------------------------------------------------------ */
/*  Progressive loader                                                 */
/* ------------------------------------------------------------------ */

export interface TileResult {
  grid: ElevationGrid;
  lod: LODLevel;
  tileX: number;
  tileY: number;
  zoom: number;
}

/**
 * Progressively load terrain tiles for a bounding box.
 * Calls `onTile` for each tile as it becomes available, starting
 * from the center and spiraling outward.
 */
export async function loadTerrainProgressive(
  bbox: BBox,
  onTile: (result: TileResult) => void,
  options: { baseZoom?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const baseZoom = options.baseZoom ?? 10;
  const centerLat = (bbox.north + bbox.south) / 2;
  const centerLon = (bbox.west + bbox.east) / 2;

  // Compute tile range at base zoom
  const tl = latLonToTile(bbox.north, bbox.west, baseZoom);
  const br = latLonToTile(bbox.south, bbox.east, baseZoom);
  const centerTile = latLonToTile(centerLat, centerLon, baseZoom);

  // Build tile list sorted by distance from center
  const tiles: { x: number; y: number; dist: number }[] = [];
  for (let ty = tl.y; ty <= br.y; ty++) {
    for (let tx = tl.x; tx <= br.x; tx++) {
      const dist = Math.abs(tx - centerTile.x) + Math.abs(ty - centerTile.y);
      tiles.push({ x: tx, y: ty, dist });
    }
  }
  tiles.sort((a, b) => a.dist - b.dist);

  const maxDist = tiles.length > 0 ? tiles[tiles.length - 1].dist : 0;

  // Load tiles in order (center first)
  for (const tile of tiles) {
    if (options.signal?.aborted) return;

    const lod = lodForDistance(tile.dist, maxDist);
    const zoom = LOD_ZOOM[lod];

    // Re-map tile coords to the chosen LOD zoom
    const scale = 2 ** (zoom - baseZoom);
    const tx = Math.floor(tile.x * scale);
    const ty = Math.floor(tile.y * scale);

    try {
      const imgData = await loadTerrainTile(zoom, tx, ty);
      const tBBox = tileBBox(tx, ty, zoom);
      const grid = tileToElevationGrid(imgData, tBBox);

      onTile({ grid, lod, tileX: tx, tileY: ty, zoom });
    } catch {
      // Skip failed tiles silently — may be ocean or outside coverage
    }
  }
}
