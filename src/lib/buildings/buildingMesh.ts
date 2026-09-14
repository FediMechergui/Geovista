/**
 * Material-accurate 3D building generation.
 *
 * Replaces the old "extrude the footprint, tint it by `building=*`" approach
 * with geometry that carries the information OSM actually has:
 *
 *   - **Walls** built quad by quad so UVs are in real metres. One texture tile
 *     is 3.2 m × 3.2 m, so window rows land on floor levels at any height and
 *     a 4-storey building reads as 4 storeys.
 *   - **Roofs** built to `roof:shape` — flat, gabled, hipped, pyramidal,
 *     skillion, dome and the common approximations — on the footprint's
 *     oriented bounding box, which is how every 3D OSM renderer does it.
 *   - **Building parts** (`building:part`, Simple 3D Buildings) replace their
 *     parent outline so towers, setbacks and podiums come out right.
 *   - **Batching by material**: one merged mesh per material, so a few
 *     thousand buildings still cost a handful of draw calls.
 *
 * ## Units
 *
 * Everything is built in metres in the final scene orientation (+X east,
 * +Y up, −Z north) and scaled once by `DEG_PER_M` at the end, matching the
 * degree-based frame the terrain mesh uses.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BBox } from '@/types/geo';
import type {
  BuildingData,
  BuildingMaterialAssignment,
  BuildingProperties,
  SurfaceMaterial,
} from '@/types/buildings';
import {
  FLOOR_HEIGHT_M,
  TILE_WIDTH_M,
  facadeTextures,
  resolveBuildingMaterial,
  roofShapeFor,
} from '@/lib/buildings/materials';

/** Conversion factor: 1° latitude ≈ 111 320 m (matches the terrain mesh). */
export const DEG_PER_M = 1 / 111320;
const M_PER_DEG = 111320;

/** Metres per storey when only `building:levels` is known. */
const METERS_PER_FLOOR = 3.2;

/** Default heights by `building=*` when nothing else is tagged. */
const HEIGHT_DEFAULTS: Record<string, number> = {
  house: 8,
  detached: 8,
  semidetached_house: 8,
  terrace: 9,
  bungalow: 5,
  residential: 12,
  apartments: 18,
  dormitory: 16,
  commercial: 15,
  office: 20,
  industrial: 10,
  warehouse: 12,
  factory: 12,
  retail: 6,
  supermarket: 8,
  kiosk: 3,
  school: 12,
  college: 14,
  university: 18,
  hospital: 20,
  hotel: 22,
  church: 20,
  cathedral: 40,
  chapel: 9,
  mosque: 20,
  synagogue: 16,
  temple: 15,
  castle: 25,
  garage: 3,
  garages: 3,
  carport: 3,
  shed: 3,
  hut: 3,
  cabin: 4,
  barn: 7,
  greenhouse: 4,
  roof: 4,
  parking: 12,
  yes: 10,
};

/**
 * Best-effort estimate of a building's height in metres.
 * Priority: explicit `height` → `levels × 3.2` → type default → 10 m.
 */
export function estimateBuildingHeight(props: BuildingProperties): number {
  if (props.height && Number.isFinite(props.height) && props.height > 0) return props.height;
  if (props.levels && Number.isFinite(props.levels) && props.levels > 0) {
    return props.levels * METERS_PER_FLOOR;
  }
  return HEIGHT_DEFAULTS[props.type ?? 'yes'] ?? 10;
}

/** Height of the roof structure above the eaves, metres. */
function roofHeightOf(props: BuildingProperties, shape: string, width: number): number {
  if (props.roofHeight && Number.isFinite(props.roofHeight)) return props.roofHeight;
  if (props.roofLevels && Number.isFinite(props.roofLevels)) {
    return props.roofLevels * METERS_PER_FLOOR * 0.8;
  }
  if (shape === 'flat') return 0;
  if (shape === 'skillion') return Math.min(width * 0.18, 3);
  if (shape === 'dome' || shape === 'onion') return Math.min(width * 0.5, 14);
  // A 30° pitch is the common residential default.
  return Math.min(width * 0.29, 9);
}

/* ================================================================== */
/*  Footprint geometry helpers                                         */
/* ================================================================== */

type Point = [number, number];

/** OSM rings repeat the first vertex; drop it and any duplicate neighbours. */
function cleanRing(coords: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of coords) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-4 && Math.abs(last[1] - p[1]) < 1e-4) continue;
    out.push(p);
  }
  if (out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-4 && Math.abs(first[1] - last[1]) < 1e-4) out.pop();
  }
  return out;
}

/** Signed area of a ring; positive means counter-clockwise. */
function signedArea(ring: Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

/**
 * The footprint's oriented bounding box, taken along its longest edge.
 *
 * Buildings are overwhelmingly rectangular, and when they are, the longest
 * edge *is* the box axis — which is also the convention OSM uses for an
 * untagged ridge direction. Pitched roofs are built on this box.
 */
interface OrientedBox {
  /** Centre of the box. */
  cx: number;
  cy: number;
  /** Unit vector along the long axis. */
  ax: number;
  ay: number;
  /** Half-extent along the long axis and across it. */
  halfLong: number;
  halfShort: number;
}

function orientedBox(ring: Point[]): OrientedBox {
  let bestLen = -1;
  let ax = 1;
  let ay = 0;

  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = dx * dx + dy * dy;
    if (len > bestLen) {
      bestLen = len;
      const d = Math.sqrt(len) || 1;
      ax = dx / d;
      ay = dy / d;
    }
  }

  // Project every vertex onto the axis and its normal.
  let minA = Infinity;
  let maxA = -Infinity;
  let minB = Infinity;
  let maxB = -Infinity;
  for (const [x, y] of ring) {
    const a = x * ax + y * ay;
    const b = -x * ay + y * ax;
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
  }

  const midA = (minA + maxA) / 2;
  const midB = (minB + maxB) / 2;
  let halfLong = (maxA - minA) / 2;
  let halfShort = (maxB - minB) / 2;

  // Keep "long" actually long, flipping the axis if the projection disagrees.
  if (halfShort > halfLong) {
    [halfLong, halfShort] = [halfShort, halfLong];
    [ax, ay] = [-ay, ax];
    return {
      cx: midB * ax - midA * ay,
      cy: midB * ay + midA * ax,
      ax,
      ay,
      halfLong,
      halfShort,
    };
  }

  return {
    cx: midA * ax - midB * ay,
    cy: midA * ay + midB * ax,
    ax,
    ay,
    halfLong,
    halfShort,
  };
}

/* ================================================================== */
/*  Geometry accumulator                                               */
/* ================================================================== */

/**
 * Collects triangles for one material bucket. Writing straight into flat
 * arrays avoids building (and immediately merging) thousands of tiny
 * BufferGeometry objects.
 */
class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly colors: number[] = [];

  private tint = new THREE.Color();

  setTint(hex: string, jitter: number): void {
    this.tint.set(hex);
    if (jitter !== 0) this.tint.offsetHSL(0, 0, jitter);
  }

  /** Push one triangle with per-vertex UVs; the normal is computed from it. */
  triangle(
    ax: number, ay: number, az: number, au: number, av: number,
    bx: number, by: number, bz: number, bu: number, bv: number,
    cx: number, cy: number, cz: number, cu: number, cv: number,
  ): void {
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;

    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    this.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.uvs.push(au, av, bu, bv, cu, cv);

    const { r, g, b } = this.tint;
    this.colors.push(r, g, b, r, g, b, r, g, b);
  }

  /** Push a quad as two triangles, vertices in winding order. */
  quad(
    ax: number, ay: number, az: number, au: number, av: number,
    bx: number, by: number, bz: number, bu: number, bv: number,
    cx: number, cy: number, cz: number, cu: number, cv: number,
    dx: number, dy: number, dz: number, du: number, dv: number,
  ): void {
    this.triangle(ax, ay, az, au, av, bx, by, bz, bu, bv, cx, cy, cz, cu, cv);
    this.triangle(ax, ay, az, au, av, cx, cy, cz, cu, cv, dx, dy, dz, du, dv);
  }

  get isEmpty(): boolean {
    return this.positions.length === 0;
  }

  build(scale: number): THREE.BufferGeometry {
    const count = this.positions.length / 3;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < positions.length; i++) positions[i] = this.positions[i] * scale;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uvs), 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.colors), 3));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/* ================================================================== */
/*  Walls                                                              */
/* ================================================================== */

/**
 * Extrude the footprint into walls between `baseY` and `topY` (metres),
 * with UVs measured in metres so the facade texture keeps its real scale.
 */
function addWalls(
  builder: MeshBuilder,
  ring: Point[],
  baseY: number,
  topY: number,
): void {
  const height = topY - baseY;
  if (height <= 0) return;

  const vTop = height / FLOOR_HEIGHT_M;
  let u = 0;

  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    const segment = Math.hypot(x1 - x0, z1 - z0);
    if (segment < 0.05) continue;

    const u0 = u / TILE_WIDTH_M;
    u += segment;
    const u1 = u / TILE_WIDTH_M;

    // Wound so the outward face points away from a counter-clockwise ring.
    builder.quad(
      x0, baseY, z0, u0, 0,
      x1, baseY, z1, u1, 0,
      x1, topY, z1, u1, vTop,
      x0, topY, z0, u0, vTop,
    );
  }
}

/* ================================================================== */
/*  Roofs                                                              */
/* ================================================================== */

/** Triangulate a footprint ring and emit it as a horizontal cap at `y`. */
function addFlatCap(builder: MeshBuilder, ring: Point[], y: number, uvScale: number): void {
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
  let faces: number[][];
  try {
    faces = THREE.ShapeUtils.triangulateShape(contour, []);
  } catch {
    return; // self-intersecting footprint — skip the cap rather than crash
  }

  for (const [ia, ib, ic] of faces) {
    const a = contour[ia];
    const b = contour[ib];
    const c = contour[ic];
    builder.triangle(
      a.x, y, a.y, a.x / uvScale, a.y / uvScale,
      c.x, y, c.y, c.x / uvScale, c.y / uvScale,
      b.x, y, b.y, b.x / uvScale, b.y / uvScale,
    );
  }
}

/** Local → world helper for points expressed in oriented-box coordinates. */
function boxPoint(box: OrientedBox, along: number, across: number): Point {
  return [
    box.cx + box.ax * along - box.ay * across,
    box.cy + box.ay * along + box.ax * across,
  ];
}

/**
 * Build the roof volume for `shape` sitting on the footprint's oriented box.
 *
 * The eaves are at `eaveY` and the apex at `eaveY + roofH`. For a flat roof
 * the real footprint is capped instead of the box, because that is both more
 * accurate and the most common case.
 */
function addRoof(
  builder: MeshBuilder,
  ring: Point[],
  box: OrientedBox,
  shape: string,
  eaveY: number,
  roofH: number,
  orientation: string | undefined,
): void {
  const uvScale = TILE_WIDTH_M;

  if (shape === 'flat' || roofH <= 0.05) {
    addFlatCap(builder, ring, eaveY, uvScale);
    return;
  }

  // `roof:orientation=across` puts the ridge along the short axis instead.
  const across = orientation?.toLowerCase() === 'across';
  const halfRidge = across ? box.halfShort : box.halfLong;
  const halfSpan = across ? box.halfLong : box.halfShort;

  /** Corner of the box in (along-ridge, across-ridge) coordinates. */
  const corner = (alongRidge: number, acrossRidge: number): Point =>
    across ? boxPoint(box, acrossRidge, alongRidge) : boxPoint(box, alongRidge, acrossRidge);

  const apexY = eaveY + roofH;

  const c00 = corner(-halfRidge, -halfSpan);
  const c10 = corner(halfRidge, -halfSpan);
  const c11 = corner(halfRidge, halfSpan);
  const c01 = corner(-halfRidge, halfSpan);

  const u = (p: Point) => p[0] / uvScale;
  const v = (p: Point) => p[1] / uvScale;

  switch (shape) {
    case 'gabled':
    case 'gambrel':
    case 'round': {
      // Ridge runs the length of the box at mid-span.
      const r0 = corner(-halfRidge, 0);
      const r1 = corner(halfRidge, 0);

      builder.quad(
        c00[0], eaveY, c00[1], u(c00), v(c00),
        c10[0], eaveY, c10[1], u(c10), v(c10),
        r1[0], apexY, r1[1], u(r1), v(r1),
        r0[0], apexY, r0[1], u(r0), v(r0),
      );
      builder.quad(
        c11[0], eaveY, c11[1], u(c11), v(c11),
        c01[0], eaveY, c01[1], u(c01), v(c01),
        r0[0], apexY, r0[1], u(r0), v(r0),
        r1[0], apexY, r1[1], u(r1), v(r1),
      );
      // Gable ends close the triangle at each end of the ridge.
      builder.triangle(
        c00[0], eaveY, c00[1], u(c00), v(c00),
        r0[0], apexY, r0[1], u(r0), v(r0),
        c01[0], eaveY, c01[1], u(c01), v(c01),
      );
      builder.triangle(
        c10[0], eaveY, c10[1], u(c10), v(c10),
        c11[0], eaveY, c11[1], u(c11), v(c11),
        r1[0], apexY, r1[1], u(r1), v(r1),
      );
      break;
    }

    case 'hipped':
    case 'mansard':
    case 'half-hipped': {
      // Ridge inset from both ends, so all four faces slope.
      const inset = Math.min(halfSpan, halfRidge * 0.6);
      const r0 = corner(-halfRidge + inset, 0);
      const r1 = corner(halfRidge - inset, 0);

      builder.quad(
        c00[0], eaveY, c00[1], u(c00), v(c00),
        c10[0], eaveY, c10[1], u(c10), v(c10),
        r1[0], apexY, r1[1], u(r1), v(r1),
        r0[0], apexY, r0[1], u(r0), v(r0),
      );
      builder.quad(
        c11[0], eaveY, c11[1], u(c11), v(c11),
        c01[0], eaveY, c01[1], u(c01), v(c01),
        r0[0], apexY, r0[1], u(r0), v(r0),
        r1[0], apexY, r1[1], u(r1), v(r1),
      );
      builder.triangle(
        c00[0], eaveY, c00[1], u(c00), v(c00),
        r0[0], apexY, r0[1], u(r0), v(r0),
        c01[0], eaveY, c01[1], u(c01), v(c01),
      );
      builder.triangle(
        c10[0], eaveY, c10[1], u(c10), v(c10),
        c11[0], eaveY, c11[1], u(c11), v(c11),
        r1[0], apexY, r1[1], u(r1), v(r1),
      );
      break;
    }

    case 'pyramidal':
    case 'cone':
    case 'onion':
    case 'dome': {
      const apex = boxPoint(box, 0, 0);
      const corners: Point[] = [c00, c10, c11, c01];
      for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        builder.triangle(
          a[0], eaveY, a[1], u(a), v(a),
          b[0], eaveY, b[1], u(b), v(b),
          apex[0], apexY, apex[1], 0.5, 0.5,
        );
      }
      break;
    }

    case 'skillion':
    case 'lean_to':
    case 'shed': {
      // One plane, low on the −across side and high on the +across side.
      builder.quad(
        c00[0], eaveY, c00[1], u(c00), v(c00),
        c10[0], eaveY, c10[1], u(c10), v(c10),
        c11[0], apexY, c11[1], u(c11), v(c11),
        c01[0], apexY, c01[1], u(c01), v(c01),
      );
      // Triangular closures along the sloping sides.
      builder.triangle(
        c00[0], eaveY, c00[1], u(c00), v(c00),
        c01[0], apexY, c01[1], u(c01), v(c01),
        c01[0], eaveY, c01[1], u(c01), v(c01),
      );
      builder.triangle(
        c10[0], eaveY, c10[1], u(c10), v(c10),
        c11[0], eaveY, c11[1], u(c11), v(c11),
        c11[0], apexY, c11[1], u(c11), v(c11),
      );
      break;
    }

    default:
      addFlatCap(builder, ring, eaveY, uvScale);
  }
}

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

export interface DetailedBuildingOptions {
  /** Ground elevation sampler (metres). Buildings sit on their lowest vertex. */
  elevationAt?: (lon: number, lat: number) => number | null;
  /** Fallback ground elevation when the sampler has no data. */
  groundElevation?: number;
  /** Hard cap on buildings rendered, to protect the frame budget. */
  maxBuildings?: number;
  /** Receives the resolved material per building, for the UI summary. */
  onAssign?: (id: number, assignment: BuildingMaterialAssignment) => void;
}

export interface DetailedBuildingResult {
  group: THREE.Group;
  /** Material assignments keyed by building id. */
  assignments: Map<number, BuildingMaterialAssignment>;
  /** Buildings actually rendered (after the cap and geometry filtering). */
  rendered: number;
}

/** Deterministic per-building lightness jitter so a row of houses varies. */
function jitter(id: number, amount: number): number {
  const x = Math.sin(id * 12.9898) * 43758.5453;
  return ((x - Math.floor(x)) * 2 - 1) * amount;
}

/**
 * Build the 3D building group for a region.
 *
 * One mesh is produced per distinct material, each with its own PBR settings
 * and procedural facade texture.
 */
export function generateDetailedBuildings(
  buildings: BuildingData[],
  bbox: BBox,
  {
    elevationAt,
    groundElevation = 0,
    maxBuildings = 6000,
    onAssign,
  }: DetailedBuildingOptions = {},
): DetailedBuildingResult {
  const group = new THREE.Group();
  group.userData = { type: 'building-stack', count: 0 };

  const assignments = new Map<number, BuildingMaterialAssignment>();
  if (buildings.length === 0) return { group, assignments, rendered: 0 };

  const centerLon = (bbox.west + bbox.east) / 2;
  const centerLat = (bbox.south + bbox.north) / 2;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);

  /** Geographic → local metres, in scene orientation (+X east, −Z north). */
  const toLocal = (lon: number, lat: number): Point => [
    (lon - centerLon) * cosLat * M_PER_DEG,
    -(lat - centerLat) * M_PER_DEG,
  ];

  /** material key → accumulated geometry. */
  const buckets = new Map<string, { material: SurfaceMaterial; builder: MeshBuilder }>();
  const bucketFor = (material: SurfaceMaterial) => {
    // Colour is part of the key: two buildings tagged `brick` with different
    // `building:colour` values are genuinely different materials to render.
    const key = `${material.key}|${material.color}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material, builder: new MeshBuilder() };
      buckets.set(key, bucket);
    }
    return bucket;
  };

  let rendered = 0;

  for (const building of buildings) {
    if (rendered >= maxBuildings) break;

    const outline = cleanRing(building.geometry.map(([lon, lat]) => toLocal(lon, lat)));
    if (outline.length < 3) continue;

    // Seat the building on the terrain: the base is the lowest footprint
    // vertex, and the walls extend down by the slope spread so nothing floats.
    let base = Infinity;
    let top = -Infinity;
    if (elevationAt) {
      for (const [lon, lat] of building.geometry) {
        const e = elevationAt(lon, lat);
        if (e === null) continue;
        if (e < base) base = e;
        if (e > top) top = e;
      }
    }
    if (!Number.isFinite(base)) {
      base = groundElevation;
      top = groundElevation;
    }
    const spread = Math.min(Math.max(top - base, 0), 60);

    // Simple 3D Buildings: parts replace the parent outline entirely.
    const volumes = building.parts?.length
      ? building.parts
      : [building];

    let contributed = false;

    for (const volume of volumes) {
      const ring =
        volume === building
          ? outline
          : cleanRing(volume.geometry.map(([lon, lat]) => toLocal(lon, lat)));
      if (ring.length < 3) continue;

      // Wall quads assume a counter-clockwise ring for outward normals.
      const ccw = signedArea(ring) > 0 ? ring : [...ring].reverse();

      const area = Math.abs(signedArea(ccw));
      if (area < 4) continue; // smaller than a garden shed — almost certainly noise

      const props = volume.properties;
      const totalHeight = estimateBuildingHeight(props);
      if (!Number.isFinite(totalHeight) || totalHeight <= 0) continue;

      const assignment = resolveBuildingMaterial(props, area);
      const shape = roofShapeFor(props, area);

      const box = orientedBox(ccw);
      const roofH = Math.min(roofHeightOf(props, shape, box.halfShort * 2), totalHeight * 0.7);
      const wallHeight = Math.max(1, totalHeight - roofH);

      // `min_height` / `building:min_level` lift a part off the ground.
      const minHeight =
        props.minHeight ??
        (props.minLevel ? props.minLevel * METERS_PER_FLOOR : 0);

      const baseY = base - spread + Math.max(0, minHeight);
      const eaveY = base + wallHeight;
      if (eaveY <= baseY) continue;

      const facadeBucket = bucketFor(assignment.facade);
      facadeBucket.builder.setTint(
        assignment.facade.color,
        jitter(volume.id, assignment.facade.variation),
      );
      addWalls(facadeBucket.builder, ccw, baseY, eaveY);

      const roofBucket = bucketFor(assignment.roof);
      roofBucket.builder.setTint(
        assignment.roof.color,
        jitter(volume.id * 7 + 3, assignment.roof.variation),
      );
      addRoof(roofBucket.builder, ccw, box, shape, eaveY, roofH, props.roofOrientation);

      contributed = true;
    }

    if (!contributed) continue;

    const assignment = resolveBuildingMaterial(
      building.properties,
      Math.abs(signedArea(outline)),
    );
    assignments.set(building.id, assignment);
    onAssign?.(building.id, assignment);
    rendered++;
  }

  /* ---- Turn each bucket into a mesh ---- */
  for (const { material, builder } of buckets.values()) {
    if (builder.isEmpty) continue;

    const geometry = builder.build(DEG_PER_M);
    const textures = facadeTextures(material, material.key.length);

    const params: THREE.MeshStandardMaterialParameters = {
      vertexColors: true,
      roughness: material.roughness,
      metalness: material.metalness,
      side: THREE.DoubleSide, // OSM rings come in both windings
    };

    if (textures) {
      const map = new THREE.CanvasTexture(textures.albedo);
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.anisotropy = 8;
      params.map = map;

      if (textures.emissive && material.windowGlow > 0) {
        const emissiveMap = new THREE.CanvasTexture(textures.emissive);
        emissiveMap.colorSpace = THREE.SRGBColorSpace;
        emissiveMap.wrapS = THREE.RepeatWrapping;
        emissiveMap.wrapT = THREE.RepeatWrapping;
        params.emissiveMap = emissiveMap;
        params.emissive = new THREE.Color(0xffe6bf);
        params.emissiveIntensity = material.windowGlow;
      }
    } else {
      params.color = new THREE.Color(material.color);
    }

    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial(params));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { type: 'buildings', material: material.key };
    group.add(mesh);
  }

  group.userData.count = rendered;
  return { group, assignments, rendered };
}

/**
 * Merge several building groups into one — used when parts and outlines are
 * generated separately. Exposed for reuse; the main path already batches.
 */
export function mergeBuildingGroups(groups: THREE.Group[]): THREE.Group {
  const out = new THREE.Group();
  const byMaterial = new Map<string, { geometries: THREE.BufferGeometry[]; material: THREE.Material }>();

  for (const group of groups) {
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      const key = String(child.userData.material ?? 'default');
      const entry = byMaterial.get(key);
      if (entry) entry.geometries.push(child.geometry);
      else byMaterial.set(key, { geometries: [child.geometry], material: child.material as THREE.Material });
    }
  }

  for (const [key, { geometries, material }] of byMaterial) {
    const merged = mergeGeometries(geometries, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { type: 'buildings', material: key };
    out.add(mesh);
  }

  return out;
}
