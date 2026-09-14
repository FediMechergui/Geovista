/**
 * Builds a routable, directed road graph from raw OSM ways.
 *
 * ## What "building the graph" means here
 *
 * OSM ways run through junctions rather than stopping at them, so a single
 * way can cross a dozen intersections. The simulation needs segments that
 * start and end at a junction, because that is where cars queue, yield and
 * choose a turn. So every way is split at each node it shares with another
 * way, and each resulting piece becomes one directed edge per drivable
 * direction (two for a normal street, one for a oneway or a roundabout).
 *
 * ## Coordinate frame
 *
 * Geometry is projected once into a local east-north metric frame centred on
 * the region, using the same 111 320 m/° constant as the terrain mesh so that
 * roads, buildings and the DEM line up exactly. All simulation maths is in
 * metres; `localToGeo` converts back for the globe view and for exports.
 */

import type { BBox } from '@/types/geo';
import type { RoadClass, RoadEdge, RoadGraph, RoadNode } from '@/types/traffic';
import { roadClassOf, type RawRoadNetwork, type RawRoadWay } from '@/lib/traffic/osmRoads';

/* ================================================================== */
/*  Projection                                                         */
/* ================================================================== */

/** Metres per degree of latitude — matches `DEG_PER_M` in the mesh generator. */
export const M_PER_DEG = 111320;

export interface LocalFrame {
  lon: number;
  lat: number;
  cosLat: number;
}

export function frameFor(bbox: BBox): LocalFrame {
  const lat = (bbox.south + bbox.north) / 2;
  return { lon: (bbox.west + bbox.east) / 2, lat, cosLat: Math.cos((lat * Math.PI) / 180) };
}

/** Geographic → local metric (metres east, metres north of the frame origin). */
export function geoToLocal(frame: LocalFrame, lon: number, lat: number): [number, number] {
  return [(lon - frame.lon) * M_PER_DEG * frame.cosLat, (lat - frame.lat) * M_PER_DEG];
}

/** Local metric → geographic. */
export function localToGeo(frame: LocalFrame, x: number, y: number): [number, number] {
  return [frame.lon + x / (M_PER_DEG * frame.cosLat), frame.lat + y / M_PER_DEG];
}

/* ================================================================== */
/*  Tag parsing                                                        */
/* ================================================================== */

/** Free-flow speed in km/h when the way carries no usable `maxspeed`. */
const DEFAULT_SPEED_KMH: Record<RoadClass, number> = {
  motorway: 110,
  trunk: 90,
  primary: 70,
  secondary: 60,
  tertiary: 50,
  residential: 30,
  unclassified: 40,
  service: 20,
  living_street: 10,
};

/** Default lane count *per direction* when `lanes` is absent. */
const DEFAULT_LANES: Record<RoadClass, number> = {
  motorway: 2,
  trunk: 2,
  primary: 2,
  secondary: 1,
  tertiary: 1,
  residential: 1,
  unclassified: 1,
  service: 1,
  living_street: 1,
};

/** Lane width in metres per class — drives the rendered ribbon width. */
export const LANE_WIDTH_M: Record<RoadClass, number> = {
  motorway: 3.75,
  trunk: 3.6,
  primary: 3.4,
  secondary: 3.25,
  tertiary: 3.1,
  residential: 2.9,
  unclassified: 3.0,
  service: 2.7,
  living_street: 2.7,
};

/** Right-of-way ranking; a higher number wins at an unsignalised junction. */
export const CLASS_PRIORITY: Record<RoadClass, number> = {
  motorway: 8,
  trunk: 7,
  primary: 6,
  secondary: 5,
  tertiary: 4,
  unclassified: 3,
  residential: 2,
  living_street: 1,
  service: 1,
};

const MPH_TO_KMH = 1.609344;

/**
 * Parse an OSM `maxspeed` value into m/s.
 *
 * Handles `50`, `30 mph`, `50 km/h`, `walk`, `none` (no limit — capped at a
 * realistic cruising speed) and `XX:urban`-style implicit references.
 * Returns `null` when the value is unusable, so the caller falls back to the
 * class default.
 */
export function parseMaxSpeed(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();

  if (value === 'none') return 130 / 3.6;
  if (value === 'walk') return 7 / 3.6;

  // Implicit country defaults, e.g. "DE:urban", "FR:rural".
  const implicit = /^[a-z-]{2,8}:(\w+)$/.exec(value);
  if (implicit) {
    const zone = implicit[1];
    const table: Record<string, number> = {
      living_street: 10,
      urban: 50,
      zone30: 30,
      rural: 80,
      trunk: 100,
      motorway: 120,
      nsl_single: 96,
      nsl_dual: 112,
      nsl_restricted: 48,
    };
    const kmh = table[zone];
    return kmh ? kmh / 3.6 : null;
  }

  const match = /^([\d.]+)\s*(mph|km\/h|kmh|kph)?$/.exec(value);
  if (!match) return null;
  const n = parseFloat(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const kmh = match[2] === 'mph' ? n * MPH_TO_KMH : n;
  // Anything beyond 160 km/h is a tagging error for a public road.
  return Math.min(kmh, 160) / 3.6;
}

function parseIntTag(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Which directions a way may be driven in. */
interface Directionality {
  forward: boolean;
  backward: boolean;
  forwardLanes: number;
  backwardLanes: number;
}

export function parseDirectionality(
  tags: Record<string, string>,
  klass: RoadClass,
): Directionality {
  const roundabout = tags.junction === 'roundabout' || tags.junction === 'circular';
  const oneway = tags.oneway;
  const reversed = oneway === '-1' || oneway === 'reverse';
  const isOneway =
    roundabout ||
    reversed ||
    oneway === 'yes' ||
    oneway === '1' ||
    oneway === 'true' ||
    // Motorway carriageways and slip roads are oneway unless tagged otherwise.
    (klass === 'motorway' && oneway !== 'no');

  const total = parseIntTag(tags.lanes);
  const fwdTag = parseIntTag(tags['lanes:forward']);
  const bwdTag = parseIntTag(tags['lanes:backward']);
  const fallback = DEFAULT_LANES[klass];

  let forwardLanes: number;
  let backwardLanes: number;

  if (isOneway) {
    // `oneway=-1` means the way is driven against its node order, so all the
    // lanes belong to the backward direction.
    const laneCount = total ?? (reversed ? bwdTag : fwdTag) ?? fallback;
    forwardLanes = reversed ? 0 : laneCount;
    backwardLanes = reversed ? laneCount : 0;
  } else if (fwdTag || bwdTag) {
    forwardLanes = fwdTag ?? Math.max(1, (total ?? fallback * 2) - (bwdTag ?? 0));
    backwardLanes = bwdTag ?? Math.max(1, (total ?? fallback * 2) - forwardLanes);
  } else if (total) {
    forwardLanes = Math.max(1, Math.floor(total / 2));
    backwardLanes = Math.max(1, total - forwardLanes);
  } else {
    forwardLanes = fallback;
    backwardLanes = fallback;
  }

  return {
    forward: !isOneway || !reversed,
    backward: !isOneway || reversed,
    forwardLanes: Math.min(Math.max(1, forwardLanes), 5),
    backwardLanes: Math.min(Math.max(1, backwardLanes), 5),
  };
}

/* ================================================================== */
/*  Graph construction                                                 */
/* ================================================================== */

interface Split {
  /** Node ids of this piece, in way order. */
  nodes: number[];
  /** Local metric coordinates, parallel to `nodes`. */
  points: Array<[number, number]>;
}

/** Cut a way into pieces at every junction node it passes through. */
function splitWay(way: RawRoadWay, junctions: Set<number>, frame: LocalFrame): Split[] {
  const local = way.coords.map(([lon, lat]) => geoToLocal(frame, lon, lat));

  const splits: Split[] = [];
  let startIdx = 0;

  for (let i = 1; i < way.nodes.length; i++) {
    const isLast = i === way.nodes.length - 1;
    if (!isLast && !junctions.has(way.nodes[i])) continue;

    const nodes = way.nodes.slice(startIdx, i + 1);
    const points = local.slice(startIdx, i + 1);
    if (nodes.length >= 2) splits.push({ nodes, points });
    startIdx = i;
  }

  return splits;
}

/** Drop consecutive duplicate vertices, which produce NaN headings. */
function dedupe(points: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) continue;
    out.push(p);
  }
  return out;
}

function buildEdge(
  id: number,
  wayId: number,
  from: number,
  to: number,
  rawPoints: Array<[number, number]>,
  klass: RoadClass,
  tags: Record<string, string>,
  lanes: number,
  speedLimit: number,
): RoadEdge | null {
  const pts = dedupe(rawPoints);
  if (pts.length < 2) return null;

  const flat = new Float64Array(pts.length * 2);
  const cumulative = new Float64Array(pts.length);
  let length = 0;

  for (let i = 0; i < pts.length; i++) {
    flat[i * 2] = pts[i][0];
    flat[i * 2 + 1] = pts[i][1];
    if (i > 0) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dy = pts[i][1] - pts[i - 1][1];
      length += Math.hypot(dx, dy);
    }
    cumulative[i] = length;
  }

  // Sub-metre stubs are junction artefacts, not roads.
  if (length < 1) return null;

  const inHeading = Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]);
  const n = pts.length;
  const outHeading = Math.atan2(
    pts[n - 1][1] - pts[n - 2][1],
    pts[n - 1][0] - pts[n - 2][0],
  );

  return {
    id,
    wayId,
    from,
    to,
    klass,
    name: tags.name,
    ref: tags.ref,
    points: flat,
    cumulative,
    length,
    lanes: Math.max(1, lanes),
    speedLimit,
    roundabout: tags.junction === 'roundabout' || tags.junction === 'circular',
    bridge: tags.bridge === 'yes',
    tunnel: tags.tunnel === 'yes',
    layer: parseInt(tags.layer ?? '0', 10) || 0,
    inHeading,
    outHeading,
  };
}

/**
 * Assign each signalised approach to one of two alternating phases.
 *
 * Approaches are grouped by their *axis* (heading modulo 180°), so a street
 * and its opposite direction share a phase while the crossing street gets the
 * other — the behaviour of a normal two-phase intersection.
 */
function assignSignalGroups(node: RoadNode, edges: Map<number, RoadEdge>): void {
  if (node.control !== 'signal' || node.incoming.length < 2) return;

  const approaches = node.incoming
    .map((id) => ({ id, heading: edges.get(id)?.outHeading }))
    .filter((a): a is { id: number; heading: number } => a.heading !== undefined);
  if (approaches.length < 2) return;

  const reference = approaches[0].heading;
  const groups: Record<number, 0 | 1> = {};

  for (const a of approaches) {
    // Angle between the two axes, folded into [0, π/2].
    let delta = Math.abs(a.heading - reference) % Math.PI;
    if (delta > Math.PI / 2) delta = Math.PI - delta;
    groups[a.id] = delta < Math.PI / 4 ? 0 : 1;
  }

  node.signalGroup = groups;
}

/**
 * Build the directed road graph.
 *
 * @param raw    Result of `fetchRoadNetwork`.
 * @param bbox   Region the graph covers — used for the local frame and to
 *               decide which endpoints count as network boundary.
 */
export function buildRoadGraph(raw: RawRoadNetwork, bbox: BBox): RoadGraph {
  const frame = frameFor(bbox);

  /* ---- 1. Find junction nodes: any node used by more than one way, plus
            every way endpoint, plus every tagged control node. ---- */
  const useCount = new Map<number, number>();
  for (const way of raw.ways) {
    for (const nodeId of way.nodes) {
      useCount.set(nodeId, (useCount.get(nodeId) ?? 0) + 1);
    }
  }

  const junctions = new Set<number>();
  for (const [nodeId, count] of useCount) {
    if (count > 1) junctions.add(nodeId);
  }
  for (const way of raw.ways) {
    junctions.add(way.nodes[0]);
    junctions.add(way.nodes[way.nodes.length - 1]);
  }
  for (const nodeId of raw.controls.keys()) {
    if (useCount.has(nodeId)) junctions.add(nodeId);
  }

  /* ---- 2. Split every way and emit directed edges. ---- */
  const nodes = new Map<number, RoadNode>();
  const edges = new Map<number, RoadEdge>();
  let nextEdgeId = 1;

  /** Register a junction node the first time an edge touches it. */
  const ensureNode = (id: number, x: number, y: number): RoadNode => {
    let node = nodes.get(id);
    if (!node) {
      const [lon, lat] = localToGeo(frame, x, y);
      node = {
        id,
        lon,
        lat,
        x,
        y,
        control: raw.controls.get(id) ?? 'none',
        incoming: [],
        outgoing: [],
      };
      nodes.set(id, node);
    }
    return node;
  };

  for (const way of raw.ways) {
    const klass = roadClassOf(way.tags);
    if (!klass) continue;

    const speedLimit = parseMaxSpeed(way.tags.maxspeed) ?? DEFAULT_SPEED_KMH[klass] / 3.6;
    const dir = parseDirectionality(way.tags, klass);

    for (const split of splitWay(way, junctions, frame)) {
      const a = split.nodes[0];
      const b = split.nodes[split.nodes.length - 1];
      if (a === b) continue; // closed loop with no interior junction

      if (dir.forward) {
        const edge = buildEdge(
          nextEdgeId,
          way.id,
          a,
          b,
          split.points,
          klass,
          way.tags,
          dir.forwardLanes,
          speedLimit,
        );
        if (edge) {
          edges.set(edge.id, edge);
          nextEdgeId++;
          const na = ensureNode(a, split.points[0][0], split.points[0][1]);
          const nb = ensureNode(
            b,
            split.points[split.points.length - 1][0],
            split.points[split.points.length - 1][1],
          );
          na.outgoing.push(edge.id);
          nb.incoming.push(edge.id);
        }
      }

      if (dir.backward) {
        const reversed = [...split.points].reverse();
        const edge = buildEdge(
          nextEdgeId,
          way.id,
          b,
          a,
          reversed,
          klass,
          way.tags,
          dir.backwardLanes,
          speedLimit,
        );
        if (edge) {
          edges.set(edge.id, edge);
          nextEdgeId++;
          const nb = ensureNode(b, reversed[0][0], reversed[0][1]);
          const na = ensureNode(
            a,
            reversed[reversed.length - 1][0],
            reversed[reversed.length - 1][1],
          );
          nb.outgoing.push(edge.id);
          na.incoming.push(edge.id);
        }
      }
    }
  }

  /* ---- 3. Signal phasing. ---- */
  for (const node of nodes.values()) assignSignalGroups(node, edges);

  /* ---- 4. Sources and sinks: where traffic enters and leaves.

         Two kinds of place qualify. A node nothing feeds is a dead end or a
         way the Overpass extract cut off. A node sitting on the region edge is
         where the rest of the city would continue — traffic arrives from there
         even though the graph does not show it. A dense grid fully inside the
         bbox has none of the first kind, so without the second it would have
         no entry points at all. */
  const margin = Math.max(
    (bbox.east - bbox.west) * 0.12,
    (bbox.north - bbox.south) * 0.12,
  );
  const onBoundary = (node: RoadNode): boolean =>
    node.lon - bbox.west < margin ||
    bbox.east - node.lon < margin ||
    node.lat - bbox.south < margin ||
    bbox.north - node.lat < margin;

  const sources: number[] = [];
  const sinks: number[] = [];
  let totalLengthM = 0;

  for (const edge of edges.values()) {
    totalLengthM += edge.length;
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (from && (from.incoming.length === 0 || onBoundary(from))) sources.push(edge.id);
    if (to && (to.outgoing.length === 0 || onBoundary(to))) sinks.push(edge.id);
  }

  return {
    nodes,
    edges,
    bbox,
    origin: { lon: frame.lon, lat: frame.lat },
    sources,
    sinks,
    totalLengthM,
  };
}

/* ================================================================== */
/*  Geometry helpers used by the simulation and the renderers           */
/* ================================================================== */

/** Point and heading at arc length `s` along an edge. */
export function pointAt(
  edge: RoadEdge,
  s: number,
): { x: number; y: number; heading: number } {
  const { points, cumulative, length } = edge;
  const t = Math.max(0, Math.min(s, length));

  // Linear scan: edges are short (a block or two) so this beats a binary
  // search in practice and keeps the hot loop allocation-free.
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i] < t) i++;

  const segStart = cumulative[i - 1];
  const segLen = cumulative[i] - segStart;
  const f = segLen > 0 ? (t - segStart) / segLen : 0;

  const x0 = points[(i - 1) * 2];
  const y0 = points[(i - 1) * 2 + 1];
  const x1 = points[i * 2];
  const y1 = points[i * 2 + 1];

  return {
    x: x0 + (x1 - x0) * f,
    y: y0 + (y1 - y0) * f,
    heading: Math.atan2(y1 - y0, x1 - x0),
  };
}

/**
 * Lateral offset for a vehicle in `lane` of `edge`, in metres to the right of
 * the centreline. Lane 0 sits nearest the centreline; drive-on-the-right is
 * assumed, matching the majority of the world's road network.
 */
export function laneOffset(edge: RoadEdge, lane: number): number {
  const w = LANE_WIDTH_M[edge.klass];
  return (lane + 0.5) * w;
}

/** Half-width of the drawn carriageway for this edge, metres. */
export function edgeHalfWidth(edge: RoadEdge): number {
  return (edge.lanes * LANE_WIDTH_M[edge.klass]) / 2;
}

/**
 * Classify a turn between two edges as `straight`, `left`, `right` or `uturn`.
 * Used for right-of-way at unsignalised junctions.
 */
export function turnType(
  from: RoadEdge,
  to: RoadEdge,
): 'straight' | 'left' | 'right' | 'uturn' {
  let delta = to.inHeading - from.outHeading;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;

  const abs = Math.abs(delta);
  if (abs < Math.PI / 6) return 'straight';
  if (abs > (5 * Math.PI) / 6) return 'uturn';
  return delta > 0 ? 'left' : 'right';
}
