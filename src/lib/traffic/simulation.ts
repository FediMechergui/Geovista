/**
 * Vehicle microsimulation over the road graph.
 *
 * ## The model
 *
 * Longitudinal motion uses the **Intelligent Driver Model** (Treiber, Hennecke
 * & Helbing 2000), the standard continuous car-following model: a driver
 * accelerates toward a desired speed and brakes as a function of the gap and
 * the closing rate to the vehicle ahead. It reproduces the things that make
 * traffic look like traffic — queues forming behind a red light, stop-and-go
 * waves on a busy road, the slow discharge of a junction after green.
 *
 * On top of that sit the discrete decisions:
 *
 *   - **Signals** — a fixed two-phase cycle at every OSM `traffic_signals`
 *     node, with the phases derived from the approach axis, plus an amber a
 *     driver stops for only if they can do so comfortably.
 *   - **Priority** — at an untagged junction the smaller road yields. A
 *     yielding driver accepts a gap only when every higher-priority approach
 *     is more than a critical time away.
 *   - **Spillback** — a driver will not enter a link that has no room, so
 *     congestion propagates backward through the network instead of vehicles
 *     piling up inside each other.
 *   - **Lane choice** — vehicles pick the emptiest lane on entry and make
 *     discretionary changes when the neighbouring lane is clearly better.
 *
 * Everything is driven by a seeded RNG, so the same seed replays exactly the
 * same traffic — which is what makes the congestion analytics comparable
 * between runs.
 */

import type {
  EdgeStats,
  LevelOfService,
  RoadEdge,
  RoadGraph,
  SimConfig,
  TrafficStats,
  VehicleKind,
  VehiclePose,
  VehicleState,
} from '@/types/traffic';
import { CLASS_PRIORITY, laneOffset, pointAt } from '@/lib/traffic/roadGraph';
import { makeRng, randomRoute } from '@/lib/traffic/routing';
import { VEHICLE_SPECS, canUse, fleetDistribution, sampleKind } from '@/lib/traffic/vehicles';

/* ================================================================== */
/*  Model constants                                                    */
/* ================================================================== */

/** Fixed integration step, seconds. Small enough that IDM stays stable. */
const SUB_STEP = 0.1;
/** Never advance more than this much simulated time in one call. */
const MAX_STEP = 1.0;

/** IDM desired time headway, seconds. */
const TIME_HEADWAY = 1.3;
/** IDM acceleration exponent. */
const IDM_DELTA = 4;
/** Braking beyond this is an emergency, used to cap the model's output. */
const MAX_DECEL = 8;

/** How far ahead a vehicle looks past the end of its current edge, metres. */
const LOOKAHEAD_M = 120;

/** Distance from the junction where a driver commits to stopping, metres. */
const STOP_ZONE_M = 45;
/** Amber duration at the end of each green phase, seconds. */
const AMBER_S = 3;
/** Gap on a priority road a yielding driver needs before pulling out, seconds. */
const CRITICAL_GAP_S = 4.5;
/**
 * A vehicle slower than this on a conflicting approach is queued, not
 * arriving. Without this test two cars stopped at the same junction each read
 * the other as "about to arrive" and neither ever moves.
 */
const APPROACHING_SPEED = 1.2;
/**
 * After this long held at a give-way line a driver nudges out and takes the
 * gap. Real drivers do, and it is also the backstop that guarantees the
 * network cannot deadlock whatever the junction geometry turns out to be.
 */
const YIELD_PATIENCE_S = 8;
/** How long a driver waits at a stop sign before looking for a gap, seconds. */
const STOP_SIGN_WAIT_S = 1.5;
/** Below this speed a vehicle counts as stopped for the delay statistic. */
const STOPPED_SPEED = 0.6;
/**
 * Clearance beyond the vehicle's own standstill gap at which it counts as
 * having arrived at the end of its route.
 *
 * This margin matters more than it looks. A vehicle at the end of its route
 * treats the end of the edge as a stationary obstacle, so IDM parks it one
 * standstill gap short — 2 m for a car but 4 m for a truck. A fixed arrival
 * threshold smaller than that gap leaves heavy vehicles stopped in the
 * carriageway for good, blocking everything behind them, and on a grid that
 * is enough to lock the whole network within ten minutes. Scaling with the
 * vehicle's own gap, plus a dwell test for anything that parks further back,
 * means no vehicle of any class can become a permanent obstruction.
 */
const ARRIVAL_M = 2;
/** A stopped vehicle at the end of its route has parked after this long. */
const PARKED_S = 2;

/** Statistics window, seconds — flow and throughput are averaged over it. */
const STATS_WINDOW_S = 5;
/** Samples kept in the throughput series. */
const THROUGHPUT_SAMPLES = 48;

/** Speed ratio (actual / limit) at or above which each level of service holds. */
const LOS_THRESHOLDS: Array<[LevelOfService, number]> = [
  ['A', 0.9],
  ['B', 0.75],
  ['C', 0.6],
  ['D', 0.45],
  ['E', 0.3],
  ['F', 0],
];

export function levelOfService(speedRatio: number): LevelOfService {
  for (const [los, threshold] of LOS_THRESHOLDS) {
    if (speedRatio >= threshold) return los;
  }
  return 'F';
}

/* ================================================================== */
/*  Internal per-edge bookkeeping                                      */
/* ================================================================== */

interface EdgeRuntime {
  /** Vehicles on this edge, sorted by `s` ascending (index 0 is furthest back). */
  vehicles: VehicleState[];
  /** Vehicles that left the downstream end inside the current stats window. */
  exits: number;
  /** Last computed statistics. */
  stats: EdgeStats;
}

interface SignalRuntime {
  phase: 0 | 1;
  /** Seconds remaining in the current phase. */
  remaining: number;
}

/* ================================================================== */
/*  Simulation                                                         */
/* ================================================================== */

export class TrafficSimulation {
  readonly graph: RoadGraph;

  private config: SimConfig;
  private rng: () => number;
  private distribution = fleetDistribution(0.12);

  private vehicles = new Map<number, VehicleState>();
  private edgeRuntime = new Map<number, EdgeRuntime>();
  private signals = new Map<number, SignalRuntime>();

  /** Edges vehicles may be spawned on, weighted toward network entry points. */
  private spawnEdges: RoadEdge[] = [];
  /** Highest-priority class among the approaches to each node. */
  private nodePriority = new Map<number, number>();

  private nextVehicleId = 1;
  private simTime = 0;
  private windowTime = 0;
  private windowExits = 0;
  private completed = 0;
  private throughput: number[] = [];
  private carryOver = 0;

  constructor(graph: RoadGraph, config: SimConfig) {
    this.graph = graph;
    this.config = { ...config };
    this.rng = makeRng(config.seed);
    this.distribution = fleetDistribution(config.heavyShare);

    for (const edge of graph.edges.values()) {
      this.edgeRuntime.set(edge.id, {
        vehicles: [],
        exits: 0,
        stats: {
          edge: edge.id,
          count: 0,
          density: 0,
          flow: 0,
          meanSpeed: edge.speedLimit,
          speedRatio: 1,
          los: 'A',
        },
      });
    }

    for (const node of graph.nodes.values()) {
      let best = 0;
      for (const id of node.incoming) {
        const edge = graph.edges.get(id);
        if (edge) best = Math.max(best, CLASS_PRIORITY[edge.klass]);
      }
      this.nodePriority.set(node.id, best);

      if (node.control === 'signal' && node.signalGroup) {
        // Offset each intersection deterministically so the whole city does
        // not switch in lockstep.
        const offset = (node.id % 1000) / 1000;
        const half = this.config.signalCycleS / 2;
        this.signals.set(node.id, {
          phase: offset < 0.5 ? 0 : 1,
          remaining: half * (0.35 + offset * 0.6),
        });
      }
    }

    this.buildSpawnEdges();
  }

  /* ---------------- Configuration ---------------- */

  setConfig(patch: Partial<SimConfig>): void {
    const reseed = patch.seed !== undefined && patch.seed !== this.config.seed;
    this.config = { ...this.config, ...patch };
    if (patch.heavyShare !== undefined) {
      this.distribution = fleetDistribution(this.config.heavyShare);
    }
    if (reseed) {
      this.rng = makeRng(this.config.seed);
      this.reset();
    }
  }

  getConfig(): SimConfig {
    return { ...this.config };
  }

  /** Clear all vehicles and statistics but keep the graph and signal state. */
  reset(): void {
    this.vehicles.clear();
    for (const runtime of this.edgeRuntime.values()) {
      runtime.vehicles.length = 0;
      runtime.exits = 0;
    }
    this.simTime = 0;
    this.windowTime = 0;
    this.windowExits = 0;
    this.completed = 0;
    this.throughput = [];
    this.carryOver = 0;
  }

  /* ---------------- Spawning ---------------- */

  private buildSpawnEdges(): void {
    const { graph } = this;
    const sources = graph.sources
      .map((id) => graph.edges.get(id))
      .filter((e): e is RoadEdge => !!e && e.length > 15);

    // Entry points get the strongest weight, but seeding traffic only at the
    // boundary leaves the middle of a small region empty for a long time, so
    // longer interior edges are eligible too.
    const interior = [...graph.edges.values()].filter(
      (e) => e.length > 40 && CLASS_PRIORITY[e.klass] >= 2,
    );

    this.spawnEdges = sources.length > 0 ? [...sources, ...sources, ...interior] : interior;
  }

  /** Whether a vehicle of `length` can be inserted at the start of `edge`. */
  private hasRoomAtEntry(edge: RoadEdge, lane: number, length: number): boolean {
    const runtime = this.edgeRuntime.get(edge.id);
    if (!runtime) return false;
    for (const v of runtime.vehicles) {
      if (v.lane !== lane) continue;
      if (v.s < length + VEHICLE_SPECS[v.kind].minGap + 6) return false;
    }
    return true;
  }

  private spawnVehicle(): boolean {
    if (this.spawnEdges.length === 0) return false;

    for (let attempt = 0; attempt < 12; attempt++) {
      const edge = this.spawnEdges[Math.floor(this.rng() * this.spawnEdges.length)];
      if (!edge) continue;

      const kind = sampleKind(this.distribution, this.rng());
      if (!canUse(kind, edge.klass)) continue;

      const spec = VEHICLE_SPECS[kind];
      const lane = Math.floor(this.rng() * edge.lanes);
      if (!this.hasRoomAtEntry(edge, lane, spec.length)) continue;

      const route = randomRoute(this.graph, edge, this.rng, 1500 + this.rng() * 3500);
      const palette = spec.palette;
      const desired = this.desiredSpeedOn(edge, kind);

      const vehicle: VehicleState = {
        id: this.nextVehicleId++,
        kind,
        color: palette[Math.floor(this.rng() * palette.length)],
        edge: edge.id,
        lane,
        s: 0,
        // Enter at a realistic cruising speed rather than from a standstill.
        speed: desired * (0.55 + this.rng() * 0.35),
        route,
        routeIndex: 0,
        desiredSpeed: desired,
        stoppedFor: 0,
        age: 0,
        yielding: false,
      };

      this.vehicles.set(vehicle.id, vehicle);
      this.edgeRuntime.get(edge.id)?.vehicles.push(vehicle);
      return true;
    }

    return false;
  }

  private desiredSpeedOn(edge: RoadEdge, kind: VehicleKind): number {
    const spec = VEHICLE_SPECS[kind];
    // ±8 % driver-to-driver variation on top of the class speed factor.
    const variation = 0.92 + this.rng() * 0.16;
    return Math.max(2, edge.speedLimit * spec.speedFactor * variation);
  }

  private despawn(vehicle: VehicleState, completedRoute: boolean): void {
    this.vehicles.delete(vehicle.id);
    const runtime = this.edgeRuntime.get(vehicle.edge);
    if (runtime) {
      const idx = runtime.vehicles.indexOf(vehicle);
      if (idx >= 0) runtime.vehicles.splice(idx, 1);
    }
    if (completedRoute) {
      this.completed++;
      this.windowExits++;
    }
  }

  /* ---------------- Signals ---------------- */

  private updateSignals(dt: number): void {
    const half = Math.max(8, this.config.signalCycleS / 2);
    for (const signal of this.signals.values()) {
      signal.remaining -= dt;
      if (signal.remaining <= 0) {
        signal.phase = signal.phase === 0 ? 1 : 0;
        signal.remaining += half;
      }
    }
  }

  /** Signal state for a vehicle approaching `nodeId` on `edgeId`. */
  private signalState(nodeId: number, edgeId: number): 'green' | 'amber' | 'red' | 'none' {
    const signal = this.signals.get(nodeId);
    if (!signal) return 'none';
    const node = this.graph.nodes.get(nodeId);
    const group = node?.signalGroup?.[edgeId];
    if (group === undefined) return 'none';
    if (group !== signal.phase) return 'red';
    return signal.remaining <= AMBER_S ? 'amber' : 'green';
  }

  /** Current light for rendering a signal head on `edgeId`. */
  lightFor(nodeId: number, edgeId: number): 'green' | 'amber' | 'red' | null {
    const state = this.signalState(nodeId, edgeId);
    return state === 'none' ? null : state;
  }

  /* ---------------- Right of way ---------------- */

  /**
   * True when a vehicle must yield before entering `node` from `edge` — i.e.
   * a higher-priority approach has a vehicle arriving within the critical gap.
   */
  private mustYield(nodeId: number, edge: RoadEdge, waited: number): boolean {
    const node = this.graph.nodes.get(nodeId);
    if (!node) return false;

    // Patience runs out: take the gap rather than sit there forever.
    if (waited > YIELD_PATIENCE_S) return false;

    const myPriority = CLASS_PRIORITY[edge.klass];
    const nodeBest = this.nodePriority.get(nodeId) ?? myPriority;
    /** A tagged stop or give-way line always forces a look, whatever the class. */
    const controlled = node.control === 'stop' || node.control === 'give_way';

    // Roundabouts: circulating traffic always has priority over entering.
    const enteringRoundabout =
      !edge.roundabout &&
      node.outgoing.some((id) => this.graph.edges.get(id)?.roundabout === true);

    if (!enteringRoundabout && !controlled && myPriority >= nodeBest) return false;

    for (const otherId of node.incoming) {
      if (otherId === edge.id) continue;
      const other = this.graph.edges.get(otherId);
      if (!other) continue;

      const otherPriority = CLASS_PRIORITY[other.klass];
      if (!other.roundabout && !controlled && otherPriority <= myPriority) continue;

      const runtime = this.edgeRuntime.get(otherId);
      if (!runtime || runtime.vehicles.length === 0) continue;

      // Nearest vehicle to the junction on the conflicting approach. One that
      // is stopped is waiting its own turn, not bearing down on us.
      const nearest = runtime.vehicles[runtime.vehicles.length - 1];
      if (nearest.speed < APPROACHING_SPEED) continue;

      const distance = other.length - nearest.s;
      const timeToNode = distance / nearest.speed;
      if (timeToNode < CRITICAL_GAP_S) return true;
    }

    return false;
  }

  /* ---------------- Car following ---------------- */

  /**
   * IDM acceleration for `vehicle` given the gap to and speed of its leader.
   * A `gap` of `Infinity` means open road.
   */
  private idmAccel(vehicle: VehicleState, gap: number, leaderSpeed: number): number {
    const spec = VEHICLE_SPECS[vehicle.kind];
    const v = vehicle.speed;
    const v0 = vehicle.desiredSpeed;

    const free = 1 - Math.pow(v / v0, IDM_DELTA);
    if (!Number.isFinite(gap)) return spec.accel * free;

    const dv = v - leaderSpeed;
    const sStar =
      spec.minGap +
      Math.max(0, v * TIME_HEADWAY + (v * dv) / (2 * Math.sqrt(spec.accel * spec.decel)));

    const safeGap = Math.max(gap, 0.3);
    const interaction = Math.pow(sStar / safeGap, 2);
    return spec.accel * (free - interaction);
  }

  /**
   * Find the gap and speed of whatever constrains `vehicle` — the vehicle
   * ahead in its lane, a vehicle already queued on the next edge, or a red
   * light / yield line at the junction.
   */
  private constraintFor(
    vehicle: VehicleState,
    edge: RoadEdge,
  ): { gap: number; leaderSpeed: number; blocking: boolean } {
    const runtime = this.edgeRuntime.get(edge.id);
    const spec = VEHICLE_SPECS[vehicle.kind];

    let gap = Infinity;
    let leaderSpeed = 0;

    // 1. Leader in the same lane on this edge.
    if (runtime) {
      const list = runtime.vehicles;
      const idx = list.indexOf(vehicle);
      // A vehicle that is not in its own edge list would otherwise scan from
      // index 0 and pick a leader that is actually behind it.
      for (let i = idx < 0 ? list.length : idx + 1; i < list.length; i++) {
        const other = list[i];
        if (other.lane !== vehicle.lane) continue;
        gap = other.s - vehicle.s - VEHICLE_SPECS[other.kind].length;
        leaderSpeed = other.speed;
        break;
      }
    }

    const distanceToEnd = edge.length - vehicle.s;
    if (gap <= distanceToEnd && Number.isFinite(gap)) {
      return { gap, leaderSpeed, blocking: false };
    }

    // 2. The junction itself: red light, yield, or a full downstream link.
    const nextEdgeId = vehicle.route[vehicle.routeIndex + 1];
    const nextEdge = nextEdgeId !== undefined ? this.graph.edges.get(nextEdgeId) : undefined;

    if (distanceToEnd < STOP_ZONE_M) {
      const light = this.signalState(edge.to, edge.id);
      const stoppingDistance = (vehicle.speed * vehicle.speed) / (2 * spec.decel);

      let mustStop = false;
      if (light === 'red') {
        mustStop = true;
      } else if (light === 'amber') {
        // Stop for amber only if it can be done without emergency braking.
        mustStop = stoppingDistance < distanceToEnd;
      } else if (light === 'none') {
        const node = this.graph.nodes.get(edge.to);
        const needsStopSign =
          node?.control === 'stop' && vehicle.stoppedFor < STOP_SIGN_WAIT_S && vehicle.speed > 0.2;
        mustStop = needsStopSign || this.mustYield(edge.to, edge, vehicle.stoppedFor);
      }

      // Spillback: never enter a link with no room at its upstream end.
      if (!mustStop && nextEdge) {
        const nextRuntime = this.edgeRuntime.get(nextEdge.id);
        if (nextRuntime) {
          for (const other of nextRuntime.vehicles) {
            if (other.s < spec.length + spec.minGap + 2) {
              mustStop = true;
              break;
            }
          }
        }
      }

      if (mustStop) {
        vehicle.yielding = true;
        // A virtual stationary obstacle one metre before the stop line.
        return { gap: Math.max(distanceToEnd - 1, 0.3), leaderSpeed: 0, blocking: true };
      }
    }

    vehicle.yielding = false;

    // 3. Queue spilling back from the next edge, within the lookahead window.
    if (nextEdge && distanceToEnd < LOOKAHEAD_M) {
      const nextRuntime = this.edgeRuntime.get(nextEdge.id);
      if (nextRuntime && nextRuntime.vehicles.length > 0) {
        const first = nextRuntime.vehicles[0];
        const aheadGap = distanceToEnd + first.s - VEHICLE_SPECS[first.kind].length;
        if (aheadGap < gap) {
          gap = aheadGap;
          leaderSpeed = first.speed;
        }
      }
    } else if (!nextEdge && distanceToEnd < STOP_ZONE_M) {
      // End of route: coast to a halt at the boundary rather than teleporting.
      const endGap = Math.max(distanceToEnd - 1, 0.3);
      if (endGap < gap) {
        gap = endGap;
        leaderSpeed = 0;
      }
    }

    return { gap, leaderSpeed, blocking: false };
  }

  /* ---------------- Lane changing ---------------- */

  /** Gap ahead of `s` in `lane`, and the gap behind, on `edge`. */
  private laneGaps(
    edge: RoadEdge,
    lane: number,
    s: number,
    exclude: VehicleState,
  ): { ahead: number; behind: number; leaderSpeed: number } {
    const runtime = this.edgeRuntime.get(edge.id);
    let ahead = edge.length - s;
    let behind = s;
    let leaderSpeed = edge.speedLimit;
    if (!runtime) return { ahead, behind, leaderSpeed };

    for (const other of runtime.vehicles) {
      if (other === exclude || other.lane !== lane) continue;
      const spec = VEHICLE_SPECS[other.kind];
      if (other.s >= s) {
        const d = other.s - s - spec.length;
        if (d < ahead) {
          ahead = d;
          leaderSpeed = other.speed;
        }
      } else {
        const d = s - other.s;
        if (d < behind) behind = d;
      }
    }

    return { ahead, behind, leaderSpeed };
  }

  private considerLaneChange(vehicle: VehicleState, edge: RoadEdge): void {
    if (edge.lanes < 2) return;

    const spec = VEHICLE_SPECS[vehicle.kind];
    const current = this.laneGaps(edge, vehicle.lane, vehicle.s, vehicle);
    // Only bother when actually held up.
    if (current.ahead > 60 || vehicle.speed > vehicle.desiredSpeed * 0.85) return;

    for (const delta of [-1, 1]) {
      const lane = vehicle.lane + delta;
      if (lane < 0 || lane >= edge.lanes) continue;

      const candidate = this.laneGaps(edge, lane, vehicle.s, vehicle);
      const safeBehind = spec.length + spec.minGap + vehicle.speed * 0.6;
      const gainThreshold = current.ahead * 1.35 + spec.length;

      if (candidate.ahead > gainThreshold && candidate.behind > safeBehind) {
        vehicle.lane = lane;
        return;
      }
    }
  }

  /* ---------------- Integration ---------------- */

  private advance(dt: number): void {
    this.updateSignals(dt);

    // Keep every edge's vehicle list ordered by position; the leader search
    // and the spillback checks both rely on it.
    for (const runtime of this.edgeRuntime.values()) {
      if (runtime.vehicles.length > 1) runtime.vehicles.sort((a, b) => a.s - b.s);
    }

    const transitions: VehicleState[] = [];

    for (const vehicle of this.vehicles.values()) {
      const edge = this.graph.edges.get(vehicle.edge);
      if (!edge) {
        transitions.push(vehicle);
        continue;
      }

      const spec = VEHICLE_SPECS[vehicle.kind];
      const { gap, leaderSpeed } = this.constraintFor(vehicle, edge);
      const accel = Math.max(-MAX_DECEL, Math.min(spec.accel, this.idmAccel(vehicle, gap, leaderSpeed)));

      vehicle.speed = Math.max(0, vehicle.speed + accel * dt);
      vehicle.s += vehicle.speed * dt;
      vehicle.age += dt;
      vehicle.stoppedFor = vehicle.speed < STOPPED_SPEED ? vehicle.stoppedFor + dt : 0;

      const distanceToEnd = edge.length - vehicle.s;
      const atRouteEnd = vehicle.route[vehicle.routeIndex + 1] === undefined;
      const arrived =
        atRouteEnd &&
        (distanceToEnd < spec.minGap + ARRIVAL_M ||
          (vehicle.stoppedFor > PARKED_S && distanceToEnd < STOP_ZONE_M));

      if (vehicle.s >= edge.length || arrived) transitions.push(vehicle);
      else if (edge.lanes > 1 && vehicle.age % 1 < dt) this.considerLaneChange(vehicle, edge);
    }

    for (const vehicle of transitions) this.transition(vehicle);
  }

  /** Move a vehicle onto the next edge of its route, or retire it. */
  private transition(vehicle: VehicleState): void {
    const edge = this.graph.edges.get(vehicle.edge);
    const overshoot = edge ? vehicle.s - edge.length : 0;

    const fromRuntime = this.edgeRuntime.get(vehicle.edge);
    if (fromRuntime) {
      const idx = fromRuntime.vehicles.indexOf(vehicle);
      if (idx >= 0) fromRuntime.vehicles.splice(idx, 1);
      fromRuntime.exits++;
    }

    // A vehicle drives the route it was given and then its trip is over: it
    // has arrived and parked. Extending the route here instead would be a
    // subtle trap — `constraintFor` reads `route[routeIndex + 1]` while the
    // vehicle is still approaching the junction, so a route extended only at
    // hand-off time always looks exhausted from inside the edge, and every
    // vehicle would brake to a halt at every junction for the rest of its life.
    const nextId = vehicle.route[vehicle.routeIndex + 1];
    const next = nextId !== undefined ? this.graph.edges.get(nextId) : undefined;
    if (!next) {
      this.despawn(vehicle, true);
      return;
    }

    vehicle.edge = next.id;
    vehicle.routeIndex++;
    vehicle.s = Math.max(0, Math.min(overshoot, next.length * 0.5));
    vehicle.desiredSpeed = this.desiredSpeedOn(next, vehicle.kind);
    vehicle.lane = this.chooseLane(next, vehicle);

    this.edgeRuntime.get(next.id)?.vehicles.push(vehicle);
  }

  /** Emptiest lane near the entry point; heavy vehicles hug the outside. */
  private chooseLane(edge: RoadEdge, vehicle: VehicleState): number {
    if (edge.lanes === 1) return 0;

    const heavy = vehicle.kind === 'truck' || vehicle.kind === 'bus';
    let bestLane = heavy ? edge.lanes - 1 : 0;
    let bestGap = -Infinity;

    for (let lane = 0; lane < edge.lanes; lane++) {
      const { ahead } = this.laneGaps(edge, lane, 0, vehicle);
      // Bias heavy vehicles toward the outer lanes, light ones toward the inner.
      const bias = heavy ? lane * 8 : (edge.lanes - 1 - lane) * 4;
      const score = ahead + bias;
      if (score > bestGap) {
        bestGap = score;
        bestLane = lane;
      }
    }

    return bestLane;
  }

  /* ---------------- Public step ---------------- */

  /**
   * Advance the simulation by `wallDt` real seconds, scaled by `timeScale`.
   * Work is split into fixed sub-steps and clamped, so a long frame (tab in
   * the background, a slow tile fetch) never explodes into a huge jump.
   */
  step(wallDt: number): void {
    const scaled = Math.min(MAX_STEP, Math.max(0, wallDt) * this.config.timeScale) + this.carryOver;
    const steps = Math.floor(scaled / SUB_STEP);
    this.carryOver = scaled - steps * SUB_STEP;

    for (let i = 0; i < steps; i++) {
      this.advance(SUB_STEP);
      this.simTime += SUB_STEP;
      this.windowTime += SUB_STEP;
    }

    if (steps > 0) this.topUpFleet();
    if (this.windowTime >= STATS_WINDOW_S) this.closeStatsWindow();
  }

  /** Keep the vehicle count near the target without spawning a burst. */
  private topUpFleet(): void {
    const deficit = this.config.targetVehicles - this.vehicles.size;
    if (deficit <= 0) return;
    const budget = Math.min(deficit, 4);
    for (let i = 0; i < budget; i++) {
      if (!this.spawnVehicle()) break;
    }
  }

  /* ---------------- Statistics ---------------- */

  private closeStatsWindow(): void {
    const window = this.windowTime;

    for (const [edgeId, runtime] of this.edgeRuntime) {
      const edge = this.graph.edges.get(edgeId);
      if (!edge) continue;

      const count = runtime.vehicles.length;
      let speedSum = 0;
      for (const v of runtime.vehicles) speedSum += v.speed;

      // An empty link is running at the limit by definition — reporting 0 m/s
      // would paint every quiet street as gridlocked.
      const meanSpeed = count > 0 ? speedSum / count : edge.speedLimit;
      const speedRatio = Math.max(0, Math.min(1, meanSpeed / Math.max(1, edge.speedLimit)));

      runtime.stats = {
        edge: edgeId,
        count,
        density: count / Math.max(0.01, (edge.length / 1000) * edge.lanes),
        flow: (runtime.exits / window) * 3600,
        meanSpeed,
        speedRatio,
        los: count > 0 ? levelOfService(speedRatio) : 'A',
      };
      runtime.exits = 0;
    }

    this.throughput.push((this.windowExits / window) * 3600);
    if (this.throughput.length > THROUGHPUT_SAMPLES) this.throughput.shift();

    this.windowExits = 0;
    this.windowTime = 0;
  }

  /** Per-edge rolling statistics, keyed by edge id. */
  edgeStats(): Map<number, EdgeStats> {
    const out = new Map<number, EdgeStats>();
    for (const [id, runtime] of this.edgeRuntime) out.set(id, runtime.stats);
    return out;
  }

  /** Network-wide statistics for the analytics panel. */
  stats(): TrafficStats {
    let speedSum = 0;
    let congested = 0;
    let delaySum = 0;

    for (const vehicle of this.vehicles.values()) {
      speedSum += vehicle.speed;
      delaySum += vehicle.stoppedFor;
      if (vehicle.speed < vehicle.desiredSpeed * 0.3) congested++;
    }

    const n = this.vehicles.size;

    const hotspots = [...this.edgeRuntime.values()]
      .filter((r) => r.stats.count > 0 && r.stats.los >= 'D')
      .sort((a, b) => b.stats.count / (b.stats.speedRatio + 0.05) - a.stats.count / (a.stats.speedRatio + 0.05))
      .slice(0, 8)
      .map((r) => {
        const edge = this.graph.edges.get(r.stats.edge)!;
        return {
          edge: r.stats.edge,
          name: edge.name ?? edge.ref ?? `${edge.klass} #${edge.wayId}`,
          klass: edge.klass,
          los: r.stats.los,
          meanSpeed: r.stats.meanSpeed,
          speedLimit: edge.speedLimit,
          count: r.stats.count,
        };
      });

    return {
      simTime: this.simTime,
      vehicles: n,
      meanSpeed: n > 0 ? speedSum / n : 0,
      congestedShare: n > 0 ? congested / n : 0,
      completed: this.completed,
      meanDelay: n > 0 ? delaySum / n : 0,
      throughput: [...this.throughput],
      hotspots,
    };
  }

  /* ---------------- Rendering ---------------- */

  /**
   * Fill `out` with a pose per vehicle, reusing the array so the render loop
   * allocates nothing. Returns the same array truncated to the live count.
   */
  poses(out: VehiclePose[] = []): VehiclePose[] {
    let i = 0;

    for (const vehicle of this.vehicles.values()) {
      const edge = this.graph.edges.get(vehicle.edge);
      if (!edge) continue;

      const { x, y, heading } = pointAt(edge, vehicle.s);
      const offset = laneOffset(edge, vehicle.lane);
      // Right of the direction of travel: rotate the heading by −90°.
      const px = x + Math.sin(heading) * offset;
      const py = y - Math.cos(heading) * offset;

      const braking = vehicle.speed < vehicle.desiredSpeed * 0.5 && vehicle.speed < 8;

      const pose = out[i];
      if (pose) {
        pose.id = vehicle.id;
        pose.kind = vehicle.kind;
        pose.color = vehicle.color;
        pose.x = px;
        pose.y = py;
        pose.heading = heading;
        pose.speed = vehicle.speed;
        pose.edge = vehicle.edge;
        pose.braking = braking;
      } else {
        out.push({
          id: vehicle.id,
          kind: vehicle.kind,
          color: vehicle.color,
          x: px,
          y: py,
          heading,
          speed: vehicle.speed,
          edge: vehicle.edge,
          braking,
        });
      }
      i++;
    }

    out.length = i;
    return out;
  }

  /** Live speed oracle for routing that accounts for current congestion. */
  liveSpeedOf = (edge: RoadEdge): number => {
    const stats = this.edgeRuntime.get(edge.id)?.stats;
    if (!stats || stats.count === 0) return edge.speedLimit;
    return Math.max(1.5, stats.meanSpeed);
  };

  get vehicleCount(): number {
    return this.vehicles.size;
  }
}
