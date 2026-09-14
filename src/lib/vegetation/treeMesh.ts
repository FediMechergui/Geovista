/**
 * Instanced trees for the Terrain view.
 *
 * A wood can be ten thousand trees, so nothing here is a per-tree object: each
 * canopy class gets one trunk `InstancedMesh` and one crown `InstancedMesh`,
 * and every tree is a matrix in those two buffers. That is two draw calls per
 * class regardless of count.
 *
 * The crowns are low-poly solids rather than billboards: billboards need a
 * per-frame camera-facing update and break as soon as you tilt the camera to
 * look down at a forest, which is exactly what this view is for.
 *
 * Units match the building mesh: everything is computed in metres in scene
 * orientation (+X east, +Y up, −Z north) and the group is scaled once by
 * `DEG_PER_M`.
 */

import * as THREE from 'three';
import type { BBox } from '@/types/geo';
import type { TreeInstance, TreeKind } from '@/types/vegetation';
import { DEG_PER_M } from '@/lib/buildings/buildingMesh';

const M_PER_DEG = 111320;

/** Trunk colour and crown palette per canopy class. */
const PALETTE: Record<TreeKind, { trunk: string; crown: [string, string] }> = {
  broadleaf: { trunk: '#5c4632', crown: ['#3f7a35', '#6aa84f'] },
  needleleaf: { trunk: '#4a3a2b', crown: ['#2c5738', '#40734a'] },
  palm: { trunk: '#7a6547', crown: ['#4e8c3f', '#7cb45c'] },
  shrub: { trunk: '#5a4a35', crown: ['#5c8f45', '#8bb266'] },
};

/** Trunk height as a fraction of total height. */
const TRUNK_RATIO: Record<TreeKind, number> = {
  broadleaf: 0.38,
  needleleaf: 0.22,
  palm: 0.78,
  shrub: 0.25,
};

/**
 * Crown geometry per class, built at unit size (1 m tall, 1 m radius) and
 * scaled per instance.
 */
function crownGeometry(kind: TreeKind): THREE.BufferGeometry {
  switch (kind) {
    case 'needleleaf': {
      // A stacked pair of cones reads as a conifer far more cheaply than a
      // single cone with enough segments to look convincing.
      const lower = new THREE.ConeGeometry(1, 0.75, 7);
      lower.translate(0, 0.375, 0);
      const upper = new THREE.ConeGeometry(0.62, 0.6, 7);
      upper.translate(0, 0.72, 0);
      return mergeTwo(lower, upper);
    }
    case 'palm': {
      // A flattened dome: the fronds are not worth the triangles at this scale.
      const g = new THREE.SphereGeometry(1, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.55);
      g.scale(1, 0.45, 1);
      g.translate(0, 0.1, 0);
      return g;
    }
    case 'shrub': {
      const g = new THREE.IcosahedronGeometry(1, 0);
      g.scale(1, 0.7, 1);
      g.translate(0, 0.55, 0);
      return g;
    }
    default: {
      const g = new THREE.IcosahedronGeometry(1, 1);
      g.scale(1, 1.15, 1);
      g.translate(0, 0.75, 0);
      return g;
    }
  }
}

/** Concatenate two non-indexed geometries without pulling in the merge util. */
function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const na = a.toNonIndexed();
  const nb = b.toNonIndexed();
  const out = new THREE.BufferGeometry();

  for (const name of ['position', 'normal'] as const) {
    const pa = na.getAttribute(name) as THREE.BufferAttribute;
    const pb = nb.getAttribute(name) as THREE.BufferAttribute;
    const merged = new Float32Array(pa.array.length + pb.array.length);
    merged.set(pa.array as Float32Array, 0);
    merged.set(pb.array as Float32Array, pa.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(merged, pa.itemSize));
  }

  a.dispose();
  b.dispose();
  na.dispose();
  nb.dispose();
  return out;
}

export interface TreeLayerOptions {
  /** Terrain height in metres at a geographic point, or null outside the DEM. */
  elevationAt?: (lon: number, lat: number) => number | null;
  /** Ceiling on how many trees are actually instanced. */
  maxTrees?: number;
}

export interface TreeLayerResult {
  group: THREE.Group;
  /** How many trees made it into the buffers. */
  rendered: number;
}

/**
 * Build the instanced tree layer. Returns an empty group when there is
 * nothing to plant, so callers never have to special-case it.
 */
export function generateTreeLayer(
  trees: TreeInstance[],
  bbox: BBox,
  { elevationAt, maxTrees = 12_000 }: TreeLayerOptions = {},
): TreeLayerResult {
  const group = new THREE.Group();
  group.userData = { type: 'vegetation', count: 0 };
  if (trees.length === 0) return { group, rendered: 0 };

  const centerLon = (bbox.west + bbox.east) / 2;
  const centerLat = (bbox.south + bbox.north) / 2;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);

  // Thin evenly rather than truncating, so a big wood keeps its shape.
  const stride = Math.max(1, Math.ceil(trees.length / maxTrees));
  const byKind = new Map<TreeKind, TreeInstance[]>();
  for (let i = 0; i < trees.length; i += stride) {
    const tree = trees[i];
    const bucket = byKind.get(tree.kind);
    if (bucket) bucket.push(tree);
    else byKind.set(tree.kind, [tree]);
  }

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const colour = new THREE.Color();
  const from = new THREE.Color();
  const to = new THREE.Color();

  let rendered = 0;

  for (const [kind, bucket] of byKind) {
    const palette = PALETTE[kind];
    from.set(palette.crown[0]);
    to.set(palette.crown[1]);

    const trunkGeometry = new THREE.CylinderGeometry(0.09, 0.14, 1, 5);
    trunkGeometry.translate(0, 0.5, 0);
    const crown = crownGeometry(kind);

    const trunkMesh = new THREE.InstancedMesh(
      trunkGeometry,
      new THREE.MeshStandardMaterial({ color: palette.trunk, roughness: 0.95, metalness: 0 }),
      bucket.length,
    );
    const crownMesh = new THREE.InstancedMesh(
      crown,
      new THREE.MeshStandardMaterial({
        vertexColors: false,
        roughness: 0.85,
        metalness: 0,
        flatShading: true,
      }),
      bucket.length,
    );
    crownMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(bucket.length * 3),
      3,
    );

    for (let i = 0; i < bucket.length; i++) {
      const tree = bucket[i];
      const ground = elevationAt?.(tree.lon, tree.lat) ?? 0;

      // Metres in scene orientation, then the whole group is scaled to degrees.
      const x = (tree.lon - centerLon) * cosLat * M_PER_DEG;
      const z = -(tree.lat - centerLat) * M_PER_DEG;

      const trunkHeight = tree.height * TRUNK_RATIO[kind];
      const crownHeight = tree.height - trunkHeight;

      position.set(x, ground, z);
      quaternion.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        tree.variation * Math.PI * 2,
      );
      scale.set(tree.height * 0.09 + 0.12, trunkHeight, tree.height * 0.09 + 0.12);
      trunkMesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));

      position.set(x, ground + trunkHeight, z);
      scale.set(tree.radius, crownHeight, tree.radius);
      crownMesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));

      colour.copy(from).lerp(to, tree.variation);
      crownMesh.instanceColor.setXYZ(i, colour.r, colour.g, colour.b);
      rendered++;
    }

    trunkMesh.instanceMatrix.needsUpdate = true;
    crownMesh.instanceMatrix.needsUpdate = true;
    crownMesh.instanceColor.needsUpdate = true;
    trunkMesh.castShadow = true;
    crownMesh.castShadow = true;
    crownMesh.receiveShadow = true;
    trunkMesh.userData = { type: 'tree-trunks', kind };
    crownMesh.userData = { type: 'tree-crowns', kind };

    group.add(trunkMesh, crownMesh);
  }

  // One scale takes the whole layer from metres into the scene's degree frame.
  group.scale.setScalar(DEG_PER_M);
  group.userData.count = rendered;
  return { group, rendered };
}
