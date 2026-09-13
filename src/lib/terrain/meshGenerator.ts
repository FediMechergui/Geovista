/**
 * Three.js mesh generators for terrain, geology, and buildings.
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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BBox, ElevationGrid } from '@/types/geo';
import type { GeologyLayerDef } from '@/types/geology';
import type { BuildingData } from '@/types/buildings';
import { HYPSOMETRIC_STOPS } from '@/lib/constants';
import { estimateBuildingHeight } from '@/lib/buildings/osmFetcher';
import { sampleGridPixel } from '@/lib/terrain/demLoader';

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

// ---------- 3. Building meshes ---------------------------------------------

/** Facade colors by OSM building type; unknown types fall back to `yes`. */
const BUILDING_COLORS: Record<string, string> = {
  yes: '#d9d4c7',
  house: '#e3d6c4',
  detached: '#e3d6c4',
  residential: '#dccbb4',
  apartments: '#cfc6bb',
  commercial: '#c9ccd1',
  office: '#b9c3cc',
  retail: '#d6c8b8',
  industrial: '#bcbfc2',
  warehouse: '#b8bbbe',
  school: '#e0d2a8',
  university: '#dccfa8',
  hospital: '#e6dede',
  church: '#d8cfc0',
  cathedral: '#d0c6b4',
  mosque: '#e0dbcf',
  hotel: '#d4c8c0',
  garage: '#c4c4c4',
  shed: '#c8bfae',
  roof: '#c0c0c0',
};

/** Deterministic small tint so adjacent buildings don't look identical. */
function jitter(id: number): number {
  const x = Math.sin(id * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 0.16 - 0.08; // [-0.08, +0.08]
}

export interface BuildingMeshOptions {
  /** Ground elevation sampler (meters). Buildings sit on the lowest footprint vertex. */
  elevationAt?: (lon: number, lat: number) => number | null;
  /** Fallback ground elevation when the sampler has no data. */
  groundElevation?: number;
}

/**
 * Generate extruded 3D buildings from OSM footprints, merged into a single
 * mesh with per-building vertex colors (one draw call for thousands of
 * buildings). Each building is seated on the terrain at its lowest footprint
 * vertex and extended downward so it never floats on slopes.
 */
export function generateBuildingMeshes(
  buildings: BuildingData[],
  bbox: BBox,
  { elevationAt, groundElevation = 0 }: BuildingMeshOptions = {},
): THREE.Group {
  const group = new THREE.Group();
  group.userData = { type: 'building-stack', count: 0 };
  if (buildings.length === 0) return group;

  const centerLon = (bbox.west + bbox.east) / 2;
  const centerLat = (bbox.south + bbox.north) / 2;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);

  const geometries: THREE.BufferGeometry[] = [];
  const color = new THREE.Color();

  for (const building of buildings) {
    const coords = stripClosingPoint(building.geometry);
    if (coords.length < 3) continue;

    const heightM = estimateBuildingHeight(building.properties);
    if (!Number.isFinite(heightM) || heightM <= 0) continue;

    // Ground: lowest footprint vertex; extend the extrusion by the vertical
    // spread so the top stays flat and the base is buried on slopes.
    let base = Infinity;
    let top = -Infinity;
    if (elevationAt) {
      for (const [lon, lat] of coords) {
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
    const spread = Math.min(top - base, 60);

    const shape = new THREE.Shape();
    for (let i = 0; i < coords.length; i++) {
      const [lon, lat] = coords[i];
      const x = (lon - centerLon) * cosLat;
      const y = lat - centerLat;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: (heightM + spread) * DEG_PER_M,
      bevelEnabled: false,
      steps: 1,
    });
    geometry.translate(0, 0, base * DEG_PER_M);

    // Per-building color
    const type = building.properties.type ?? 'yes';
    color.set(BUILDING_COLORS[type] ?? BUILDING_COLORS.yes);
    color.offsetHSL(0, 0, jitter(building.id));
    const n = geometry.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.deleteAttribute('uv');

    geometries.push(geometry);
  }

  if (geometries.length === 0) return group;

  const merged = mergeGeometries(geometries, false);
  for (const g of geometries) g.dispose();
  if (!merged) return group;

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.85,
    metalness: 0.05,
    side: THREE.DoubleSide, // OSM rings may be CW or CCW
  });

  const mesh = new THREE.Mesh(merged, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { type: 'buildings', count: geometries.length };

  group.userData.count = geometries.length;
  group.add(mesh);
  return group;
}

/** OSM rings repeat the first vertex as the last; `THREE.Shape` wants it open. */
function stripClosingPoint(
  coords: Array<[number, number]>,
): Array<[number, number]> {
  if (coords.length < 2) return coords;
  const [fx, fy] = coords[0];
  const [lx, ly] = coords[coords.length - 1];
  return fx === lx && fy === ly ? coords.slice(0, -1) : coords;
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
        mat.dispose();
      }
    }
  });
}
