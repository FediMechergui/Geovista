/**
 * Runtime checks for the scene pipelines: Overpass response → parsed data →
 * three.js geometry. Both the building and the vegetation paths run their real
 * parsers against a stubbed `fetch`, then their real mesh generators, and the
 * checks assert what survives each stage — the counts, the geometry bounds and
 * the coordinate frame.
 */
import { fetchBuildings } from '../src/lib/buildings/osmFetcher';
import * as THREE from 'three';
import { generateDetailedBuildings } from '../src/lib/buildings/buildingMesh';
import { buildVegetation, type VegetationElement } from '../src/lib/vegetation/osmVegetation';
import { clampBBoxArea, bboxAreaDeg2, MAX_AREA_DEG2 } from '../src/lib/geo/bbox';
import { overpassQuery } from '../src/lib/osm/overpass';
import { generateTreeLayer } from '../src/lib/vegetation/treeMesh';
import type { BBox } from '../src/types/geo';

const bbox: BBox = { south: 48.855, west: 2.293, north: 48.86, east: 2.299 };

const M = 111320;
const cosLat = Math.cos((48.8575 * Math.PI) / 180);
const dLat = (m: number) => m / M;
const dLon = (m: number) => m / (M * cosLat);

interface El {
  type: string; id: number; tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  members?: Array<{ type: string; ref: number; role: string; geometry?: Array<{ lat: number; lon: number }> }>;
}

/** Closed rectangle way (OSM repeats the first node). */
function rect(id: number, lon: number, lat: number, w: number, h: number, tags: Record<string, string>): El {
  const g = [
    { lon, lat },
    { lon: lon + dLon(w), lat },
    { lon: lon + dLon(w), lat: lat + dLat(h) },
    { lon, lat: lat + dLat(h) },
    { lon, lat },
  ];
  return { type: 'way', id, tags, geometry: g };
}

const elements: El[] = [];
let id = 1000;
const TAGSETS: Record<string, string>[] = [
  { building: 'yes' },
  { building: 'apartments', 'building:levels': '6', 'building:material': 'brick', 'roof:shape': 'gabled' },
  { building: 'house', height: '8 m', 'roof:shape': 'hipped', 'roof:material': 'roof_tiles' },
  { building: 'office', height: "120'", 'building:material': 'glass' },
  { building: 'retail', 'building:levels': '2', 'building:colour': '#b04030' },
  { building: 'church', 'roof:shape': 'pyramidal', 'building:material': 'stone' },
];

// 6 x 6 block of buildings, 18 m x 12 m each on a 30 m x 25 m pitch.
for (let r = 0; r < 6; r++) {
  for (let c = 0; c < 6; c++) {
    elements.push(
      rect(id++, bbox.west + dLon(20 + c * 30), bbox.south + dLat(20 + r * 25), 18, 12, TAGSETS[(r + c) % TAGSETS.length]),
    );
  }
}

// A multipolygon building.
const relGeom = [
  { lon: bbox.west + dLon(220), lat: bbox.south + dLat(20) },
  { lon: bbox.west + dLon(260), lat: bbox.south + dLat(20) },
  { lon: bbox.west + dLon(260), lat: bbox.south + dLat(60) },
  { lon: bbox.west + dLon(220), lat: bbox.south + dLat(60) },
  { lon: bbox.west + dLon(220), lat: bbox.south + dLat(20) },
];
elements.push({
  type: 'relation', id: 5000, tags: { building: 'commercial', 'building:levels': '4' },
  members: [{ type: 'way', ref: 1, role: 'outer', geometry: relGeom }],
});

// A tower with Simple-3D-Buildings parts: podium + shaft inside one outline.
elements.push(rect(id++, bbox.west + dLon(300), bbox.south + dLat(20), 40, 40, { building: 'yes' }));
elements.push(rect(id++, bbox.west + dLon(300), bbox.south + dLat(20), 40, 40, { 'building:part': 'yes', height: '12' }));
elements.push(rect(id++, bbox.west + dLon(310), bbox.south + dLat(30), 20, 20, { 'building:part': 'yes', height: '60', min_height: '12' }));

// Degenerate shapes that should be rejected without taking anything else down.
elements.push({ type: 'way', id: id++, tags: { building: 'yes' }, geometry: [{ lon: bbox.west, lat: bbox.south }, { lon: bbox.west, lat: bbox.south }] });
elements.push(rect(id++, bbox.west + dLon(400), bbox.south + dLat(20), 1, 1, { building: 'shed' }));

globalThis.fetch = (async () =>
  new Response(JSON.stringify({ elements }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

let failures = 0;
/** `detail` describes what went wrong, so it is only printed on a failure. */
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  const buildings = await fetchBuildings(bbox);
  console.log(`\nParsed ${buildings.length} outlines from ${elements.length} elements`);
  check('outlines parsed', buildings.length === 39, `got ${buildings.length}, want 39 (36 grid + relation + tower + shed)`);
  const withParts = buildings.filter((b) => b.parts?.length);
  check('tower kept its parts', withParts.length === 1 && withParts[0].parts!.length === 2,
    `${withParts.length} hosts, ${withParts[0]?.parts?.length ?? 0} parts`);

  const { group, rendered, assignments } = generateDetailedBuildings(buildings, bbox, {
    elevationAt: (lon, lat) => 30 + (lon - bbox.west) * 2000 + (lat - bbox.south) * 1000,
  });

  console.log(`Rendered ${rendered} buildings into ${group.children.length} meshes`);
  check('buildings rendered', rendered >= 37, `rendered=${rendered}`);
  check('meshes produced', group.children.length > 0, `${group.children.length} meshes`);
  check('materials assigned', assignments.size === rendered, `${assignments.size} assignments`);

  // Geometry sanity: bounds must sit inside the bbox and stand above ground.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let verts = 0, nonFinite = 0;
  for (const child of group.children) {
    const pos = (child as THREE.Mesh).geometry?.attributes?.position as
      | THREE.BufferAttribute
      | undefined;
    if (!pos) continue;
    verts += pos.count;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { nonFinite++; continue; }
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
  }
  console.log(`vertices=${verts} x=[${minX.toExponential(3)}, ${maxX.toExponential(3)}] y=[${minY.toExponential(3)}, ${maxY.toExponential(3)}] z=[${minZ.toExponential(3)}, ${maxZ.toExponential(3)}]`);
  check('no non-finite vertices', nonFinite === 0, `${nonFinite} bad`);
  check('vertices emitted', verts > 1000, `${verts}`);

  const DEG_PER_M = 1 / 111320;
  const halfW = ((bbox.east - bbox.west) / 2) * cosLat;
  const halfH = (bbox.north - bbox.south) / 2;
  check('x inside frame', minX >= -halfW * 1.05 && maxX <= halfW * 1.05, `[${minX}, ${maxX}] vs ±${halfW}`);
  check('z inside frame', minZ >= -halfH * 1.05 && maxZ <= halfH * 1.05, `[${minZ}, ${maxZ}] vs ±${halfH}`);
  check('heights are metres * DEG_PER_M', maxY / DEG_PER_M > 10 && maxY / DEG_PER_M < 400,
    `max height ${(maxY / DEG_PER_M).toFixed(1)} m`);

  /* ================================================================ */
  /*  Vegetation                                                       */
  /* ================================================================ */

  const vegElements: VegetationElement[] = [
    // Two surveyed trees, one of them a tagged conifer.
    { type: 'node', id: 1, lat: bbox.south + dLat(60), lon: bbox.west + dLon(60),
      tags: { natural: 'tree', height: '14', species: 'Quercus robur' } },
    { type: 'node', id: 2, lat: bbox.south + dLat(70), lon: bbox.west + dLon(70),
      tags: { natural: 'tree', leaf_type: 'needleleaved', circumference: '1.9 m' } },
    // A 200 m avenue: 8 m spacing means ~26 trees.
    { type: 'way', id: 3, tags: { natural: 'tree_row' },
      geometry: [
        { lat: bbox.south + dLat(200), lon: bbox.west + dLon(20) },
        { lat: bbox.south + dLat(200), lon: bbox.west + dLon(220) },
      ] },
    // A one-hectare wood at 220 trees/ha.
    { type: 'way', id: 4, tags: { natural: 'wood' },
      geometry: [
        { lat: bbox.south + dLat(300), lon: bbox.west + dLon(0) },
        { lat: bbox.south + dLat(300), lon: bbox.west + dLon(100) },
        { lat: bbox.south + dLat(400), lon: bbox.west + dLon(100) },
        { lat: bbox.south + dLat(400), lon: bbox.west + dLon(0) },
        { lat: bbox.south + dLat(300), lon: bbox.west + dLon(0) },
      ] },
  ];

  const veg = buildVegetation(vegElements, bbox);
  console.log(
    `\nVegetation: ${veg.trees.length} trees ` +
      `(${veg.counts.surveyed} surveyed, ${veg.counts.row} row, ${veg.counts.scattered} scattered)`,
  );

  check('surveyed trees kept', veg.counts.surveyed === 2, `${veg.counts.surveyed}`);
  check('tagged height used', veg.trees.some((t) => Math.abs(t.height - 14) < 0.01), 'no 14 m tree');
  check('conifer classified', veg.trees.some((t) => t.kind === 'needleleaf'), 'no needleleaf');
  check(
    'circumference → height',
    veg.trees.some((t) => t.kind === 'needleleaf' && t.height > 15 && t.height < 25),
    'allometric estimate out of range',
  );
  check('tree row stepped', veg.counts.row >= 22 && veg.counts.row <= 28, `${veg.counts.row} trees over 200 m`);
  check('wood scattered near density', veg.counts.scattered >= 170 && veg.counts.scattered <= 230,
    `${veg.counts.scattered} in 1 ha at 220/ha`);
  check('canopy area recorded', veg.areas.length === 1 && veg.areas[0].tag === 'natural=wood',
    `${veg.areas.length} areas`);

  // Scattered trees must land inside the polygon they belong to.
  const scattered = veg.trees.filter((t) => t.source === 'scattered');
  const strays = scattered.filter(
    (t) =>
      t.lat < bbox.south + dLat(300) - 1e-9 ||
      t.lat > bbox.south + dLat(400) + 1e-9 ||
      t.lon < bbox.west - 1e-9 ||
      t.lon > bbox.west + dLon(100) + 1e-9,
  );
  check('scattered trees stay inside the wood', strays.length === 0, `${strays.length} outside`);

  // The same region must regrow the same wood.
  const again = buildVegetation(vegElements, bbox);
  const identical =
    again.trees.length === veg.trees.length &&
    again.trees.every((t, i) => t.lon === veg.trees[i].lon && t.lat === veg.trees[i].lat);
  check('placement is deterministic', identical, 'second run differs');

  const layer = generateTreeLayer(veg.trees, bbox, { elevationAt: () => 40 });
  const instanced = layer.group.children.filter(
    (c) => (c as { isInstancedMesh?: boolean }).isInstancedMesh,
  );
  console.log(`Tree layer: ${layer.rendered} instances in ${layer.group.children.length} meshes`);
  check('trees instanced', layer.rendered === veg.trees.length, `${layer.rendered}`);
  check('one trunk + one crown mesh per kind', instanced.length === layer.group.children.length,
    `${instanced.length}/${layer.group.children.length} instanced`);
  check('draw calls stay small', layer.group.children.length <= 8, `${layer.group.children.length}`);
  check('layer scaled into the degree frame',
    Math.abs(layer.group.scale.x - 1 / 111320) < 1e-12, `${layer.group.scale.x}`);

  const empty = generateTreeLayer([], bbox);
  check('empty vegetation is harmless', empty.rendered === 0 && empty.group.children.length === 0);

  /* ================================================================ */
  /*  Request guards                                                   */
  /* ================================================================ */

  // A region drawn by hand has no upper bound. Overpass times out rather than
  // returning anything, so every layer clamps before it asks.
  const huge: BBox = { west: 9.5, east: 10.5, south: 36.3, north: 37.3 };
  // The extent a place search actually produces (this is Tunis), which must
  // pass through every cap untouched — clamping a normal twin would be a bug.
  const small: BBox = { west: 10.1546, east: 10.217, south: 36.7752, north: 36.8252 };

  for (const [name, cap] of Object.entries(MAX_AREA_DEG2)) {
    const big = clampBBoxArea(huge, cap);
    check(`${name}: huge selection is clamped`, big.clamped);
    check(`${name}: clamped area is within the cap`,
      bboxAreaDeg2(big.bbox) <= cap * 1.000001,
      `${bboxAreaDeg2(big.bbox)} > ${cap}`);

    const fits = clampBBoxArea(small, cap);
    check(`${name}: a normal selection is left alone`,
      !fits.clamped && fits.bbox === small);
  }

  // The clamp must keep the centre, so the camera still looks at the data.
  const clampedHuge = clampBBoxArea(huge, MAX_AREA_DEG2.buildings).bbox;
  const cx = (huge.west + huge.east) / 2;
  const cy = (huge.south + huge.north) / 2;
  check('clamp keeps the selection centre',
    Math.abs((clampedHuge.west + clampedHuge.east) / 2 - cx) < 1e-9 &&
      Math.abs((clampedHuge.south + clampedHuge.north) / 2 - cy) < 1e-9);
  check('clamp keeps the aspect ratio',
    Math.abs(
      (clampedHuge.east - clampedHuge.west) / (clampedHuge.north - clampedHuge.south) -
        (huge.east - huge.west) / (huge.north - huge.south),
    ) < 1e-9);

  // Degenerate boxes must not produce NaN corners.
  const degenerate = clampBBoxArea({ west: 1, east: 1, south: 2, north: 2 }, 0.01);
  check('a zero-area selection survives the clamp',
    !degenerate.clamped &&
      Object.values(degenerate.bbox).every((v) => Number.isFinite(v)));

  /* ================================================================ */
  /*  Overpass responses that are not what they look like              */
  /* ================================================================ */

  // A timeout is answered with 200 OK plus a remark and whatever was collected
  // so far, so a naive read turns a dead query into "this city has 2 buildings".
  const reply = (body: unknown, status = 200) =>
    (globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch);

  async function expectThrow(label: string, body: unknown, status = 200): Promise<string> {
    reply(body, status);
    try {
      await overpassQuery('[out:json];out;');
      check(label, false, 'resolved instead of throwing');
      return '';
    } catch (err) {
      check(label, true);
      return err instanceof Error ? err.message : String(err);
    }
  }

  const timedOut = await expectThrow('a timed-out query throws', {
    remark: 'runtime error: Query timed out in "query" at line 3 after 55 seconds.',
    elements: [{ type: 'way', id: 1 }],
  });
  check('the timeout message says what to do', /smaller region/i.test(timedOut), timedOut);

  await expectThrow('an out-of-memory remark throws', {
    remark: 'runtime error: Query run out of memory in "recurse" at line 5.',
    elements: [],
  });
  await expectThrow('a proxy 502 throws', { error: 'All Overpass mirrors failed' }, 502);

  // The crash seen in production: Overpass answered 200 with no `elements` key
  // at all, and `for (const el of data.elements)` threw
  // "undefined is not iterable".
  reply({ version: 0.6, generator: 'Overpass API' });
  const noElements = await overpassQuery('[out:json];out;');
  check('a body with no elements yields an empty list, not a crash',
    Array.isArray(noElements) && noElements.length === 0);

  // A remark that is only advisory must not fail an otherwise good answer.
  reply({ remark: 'considered 3 alternatives', elements: [{ type: 'way', id: 7 }] });
  const advisory = await overpassQuery<{ id: number }>('[out:json];out;');
  check('an advisory remark is not treated as failure', advisory.length === 1);

  // Overpass allows ~2 slots per IP; three concurrent heavy queries starve one.
  let inFlight = 0;
  let peak = 0;
  globalThis.fetch = (async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return new Response(JSON.stringify({ elements: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  await Promise.all([
    overpassQuery('[out:json];out;'),
    overpassQuery('[out:json];out;'),
    overpassQuery('[out:json];out;'),
  ]);
  check('queries are issued one at a time', peak === 1, `${peak} concurrent`);

  // One failure must not wedge the queue for everything after it.
  reply({ error: 'boom' }, 502);
  await overpassQuery('[out:json];out;').catch(() => undefined);
  reply({ elements: [{ type: 'way', id: 1 }] });
  const afterFailure = await overpassQuery('[out:json];out;');
  check('a failed query does not stall the queue', afterFailure.length === 1);

  console.log(failures === 0 ? '\nAll scene checks passed.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
