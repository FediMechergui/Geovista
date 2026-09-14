/**
 * OSM road-network fetcher for the traffic simulation.
 *
 * One Overpass query brings back everything the simulation needs:
 *   - drivable `highway=*` ways with their geometry inline (`out geom`)
 *   - the junction control nodes referenced by those ways
 *     (`traffic_signals`, `stop`, `give_way`, `mini_roundabout`)
 *
 * `out geom` gives coordinates per way but *not* node ids, and the graph
 * builder needs ids to know where two ways actually meet. So the ways are
 * requested twice in the same query: once with `out geom` (coordinates) and
 * once with `out body` (the node id list). The two are joined on the way id.
 */

import type { BBox } from '@/types/geo';
import { clampBBoxArea, MAX_AREA_KM2 } from '@/lib/geo/bbox';
import { overpassQuery, QUERY_TIMEOUT_S } from '@/lib/osm/overpass';
import type { NodeControl, RoadClass } from '@/types/traffic';

/* ================================================================== */
/*  Overpass wire format                                               */
/* ================================================================== */

interface OverpassWay {
  type: 'way';
  id: number;
  nodes?: number[];
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
}

interface OverpassNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

type OverpassElement = OverpassWay | OverpassNode;

/** A drivable way, already joined from the geom + body passes. */
export interface RawRoadWay {
  id: number;
  /** Node ids along the way, same length as `coords`. */
  nodes: number[];
  /** [lon, lat] per node. */
  coords: Array<[number, number]>;
  tags: Record<string, string>;
}

export interface RawRoadNetwork {
  ways: RawRoadWay[];
  /** Node id → junction control, only for nodes that carry a control tag. */
  controls: Map<number, NodeControl>;
  bbox: BBox;
}

/* ================================================================== */
/*  Which OSM values become which simulated road class                 */
/* ================================================================== */

/**
 * `highway=*` → simulated class. Link roads inherit their parent class;
 * anything absent from this table (footway, cycleway, path, track, steps,
 * pedestrian, construction, proposed…) is not drivable and is dropped.
 */
const DRIVABLE: Record<string, RoadClass> = {
  motorway: 'motorway',
  motorway_link: 'motorway',
  trunk: 'trunk',
  trunk_link: 'trunk',
  primary: 'primary',
  primary_link: 'primary',
  secondary: 'secondary',
  secondary_link: 'secondary',
  tertiary: 'tertiary',
  tertiary_link: 'tertiary',
  residential: 'residential',
  unclassified: 'unclassified',
  living_street: 'living_street',
  service: 'service',
};

/** The Overpass regex that matches exactly the keys of `DRIVABLE`. */
const DRIVABLE_RE = Object.keys(DRIVABLE).join('|');

export function roadClassOf(tags: Record<string, string>): RoadClass | null {
  const hw = tags.highway;
  if (!hw) return null;
  const klass = DRIVABLE[hw];
  if (!klass) return null;

  // Explicitly barred to motor vehicles, or not built yet.
  if (tags.access === 'no' || tags.access === 'private') return null;
  if (tags.motor_vehicle === 'no' || tags.motorcar === 'no') return null;
  if (tags.area === 'yes') return null;

  // Driveways and parking aisles add a lot of nodes and no interesting traffic.
  if (klass === 'service') {
    const svc = tags.service;
    if (svc && svc !== 'alley') return null;
  }
  return klass;
}

/** True when this way is tagged as a link/slip road. */
export function isLink(tags: Record<string, string>): boolean {
  return (tags.highway ?? '').endsWith('_link');
}

/* ================================================================== */
/*  Fetch                                                              */
/* ================================================================== */

/**
 * Shrink a bbox around its centre so the road query stays inside the ground
 * area Overpass can serve (see `MAX_AREA_KM2`). Returns the original box when
 * it already fits.
 */
export function clampRoadBBox(bbox: BBox, maxAreaKm2 = MAX_AREA_KM2.roads): BBox {
  return clampBBoxArea(bbox, maxAreaKm2).bbox;
}

const CONTROL_TAGS: Array<[string, NodeControl]> = [
  ['traffic_signals', 'signal'],
  ['stop', 'stop'],
  ['give_way', 'give_way'],
  ['mini_roundabout', 'give_way'],
];

function controlOf(tags: Record<string, string> | undefined): NodeControl {
  if (!tags) return 'none';
  const hw = tags.highway;
  for (const [value, control] of CONTROL_TAGS) {
    if (hw === value) return control;
  }
  return 'none';
}

/**
 * Fetch the drivable road network for a bounding box.
 *
 * Throws on network / HTTP failure. Returns an empty network (no ways) for
 * areas with nothing mapped, which the caller should treat as "no traffic"
 * rather than an error.
 */
export async function fetchRoadNetwork(
  bbox: BBox,
  signal?: AbortSignal,
): Promise<RawRoadNetwork> {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;

  // `.roads` is reused three times: geometry, node ids, and the control nodes
  // that lie on those ways.
  const query = `
    [out:json][timeout:${QUERY_TIMEOUT_S}];
    way["highway"~"^(${DRIVABLE_RE})$"](${b})->.roads;
    (
      .roads;
      node(w.roads)["highway"~"^(traffic_signals|stop|give_way|mini_roundabout)$"];
    );
    out geom;
    .roads out body;
  `;

  const elements = await overpassQuery<OverpassElement>(query, signal);

  const geomByWay = new Map<number, Array<[number, number]>>();
  const nodesByWay = new Map<number, number[]>();
  const tagsByWay = new Map<number, Record<string, string>>();
  const controls = new Map<number, NodeControl>();

  for (const el of elements) {
    if (el.type === 'node') {
      const control = controlOf(el.tags);
      if (control !== 'none') controls.set(el.id, control);
      continue;
    }
    if (el.type !== 'way') continue;

    if (el.tags) tagsByWay.set(el.id, el.tags);
    if (el.geometry) {
      geomByWay.set(
        el.id,
        el.geometry.map((g) => [g.lon, g.lat] as [number, number]),
      );
    }
    // The `out body` pass carries `nodes` but no geometry.
    if (el.nodes) nodesByWay.set(el.id, el.nodes);
  }

  const ways: RawRoadWay[] = [];
  for (const [id, coords] of geomByWay) {
    const nodes = nodesByWay.get(id);
    const tags = tagsByWay.get(id);
    // Both passes must agree on the vertex count, otherwise the id↔coordinate
    // pairing would be wrong and the graph would stitch the wrong junctions.
    if (!nodes || !tags || nodes.length !== coords.length || coords.length < 2) continue;
    if (!roadClassOf(tags)) continue;
    ways.push({ id, nodes, coords, tags });
  }

  return { ways, controls, bbox };
}
