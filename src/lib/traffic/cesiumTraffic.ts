/**
 * Cesium rendering for the road network and the traffic simulation.
 *
 * The globe shows the same simulation as the terrain view — the same
 * `TrafficSimulation` instance, the same vehicles, at the same moment. Only
 * the drawing differs:
 *
 *   - Roads are **ground-clamped polylines**, so they lie on Cesium World
 *     Terrain (or on Google's photogrammetry) without the caller having to
 *     sample elevation. Congestion recolours the polyline material.
 *   - Vehicles are a single `PointPrimitive` collection rather than models.
 *     At globe scale a car is a pixel or two, so a sized point reads better
 *     than a mesh and costs one draw call for the whole fleet. Zoomed in, the
 *     points scale up with distance so they still look like traffic.
 *
 * Everything is driven from a `preRender` listener at the caller's request,
 * not through Cesium's `CallbackProperty` machinery, which would re-evaluate
 * per entity per frame.
 */

import {
  Cartesian3,
  Cartographic,
  Color,
  DistanceDisplayCondition,
  Material,
  NearFarScalar,
  PointPrimitiveCollection,
  PolylineCollection,
  ClassificationType,
  GroundPolylinePrimitive,
  GroundPolylineGeometry,
  GeometryInstance,
  ColorGeometryInstanceAttribute,
  PolylineColorAppearance,
  Math as CesiumMath,
  type Viewer,
} from '@/lib/cesium';

import type { EdgeStats, RoadGraph, VehiclePose } from '@/types/traffic';
import { LANE_WIDTH_M, localToGeo, frameFor } from '@/lib/traffic/roadGraph';
import { edgeColor } from '@/lib/traffic/analytics';
import { VEHICLE_SPECS } from '@/lib/traffic/vehicles';

/** Roads further than this from the camera are not worth drawing. */
const ROAD_VISIBLE_M = 60_000;
/** Vehicles are only drawn from this close in. */
const VEHICLE_VISIBLE_M = 12_000;

/* ================================================================== */
/*  Roads                                                              */
/* ================================================================== */

export interface CesiumRoadLayer {
  /** Rebuild the polylines with the current congestion colours. */
  refresh(stats: Map<number, EdgeStats>, congestionMode: boolean): void;
  destroy(): void;
}

/**
 * Draw the road network as ground-clamped polylines.
 *
 * A `GroundPolylinePrimitive` draws onto the terrain and onto 3D Tiles, which
 * is what keeps the roads visible under Google's photogrammetry as well as on
 * Cesium World Terrain. Rebuilding the primitive is the supported way to
 * change per-edge colours, so `refresh` is called on the statistics window
 * rather than every frame.
 */
export function createCesiumRoadLayer(
  viewer: Viewer,
  graph: RoadGraph,
  initialStats: Map<number, EdgeStats> | null,
  congestionMode: boolean,
): CesiumRoadLayer {
  const frame = frameFor(graph.bbox);

  /** Cache the geographic geometry once; only the colours change afterwards. */
  const edges = [...graph.edges.values()]
    .filter((edge) => {
      // One ribbon per carriageway pair, matching the Three.js renderer.
      const twoWay = [...(graph.nodes.get(edge.to)?.outgoing ?? [])].some((id) => {
        const other = graph.edges.get(id);
        return other?.to === edge.from && other.wayId === edge.wayId;
      });
      return !(twoWay && edge.from > edge.to);
    })
    .map((edge) => {
      const positions: Cartesian3[] = [];
      for (let i = 0; i < edge.points.length; i += 2) {
        const [lon, lat] = localToGeo(frame, edge.points[i], edge.points[i + 1]);
        positions.push(Cartesian3.fromDegrees(lon, lat));
      }
      return { edge, positions, width: Math.max(2, edge.lanes * LANE_WIDTH_M[edge.klass] * 0.5) };
    })
    .filter((entry) => entry.positions.length >= 2);

  let primitive: GroundPolylinePrimitive | null = null;

  const build = (stats: Map<number, EdgeStats> | null, congestion: boolean) => {
    if (primitive) {
      viewer.scene.primitives.remove(primitive);
      primitive = null;
    }
    if (edges.length === 0) return;

    const instances = edges.map(
      ({ edge, positions, width }) =>
        new GeometryInstance({
          geometry: new GroundPolylineGeometry({ positions, width }),
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(
              Color.fromCssColorString(edgeColor(edge, stats?.get(edge.id), congestion)).withAlpha(
                0.92,
              ),
            ),
          },
          id: { type: 'road', edge: edge.id, name: edge.name ?? edge.ref ?? edge.klass },
        }),
    );

    primitive = new GroundPolylinePrimitive({
      geometryInstances: instances,
      appearance: new PolylineColorAppearance({ translucent: true }),
      classificationType: ClassificationType.BOTH,
    });
    viewer.scene.primitives.add(primitive);
  };

  build(initialStats, congestionMode);

  return {
    refresh(stats, congestion) {
      if (viewer.isDestroyed()) return;
      build(stats, congestion);
    },
    destroy() {
      if (primitive && !viewer.isDestroyed()) viewer.scene.primitives.remove(primitive);
      primitive = null;
    },
  };
}

/* ================================================================== */
/*  Vehicles                                                           */
/* ================================================================== */

export interface CesiumVehicleLayer {
  /** Push the current poses. Safe to call every frame. */
  update(poses: VehiclePose[]): void;
  destroy(): void;
}

/**
 * Vehicles as a single point-primitive collection.
 *
 * `PointPrimitive` has no `heightReference`, so elevation is supplied here.
 * Sampling the globe per vehicle per frame would be wasteful and mostly
 * redundant — every car on one street sits at nearly the same height — so
 * heights are cached per road edge and refreshed periodically, which also
 * lets them settle as terrain tiles stream in.
 */
export function createCesiumVehicleLayer(viewer: Viewer, graph: RoadGraph): CesiumVehicleLayer {
  const frame = frameFor(graph.bbox);
  const points = new PointPrimitiveCollection();
  viewer.scene.primitives.add(points);

  // Points grow as the camera approaches, so a car reads as a car close up and
  // as a dot from altitude.
  const scaleByDistance = new NearFarScalar(150, 2.6, 8000, 0.45);
  const visibility = new DistanceDisplayCondition(0, VEHICLE_VISIBLE_M);

  const heightByEdge = new Map<number, number>();
  const scratchCarto = new Cartographic();
  let lastHeightSweep = -Infinity;

  /** Ground height at an edge's midpoint, from whatever terrain has loaded. */
  const heightForEdge = (edgeId: number): number => {
    const cached = heightByEdge.get(edgeId);
    if (cached !== undefined) return cached;

    const edge = graph.edges.get(edgeId);
    if (!edge) return 0;

    const mid = Math.floor(edge.points.length / 4) * 2;
    const [lon, lat] = localToGeo(frame, edge.points[mid], edge.points[mid + 1]);
    scratchCarto.longitude = CesiumMath.toRadians(lon);
    scratchCarto.latitude = CesiumMath.toRadians(lat);
    scratchCarto.height = 0;

    const height = viewer.scene.globe.getHeight(scratchCarto) ?? 0;
    heightByEdge.set(edgeId, height);
    return height;
  };

  return {
    update(poses) {
      if (viewer.isDestroyed()) return;

      // Terrain streams in over the first few seconds; re-sample occasionally
      // so vehicles rise onto the hills instead of staying at ellipsoid zero.
      const now = performance.now();
      if (now - lastHeightSweep > 4000) {
        heightByEdge.clear();
        lastHeightSweep = now;
      }

      // Grow the pool on demand; shrink by hiding rather than removing, which
      // would churn the underlying buffers every frame.
      while (points.length < poses.length) {
        points.add({
          position: Cartesian3.ZERO,
          pixelSize: 6,
          color: Color.WHITE,
          outlineColor: Color.BLACK.withAlpha(0.6),
          outlineWidth: 1,
          scaleByDistance,
          distanceDisplayCondition: visibility,
        });
      }

      for (let i = 0; i < points.length; i++) {
        const point = points.get(i);
        const pose = poses[i];
        if (!pose) {
          point.show = false;
          continue;
        }

        const [lon, lat] = localToGeo(frame, pose.x, pose.y);
        // A metre of clearance keeps the point from being depth-culled by the
        // road surface it is sitting on.
        point.position = Cartesian3.fromDegrees(lon, lat, heightForEdge(pose.edge) + 1);

        const spec = VEHICLE_SPECS[pose.kind];
        // Pixel size tracks the real vehicle length so buses read as buses.
        point.pixelSize = 4 + spec.length * 0.55;
        point.color = Color.fromCssColorString(pose.color);
        point.outlineColor = pose.braking
          ? Color.fromCssColorString('#ef4444')
          : Color.BLACK.withAlpha(0.55);
        point.outlineWidth = pose.braking ? 2 : 1;
        point.show = true;
      }
    },
    destroy() {
      heightByEdge.clear();
      if (!viewer.isDestroyed()) viewer.scene.primitives.remove(points);
    },
  };
}

/* ================================================================== */
/*  Route highlight                                                    */
/* ================================================================== */

export interface CesiumRouteLayer {
  show(edgeIds: number[]): void;
  clear(): void;
  destroy(): void;
}

/** A single highlighted polyline for the A→B route, clamped to the ground. */
export function createCesiumRouteLayer(viewer: Viewer, graph: RoadGraph): CesiumRouteLayer {
  const frame = frameFor(graph.bbox);
  const lines = new PolylineCollection();
  viewer.scene.primitives.add(lines);

  return {
    show(edgeIds) {
      if (viewer.isDestroyed()) return;
      lines.removeAll();
      if (edgeIds.length === 0) return;

      const positions: Cartesian3[] = [];
      for (const id of edgeIds) {
        const edge = graph.edges.get(id);
        if (!edge) continue;
        for (let i = 0; i < edge.points.length; i += 2) {
          const [lon, lat] = localToGeo(frame, edge.points[i], edge.points[i + 1]);
          positions.push(Cartesian3.fromDegrees(lon, lat, 6));
        }
      }
      if (positions.length < 2) return;

      lines.add({
        positions,
        width: 6,
        material: Material.fromType('Color', {
          color: Color.fromCssColorString('#38bdf8'),
        }),
        distanceDisplayCondition: new DistanceDisplayCondition(0, ROAD_VISIBLE_M),
      });
    },
    clear() {
      if (!viewer.isDestroyed()) lines.removeAll();
    },
    destroy() {
      if (!viewer.isDestroyed()) viewer.scene.primitives.remove(lines);
    },
  };
}
