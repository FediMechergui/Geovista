/**
 * OpenStreetMap building fetcher via the Overpass API (through the
 * same-origin proxy at /api/proxy/overpass).
 *
 * Uses `out geom` so each way carries its own coordinates — no separate
 * node lookup — and caps the number of ways so a large region cannot
 * return hundreds of thousands of footprints.
 */

import type { BuildingData } from '@/types/buildings';
import type { BBox } from '@/types/geo';

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

/** Hard cap on footprints per request (keeps extrusion + memory bounded). */
export const MAX_BUILDINGS = 40_000;

/** Above this bbox area (deg², ~0.01 ≈ 1 km²) we warn — Overpass may be slow. */
const LARGE_AREA_THRESHOLD_DEG2 = 0.01;

/**
 * Fetch OSM building footprints within a bounding box.
 * Throws on network / HTTP failures. Returns an empty array if the
 * area has no buildings mapped.
 */
export async function fetchBuildings(bbox: BBox): Promise<BuildingData[]> {
  const { south, west, north, east } = bbox;

  const area = (north - south) * (east - west);
  if (area > LARGE_AREA_THRESHOLD_DEG2) {
    console.warn(
      `[osmFetcher] Large area requested (${area.toFixed(4)} deg²); capped at ${MAX_BUILDINGS} buildings.`,
    );
  }

  const query = `
    [out:json][timeout:60];
    way["building"](${south},${west},${north},${east});
    out geom ${MAX_BUILDINGS};
  `;

  const response = await fetch('/api/proxy/overpass', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as OverpassResponse;

  const buildings: BuildingData[] = [];
  for (const el of data.elements) {
    if (el.type !== 'way' || !el.tags?.building || !el.geometry) continue;

    const coords: Array<[number, number]> = el.geometry.map((p) => [p.lon, p.lat]);
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
  hotel: 25,
  garage: 4,
  shed: 3,
  hut: 3,
  roof: 4,
  yes: 10, // generic fallback
};

const METERS_PER_FLOOR = 3.2;

/**
 * Best-effort estimate of a building's height in meters.
 * Priority: explicit `height` → `levels * 3.2` → type default → 10 m.
 */
export function estimateBuildingHeight(props: BuildingData['properties']): number {
  if (props.height && !Number.isNaN(props.height)) {
    return props.height;
  }
  if (props.levels && !Number.isNaN(props.levels)) {
    return props.levels * METERS_PER_FLOOR;
  }
  return BUILDING_HEIGHT_DEFAULTS[props.type ?? 'yes'] ?? 10;
}
