'use client';

/**
 * TerrainViewer — analytical 3D twin built from open data.
 *
 *   - AWS Terrarium DEM stitched at the highest zoom that fits a tile budget
 *   - Esri World Imagery draped as a 4096² texture aligned to the DEM tiles
 *     (or OSM land-use rasterization, or hypsometric tint)
 *   - OSM building footprints extruded, merged into one mesh, seated on terrain
 *   - Macrostrat geology stack below the surface
 *   - Measurement + elevation profile
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
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
  generateBuildingMeshes,
  disposeObject,
  DEG_PER_M,
} from '@/lib/terrain/meshGenerator';
import { fetchBuildings } from '@/lib/buildings/osmFetcher';
import { fetchGeologicalColumn, columnToLayers } from '@/lib/geology/macrostratApi';
import { geodesicDistance } from '@/lib/analysis/coordTransform';
import ElevationProfile, { type ProfilePoint } from '@/components/analysis/ElevationProfile';
import type { ElevationGrid, BBox, TerrainTexture } from '@/types/geo';
import type { BuildingData } from '@/types/buildings';
import type { GeologyLayerDef } from '@/types/geology';
import { Ruler, X, Loader2, Satellite, Trees, Mountain } from 'lucide-react';

/* ================================================================== */
/*  Constants                                                          */
/* ================================================================== */

const PROFILE_SAMPLES = 120;
/** Above this grid extent (deg²) buildings are fetched for the selection only. */
const MAX_BUILDING_AREA_DEG2 = 0.02;
const DEM_MAX_TILES = 16;
const DEM_MAX_ZOOM = 14;

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
      <hemisphereLight args={['#cfe3ff', '#4f4538', 0.55]} />
      <directionalLight
        position={[size * 0.9, size * 1.3, size * 0.6]}
        intensity={1.7}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-size * 0.8}
        shadow-camera-right={size * 0.8}
        shadow-camera-top={size * 0.8}
        shadow-camera-bottom={-size * 0.8}
        shadow-camera-near={size * 0.05}
        shadow-camera-far={size * 5}
        shadow-normalBias={size * 0.0015}
      />
    </>
  );
}

function WaterPlane({ frame }: { frame: Frame }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.4 * DEG_PER_M, 0]} receiveShadow>
      <planeGeometry args={[frame.width, frame.height]} />
      <meshStandardMaterial
        color="#1f6f9f"
        transparent
        opacity={0.6}
        roughness={0.15}
        metalness={0.1}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function MeasureMarker({ position, color, size }: { position: THREE.Vector3; color: string; size: number }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[size * 0.006, 16, 16]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  );
}

function MeasureLine({ a, b }: { a: THREE.Vector3; b: THREE.Vector3 }) {
  const geo = useMemo(() => new THREE.BufferGeometry().setFromPoints([a, b]), [a, b]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#facc15" depthTest={false} />
    </lineSegments>
  );
}

interface SceneProps {
  terrainMesh: THREE.Mesh | null;
  buildingGroup: THREE.Group | null;
  geologyGroup: THREE.Group | null;
  frame: Frame;
  exaggeration: number;
  underground: boolean;
  showWater: boolean;
  measureMode: boolean;
  measurePoints: MeasurePoint[];
  onTerrainClick: (pt: MeasurePoint) => void;
}

function Scene({
  terrainMesh,
  buildingGroup,
  geologyGroup,
  frame,
  exaggeration,
  underground,
  showWater,
  measureMode,
  measurePoints,
  onTerrainClick,
}: SceneProps) {
  const size = Math.max(frame.width, frame.height);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!measureMode) return;
      e.stopPropagation();
      const geo = worldToGeo(e.point, frame, exaggeration);
      onTerrainClick({ world: e.point.clone(), ...geo });
    },
    [measureMode, frame, exaggeration, onTerrainClick],
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
        {buildingGroup && <primitive object={buildingGroup} />}
        {geologyGroup && <primitive object={geologyGroup} />}
        {showWater && <WaterPlane frame={frame} />}
      </group>

      {measurePoints[0] && (
        <MeasureMarker position={measurePoints[0].world} color="#ef4444" size={size} />
      )}
      {measurePoints[1] && (
        <>
          <MeasureMarker position={measurePoints[1].world} color="#22c55e" size={size} />
          <MeasureLine a={measurePoints[0].world} b={measurePoints[1].world} />
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
  const set3DActive = useMapStore((s) => s.set3DActive);
  const setVerticalExaggeration = useMapStore((s) => s.setVerticalExaggeration);
  const setTerrainTexture = useMapStore((s) => s.setTerrainTexture);
  const setElevationGrid = useMapStore((s) => s.setElevationGrid);
  const setRegionStats = useMapStore((s) => s.setRegionStats);
  const setGeologyColumn = useMapStore((s) => s.setGeologyColumn);

  /* ---- Data ---- */
  const [grid, setGrid] = useState<ElevationGrid | null>(null);
  const [buildings, setBuildings] = useState<BuildingData[]>([]);
  const [geologyLayers, setGeologyLayers] = useState<GeologyLayerDef[]>([]);
  const [satelliteCanvas, setSatelliteCanvas] = useState<OffscreenCanvas | null>(null);
  const [landUseCanvas, setLandUseCanvas] = useState<OffscreenCanvas | null>(null);

  /* ---- Loading / error ---- */
  const [loadingTerrain, setLoadingTerrain] = useState(false);
  const [loadingBuildings, setLoadingBuildings] = useState(false);
  const [loadingGeology, setLoadingGeology] = useState(false);
  const [loadingLandUse, setLoadingLandUse] = useState(false);
  const [imageryProgress, setImageryProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* ---- Measurement ---- */
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [showProfile, setShowProfile] = useState(true);

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
    if (!selectedRegion) return;

    const ac = new AbortController();
    setLoadingTerrain(true);
    setError(null);

    (async () => {
      try {
        const zoom = chooseDemZoom(selectedRegion, { maxTiles: DEM_MAX_TILES, maxZoom: DEM_MAX_ZOOM });
        const g = await loadMultiTileDEM(selectedRegion, zoom, { signal: ac.signal });
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
        });
      } catch (err) {
        if (!ac.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Failed to load terrain');
        }
      } finally {
        if (!ac.signal.aborted) setLoadingTerrain(false);
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
    let cancelled = false;
    setLoadingBuildings(true);

    const gridArea = (grid.bbox.east - grid.bbox.west) * (grid.bbox.north - grid.bbox.south);
    const bbox = gridArea <= MAX_BUILDING_AREA_DEG2 ? grid.bbox : selectedRegion;

    fetchBuildings(bbox)
      .then((data) => {
        if (!cancelled) setBuildings(data);
      })
      .catch((err) => {
        console.warn('[TerrainViewer] building fetch failed:', err);
        if (!cancelled) setBuildings([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingBuildings(false);
      });

    return () => {
      cancelled = true;
    };
  }, [grid, selectedRegion, layers.buildings]);

  // Keep the sidebar's building count in sync.
  useEffect(() => {
    useMapStore.setState((s) => ({
      regionStats: s.regionStats ? { ...s.regionStats, buildingCount: buildings.length } : null,
    }));
  }, [buildings]);

  /* ================================================================ */
  /*  5. Geology column                                                */
  /* ================================================================ */

  useEffect(() => {
    if (!selectedRegion || !layers.geology) {
      setGeologyLayers([]);
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
      })
      .catch((err) => {
        console.warn('[TerrainViewer] geology fetch failed:', err);
        if (!cancelled) setGeologyLayers([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingGeology(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRegion, layers.geology, setGeologyColumn]);

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
      return;
    }
    const group = generateBuildingMeshes(buildings, grid.bbox, {
      elevationAt: (lon, lat) => sampleElevation(grid, lon, lat),
    });
    setBuildingGroup(group);
    return () => disposeObject(group);
  }, [grid, buildings]);

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

  /* ================================================================ */
  /*  Measurement                                                      */
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
    if (measurePoints.length < 2 || !grid) return [];
    const [a, b] = measurePoints;
    const pts: ProfilePoint[] = [];
    for (let i = 0; i <= PROFILE_SAMPLES; i++) {
      const t = i / PROFILE_SAMPLES;
      const lon = a.lon + (b.lon - a.lon) * t;
      const lat = a.lat + (b.lat - a.lat) * t;
      pts.push({ lon, lat, elevation: sampleElevation(grid, lon, lat) ?? 0 });
    }
    return pts;
  }, [measurePoints, grid]);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  const loadingItems: string[] = [];
  if (loadingTerrain) loadingItems.push('terrain');
  if (imageryProgress)
    loadingItems.push(
      `imagery ${Math.round((imageryProgress.loaded / Math.max(1, imageryProgress.total)) * 100)}%`,
    );
  if (loadingLandUse) loadingItems.push('land use');
  if (loadingBuildings) loadingItems.push('buildings');
  if (loadingGeology) loadingItems.push('geology');

  const textureOptions: { key: TerrainTexture; label: string; Icon: typeof Satellite }[] = [
    { key: 'satellite', label: 'Satellite', Icon: Satellite },
    { key: 'landuse', label: 'Land use', Icon: Trees },
    { key: 'hypsometric', label: 'Elevation', Icon: Mountain },
  ];

  return (
    <div className="relative h-full w-full bg-zinc-950">
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
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
          geologyGroup={geologyGroup}
          frame={frame}
          exaggeration={verticalExaggeration}
          underground={underground}
          showWater={layers.water}
          measureMode={measureMode}
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
          active={measureMode}
          onClick={() => {
            setMeasureMode((m) => !m);
            if (measureMode) setMeasurePoints([]);
          }}
        >
          <Ruler size={16} />
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
      <div className="absolute right-3 top-3 flex w-56 flex-col gap-3 rounded-xl bg-zinc-900/90 p-3 text-zinc-200 shadow-lg backdrop-blur-md">
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
      </div>

      {/* ---------- Measurement banner ---------- */}
      {measureMode && (
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
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg shadow-lg backdrop-blur-md transition-colors ${
        active
          ? 'bg-yellow-500 text-white'
          : 'bg-zinc-900/90 text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}
