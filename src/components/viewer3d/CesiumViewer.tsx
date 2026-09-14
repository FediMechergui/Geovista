'use client';

/**
 * CesiumViewer — photorealistic digital twin on a full globe.
 *
 * Sources (all free tiers):
 *   1. Google Photorealistic 3D Tiles — photogrammetry meshes of real cities
 *      and terrain worldwide (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, Map Tiles API).
 *   2. Cesium World Terrain — 30 m global DEM (NEXT_PUBLIC_CESIUM_ION_TOKEN).
 *   3. Cesium OSM Buildings — worldwide extruded buildings with OSM metadata.
 *   4. Esri World Imagery — satellite basemap, no key.
 *
 * On top of those sit the OSM road network and the traffic microsimulation —
 * the *same* simulation instance the Terrain view drives, so switching between
 * the two never restarts the city.
 *
 * The Cesium Viewer is driven imperatively: React owns the container and the
 * overlay UI, Cesium owns the scene.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Viewer,
  Ion,
  Cartesian3,
  Cartographic,
  Color,
  Credit,
  EllipsoidTerrainProvider,
  ImageryLayer,
  UrlTemplateImageryProvider,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Math as CesiumMath,
  createWorldTerrainAsync,
  createOsmBuildingsAsync,
  createGooglePhotorealistic3DTileset,
  Cesium3DTileset,
  Cesium3DTileFeature,
  PolylineGlowMaterialProperty,
  LabelStyle,
  VerticalOrigin,
  Cartesian2,
  Entity,
  ClassificationType,
  defined,
  type Cesium,
} from '@/lib/cesium';

import { useMapStore } from '@/store/mapStore';
import { geodesicDistance } from '@/lib/analysis/coordTransform';
import {
  ensureTrafficSession,
  type TrafficSession,
} from '@/lib/traffic/trafficService';
import {
  createCesiumRoadLayer,
  createCesiumVehicleLayer,
  type CesiumRoadLayer,
  type CesiumVehicleLayer,
} from '@/lib/traffic/cesiumTraffic';
import TrafficPanel from '@/components/traffic/TrafficPanel';
import { createTerrariumTerrainProvider, clearTerrariumCache } from '@/lib/terrain/cesiumTerrain';
import { fetchBuildings } from '@/lib/buildings/osmFetcher';
import {
  createCesiumBuildingLayer,
  type CesiumBuildingLayer,
} from '@/lib/buildings/cesiumBuildings';
import { fetchVegetation } from '@/lib/vegetation/osmVegetation';
import { clampBBoxArea, bboxAreaKm2, MAX_AREA_KM2 } from '@/lib/geo/bbox';
import {
  createCesiumTreeLayer,
  type CesiumTreeLayer,
} from '@/lib/vegetation/cesiumTrees';
import {
  CESIUM_BASE_URL,
  CESIUM_ION_TOKEN,
  GOOGLE_MAPS_API_KEY,
  TILE_URLS,
} from '@/lib/constants';
import type { BBox } from '@/types/geo';
import {
  Ruler, X, Trash2, Loader2, Globe2, Box, Building2, MapPin, TrafficCone, Trees, Info,
} from 'lucide-react';

/* ================================================================== */
/*  Module setup (client only — this file is dynamically imported)     */
/* ================================================================== */

/** How often the congestion colours and the stats panel refresh, ms. */
const STATS_REFRESH_MS = 2000;

const HAS_ION = CESIUM_ION_TOKEN.length > 0;
const HAS_GOOGLE = GOOGLE_MAPS_API_KEY.length > 0;

if (typeof window !== 'undefined') {
  (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = CESIUM_BASE_URL;
  if (HAS_ION) Ion.defaultAccessToken = CESIUM_ION_TOKEN;
}

/* ================================================================== */
/*  Types & helpers                                                    */
/* ================================================================== */

type GlobeSource = 'google' | 'cesium';
type Status = 'idle' | 'loading' | 'ready' | 'failed';

interface MeasurePoint {
  cartesian: Cartesian3;
  lon: number;
  lat: number;
  height: number;
}

interface FeatureInfo {
  kind: 'building' | 'point';
  title: string;
  rows: [string, string][];
}

const OSM_BUILDING_PROPS: [string, string][] = [
  ['building', 'Type'],
  ['cesium#estimatedHeight', 'Height (m)'],
  ['building:levels', 'Levels'],
  ['addr:housenumber', 'Number'],
  ['addr:street', 'Street'],
  ['addr:city', 'City'],
  ['addr:postcode', 'Postcode'],
  ['amenity', 'Amenity'],
  ['shop', 'Shop'],
  ['elementId', 'OSM id'],
];

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
}

function esriImagery(): ImageryLayer {
  return new ImageryLayer(
    new UrlTemplateImageryProvider({
      url: TILE_URLS.satellite,
      credit: new Credit('Esri, Maxar, Earthstar Geographics'),
      maximumLevel: 19,
    }),
  );
}

/** Pick a world position on 3D tiles / terrain / ellipsoid, in that order. */
function pickWorldPosition(viewer: Viewer, windowPos: Cartesian2): Cartesian3 | undefined {
  const scene = viewer.scene;
  if (scene.pickPositionSupported) {
    const p = scene.pickPosition(windowPos);
    if (defined(p)) return p;
  }
  const ray = viewer.camera.getPickRay(windowPos);
  if (ray) {
    const p = scene.globe.pick(ray, scene);
    if (defined(p)) return p;
  }
  return viewer.camera.pickEllipsoid(windowPos, scene.globe.ellipsoid) ?? undefined;
}

/** Oblique fly-to that frames a bbox from the south at ~40° pitch. */
function flyToBBox(viewer: Viewer, b: BBox, groundHeight = 0) {
  const lat = (b.south + b.north) / 2;
  const lon = (b.west + b.east) / 2;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const spanM = Math.max((b.east - b.west) * 111320 * cosLat, (b.north - b.south) * 111320);

  const pitch = CesiumMath.toRadians(-40);
  const height = spanM * 0.95 + groundHeight;
  const back = height / Math.tan(-pitch);
  const camLat = lat - (back / 111320);

  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(lon, camLat, height),
    orientation: { heading: 0, pitch, roll: 0 },
    duration: 2.2,
  });
}

/* ================================================================== */
/*  CesiumViewer                                                       */
/* ================================================================== */

export default function CesiumViewer() {
  /* ---- Store ---- */
  const selectedRegion = useMapStore((s) => s.selectedRegion);
  const center = useMapStore((s) => s.center);
  const zoom = useMapStore((s) => s.zoom);
  const layers = useMapStore((s) => s.layers);
  const verticalExaggeration = useMapStore((s) => s.verticalExaggeration);
  const underground = useMapStore((s) => s.underground);
  const regionStats = useMapStore((s) => s.regionStats);
  const trafficConfig = useMapStore((s) => s.trafficConfig);
  const trafficUi = useMapStore((s) => s.trafficUi);
  const trafficLoading = useMapStore((s) => s.trafficLoading);
  const set3DActive = useMapStore((s) => s.set3DActive);
  const setCursorCoord = useMapStore((s) => s.setCursorCoord);
  const setTrafficStats = useMapStore((s) => s.setTrafficStats);
  const setTrafficLoading = useMapStore((s) => s.setTrafficLoading);
  const setTrafficError = useMapStore((s) => s.setTrafficError);

  /* ---- Refs ---- */
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const googleRef = useRef<Cesium3DTileset | null>(null);
  const osmRef = useRef<Cesium3DTileset | null>(null);
  const regionEntityRef = useRef<Entity | null>(null);
  const measureEntitiesRef = useRef<Entity[]>([]);
  const highlightRef = useRef<{ feature: Cesium3DTileFeature; color: Color } | null>(null);
  const measureModeRef = useRef(false);
  const lastMoveRef = useRef(0);
  const roadLayerRef = useRef<CesiumRoadLayer | null>(null);
  const vehicleLayerRef = useRef<CesiumVehicleLayer | null>(null);
  const osmFallbackRef = useRef<CesiumBuildingLayer | null>(null);
  const treeLayerRef = useRef<CesiumTreeLayer | null>(null);
  /** Read by the per-frame listener, which must not re-subscribe on each change. */
  const trafficUiRef = useRef(trafficUi);

  /* ---- State ---- */
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState<GlobeSource>(HAS_GOOGLE ? 'google' : 'cesium');
  const [googleStatus, setGoogleStatus] = useState<Status>('idle');
  const [terrainStatus, setTerrainStatus] = useState<Status>('idle');
  const [terrainSource, setTerrainSource] = useState<'ion' | 'aws' | null>(null);
  const [buildingsStatus, setBuildingsStatus] = useState<Status>('idle');
  const [treesStatus, setTreesStatus] = useState<Status>('idle');
  const [buildingCount, setBuildingCount] = useState(0);
  const [treeCount, setTreeCount] = useState(0);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [buildingsNote, setBuildingsNote] = useState<string | null>(null);
  const [treesNote, setTreesNote] = useState<string | null>(null);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [featureInfo, setFeatureInfo] = useState<FeatureInfo | null>(null);
  const [session, setSession] = useState<TrafficSession | null>(null);
  const [trafficPanelOpen, setTrafficPanelOpen] = useState(false);

  useEffect(() => {
    measureModeRef.current = measureMode;
  }, [measureMode]);

  useEffect(() => {
    trafficUiRef.current = trafficUi;
  }, [trafficUi]);

  /* ================================================================ */
  /*  Viewer lifecycle                                                 */
  /* ================================================================ */

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const viewer = new Viewer(container, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      fullscreenButton: false,
      selectionIndicator: false,
      infoBox: false,
      baseLayer: esriImagery(),
      terrainProvider: new EllipsoidTerrainProvider(),
      msaaSamples: 4,
    });

    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.globe.enableLighting = false;
    viewer.scene.postProcessStages.fxaa.enabled = true;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;

    viewerRef.current = viewer;
    setReady(true);

    if (process.env.NODE_ENV !== 'production') {
      // Handle for local debugging and the browser check harness.
      (window as unknown as { __cesiumViewer?: Viewer }).__cesiumViewer = viewer;
    }

    // Cesium World Terrain needs an Ion token; the free AWS Terrarium tiles
    // that back the Terrain view do not. Either way the globe gets relief,
    // and either way the user is told which one they are looking at.
    setTerrainStatus('loading');
    if (HAS_ION) {
      createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true })
        .then((tp) => {
          if (viewer.isDestroyed()) return;
          viewer.terrainProvider = tp;
          setTerrainSource('ion');
          setTerrainStatus('ready');
        })
        .catch((err) => {
          console.warn('[CesiumViewer] World Terrain failed, falling back to AWS tiles:', err);
          if (viewer.isDestroyed()) return;
          viewer.terrainProvider = createTerrariumTerrainProvider();
          setTerrainSource('aws');
          setTerrainStatus('ready');
        });
    } else {
      viewer.terrainProvider = createTerrariumTerrainProvider();
      setTerrainSource('aws');
      setTerrainStatus('ready');
    }

    return () => {
      viewerRef.current = null;
      googleRef.current = null;
      osmRef.current = null;
      osmFallbackRef.current = null;
      treeLayerRef.current = null;
      clearTerrariumCache();
      regionEntityRef.current = null;
      measureEntitiesRef.current = [];
      highlightRef.current = null;
      setReady(false);
      viewer.destroy();
    };
  }, []);

  /* ================================================================ */
  /*  Google Photorealistic 3D Tiles                                   */
  /* ================================================================ */

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;

    const wantGoogle = source === 'google' && HAS_GOOGLE;

    if (googleRef.current) {
      googleRef.current.show = wantGoogle;
      viewer.scene.globe.show = !wantGoogle;
      return;
    }
    if (!wantGoogle) {
      viewer.scene.globe.show = true;
      return;
    }

    let cancelled = false;
    setGoogleStatus('loading');
    createGooglePhotorealistic3DTileset(
      { key: GOOGLE_MAPS_API_KEY },
      { showCreditsOnScreen: true, maximumScreenSpaceError: 8 },
    )
      .then((tileset) => {
        if (cancelled || viewer.isDestroyed()) {
          tileset.destroy();
          return;
        }
        googleRef.current = tileset;
        viewer.scene.primitives.add(tileset);
        viewer.scene.globe.show = false;
        setGoogleStatus('ready');
      })
      .catch((err) => {
        console.warn('[CesiumViewer] Google 3D Tiles unavailable (is the Map Tiles API enabled for this key?):', err);
        if (!cancelled) {
          setGoogleStatus('failed');
          setSource('cesium');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ready, source]);

  /* ================================================================ */
  /*  Cesium OSM Buildings                                             */
  /* ================================================================ */

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !HAS_ION) return;

    const want = source === 'cesium' && layers.buildings;
    if (osmRef.current) {
      osmRef.current.show = want;
      return;
    }
    if (!want) return;

    let cancelled = false;
    setBuildingsStatus('loading');
    createOsmBuildingsAsync()
      .then((tileset) => {
        if (cancelled || viewer.isDestroyed()) {
          tileset.destroy();
          return;
        }
        osmRef.current = tileset;
        viewer.scene.primitives.add(tileset);
        setBuildingsStatus('ready');
      })
      .catch((err) => {
        console.warn('[CesiumViewer] OSM Buildings failed:', err);
        if (!cancelled) setBuildingsStatus('failed');
      });

    return () => {
      cancelled = true;
    };
  }, [ready, source, layers.buildings]);

  /* ================================================================ */
  /*  Buildings without Ion — extruded OSM footprints                  */
  /* ================================================================ */

  useEffect(() => {
    const viewer = viewerRef.current;
    // Ion's global tileset is strictly better where it is available; this
    // path only covers the selected region, and only when there is no token.
    if (!ready || !viewer || HAS_ION) return;

    if (!selectedRegion || source !== 'cesium' || !layers.buildings) {
      osmFallbackRef.current?.destroy();
      osmFallbackRef.current = null;
      setBuildingCount(0);
      setBuildingsStatus('idle');
      return;
    }

    const ac = new AbortController();
    setBuildingsStatus('loading');
    setBuildingsNote(null);

    // A hand-drawn region has no upper bound, and `out geom` over a whole
    // governorate times out rather than returning anything. Ask for the centre
    // of the selection and say that is what happened.
    const { bbox, clamped } = clampBBoxArea(selectedRegion, MAX_AREA_KM2.buildings);

    fetchBuildings(bbox, ac.signal)
      .then((data) => createCesiumBuildingLayer(viewer, data, ac.signal))
      .then((layer) => {
        if (ac.signal.aborted || viewer.isDestroyed()) {
          layer?.destroy();
          return;
        }
        osmFallbackRef.current = layer;
        setBuildingCount(layer?.count ?? 0);
        setBuildingsStatus(layer ? 'ready' : 'idle');
        setBuildingsNote(
          clamped
            ? `selection too large — loaded the central ${bboxAreaKm2(bbox).toFixed(0)} km²`
            : layer
              ? null
              : 'no buildings mapped here',
        );
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        console.warn('[CesiumViewer] OSM building fallback failed:', err);
        setBuildingsStatus('failed');
        setBuildingsNote(err instanceof Error ? err.message : 'Overpass request failed');
      });

    return () => {
      ac.abort();
      osmFallbackRef.current?.destroy();
      osmFallbackRef.current = null;
    };
  }, [ready, source, selectedRegion, layers.buildings]);

  /* ================================================================ */
  /*  Trees                                                            */
  /* ================================================================ */

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;

    // Google's photogrammetry already contains the real trees, and billboards
    // clamp to the globe surface, which is hidden under that tileset.
    if (!selectedRegion || source !== 'cesium' || !layers.trees) {
      treeLayerRef.current?.destroy();
      treeLayerRef.current = null;
      setTreeCount(0);
      setTreesStatus('idle');
      return;
    }

    const ac = new AbortController();
    setTreesStatus('loading');
    setTreesNote(null);

    const { bbox, clamped } = clampBBoxArea(selectedRegion, MAX_AREA_KM2.vegetation);

    fetchVegetation(bbox, ac.signal)
      .then((data) => {
        if (ac.signal.aborted || viewer.isDestroyed()) return;
        const layer = createCesiumTreeLayer(viewer, data.trees);
        treeLayerRef.current = layer;
        setTreeCount(layer?.count ?? 0);
        setTreesStatus(layer ? 'ready' : 'idle');
        setTreesNote(
          clamped
            ? `selection too large — loaded the central ${bboxAreaKm2(bbox).toFixed(0)} km²`
            : layer
              ? null
              : 'no vegetation mapped here',
        );
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        console.warn('[CesiumViewer] vegetation failed:', err);
        setTreesStatus('failed');
        setTreesNote(err instanceof Error ? err.message : 'Overpass request failed');
      });

    return () => {
      ac.abort();
      treeLayerRef.current?.destroy();
      treeLayerRef.current = null;
    };
  }, [ready, source, selectedRegion, layers.trees]);

  /* ================================================================ */
  /*  Region outline + camera                                          */
  /* ================================================================ */

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;

    if (regionEntityRef.current) {
      viewer.entities.remove(regionEntityRef.current);
      regionEntityRef.current = null;
    }

    if (selectedRegion) {
      const { west: w, south: s, east: e, north: n } = selectedRegion;
      regionEntityRef.current = viewer.entities.add({
        polyline: {
          positions: Cartesian3.fromDegreesArray([w, s, e, s, e, n, w, n, w, s]),
          width: 3,
          material: Color.fromCssColorString('#22c55e').withAlpha(0.95),
          clampToGround: true,
          classificationType: ClassificationType.BOTH,
        },
      });
      flyToBBox(viewer, selectedRegion, regionStats?.maxElev ?? 0);
    } else {
      // No region yet: look at the 2D map's current view.
      const mpp = (156543.03 * Math.cos((center[1] * Math.PI) / 180)) / 2 ** zoom;
      const height = Math.max(2000, mpp * 900);
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(center[0], center[1], height),
        duration: 1.5,
      });
    }
    // Only re-run when the region changes; camera/stats are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedRegion]);

  /* ================================================================ */
  /*  Exaggeration / underground                                       */
  /* ================================================================ */

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;
    viewer.scene.verticalExaggeration = verticalExaggeration;
  }, [ready, verticalExaggeration]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = !underground;
    viewer.scene.globe.translucency.enabled = underground;
    viewer.scene.globe.translucency.frontFaceAlpha = underground ? 0.45 : 1.0;
  }, [ready, underground]);

  /* ================================================================ */
  /*  Road network + traffic simulation                                */
  /* ================================================================ */

  useEffect(() => {
    if (!ready || !selectedRegion || !layers.roads) {
      setSession(null);
      return;
    }
    const ac = new AbortController();
    setTrafficLoading(true);
    setTrafficError(null);

    ensureTrafficSession(selectedRegion, trafficConfig, ac.signal)
      .then((loaded) => {
        if (ac.signal.aborted) return;
        setSession(loaded);
        if (!loaded) setTrafficError('No drivable road mapped in this region.');
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        console.warn('[CesiumViewer] road network failed:', err);
        setSession(null);
        setTrafficError(err instanceof Error ? err.message : 'Road network failed to load');
      })
      .finally(() => {
        if (!ac.signal.aborted) setTrafficLoading(false);
      });

    return () => ac.abort();
    // Config changes are pushed to the live simulation below, not refetched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedRegion, layers.roads, setTrafficLoading, setTrafficError]);

  useEffect(() => {
    session?.simulation.setConfig(trafficConfig);
  }, [session, trafficConfig]);

  /* ---- Road polylines ---- */

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !session || !layers.roads) return;

    const layer = createCesiumRoadLayer(
      viewer,
      session.graph,
      session.simulation.edgeStats(),
      trafficUi.showCongestion && layers.traffic,
    );
    roadLayerRef.current = layer;

    return () => {
      roadLayerRef.current = null;
      layer.destroy();
    };
  }, [ready, session, layers.roads, layers.traffic, trafficUi.showCongestion]);

  /* ---- Vehicles ---- */

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !session || !layers.traffic) return;

    const layer = createCesiumVehicleLayer(viewer, session.graph);
    vehicleLayerRef.current = layer;

    return () => {
      vehicleLayerRef.current = null;
      layer.destroy();
    };
  }, [ready, session, layers.traffic]);

  /* ---- The per-frame tick ---- */

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !session || !layers.traffic) return;

    const { simulation } = session;
    let last = performance.now();
    let lastStats = last;

    const onPreRender = () => {
      const now = performance.now();
      const delta = Math.min(0.5, (now - last) / 1000);
      last = now;

      if (trafficUiRef.current.running) simulation.step(delta);
      vehicleLayerRef.current?.update(simulation.poses());

      if (now - lastStats < STATS_REFRESH_MS) return;
      lastStats = now;
      roadLayerRef.current?.refresh(
        simulation.edgeStats(),
        trafficUiRef.current.showCongestion,
      );
      setTrafficStats(simulation.stats());
    };

    viewer.scene.preRender.addEventListener(onPreRender);
    return () => {
      if (!viewer.isDestroyed()) viewer.scene.preRender.removeEventListener(onPreRender);
    };
  }, [ready, session, layers.traffic, setTrafficStats]);

  /* ================================================================ */
  /*  Input: click (measure / pick) and hover (coords)                 */
  /* ================================================================ */

  const clearHighlight = useCallback(() => {
    const h = highlightRef.current;
    if (h) {
      try {
        h.feature.color = h.color;
      } catch {
        /* feature may have been unloaded */
      }
      highlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const v = viewerRef.current;
      if (!v) return;
      const position = pickWorldPosition(v, e.position);

      if (measureModeRef.current) {
        if (!position) return;
        const carto = Cartographic.fromCartesian(position);
        const pt: MeasurePoint = {
          cartesian: position,
          lon: CesiumMath.toDegrees(carto.longitude),
          lat: CesiumMath.toDegrees(carto.latitude),
          height: carto.height,
        };
        setMeasurePoints((prev) => (prev.length < 2 ? [...prev, pt] : [pt]));
        return;
      }

      clearHighlight();
      const picked = v.scene.pick(e.position);

      if (picked instanceof Cesium3DTileFeature) {
        highlightRef.current = { feature: picked, color: Color.clone(picked.color) };
        picked.color = Color.fromCssColorString('#facc15');

        const rows: [string, string][] = [];
        for (const [key, label] of OSM_BUILDING_PROPS) {
          const val = picked.getProperty(key);
          if (val === undefined || val === null || val === '') continue;
          rows.push([label, typeof val === 'number' ? val.toFixed(key.includes('Height') ? 1 : 0) : String(val)]);
        }
        const name = picked.getProperty('name');
        setFeatureInfo({
          kind: 'building',
          title: name ? String(name) : 'Building',
          rows,
        });
        return;
      }

      if (position) {
        const carto = Cartographic.fromCartesian(position);
        setFeatureInfo({
          kind: 'point',
          title: 'Point',
          rows: [
            ['Latitude', `${CesiumMath.toDegrees(carto.latitude).toFixed(6)}°`],
            ['Longitude', `${CesiumMath.toDegrees(carto.longitude).toFixed(6)}°`],
            ['Height', `${carto.height.toFixed(1)} m`],
          ],
        });
      } else {
        setFeatureInfo(null);
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      const now = performance.now();
      if (now - lastMoveRef.current < 60) return;
      lastMoveRef.current = now;
      const v = viewerRef.current;
      if (!v) return;
      const p = v.camera.pickEllipsoid(e.endPosition, v.scene.globe.ellipsoid);
      if (!p) {
        setCursorCoord(null);
        return;
      }
      const carto = Cartographic.fromCartesian(p);
      setCursorCoord({
        lon: CesiumMath.toDegrees(carto.longitude),
        lat: CesiumMath.toDegrees(carto.latitude),
      });
    }, ScreenSpaceEventType.MOUSE_MOVE);

    return () => {
      handler.destroy();
      setCursorCoord(null);
    };
  }, [ready, clearHighlight, setCursorCoord]);

  /* ================================================================ */
  /*  Measurement entities                                             */
  /* ================================================================ */

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;

    for (const ent of measureEntitiesRef.current) viewer.entities.remove(ent);
    measureEntitiesRef.current = [];

    measurePoints.forEach((pt, i) => {
      measureEntitiesRef.current.push(
        viewer.entities.add({
          position: pt.cartesian,
          point: {
            pixelSize: 10,
            color: i === 0 ? Color.fromCssColorString('#ef4444') : Color.fromCssColorString('#22c55e'),
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `${pt.lat.toFixed(5)}°, ${pt.lon.toFixed(5)}°\n${pt.height.toFixed(0)} m`,
            font: '12px system-ui',
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 2,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -14),
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
    });

    if (measurePoints.length === 2) {
      const [a, b] = measurePoints;
      const distance = geodesicDistance(a.lat, a.lon, b.lat, b.lon);
      measureEntitiesRef.current.push(
        viewer.entities.add({
          polyline: {
            positions: [a.cartesian, b.cartesian],
            width: 4,
            material: new PolylineGlowMaterialProperty({
              glowPower: 0.25,
              color: Color.fromCssColorString('#facc15'),
            }),
            clampToGround: true,
            classificationType: ClassificationType.BOTH,
          },
        }),
        viewer.entities.add({
          position: Cartesian3.midpoint(a.cartesian, b.cartesian, new Cartesian3()),
          label: {
            text: `${fmtDist(distance)} · Δh ${(b.height - a.height).toFixed(0)} m`,
            font: 'bold 14px system-ui',
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 2,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -10),
            fillColor: Color.fromCssColorString('#facc15'),
            outlineColor: Color.BLACK,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
    }
  }, [ready, measurePoints]);

  const distance =
    measurePoints.length === 2
      ? geodesicDistance(measurePoints[0].lat, measurePoints[0].lon, measurePoints[1].lat, measurePoints[1].lon)
      : null;

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  const googleActive = source === 'google' && googleStatus === 'ready';

  const loadingItems: string[] = [];
  if (terrainStatus === 'loading') loadingItems.push('terrain');
  if (googleStatus === 'loading') loadingItems.push('photorealistic tiles');
  if (buildingsStatus === 'loading') loadingItems.push('buildings');
  if (treesStatus === 'loading') loadingItems.push('trees');
  if (trafficLoading) loadingItems.push('roads');

  return (
    <div className="relative h-full w-full bg-black">
      <div ref={containerRef} className="absolute inset-0" />

      {/* ---------- Top-left: back, measure, clear ---------- */}
      <div className="absolute left-3 top-3 flex flex-col gap-2">
        <IconBtn title="Back to 2D map" onClick={() => set3DActive(false)}>
          <X size={16} />
        </IconBtn>
        <IconBtn
          title="Measure distance"
          active={measureMode}
          onClick={() => {
            setMeasureMode((m) => !m);
            if (measureMode) setMeasurePoints([]);
            setFeatureInfo(null);
            clearHighlight();
          }}
        >
          <Ruler size={16} />
        </IconBtn>
        {measurePoints.length > 0 && (
          <IconBtn title="Clear measurements" onClick={() => setMeasurePoints([])}>
            <Trash2 size={16} />
          </IconBtn>
        )}
        <IconBtn
          title="Traffic simulation"
          active={trafficPanelOpen}
          onClick={() => setTrafficPanelOpen((o) => !o)}
        >
          <TrafficCone size={16} />
        </IconBtn>
      </div>

      {/* ---------- Traffic panel ---------- */}
      {trafficPanelOpen && (
        <div className="absolute bottom-16 left-3 max-h-[70%] w-60 overflow-y-auto rounded-xl bg-zinc-900/95 p-3 text-zinc-200 shadow-lg backdrop-blur-md">
          <TrafficPanel compact />
          {session && (
            <p className="mt-2 text-[10px] leading-snug text-zinc-600">
              {(session.graph.totalLengthM / 1000).toFixed(1)} km of road ·{' '}
              {session.graph.edges.size.toLocaleString()} segments
            </p>
          )}
        </div>
      )}

      {/* ---------- Top-center: source switch ---------- */}
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 rounded-lg bg-zinc-900/90 p-0.5 shadow-lg backdrop-blur-md">
        <SourceBtn
          Icon={Box}
          label="Photorealistic"
          active={source === 'google'}
          disabled={!HAS_GOOGLE || googleStatus === 'failed'}
          title={
            !HAS_GOOGLE
              ? 'Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable Google Photorealistic 3D Tiles'
              : googleStatus === 'failed'
                ? 'Google 3D Tiles failed to load — enable the Map Tiles API for this key'
                : 'Google Photorealistic 3D Tiles'
          }
          onClick={() => setSource('google')}
        />
        <SourceBtn
          Icon={Building2}
          label="Terrain + Buildings"
          active={source === 'cesium'}
          title="Cesium World Terrain + OSM Buildings over Esri imagery"
          onClick={() => setSource('cesium')}
        />
      </div>

      {/* ---------- Loading ---------- */}
      {loadingItems.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-14 flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-900/90 px-4 py-1.5 text-xs font-medium text-zinc-200 shadow-lg backdrop-blur-md">
          <Loader2 size={14} className="animate-spin text-blue-400" />
          Loading {loadingItems.join(' · ')}
        </div>
      )}

      {/* ---------- What is actually on the globe ---------- */}
      <div className="absolute bottom-16 right-3 w-64">
        <button
          onClick={() => setSourcesOpen((o) => !o)}
          className="ml-auto flex cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-900/90 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 shadow-lg backdrop-blur-md transition-colors hover:bg-zinc-800"
        >
          <Info size={13} />
          Data sources
        </button>

        {sourcesOpen && (
          <div className="mt-2 rounded-xl bg-zinc-900/95 p-3 text-zinc-200 shadow-lg backdrop-blur-md">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              On the globe
            </div>
            <ul className="flex flex-col gap-1.5">
              <SourceRow
                Icon={Globe2}
                label="Terrain"
                status={terrainStatus}
                detail={
                  terrainSource === 'ion'
                    ? 'Cesium World Terrain (Ion)'
                    : terrainSource === 'aws'
                      ? 'AWS Terrain Tiles — free, no key'
                      : '—'
                }
                upgrade={
                  terrainSource === 'aws'
                    ? 'NEXT_PUBLIC_CESIUM_ION_TOKEN adds Cesium World Terrain (30 m, water mask)'
                    : undefined
                }
              />
              <SourceRow
                Icon={Building2}
                label="Buildings"
                status={buildingsStatus}
                detail={
                  !layers.buildings
                    ? 'layer off'
                    : HAS_ION
                      ? 'Cesium OSM Buildings (Ion, global)'
                      : selectedRegion
                        ? `OSM footprints — ${buildingCount.toLocaleString()} in this region`
                        : 'select a region to load them'
                }
                note={buildingsNote}
                upgrade={
                  !HAS_ION
                    ? 'NEXT_PUBLIC_CESIUM_ION_TOKEN swaps in the global pre-tiled set'
                    : undefined
                }
              />
              <SourceRow
                Icon={Trees}
                label="Trees"
                status={treesStatus}
                detail={
                  !layers.trees
                    ? 'layer off'
                    : source === 'google'
                      ? 'included in the photorealistic mesh'
                      : selectedRegion
                        ? `OSM vegetation — ${treeCount.toLocaleString()} placed`
                        : 'select a region to load them'
                }
                note={treesNote}
              />
              <SourceRow
                Icon={Box}
                label="Photorealistic"
                status={googleStatus}
                detail={HAS_GOOGLE ? 'Google 3D Tiles' : 'not configured'}
                upgrade={
                  !HAS_GOOGLE
                    ? 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (Map Tiles API) adds real captured mesh: buildings, trees and terrain'
                    : undefined
                }
              />
            </ul>

            {(!HAS_ION || !HAS_GOOGLE) && (
              <p className="mt-2 border-t border-zinc-800 pt-2 text-[10px] leading-snug text-zinc-500">
                Everything above works with no API key. Set the variables named above in{' '}
                <code className="text-zinc-400">.env.local</code> (see{' '}
                <code className="text-zinc-400">.env.example</code>) and rebuild to upgrade a
                source.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ---------- Feature card ---------- */}
      {featureInfo && !measureMode && (
        <div className="absolute right-3 top-3 w-64 rounded-xl bg-zinc-900/95 p-3 text-zinc-200 shadow-lg backdrop-blur-md">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {featureInfo.kind === 'building' ? (
                <Building2 size={14} className="text-yellow-400" />
              ) : (
                <MapPin size={14} className="text-blue-400" />
              )}
              <span className="line-clamp-2">{featureInfo.title}</span>
            </div>
            <button
              onClick={() => {
                setFeatureInfo(null);
                clearHighlight();
              }}
              className="cursor-pointer rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              title="Close"
            >
              <X size={14} />
            </button>
          </div>
          {featureInfo.rows.length > 0 ? (
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
              {featureInfo.rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <span className="text-zinc-500">{k}</span>
                  <span className="truncate text-right tabular-nums text-zinc-200" title={v}>
                    {v}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500">No metadata for this feature.</p>
          )}
          {featureInfo.kind === 'point' && googleActive && (
            <p className="mt-2 text-[10px] leading-snug text-zinc-500">
              Photorealistic tiles carry no per-building metadata. Switch to “Terrain + Buildings” to
              inspect OSM attributes.
            </p>
          )}
        </div>
      )}

      {/* ---------- Measurement banner ---------- */}
      {measureMode && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 select-none rounded-full bg-yellow-500/90 px-4 py-1.5 text-sm font-medium text-white shadow-lg backdrop-blur-md">
          {measurePoints.length === 0 && 'Click the scene to place first point'}
          {measurePoints.length === 1 && 'Click the scene to place second point'}
          {measurePoints.length === 2 && distance != null && (
            <>
              Distance: <b>{fmtDist(distance)}</b> · Δh:{' '}
              <b>{(measurePoints[1].height - measurePoints[0].height).toFixed(0)} m</b>
            </>
          )}
        </div>
      )}

      {/* ---------- Source badges ---------- */}
      {/* Each badge names the source actually in use, so the globe never
          claims Ion data it is not drawing. What is missing, and what it
          would add, lives in the Data sources panel instead of a badge. */}
      <div className="pointer-events-none absolute bottom-8 left-3 flex flex-col items-start gap-1">
        {googleActive && <Badge color="bg-blue-600/85" Icon={Box} label="Google Photorealistic 3D Tiles" />}
        {!googleActive && terrainStatus === 'ready' && (
          <Badge
            color="bg-emerald-600/85"
            Icon={Globe2}
            label={terrainSource === 'ion' ? 'Cesium World Terrain' : 'AWS Terrain Tiles'}
          />
        )}
        {!googleActive && buildingsStatus === 'ready' && layers.buildings && (
          <Badge
            color="bg-orange-600/85"
            Icon={Building2}
            label={
              HAS_ION
                ? 'Cesium OSM Buildings'
                : `OSM buildings · ${buildingCount.toLocaleString()}`
            }
          />
        )}
        {!googleActive && treesStatus === 'ready' && layers.trees && (
          <Badge color="bg-green-700/85" Icon={Trees} label={`OSM trees · ${treeCount.toLocaleString()}`} />
        )}
        {layers.traffic && session && (
          <Badge color="bg-sky-600/85" Icon={TrafficCone} label="Live traffic simulation" />
        )}
      </div>
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
        active ? 'bg-yellow-500 text-white' : 'bg-zinc-900/90 text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}

/** One line in the data-sources panel: what it is, where it came from. */
function SourceRow({
  Icon,
  label,
  status,
  detail,
  note,
  upgrade,
}: {
  Icon: typeof Globe2;
  label: string;
  status: Status;
  detail: string;
  /** Why this source did not give you everything — clamped area, or an error. */
  note?: string | null;
  upgrade?: string;
}) {
  const dot =
    status === 'ready'
      ? 'bg-emerald-500'
      : status === 'loading'
        ? 'bg-blue-500 animate-pulse'
        : status === 'failed'
          ? 'bg-red-500'
          : 'bg-zinc-600';

  return (
    <li className="text-[11px] leading-snug">
      <div className="flex items-center gap-1.5">
        <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <Icon size={11} className="shrink-0 text-zinc-500" />
        <span className="font-medium text-zinc-300">{label}</span>
        <span className="ml-auto truncate text-zinc-500" title={detail}>
          {detail}
        </span>
      </div>
      {note && (
        <p className={`ml-3 mt-0.5 text-[10px] ${status === 'failed' ? 'text-red-400' : 'text-amber-400/80'}`}>
          {note}
        </p>
      )}
      {upgrade && <p className="ml-3 mt-0.5 text-[10px] text-zinc-600">{upgrade}</p>}
    </li>
  );
}

function SourceBtn({
  Icon,
  label,
  active,
  disabled,
  title,
  onClick,
}: {
  Icon: React.ComponentType<{ size?: number }>;
  label: string;
  active: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : disabled
            ? 'cursor-not-allowed text-zinc-600'
            : 'cursor-pointer text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function Badge({
  color,
  Icon,
  label,
}: {
  color: string;
  Icon: React.ComponentType<{ size?: number }>;
  label: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm ${color}`}>
      <Icon size={10} /> {label}
    </div>
  );
}
