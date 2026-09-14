/**
 * Three.js mesh generators for the terrain surface and the geology stack.
 *
 * Buildings live in `@/lib/buildings/buildingMesh`, which needs per-material
 * batching and real-world UVs that do not belong in a terrain module.
 *
 * ## Coordinate system
 *
 * All geometry is rendered in **geographic degrees**. The east-west extent is
 * scaled by cos(latitude) so the mesh has the correct aspect ratio, and
 * elevation in meters is converted to degrees via `DEG_PER_M = 1 / 111320`.
 *
 * All meshes are rotated `-π/2` around the X axis so that:
 *   +X = east, +Y = up (elevation), −Z = north.
 *
 * Vertical exaggeration is applied by the caller (a parent group scaled on
 * Y), so every generator here builds geometry at 1× exaggeration.
 */

import * as THREE from 'three';
import type { ElevationGrid } from '@/types/geo';
import type { GeologyLayerDef } from '@/types/geology';
import type { ProspectZone } from '@/types/subsurface';
import { HYPSOMETRIC_STOPS } from '@/lib/constants';
import { sampleGridPixel } from '@/lib/terrain/demLoader';
import { zoneColor } from '@/lib/geology/prospectivity';

// ---------- Shared constants -----------------------------------------------

/** Conversion factor: 1° latitude ≈ 111 320 m. */
export const DEG_PER_M = 1 / 111320;

/** Max grid segments per side for geology layers — sub-surface detail is wasted. */
const GEOLOGY_MAX_SEGMENTS = 128;

/** Ocean pixels below this are treated as sea level to avoid ripple artifacts. */
const SEA_CLAMP_M = -10;

// ---------- Hypsometric color LUT ------------------------------------------

const HYPSO_LUT: ReadonlyArray<{ elev: number; color: THREE.Color }> =
  HYPSOMETRIC_STOPS.map((s) => ({
    elev: s.elev,
    color: new THREE.Color(s.color),
  }));

function fillHypsoColor(elevation: number, out: THREE.Color): THREE.Color {
  if (elevation <= HYPSO_LUT[0].elev) return out.copy(HYPSO_LUT[0].color);
  const last = HYPSO_LUT[HYPSO_LUT.length - 1];
  if (elevation >= last.elev) return out.copy(last.color);
  for (let i = 0; i < HYPSO_LUT.length - 1; i++) {
    const a = HYPSO_LUT[i];
    const b = HYPSO_LUT[i + 1];
    if (elevation <= b.elev) {
      const t = (elevation - a.elev) / (b.elev - a.elev);
      return out.lerpColors(a.color, b.color, t);
    }
  }
  return out.copy(last.color);
}

// ---------- 1. Terrain mesh ------------------------------------------------

export interface TerrainMeshOptions {
  /**
   * Optional canvas draped over the mesh (satellite imagery or rasterized
   * land use). Its edges must coincide with `grid.bbox`. When omitted the
   * mesh uses hypsometric vertex colors.
   */
  textureCanvas?: OffscreenCanvas | HTMLCanvasElement | null;
  /** Max segments per side; the DEM is bilinearly resampled if denser. */
  maxSegments?: number;
}

/**
 * Generate a terrain mesh from an elevation grid.
 * Vertex colors are always hypsometric; a texture, when given, replaces them.
 */
export function generateTerrainMesh(
  grid: ElevationGrid,
  { textureCanvas = null, maxSegments = 768 }: TerrainMeshOptions = {},
): THREE.Mesh {
  const { width, height, bbox } = grid;

  const midLat = (bbox.north + bbox.south) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);

  const wSeg = Math.max(1, Math.min(width - 1, maxSegments));
  const hSeg = Math.max(1, Math.min(height - 1, maxSegments));
  const vertsPerRow = wSeg + 1;

  const geometry = new THREE.PlaneGeometry(
    (bbox.east - bbox.west) * cosLat,
    bbox.north - bbox.south,
    wSeg,
    hSeg,
  );

  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const scratch = new THREE.Color();

  const stepW = (width - 1) / wSeg;
  const stepH = (height - 1) / hSeg;

  // PlaneGeometry vertices are row-major from the top-left, matching the grid.
  for (let i = 0; i < positions.count; i++) {
    const row = Math.floor(i / vertsPerRow);
    const col = i % vertsPerRow;
    const raw = sampleGridPixel(grid, col * stepW, row * stepH);
    const elevation = raw === null ? 0 : raw < SEA_CLAMP_M ? 0 : raw;

    positions.setZ(i, elevation * DEG_PER_M);

    fillHypsoColor(elevation, scratch);
    colors[i * 3] = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;
  }

  positions.needsUpdate = true;
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  let material: THREE.MeshStandardMaterial;

  if (textureCanvas) {
    const texture = new THREE.CanvasTexture(textureCanvas as HTMLCanvasElement);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 16; // clamped to the GPU maximum by the renderer
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    });
  } else {
    material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
    });
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData = { type: 'terrain', segments: [wSeg, hSeg] };
  return mesh;
}

// ---------- 2. Geology layers ----------------------------------------------

/**
 * Generate a stack of semi-transparent planes representing underground
 * geological layers below the terrain surface. Each plane follows the
 * surface shape, offset downward by `depthTop`.
 */
export function generateGeologyLayers(
  surfaceGrid: ElevationGrid,
  layers: GeologyLayerDef[],
): THREE.Group {
  const group = new THREE.Group();
  group.userData = { type: 'geology-stack' };

  if (layers.length === 0) return group;

  const { width, height, bbox } = surfaceGrid;
  const wSeg = Math.min(width - 1, GEOLOGY_MAX_SEGMENTS);
  const hSeg = Math.min(height - 1, GEOLOGY_MAX_SEGMENTS);
  const vertsPerRow = wSeg + 1;

  const midLat = (bbox.north + bbox.south) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);

  const stepW = (width - 1) / wSeg;
  const stepH = (height - 1) / hSeg;

  for (const layer of layers) {
    const geometry = new THREE.PlaneGeometry(
      (bbox.east - bbox.west) * cosLat,
      bbox.north - bbox.south,
      wSeg,
      hSeg,
    );

    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const row = Math.floor(i / vertsPerRow);
      const col = i % vertsPerRow;
      const surface = sampleGridPixel(surfaceGrid, col * stepW, row * stepH) ?? 0;
      positions.setZ(i, (surface - layer.depthTop) * DEG_PER_M);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(layer.color),
      transparent: true,
      opacity: layer.opacity,
      side: THREE.DoubleSide,
      roughness: 1,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.userData = {
      type: 'geology-layer',
      name: layer.name,
      lith: layer.lith,
      depthTop: layer.depthTop,
      depthBottom: layer.depthBottom,
    };
    // Deepest layers first so transparency composites correctly.
    mesh.renderOrder = -layer.depthTop;
    group.add(mesh);
  }

  return group;
}

/** Dispose every geometry and material under an object. */
export function disposeObject(obj: THREE.Object3D | null | undefined): void {
  if (!obj) return;
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        const mat = m as THREE.MeshStandardMaterial;
        mat.map?.dispose();
        mat.emissiveMap?.dispose();
        mat.normalMap?.dispose();
        mat.roughnessMap?.dispose();
        mat.dispose();
      }
    }
  });
}

// ---------- 3. Subsurface prospect zones -----------------------------------

/**
 * Highlight the scored aquifer / hydrocarbon intervals inside the geology
 * stack.
 *
 * Each zone becomes a slab that follows the terrain surface, offset down to
 * its depth range: a translucent top and bottom face plus a wireframe cage, so
 * it reads as a *highlighted interval in the column* rather than as a mapped
 * body of water or oil — which is exactly the distinction the scores make.
 */
export function generateProspectVolumes(
  surfaceGrid: ElevationGrid,
  zones: ProspectZone[],
  opacity = 0.34,
): THREE.Group {
  const group = new THREE.Group();
  group.userData = { type: 'prospect-stack', count: zones.length };
  if (zones.length === 0) return group;

  const { width, height, bbox } = surfaceGrid;
  const wSeg = Math.min(width - 1, 64);
  const hSeg = Math.min(height - 1, 64);
  const vertsPerRow = wSeg + 1;

  const midLat = (bbox.north + bbox.south) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const meshWidth = (bbox.east - bbox.west) * cosLat;
  const meshHeight = bbox.north - bbox.south;

  const stepW = (width - 1) / wSeg;
  const stepH = (height - 1) / hSeg;

  /** A surface-following sheet at a fixed depth below ground. */
  const sheetAt = (depth: number): THREE.PlaneGeometry => {
    const geometry = new THREE.PlaneGeometry(meshWidth, meshHeight, wSeg, hSeg);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const row = Math.floor(i / vertsPerRow);
      const col = i % vertsPerRow;
      const surface = sampleGridPixel(surfaceGrid, col * stepW, row * stepH) ?? 0;
      positions.setZ(i, (surface - depth) * DEG_PER_M);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  };

  for (const zone of zones) {
    const color = new THREE.Color(zoneColor(zone));
    // Weak zones are drawn fainter, so the strong ones read first.
    const alpha = opacity * (0.45 + zone.score * 0.55);

    for (const depth of [zone.depthTop, zone.depthBottom]) {
      const mesh = new THREE.Mesh(
        sheetAt(depth),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.22,
          transparent: true,
          opacity: alpha,
          side: THREE.DoubleSide,
          roughness: 0.85,
          depthWrite: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 10 - depth * 0.001;
      mesh.userData = {
        type: 'prospect-zone',
        id: zone.id,
        kind: zone.kind,
        title: zone.title,
        score: zone.score,
        depthTop: zone.depthTop,
        depthBottom: zone.depthBottom,
      };
      group.add(mesh);
    }

    // A cage around the interval makes the top and bottom read as one body.
    const cage = new THREE.Mesh(
      sheetAt((zone.depthTop + zone.depthBottom) / 2),
      new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: alpha * 0.5,
        depthWrite: false,
      }),
    );
    cage.rotation.x = -Math.PI / 2;
    cage.renderOrder = 11;
    cage.userData = { type: 'prospect-cage', id: zone.id };
    group.add(cage);
  }

  return group;
}
