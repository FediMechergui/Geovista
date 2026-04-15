'use client';

/**
 * CesiumViewer — a 3D globe view using CesiumJS via Resium React bindings.
 *
 * All Cesium features used here are **free / open-source** (Apache 2.0).
 * No Cesium Ion token is needed — we use:
 *   - OpenStreetMap raster tiles for imagery
 *   - EllipsoidTerrainProvider (flat terrain — free)
 *   - createOsmBuildingsAsync for 3D buildings (Cesium ION free tier optional)
 *
 * Static assets (Workers, ThirdParty, Assets, Widgets) must be copied to
 * public/cesium/ at build time. The guide's webpack CopyPlugin handles
 * that, or you can run `bootstrap.sh` / manually copy them.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Viewer as CesiumViewerComponent,
  Entity,
  Globe,
  Scene,
  ScreenSpaceEventHandler,
  CameraFlyTo,
  Cesium3DTileset,
  ImageryLayer,
} from 'resium';
import {
  Viewer as CesiumViewerClass,
  Cartesian3,
  Cartographic,
  Color,
  EllipsoidTerrainProvider,
  ScreenSpaceEventType,
  LabelStyle,
  VerticalOrigin,
  OpenStreetMapImageryProvider,
  Rectangle,
  Ion,
  createOsmBuildingsAsync,
  defined,
  Math as CesiumMath,
  Cesium3DTileset as Cesium3DTilesetClass,
  PolylineGlowMaterialProperty,
} from 'cesium';

import { useMapStore } from '@/store/mapStore';
import { geodesicDistance } from '@/lib/analysis/coordTransform';
import type { BBox } from '@/types/geo';
import { Ruler, X, Trash2, Loader2 } from 'lucide-react';

/* ================================================================== */
/*  Cesium base URL — must point at the static assets in public/       */
/* ================================================================== */

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).CESIUM_BASE_URL = '/cesium';
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function bboxToRectangle(b: BBox): Rectangle {
  return Rectangle.fromDegrees(b.west, b.south, b.east, b.north);
}

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
}

interface MeasurePoint {
  cartesian: Cartesian3;
  lon: number;
  lat: number;
  height: number;
}

/* ================================================================== */
/*  Free imagery provider (no API key)                                 */
/* ================================================================== */

const osmImageryProvider = new OpenStreetMapImageryProvider({
  url: 'https://tile.openstreetmap.org/',
});

/* ================================================================== */
/*  CesiumViewer                                                       */
/* ================================================================== */

export default function CesiumViewer() {
  /* ---- Store ---- */
  const selectedRegion = useMapStore((s) => s.selectedRegion);
  const layers = useMapStore((s) => s.layers);
  const verticalExaggeration = useMapStore((s) => s.verticalExaggeration);
  const underground = useMapStore((s) => s.underground);
  const set3DActive = useMapStore((s) => s.set3DActive);

  /* ---- Refs ---- */
  const viewerRef = useRef<CesiumViewerClass | null>(null);

  /* ---- Local state ---- */
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [osmBuildings, setOsmBuildings] = useState<Cesium3DTilesetClass | null>(null);
  const [buildingsLoading, setBuildingsLoading] = useState(false);
  const [flyDestination, setFlyDestination] = useState<Rectangle | null>(null);

  /* ================================================================ */
  /*  Fly to selected region when it changes                           */
  /* ================================================================ */

  useEffect(() => {
    if (selectedRegion) {
      setFlyDestination(bboxToRectangle(selectedRegion));
    }
  }, [selectedRegion]);

  /* ================================================================ */
  /*  Vertical exaggeration                                            */
  /* ================================================================ */

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.scene.verticalExaggeration = verticalExaggeration;
  }, [verticalExaggeration]);

  /* ================================================================ */
  /*  Underground navigation                                           */
  /* ================================================================ */

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = !underground;
    viewer.scene.globe.translucency.enabled = underground;
    viewer.scene.globe.translucency.frontFaceAlpha = underground ? 0.4 : 1.0;
  }, [underground]);

  /* ================================================================ */
  /*  OSM 3D Buildings (Cesium Ion free-tier — optional)                */
  /* ================================================================ */

  useEffect(() => {
    if (!layers.buildings) {
      setOsmBuildings(null);
      return;
    }

    // Only attempt if Ion token is set (free tier provides buildings)
    if (!Ion.defaultAccessToken) {
      return;
    }

    let cancelled = false;
    setBuildingsLoading(true);
    createOsmBuildingsAsync()
      .then((tileset) => {
        if (!cancelled) setOsmBuildings(tileset);
      })
      .catch((err) => {
        console.warn('[CesiumViewer] OSM 3D buildings not available:', err);
      })
      .finally(() => {
        if (!cancelled) setBuildingsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [layers.buildings]);

  /* ================================================================ */
  /*  Measurement click handler                                        */
  /* ================================================================ */

  const handleLeftClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event: any) => {
      if (!measureMode) return;
      const viewer = viewerRef.current;
      if (!viewer) return;

      const cartesian = viewer.camera.pickEllipsoid(
        event.position,
        viewer.scene.globe.ellipsoid,
      );
      if (!defined(cartesian) || !cartesian) return;

      const carto = Cartographic.fromCartesian(cartesian);
      const pt: MeasurePoint = {
        cartesian,
        lon: CesiumMath.toDegrees(carto.longitude),
        lat: CesiumMath.toDegrees(carto.latitude),
        height: carto.height,
      };

      setMeasurePoints((prev) => {
        if (prev.length < 2) return [...prev, pt];
        return [pt]; // reset
      });
    },
    [measureMode],
  );

  /* ---- Derived measurement ---- */
  const distance = useMemo(() => {
    if (measurePoints.length < 2) return null;
    const [a, b] = measurePoints;
    return geodesicDistance(a.lat, a.lon, b.lat, b.lon);
  }, [measurePoints]);

  /* ---- Measurement entities ---- */
  const measureEntities = useMemo(() => {
    const entities: React.ReactElement[] = [];

    measurePoints.forEach((pt, i) => {
      entities.push(
        <Entity
          key={`mpt-${i}`}
          position={pt.cartesian}
          point={{ pixelSize: 10, color: i === 0 ? Color.RED : Color.LIME }}
          label={{
            text: `${pt.lat.toFixed(5)}°, ${pt.lon.toFixed(5)}°`,
            font: '12px sans-serif',
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 2,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian3(0, -14, 0) as unknown as import('cesium').Cartesian2,
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
          }}
        />,
      );
    });

    if (measurePoints.length === 2 && distance != null) {
      const [a, b] = measurePoints;
      const midpoint = Cartesian3.midpoint(
        a.cartesian,
        b.cartesian,
        new Cartesian3(),
      );

      entities.push(
        <Entity
          key="mline"
          polyline={{
            positions: [a.cartesian, b.cartesian],
            width: 3,
            material: new PolylineGlowMaterialProperty({
              glowPower: 0.2,
              color: Color.YELLOW,
            }),
            clampToGround: true,
          }}
        />,
      );

      entities.push(
        <Entity
          key="mlabel"
          position={midpoint}
          label={{
            text: fmtDist(distance),
            font: 'bold 14px sans-serif',
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 2,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian3(0, -8, 0) as unknown as import('cesium').Cartesian2,
            fillColor: Color.YELLOW,
            outlineColor: Color.BLACK,
          }}
        />,
      );
    }

    return entities;
  }, [measurePoints, distance]);

  /* ================================================================ */
  /*  Viewer init callback                                             */
  /* ================================================================ */

  const handleViewerReady = useCallback(
    (viewer: CesiumViewerClass) => {
      viewerRef.current = viewer;

      // Apply initial settings
      viewer.scene.verticalExaggeration = verticalExaggeration;
      viewer.scene.globe.depthTestAgainstTerrain = true;
      viewer.scene.screenSpaceCameraController.enableCollisionDetection =
        !underground;

      // Remove default imagery layers (we add our own OSM layer)
      viewer.imageryLayers.removeAll();
    },
    // Only run on mount — stable deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div className="relative h-full w-full bg-black">
      <CesiumViewerComponent
        full
        ref={(e) => {
          if (e?.cesiumElement) handleViewerReady(e.cesiumElement);
        }}
        terrainProvider={new EllipsoidTerrainProvider()}
        // Disable UI chrome we don't need
        animation={false}
        timeline={false}
        baseLayerPicker={false}
        geocoder={false}
        homeButton={false}
        navigationHelpButton={false}
        sceneModePicker={false}
        fullscreenButton={false}
        selectionIndicator={false}
        infoBox={false}
        creditContainer={document.createElement('div')} // hide credits overlay (shown in footer)
      >
        {/* OSM raster tiles */}
        <ImageryLayer imageryProvider={osmImageryProvider} />

        <Scene />
        <Globe
          depthTestAgainstTerrain
          enableLighting={false}
        />

        {/* Fly to region */}
        {flyDestination && (
          <CameraFlyTo
            destination={flyDestination}
            duration={2}
            once
            onComplete={() => setFlyDestination(null)}
          />
        )}

        {/* OSM 3D Buildings */}
        {osmBuildings && layers.buildings && (
          <Cesium3DTileset url={osmBuildings.resource} />
        )}

        {/* Measurement entities */}
        {measureEntities}

        {/* Measurement click handler */}
        <ScreenSpaceEventHandler>
          {/* Resium ScreenSpaceEvent is not a component — we'll handle via ref */}
        </ScreenSpaceEventHandler>
      </CesiumViewerComponent>

      {/* ---- Imperative event handler via useEffect ---- */}
      <MeasureEventBridge
        viewerRef={viewerRef}
        onLeftClick={handleLeftClick}
        measureMode={measureMode}
      />

      {/* ---------- Floating controls ---------- */}

      {/* Top-left: Back + Measure */}
      <div className="absolute left-3 top-3 flex flex-col gap-2">
        <button
          onClick={() => set3DActive(false)}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-white/90 text-zinc-600 shadow-lg backdrop-blur-md transition-colors hover:bg-zinc-100 dark:bg-zinc-800/90 dark:text-zinc-300 dark:hover:bg-zinc-700"
          title="Back to 2D map"
        >
          <X size={16} />
        </button>

        <button
          onClick={() => {
            setMeasureMode((m) => !m);
            if (measureMode) {
              setMeasurePoints([]);
            }
          }}
          className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg shadow-lg backdrop-blur-md transition-colors ${
            measureMode
              ? 'bg-yellow-500 text-white'
              : 'bg-white/90 text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-800/90 dark:text-zinc-300 dark:hover:bg-zinc-700'
          }`}
          title="Measure distance"
        >
          <Ruler size={16} />
        </button>

        {measurePoints.length > 0 && (
          <button
            onClick={() => setMeasurePoints([])}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-white/90 text-zinc-600 shadow-lg backdrop-blur-md transition-colors hover:bg-zinc-100 dark:bg-zinc-800/90 dark:text-zinc-300 dark:hover:bg-zinc-700"
            title="Clear measurements"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Measurement info banner */}
      {measureMode && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 select-none rounded-full bg-yellow-500/90 px-4 py-1.5 text-sm font-medium text-white shadow-lg backdrop-blur-md">
          {measurePoints.length === 0 && 'Click globe to place first point'}
          {measurePoints.length === 1 && 'Click globe to place second point'}
          {measurePoints.length === 2 && distance != null && (
            <>
              Distance: <b>{fmtDist(distance)}</b>
            </>
          )}
        </div>
      )}

      {/* Buildings loading badge */}
      {buildingsLoading && (
        <div className="absolute right-3 top-3 flex items-center gap-2 rounded-lg bg-white/90 px-3 py-2 text-xs font-medium text-zinc-600 shadow-lg backdrop-blur-md dark:bg-zinc-800/90 dark:text-zinc-300">
          <Loader2 size={14} className="animate-spin" />
          Loading 3D buildings…
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Imperative Cesium event bridge                                     */
/*  (Resium's ScreenSpaceEvent doesn't cover all use-cases cleanly)    */
/* ================================================================== */

function MeasureEventBridge({
  viewerRef,
  onLeftClick,
  measureMode,
}: {
  viewerRef: React.RefObject<CesiumViewerClass | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onLeftClick: (event: any) => void;
  measureMode: boolean;
}) {
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !measureMode) return;

    const handler = new (
      // Access from the Cesium import
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('cesium').ScreenSpaceEventHandler
    )(viewer.scene.canvas) as import('cesium').ScreenSpaceEventHandler;

    handler.setInputAction(onLeftClick, ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      handler.destroy();
    };
  }, [viewerRef, onLeftClick, measureMode]);

  return null;
}
