/**
 * Three.js rendering for the road network and the traffic simulation.
 *
 * Three things are drawn:
 *
 *   1. **Road ribbons** — each edge becomes a quad strip of the right width
 *      for its lane count and class, draped onto the DEM and lifted a few
 *      centimetres so it does not z-fight with the terrain. Lane markings are
 *      a procedural texture repeated along the road, so a four-lane road shows
 *      four lanes.
 *   2. **Vehicles** — one `InstancedMesh` per vehicle kind. A few hundred
 *      cars cost six draw calls, and per-instance colour comes from an
 *      instance colour attribute rather than per-vehicle materials.
 *   3. **Signal heads** — a small instanced mast per signalised approach,
 *      recoloured each frame from the simulation's light state.
 *
 * ## Units
 *
 * The simulation works in metres in a local east-north frame. The scene works
 * in degrees with elevation converted through `DEG_PER_M`. Both use the same
 * 111 320 m/° constant, so converting is a single uniform scale — applied as
 * a group scale rather than per-vertex, which keeps the per-frame vehicle
 * updates in plain metres.
 */

import * as THREE from 'three';
import type { ElevationGrid } from '@/types/geo';
import type { EdgeStats, RoadGraph, VehicleKind, VehiclePose } from '@/types/traffic';
import { LANE_WIDTH_M, localToGeo, frameFor } from '@/lib/traffic/roadGraph';
import { edgeColor } from '@/lib/traffic/analytics';
import { VEHICLE_SPECS, VEHICLE_KINDS } from '@/lib/traffic/vehicles';
import { sampleElevation } from '@/lib/terrain/demLoader';
import { DEG_PER_M } from '@/lib/buildings/buildingMesh';

/** How far above the terrain the carriageway sits, metres. */
const ROAD_LIFT_M = 0.35;
/** Extra lift for bridges so they clear whatever they cross. */
const BRIDGE_LIFT_M = 5;
/** Vehicles ride this far above the road surface, metres. */
const VEHICLE_LIFT_M = 0.1;

/** Maximum instances reserved per vehicle kind. */
const MAX_INSTANCES_PER_KIND = 400;

/* ================================================================== */
/*  Lane-marking texture                                               */
/* ================================================================== */

const markingCache = new Map<number, THREE.CanvasTexture>();

/**
 * Procedural carriageway texture for a road with `lanes` lanes: asphalt, a
 * dashed line between each pair of lanes and a solid edge line on both sides.
 * One texture tile covers the full width and 12 m of length.
 */
function laneMarkingTexture(lanes: number): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const cached = markingCache.get(lanes);
  if (cached) return cached;

  const W = 128;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#39393c';
  ctx.fillRect(0, 0, W, H);

  // Subtle wear along the wheel paths.
  for (let lane = 0; lane < lanes; lane++) {
    const cx = ((lane + 0.5) / lanes) * W;
    const grad = ctx.createLinearGradient(cx - 14, 0, cx + 14, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.045)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - 14, 0, 28, H);
  }

  // Solid edge lines.
  ctx.fillStyle = '#e8e6de';
  ctx.fillRect(1, 0, 3, H);
  ctx.fillRect(W - 4, 0, 3, H);

  // Dashed lane dividers: 3 m mark, 9 m gap at this tile scale.
  for (let lane = 1; lane < lanes; lane++) {
    const x = (lane / lanes) * W - 1.5;
    for (let y = 0; y < H; y += H / 2) {
      ctx.fillRect(x, y, 3, H / 8);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  markingCache.set(lanes, texture);
  return texture;
}

/** Drop cached textures; called when the region changes. */
export function clearRoadTextureCache(): void {
  for (const texture of markingCache.values()) texture.dispose();
  markingCache.clear();
}

/* ================================================================== */
/*  Road ribbons                                                       */
/* ================================================================== */

/**
 * Where one edge's vertices live. Ribbons are batched by lane count, so an
 * offset only means anything together with the bucket it belongs to.
 */
export interface ColorRange {
  /** Lane-count bucket, matching the mesh's `userData.lanes`. */
  lanes: number;
  start: number;
  count: number;
}

export interface RoadMeshResult {
  group: THREE.Group;
  /** edge id → its vertex range inside its own bucket's colour attribute. */
  colorRanges: Map<number, ColorRange>;
}

/**
 * Build the road network mesh.
 *
 * Roads are grouped by lane count so each group can use the matching
 * lane-marking texture; congestion colour rides on a vertex colour attribute
 * that can be rewritten every few frames without rebuilding geometry.
 */
export function generateRoadMeshes(
  graph: RoadGraph,
  grid: ElevationGrid | null,
  stats: Map<number, EdgeStats> | null,
  congestionMode: boolean,
): RoadMeshResult {
  const group = new THREE.Group();
  group.userData = { type: 'road-network' };

  const frame = frameFor(graph.bbox);
  const colorRanges = new Map<number, ColorRange>();

  /** Ground elevation, metres, at a local metric point. */
  const groundAt = (x: number, y: number): number => {
    if (!grid) return 0;
    const [lon, lat] = localToGeo(frame, x, y);
    return sampleElevation(grid, lon, lat) ?? 0;
  };

  // lane count → accumulating arrays
  interface Bucket {
    positions: number[];
    normals: number[];
    uvs: number[];
    colors: number[];
    /** Edge ranges within this bucket, resolved to global offsets later. */
    ranges: Array<{ edge: number; start: number; count: number }>;
  }
  const buckets = new Map<number, Bucket>();

  const scratch = new THREE.Color();

  for (const edge of graph.edges.values()) {
    // A two-way street is two edges over the same tarmac; draw only one of
    // them, or every road gets a double-thick ribbon and z-fights with itself.
    const reverseDrawn = edge.from > edge.to;
    const twoWay = [...(graph.nodes.get(edge.to)?.outgoing ?? [])].some((id) => {
      const other = graph.edges.get(id);
      return other?.to === edge.from && other.wayId === edge.wayId;
    });
    if (twoWay && reverseDrawn) continue;

    const laneKey = Math.min(6, twoWay ? edge.lanes * 2 : edge.lanes);
    let bucket = buckets.get(laneKey);
    if (!bucket) {
      bucket = { positions: [], normals: [], uvs: [], colors: [], ranges: [] };
      buckets.set(laneKey, bucket);
    }

    const laneWidth = LANE_WIDTH_M[edge.klass];
    // A two-way pair is centred on the shared centreline; a one-way edge is
    // drawn to the right of it, which is where its lanes actually sit.
    const halfWidth = (laneKey * laneWidth) / 2;
    const centreShift = twoWay ? 0 : halfWidth;

    const lift = ROAD_LIFT_M + (edge.bridge ? BRIDGE_LIFT_M : 0) + edge.layer * 0.4;
    const vertexStart = bucket.positions.length / 3;

    scratch.set(edgeColor(edge, stats?.get(edge.id), congestionMode));

    const n = edge.points.length / 2;
    let prevLeft: [number, number, number] | null = null;
    let prevRight: [number, number, number] | null = null;

    for (let i = 0; i < n; i++) {
      const x = edge.points[i * 2];
      const y = edge.points[i * 2 + 1];

      // Direction: average of the adjacent segments so corners mitre cleanly.
      const iPrev = Math.max(0, i - 1);
      const iNext = Math.min(n - 1, i + 1);
      const dx = edge.points[iNext * 2] - edge.points[iPrev * 2];
      const dy = edge.points[iNext * 2 + 1] - edge.points[iPrev * 2 + 1];
      const len = Math.hypot(dx, dy) || 1;
      // Right-hand normal.
      const nx = dy / len;
      const ny = -dx / len;

      const cx = x + nx * centreShift;
      const cy = y + ny * centreShift;

      const lx = cx - nx * halfWidth;
      const ly = cy - ny * halfWidth;
      const rx = cx + nx * halfWidth;
      const ry = cy + ny * halfWidth;

      const left: [number, number, number] = [lx, groundAt(lx, ly) + lift, ly];
      const right: [number, number, number] = [rx, groundAt(rx, ry) + lift, ry];

      if (prevLeft && prevRight) {
        const v0 = edge.cumulative[i - 1] / 12;
        const v1 = edge.cumulative[i] / 12;

        // Two triangles, wound so the face points up.
        const push = (
          a: [number, number, number], au: number, av: number,
          b: [number, number, number], bu: number, bv: number,
          c: [number, number, number], cu: number, cv: number,
        ) => {
          bucket!.positions.push(a[0], a[1], -a[2], b[0], b[1], -b[2], c[0], c[1], -c[2]);
          bucket!.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
          bucket!.uvs.push(au, av, bu, bv, cu, cv);
          bucket!.colors.push(
            scratch.r, scratch.g, scratch.b,
            scratch.r, scratch.g, scratch.b,
            scratch.r, scratch.g, scratch.b,
          );
        };

        push(prevLeft, 0, v0, prevRight, 1, v0, right, 1, v1);
        push(prevLeft, 0, v0, right, 1, v1, left, 0, v1);
      }

      prevLeft = left;
      prevRight = right;
    }

    const vertexCount = bucket.positions.length / 3 - vertexStart;
    if (vertexCount > 0) {
      bucket.ranges.push({ edge: edge.id, start: vertexStart, count: vertexCount });
    }
  }

  for (const [lanes, bucket] of buckets) {
    if (bucket.positions.length === 0) continue;

    const count = bucket.positions.length / 3;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < positions.length; i++) positions[i] = bucket.positions[i] * DEG_PER_M;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bucket.normals), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bucket.uvs), 2));

    const colors = new THREE.BufferAttribute(new Float32Array(bucket.colors), 3);
    colors.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('color', colors);
    geometry.computeBoundingSphere();

    const texture = laneMarkingTexture(lanes);
    const material = new THREE.MeshStandardMaterial({
      map: texture ?? undefined,
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.02,
      side: THREE.DoubleSide,
      // Roads sit on the terrain; polygon offset stops the last of the z-fight.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.userData = { type: 'roads', lanes };
    group.add(mesh);

    for (const range of bucket.ranges) {
      colorRanges.set(range.edge, { lanes, start: range.start, count: range.count });
    }
  }

  return { group, colorRanges };
}

/**
 * Rewrite the congestion colours on an existing road group without rebuilding
 * geometry. Cheap enough to run every statistics window.
 */
export function updateRoadColors(
  group: THREE.Group,
  graph: RoadGraph,
  stats: Map<number, EdgeStats>,
  ranges: Map<number, ColorRange>,
  congestionMode: boolean,
): void {
  const scratch = new THREE.Color();

  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const attribute = child.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!attribute) continue;

    const lanes = child.userData.lanes as number | undefined;
    let touched = false;

    for (const [edgeId, range] of ranges) {
      // Offsets are only valid inside the bucket that produced them.
      if (range.lanes !== lanes) continue;
      const edge = graph.edges.get(edgeId);
      if (!edge || range.start + range.count > attribute.count) continue;

      scratch.set(edgeColor(edge, stats.get(edgeId), congestionMode));
      for (let i = 0; i < range.count; i++) {
        attribute.setXYZ(range.start + i, scratch.r, scratch.g, scratch.b);
      }
      touched = true;
    }

    if (touched) attribute.needsUpdate = true;
  }
}

/* ================================================================== */
/*  Vehicles                                                           */
/* ================================================================== */

/** Simple but readable car body: a hull with a cabin and dark glazing. */
function vehicleGeometry(kind: VehicleKind): THREE.BufferGeometry {
  const spec = VEHICLE_SPECS[kind];
  const { length: L, width: W, height: H } = spec;

  const parts: THREE.BufferGeometry[] = [];

  if (kind === 'motorcycle') {
    const body = new THREE.BoxGeometry(W, H * 0.45, L * 0.75);
    body.translate(0, H * 0.45, 0);
    parts.push(body);
    const rider = new THREE.BoxGeometry(W * 0.8, H * 0.5, L * 0.3);
    rider.translate(0, H * 0.8, -L * 0.05);
    parts.push(rider);
  } else if (kind === 'bus' || kind === 'truck') {
    // A box body; for a truck the cab is a separate, shorter block in front.
    if (kind === 'truck') {
      const cab = new THREE.BoxGeometry(W, H * 0.62, L * 0.26);
      cab.translate(0, H * 0.52, L * 0.35);
      parts.push(cab);
      const box = new THREE.BoxGeometry(W, H * 0.78, L * 0.7);
      box.translate(0, H * 0.6, -L * 0.13);
      parts.push(box);
    } else {
      const body = new THREE.BoxGeometry(W, H * 0.78, L);
      body.translate(0, H * 0.52, 0);
      parts.push(body);
    }
  } else {
    // Car / taxi / van: lower hull plus a set-back cabin.
    const hull = new THREE.BoxGeometry(W, H * 0.52, L);
    hull.translate(0, H * 0.3, 0);
    parts.push(hull);

    const cabinLength = kind === 'van' ? L * 0.62 : L * 0.48;
    const cabin = new THREE.BoxGeometry(W * 0.9, H * 0.42, cabinLength);
    cabin.translate(0, H * 0.72, kind === 'van' ? L * 0.02 : -L * 0.06);
    parts.push(cabin);
  }

  // Merge by hand — `mergeGeometries` needs matching attribute sets and these
  // boxes already agree, but building the array once is clearer here.
  const merged = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  for (const part of parts) {
    const nonIndexed = part.index ? part.toNonIndexed() : part;
    const p = nonIndexed.getAttribute('position');
    const nrm = nonIndexed.getAttribute('normal');
    const uv = nonIndexed.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    if (nonIndexed !== part) nonIndexed.dispose();
    part.dispose();
  }

  merged.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  merged.computeBoundingSphere();
  return merged;
}

export interface VehicleLayer {
  group: THREE.Group;
  /** One instanced mesh per vehicle kind. */
  meshes: Map<VehicleKind, THREE.InstancedMesh>;
  dispose(): void;
}

/**
 * Create the vehicle layer. Geometry is built in metres and the whole group
 * is scaled to scene degrees, so per-frame updates stay in simulation units.
 */
export function createVehicleLayer(): VehicleLayer {
  const group = new THREE.Group();
  group.userData = { type: 'traffic-vehicles' };
  group.scale.setScalar(DEG_PER_M);

  const meshes = new Map<VehicleKind, THREE.InstancedMesh>();

  for (const kind of VEHICLE_KINDS) {
    const geometry = vehicleGeometry(kind);
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.42,
      metalness: 0.35,
      vertexColors: false,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES_PER_KIND);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.count = 0;
    mesh.userData = { type: 'vehicles', kind };
    meshes.set(kind, mesh);
    group.add(mesh);
  }

  return {
    group,
    meshes,
    dispose() {
      for (const mesh of meshes.values()) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh.dispose();
      }
      meshes.clear();
      group.clear();
    },
  };
}

const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const position = new THREE.Vector3();
const scale = new THREE.Vector3(1, 1, 1);
const up = new THREE.Vector3(0, 1, 0);
const instanceColor = new THREE.Color();

/**
 * Push the current vehicle poses into the instanced meshes.
 *
 * `groundAt` returns terrain elevation in metres for a local metric point, so
 * vehicles follow the road over hills.
 */
export function updateVehicleLayer(
  layer: VehicleLayer,
  poses: VehiclePose[],
  groundAt: (x: number, y: number) => number,
): void {
  const counts = new Map<VehicleKind, number>();
  for (const kind of VEHICLE_KINDS) counts.set(kind, 0);

  for (const pose of poses) {
    const mesh = layer.meshes.get(pose.kind);
    if (!mesh) continue;
    const index = counts.get(pose.kind) ?? 0;
    if (index >= MAX_INSTANCES_PER_KIND) continue;

    const elevation = groundAt(pose.x, pose.y) + ROAD_LIFT_M + VEHICLE_LIFT_M;
    // Scene axes: +X east, +Y up, −Z north — so the simulation's +y (north)
    // becomes −z, and a heading of 0 (east) faces +X.
    position.set(pose.x, elevation, -pose.y);
    // The body geometry points down +Z, so rotate by (heading + 90°) about up.
    quaternion.setFromAxisAngle(up, pose.heading + Math.PI / 2);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);

    instanceColor.set(pose.color);
    if (pose.braking) instanceColor.lerp(new THREE.Color('#7f1d1d'), 0.25);
    mesh.setColorAt(index, instanceColor);

    counts.set(pose.kind, index + 1);
  }

  for (const [kind, mesh] of layer.meshes) {
    mesh.count = counts.get(kind) ?? 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

/* ================================================================== */
/*  Traffic signals                                                    */
/* ================================================================== */

export interface SignalLayer {
  group: THREE.Group;
  /** Parallel arrays: one entry per rendered signal head. */
  heads: Array<{ node: number; edge: number; mesh: THREE.Mesh }>;
  dispose(): void;
}

const LIGHT_COLORS = {
  green: 0x22c55e,
  amber: 0xf59e0b,
  red: 0xef4444,
} as const;

/**
 * Build a small signal head at the stop line of every signalised approach.
 * Heads are individual meshes rather than instances because each needs its own
 * emissive colour, and a region rarely has more than a few dozen.
 */
export function createSignalLayer(
  graph: RoadGraph,
  grid: ElevationGrid | null,
  maxHeads = 160,
): SignalLayer {
  const group = new THREE.Group();
  group.userData = { type: 'traffic-signals' };
  group.scale.setScalar(DEG_PER_M);

  const frame = frameFor(graph.bbox);
  const groundAt = (x: number, y: number): number => {
    if (!grid) return 0;
    const [lon, lat] = localToGeo(frame, x, y);
    return sampleElevation(grid, lon, lat) ?? 0;
  };

  const heads: SignalLayer['heads'] = [];
  const mastGeometry = new THREE.CylinderGeometry(0.08, 0.08, 3.2, 6);
  const headGeometry = new THREE.BoxGeometry(0.35, 0.9, 0.3);
  const mastMaterial = new THREE.MeshStandardMaterial({ color: 0x3f3f46, roughness: 0.8 });

  for (const node of graph.nodes.values()) {
    if (node.control !== 'signal' || !node.signalGroup) continue;

    for (const edgeId of node.incoming) {
      if (heads.length >= maxHeads) break;
      const edge = graph.edges.get(edgeId);
      if (!edge || node.signalGroup[edgeId] === undefined) continue;

      // Place the head just short of the junction, on the right-hand kerb.
      const n = edge.points.length / 2;
      const ex = edge.points[(n - 1) * 2];
      const ey = edge.points[(n - 1) * 2 + 1];
      const back = 6;
      const x = ex - Math.cos(edge.outHeading) * back + Math.sin(edge.outHeading) * (edge.lanes * 1.8 + 1.5);
      const y = ey - Math.sin(edge.outHeading) * back - Math.cos(edge.outHeading) * (edge.lanes * 1.8 + 1.5);
      const z = groundAt(x, y);

      const mast = new THREE.Mesh(mastGeometry, mastMaterial);
      mast.position.set(x, z + 1.6, -y);
      group.add(mast);

      const head = new THREE.Mesh(
        headGeometry,
        new THREE.MeshStandardMaterial({
          color: 0x1f1f23,
          emissive: new THREE.Color(LIGHT_COLORS.red),
          emissiveIntensity: 1.4,
          roughness: 0.5,
        }),
      );
      head.position.set(x, z + 3.6, -y);
      group.add(head);

      heads.push({ node: node.id, edge: edgeId, mesh: head });
    }
  }

  return {
    group,
    heads,
    dispose() {
      mastGeometry.dispose();
      headGeometry.dispose();
      mastMaterial.dispose();
      for (const { mesh } of heads) {
        (mesh.material as THREE.MeshStandardMaterial).dispose();
      }
      heads.length = 0;
      group.clear();
    },
  };
}

/** Recolour every signal head from the simulation's current light state. */
export function updateSignalLayer(
  layer: SignalLayer,
  lightFor: (node: number, edge: number) => 'green' | 'amber' | 'red' | null,
): void {
  for (const { node, edge, mesh } of layer.heads) {
    const state = lightFor(node, edge);
    if (!state) continue;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.emissive.setHex(LIGHT_COLORS[state]);
  }
}
