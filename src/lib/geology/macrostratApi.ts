/**
 * Macrostrat API client — global geological columns and surface maps.
 *
 * Macrostrat is the best free, no-auth API for stratigraphic data.
 * Docs: https://macrostrat.org/api/v2
 * No published rate limits; be respectful.
 *
 * `fetchGeologicalColumn` returns the nearest column (2-step fetch:
 * columns → units), with all failures surfaced as `null` so that a
 * missing-data area degrades gracefully instead of crashing the UI.
 */

import type {
  GeologicalColumn,
  GeologicalUnit,
  GeologyLayerDef,
} from '@/types/geology';
import type { BBox } from '@/types/geo';
import { MACROSTRAT_API } from '@/lib/constants';

interface MacrostratColumn {
  col_id: number;
  col_name?: string;
  lat?: number;
  lng?: number;
}

interface MacrostratUnit {
  unit_id: number;
  strat_name?: string;
  strat_name_long?: string;
  lith?: Array<{ name: string }>;
  t_age?: number; // top (youngest) age in Ma
  b_age?: number; // bottom (oldest) age in Ma
  max_thick?: number; // meters
  color?: string;
}

interface MacrostratResponse<T> {
  success?: { data: T[] };
}

/**
 * Fetch the nearest geological column to a point.
 *
 * Returns `null` if:
 *   - no column exists within Macrostrat's coverage for that coordinate
 *   - either HTTP request fails
 *   - the response shape is unexpected
 */
export async function fetchGeologicalColumn(
  lat: number,
  lng: number,
): Promise<GeologicalColumn | null> {
  try {
    const colRes = await fetch(
      `${MACROSTRAT_API}/columns?lat=${lat}&lng=${lng}&adjacents=false&response=long`,
    );
    if (!colRes.ok) return null;
    const colData = (await colRes.json()) as MacrostratResponse<MacrostratColumn>;

    const col = colData.success?.data?.[0];
    if (!col) return null;

    const unitsRes = await fetch(
      `${MACROSTRAT_API}/units?col_id=${col.col_id}&response=long`,
    );
    if (!unitsRes.ok) return null;
    const unitsData = (await unitsRes.json()) as MacrostratResponse<MacrostratUnit>;

    const rawUnits = unitsData.success?.data ?? [];
    const units: GeologicalUnit[] = rawUnits.map((u) => ({
      unit_id: u.unit_id,
      strat_name: u.strat_name_long || u.strat_name || 'Unknown',
      lith: u.lith?.map((l) => l.name).join(', ') || 'Unknown',
      age_top: u.t_age ?? 0,
      age_bottom: u.b_age ?? 0,
      thickness: u.max_thick ?? 100,
      color: u.color || '#888888',
      description: u.strat_name_long || '',
    }));

    return {
      col_id: col.col_id,
      name: col.col_name || 'Geological Column',
      lat,
      lng,
      units,
    };
  } catch (err) {
    console.error('[macrostratApi] fetchGeologicalColumn failed:', err);
    return null;
  }
}

/**
 * Fetch surface (map) geological units intersecting a bounding box.
 * Returns the raw Macrostrat response — shape is a GeoJSON-like
 * FeatureCollection. Typed as `unknown` to avoid committing to an
 * upstream schema the API may evolve.
 */
export async function fetchSurfaceGeology(bbox: BBox): Promise<unknown> {
  const { west, south, east, north } = bbox;
  const response = await fetch(
    `${MACROSTRAT_API}/geologic_units/map?bbox=${west},${south},${east},${north}`,
  );
  if (!response.ok) {
    throw new Error(
      `Macrostrat surface geology error: ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
}

/**
 * Convert a geological column to an array of 3D layer definitions,
 * stacked from surface (depth 0) downward, capped at `maxDepth` meters.
 *
 * Units are sorted youngest → oldest (by top age), which matches
 * depositional order — youngest sediments on top.
 */
export function columnToLayers(
  column: GeologicalColumn,
  maxDepth: number = 5000,
): GeologyLayerDef[] {
  const sortedUnits = [...column.units].sort((a, b) => a.age_top - b.age_top);

  const layers: GeologyLayerDef[] = [];
  let currentDepth = 0;

  for (const unit of sortedUnits) {
    if (currentDepth >= maxDepth) break;

    const thickness = Math.min(unit.thickness, maxDepth - currentDepth);
    layers.push({
      name: unit.strat_name,
      depthTop: currentDepth,
      depthBottom: currentDepth + thickness,
      color: unit.color,
      opacity: 0.7,
      lith: unit.lith,
    });

    currentDepth += thickness;
  }

  return layers;
}
