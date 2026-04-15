/**
 * OpenStreetMap building fetcher via the Overpass API.
 *
 * Free, no API key needed. Be respectful of rate limits:
 *   ~2 req/sec, 10k req/day, large queries may be throttled server-side.
 *
 * The Overpass query returns building ways + the referenced nodes; we
 * cross-reference them to build polygon footprints, then extract height
 * hints from `height`, `building:height`, `building:levels`, and
 * `building` type tags.
 */

import type { BuildingData } from '@/types/buildings';
import type { BBox } from '@/types/geo';
import { OVERPASS_API } from '@/lib/constants';

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

/**
 * Soft cap on bbox area (in square degrees). Above this, we warn but
 * still issue the query — the caller can decide to split.
 * ~0.01 deg² is roughly a 1 km × 1 km patch.
 */
const LARGE_AREA_THRESHOLD_DEG2 = 0.01;

/**
 * Fetch OSM building footprints within a bounding box.
 *
 * Throws on network / HTTP failures. Returns an empty array if the
 * area has no buildings mapped.
 */
export async function fetchBuildings(bbox: BBox): Promise<BuildingData[]> {
  const { south, west, north, east } = bbox;

  const area = (north - south) * (east - west);
  if (area > LARGE_AREA_THRESHOLD_DEG2) {
    console.warn(
      `[osmFetcher] Large area requested (${area.toFixed(4)} deg²). ` +
        `Consider splitting into smaller tiles to avoid Overpass timeouts.`,
    );
  }

  const query = `
    [out:json][timeout:30];
    (
      way["building"](${south},${west},${north},${east});
      relation["building"](${south},${west},${north},${east});
    );
    out body;
    >;
    out skel qt;
  `;

  const response = await fetch(OVERPASS_API, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (!response.ok) {
    throw new Error(
      `Overpass API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as OverpassResponse;

  // Index nodes by id → [lon, lat] for fast lookup during way assembly.
  const nodeIndex = new Map<number, [number, number]>();
  for (const el of data.elements) {
    if (el.type === 'node' && el.lon !== undefined && el.lat !== undefined) {
      nodeIndex.set(el.id, [el.lon, el.lat]);
    }
  }

  const buildings: BuildingData[] = [];
  for (const el of data.elements) {
    if (el.type !== 'way' || !el.tags?.building || !el.nodes) continue;

    const coords = el.nodes
      .map((nodeId) => nodeIndex.get(nodeId))
      .filter((c): c is [number, number] => c !== undefined);

    // A polygon needs at least 3 distinct vertices.
    if (coords.length < 3) continue;

    const heightStr = el.tags['height'] ?? el.tags['building:height'];
    const levelsStr = el.tags['building:levels'];

    buildings.push({
      id: el.id,
      geometry: coords,
      properties: {
        height: heightStr ? parseFloat(heightStr) : undefined,
        levels: levelsStr ? parseInt(levelsStr, 10) : undefined,
        name: el.tags.name,
        type: el.tags.building,
        roof_shape: el.tags['roof:shape'],
      },
    });
  }

  return buildings;
}

/**
 * Default heights (meters) for common OSM `building=*` types when no
 * explicit `height` or `building:levels` tag is present.
 *
 * These are reasonable global averages, not region-specific.
 */
const BUILDING_HEIGHT_DEFAULTS: Record<string, number> = {
  house: 8,
  detached: 8,
  residential: 12,
  apartments: 18,
  commercial: 15,
  office: 20,
  industrial: 10,
  warehouse: 12,
  retail: 6,
  supermarket: 8,
  school: 12,
  university: 18,
  hospital: 20,
  church: 20,
  cathedral: 40,
  mosque: 20,
  temple: 15,
  garage: 4,
  shed: 3,
  hut: 3,
  yes: 10, // generic fallback
};

const METERS_PER_FLOOR = 3.2;

/**
 * Best-effort estimate of a building's height in meters.
 * Priority: explicit `height` → `levels * 3.2` → type default → 10 m.
 */
export function estimateBuildingHeight(
  props: BuildingData['properties'],
): number {
  if (props.height && !Number.isNaN(props.height)) {
    return props.height;
  }
  if (props.levels && !Number.isNaN(props.levels)) {
    return props.levels * METERS_PER_FLOOR;
  }
  return BUILDING_HEIGHT_DEFAULTS[props.type ?? 'yes'] ?? 10;
}
