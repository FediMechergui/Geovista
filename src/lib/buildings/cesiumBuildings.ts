/**
 * OSM buildings on the globe, without a Cesium Ion token.
 *
 * Cesium OSM Buildings is a pre-tiled global 3D Tileset served from Ion, so it
 * needs a token. When there isn't one the globe would otherwise have no
 * buildings at all — so this builds them from the very same OSM footprints the
 * Terrain view extrudes, using the same material resolver, and draws them as
 * one batched primitive.
 *
 * Two differences from the Terrain view, both deliberate:
 *
 *   - **Flat tops.** `roof:shape` detail is invisible at globe scale and would
 *     cost a custom geometry per building; Cesium OSM Buildings is flat-topped
 *     for the same reason.
 *   - **One ground height per building**, sampled from the terrain provider at
 *     the footprint centroid, rather than per vertex. A building sits on a
 *     level pad in reality, and it means one terrain sample instead of ten.
 *
 * Coverage is the selected region only — this is the digital-twin area, not a
 * global dataset.
 */

import {
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  Cartesian3,
  sampleTerrain,
  sampleTerrainMostDetailed,
  type TerrainProvider,
  type Viewer,
} from '@/lib/cesium';

import type { BuildingData } from '@/types/buildings';
import { estimateBuildingHeight } from '@/lib/buildings/buildingMesh';
import { resolveBuildingMaterial } from '@/lib/buildings/materials';

/** Hard cap so a dense city centre cannot stall the globe. */
const MAX_BUILDINGS = 4000;

/** Footprints smaller than this are noise at globe scale. */
const MIN_AREA_M2 = 8;

/**
 * Zoom level used when a terrain provider cannot say which tiles it has.
 * 13 is ~20 m/px — finer than the pad a building sits on, and cheap.
 */
const SAMPLE_LEVEL = 13;

export interface CesiumBuildingLayer {
  /** How many buildings ended up on screen. */
  readonly count: number;
  setVisible(visible: boolean): void;
  destroy(): void;
}

/** Ring area in m², via the shoelace formula on a local metre frame. */
function ringAreaM2(ring: Array<[number, number]>, cosLat: number): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    sum += x0 * cosLat * y1 - x1 * cosLat * y0;
  }
  return Math.abs(sum / 2) * 111320 * 111320;
}

/** Drop the repeated closing vertex OSM rings carry. */
function openRing(ring: Array<[number, number]>): Array<[number, number]> {
  if (ring.length < 2) return ring;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  return Math.abs(fx - lx) < 1e-9 && Math.abs(fy - ly) < 1e-9 ? ring.slice(0, -1) : ring;
}

function centroidOf(ring: Array<[number, number]>): [number, number] {
  let lon = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  return [lon / ring.length, lat / ring.length];
}

/**
 * Fill in terrain heights for `samples`, in place.
 *
 * `sampleTerrainMostDetailed` needs the provider to publish tile availability,
 * which Cesium World Terrain does and a raster-backed provider does not. So
 * the availability-driven path is tried first and anything else falls back to
 * sampling one fixed level — without this, a provider with no availability
 * silently leaves every height undefined and every building sinks to sea
 * level, which on an 80 m plateau means they are buried.
 */
async function sampleGround(
  provider: TerrainProvider,
  samples: Cartographic[],
): Promise<void> {
  if (samples.length === 0) return;

  if (provider.availability) {
    try {
      await sampleTerrainMostDetailed(provider, samples);
      return;
    } catch {
      // Fall through to the fixed-level path.
    }
  }

  try {
    await sampleTerrain(provider, SAMPLE_LEVEL, samples);
  } catch {
    // An ellipsoid provider has nothing to sample; sea level is correct there.
  }
}

/**
 * Build and add the primitive. Resolves once the geometry is on the globe;
 * returns `null` if nothing was worth drawing.
 */
export async function createCesiumBuildingLayer(
  viewer: Viewer,
  buildings: BuildingData[],
  signal?: AbortSignal,
): Promise<CesiumBuildingLayer | null> {
  if (buildings.length === 0) return null;

  /* ---- Flatten outlines and parts into drawable volumes ---- */

  interface Volume {
    ring: Array<[number, number]>;
    centre: [number, number];
    area: number;
    base: number;
    top: number;
    color: Color;
  }

  const volumes: Volume[] = [];

  for (const building of buildings) {
    if (volumes.length >= MAX_BUILDINGS) break;

    // Simple 3D Buildings: parts replace the parent outline, as in the mesh path.
    const sources = building.parts?.length ? building.parts : [building];

    for (const source of sources) {
      const ring = openRing(source.geometry);
      if (ring.length < 3) continue;

      const centre = centroidOf(ring);
      const cosLat = Math.cos((centre[1] * Math.PI) / 180);
      const area = ringAreaM2(ring, cosLat);
      if (area < MIN_AREA_M2) continue;

      const props = source.properties;
      const height = estimateBuildingHeight(props);
      if (!Number.isFinite(height) || height <= 0) continue;

      const minHeight =
        props.minHeight ?? (props.minLevel ? props.minLevel * 3.2 : 0);
      if (minHeight >= height) continue;

      const assignment = resolveBuildingMaterial(props, area);
      volumes.push({
        ring,
        centre,
        area,
        base: Math.max(0, minHeight),
        top: height,
        color: Color.fromCssColorString(assignment.facade.color),
      });
    }
  }

  if (volumes.length === 0) return null;

  /* ---- One terrain sample per building, batched ---- */

  const samples = volumes.map((v) => Cartographic.fromDegrees(v.centre[0], v.centre[1]));

  await sampleGround(viewer.terrainProvider, samples);
  if (signal?.aborted) return null;

  /* ---- Geometry ---- */

  const instances: GeometryInstance[] = [];

  for (let i = 0; i < volumes.length; i++) {
    const v = volumes[i];
    const ground = Number.isFinite(samples[i].height) ? samples[i].height : 0;

    const positions = v.ring.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat));

    instances.push(
      new GeometryInstance({
        geometry: new PolygonGeometry({
          polygonHierarchy: new PolygonHierarchy(positions),
          height: ground + v.base,
          extrudedHeight: ground + v.top,
          vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: {
          color: ColorGeometryInstanceAttribute.fromColor(v.color),
        },
        id: { type: 'osm-building', area: v.area, height: v.top },
      }),
    );
  }

  const primitive = new Primitive({
    geometryInstances: instances,
    appearance: new PerInstanceColorAppearance({ flat: false, translucent: false }),
    asynchronous: true,
    releaseGeometryInstances: true,
  });

  viewer.scene.primitives.add(primitive);

  return {
    count: instances.length,
    setVisible(visible: boolean) {
      primitive.show = visible;
    },
    destroy() {
      if (!viewer.isDestroyed() && !primitive.isDestroyed()) {
        viewer.scene.primitives.remove(primitive);
      }
    },
  };
}
