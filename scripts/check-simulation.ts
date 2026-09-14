/**
 * Behavioural checks for the pure simulation, geology and material logic.
 *
 * These modules carry the most risk in the codebase: a traffic microsimulation
 * fails silently — it still renders, the cars still move, and only the numbers
 * are wrong. So rather than unit-testing individual functions, this harness
 * builds a synthetic street grid and asserts on the behaviour that has to hold:
 * vehicles complete trips, the same seed replays identically, signals cycle,
 * and the speed/density relationship follows a proper fundamental diagram.
 *
 * Run with `npm run check:sim`. No DOM, no network, no fixtures.
 */

import { buildRoadGraph, parseDirectionality, parseMaxSpeed } from '@/lib/traffic/roadGraph';
import { TrafficSimulation } from '@/lib/traffic/simulation';
import { planRoute } from '@/lib/traffic/routing';
import { DEFAULT_SIM_CONFIG, type NodeControl } from '@/types/traffic';
import type { RawRoadNetwork, RawRoadWay } from '@/lib/traffic/osmRoads';
import { analyseProspectivity } from '@/lib/geology/prospectivity';
import { classifyLithology } from '@/lib/geology/lithology';
import { resolveBuildingMaterial } from '@/lib/buildings/materials';
import { parseLength, parseStartYear } from '@/lib/buildings/osmFetcher';
import type { GeologicalColumn } from '@/types/geology';

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n== ${title} ==`);
}

/* ================================================================== */
/*  A synthetic street grid                                            */
/* ================================================================== */

const GRID = 6;
/** ~130 m between junctions. */
const SPACING = 0.0012;

const nodeId = (row: number, col: number) => 1000 + row * 100 + col;

interface GridOptions {
  /** Mix road classes so priority rules come into play. */
  mixedClasses?: boolean;
  /** Put traffic signals on every other junction. */
  signals?: boolean;
}

function makeGrid({ mixedClasses = false, signals = false }: GridOptions = {}): RawRoadNetwork {
  const ways: RawRoadWay[] = [];
  let wayId = 1;

  for (let row = 0; row < GRID; row++) {
    const nodes: number[] = [];
    const coords: Array<[number, number]> = [];
    for (let col = 0; col < GRID; col++) {
      nodes.push(nodeId(row, col));
      coords.push([col * SPACING, row * SPACING]);
    }
    ways.push({
      id: wayId++,
      nodes,
      coords,
      tags: { highway: mixedClasses && row % 3 === 0 ? 'secondary' : 'residential', name: `Row ${row}` },
    });
  }

  for (let col = 0; col < GRID; col++) {
    const nodes: number[] = [];
    const coords: Array<[number, number]> = [];
    for (let row = 0; row < GRID; row++) {
      nodes.push(nodeId(row, col));
      coords.push([col * SPACING, row * SPACING]);
    }
    ways.push({
      id: wayId++,
      nodes,
      coords,
      tags: { highway: mixedClasses && col % 2 === 0 ? 'primary' : 'residential', name: `Col ${col}` },
    });
  }

  const controls = new Map<number, NodeControl>();
  if (signals) {
    for (let row = 0; row < GRID; row += 2) {
      for (let col = 0; col < GRID; col += 2) controls.set(nodeId(row, col), 'signal');
    }
  }

  const span = (GRID - 1) * SPACING;
  return {
    ways,
    controls,
    bbox: { west: -0.0005, south: -0.0005, east: span + 0.0005, north: span + 0.0005 },
  };
}

/** Advance a simulation by `seconds` of simulated time. */
function run(sim: TrafficSimulation, seconds: number): void {
  for (let i = 0; i < seconds * 10; i++) sim.step(0.1);
}

/* ================================================================== */
/*  1. Tag parsing                                                     */
/* ================================================================== */

section('OSM tag parsing');

check('maxspeed "50" is 50 km/h', Math.abs((parseMaxSpeed('50') ?? 0) - 50 / 3.6) < 1e-9);
check('maxspeed "30 mph" converts', Math.abs((parseMaxSpeed('30 mph') ?? 0) - (30 * 1.609344) / 3.6) < 1e-9);
check('maxspeed "DE:urban" resolves', Math.abs((parseMaxSpeed('DE:urban') ?? 0) - 50 / 3.6) < 1e-9);
check('maxspeed "none" is capped', parseMaxSpeed('none') === 130 / 3.6);
check('unparseable maxspeed falls through', parseMaxSpeed('fast') === null);

const oneway = parseDirectionality({ highway: 'residential', oneway: 'yes', lanes: '2' }, 'residential');
check('oneway=yes is forward only', oneway.forward && !oneway.backward && oneway.forwardLanes === 2);

const reversed = parseDirectionality({ highway: 'residential', oneway: '-1', lanes: '2' }, 'residential');
check(
  'oneway=-1 is backward only',
  !reversed.forward && reversed.backward && reversed.backwardLanes === 2,
  JSON.stringify(reversed),
);

const twoWay = parseDirectionality({ highway: 'primary', lanes: '4' }, 'primary');
check(
  'lanes split across both directions',
  twoWay.forwardLanes === 2 && twoWay.backwardLanes === 2,
);

const motorway = parseDirectionality({ highway: 'motorway', lanes: '3' }, 'motorway');
check('motorway is oneway by default', motorway.forward && !motorway.backward && motorway.forwardLanes === 3);

check('height "12 m"', parseLength('12 m') === 12);
check('height in feet and inches', Math.abs((parseLength("40'6\"") ?? 0) - 12.3444) < 0.01);
check('fuzzy start_date yields a year', parseStartYear('~1890') === 1890);

/* ================================================================== */
/*  2. Graph construction                                              */
/* ================================================================== */

section('road graph');

const raw = makeGrid({ mixedClasses: true, signals: true });
const graph = buildRoadGraph(raw, raw.bbox);

check('edges built', graph.edges.size > 0, `${graph.edges.size} edges`);
check('junctions built', graph.nodes.size === GRID * GRID, `${graph.nodes.size} nodes`);
check('entry points found', graph.sources.length > 0, `${graph.sources.length}`);
check('exit points found', graph.sinks.length > 0, `${graph.sinks.length}`);
check('network length plausible', graph.totalLengthM > 10_000, `${(graph.totalLengthM / 1000).toFixed(1)} km`);
check(
  'every edge has geometry and a positive length',
  [...graph.edges.values()].every((e) => e.length > 0 && e.points.length >= 4),
);

const signalised = [...graph.nodes.values()].filter((n) => n.control === 'signal' && n.signalGroup);
check('signal phasing assigned', signalised.length > 0, `${signalised.length} junctions`);
check(
  'crossing approaches get opposite phases',
  signalised.some((n) => {
    const groups = Object.values(n.signalGroup ?? {});
    return groups.includes(0) && groups.includes(1);
  }),
);

/* ================================================================== */
/*  3. Routing                                                         */
/* ================================================================== */

section('routing');

const plan = planRoute(graph, nodeId(0, 0), nodeId(GRID - 1, GRID - 1));
check('a route is found across the grid', plan !== null && plan.edges.length > 0,
  plan ? `${plan.edges.length} edges, ${plan.distance.toFixed(0)} m` : 'null');
check('travel time is plausible', !!plan && plan.duration > 0 && plan.duration < 1800,
  plan ? `${plan.duration.toFixed(0)} s` : '');
check('no route to a node that does not exist', planRoute(graph, nodeId(0, 0), 999999) === null);

/* ================================================================== */
/*  4. Simulation behaviour                                            */
/* ================================================================== */

section('simulation');

const sim = new TrafficSimulation(graph, { ...DEFAULT_SIM_CONFIG, targetVehicles: 150 });
run(sim, 300);
const stats = sim.stats();

console.log(
  `  → ${stats.vehicles} vehicles, ${(stats.meanSpeed * 3.6).toFixed(1)} km/h mean, ` +
    `${stats.completed} trips completed, ${(stats.congestedShare * 100).toFixed(0)}% congested, ` +
    `${stats.meanDelay.toFixed(0)} s mean delay`,
);

check('the fleet fills up', stats.vehicles > 100, `${stats.vehicles}`);
check('traffic keeps moving', stats.meanSpeed * 3.6 > 10, `${(stats.meanSpeed * 3.6).toFixed(1)} km/h`);
check('nobody exceeds the network speed limit', stats.meanSpeed * 3.6 < 90);
check('trips are completed', stats.completed > 10, `${stats.completed}`);
check('throughput series accumulates', stats.throughput.length > 5, `${stats.throughput.length} samples`);

const poses = sim.poses();
check('one pose per live vehicle', poses.length === stats.vehicles, `${poses.length}`);
check('all poses are finite', poses.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.heading)));
check('no vehicle is faster than 160 km/h', poses.every((p) => p.speed * 3.6 < 160));

const jammed = [...sim.edgeStats().values()].filter((s) => s.density > 200);
check('no link exceeds jam density', jammed.length === 0, `${jammed.length} over 200 veh/km/lane`);

// The bug that this catches: any vehicle left parked in the carriageway at the
// end of its route blocks the street behind it, and a grid locks solid within
// a few minutes. Speed must not decay as the run goes on.
const longRun = new TrafficSimulation(buildRoadGraph(raw, raw.bbox), {
  ...DEFAULT_SIM_CONFIG,
  targetVehicles: 150,
});
run(longRun, 120);
const early = longRun.stats().meanSpeed;
run(longRun, 480);
const late = longRun.stats().meanSpeed;
check(
  'the network does not deadlock over time',
  late > early * 0.6,
  `${(early * 3.6).toFixed(1)} km/h at 2 min → ${(late * 3.6).toFixed(1)} km/h at 10 min`,
);

// Determinism is what makes the congestion analytics comparable between runs.
const seeded = () =>
  new TrafficSimulation(buildRoadGraph(raw, raw.bbox), {
    ...DEFAULT_SIM_CONFIG,
    seed: 4242,
    targetVehicles: 80,
  });
const runA = seeded();
const runB = seeded();
run(runA, 60);
run(runB, 60);
const a = runA.stats();
const b = runB.stats();
check(
  'the same seed replays identically',
  a.vehicles === b.vehicles && Math.abs(a.meanSpeed - b.meanSpeed) < 1e-9 && a.completed === b.completed,
  `${a.vehicles} veh / ${a.meanSpeed.toFixed(6)} m/s both runs`,
);

// Signals have to actually cycle, or every junction is permanently one state.
const junction = signalised[0];
if (junction) {
  const approach = junction.incoming.find((id) => junction.signalGroup?.[id] !== undefined);
  const seen = new Set<string>();
  const signalSim = new TrafficSimulation(graph, DEFAULT_SIM_CONFIG);
  for (let i = 0; i < 1500; i++) {
    signalSim.step(0.1);
    const light = approach !== undefined ? signalSim.lightFor(junction.id, approach) : null;
    if (light) seen.add(light);
  }
  check('lights cycle red → green → amber', seen.has('red') && seen.has('green') && seen.has('amber'),
    [...seen].sort().join('/'));
}

/* ---- The fundamental diagram: speed must fall as density rises ---- */

section('fundamental diagram');

const plainGrid = buildRoadGraph(makeGrid(), makeGrid().bbox);
const km = plainGrid.totalLengthM / 1000;
const curve: Array<{ density: number; speed: number; flow: number }> = [];

for (const target of [50, 500, 1400]) {
  const s = new TrafficSimulation(plainGrid, { ...DEFAULT_SIM_CONFIG, targetVehicles: target, seed: 7 });
  run(s, 400);
  const result = s.stats();
  const density = result.vehicles / km;
  curve.push({ density, speed: result.meanSpeed * 3.6, flow: density * result.meanSpeed * 3.6 });
  console.log(
    `  → ${density.toFixed(1).padStart(6)} veh/km  ${(result.meanSpeed * 3.6).toFixed(1).padStart(5)} km/h  ` +
      `${(density * result.meanSpeed * 3.6).toFixed(0).padStart(5)} veh/h`,
  );
}

check('speed falls monotonically with density', curve[0].speed > curve[1].speed && curve[1].speed > curve[2].speed);
check('flow peaks in the middle, not at jam density', curve[1].flow > curve[2].flow);
check('the network jams at high density', curve[2].speed < 6, `${curve[2].speed.toFixed(1)} km/h`);

/* ================================================================== */
/*  5. Lithology and prospectivity                                     */
/* ================================================================== */

section('lithology & prospectivity');

check('dominant rock wins', classifyLithology('sandstone, shale').dominant === 'sandstone');
check('an interbedded unit is flagged', classifyLithology('sandstone, shale').interbedded);
check('evaporite recognised from a mineral name', classifyLithology('anhydrite').dominant === 'evaporite');
check('missing lithology is unknown, not guessed', classifyLithology(undefined).dominant === 'unknown');
check('a specific term beats the generic one it contains',
  classifyLithology('dolomitic limestone').dominant === 'dolomite');

const column: GeologicalColumn = {
  col_id: 1,
  name: 'Test column',
  lat: 31.5,
  lng: 10.2,
  units: [
    { unit_id: 1, strat_name: 'Recent alluvium', lith: 'alluvium', age_top: 0, age_bottom: 2, thickness: 60, color: '#ccc', description: '' },
    { unit_id: 2, strat_name: 'Upper shale', lith: 'shale', age_top: 2, age_bottom: 40, thickness: 220, color: '#888', description: '' },
    { unit_id: 3, strat_name: 'Nubian sandstone', lith: 'sandstone', age_top: 40, age_bottom: 100, thickness: 400, color: '#eb3', description: '' },
    { unit_id: 4, strat_name: 'Salt', lith: 'halite', age_top: 100, age_bottom: 150, thickness: 150, color: '#dce', description: '' },
    { unit_id: 5, strat_name: 'Deep reservoir sand', lith: 'sandstone', age_top: 150, age_bottom: 200, thickness: 300, color: '#eb3', description: '' },
    { unit_id: 6, strat_name: 'Source shale', lith: 'shale', age_top: 200, age_bottom: 260, thickness: 300, color: '#666', description: '' },
    { unit_id: 7, strat_name: 'Basement', lith: 'granite', age_top: 260, age_bottom: 500, thickness: 2000, color: '#a68', description: '' },
  ],
};

const report = analyseProspectivity(column, { surfaceElevation: 120, relief: 240 });
check('a report is produced for a real column', report !== null);

if (report) {
  const zones = [...report.aquifers, ...report.hydrocarbons];
  console.log(
    `  → water table ~${report.waterTableDepth?.toFixed(0)} m, ` +
      `${report.aquifers.length} aquifer / ${report.hydrocarbons.length} hydrocarbon targets`,
  );
  check('the porous sandstone is found as an aquifer',
    report.aquifers.some((z) => z.unitName.includes('Nubian')),
    report.aquifers.map((z) => `${z.unitName} ${z.score.toFixed(2)}`).join(', '));
  check('a water table is estimated', report.waterTableDepth !== null && report.waterTableDepth > 0);
  check('every score is in range', zones.every((z) => z.score >= 0 && z.score <= 1));
  check('depths are ordered', zones.every((z) => z.depthBottom > z.depthTop));
  check('the trap term stays capped without seismic', report.petroleumSystem.trap <= 0.45,
    report.petroleumSystem.trap.toFixed(2));
  check('every zone carries its evidence', zones.every((z) => z.evidence.length > 0));
  check('every zone carries its caveats', zones.every((z) => z.caveats.length > 0));
}

const basementOnly = analyseProspectivity({ ...column, units: [column.units[6]] });
check('a granite-only column indicates no petroleum play',
  basementOnly !== null && basementOnly.hydrocarbons.length === 0);
check('an empty column yields no report',
  analyseProspectivity({ ...column, units: [] }) === null);

/* ================================================================== */
/*  6. Building materials                                              */
/* ================================================================== */

section('building materials');

const tagged = resolveBuildingMaterial({ material: 'brick', type: 'house' }, 120);
check('an explicit tag wins', tagged.facade.key === 'brick' && tagged.source === 'tagged');

const tower = resolveBuildingMaterial({ type: 'office', levels: 30 }, 2000);
check('a tall office is a curtain wall', tower.facade.key === 'glass', tower.facade.key);

const historic = resolveBuildingMaterial({ type: 'yes', startYear: 1870, historic: true }, 300);
check('a pre-1900 historic building is stone',
  historic.facade.key === 'stone' && historic.source === 'inferred-era',
  `${historic.facade.key} / ${historic.source}`);

const unknown = resolveBuildingMaterial({}, 100);
check('an untagged building is low confidence', unknown.source === 'default' && unknown.confidence < 0.3,
  unknown.confidence.toFixed(2));

const painted = resolveBuildingMaterial({ colour: '#ff0000' }, 100);
check('a colour tag is honoured', painted.facade.color === '#ff0000');

const warehouse = resolveBuildingMaterial({ type: 'warehouse' }, 4000);
check('a warehouse is clad in metal', warehouse.facade.key === 'metal', warehouse.facade.key);

check('tagged buildings score higher confidence than inferred ones',
  tagged.confidence > historic.confidence && historic.confidence > unknown.confidence);

/* ================================================================== */

console.log(`\n${failures === 0 ? '✔ all checks passed' : `✘ ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
