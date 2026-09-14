/**
 * OpenStreetMap building fetcher via the Overpass API.
 *
 * Free, no API key needed. Be respectful of rate limits:
 *   ~2 req/sec, 10k req/day, large queries may be throttled server-side.
 *
 * The query uses `out geom`, so coordinates come back inline and there is no
 * second pass to resolve node ids. It pulls three things:
 *
 *   1. `building=*` ways — the outlines.
 *   2. `building=*` relations — multipolygon buildings; their outer rings are
 *      used and inner courtyards ignored (they matter for area, not massing).
 *   3. `building:part=*` ways — Simple 3D Buildings. A part is attached to
 *      whichever outline contains its centroid, and parts replace that
 *      outline's extrusion so towers and setbacks come out right.
 *
 * Alongside geometry it reads every material, roof and age tag the renderer
 * can use — see `BuildingProperties`.
 */

import type { BuildingData, BuildingProperties } from '@/types/buildings';
import type { BBox } from '@/types/geo';
import { overpassQuery, QUERY_TIMEOUT_S } from '@/lib/osm/overpass';

interface OverpassMember {
  type: string;
  ref: number;
  role: string;
  geometry?: Array<{ lat: number; lon: number }>;
}

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  members?: OverpassMember[];
}

/**
 * Soft cap on bbox area (in square degrees). Above this, we warn but
 * still issue the query — the caller can decide to split.
 * ~0.01 deg² is roughly a 1 km × 1 km patch.
 */
const LARGE_AREA_THRESHOLD_DEG2 = 0.01;

/* ================================================================== */
/*  Tag parsing                                                        */
/* ================================================================== */

const FEET_TO_M = 0.3048;

/**
 * Parse an OSM length value into metres.
 * Accepts `12`, `12 m`, `12.5m`, `40 ft`, `40'`, and `40'6"`.
 */
export function parseLength(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();

  // Imperial: 40'6" or 40'
  const imperial = /^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?$/.exec(value);
  if (imperial) {
    const feet = parseFloat(imperial[1]);
    const inches = imperial[2] ? parseFloat(imperial[2]) : 0;
    return (feet + inches / 12) * FEET_TO_M;
  }

  const metric = /^(-?\d+(?:\.\d+)?)\s*(m|meter|metre|metres|meters|ft|feet)?$/.exec(value);
  if (!metric) return undefined;
  const n = parseFloat(metric[1]);
  if (!Number.isFinite(n)) return undefined;
  return metric[2] === 'ft' || metric[2] === 'feet' ? n * FEET_TO_M : n;
}

function parseCount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Pull a four-digit year out of an OSM `start_date`, which is often fuzzy. */
export function parseStartYear(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = /(\d{4})/.exec(raw);
  if (!match) return undefined;
  const year = parseInt(match[1], 10);
  return year >= 800 && year <= 2100 ? year : undefined;
}

/** Read every tag the renderer cares about off one OSM element. */
export function readProperties(tags: Record<string, string>): BuildingProperties {
  const height = parseLength(tags['height'] ?? tags['building:height']);
  const levels = parseCount(tags['building:levels']);

  return {
    height: height !== undefined && height > 0 ? height : undefined,
    levels: levels !== undefined && levels > 0 ? levels : undefined,
    minLevel: parseCount(tags['building:min_level']),
    minHeight: parseLength(tags['min_height']),
    name: tags['name'],
    type: tags['building'] ?? tags['building:part'],
    roofShape: tags['roof:shape'],
    roofHeight: parseLength(tags['roof:height']),
    roofLevels: parseCount(tags['roof:levels']),
    roofOrientation: tags['roof:orientation'],

    material: tags['building:material'],
    facadeMaterial: tags['building:facade:material'] ?? tags['facade:material'],
    roofMaterial: tags['roof:material'],
    colour: tags['building:colour'] ?? tags['building:color'],
    roofColour: tags['roof:colour'] ?? tags['roof:color'],

    startYear: parseStartYear(tags['start_date'] ?? tags['building:start_date']),
    useHint: tags['amenity'] ?? tags['shop'] ?? tags['office'] ?? tags['tourism'],
    historic: tags['historic'] !== undefined || tags['heritage'] !== undefined,
    condition: tags['building:condition'] ?? tags['condition'],
  };
}

/* ================================================================== */
/*  Geometry helpers                                                   */
/* ================================================================== */

type Ring = Array<[number, number]>;

function ringFromGeometry(geometry: Array<{ lat: number; lon: number }>): Ring {
  return geometry.map((g) => [g.lon, g.lat] as [number, number]);
}

/** Centroid of a ring (vertex average — enough for a containment test). */
function centroid(ring: Ring): [number, number] {
  let x = 0;
  let y = 0;
  for (const [lon, lat] of ring) {
    x += lon;
    y += lat;
  }
  return [x / ring.length, y / ring.length];
}

/** Standard ray-casting point-in-polygon test. */
function contains(ring: Ring, [px, py]: [number, number]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Axis-aligned bounds, used to reject containment tests cheaply. */
function bounds(ring: Ring): [number, number, number, number] {
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

/* ================================================================== */
/*  Fetch                                                              */
/* ================================================================== */

/**
 * Fetch OSM building footprints within a bounding box.
 *
 * Throws on network / HTTP failures. Returns an empty array if the
 * area has no buildings mapped.
 */
export async function fetchBuildings(
  bbox: BBox,
  signal?: AbortSignal,
): Promise<BuildingData[]> {
  const { south, west, north, east } = bbox;

  const area = (north - south) * (east - west);
  if (area > LARGE_AREA_THRESHOLD_DEG2) {
    console.warn(
      `[osmFetcher] Large area requested (${area.toFixed(4)} deg²). ` +
        `Consider splitting into smaller tiles to avoid Overpass timeouts.`,
    );
  }

  const b = `${south},${west},${north},${east}`;
  // `nwr` is one index lookup for ways and relations instead of two.
  const query = `
    [out:json][timeout:${QUERY_TIMEOUT_S}];
    (
      nwr["building"](${b});
      way["building:part"](${b});
    );
    out geom;
  `;

  const elements = await overpassQuery<OverpassElement>(query, signal);

  const outlines: BuildingData[] = [];
  const parts: BuildingData[] = [];

  for (const el of elements) {
    const tags = el.tags;
    if (!tags) continue;

    const isPart = tags['building:part'] !== undefined && tags['building'] === undefined;
    const properties = readProperties(tags);

    if (el.type === 'way') {
      if (!el.geometry || el.geometry.length < 4) continue;
      const ring = ringFromGeometry(el.geometry);
      const entry: BuildingData = { id: el.id, geometry: ring, properties };
      if (isPart) parts.push(entry);
      else outlines.push(entry);
      continue;
    }

    if (el.type === 'relation' && el.members) {
      // Multipolygon: each outer member is its own footprint. Inner rings are
      // courtyards; they change the floor area, not the silhouette, so they
      // are skipped rather than punched out.
      let index = 0;
      for (const member of el.members) {
        if (member.role !== 'outer' || !member.geometry || member.geometry.length < 4) continue;
        outlines.push({
          // Negative ids keep relations from colliding with way ids.
          id: -(el.id * 16 + index),
          geometry: ringFromGeometry(member.geometry),
          properties,
        });
        index++;
      }
    }
  }

  /* ---- Attach 3D parts to their parent outline ---- */
  if (parts.length > 0 && outlines.length > 0) {
    const outlineBounds = outlines.map((o) => bounds(o.geometry));

    for (const part of parts) {
      const c = centroid(part.geometry);
      let host: BuildingData | null = null;
      let hostArea = Infinity;

      for (let i = 0; i < outlines.length; i++) {
        const [minX, minY, maxX, maxY] = outlineBounds[i];
        if (c[0] < minX || c[0] > maxX || c[1] < minY || c[1] > maxY) continue;
        if (!contains(outlines[i].geometry, c)) continue;
        // Nest inside the tightest matching outline.
        const a = (maxX - minX) * (maxY - minY);
        if (a < hostArea) {
          hostArea = a;
          host = outlines[i];
        }
      }

      if (host) {
        (host.parts ??= []).push(part);
      } else {
        // An orphan part is still a real volume — render it standalone.
        outlines.push(part);
      }
    }
  }

  return outlines;
}

/* ================================================================== */
/*  Height estimation (re-exported for callers that only need the tags) */
/* ================================================================== */

export { estimateBuildingHeight } from '@/lib/buildings/buildingMesh';
