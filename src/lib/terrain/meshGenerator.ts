/**
 * Three.js mesh generators for terrain, geology, and buildings.
 *
 * ## Coordinate system
 *
 * All geometry is rendered in **geographic degrees**, with elevation in
 * meters converted to degrees via `DEG_PER_M = 1 / 111320`. This keeps
 * the visual scale of vertical features proportional to the horizontal
 * extent without any projection work.
 *
 * At the equator 1° ≈ 111 320 m. At higher latitudes longitude degrees
 * shrink (so the tile looks horizontally squashed — correct for a raw
 * lat/lon view). For true-metric rendering, reproject to UTM first.
 *
 * All meshes are rotated `-π/2` around the X axis so that:
 *   +X = east, +Y = up (elevation), −Z = north.
 *
 * ## Returns
 *
 * - `generateTerrainMesh` → a single `THREE.Mesh` with a hypsometric
 *   `MeshPhongMaterial` using per-vertex colors.
 * - `generateGeologyLayers` → a `THREE.Group` of stacked planes.
 * - `generateBuildingMeshes` → a `THREE.Group` of extruded footprints.
 */

import * as THREE from 'three';
import type { BBox, ElevationGrid } from '@/types/geo';
import type { GeologyLayerDef } from '@/types/geology';
import type { BuildingData } from '@/types/buildings';
import { HYPSOMETRIC_STOPS } from '@/lib/constants';
import { estimateBuildingHeight } from '@/lib/buildings/osmFetcher';

// ---------- Shared constants -----------------------------------------------

/** Conversion factor: 1° latitude ≈ 111 320 m at the equator. */
const DEG_PER_M = 1 / 111320;

/** Max grid segments per side for geology layers — terrain-fidelity is wasted here. */
const GEOLOGY_MAX_SEGMENTS = 128;

// ---------- Hypsometric color LUT ------------------------------------------

/**
 * Precomputed `THREE.Color` LUT from `HYPSOMETRIC_STOPS`.
 * Sorted ascending by elevation so binary-style lookup works.
 */
const HYPSO_LUT: ReadonlyArray<{ elev: number; color: THREE.Color }> =
  HYPSOMETRIC_STOPS.map((s) => ({
    elev: s.elev,
    color: new THREE.Color(s.color),
  }));

/**
 * Fill `out` with the hypsometric color for a given elevation (meters).
 * No allocations — caller reuses a single scratch `Color`.
 */
function fillHypsoColor(elevation: number, out: THREE.Color): THREE.Color {
  if (elevation <= HYPSO_LUT[0].elev) {
    return out.copy(HYPSO_LUT[0].color);
  }
  const last = HYPSO_LUT[HYPSO_LUT.length - 1];
  if (elevation >= last.elev) {
    return out.copy(last.color);
  }
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

/**
 * Generate a hypsometrically-colored terrain mesh from an elevation grid.
 *
 * @param grid                 Source DEM as an `ElevationGrid`.
 * @param verticalExaggeration Multiplier for elevation values (default 1.5).
 * @param textureUrl           Optional image draped over the mesh. When
 *                             provided, it blends (multiplicatively) with
 *                             the hypsometric vertex colors. Loaded
 *                             asynchronously — the mesh is returned
 *                             immediately, texture appears when ready.
 * @param landUseCanvas        Optional OffscreenCanvas with rasterized OSM
 *                             land-use data. When provided, overrides the
 *                             hypsometric vertex colors with real-world
 *                             biome/land-use coloring.
 */
export function generateTerrainMesh(
  grid: ElevationGrid,
  verticalExaggeration: number = 1.5,
  textureUrl?: string,
  landUseCanvas?: OffscreenCanvas,
): THREE.Mesh {
  const { width, height, data, bbox, noDataValue } = grid;

  // Latitude correction: at higher latitudes, 1° of longitude covers fewer
  // meters than 1° of latitude.  Scale the horizontal (east-west) extent by
  // cos(midLat) so the mesh has the correct aspect ratio.
  const midLat = (bbox.north + bbox.south) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);

  const geometry = new THREE.PlaneGeometry(
    (bbox.east - bbox.west) * cosLat,
    bbox.north - bbox.south,
    width - 1,
    height - 1,
  );

  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const elevScale = verticalExaggeration * DEG_PER_M;
  const scratch = new THREE.Color();

  // Vertex[i] ↔ data[i] — PlaneGeometry and ImageData agree on row-major
  // top-left origin, so no row/col arithmetic is needed.
  for (let i = 0; i < positions.count; i++) {
    const raw = data[i];
    // Clamp ocean pixels: elevations below -10 m are treated as sea-level
    // to avoid ripple artifacts from noisy near-zero ocean values.
    const elevation = raw === noDataValue ? 0 : raw < -10 ? 0 : raw;

    positions.setZ(i, elevation * elevScale);

    fillHypsoColor(elevation, scratch);
    colors[i * 3] = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;
  }

  positions.needsUpdate = true;
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  // When a land-use canvas is provided, create a texture from it and
  // use it as the primary coloring instead of per-vertex hypsometric colors.
  // The UV coordinates from PlaneGeometry map 0→1 across the surface.
  let material: THREE.MeshPhongMaterial;

  if (landUseCanvas) {
    const canvasTexture = new THREE.CanvasTexture(
      landUseCanvas as unknown as HTMLCanvasElement,
    );
    canvasTexture.colorSpace = THREE.SRGBColorSpace;
    canvasTexture.minFilter = THREE.LinearFilter;
    canvasTexture.magFilter = THREE.LinearFilter;
    canvasTexture.wrapS = THREE.ClampToEdgeWrapping;
    canvasTexture.wrapT = THREE.ClampToEdgeWrapping;

    material = new THREE.MeshPhongMaterial({
      map: canvasTexture,
      side: THREE.DoubleSide,
      flatShading: false,
      shininess: 8,
    });
  } else {
    material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      flatShading: false,
      shininess: 10,
    });
  }

  // Async draped imagery — mesh is usable before the texture resolves.
  if (textureUrl) {
    const loader = new THREE.TextureLoader();
    loader.load(
      textureUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        material.map = texture;
        material.needsUpdate = true;
      },
      undefined,
      (err) => {
        console.warn("[meshGenerator] terrain texture load failed:", err);
      },
    );
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.userData = { type: "terrain", verticalExaggeration };
  return mesh;
}

// ---------- 2. Geology layers ----------------------------------------------

/**
 * Generate a stack of semi-transparent planes representing underground
 * geological layers below the terrain surface.
 *
 * Each plane follows the surface shape, offset downward by `depthTop`.
 * Geology meshes are downsampled (max 128×128 segments) since sub-surface
 * detail doesn't warrant full terrain resolution.
 */
export function generateGeologyLayers(
  surfaceGrid: ElevationGrid,
  layers: GeologyLayerDef[],
  verticalExaggeration: number = 1.5,
): THREE.Group {
  const group = new THREE.Group();
  group.userData = { type: "geology-stack" };

  if (layers.length === 0) return group;

  const { width, height, data, bbox, noDataValue } = surfaceGrid;
  const wSeg = Math.min(width - 1, GEOLOGY_MAX_SEGMENTS);
  const hSeg = Math.min(height - 1, GEOLOGY_MAX_SEGMENTS);
  const vertsPerRow = wSeg + 1;
  const vertsPerCol = hSeg + 1;

  // Latitude correction (matches terrain mesh)
  const midLat = (bbox.north + bbox.south) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);

  // Sample stride into the source grid (floating point so we cover the full range).
  const stepW = (width - 1) / wSeg;
  const stepH = (height - 1) / hSeg;
  const elevScale = verticalExaggeration * DEG_PER_M;

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

      const srcRow = Math.min(Math.floor(row * stepH), height - 1);
      const srcCol = Math.min(Math.floor(col * stepW), width - 1);

      const raw = data[srcRow * width + srcCol];
      const surfaceElev = raw === noDataValue ? 0 : raw;
      const layerElev = surfaceElev - layer.depthTop;

      positions.setZ(i, layerElev * elevScale);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();

    const material = new THREE.MeshPhongMaterial({
      color: new THREE.Color(layer.color),
      transparent: true,
      opacity: layer.opacity,
      side: THREE.DoubleSide,
      flatShading: false,
      depthWrite: false, // transparent layers should not occlude each other
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.userData = {
      type: "geology-layer",
      name: layer.name,
      lith: layer.lith,
      depthTop: layer.depthTop,
      depthBottom: layer.depthBottom,
    };

    // Render back-to-front: deepest layers first so transparency composites
    // correctly. Three.js sort order uses `renderOrder`.
    mesh.renderOrder = -layer.depthTop;

    group.add(mesh);
    // Unused inner variable suppression
    void vertsPerCol;
  }

  return group;
}

// ---------- 3. Building meshes ---------------------------------------------

/**
 * Generate extruded 3D building meshes from OSM footprints.
 *
 * Footprint coordinates are converted from `[lon, lat]` to local offsets
 * against the bbox center, then extruded by the estimated height. All
 * meshes share a single material for performance.
 *
 * @param buildings       Array of OSM `BuildingData` polygons.
 * @param bbox            Reference bbox — footprints are positioned relative to its center.
 * @param groundElevation Ground plane elevation in meters (single global value).
 *                        For proper terrain-following, sample the DEM per
 *                        building centroid and position each mesh individually.
 */
export function generateBuildingMeshes(
  buildings: BuildingData[],
  bbox: BBox,
  groundElevation: number = 0,
): THREE.Group {
  const group = new THREE.Group();
  group.userData = { type: 'building-stack' };

  if (buildings.length === 0) return group;

  const centerLon = (bbox.west + bbox.east) / 2;
  const centerLat = (bbox.south + bbox.north) / 2;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);

  // Single shared material — OSM buildings are unlit neutral gray by default.
  // DoubleSide protects against CW/CCW winding in OSM polygon data.
  const material = new THREE.MeshPhongMaterial({
    color: 0xdddddd,
    side: THREE.DoubleSide,
    flatShading: true,
    shininess: 0,
  });

  for (const building of buildings) {
    const coords = stripClosingPoint(building.geometry);
    if (coords.length < 3) continue;

    const heightM = estimateBuildingHeight(building.properties);
    if (!Number.isFinite(heightM) || heightM <= 0) continue;

    // Build a 2D Shape in (lon, lat) offsets from the bbox center.
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
      depth: heightM * DEG_PER_M,
      bevelEnabled: false,
      steps: 1,
    });

    const mesh = new THREE.Mesh(geometry, material);
    // Match the terrain orientation: lat → −Z, elevation → +Y.
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = groundElevation * DEG_PER_M;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      type: 'building',
      id: building.id,
      name: building.properties.name,
      buildingType: building.properties.type,
      height: heightM,
    };

    group.add(mesh);
  }

  return group;
}

/**
 * OSM rings often repeat the first vertex as the last one to close the
 * polygon. `THREE.Shape` prefers an open list + `closePath()` at the end.
 */
function stripClosingPoint(
  coords: Array<[number, number]>,
): Array<[number, number]> {
  if (coords.length < 2) return coords;
  const [fx, fy] = coords[0];
  const [lx, ly] = coords[coords.length - 1];
  return fx === lx && fy === ly ? coords.slice(0, -1) : coords;
}
