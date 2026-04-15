'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, {
  NavigationControl,
  ScaleControl,
  Source,
  Layer,
} from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapRef } from 'react-map-gl/maplibre';
import { useMapStore } from '@/store/mapStore';
import type { BBox, Basemap } from '@/types/geo';
import {
  Square,
  Map as MapIcon,
  Satellite,
  Mountain,
  Moon,
  Box,
  X,
  MousePointer2,
  Crosshair,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Basemap styles — all free, no API key required                     */
/* ------------------------------------------------------------------ */

function makeRasterStyle(id: string, tiles: string[], attribution: string) {
  return {
    version: 8 as const,
    sources: {
      [id]: { type: 'raster' as const, tiles, tileSize: 256, attribution },
    },
    layers: [
      { id, type: 'raster' as const, source: id, minzoom: 0, maxzoom: 19 },
    ],
  };
}

const BASEMAP_STYLES: Record<Basemap, ReturnType<typeof makeRasterStyle>> = {
  osm: makeRasterStyle(
    'osm',
    ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  ),
  satellite: makeRasterStyle(
    'satellite',
    ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    '&copy; Esri',
  ),
  terrain: makeRasterStyle(
    'terrain',
    ['https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png'],
    '&copy; Stamen / Stadia Maps',
  ),
  dark: makeRasterStyle(
    'dark',
    ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
    '&copy; CARTO',
  ),
};

const BASEMAP_META: { key: Basemap; label: string; Icon: typeof MapIcon }[] = [
  { key: 'osm', label: 'Streets', Icon: MapIcon },
  { key: 'satellite', label: 'Satellite', Icon: Satellite },
  { key: 'terrain', label: 'Terrain', Icon: Mountain },
  { key: 'dark', label: 'Dark', Icon: Moon },
];

/* ------------------------------------------------------------------ */
/*  GeoJSON helpers                                                    */
/* ------------------------------------------------------------------ */

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

function bboxToFeature(b: BBox): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [b.west, b.south],
          [b.east, b.south],
          [b.east, b.north],
          [b.west, b.north],
          [b.west, b.south],
        ],
      ],
    },
  };
}

function toFC(f: GeoJSON.Feature | null): GeoJSON.FeatureCollection {
  return f ? { type: 'FeatureCollection', features: [f] } : EMPTY_FC;
}

/* ------------------------------------------------------------------ */
/*  Coordinate formatting                                              */
/* ------------------------------------------------------------------ */

function fmtDMS(val: number, pos: string, neg: string): string {
  const abs = Math.abs(val);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = ((abs - d - m / 60) * 3600).toFixed(1);
  return `${d}°${String(m).padStart(2, '0')}′${String(s).padStart(4, '0')}″${val >= 0 ? pos : neg}`;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Minimum drawn area (deg²) to count as a valid selection. */
const MIN_AREA = 0.00001;

/* ------------------------------------------------------------------ */
/*  WorldMap                                                           */
/* ------------------------------------------------------------------ */

export default function WorldMap() {
  /* ---- Zustand selectors ---- */
  const center = useMapStore((s) => s.center);
  const zoom = useMapStore((s) => s.zoom);
  const selectedRegion = useMapStore((s) => s.selectedRegion);
  const selectionMode = useMapStore((s) => s.selectionMode);
  const basemap = useMapStore((s) => s.basemap);
  const cursorCoord = useMapStore((s) => s.cursorCoord);

  const setCenter = useMapStore((s) => s.setCenter);
  const setZoom = useMapStore((s) => s.setZoom);
  const setSelectedRegion = useMapStore((s) => s.setSelectedRegion);
  const setSelectionMode = useMapStore((s) => s.setSelectionMode);
  const setBasemap = useMapStore((s) => s.setBasemap);
  const set3DActive = useMapStore((s) => s.set3DActive);
  const setCursorCoord = useMapStore((s) => s.setCursorCoord);

  /* ---- Local drawing state ---- */
  const mapRef = useRef<MapRef>(null);
  const [drawStart, setDrawStart] = useState<{
    lng: number;
    lat: number;
  } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{
    lng: number;
    lat: number;
  } | null>(null);

  /* ---- Overlay GeoJSON (stable unless deps change) ---- */
  const drawingFC = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!drawStart || !drawCurrent) return EMPTY_FC;
    return toFC(
      bboxToFeature({
        west: Math.min(drawStart.lng, drawCurrent.lng),
        south: Math.min(drawStart.lat, drawCurrent.lat),
        east: Math.max(drawStart.lng, drawCurrent.lng),
        north: Math.max(drawStart.lat, drawCurrent.lat),
      }),
    );
  }, [drawStart, drawCurrent]);

  const selectionFC = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!selectedRegion || drawStart) return EMPTY_FC;
    return toFC(bboxToFeature(selectedRegion));
  }, [selectedRegion, drawStart]);

  /* ---- Map mouse handlers ---- */

  const handleMouseDown = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      if (selectionMode !== 'bbox') return;
      e.preventDefault(); // prevents default map dragging
      setDrawStart({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      setDrawCurrent({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    },
    [selectionMode],
  );

  const handleMouseMove = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      setCursorCoord({ lon: e.lngLat.lng, lat: e.lngLat.lat });
      if (drawStart) {
        setDrawCurrent({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      }
    },
    [drawStart, setCursorCoord],
  );

  /** Finish drawing and persist the bbox. */
  const finishDraw = useCallback(
    (endLng: number, endLat: number) => {
      if (!drawStart) return;
      const bbox: BBox = {
        west: Math.min(drawStart.lng, endLng),
        south: Math.min(drawStart.lat, endLat),
        east: Math.max(drawStart.lng, endLng),
        north: Math.max(drawStart.lat, endLat),
      };
      if ((bbox.east - bbox.west) * (bbox.north - bbox.south) > MIN_AREA) {
        setSelectedRegion(bbox);
      }
      setDrawStart(null);
      setDrawCurrent(null);
      setSelectionMode(null);
    },
    [drawStart, setSelectedRegion, setSelectionMode],
  );

  const handleMouseUp = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      finishDraw(e.lngLat.lng, e.lngLat.lat);
    },
    [finishDraw],
  );

  const handleMouseLeave = useCallback(() => {
    setCursorCoord(null);
  }, [setCursorCoord]);

  /* ---- Keyboard shortcut: Escape cancels drawing / selection mode ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (drawStart) {
        setDrawStart(null);
        setDrawCurrent(null);
      } else if (selectionMode) {
        setSelectionMode(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawStart, selectionMode, setSelectionMode]);

  /* ---- Safety: global mouseup for when cursor leaves the map while drawing ---- */
  const drawCurrentRef = useRef(drawCurrent);
  drawCurrentRef.current = drawCurrent;

  useEffect(() => {
    if (!drawStart) return;
    const onGlobalUp = () => {
      const cur = drawCurrentRef.current;
      if (cur) finishDraw(cur.lng, cur.lat);
    };
    window.addEventListener('mouseup', onGlobalUp);
    return () => window.removeEventListener('mouseup', onGlobalUp);
  }, [drawStart, finishDraw]);

  /* ---- Cursor ---- */
  const cursor = selectionMode === 'bbox' ? 'crosshair' : 'grab';

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div className="relative w-full h-full">
      {/* ---------- MapLibre GL canvas ---------- */}
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: center[0],
          latitude: center[1],
          zoom,
        }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mapStyle={BASEMAP_STYLES[basemap] as any}
        cursor={cursor}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onMoveEnd={(e) => {
          setCenter([e.viewState.longitude, e.viewState.latitude]);
          setZoom(e.viewState.zoom);
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-left" maxWidth={200} />

        {/* Drawing rectangle — blue dashed */}
        <Source id="drawing-src" type="geojson" data={drawingFC}>
          <Layer
            id="drawing-fill"
            type="fill"
            paint={{ 'fill-color': '#3b82f6', 'fill-opacity': 0.1 }}
          />
          <Layer
            id="drawing-line"
            type="line"
            paint={{
              'line-color': '#3b82f6',
              'line-width': 2,
              'line-dasharray': [4, 4],
            }}
          />
        </Source>

        {/* Selected region — green */}
        <Source id="selection-src" type="geojson" data={selectionFC}>
          <Layer
            id="selection-fill"
            type="fill"
            paint={{ 'fill-color': '#22c55e', 'fill-opacity': 0.15 }}
          />
          <Layer
            id="selection-line"
            type="line"
            paint={{ 'line-color': '#16a34a', 'line-width': 2 }}
          />
        </Source>
      </Map>

      {/* ---------- Floating UI ---------- */}

      {/* Selection tools — top left */}
      <div className="absolute top-3 left-3 flex flex-col gap-1 rounded-lg bg-white/90 p-1 shadow-lg backdrop-blur-md dark:bg-zinc-900/90">
        <ToolBtn
          Icon={MousePointer2}
          label="Pan"
          active={selectionMode === null}
          onClick={() => setSelectionMode(null)}
        />
        <ToolBtn
          Icon={Square}
          label="Select region (bbox)"
          active={selectionMode === 'bbox'}
          onClick={() =>
            setSelectionMode(selectionMode === 'bbox' ? null : 'bbox')
          }
        />
      </div>

      {/* Basemap switcher — top right, below nav control */}
      <div className="absolute right-3 top-28 flex flex-col gap-1 rounded-lg bg-white/90 p-1 shadow-lg backdrop-blur-md dark:bg-zinc-900/90">
        {BASEMAP_META.map(({ key, label, Icon }) => (
          <ToolBtn
            key={key}
            Icon={Icon}
            label={label}
            active={basemap === key}
            onClick={() => setBasemap(key)}
          />
        ))}
      </div>

      {/* Coordinate display — bottom left, above scale control */}
      {cursorCoord && (
        <div className="pointer-events-none absolute bottom-10 left-3 flex select-none items-center gap-2 rounded-lg bg-white/90 px-3 py-2 font-mono text-xs tabular-nums shadow-lg backdrop-blur-md dark:bg-zinc-900/90">
          <Crosshair size={14} className="shrink-0 text-zinc-500" />
          <span className="text-zinc-700 dark:text-zinc-300">
            {cursorCoord.lat.toFixed(5)}°, {cursorCoord.lon.toFixed(5)}°
          </span>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            {fmtDMS(cursorCoord.lat, 'N', 'S')},{' '}
            {fmtDMS(cursorCoord.lon, 'E', 'W')}
          </span>
        </div>
      )}

      {/* Launch 3D + Clear selection — bottom right */}
      {selectedRegion && (
        <div className="absolute bottom-6 right-3 flex items-center gap-2">
          <button
            onClick={() => {
              setSelectedRegion(null);
              setSelectionMode(null);
            }}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/90 px-3 py-2.5 text-sm font-medium text-zinc-600 shadow-lg backdrop-blur-md transition-colors hover:bg-zinc-100 dark:bg-zinc-800/90 dark:text-zinc-300 dark:hover:bg-zinc-700"
            title="Clear selection"
          >
            <X size={16} />
          </button>
          <button
            onClick={() => set3DActive(true)}
            className="flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-blue-700"
          >
            <Box size={16} />
            Launch 3D Viewer
          </button>
        </div>
      )}

      {/* Drawing-mode hint banner */}
      {selectionMode === 'bbox' && !drawStart && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 select-none rounded-full bg-blue-600/90 px-4 py-1.5 text-sm font-medium text-white shadow-lg backdrop-blur-md">
          Click &amp; drag to select a region · <kbd className="font-mono text-xs opacity-80">Esc</kbd> to cancel
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reusable icon button                                               */
/* ------------------------------------------------------------------ */

function ToolBtn({
  Icon,
  label,
  active,
  onClick,
}: {
  Icon: React.ComponentType<{ size?: number }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-md transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-700'
      }`}
    >
      <Icon size={16} />
    </button>
  );
}
