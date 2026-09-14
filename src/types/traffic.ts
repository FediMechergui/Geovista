/**
 * Road network + traffic microsimulation types.
 *
 * The road graph is engine-agnostic: geometry is stored both in geographic
 * degrees (for Cesium / export) and in a local east-north metric frame
 * centred on the region (for the simulation and for Three.js). Both viewers
 * drive the same `TrafficSimulation`, so a vehicle is always at the same
 * place on the globe and on the analytical terrain.
 */

import type { BBox } from '@/types/geo';

/* ================================================================== */
/*  Road network                                                       */
/* ================================================================== */

/**
 * Simulated road classes, ordered by priority (motorway wins at an
 * unsignalised junction). Everything OSM calls a highway that a car cannot
 * drive on is dropped at parse time.
 */
export type RoadClass =
  | 'motorway'
  | 'trunk'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'residential'
  | 'unclassified'
  | 'service'
  | 'living_street';

/** Junction control inferred from OSM node tags. */
export type NodeControl = 'signal' | 'stop' | 'give_way' | 'none';

export interface RoadNode {
  /** OSM node id. */
  id: number;
  lon: number;
  lat: number;
  /** Local metric frame (metres, +x east / +y north). */
  x: number;
  y: number;
  control: NodeControl;
  /** Edge ids entering this node. */
  incoming: number[];
  /** Edge ids leaving this node. */
  outgoing: number[];
  /** Signal group index (0 or 1); opposing approaches get different groups. */
  signalGroup?: Record<number, 0 | 1>;
}

/**
 * A directed road segment between two junction nodes. A two-way OSM way
 * produces two edges that share geometry but run in opposite directions.
 */
export interface RoadEdge {
  id: number;
  /** OSM way id this edge came from (several edges share one way id). */
  wayId: number;
  from: number;
  to: number;
  klass: RoadClass;
  name?: string;
  /** Reference number, e.g. "A1". */
  ref?: string;
  /** Polyline in the local metric frame, from → to, including both ends. */
  points: Float64Array;
  /** Cumulative arc length at each point (metres); last entry = `length`. */
  cumulative: Float64Array;
  /** Total length in metres. */
  length: number;
  /** Lane count in this direction (≥ 1). */
  lanes: number;
  /** Free-flow speed in m/s. */
  speedLimit: number;
  /** True when this edge is part of a roundabout. */
  roundabout: boolean;
  bridge: boolean;
  tunnel: boolean;
  /** Vertical layer for overpass separation (OSM `layer`). */
  layer: number;
  /** Heading in radians at the `to` end, used for turn classification. */
  outHeading: number;
  /** Heading in radians at the `from` end. */
  inHeading: number;
}

export interface RoadGraph {
  nodes: Map<number, RoadNode>;
  edges: Map<number, RoadEdge>;
  /** Region the graph was built for. */
  bbox: BBox;
  /** Local frame origin (metric coordinates are relative to this). */
  origin: { lon: number; lat: number };
  /** Edges whose `from` node sits on the region boundary — traffic sources. */
  sources: number[];
  /** Edges whose `to` node sits on the region boundary — traffic sinks. */
  sinks: number[];
  /** Total drivable centreline length in metres. */
  totalLengthM: number;
}

/* ================================================================== */
/*  Vehicles                                                           */
/* ================================================================== */

export type VehicleKind = 'car' | 'taxi' | 'van' | 'bus' | 'truck' | 'motorcycle';

export interface VehicleSpec {
  kind: VehicleKind;
  /** Metres. */
  length: number;
  width: number;
  height: number;
  /** Comfortable acceleration, m/s². */
  accel: number;
  /** Comfortable deceleration, m/s² (positive). */
  decel: number;
  /** Multiplier on the posted speed limit for this driver class. */
  speedFactor: number;
  /** Minimum bumper-to-bumper gap at standstill, metres. */
  minGap: number;
  /** Relative share of the fleet. */
  share: number;
  /** Body colours to choose from. */
  palette: string[];
  /** Road classes this vehicle avoids (e.g. trucks off living streets). */
  avoids?: RoadClass[];
}

export interface VehicleState {
  id: number;
  kind: VehicleKind;
  /** Index into the vehicle's colour palette, resolved to a hex at render time. */
  color: string;
  /** Current edge id. */
  edge: number;
  /** Lane index, 0 = innermost (nearest the centreline). */
  lane: number;
  /** Distance travelled along the current edge, metres. */
  s: number;
  /** Speed, m/s. */
  speed: number;
  /** Planned route as a list of edge ids; `routeIndex` points at `edge`. */
  route: number[];
  routeIndex: number;
  /** Desired speed on the current edge, m/s. */
  desiredSpeed: number;
  /** Seconds spent stopped (speed < 0.5 m/s) — feeds the delay statistic. */
  stoppedFor: number;
  /** Seconds since spawn. */
  age: number;
  /** True while the vehicle is waiting to enter a junction. */
  yielding: boolean;
}

/** Render-ready pose in the local metric frame. */
export interface VehiclePose {
  id: number;
  kind: VehicleKind;
  color: string;
  x: number;
  y: number;
  /** Heading in radians, 0 = east, counter-clockwise. */
  heading: number;
  speed: number;
  /** Edge the vehicle is on, for congestion lookup. */
  edge: number;
  /** True when braking hard — used to light the brake lamps. */
  braking: boolean;
}

/* ================================================================== */
/*  Simulation                                                         */
/* ================================================================== */

export interface SimConfig {
  /** Target number of vehicles in the network. */
  targetVehicles: number;
  /** Simulation speed multiplier applied to wall-clock time. */
  timeScale: number;
  /** RNG seed — the same seed replays the same traffic exactly. */
  seed: number;
  /** Fraction of junctions with no OSM signal tag that still get a signal. */
  signalCycleS: number;
  /** Share of heavy vehicles (bus + truck), 0–1; rescales the fleet mix. */
  heavyShare: number;
}

export const DEFAULT_SIM_CONFIG: SimConfig = {
  targetVehicles: 220,
  timeScale: 1,
  seed: 20260914,
  signalCycleS: 60,
  heavyShare: 0.12,
};

/** Level of service, the standard A (free flow) → F (breakdown) scale. */
export type LevelOfService = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/** Rolling statistics for one directed edge. */
export interface EdgeStats {
  edge: number;
  /** Vehicles currently on the edge. */
  count: number;
  /** Vehicles per kilometre per lane. */
  density: number;
  /** Vehicles per hour past the downstream end. */
  flow: number;
  /** Space-mean speed, m/s. */
  meanSpeed: number;
  /** meanSpeed / speedLimit, clamped to [0, 1]. */
  speedRatio: number;
  los: LevelOfService;
}

export interface TrafficStats {
  /** Simulated seconds elapsed. */
  simTime: number;
  vehicles: number;
  /** Network-wide space-mean speed, m/s. */
  meanSpeed: number;
  /** Share of vehicles moving below 30 % of the limit. */
  congestedShare: number;
  /** Vehicles that completed their route since the run started. */
  completed: number;
  /** Mean seconds each active vehicle has spent stopped. */
  meanDelay: number;
  /** Rolling throughput series (vehicles/hour), newest last. */
  throughput: number[];
  /** Worst edges by LOS then by length, capped at 8 entries. */
  hotspots: Array<{
    edge: number;
    name: string;
    klass: RoadClass;
    los: LevelOfService;
    meanSpeed: number;
    speedLimit: number;
    count: number;
  }>;
}

export const EMPTY_TRAFFIC_STATS: TrafficStats = {
  simTime: 0,
  vehicles: 0,
  meanSpeed: 0,
  congestedShare: 0,
  completed: 0,
  meanDelay: 0,
  throughput: [],
  hotspots: [],
};

/* ================================================================== */
/*  Routing                                                            */
/* ================================================================== */

export interface RoutePlan {
  /** Ordered edge ids from origin to destination. */
  edges: number[];
  /** Total length, metres. */
  distance: number;
  /** Free-flow travel time, seconds. */
  duration: number;
  /** Travel time using the current simulated speeds, seconds. */
  liveDuration: number;
}
