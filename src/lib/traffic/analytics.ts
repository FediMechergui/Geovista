/**
 * Congestion analytics — turning raw simulation state into the colours,
 * labels and numbers the UI shows.
 *
 * The level-of-service scale (A–F) is the standard Highway Capacity Manual
 * framing, applied here to the ratio of simulated speed to posted speed. It is
 * the same measure a traffic engineer would read off a floating-car survey,
 * which makes the colours mean something rather than being decorative.
 */

import type { EdgeStats, LevelOfService, RoadClass, RoadEdge, RoadGraph } from '@/types/traffic';
import { localToGeo, frameFor } from '@/lib/traffic/roadGraph';

/**
 * Colour per level of service.
 *
 * An ordered severity ramp, not a categorical palette, so the property that
 * matters is **monotonic lightness**: OKLab L runs 0.871 → 0.800 → 0.795 →
 * 0.705 → 0.637 → 0.505, which means the A→F order survives intact for a
 * viewer with any form of colour-vision deficiency, who reads it off
 * lightness rather than hue. The hue path stays the conventional green →
 * amber → red every driver already knows.
 *
 * The closest adjacent pair (A↔B, both greens) sits at ΔE 7 under protanopia,
 * inside the band that requires a secondary encoding — so the A–F letter is
 * shown everywhere the colour is: in the legend, and on every hotspot row.
 */
export const LOS_COLORS: Record<LevelOfService, string> = {
  A: '#86efac',
  B: '#4ade80',
  C: '#eab308',
  D: '#f97316',
  E: '#ef4444',
  F: '#b91c1c',
};

export const LOS_LABELS: Record<LevelOfService, string> = {
  A: 'Free flow',
  B: 'Reasonably free',
  C: 'Stable',
  D: 'Approaching capacity',
  E: 'At capacity',
  F: 'Breakdown',
};

/** Base colour per road class, used when congestion colouring is off. */
export const ROAD_COLORS: Record<RoadClass, string> = {
  motorway: '#e2725b',
  trunk: '#e08a5f',
  primary: '#e3a857',
  secondary: '#d9c05c',
  tertiary: '#c9c98f',
  residential: '#9ca3af',
  unclassified: '#9ca3af',
  service: '#7f8791',
  living_street: '#8b93a1',
};

/** Colour an edge should be drawn in, given the current statistics. */
export function edgeColor(
  edge: RoadEdge,
  stats: EdgeStats | undefined,
  congestionMode: boolean,
): string {
  if (!congestionMode || !stats) return ROAD_COLORS[edge.klass];
  // An empty link has no measured condition; show its class colour instead of
  // claiming free flow it has not demonstrated.
  if (stats.count === 0) return ROAD_COLORS[edge.klass];
  return LOS_COLORS[stats.los];
}

/** Format a speed in m/s as km/h for display. */
export function kmh(metersPerSecond: number): string {
  return `${(metersPerSecond * 3.6).toFixed(0)} km/h`;
}

/** Format a duration in seconds as `m:ss` or `h:mm`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Format a distance in metres. */
export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(0)} m`;
}

/* ================================================================== */
/*  Export                                                             */
/* ================================================================== */

/**
 * Build a GeoJSON FeatureCollection of the road network with its current
 * congestion measures attached — the shape a GIS or a notebook can read.
 *
 * Only edges carrying traffic are exported; an empty street has nothing to
 * say about congestion and would bloat the file.
 */
export function congestionGeoJSON(
  graph: RoadGraph,
  stats: Map<number, EdgeStats>,
): {
  type: 'FeatureCollection';
  features: Array<Record<string, unknown>>;
} {
  const frame = frameFor(graph.bbox);
  const features: Array<Record<string, unknown>> = [];

  for (const edge of graph.edges.values()) {
    const s = stats.get(edge.id);
    if (!s || s.count === 0) continue;

    const coordinates: Array<[number, number]> = [];
    for (let i = 0; i < edge.points.length; i += 2) {
      const [lon, lat] = localToGeo(frame, edge.points[i], edge.points[i + 1]);
      coordinates.push([Number(lon.toFixed(7)), Number(lat.toFixed(7))]);
    }

    features.push({
      type: 'Feature',
      properties: {
        edge_id: edge.id,
        osm_way: edge.wayId,
        name: edge.name ?? null,
        ref: edge.ref ?? null,
        highway: edge.klass,
        lanes: edge.lanes,
        speed_limit_kmh: Number((edge.speedLimit * 3.6).toFixed(1)),
        mean_speed_kmh: Number((s.meanSpeed * 3.6).toFixed(1)),
        speed_ratio: Number(s.speedRatio.toFixed(3)),
        density_veh_km_lane: Number(s.density.toFixed(2)),
        flow_veh_h: Number(s.flow.toFixed(0)),
        vehicles: s.count,
        level_of_service: s.los,
        los_label: LOS_LABELS[s.los],
      },
      geometry: { type: 'LineString', coordinates },
    });
  }

  return { type: 'FeatureCollection', features };
}
