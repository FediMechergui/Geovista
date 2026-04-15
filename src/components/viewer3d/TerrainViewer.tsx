'use client';

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { Canvas, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Sky, Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useMapStore } from '@/store/mapStore';
import { loadMultiTileDEM } from "@/lib/terrain/demLoader";
import {
  generateTerrainMesh,
  generateGeologyLayers,
  generateBuildingMeshes,
} from "@/lib/terrain/meshGenerator";
import { fetchBuildingsOverture } from "@/lib/buildings/overtureFetcher";
import {
  fetchGeologicalColumn,
  columnToLayers,
} from "@/lib/geology/macrostratApi";
import { geodesicDistance } from "@/lib/analysis/coordTransform";
import {
  fetchLandUse,
  rasterizeLandUse,
} from "@/lib/terrain/landUseRasterizer";
import type { ElevationGrid, BBox } from "@/types/geo";
import type { BuildingData } from "@/types/buildings";
import type { GeologyLayerDef } from "@/types/geology";
import { Ruler, X, ChevronUp, Loader2 } from "lucide-react";

/* ================================================================== */
/*  Constants                                                          */
/* ================================================================== */

const DEG_PER_M = 1 / 111320;
const PROFILE_SAMPLES = 80;

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

/** Choose a zoom level so a single tile roughly covers the bbox. */
function bboxToZoom(bbox: BBox): number {
  const span = Math.max(bbox.east - bbox.west, bbox.north - bbox.south);
  return Math.min(14, Math.max(2, Math.round(Math.log2(360 / span))));
}

/** Bilinear interpolation of elevation at a lon/lat inside the grid's bbox. */
function sampleElevation(
  grid: ElevationGrid,
  lon: number,
  lat: number,
): number | null {
  const { width, height, data, bbox, noDataValue } = grid;
  const px = ((lon - bbox.west) / (bbox.east - bbox.west)) * (width - 1);
  const py = ((bbox.north - lat) / (bbox.north - bbox.south)) * (height - 1);
  if (px < 0 || px > width - 1 || py < 0 || py > height - 1) return null;

  const x0 = Math.floor(px);
  const x1 = Math.min(x0 + 1, width - 1);
  const y0 = Math.floor(py);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = px - x0;
  const fy = py - y0;

  const v00 = data[y0 * width + x0];
  const v10 = data[y0 * width + x1];
  const v01 = data[y1 * width + x0];
  const v11 = data[y1 * width + x1];
  if (
    v00 === noDataValue ||
    v10 === noDataValue ||
    v01 === noDataValue ||
    v11 === noDataValue
  )
    return null;
  return (
    v00 * (1 - fx) * (1 - fy) +
    v10 * fx * (1 - fy) +
    v01 * (1 - fx) * fy +
    v11 * fx * fy
  );
}

/** Convert a world-space point back to geographic coords. */
function worldToGeo(
  pt: THREE.Vector3,
  bboxCenter: { lon: number; lat: number },
  exaggeration: number,
): { lon: number; lat: number; elevation: number } {
  return {
    lon: bboxCenter.lon + pt.x,
    lat: bboxCenter.lat - pt.z,
    elevation: pt.y / (DEG_PER_M * exaggeration),
  };
}

/** Format distance for display. */
function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
}

/* ================================================================== */
/*  Measurement state type                                             */
/* ================================================================== */

interface MeasurePoint {
  world: THREE.Vector3;
  lon: number;
  lat: number;
  elevation: number;
}

/* ================================================================== */
/*  R3F inner-scene components                                         */
/* ================================================================== */

/** Directional + ambient lighting with shadow support. */
function SceneLights({ size }: { size: number }) {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[size, size * 2, size]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-size}
        shadow-camera-right={size}
        shadow-camera-top={size}
        shadow-camera-bottom={-size}
        shadow-camera-near={0.01}
        shadow-camera-far={size * 5}
      />
    </>
  );
}

/** Semi-transparent blue plane at sea level. */
function WaterPlane({ size }: { size: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[size * 1.4, size * 1.4]} />
      <meshPhongMaterial
        color="#2288cc"
        transparent
        opacity={0.45}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** Sphere marker at a measurement point. */
function MeasureMarker({
  position,
  color,
}: {
  position: THREE.Vector3;
  color: string;
}) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.003, 16, 16]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

/** Line between two measurement points. */
function MeasureLine({ a, b }: { a: THREE.Vector3; b: THREE.Vector3 }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    return g;
  }, [a, b]);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#facc15" linewidth={2} />
    </lineSegments>
  );
}

/** Sets the camera position to nicely frame the scene on first render. */
function CameraSetup({ size }: { size: number }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(size * 0.6, size * 0.4, size * 0.6);
    camera.lookAt(0, 0, 0);
  }, [camera, size]);
  return null;
}

/* ================================================================== */
/*  Main inner scene — receives all data via props                     */
/* ================================================================== */

interface SceneProps {
  terrainMesh: THREE.Mesh | null;
  buildingGroup: THREE.Group | null;
  geologyGroup: THREE.Group | null;
  exaggeration: number;
  underground: boolean;
  bboxSize: number;
  bboxCenter: { lon: number; lat: number };
  measureMode: boolean;
  measurePoints: MeasurePoint[];
  onTerrainClick: (pt: MeasurePoint) => void;
  grid: ElevationGrid | null;
}

function Scene({
  terrainMesh,
  buildingGroup,
  geologyGroup,
  exaggeration,
  underground,
  bboxSize,
  bboxCenter,
  measureMode,
  measurePoints,
  onTerrainClick,
}: SceneProps) {
  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!measureMode) return;
      e.stopPropagation();
      const pt = e.point;
      const geo = worldToGeo(pt, bboxCenter, exaggeration);
      onTerrainClick({
        world: pt.clone(),
        lon: geo.lon,
        lat: geo.lat,
        elevation: geo.elevation,
      });
    },
    [measureMode, bboxCenter, exaggeration, onTerrainClick],
  );

  return (
    <>
      <Sky sunPosition={[100, 80, 50]} />
      <SceneLights size={bboxSize} />
      <CameraSetup size={bboxSize} />

      <OrbitControls
        enableDamping
        dampingFactor={0.12}
        minDistance={bboxSize * 0.05}
        maxDistance={bboxSize * 5}
        maxPolarAngle={underground ? Math.PI : Math.PI * 0.48}
        minPolarAngle={0}
      />

      {/* Terrain, buildings, geology — all inside a single group scaled by exaggeration along Y */}
      <group scale={[1, exaggeration, 1]}>
        {terrainMesh && (
          <primitive object={terrainMesh} onClick={handleClick} />
        )}
        {buildingGroup && <primitive object={buildingGroup} />}
        {geologyGroup && <primitive object={geologyGroup} />}
        <WaterPlane size={bboxSize} />
      </group>

      {/* Measurement markers (outside scaled group so radius stays constant) */}
      {measurePoints[0] && (
        <MeasureMarker position={measurePoints[0].world} color="#ef4444" />
      )}
      {measurePoints[1] && (
        <>
          <MeasureMarker position={measurePoints[1].world} color="#22c55e" />
          <MeasureLine a={measurePoints[0].world} b={measurePoints[1].world} />
        </>
      )}
    </>
  );
}

/* ================================================================== */
/*  Loading indicator (drei <Html> inside Canvas won't work outside)    */
/* ================================================================== */

function LoadingHtml({ message }: { message: string }) {
  return (
    <Html center>
      <div className="flex items-center gap-2 rounded-lg bg-black/80 px-4 py-2 text-sm text-white shadow-lg backdrop-blur-md">
        <Loader2 size={16} className="animate-spin" />
        {message}
      </div>
    </Html>
  );
}

/* ================================================================== */
/*  Elevation profile panel (Recharts)                                 */
/* ================================================================== */

interface ProfilePoint {
  distance: number;
  elevation: number;
}

function ElevationProfile({
  data,
  onClose,
}: {
  data: ProfilePoint[];
  onClose: () => void;
}) {
  const minElev = Math.min(...data.map((d) => d.elevation));
  const maxElev = Math.max(...data.map((d) => d.elevation));
  const avgElev = data.reduce((s, d) => s + d.elevation, 0) / data.length;

  return (
    <div className="absolute bottom-0 left-0 right-0 rounded-t-xl bg-white/95 p-4 shadow-2xl backdrop-blur-md dark:bg-zinc-900/95">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          <span>
            Min:{" "}
            <b className="text-zinc-800 dark:text-zinc-200">
              {minElev.toFixed(0)} m
            </b>
          </span>
          <span>
            Max:{" "}
            <b className="text-zinc-800 dark:text-zinc-200">
              {maxElev.toFixed(0)} m
            </b>
          </span>
          <span>
            Avg:{" "}
            <b className="text-zinc-800 dark:text-zinc-200">
              {avgElev.toFixed(0)} m
            </b>
          </span>
        </div>
        <button
          onClick={onClose}
          title="Close profile"
          className="cursor-pointer rounded p-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
        >
          <X size={14} />
        </button>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart
          data={data}
          margin={{ top: 4, right: 4, bottom: 0, left: -10 }}
        >
          <defs>
            <linearGradient id="elGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.5} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
          <XAxis
            dataKey="distance"
            tickFormatter={(v: number) => fmtDist(v)}
            tick={{ fontSize: 10 }}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => `${v.toFixed(0)} m`}
            domain={[
              Math.floor(minElev / 10) * 10,
              Math.ceil(maxElev / 10) * 10,
            ]}
          />
          <Tooltip
            formatter={(v) => [`${Number(v).toFixed(1)} m`, "Elevation"]}
            labelFormatter={(v) => `Distance: ${fmtDist(Number(v))}`}
          />
          <Area
            type="monotone"
            dataKey="elevation"
            stroke="#16a34a"
            fill="url(#elGrad)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ================================================================== */
/*  TerrainViewer — main export                                        */
/* ================================================================== */

export default function TerrainViewer() {
  /* ---- Store ---- */
  const selectedRegion = useMapStore((s) => s.selectedRegion);
  const layers = useMapStore((s) => s.layers);
  const verticalExaggeration = useMapStore((s) => s.verticalExaggeration);
  const underground = useMapStore((s) => s.underground);
  const set3DActive = useMapStore((s) => s.set3DActive);
  const setVerticalExaggeration = useMapStore((s) => s.setVerticalExaggeration);
  const setUnderground = useMapStore((s) => s.setUnderground);

  /* ---- Raw data state ---- */
  const [grid, setGrid] = useState<ElevationGrid | null>(null);
  const [buildings, setBuildings] = useState<BuildingData[]>([]);
  const [geologyLayers, setGeologyLayers] = useState<GeologyLayerDef[]>([]);
  const [landUseCanvas, setLandUseCanvas] = useState<OffscreenCanvas | null>(
    null,
  );

  /* ---- Loading / error ---- */
  const [loadingTerrain, setLoadingTerrain] = useState(false);
  const [loadingBuildings, setLoadingBuildings] = useState(false);
  const [loadingGeology, setLoadingGeology] = useState(false);
  const [loadingLandUse, setLoadingLandUse] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---- Measurement ---- */
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [showProfile, setShowProfile] = useState(false);

  /* ---- Tile bbox (actual geographic extent of the loaded tile) ---- */
  const [tileBBox, setTileBBox] = useState<BBox | null>(null);

  /* ---- Derived geometry ---- */
  const bboxCenter = useMemo(() => {
    const b = tileBBox ?? selectedRegion;
    if (!b) return { lon: 0, lat: 0 };
    return { lon: (b.west + b.east) / 2, lat: (b.south + b.north) / 2 };
  }, [tileBBox, selectedRegion]);

  const bboxSize = useMemo(() => {
    const b = tileBBox ?? selectedRegion;
    if (!b) return 1;
    return Math.max(b.east - b.west, b.north - b.south);
  }, [tileBBox, selectedRegion]);

  /* ================================================================ */
  /*  Data fetching                                                    */
  /* ================================================================ */

  /** Fetch terrain DEM for the selected region (multi-tile). */
  useEffect(() => {
    if (!selectedRegion) return;
    let cancelled = false;

    (async () => {
      setLoadingTerrain(true);
      setError(null);
      try {
        // Pick a zoom level that gives good detail: base zoom + 2,
        // capped at 12 (beyond that creates too many tile requests).
        const baseZ = bboxToZoom(selectedRegion);
        const z = Math.min(baseZ + 2, 12);

        const elevGrid = await loadMultiTileDEM(selectedRegion, z, true);
        if (!cancelled) {
          setGrid(elevGrid);
          setTileBBox(elevGrid.bbox);
        }
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Failed to load terrain",
          );
      } finally {
        if (!cancelled) setLoadingTerrain(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedRegion]);

  /** Fetch buildings (Overture Maps → OSM fallback). */
  useEffect(() => {
    if (!selectedRegion || !layers.buildings) {
      setBuildings([]);
      return;
    }
    let cancelled = false;

    (async () => {
      setLoadingBuildings(true);
      try {
        const data = await fetchBuildingsOverture(selectedRegion);
        if (!cancelled) setBuildings(data);
      } catch (err) {
        console.warn("[TerrainViewer] building fetch failed:", err);
        if (!cancelled) setBuildings([]);
      } finally {
        if (!cancelled) setLoadingBuildings(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedRegion, layers.buildings]);

  /** Fetch geology column. */
  useEffect(() => {
    if (!selectedRegion || !layers.geology) {
      setGeologyLayers([]);
      return;
    }
    let cancelled = false;

    (async () => {
      setLoadingGeology(true);
      try {
        const lat = (selectedRegion.south + selectedRegion.north) / 2;
        const lng = (selectedRegion.west + selectedRegion.east) / 2;
        const column = await fetchGeologicalColumn(lat, lng);
        if (!cancelled) {
          setGeologyLayers(column ? columnToLayers(column, 5000) : []);
        }
      } catch (err) {
        console.warn("[TerrainViewer] geology fetch failed:", err);
        if (!cancelled) setGeologyLayers([]);
      } finally {
        if (!cancelled) setLoadingGeology(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedRegion, layers.geology]);

  /** Fetch OSM land-use / land-cover and rasterize to canvas texture. */
  useEffect(() => {
    if (!selectedRegion) {
      setLandUseCanvas(null);
      return;
    }
    let cancelled = false;

    (async () => {
      setLoadingLandUse(true);
      try {
        const osm = await fetchLandUse(selectedRegion);
        if (!cancelled) {
          const canvas = rasterizeLandUse(osm, selectedRegion, 1024);
          setLandUseCanvas(canvas);
        }
      } catch (err) {
        console.warn("[TerrainViewer] land-use fetch failed:", err);
        if (!cancelled) setLandUseCanvas(null);
      } finally {
        if (!cancelled) setLoadingLandUse(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedRegion]);

  /* ================================================================ */
  /*  Mesh generation (synchronous from fetched data)                  */
  /* ================================================================ */

  const terrainMeshRef = useRef<THREE.Mesh | null>(null);
  const buildingGroupRef = useRef<THREE.Group | null>(null);
  const geologyGroupRef = useRef<THREE.Group | null>(null);

  // Terrain mesh: generate with exaggeration = 1 (parent group applies scale)
  // When land-use canvas is available, drape it as a texture for realistic biome colors.
  const terrainMesh = useMemo(() => {
    if (!grid) return null;
    // Dispose previous
    if (terrainMeshRef.current) {
      terrainMeshRef.current.geometry.dispose();
      (terrainMeshRef.current.material as THREE.Material).dispose();
    }
    const mesh = generateTerrainMesh(
      grid,
      1,
      undefined,
      landUseCanvas ?? undefined,
    );
    terrainMeshRef.current = mesh;
    return mesh;
  }, [grid, landUseCanvas]);

  // Buildings
  const buildingGroup = useMemo(() => {
    if (!grid || buildings.length === 0) return null;
    if (buildingGroupRef.current) {
      buildingGroupRef.current.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
        }
      });
    }
    // Average ground elevation for building placement
    let sum = 0;
    let count = 0;
    for (let i = 0; i < grid.data.length; i++) {
      if (grid.data[i] !== grid.noDataValue) {
        sum += grid.data[i];
        count++;
      }
    }
    const avgElev = count ? sum / count : 0;
    const group = generateBuildingMeshes(buildings, grid.bbox, avgElev);
    buildingGroupRef.current = group;
    return group;
  }, [grid, buildings]);

  // Geology layers
  const geologyGroup = useMemo(() => {
    if (!grid || geologyLayers.length === 0) return null;
    if (geologyGroupRef.current) {
      geologyGroupRef.current.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
          (c.material as THREE.Material).dispose();
        }
      });
    }
    const group = generateGeologyLayers(grid, geologyLayers, 1);
    geologyGroupRef.current = group;
    return group;
  }, [grid, geologyLayers]);

  /* ================================================================ */
  /*  Measurement logic                                                */
  /* ================================================================ */

  const handleTerrainClick = useCallback((pt: MeasurePoint) => {
    setMeasurePoints((prev) => {
      if (prev.length < 2) return [...prev, pt];
      // Reset — start new measurement
      return [pt];
    });
  }, []);

  // Auto-show profile when two points exist
  useEffect(() => {
    if (measurePoints.length === 2) setShowProfile(true);
    else setShowProfile(false);
  }, [measurePoints]);

  const distance = useMemo(() => {
    if (measurePoints.length < 2) return null;
    const [a, b] = measurePoints;
    return geodesicDistance(a.lat, a.lon, b.lat, b.lon);
  }, [measurePoints]);

  // Elevation profile between two points
  const profileData = useMemo<ProfilePoint[]>(() => {
    if (measurePoints.length < 2 || !grid) return [];
    const [a, b] = measurePoints;
    const totalDist = geodesicDistance(a.lat, a.lon, b.lat, b.lon);
    const pts: ProfilePoint[] = [];
    for (let i = 0; i <= PROFILE_SAMPLES; i++) {
      const t = i / PROFILE_SAMPLES;
      const lon = a.lon + (b.lon - a.lon) * t;
      const lat = a.lat + (b.lat - a.lat) * t;
      const elev = sampleElevation(grid, lon, lat);
      pts.push({ distance: totalDist * t, elevation: elev ?? 0 });
    }
    return pts;
  }, [measurePoints, grid]);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  const isLoading =
    loadingTerrain || loadingBuildings || loadingGeology || loadingLandUse;
  const loadingMsg = loadingTerrain
    ? "Loading terrain…"
    : loadingBuildings
      ? "Loading buildings…"
      : "Loading geology…";

  return (
    <div className="relative h-full w-full bg-zinc-950">
      {/* ---------- Three.js Canvas ---------- */}
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        camera={{ fov: 55, near: 0.00001, far: 100 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      >
        {isLoading && <LoadingHtml message={loadingMsg} />}

        <Scene
          terrainMesh={terrainMesh}
          buildingGroup={buildingGroup}
          geologyGroup={geologyGroup}
          exaggeration={verticalExaggeration}
          underground={underground}
          bboxSize={bboxSize}
          bboxCenter={bboxCenter}
          measureMode={measureMode}
          measurePoints={measurePoints}
          onTerrainClick={handleTerrainClick}
          grid={grid}
        />
      </Canvas>

      {/* ---------- Top controls ---------- */}
      <div className="absolute left-3 top-3 flex flex-col gap-2">
        {/* Close button */}
        <button
          onClick={() => set3DActive(false)}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-white/90 text-zinc-600 shadow-lg backdrop-blur-md transition-colors hover:bg-zinc-100 dark:bg-zinc-800/90 dark:text-zinc-300 dark:hover:bg-zinc-700"
          title="Back to 2D map"
        >
          <X size={16} />
        </button>

        {/* Measure toggle */}
        <button
          onClick={() => {
            setMeasureMode((m) => !m);
            if (measureMode) {
              setMeasurePoints([]);
              setShowProfile(false);
            }
          }}
          className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg shadow-lg backdrop-blur-md transition-colors ${
            measureMode
              ? "bg-yellow-500 text-white"
              : "bg-white/90 text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-800/90 dark:text-zinc-300 dark:hover:bg-zinc-700"
          }`}
          title="Measure distance"
        >
          <Ruler size={16} />
        </button>
      </div>

      {/* ---------- Right panel: sliders / toggles ---------- */}
      <div className="absolute right-3 top-3 flex w-52 flex-col gap-3 rounded-xl bg-white/90 p-3 shadow-lg backdrop-blur-md dark:bg-zinc-800/90">
        {/* Vertical exaggeration */}
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
          <span className="flex justify-between">
            Vertical Exaggeration
            <span className="tabular-nums text-zinc-800 dark:text-zinc-100">
              {verticalExaggeration.toFixed(1)}×
            </span>
          </span>
          <input
            type="range"
            min={0.5}
            max={10}
            step={0.1}
            value={verticalExaggeration}
            onChange={(e) => setVerticalExaggeration(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer accent-blue-600"
          />
        </label>

        {/* Underground toggle */}
        <label className="flex items-center justify-between text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Underground Camera
          <input
            type="checkbox"
            checked={underground}
            onChange={(e) => setUnderground(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-blue-600"
          />
        </label>

        {/* Layer badges */}
        <div className="flex flex-wrap gap-1">
          {layers.terrain && <Badge label="Terrain" color="bg-green-600" />}
          {layers.buildings && (
            <Badge
              label="Buildings"
              color="bg-zinc-500"
              loading={loadingBuildings}
            />
          )}
          {layers.geology && (
            <Badge
              label="Geology"
              color="bg-amber-600"
              loading={loadingGeology}
            />
          )}
          {layers.bathymetry && (
            <Badge label="Bathymetry" color="bg-blue-600" />
          )}
        </div>
      </div>

      {/* ---------- Measurement info ---------- */}
      {measureMode && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 select-none rounded-full bg-yellow-500/90 px-4 py-1.5 text-sm font-medium text-white shadow-lg backdrop-blur-md">
          {measurePoints.length === 0 && "Click terrain to place first point"}
          {measurePoints.length === 1 && "Click terrain to place second point"}
          {measurePoints.length === 2 && distance != null && (
            <>
              Distance: <b>{fmtDist(distance)}</b> · ΔElev:{" "}
              <b>
                {(
                  measurePoints[1].elevation - measurePoints[0].elevation
                ).toFixed(0)}{" "}
                m
              </b>
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
      {showProfile && profileData.length > 0 && (
        <ElevationProfile
          data={profileData}
          onClose={() => setShowProfile(false)}
        />
      )}
    </div>
  );
}

/* ================================================================== */
/*  Badge                                                              */
/* ================================================================== */

function Badge({
  label,
  color,
  loading,
}: {
  label: string;
  color: string;
  loading?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white ${color}`}
    >
      {loading && <Loader2 size={10} className="animate-spin" />}
      {label}
    </span>
  );
}
