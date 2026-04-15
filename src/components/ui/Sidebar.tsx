'use client';

import { useMapStore } from '@/store/mapStore';
import type { Basemap, LayerVisibility } from '@/types/geo';
import {
  exportScreenshotPNG,
  exportRegionGeoJSON,
} from '@/lib/exportUtils';
import {
  Square,
  MousePointer2,
  Mountain,
  Building2,
  Layers,
  Waves,
  Satellite,
  Grid3x3,
  ChevronDown,
  SlidersHorizontal,
  ArrowDownToLine,
  Crosshair,
  Image,
  FileJson,
  FileSpreadsheet,
} from 'lucide-react';
import { useState, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Section wrapper                                                    */
/* ------------------------------------------------------------------ */

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-800">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-200"
      >
        {title}
        <ChevronDown
          size={14}
          className={`transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Layer toggle                                                       */
/* ------------------------------------------------------------------ */

const LAYER_META: {
  key: keyof LayerVisibility;
  label: string;
  Icon: typeof Mountain;
}[] = [
  { key: 'terrain', label: 'Terrain', Icon: Mountain },
  { key: 'buildings', label: 'Buildings', Icon: Building2 },
  { key: 'geology', label: 'Geology', Icon: Layers },
  { key: 'bathymetry', label: 'Bathymetry', Icon: Waves },
  { key: 'satellite', label: 'Satellite', Icon: Satellite },
  { key: 'contours', label: 'Contours', Icon: Grid3x3 },
];

/* ------------------------------------------------------------------ */
/*  Basemap options                                                    */
/* ------------------------------------------------------------------ */

const BASEMAP_OPTIONS: { key: Basemap; label: string }[] = [
  { key: 'osm', label: 'OpenStreetMap' },
  { key: 'satellite', label: 'Satellite' },
  { key: 'terrain', label: 'Terrain' },
  { key: 'dark', label: 'Dark' },
];

/* ------------------------------------------------------------------ */
/*  CRS options                                                        */
/* ------------------------------------------------------------------ */

const CRS_OPTIONS = [
  { value: 'EPSG:4326', label: 'WGS 84 (EPSG:4326)' },
  { value: 'EPSG:3857', label: 'Web Mercator (EPSG:3857)' },
  { value: 'UTM', label: 'UTM (auto-detect zone)' },
];

/* ================================================================== */
/*  Sidebar                                                            */
/* ================================================================== */

export default function Sidebar({ collapsed }: { collapsed: boolean }) {
  const selectionMode = useMapStore((s) => s.selectionMode);
  const basemap = useMapStore((s) => s.basemap);
  const layers = useMapStore((s) => s.layers);
  const verticalExaggeration = useMapStore((s) => s.verticalExaggeration);
  const underground = useMapStore((s) => s.underground);
  const cursorCoord = useMapStore((s) => s.cursorCoord);
  const selectedRegion = useMapStore((s) => s.selectedRegion);

  const setSelectionMode = useMapStore((s) => s.setSelectionMode);
  const setBasemap = useMapStore((s) => s.setBasemap);
  const toggleLayer = useMapStore((s) => s.toggleLayer);
  const setVerticalExaggeration = useMapStore((s) => s.setVerticalExaggeration);
  const setUnderground = useMapStore((s) => s.setUnderground);

  const [crs, setCrs] = useState('EPSG:4326');

  const handleExportPNG = useCallback(() => exportScreenshotPNG(), []);
  const handleExportCSV = useCallback(() => {
    // CSV requires an ElevationGrid — placeholder until wired from TerrainViewer
    console.info('[export] Elevation CSV: wire an ElevationGrid from the 3D viewer.');
  }, []);
  const handleExportGeoJSON = useCallback(() => {
    const region = useMapStore.getState().selectedRegion;
    if (region) exportRegionGeoJSON(region);
  }, []);

  if (collapsed) return null;

  return (
    <aside className="flex h-full w-70 shrink-0 flex-col overflow-y-auto border-r border-zinc-800 bg-zinc-900">
      {/* ---- Selection tools ---- */}
      <Section title="Selection Tools">
        <div className="flex gap-1.5">
          <SelectionBtn
            Icon={MousePointer2}
            label="Pan"
            active={selectionMode === null}
            onClick={() => setSelectionMode(null)}
          />
          <SelectionBtn
            Icon={Square}
            label="Bbox"
            active={selectionMode === 'bbox'}
            onClick={() =>
              setSelectionMode(selectionMode === 'bbox' ? null : 'bbox')
            }
          />
        </div>
        {selectedRegion && (
          <div className="mt-2 rounded-md bg-zinc-800 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-zinc-400">
            W {selectedRegion.west.toFixed(4)}° &nbsp; E{' '}
            {selectedRegion.east.toFixed(4)}°
            <br />S {selectedRegion.south.toFixed(4)}° &nbsp; N{' '}
            {selectedRegion.north.toFixed(4)}°
          </div>
        )}
      </Section>

      {/* ---- Layers ---- */}
      <Section title="Layers">
        <div className="flex flex-col gap-1">
          {LAYER_META.map(({ key, label, Icon }) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-zinc-800"
            >
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={() => toggleLayer(key)}
                className="h-3.5 w-3.5 cursor-pointer accent-blue-500"
              />
              <Icon size={14} className="text-zinc-500" />
              <span className="text-zinc-300">{label}</span>
            </label>
          ))}
        </div>
      </Section>

      {/* ---- Basemap ---- */}
      <Section title="Basemap">
        <select
          value={basemap}
          onChange={(e) => setBasemap(e.target.value as Basemap)}
          title="Select basemap"
          className="w-full cursor-pointer rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-300 outline-none focus:border-blue-500"
        >
          {BASEMAP_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </Section>

      {/* ---- 3D Settings ---- */}
      <Section title="3D Settings">
        {/* Vertical exaggeration */}
        <label className="flex flex-col gap-1.5 text-xs text-zinc-400">
          <span className="flex items-center gap-1.5">
            <SlidersHorizontal size={12} />
            Vertical Exaggeration
            <span className="ml-auto tabular-nums text-zinc-200">
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
            className="h-1.5 w-full cursor-pointer accent-blue-500"
          />
        </label>

        {/* Underground */}
        <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={underground}
            onChange={(e) => setUnderground(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer accent-blue-500"
          />
          <ArrowDownToLine size={14} className="text-zinc-500" />
          Underground mode
        </label>
      </Section>

      {/* ---- CRS ---- */}
      <Section title="Coordinate System" defaultOpen={false}>
        <select
          value={crs}
          onChange={(e) => setCrs(e.target.value)}
          title="Select coordinate reference system"
          className="w-full cursor-pointer rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-300 outline-none focus:border-blue-500"
        >
          {CRS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Section>

      {/* ---- Coordinates ---- */}
      <Section title="Coordinates" defaultOpen={false}>
        {cursorCoord ? (
          <div className="flex items-start gap-2 font-mono text-xs text-zinc-400">
            <Crosshair size={12} className="mt-0.5 shrink-0 text-zinc-500" />
            <div className="leading-relaxed">
              Lat: {cursorCoord.lat.toFixed(6)}°
              <br />
              Lon: {cursorCoord.lon.toFixed(6)}°
            </div>
          </div>
        ) : (
          <p className="text-xs italic text-zinc-600">
            Hover over the map to see coordinates
          </p>
        )}
      </Section>

      {/* ---- Export ---- */}
      <Section title="Export" defaultOpen={false}>
        <div className="flex flex-col gap-1">
          <ExportBtn Icon={Image} label="Screenshot (PNG)" onClick={handleExportPNG} />
          <ExportBtn Icon={FileSpreadsheet} label="Elevation CSV" onClick={handleExportCSV} />
          <ExportBtn Icon={FileJson} label="Region GeoJSON" onClick={handleExportGeoJSON} />
        </div>
      </Section>

      {/* ---- Attribution ---- */}
      <div className="mt-auto border-t border-zinc-800 px-4 py-3 text-[10px] leading-relaxed text-zinc-600">
        Data: © OpenStreetMap · SRTM/NASA · Macrostrat · GEBCO
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function SelectionBtn({
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
      className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

function ExportBtn({
  Icon,
  label,
  onClick,
}: {
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
      title={label}
    >
      <Icon size={14} className="shrink-0" />
      {label}
    </button>
  );
}
