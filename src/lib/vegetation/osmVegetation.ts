/**
 * Fetch and reconstruct vegetation from OpenStreetMap.
 *
 * Surveyed trees (`natural=tree`) are used as mapped. Tree rows are stepped
 * along their way. Wooded *areas* have no individual trees in OSM, so trunks
 * are scattered inside the polygon at a density chosen per tag — dense for
 * `natural=wood`, sparse for a park lawn — using a seeded RNG so the same
 * region always regrows the same wood. Scattered trees are labelled as such
 * everywhere they surface in the UI.
 *
 * Heights come from `height` when tagged, otherwise from `circumference` via
 * the standard trunk-diameter/height relation, otherwise from the species'
 * broad class.
 */

import type { BBox } from '@/types/geo';
import type {
  CanopyArea,
  TreeInstance,
  TreeKind,
  VegetationData,
} from '@/types/vegetation';
import { EMPTY_VEGETATION } from '@/types/vegetation';
import { parseLength } from '@/lib/buildings/osmFetcher';

/** One Overpass element, as far as this module reads it. */
export interface VegetationElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

/** Hard cap: beyond this the scene costs more than it shows. */
const MAX_TREES = 12_000;

/** Metres between trees in a `natural=tree_row` when untagged. */
const ROW_SPACING_M = 8;

/** Trees per hectare by vegetation tag. */
const DENSITY: Record<string, number> = {
  'natural=wood': 220,
  'landuse=forest': 200,
  'natural=scrub': 120,
  'landuse=orchard': 150,
  'landuse=vineyard': 0, // rows of vines, not trees
  'leisure=park': 45,
  'leisure=garden': 40,
  'landuse=grass': 8,
  'landuse=meadow': 4,
  'landuse=village_green': 25,
  'leisure=recreation_ground': 15,
  'landuse=cemetery': 30,
  'landuse=allotments': 12,
};

/** Canopy class by tag, before any species hint refines it. */
const AREA_KIND: Record<string, TreeKind> = {
  'natural=scrub': 'shrub',
  'landuse=vineyard': 'shrub',
  'landuse=orchard': 'broadleaf',
};

const NEEDLELEAF = /pinus|picea|abies|larix|cedrus|juniper|cupress|thuja|taxus|pine|spruce|fir|larch|cedar|conifer/i;
const PALM = /palm|phoenix|washingtonia|arecaceae|cocos|trachycarpus/i;

/** Typical mature heights, metres. */
const DEFAULT_HEIGHT: Record<TreeKind, number> = {
  broadleaf: 12,
  needleleaf: 16,
  palm: 10,
  shrub: 2.5,
};

/** Canopy radius as a fraction of height. */
const CROWN_RATIO: Record<TreeKind, number> = {
  broadleaf: 0.34,
  needleleaf: 0.2,
  palm: 0.28,
  shrub: 0.45,
};

/* ================================================================== */
/*  Deterministic RNG (mulberry32) — same region, same wood            */
/* ================================================================== */

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ================================================================== */
/*  Tag reading                                                        */
/* ================================================================== */

function kindOf(tags: Record<string, string>, fallback: TreeKind): TreeKind {
  const leaf = tags['leaf_type'];
  if (leaf === 'needleleaved') return 'needleleaf';
  if (leaf === 'broadleaved') return 'broadleaf';

  const species = `${tags['species'] ?? ''} ${tags['genus'] ?? ''} ${tags['taxon'] ?? ''}`;
  if (PALM.test(species)) return 'palm';
  if (NEEDLELEAF.test(species)) return 'needleleaf';
  return fallback;
}

/**
 * Height in metres. `height` wins; otherwise a trunk circumference gives a
 * decent estimate via H ≈ 25·√(d) for d in metres, the usual allometric
 * shorthand for mature temperate trees.
 */
function heightOf(tags: Record<string, string>, kind: TreeKind): number {
  const tagged = parseLength(tags['height']);
  if (tagged !== undefined && tagged > 0.5 && tagged < 120) return tagged;

  const circumference = parseLength(tags['circumference']);
  if (circumference !== undefined && circumference > 0.05) {
    const diameter = circumference / Math.PI;
    return Math.min(45, Math.max(3, 25 * Math.sqrt(diameter)));
  }
  return DEFAULT_HEIGHT[kind];
}

/** Which vegetation tag an element carries, as `key=value`, if any. */
function vegetationTag(tags: Record<string, string>): string | null {
  for (const key of ['natural', 'landuse', 'leisure']) {
    const value = tags[key];
    if (value && `${key}=${value}` in DENSITY) return `${key}=${value}`;
  }
  return null;
}

/* ================================================================== */
/*  Geometry helpers                                                   */
/* ================================================================== */

type Ring = Array<[number, number]>;

function ringOf(geometry: Array<{ lat: number; lon: number }>): Ring {
  return geometry.map((g) => [g.lon, g.lat] as [number, number]);
}

function boundsOf(ring: Ring): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function contains(ring: Ring, px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ring area in hectares. */
function areaHa(ring: Ring): number {
  let sum = 0;
  const cosLat = Math.cos((ring[0][1] * Math.PI) / 180);
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    sum += x0 * cosLat * y1 - x1 * cosLat * y0;
  }
  return (Math.abs(sum / 2) * 111320 * 111320) / 10_000;
}

/* ================================================================== */
/*  Fetch                                                              */
/* ================================================================== */

/**
 * Fetch vegetation for a bbox and turn it into placeable trees.
 * Throws on network / HTTP failure; returns empty data when nothing is mapped.
 */
export async function fetchVegetation(
  bbox: BBox,
  signal?: AbortSignal,
): Promise<VegetationData> {
  const { south, west, north, east } = bbox;
  const b = `${south},${west},${north},${east}`;

  const query = `
    [out:json][timeout:45];
    (
      node["natural"="tree"](${b});
      way["natural"="tree_row"](${b});
      way["natural"~"^(wood|scrub)$"](${b});
      way["landuse"~"^(forest|orchard|vineyard|grass|meadow|village_green|cemetery|allotments)$"](${b});
      way["leisure"~"^(park|garden|recreation_ground)$"](${b});
    );
    out geom;
  `;

  const response = await fetch('/api/proxy/overpass', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { elements: VegetationElement[] };
  return buildVegetation(data.elements, bbox);
}

/**
 * Turn Overpass elements into trees. Split out from the fetch so it can be
 * exercised directly by the check harness.
 */
export function buildVegetation(elements: VegetationElement[], bbox: BBox): VegetationData {
  const trees: TreeInstance[] = [];
  const areas: CanopyArea[] = [];
  const counts = { surveyed: 0, row: 0, scattered: 0 };

  // Seeded from the region so panning back gives the same wood.
  const seed = Math.round((bbox.west + 180) * 4096) ^ Math.round((bbox.south + 90) * 4096);
  const rng = makeRng(seed || 1);

  const polygons: Array<{ ring: Ring; tags: Record<string, string>; tag: string }> = [];

  for (const el of elements) {
    const tags = el.tags;
    if (!tags) continue;

    /* ---- Surveyed trees ---- */
    if (el.type === 'node' && tags['natural'] === 'tree') {
      if (el.lat === undefined || el.lon === undefined) continue;
      const kind = kindOf(tags, 'broadleaf');
      const height = heightOf(tags, kind);
      trees.push({
        lon: el.lon,
        lat: el.lat,
        height,
        radius: Math.max(0.6, height * CROWN_RATIO[kind]),
        kind,
        source: 'surveyed',
        variation: rng(),
      });
      counts.surveyed++;
      continue;
    }

    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;

    /* ---- Tree rows ---- */
    if (tags['natural'] === 'tree_row') {
      const kind = kindOf(tags, 'broadleaf');
      const height = heightOf(tags, kind);
      const spacing = parseLength(tags['spacing']) ?? ROW_SPACING_M;
      const points = ringOf(el.geometry);

      let carry = 0;
      for (let i = 0; i < points.length - 1; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[i + 1];
        const cosLat = Math.cos((y0 * Math.PI) / 180);
        const dx = (x1 - x0) * cosLat * 111320;
        const dy = (y1 - y0) * 111320;
        const segment = Math.hypot(dx, dy);
        if (segment < 0.01) continue;

        for (let d = carry; d < segment; d += spacing) {
          const t = d / segment;
          trees.push({
            lon: x0 + (x1 - x0) * t,
            lat: y0 + (y1 - y0) * t,
            height: height * (0.85 + rng() * 0.3),
            radius: Math.max(0.6, height * CROWN_RATIO[kind]),
            kind,
            source: 'row',
            variation: rng(),
          });
          counts.row++;
          if (trees.length >= MAX_TREES) break;
        }
        carry = Math.max(0, spacing - ((segment - carry) % spacing));
        if (trees.length >= MAX_TREES) break;
      }
      continue;
    }

    /* ---- Wooded areas ---- */
    const tag = vegetationTag(tags);
    if (!tag || el.geometry.length < 4) continue;
    polygons.push({ ring: ringOf(el.geometry), tags, tag });
  }

  /* ---- Scatter trees through the areas, largest first ---- */

  polygons.sort((a, b) => areaHa(b.ring) - areaHa(a.ring));

  for (const { ring, tags, tag } of polygons) {
    const hectares = areaHa(ring);
    if (hectares <= 0) continue;

    const density = DENSITY[tag] ?? 0;
    const kind = kindOf(tags, AREA_KIND[tag] ?? 'broadleaf');
    areas.push({ ring, kind, density, tag });
    if (density === 0) continue;

    const wanted = Math.min(Math.round(hectares * density), MAX_TREES - trees.length);
    if (wanted <= 0) continue;

    const [minX, minY, maxX, maxY] = boundsOf(ring);
    const baseHeight = heightOf(tags, kind);

    // Rejection sampling: cheap, and it keeps trees inside concave outlines.
    // The attempt budget stops a sliver polygon spinning forever.
    let placed = 0;
    let attempts = 0;
    const budget = wanted * 12 + 80;

    while (placed < wanted && attempts < budget) {
      attempts++;
      const lon = minX + rng() * (maxX - minX);
      const lat = minY + rng() * (maxY - minY);
      if (!contains(ring, lon, lat)) continue;

      const height = baseHeight * (0.7 + rng() * 0.6);
      trees.push({
        lon,
        lat,
        height,
        radius: Math.max(0.5, height * CROWN_RATIO[kind]),
        kind,
        source: 'scattered',
        variation: rng(),
      });
      counts.scattered++;
      placed++;
    }

    if (trees.length >= MAX_TREES) break;
  }

  return trees.length === 0 && areas.length === 0 ? EMPTY_VEGETATION : { trees, areas, counts };
}
