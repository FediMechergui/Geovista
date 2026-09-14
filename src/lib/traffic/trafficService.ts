/**
 * Shared road network + simulation instance.
 *
 * Both viewers render the same traffic, so the Overpass fetch, the graph build
 * and the simulation live here rather than inside either component. Switching
 * between Globe and Terrain keeps the cars exactly where they were instead of
 * restarting the city.
 *
 * The cache holds one region at a time — selecting a new region discards the
 * old graph, which is what keeps memory flat while panning around the world.
 */

import type { BBox } from '@/types/geo';
import type { RoadGraph, SimConfig } from '@/types/traffic';
import { DEFAULT_SIM_CONFIG } from '@/types/traffic';
import { buildRoadGraph } from '@/lib/traffic/roadGraph';
import { clampRoadBBox, fetchRoadNetwork } from '@/lib/traffic/osmRoads';
import { TrafficSimulation } from '@/lib/traffic/simulation';

export interface TrafficSession {
  /** The bbox actually loaded — may be a clamped version of the request. */
  bbox: BBox;
  graph: RoadGraph;
  simulation: TrafficSimulation;
}

function keyFor(bbox: BBox): string {
  return [bbox.west, bbox.south, bbox.east, bbox.north].map((v) => v.toFixed(5)).join(',');
}

let current: { key: string; session: TrafficSession } | null = null;
let pending: { key: string; promise: Promise<TrafficSession | null> } | null = null;

/**
 * Load (or reuse) the road network for a region and return a live simulation.
 *
 * Returns `null` when the region has no drivable road mapped — the caller
 * should treat that as "nothing to simulate", not as a failure. Throws only
 * when Overpass itself fails.
 */
export async function ensureTrafficSession(
  bbox: BBox,
  config: SimConfig = DEFAULT_SIM_CONFIG,
  signal?: AbortSignal,
): Promise<TrafficSession | null> {
  const clamped = clampRoadBBox(bbox);
  const key = keyFor(clamped);

  if (current?.key === key) {
    current.session.simulation.setConfig(config);
    return current.session;
  }
  if (pending?.key === key) return pending.promise;

  const promise = (async (): Promise<TrafficSession | null> => {
    const raw = await fetchRoadNetwork(clamped, signal);
    if (raw.ways.length === 0) return null;

    const graph = buildRoadGraph(raw, clamped);
    if (graph.edges.size === 0) return null;

    const simulation = new TrafficSimulation(graph, config);
    const session: TrafficSession = { bbox: clamped, graph, simulation };

    current = { key, session };
    return session;
  })();

  pending = { key, promise };
  try {
    return await promise;
  } finally {
    if (pending?.key === key) pending = null;
  }
}

/** The loaded session, if any. */
export function activeTrafficSession(): TrafficSession | null {
  return current?.session ?? null;
}

/** Drop the cached network — call when the selected region changes. */
export function releaseTrafficSession(): void {
  current = null;
  pending = null;
}
