/**
 * OSM Land-Use / Land-Cover fetcher + canvas rasterizer.
 *
 * Fetches real land-use data from OpenStreetMap via Overpass API, then
 * rasterizes it onto an OffscreenCanvas that can be used as a Three.js
 * texture draped over the terrain mesh.
 *
 * Categories rendered (in draw order — later ones paint on top):
 *   water, wetland, forest/wood, grass/meadow, farmland/orchard,
 *   residential, commercial/industrial, roads, sand/beach/desert
 */

import type { BBox } from '@/types/geo';

/* ================================================================== */
/*  Color palette — realistic biome / land-use colors                  */
/* ================================================================== */

/** Land-use category → fill color (CSS). */
const LANDUSE_COLORS: Record<string, string> = {
  // Water
  water: '#5b9bd5',
  wetland: '#7ab8a8',
  basin: '#6aaed6',
  reservoir: '#5b9bd5',

  // Vegetation
  forest: '#2d6a2d',
  wood: '#3a7a3a',
  grass: '#7cb950',
  meadow: '#8ec665',
  scrub: '#6b9e4a',
  heath: '#9ab86e',
  orchard: '#91b855',
  vineyard: '#8aad50',
  farmland: '#c8d68e',
  farm: '#c8d68e',
  allotments: '#b8cc7a',

  // Built-up
  residential: '#d4c4a8',
  commercial: '#c4b8a8',
  industrial: '#bab0a0',
  retail: '#c8b8a4',
  construction: '#c8c0b0',

  // Special
  sand: '#e8ddb5',
  beach: '#f0e6c8',
  desert: '#e0d4a8',
  bare_rock: '#bbb5a8',
  quarry: '#a8a098',
  cemetery: '#aac4a0',
  park: '#88c565',
  recreation_ground: '#80c060',
  garden: '#7cb855',
  military: '#8a907a',

  // Transport
  aerodrome: '#c0c0c0',
  railway: '#888888',
  parking: '#c0bab0',
};

/** Road type → { color, width in pixels at 1024 texture }. */
const ROAD_STYLES: Record<string, { color: string; width: number }> = {
  motorway: { color: '#e07040', width: 5 },
  trunk: { color: '#e08050', width: 4 },
  primary: { color: '#e8a060', width: 3.5 },
  secondary: { color: '#e8c060', width: 3 },
  tertiary: { color: '#f0e070', width: 2.5 },
  residential: { color: '#cccccc', width: 2 },
  service: { color: '#cccccc', width: 1.5 },
  unclassified: { color: '#cccccc', width: 2 },
  track: { color: '#b8a888', width: 1.5 },
  path: { color: '#c8b898', width: 1 },
  footway: { color: '#d0c8b8', width: 1 },
  cycleway: { color: '#b0d0e0', width: 1 },
};

/** Waterway type → line width in pixels at 1024 texture. */
const WATERWAY_WIDTHS: Record<string, number> = {
  river: 4,
  canal: 3,
  stream: 2,
  drain: 1.5,
  ditch: 1,
};

/* ================================================================== */
/*  Overpass query                                                     */
/* ================================================================== */

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  members?: Array<{ type: string; ref: number; role: string }>;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

/**
 * Fetch land-use polygons, roads, waterways, and natural features from OSM.
 * Uses `out geom` to get node coordinates inline (no separate node lookup).
 */
export async function fetchLandUse(bbox: BBox): Promise<OverpassResponse> {
  const { south, west, north, east } = bbox;
  const b = `${south},${west},${north},${east}`;

  // Query for polygons (areas) and linestrings (roads, waterways)
  const query = `
    [out:json][timeout:45];
    (
      way["landuse"](${b});
      relation["landuse"](${b});
      way["natural"~"water|wood|scrub|heath|sand|beach|bare_rock|wetland|grassland"](${b});
      relation["natural"~"water|wood|scrub|heath|sand|beach|bare_rock|wetland|grassland"](${b});
      way["leisure"~"park|garden|recreation_ground"](${b});
      way["waterway"~"river|canal|stream|drain|ditch"](${b});
      way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|service|unclassified|track|path|footway|cycleway"](${b});
    );
    out geom;
  `;

  const response = await fetch('/api/proxy/overpass', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`);
  }

  return (await response.json()) as OverpassResponse;
}

/* ================================================================== */
/*  Canvas rasterizer                                                  */
/* ================================================================== */

/**
 * Rasterize OSM land-use data onto a canvas texture.
 *
 * @param data        Overpass response with geometry.
 * @param bbox        Geographic extent matching the terrain mesh.
 * @param resolution  Texture size in pixels (default 1024×1024).
 * @returns           An `OffscreenCanvas` ready to be used as a Three.js texture source.
 */
export function rasterizeLandUse(
  data: OverpassResponse,
  bbox: BBox,
  resolution: number = 1024,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(resolution, resolution);
  const ctx = canvas.getContext('2d')!;

  // Base fill — a muted green/brown for unmapped terrain
  ctx.fillStyle = '#8aab6e';
  ctx.fillRect(0, 0, resolution, resolution);

  const lonSpan = bbox.east - bbox.west;
  const latSpan = bbox.north - bbox.south;

  /** Convert geo lon → canvas X. */
  const toX = (lon: number) => ((lon - bbox.west) / lonSpan) * resolution;
  /** Convert geo lat → canvas Y (north = top = Y=0). */
  const toY = (lat: number) => ((bbox.north - lat) / latSpan) * resolution;

  // Sort elements: areas first (by size descending roughly), then lines on top
  const areas: OverpassElement[] = [];
  const waterways: OverpassElement[] = [];
  const roads: OverpassElement[] = [];

  for (const el of data.elements) {
    const tags = el.tags ?? {};
    if (tags.highway) {
      roads.push(el);
    } else if (tags.waterway) {
      waterways.push(el);
    } else {
      areas.push(el);
    }
  }

  // ---------- 1. Draw area polygons ----------

  for (const el of areas) {
    const geom = el.geometry;
    if (!geom || geom.length < 3) continue;

    const tags = el.tags ?? {};
    const category =
      tags.landuse ??
      tags.natural ??
      tags.leisure ??
      tags['natural'] ??
      'unknown';

    const color = LANDUSE_COLORS[category];
    if (!color) continue;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(toX(geom[0].lon), toY(geom[0].lat));
    for (let i = 1; i < geom.length; i++) {
      ctx.lineTo(toX(geom[i].lon), toY(geom[i].lat));
    }
    ctx.closePath();
    ctx.fill();
  }

  // ---------- 2. Draw waterways ----------

  for (const el of waterways) {
    const geom = el.geometry;
    if (!geom || geom.length < 2) continue;

    const wwType = el.tags?.waterway ?? 'stream';
    const width = WATERWAY_WIDTHS[wwType] ?? 1.5;

    ctx.strokeStyle = '#5b9bd5';
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(toX(geom[0].lon), toY(geom[0].lat));
    for (let i = 1; i < geom.length; i++) {
      ctx.lineTo(toX(geom[i].lon), toY(geom[i].lat));
    }
    ctx.stroke();
  }

  // ---------- 3. Draw roads (on top) ----------

  // Draw roads from smallest to largest so major roads are on top
  const roadOrder = [
    'path', 'footway', 'cycleway', 'track', 'service',
    'unclassified', 'residential', 'tertiary', 'secondary',
    'primary', 'trunk', 'motorway',
  ];

  roads.sort((a, b) => {
    const ai = roadOrder.indexOf(a.tags?.highway ?? '');
    const bi = roadOrder.indexOf(b.tags?.highway ?? '');
    return ai - bi;
  });

  for (const el of roads) {
    const geom = el.geometry;
    if (!geom || geom.length < 2) continue;

    const hwType = el.tags?.highway ?? 'residential';
    const style = ROAD_STYLES[hwType] ?? ROAD_STYLES.residential;

    // Dark outline
    ctx.strokeStyle = '#444444';
    ctx.lineWidth = style.width + 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(toX(geom[0].lon), toY(geom[0].lat));
    for (let i = 1; i < geom.length; i++) {
      ctx.lineTo(toX(geom[i].lon), toY(geom[i].lat));
    }
    ctx.stroke();

    // Road fill
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.beginPath();
    ctx.moveTo(toX(geom[0].lon), toY(geom[0].lat));
    for (let i = 1; i < geom.length; i++) {
      ctx.lineTo(toX(geom[i].lon), toY(geom[i].lat));
    }
    ctx.stroke();
  }

  return canvas;
}
