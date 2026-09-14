'use client';

/**
 * TerrainViewer — analytical 3D twin built from open data.
 *
 *   - AWS Terrarium DEM stitched at the highest zoom that fits a tile budget
 *   - Esri World Imagery draped as a 4096² texture aligned to the DEM tiles
 *     (or OSM land-use rasterization, or hypsometric tint)
 *   - OSM buildings with material-accurate facades and real roof shapes
 *   - The OSM road network, with an IDM traffic microsimulation driving on it
 *   - Macrostrat geology stack below the surface, with scored aquifer and
 *     hydrocarbon intervals highlighted
 *   - Measurement, elevation profile and A→B routing
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Sky } from '@react-three/drei';
import * as THREE from 'three';
import { useMapStore } from '@/store/mapStore';
import {
  loadMultiTileDEM,
  chooseDemZoom,
  sampleElevation,
  gridStats,
  bboxAreaKm2,
} from '@/lib/terrain/demLoader';
import { loadImageryForGrid } from '@/lib/terrain/imageryLoader';
import { fetchLandUse, rasterizeLandUse } from '@/lib/terrain/landUseRasterizer';
import {
  generateTerrainMesh,
  generateGeologyLayers,
  generateProspectVolumes,
  disposeObject,
  DEG_PER_M,
} from '@/lib/terrain/meshGenerator';
import { generateDetailedBuildings } from '@/lib/buildings/buildingMesh';
import { summariseMaterials, clearFacadeTextureCache } from '@/lib/buildings/materials';
import { fetchBuildings } from '@/lib/buildings/osmFetcher';
import { fetchVegetation } from '@/lib/vegetation/osmVegetation';
import { generateTreeLayer } from '@/lib/vegetation/treeMesh';
import { clampBBoxArea, bboxAreaKm2 as clampedAreaKm2, MAX_AREA_DEG2 } from '@/lib/geo/bbox';
import { fetchGeologicalColumn, columnToLayers } from '@/lib/geology/macrostratApi';
import { analyseProspectivity } from '@/lib/geology/prospectivity';
import { geodesicDistance } from '@/lib/analysis/coordTransform';
import {
  ensureTrafficSession,
  releaseTrafficSession,
  type TrafficSession,
} from '@/lib/traffic/trafficService';
import {
  createSignalLayer,
  createVehicleLayer,
  generateRoadMeshes,
  updateRoadColors,
  updateSignalLayer,
  updateVehicleLayer,
  clearRoadTextureCache,
  type ColorRange,
  type SignalLayer,
  type VehicleLayer,
} from '@/lib/traffic/trafficMesh';
import { frameFor as graphFrameFor, geoToLocal, pointAt } from '@/lib/traffic/roadGraph';
import { nearestNode, planRoute } from '@/lib/traffic/routing';
import { formatDistance, formatDuration, kmh } from '@/lib/traffic/analytics';
import ElevationProfile, { type ProfilePoint } from '@/components/analysis/ElevationProfile';
import TrafficPanel from '@/components/traffic/TrafficPanel';
import type { ElevationGrid, BBox, TerrainTexture } from '@/types/geo';
import type { BuildingData } from '@/types/buildings';
import type { GeologyLayerDef } from '@/types/geology';
import type { RoutePlan } from '@/types/traffic';
import { Ruler, X, Loader2, Satellite, Trees, Mountain, Navigation, Car } from 'lucide-react';

/* ================================================================== */
/*  Constants                                                          */
/* ================================================================== */

const PROFILE_SAMPLES = 120;
/** Above this grid extent (deg²) buildings are fetched for the selection only. */
const MAX_BUILDING_AREA_DEG2 = 0.02;
const DEM_MAX_TILES = 16;
const DEM_MAX_ZOOM = 14;
/** How often the congestion colours and the stats panel refresh, seconds. */
const STATS_REFRESH_S = 1.5;

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

interface Frame {
  lon: number;
  lat: number;
  cosLat: number;
  width: number; // mesh width in scene units (deg * cosLat)
  height: number; // mesh height in scene units (deg)
}

function frameFor(bbox: BBox): Frame {
  const lat = (bbox.south + bbox.north) / 2;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  return {
    lon: (bbox.west + bbox.east) / 2,
    lat,
    cosLat,
    width: (bbox.east - bbox.west) * cosLat,
    height: bbox.north - bbox.south,
  };
}

/** Convert a world-space point back to geographic coords. */
function worldToGeo(pt: THREE.Vector3, frame: Frame, exaggeration: number) {
  return {
    lon: frame.lon + pt.x / frame.cosLat,
    lat: frame.lat - pt.z,
    elevation: pt.y / (DEG_PER_M * exaggeration),
  };
}

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
}

interface MeasurePoint {
  world: THREE.Vector3;
  lon: number;
  lat: number;
  elevation: number;
}

type InteractionMode = 'none' | 'measure' | 'route';

/* ================================================================== */
/*  R3F scene pieces                                                   */
/* ================================================================== */

/** Camera framing + clip planes sized to the scene (declarative, re-applied when the region changes). */
function CameraSetup({ size }: { size: number }) {
  return (
    <PerspectiveCamera
      makeDefault
      fov={50}
      near={size * 0.0005}
      far={size * 80}
      position={[size * 0.55, size * 0.35, size * 0.6]}
    />
  );
}

function SceneLights({ size }: { size: number }) {
  return (
    <>
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#bcd9ff', '#6b5a45', 0.45]} />
      <directionalLight
        position={[size * 0.9, size * 0.8, size * 0.6]}
        intensity={2.1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={size * 0.01}
        shadow-camera-far={size * 4}
        shadow-camera-left={-size}
        shadow-camera-right={size}
        shadow-camera-top={size}
        shadow-camera-bottom={-size}
        shadow-bias={-0.0005}
      />
    </>
  );
}

function WaterPlane({ frame }: { frame: Frame }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[frame.width * 1.2, frame.height * 1.2]} />
      <meshStandardMaterial
        color="#1e5f8c"
        transparent
        opacity={0.55}
        roughness={0.2}
        metalness={0.35}
        depthWrite={false}
      />
    </mesh>
  );
}

function MeasureMarker({ position, color, size }: { position: THREE.Vector3; color: string; size: number }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[size * 0.006, 16, 16]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

function MeasureLine({ a, b }: { a: THREE.Vector3; b: THREE.Vector3 }) {
  const line = useMemo(
    () =>
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color: '#facc15' }),
      ),
    [a, b],
  );
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );
  return <primitive object={line} />;
}

/* ================================================================== */
/*  Traffic ticker — the only place the simulation advances            */
/* ================================================================== */

interface TrafficTickerProps {
  session: TrafficSession;
  vehicleLayer: VehicleLayer | null;
  signalLayer: SignalLayer | null;
  roadGroup: THREE.Group | null;
  colorRanges: Map<number, ColorRange>;
  grid: ElevationGrid | null;
  running: boolean;
  showCongestion: boolean;
}

function TrafficTicker({
  session,
  vehicleLayer,
  signalLayer,
  roadGroup,
  colorRanges,
  grid,
  running,
  showCongestion,
}: TrafficTickerProps) {
  const setTrafficStats = useMapStore((s) => s.setTrafficStats);
  const sinceStats = useRef(0);

  // Sampling the DEM per vehicle per frame is the one hot path here, so the
  // graph frame is resolved once rather than inside the loop.
  const groundAt = useMemo(() => {
    const frame = graphFrameFor(session.graph.bbox);
    const invLon = 1 / (111320 * frame.cosLat);
    const dem = grid;
    return (x: number, y: number): number =>
      dem ? (sampleElevation(dem, frame.lon + x * invLon, frame.lat + y / 111320) ?? 0) : 0;
  }, [grid, session]);

  useFrame((_, delta) => {
    const { simulation } = session;
    if (running) simulation.step(delta);

    if (vehicleLayer) updateVehicleLayer(vehicleLayer, simulation.poses(), groundAt);
    if (signalLayer) {
      updateSignalLayer(signalLayer, (node, edge) => simulation.lightFor(node, edge));
    }

    sinceStats.current += delta;
    if (sinceStats.current < STATS_REFRESH_S) return;
    sinceStats.current = 0;

    const stats = simulation.edgeStats();
    if (roadGroup && colorRanges.size > 0) {
      updateRoadColors(roadGroup, session.graph, stats, colorRanges, showCongestion);
    }
    setTrafficStats(simulation.stats());
  });

  return null;
}

/* ================================================================== */
/*  Scene                                                             */
/* ================================================================== */

interface SceneProps {
  terrainMesh: THREE.Mesh | null;
  buildingGroup: THREE.Group | null;
  treeGroup: THREE.Group | null;
  geologyGroup: THREE.Group | null;
  prospectGroup: THREE.Group | null;
  roadGroup: THREE.Group | null;
  vehicleLayer: VehicleLayer | null;
  signalLayer: SignalLayer | null;
  routeObject: THREE.Object3D | null;
  trafficChildren: React.ReactNode;
  frame: Frame;
  exaggeration: number;
  underground: boolean;
  showWater: boolean;
  interaction: InteractionMode;
  measurePoints: MeasurePoint[];
  onTerrainClick: (pt: MeasurePoint) => void;
}

function Scene({
  terrainMesh,
  buildingGroup,
  treeGroup,
  geologyGroup,
  prospectGroup,
  roadGroup,
  vehicleLayer,
  signalLayer,
  routeObject,
  trafficChildren,
  frame,
  exaggeration,
  underground,
  showWater,
  interaction,
  measurePoints,
  onTerrainClick,
}: SceneProps) {
  const size = Math.max(frame.width, frame.height);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (interaction === 'none') return;
      e.stopPropagation();
      const geo = worldToGeo(e.point, frame, exaggeration);
      onTerrainClick({ world: e.point.clone(), ...geo });
    },
    [interaction, frame, exaggeration, onTerrainClick],
  );

  return (
    <>
      <Sky
        distance={size * 30}
        sunPosition={[size * 0.9, size * 0.5, size * 0.6]}
        turbidity={5}
        rayleigh={1.2}
      />
      <SceneLights size={size} />
      <CameraSetup size={size} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        minDistance={size * 0.01}
        maxDistance={size * 8}
        maxPolarAngle={underground ? Math.PI : Math.PI * 0.49}
      />

      <group scale={[1, exaggeration, 1]}>
        {terrainMesh && <primitive object={terrainMesh} onClick={handleClick} />}
        {roadGroup && <primitive object={roadGroup} />}
        {buildingGroup && <primitive object={buildingGroup} />}
        {treeGroup && <primitive object={treeGroup} />}
        {geologyGroup && <primitive object={geologyGroup} />}
        {prospectGroup && <primitive object={prospectGroup} />}
        {vehicleLayer && <primitive object={vehicleLayer.group} />}
        {signalLayer && <primitive object={signalLayer.group} />}
        {routeObject && <primitive object={routeObject} />}
        {showWater && <WaterPlane frame={frame} />}
      </group>

      {trafficChildren}

      {measurePoints[0] && (
        <MeasureMarker position={measurePoints[0].world} color="#ef4444" size={size} />
      )}
      {measurePoints[1] && (
        <>
          <MeasureMarker position={measurePoints[1].world} color="#22c55e" size={size} />
          {interaction === 'measure' && (
            <MeasureLine a={measurePoints[0].world} b={measurePoints[1].world} />
          )}
        </>
      )}
    </>
  );
}

/* ================================================================== */
/*  TerrainViewer                                                      */
/* ================================================================== */

export default function TerrainViewer() {
  /* ---- Store ---- */
  const selectedRegion = useMapStore((s) => s.selectedRegion);
  const layers = useMapStore((s) => s.layers);
  const verticalExaggeration = useMapStore((s) => s.verticalExaggeration);
  const underground = useMapStore((s) => s.underground);
  const terrainTexture = useMapStore((s) => s.terrainTexture);
  const trafficConfig = useMapStore((s) => s.trafficConfig);
  const trafficUi = useMapStore((s) => s.trafficUi);
  const set3DActive = useMapStore((s) => s.set3DActive);
  const setVerticalExaggeration = useMapStore((s) => s.setVerticalExaggeration);
  const setTerrainTexture = useMapStore((s) => s.setTerrainTexture);
  const setElevationGrid = useMapStore((s) => s.setElevationGrid);
  const setRegionStats = useMapStore((s) => s.setRegionStats);
  const setGeologyColumn = useMapStore((s) => s.setGeologyColumn);
  const setMaterialBreakdown = useMapStore((s) => s.setMaterialBreakdown);
  const setProspectReport = useMapStore((s) => s.setProspectReport);
  const setVegetation = useMapStore((s) => s.setVegetation);
  const setTrafficLoading = useMapStore((s) => s.setTrafficLoading);
  const setTrafficError = useMapStore((s) => s.setTrafficError);

  /* ---- Data ---- */
  const [grid, setGrid] = useState<ElevationGrid | null>(null);
  const [buildings, setBuildings] = useState<BuildingData[]>([]);
  const [geologyLayers, setGeologyLayers] = useState<GeologyLayerDef[]>([]);
  const [satelliteCanvas, setSatelliteCanvas] = useState<OffscreenCanvas | null>(null);
  const [landUseCanvas, setLandUseCanvas] = useState<OffscreenCanvas | null>(null);
  const [session, setSession] = useState<TrafficSession | null>(null);
  const vegetation = useMapStore((s) => s.vegetation);

  /* ---- Loading / error ---- */
  const [loadingTerrain, setLoadingTerrain] = useState(false);
  const [loadingBuildings, setLoadingBuildings] = useState(false);
  const [loadingGeology, setLoadingGeology] = useState(false);
  const [loadingLandUse, setLoadingLandUse] = useState(false);
  const [loadingRoads, setLoadingRoads] = useState(false);
  const [loadingTrees, setLoadingTrees] = useState(false);
  const [demProgress, setDemProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [clampNote, setClampNote] = useState<string | null>(null);
  const [imageryProgress, setImageryProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* ---- Interaction ---- */
  const [interaction, setInteraction] = useState<InteractionMode>('none');
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [showProfile, setShowProfile] = useState(true);
  const [route, setRoute] = useState<RoutePlan | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const frame = useMemo(
    () => frameFor(grid?.bbox ?? selectedRegion ?? { west: -0.5, east: 0.5, south: -0.5, north: 0.5 }),
    [grid, selectedRegion],
  );

  /* ================================================================ */
  /*  1. Terrain DEM                                                   */
  /* ================================================================ */

  useEffect(() => {
    setGrid(null);
    setSatelliteCanvas(null);
    setLandUseCanvas(null);
    setMeasurePoints([]);
    setRoute(null);
    setSession(null);
    releaseTrafficSession();
    clearFacadeTextureCache();
    clearRoadTextureCache();
    if (!selectedRegion) return;

    const ac = new AbortController();
    setLoadingTerrain(true);
    setError(null);

    (async () => {
      try {
        const zoom = chooseDemZoom(selectedRegion, { maxTiles: DEM_MAX_TILES, maxZoom: DEM_MAX_ZOOM });
        const g = await loadMultiTileDEM(selectedRegion, zoom, {
          signal: ac.signal,
          onProgress: (loaded, total) => {
            if (!ac.signal.aborted) setDemProgress({ loaded, total });
          },
        });
        if (ac.signal.aborted) return;
        setGrid(g);
        setElevationGrid(g);
        const s = gridStats(g, selectedRegion);
        setRegionStats({
          areaKm2: bboxAreaKm2(selectedRegion),
          minElev: s.min,
          maxElev: s.max,
          meanElev: s.mean,
          demResolutionM: g.resolution,
          buildingCount: 0,
          roadLengthKm: 0,
          treeCount: 0,
        });
      } catch (err) {
        if (!ac.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Failed to load terrain');
        }
      } finally {
        if (!ac.signal.aborted) {
          setLoadingTerrain(false);
          setDemProgress(null);
        }
      }
    })();

    return () => ac.abort();
  }, [selectedRegion, setElevationGrid, setRegionStats]);

  /* ================================================================ */
  /*  2. Satellite imagery (aligned to the DEM tiles)                  */
  /* ================================================================ */

  useEffect(() => {
    if (!grid || terrainTexture !== 'satellite' || satelliteCanvas) return;
    const ac = new AbortController();
    setImageryProgress({ loaded: 0, total: 1 });

    loadImageryForGrid(grid, {
      signal: ac.signal,
      onProgress: (loaded, total) => {
        if (loaded % 8 === 0 || loaded === total) setImageryProgress({ loaded, total });
      },
    })
      .then((r) => {
        if (!ac.signal.aborted) setSatelliteCanvas(r.canvas);
      })
      .catch((err) => {
        if (!ac.signal.aborted) console.warn('[TerrainViewer] imagery failed:', err);
      })
      .finally(() => {
        if (!ac.signal.aborted) setImageryProgress(null);
      });

    return () => ac.abort();
  }, [grid, terrainTexture, satelliteCanvas]);

  /* ================================================================ */
  /*  3. OSM land use (rasterized over the DEM bbox)                   */
  /* ================================================================ */

  useEffect(() => {
    if (!grid || terrainTexture !== 'landuse' || landUseCanvas) return;
    let cancelled = false;
    setLoadingLandUse(true);

    fetchLandUse(grid.bbox)
      .then((osm) => {
        if (!cancelled) setLandUseCanvas(rasterizeLandUse(osm, grid.bbox, 2048));
      })
      .catch((err) => {
        if (!cancelled) console.warn('[TerrainViewer] land-use failed:', err);
      })
      .finally(() => {
        if (!cancelled) setLoadingLandUse(false);
      });

    return () => {
      cancelled = true;
    };
  }, [grid, terrainTexture, landUseCanvas]);

  /* ================================================================ */
  /*  4. Buildings                                                     */
  /* ================================================================ */

  useEffect(() => {
    if (!grid || !selectedRegion || !layers.buildings) {
      setBuildings([]);
      return;
    }
    const ac = new AbortController();
    setLoadingBuildings(true);

    const gridArea = (grid.bbox.east - grid.bbox.west) * (grid.bbox.north - grid.bbox.south);
    // The grid is tile-aligned and slightly larger than the selection, so the
    // smaller of the two is the honest extent; either can still be unbounded
    // when the region was drawn by hand, so clamp before asking Overpass.
    const { bbox, clamped } = clampBBoxArea(
      gridArea <= MAX_BUILDING_AREA_DEG2 ? grid.bbox : selectedRegion,
      MAX_AREA_DEG2.buildings,
    );
    setClampNote(
      clamped ? `Large selection — layers cover the central ${clampedAreaKm2(bbox).toFixed(0)} km²` : null,
    );

    fetchBuildings(bbox, ac.signal)
      .then((data) => {
        if (!ac.signal.aborted) setBuildings(data);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        console.warn('[TerrainViewer] building fetch failed:', err);
        setBuildings([]);
        setError(err instanceof Error ? `Buildings: ${err.message}` : 'Buildings failed to load');
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoadingBuildings(false);
      });

    return () => ac.abort();
  }, [grid, selectedRegion, layers.buildings]);

  /* ================================================================ */
  /*  5. Vegetation                                                    */
  /* ================================================================ */

  useEffect(() => {
    if (!grid || !layers.trees) {
      setVegetation(null);
      return;
    }
    const ac = new AbortController();
    setLoadingTrees(true);

    const { bbox } = clampBBoxArea(grid.bbox, MAX_AREA_DEG2.vegetation);

    fetchVegetation(bbox, ac.signal)
      .then((data) => {
        if (!ac.signal.aborted) setVegetation(data);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        console.warn('[TerrainViewer] vegetation fetch failed:', err);
        setVegetation(null);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoadingTrees(false);
      });

    return () => ac.abort();
  }, [grid, layers.trees, setVegetation]);

  /* ================================================================ */
  /*  6. Geology column + prospectivity                                */
  /* ================================================================ */

  useEffect(() => {
    if (!selectedRegion || !layers.geology) {
      setGeologyLayers([]);
      setProspectReport(null);
      return;
    }
    let cancelled = false;
    setLoadingGeology(true);

    const lat = (selectedRegion.south + selectedRegion.north) / 2;
    const lng = (selectedRegion.west + selectedRegion.east) / 2;

    fetchGeologicalColumn(lat, lng)
      .then((column) => {
        if (cancelled) return;
        setGeologyColumn(column);
        setGeologyLayers(column ? columnToLayers(column, 5000) : []);

        if (!column) {
          setProspectReport(null);
          return;
        }
        // Relief drives the water-table estimate, so use the region's own DEM
        // statistics rather than a global assumption.
        const stats = useMapStore.getState().regionStats;
        setProspectReport(
          analyseProspectivity(column, {
            surfaceElevation: stats?.meanElev ?? 0,
            relief: stats ? stats.maxElev - stats.minElev : 0,
          }),
        );
      })
      .catch((err) => {
        console.warn('[TerrainViewer] geology fetch failed:', err);
        if (!cancelled) {
          setGeologyLayers([]);
          setProspectReport(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingGeology(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRegion, layers.geology, setGeologyColumn, setProspectReport]);

  /* ================================================================ */
  /*  6. Road network + simulation                                     */
  /* ================================================================ */

  useEffect(() => {
    if (!grid || !layers.roads) {
      setSession(null);
      return;
    }
    const ac = new AbortController();
    setLoadingRoads(true);
    setTrafficLoading(true);
    setTrafficError(null);

    // The DEM bbox is used verbatim so the graph's local frame shares the
    // scene's origin — `clampRoadBBox` shrinks around the centre, which keeps
    // the two frames aligned even when the region is too big for Overpass.
    ensureTrafficSession(grid.bbox, trafficConfig, ac.signal)
      .then((loaded) => {
        if (ac.signal.aborted) return;
        setSession(loaded);
        if (!loaded) {
          setTrafficError('No drivable road mapped in this region.');
          return;
        }
        useMapStore.setState((s) => ({
          regionStats: s.regionStats
            ? { ...s.regionStats, roadLengthKm: loaded.graph.totalLengthM / 1000 }
            : null,
        }));
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        console.warn('[TerrainViewer] road network failed:', err);
        setSession(null);
        setTrafficError(err instanceof Error ? err.message : 'Road network failed to load');
      })
      .finally(() => {
        if (ac.signal.aborted) return;
        setLoadingRoads(false);
        setTrafficLoading(false);
      });

    return () => ac.abort();
    // `trafficConfig` is applied to the live simulation below, not by refetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, layers.roads, setTrafficLoading, setTrafficError]);

  // Config changes go straight to the running simulation.
  useEffect(() => {
    session?.simulation.setConfig(trafficConfig);
  }, [session, trafficConfig]);

  /* ================================================================ */
  /*  Mesh generation (effect-managed so disposal is deterministic)    */
  /* ================================================================ */

  const textureCanvas =
    terrainTexture === 'satellite'
      ? satelliteCanvas
      : terrainTexture === 'landuse'
        ? landUseCanvas
        : null;

  const [terrainMesh, setTerrainMesh] = useState<THREE.Mesh | null>(null);
  useEffect(() => {
    if (!grid) {
      setTerrainMesh(null);
      return;
    }
    const mesh = generateTerrainMesh(grid, { textureCanvas });
    setTerrainMesh(mesh);
    return () => disposeObject(mesh);
  }, [grid, textureCanvas]);

  const [buildingGroup, setBuildingGroup] = useState<THREE.Group | null>(null);
  useEffect(() => {
    if (!grid || buildings.length === 0) {
      setBuildingGroup(null);
      setMaterialBreakdown(null);
      useMapStore.setState((s) => ({
        regionStats: s.regionStats ? { ...s.regionStats, buildingCount: 0 } : null,
      }));
      return;
    }

    const { group, assignments, rendered } = generateDetailedBuildings(buildings, grid.bbox, {
      elevationAt: (lon, lat) => sampleElevation(grid, lon, lat),
    });

    setBuildingGroup(group);
    setMaterialBreakdown(summariseMaterials(buildings, assignments));
    useMapStore.setState((s) => ({
      regionStats: s.regionStats ? { ...s.regionStats, buildingCount: rendered } : null,
    }));

    return () => disposeObject(group);
  }, [grid, buildings, setMaterialBreakdown]);

  const [treeGroup, setTreeGroup] = useState<THREE.Group | null>(null);
  useEffect(() => {
    if (!grid || !vegetation || vegetation.trees.length === 0 || !layers.trees) {
      setTreeGroup(null);
      useMapStore.setState((s) => ({
        regionStats: s.regionStats ? { ...s.regionStats, treeCount: 0 } : null,
      }));
      return;
    }

    const { group, rendered } = generateTreeLayer(vegetation.trees, grid.bbox, {
      elevationAt: (lon, lat) => sampleElevation(grid, lon, lat),
    });

    setTreeGroup(group);
    useMapStore.setState((s) => ({
      regionStats: s.regionStats ? { ...s.regionStats, treeCount: rendered } : null,
    }));

    return () => disposeObject(group);
  }, [grid, vegetation, layers.trees]);

  const [geologyGroup, setGeologyGroup] = useState<THREE.Group | null>(null);
  useEffect(() => {
    if (!grid || geologyLayers.length === 0) {
      setGeologyGroup(null);
      return;
    }
    const group = generateGeologyLayers(grid, geologyLayers);
    setGeologyGroup(group);
    return () => disposeObject(group);
  }, [grid, geologyLayers]);

  const prospectReport = useMapStore((s) => s.prospectReport);
  const [prospectGroup, setProspectGroup] = useState<THREE.Group | null>(null);
  useEffect(() => {
    if (!grid || !layers.prospect || !prospectReport) {
      setProspectGroup(null);
      return;
    }
    const zones = [...prospectReport.aquifers, ...prospectReport.hydrocarbons];
    if (zones.length === 0) {
      setProspectGroup(null);
      return;
    }
    const group = generateProspectVolumes(grid, zones);
    setProspectGroup(group);
    return () => disposeObject(group);
  }, [grid, layers.prospect, prospectReport]);

  /* ---- Roads ---- */

  const [roadGroup, setRoadGroup] = useState<THREE.Group | null>(null);
  const colorRangesRef = useRef<Map<number, ColorRange>>(new Map());

  useEffect(() => {
    if (!session || !layers.roads) {
      setRoadGroup(null);
      colorRangesRef.current = new Map();
      return;
    }
    const { group, colorRanges } = generateRoadMeshes(
      session.graph,
      grid,
      session.simulation.edgeStats(),
      trafficUi.showCongestion && layers.traffic,
    );
    colorRangesRef.current = colorRanges;
    setRoadGroup(group);
    return () => disposeObject(group);
  }, [session, grid, layers.roads, layers.traffic, trafficUi.showCongestion]);

  /* ---- Vehicles + signals ---- */

  const [vehicleLayer, setVehicleLayer] = useState<VehicleLayer | null>(null);
  useEffect(() => {
    if (!session || !layers.traffic) {
      setVehicleLayer(null);
      return;
    }
    const layer = createVehicleLayer();
    setVehicleLayer(layer);
    return () => layer.dispose();
  }, [session, layers.traffic]);

  const [signalLayer, setSignalLayer] = useState<SignalLayer | null>(null);
  useEffect(() => {
    if (!session || !layers.traffic || !trafficUi.showSignals) {
      setSignalLayer(null);
      return;
    }
    const layer = createSignalLayer(session.graph, grid);
    setSignalLayer(layer);
    return () => layer.dispose();
  }, [session, grid, layers.traffic, trafficUi.showSignals]);

  /* ================================================================ */
  /*  Interaction: measurement and routing                             */
  /* ================================================================ */

  const handleTerrainClick = useCallback((pt: MeasurePoint) => {
    setMeasurePoints((prev) => (prev.length < 2 ? [...prev, pt] : [pt]));
    setShowProfile(true);
  }, []);

  const distance = useMemo(() => {
    if (measurePoints.length < 2) return null;
    const [a, b] = measurePoints;
    return geodesicDistance(a.lat, a.lon, b.lat, b.lon);
  }, [measurePoints]);

  const profilePoints = useMemo<ProfilePoint[]>(() => {
    if (interaction !== 'measure' || measurePoints.length < 2 || !grid) return [];
    const [a, b] = measurePoints;
    const pts: ProfilePoint[] = [];
    for (let i = 0; i <= PROFILE_SAMPLES; i++) {
      const t = i / PROFILE_SAMPLES;
      const lon = a.lon + (b.lon - a.lon) * t;
      const lat = a.lat + (b.lat - a.lat) * t;
      pts.push({ lon, lat, elevation: sampleElevation(grid, lon, lat) ?? 0 });
    }
    return pts;
  }, [interaction, measurePoints, grid]);

  // Two clicks in route mode snap to the nearest junctions and solve A*.
  useEffect(() => {
    if (interaction !== 'route' || measurePoints.length < 2 || !session) {
      if (interaction !== 'route') setRoute(null);
      return;
    }

    const graphFrame = graphFrameFor(session.graph.bbox);
    const [a, b] = measurePoints;
    const [ax, ay] = geoToLocal(graphFrame, a.lon, a.lat);
    const [bx, by] = geoToLocal(graphFrame, b.lon, b.lat);

    const from = nearestNode(session.graph, ax, ay);
    const to = nearestNode(session.graph, bx, by);

    if (from === null || to === null) {
      setRoute(null);
      setRouteError('No road within 400 m of one of those points.');
      return;
    }

    const plan = planRoute(session.graph, from, to, session.simulation.liveSpeedOf);
    setRoute(plan);
    setRouteError(plan ? null : 'No drivable path between those points.');
  }, [interaction, measurePoints, session]);

  const [routeObject, setRouteObject] = useState<THREE.Object3D | null>(null);
  useEffect(() => {
    if (!route || route.edges.length === 0 || !session) {
      setRouteObject(null);
      return;
    }

    const graphFrame = graphFrameFor(session.graph.bbox);
    const points: THREE.Vector3[] = [];

    for (const edgeId of route.edges) {
      const edge = session.graph.edges.get(edgeId);
      if (!edge) continue;
      // Sample along the edge so the ribbon follows curves and the terrain.
      const steps = Math.max(2, Math.ceil(edge.length / 12));
      for (let i = 0; i <= steps; i++) {
        const { x, y } = pointAt(edge, (edge.length * i) / steps);
        const lon = graphFrame.lon + x / (111320 * graphFrame.cosLat);
        const lat = graphFrame.lat + y / 111320;
        const elevation = (grid ? (sampleElevation(grid, lon, lat) ?? 0) : 0) + 1.6;
        points.push(new THREE.Vector3(x * DEG_PER_M, elevation * DEG_PER_M, -y * DEG_PER_M));
      }
    }

    if (points.length < 2) {
      setRouteObject(null);
      return;
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: '#38bdf8', linewidth: 3 });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 20;
    setRouteObject(line);

    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [route, session, grid]);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  const loadingItems: string[] = [];
  if (loadingTerrain) {
    loadingItems.push(
      demProgress && demProgress.total > 1
        ? `terrain ${demProgress.loaded}/${demProgress.total} tiles`
        : 'terrain',
    );
  }
  if (imageryProgress)
    loadingItems.push(
      `imagery ${Math.round((imageryProgress.loaded / Math.max(1, imageryProgress.total)) * 100)}%`,
    );
  if (loadingLandUse) loadingItems.push('land use');
  if (loadingBuildings) loadingItems.push('buildings');
  if (loadingGeology) loadingItems.push('geology');
  if (loadingRoads) loadingItems.push('roads');
  if (loadingTrees) loadingItems.push('trees');

  const textureOptions: { key: TerrainTexture; label: string; Icon: typeof Satellite }[] = [
    { key: 'satellite', label: 'Satellite', Icon: Satellite },
    { key: 'landuse', label: 'Land use', Icon: Trees },
    { key: 'hypsometric', label: 'Elevation', Icon: Mountain },
  ];

  const toggleMode = (mode: InteractionMode) => {
    setInteraction((current) => (current === mode ? 'none' : mode));
    setMeasurePoints([]);
    setRouteError(null);
  };

  return (
    <div className="relative h-full w-full bg-zinc-950">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{
          antialias: true,
          logarithmicDepthBuffer: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
      >
        <Scene
          terrainMesh={terrainMesh}
          buildingGroup={buildingGroup}
          treeGroup={treeGroup}
          geologyGroup={geologyGroup}
          prospectGroup={prospectGroup}
          roadGroup={roadGroup}
          vehicleLayer={vehicleLayer}
          signalLayer={signalLayer}
          routeObject={routeObject}
          trafficChildren={
            session && layers.traffic ? (
              <TrafficTicker
                session={session}
                vehicleLayer={vehicleLayer}
                signalLayer={signalLayer}
                roadGroup={roadGroup}
                colorRanges={colorRangesRef.current}
                grid={grid}
                running={trafficUi.running}
                showCongestion={trafficUi.showCongestion}
              />
            ) : null
          }
          frame={frame}
          exaggeration={verticalExaggeration}
          underground={underground}
          showWater={layers.water}
          interaction={interaction}
          measurePoints={measurePoints}
          onTerrainClick={handleTerrainClick}
        />
      </Canvas>

      {/* ---------- Top-left controls ---------- */}
      <div className="absolute left-3 top-3 flex flex-col gap-2">
        <IconBtn title="Back to 2D map" onClick={() => set3DActive(false)}>
          <X size={16} />
        </IconBtn>
        <IconBtn
          title="Measure distance & elevation profile"
          active={interaction === 'measure'}
          onClick={() => toggleMode('measure')}
        >
          <Ruler size={16} />
        </IconBtn>
        <IconBtn
          title={session ? 'Route between two points on the road network' : 'Enable the Roads layer first'}
          active={interaction === 'route'}
          disabled={!session}
          onClick={() => toggleMode('route')}
        >
          <Navigation size={16} />
        </IconBtn>
      </div>

      {/* ---------- Loading ---------- */}
      {loadingItems.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-900/90 px-4 py-1.5 text-xs font-medium text-zinc-200 shadow-lg backdrop-blur-md">
          <Loader2 size={14} className="animate-spin text-blue-400" />
          Loading {loadingItems.join(' · ')}
        </div>
      )}

      {/* ---------- Right panel ---------- */}
      <div className="absolute right-3 top-3 flex max-h-[calc(100%-1.5rem)] w-60 flex-col gap-3 overflow-y-auto rounded-xl bg-zinc-900/90 p-3 text-zinc-200 shadow-lg backdrop-blur-md">
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Surface
          </div>
          <div className="flex rounded-lg bg-zinc-800 p-0.5">
            {textureOptions.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => setTerrainTexture(key)}
                title={label}
                className={`flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors ${
                  terrainTexture === key
                    ? 'bg-blue-600 text-white'
                    : 'text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                }`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1 text-xs font-medium">
          <span className="flex justify-between">
            Vertical exaggeration
            <span className="tabular-nums text-zinc-100">{verticalExaggeration.toFixed(1)}×</span>
          </span>
          <input
            type="range"
            min={0.5}
            max={10}
            step={0.1}
            value={verticalExaggeration}
            onChange={(e) => setVerticalExaggeration(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer accent-blue-500"
          />
        </label>

        {grid && (
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
            <span>DEM</span>
            <span className="text-right tabular-nums text-zinc-300">
              z{grid.tileRange?.zoom} · {grid.resolution.toFixed(0)} m/px
            </span>
            <span>Mesh</span>
            <span className="text-right tabular-nums text-zinc-300">
              {grid.width}×{grid.height}
            </span>
            {layers.buildings && (
              <>
                <span>Buildings</span>
                <span className="text-right tabular-nums text-zinc-300">
                  {buildings.length.toLocaleString()}
                </span>
              </>
            )}
            {layers.roads && session && (
              <>
                <span>Roads</span>
                <span className="text-right tabular-nums text-zinc-300">
                  {(session.graph.totalLengthM / 1000).toFixed(1)} km
                </span>
              </>
            )}
            {layers.trees && vegetation && (
              <>
                <span>Trees</span>
                <span className="text-right tabular-nums text-zinc-300">
                  {vegetation.trees.length.toLocaleString()}
                </span>
              </>
            )}
            {layers.geology && (
              <>
                <span>Geology</span>
                <span className="text-right tabular-nums text-zinc-300">
                  {geologyLayers.length} units
                </span>
              </>
            )}
          </div>
        )}

        <TrafficPanel compact />
      </div>

      {/* ---------- Interaction banner ---------- */}
      {interaction === 'measure' && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 select-none rounded-full bg-yellow-500/90 px-4 py-1.5 text-sm font-medium text-white shadow-lg backdrop-blur-md">
          {measurePoints.length === 0 && 'Click terrain to place first point'}
          {measurePoints.length === 1 && 'Click terrain to place second point'}
          {measurePoints.length === 2 && distance != null && (
            <>
              Distance: <b>{fmtDist(distance)}</b> · ΔElev:{' '}
              <b>{(measurePoints[1].elevation - measurePoints[0].elevation).toFixed(0)} m</b>
            </>
          )}
        </div>
      )}

      {interaction === 'route' && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 flex -translate-x-1/2 select-none items-center gap-2 rounded-full bg-sky-600/90 px-4 py-1.5 text-sm font-medium text-white shadow-lg backdrop-blur-md">
          <Car size={14} />
          {measurePoints.length === 0 && 'Click the map to set the route origin'}
          {measurePoints.length === 1 && 'Click again to set the destination'}
          {measurePoints.length === 2 && routeError && <span>{routeError}</span>}
          {measurePoints.length === 2 && route && (
            <>
              <b>{formatDistance(route.distance)}</b> · free flow{' '}
              <b>{formatDuration(route.duration)}</b> · with traffic{' '}
              <b>{formatDuration(route.liveDuration)}</b> ·{' '}
              {kmh(route.distance / Math.max(1, route.liveDuration))}
            </>
          )}
        </div>
      )}

      {/* ---------- Clamped selection ---------- */}
      {clampNote && !error && loadingItems.length === 0 && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-amber-600/90 px-4 py-1.5 text-xs font-medium text-white shadow-lg">
          {clampNote}
        </div>
      )}

      {/* ---------- Error ---------- */}
      {error && (
        <div className="absolute left-1/2 top-12 -translate-x-1/2 rounded-lg bg-red-600/90 px-4 py-2 text-sm text-white shadow-lg">
          {error}
        </div>
      )}

      {/* ---------- Elevation profile ---------- */}
      {showProfile && profilePoints.length > 1 && (
        <div className="absolute bottom-0 left-0 right-0 rounded-t-xl bg-zinc-900/95 shadow-2xl backdrop-blur-md">
          <button
            onClick={() => setShowProfile(false)}
            title="Close profile"
            className="absolute right-2 top-2 z-10 cursor-pointer rounded p-1 text-zinc-400 hover:bg-zinc-700"
          >
            <X size={14} />
          </button>
          <ElevationProfile points={profilePoints} />
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Small UI bits                                                      */
/* ================================================================== */

function IconBtn({
  children,
  title,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`flex h-9 w-9 items-center justify-center rounded-lg shadow-lg backdrop-blur-md transition-colors ${
        disabled
          ? 'cursor-not-allowed bg-zinc-900/60 text-zinc-600'
          : active
            ? 'cursor-pointer bg-yellow-500 text-white'
            : 'cursor-pointer bg-zinc-900/90 text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}
