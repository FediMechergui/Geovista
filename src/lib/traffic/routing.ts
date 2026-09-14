/**
 * Routing over the directed road graph.
 *
 * Two very different needs are served here:
 *
 *   - **Ambient traffic** — hundreds of vehicles need a plausible path every
 *     few seconds. A full shortest-path search per vehicle would dominate the
 *     frame budget, so ambient vehicles take a weighted random walk that
 *     prefers going straight and staying on the bigger road, which is what
 *     most drivers on most trips actually do.
 *
 *   - **The route panel** — one A→B query at a time, where the answer must be
 *     the real shortest path. That uses A* with a travel-time cost and an
 *     admissible straight-line heuristic.
 */

import type { RoadEdge, RoadGraph, RoutePlan } from '@/types/traffic';
import { CLASS_PRIORITY, turnType } from '@/lib/traffic/roadGraph';

/* ================================================================== */
/*  Deterministic RNG                                                  */
/* ================================================================== */

/**
 * mulberry32 — small, fast, and fully determined by its seed, so a given
 * `SimConfig.seed` always replays the same traffic.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ================================================================== */
/*  Successors                                                         */
/* ================================================================== */

/**
 * Edges a vehicle on `edge` may continue onto.
 *
 * U-turns are excluded unless they are the only option, which is what keeps
 * cars from bouncing back and forth on a dead-end street.
 */
export function successorsOf(graph: RoadGraph, edge: RoadEdge): RoadEdge[] {
  const node = graph.nodes.get(edge.to);
  if (!node) return [];

  const all: RoadEdge[] = [];
  let nonUturn = 0;

  for (const id of node.outgoing) {
    const next = graph.edges.get(id);
    if (!next) continue;
    // The reverse of the edge we came in on: same way, opposite endpoints.
    const isReverse = next.to === edge.from && next.from === edge.to;
    if (!isReverse) nonUturn++;
    all.push(next);
  }

  if (nonUturn === 0) return all;
  return all.filter((next) => !(next.to === edge.from && next.from === edge.to));
}

/* ================================================================== */
/*  Ambient routes — weighted random walk                              */
/* ================================================================== */

/** How strongly drivers prefer not to turn. */
const STRAIGHT_BONUS = 3.2;
const RIGHT_BONUS = 1.35;
const LEFT_BONUS = 1.0;
const UTURN_PENALTY = 0.06;

/**
 * Pick the next edge the way a driver on a trip would: mostly straight on,
 * biased toward the more important road, rarely doubling back.
 */
function pickSuccessor(
  graph: RoadGraph,
  edge: RoadEdge,
  rng: () => number,
): RoadEdge | null {
  const options = successorsOf(graph, edge);
  if (options.length === 0) return null;
  if (options.length === 1) return options[0];

  let total = 0;
  const weights = options.map((next) => {
    const turn = turnType(edge, next);
    const turnWeight =
      turn === 'straight'
        ? STRAIGHT_BONUS
        : turn === 'right'
          ? RIGHT_BONUS
          : turn === 'left'
            ? LEFT_BONUS
            : UTURN_PENALTY;
    // Bigger roads attract more through traffic.
    const classWeight = 0.4 + CLASS_PRIORITY[next.klass] * 0.22;
    const w = turnWeight * classWeight;
    total += w;
    return w;
  });

  let r = rng() * total;
  for (let i = 0; i < options.length; i++) {
    r -= weights[i];
    if (r <= 0) return options[i];
  }
  return options[options.length - 1];
}

/**
 * Build a plausible ambient route of roughly `targetLengthM` metres starting
 * from `startEdge`. Stops early at a dead end, which is the normal way a trip
 * ends at the region boundary.
 */
export function randomRoute(
  graph: RoadGraph,
  startEdge: RoadEdge,
  rng: () => number,
  targetLengthM = 2500,
  maxEdges = 120,
): number[] {
  const route = [startEdge.id];
  const visited = new Set<number>([startEdge.id]);
  let current = startEdge;
  let length = startEdge.length;

  while (length < targetLengthM && route.length < maxEdges) {
    const next = pickSuccessor(graph, current, rng);
    if (!next) break;
    // Allow revisiting an edge (a loop through a block is realistic) but not
    // immediately, or short one-way loops turn into infinite carousels.
    if (visited.has(next.id) && route.length > 3 && rng() < 0.75) break;
    route.push(next.id);
    visited.add(next.id);
    length += next.length;
    current = next;
  }

  return route;
}

/* ================================================================== */
/*  A* shortest path                                                   */
/* ================================================================== */

/** Highest speed limit anywhere in the graph — the A* heuristic divisor. */
function maxSpeed(graph: RoadGraph): number {
  let max = 1;
  for (const edge of graph.edges.values()) {
    if (edge.speedLimit > max) max = edge.speedLimit;
  }
  return max;
}

/** Seconds to traverse an edge at `speedOf` metres per second. */
type SpeedOracle = (edge: RoadEdge) => number;

/** Free-flow: everyone drives the limit. */
export const freeFlowSpeed: SpeedOracle = (edge) => edge.speedLimit;

/**
 * A* from `fromNode` to `toNode` minimising travel time.
 *
 * Returns `null` when the destination is unreachable — common in a clipped
 * bbox where one-way streets leave parts of the network with no legal entry.
 */
export function planRoute(
  graph: RoadGraph,
  fromNode: number,
  toNode: number,
  speedOf: SpeedOracle = freeFlowSpeed,
): RoutePlan | null {
  if (fromNode === toNode) {
    return { edges: [], distance: 0, duration: 0, liveDuration: 0 };
  }
  const target = graph.nodes.get(toNode);
  const start = graph.nodes.get(fromNode);
  if (!target || !start) return null;

  const vMax = maxSpeed(graph);
  const heuristic = (nodeId: number): number => {
    const n = graph.nodes.get(nodeId);
    if (!n) return 0;
    return Math.hypot(n.x - target.x, n.y - target.y) / vMax;
  };

  // Straightforward binary heap — the graphs here are a few thousand edges,
  // well inside what a simple implementation handles in a frame.
  const open: Array<{ node: number; f: number }> = [{ node: fromNode, f: heuristic(fromNode) }];
  const gScore = new Map<number, number>([[fromNode, 0]]);
  const cameFrom = new Map<number, { node: number; edge: number }>();
  const closed = new Set<number>();

  const push = (item: { node: number; f: number }) => {
    open.push(item);
    let i = open.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (open[parent].f <= open[i].f) break;
      [open[parent], open[i]] = [open[i], open[parent]];
      i = parent;
    }
  };

  const pop = (): { node: number; f: number } | undefined => {
    if (open.length === 0) return undefined;
    const top = open[0];
    const last = open.pop()!;
    if (open.length > 0) {
      open[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < open.length && open[l].f < open[smallest].f) smallest = l;
        if (r < open.length && open[r].f < open[smallest].f) smallest = r;
        if (smallest === i) break;
        [open[smallest], open[i]] = [open[i], open[smallest]];
        i = smallest;
      }
    }
    return top;
  };

  while (open.length > 0) {
    const current = pop()!;
    if (closed.has(current.node)) continue;
    closed.add(current.node);

    if (current.node === toNode) break;

    const node = graph.nodes.get(current.node);
    if (!node) continue;
    const g = gScore.get(current.node) ?? Infinity;

    for (const edgeId of node.outgoing) {
      const edge = graph.edges.get(edgeId);
      if (!edge || closed.has(edge.to)) continue;

      const speed = Math.max(1, speedOf(edge));
      const tentative = g + edge.length / speed;
      if (tentative >= (gScore.get(edge.to) ?? Infinity)) continue;

      gScore.set(edge.to, tentative);
      cameFrom.set(edge.to, { node: current.node, edge: edgeId });
      push({ node: edge.to, f: tentative + heuristic(edge.to) });
    }
  }

  if (!cameFrom.has(toNode)) return null;

  const edges: number[] = [];
  let cursor = toNode;
  while (cursor !== fromNode) {
    const step = cameFrom.get(cursor);
    if (!step) return null;
    edges.push(step.edge);
    cursor = step.node;
  }
  edges.reverse();

  let distance = 0;
  let duration = 0;
  let liveDuration = 0;
  for (const id of edges) {
    const edge = graph.edges.get(id);
    if (!edge) continue;
    distance += edge.length;
    duration += edge.length / Math.max(1, edge.speedLimit);
    liveDuration += edge.length / Math.max(1, speedOf(edge));
  }

  return { edges, distance, duration, liveDuration };
}

/* ================================================================== */
/*  Snapping                                                           */
/* ================================================================== */

/**
 * Nearest graph node to a local-frame point, within `maxDistM`.
 * Used to turn a map click into a routable origin or destination.
 */
export function nearestNode(
  graph: RoadGraph,
  x: number,
  y: number,
  maxDistM = 400,
): number | null {
  let best: number | null = null;
  let bestDist = maxDistM * maxDistM;

  for (const node of graph.nodes.values()) {
    // Only nodes a car can actually leave from are useful as route ends.
    if (node.outgoing.length === 0 && node.incoming.length === 0) continue;
    const dx = node.x - x;
    const dy = node.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist) {
      bestDist = d2;
      best = node.id;
    }
  }

  return best;
}
