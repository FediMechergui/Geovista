'use client';

import { useState, useCallback } from 'react';
import { useMapStore } from '@/store/mapStore';
import type { Basemap, LayerVisibility, TerrainTexture } from '@/types/geo';
import {
  exportScreenshotPNG,
  exportRegionGeoJSON,
  exportElevationCSV,
  exportCongestionGeoJSON,
  exportProspectivityCSV,
} from '@/lib/exportUtils';
import StratColumn from '@/components/geology/StratColumn';
import ProspectPanel from '@/components/geology/ProspectPanel';
import TrafficPanel from '@/components/traffic/TrafficPanel';
import { activeTrafficSession } from '@/lib/traffic/trafficService';
import {
  Square,
  MousePointer2,
  Building2,
  Layers,
  Waves,
  ChevronDown,
  SlidersHorizontal,
  ArrowDownToLine,
  Image,
  FileJson,
  FileSpreadsheet,
  MapPin,
  Globe2,
  Mountain,
  Route,
  TrafficCone,
  Droplets,
  X,
} from 'lucide-react';

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
        <ChevronDown size={14} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Option tables                                                      */
/* ------------------------------------------------------------------ */

const LAYER_META: { key: keyof LayerVisibility; label: string; hint: string; Icon: typeof Building2 }[] = [
  { key: 'buildings', label: 'Buildings', hint: 'OSM footprints with material-accurate facades (terrain) / Cesium OSM Buildings (globe)', Icon: Building2 },
  { key: 'roads', label: 'Roads', hint: 'OSM drivable road network, drawn to its real lane count', Icon: Route },
  { key: 'traffic', label: 'Traffic', hint: 'Vehicle microsimulation driving on the road network', Icon: TrafficCone },
  { key: 'geology', label: 'Geology', hint: 'Macrostrat subsurface column (terrain view)', Icon: Layers },
  { key: 'prospect', label: 'Subsurface targets', hint: 'Scored aquifer / hydrocarbon intervals in the geology stack', Icon: Droplets },
  { key: 'water', label: 'Sea level', hint: 'Water plane at 0 m (terrain view)', Icon: Waves },
];

const BASEMAP_OPTIONS: { key: Basemap; label: string }[] = [
  { key: 'osm', label: 'OpenStreetMap' },
  { key: 'satellite', label: 'Satellite' },
  { key: 'terrain', label: 'Terrain' },
  { key: 'dark', label: 'Dark' },
];

const TEXTURE_OPTIONS: { key: TerrainTexture; label: string }[] = [
  { key: 'satellite', label: 'Satellite imagery' },
  { key: 'landuse', label: 'OSM land use' },
  { key: 'hypsometric', label: 'Elevation tint' },
];

function fmtKm2(v: number): string {
  return v >= 100 ? `${v.toFixed(0)} km²` : v >= 1 ? `${v.toFixed(1)} km²` : `${(v * 100).toFixed(0)} ha`;
}

/* ================================================================== */
/*  Sidebar                                                            */
/* ================================================================== */

export default function Sidebar({ collapsed }: { collapsed: boolean }) {
  const selectionMode = useMapStore((s) => s.selectionMode);
  const basemap = useMapStore((s) => s.basemap);
  const layers = useMapStore((s) => s.layers);
  const verticalExaggeration = useMapStore((s) => s.verticalExaggeration);
  const underground = useMapStore((s) => s.underground);
  const selectedRegion = useMapStore((s) => s.selectedRegion);
  const viewerMode = useMapStore((s) => s.viewerMode);
  const terrainTexture = useMapStore((s) => s.terrainTexture);
  const placeInfo = useMapStore((s) => s.placeInfo);
  const regionStats = useMapStore((s) => s.regionStats);
  const geologyColumn = useMapStore((s) => s.geologyColumn);
  const elevationGrid = useMapStore((s) => s.elevationGrid);
  const materialBreakdown = useMapStore((s) => s.materialBreakdown);
  const prospectReport = useMapStore((s) => s.prospectReport);

  const setSelectionMode = useMapStore((s) => s.setSelectionMode);
  const setSelectedRegion = useMapStore((s) => s.setSelectedRegion);
  const setBasemap = useMapStore((s) => s.setBasemap);
  const toggleLayer = useMapStore((s) => s.toggleLayer);
  const setVerticalExaggeration = useMapStore((s) => s.setVerticalExaggeration);
  const setUnderground = useMapStore((s) => s.setUnderground);
  const setViewerMode = useMapStore((s) => s.setViewerMode);
  const set3DActive = useMapStore((s) => s.set3DActive);
  const setTerrainTexture = useMapStore((s) => s.setTerrainTexture);

  const handleExportPNG = useCallback(() => exportScreenshotPNG(), []);
  const handleExportCSV = useCallback(() => {
    const grid = useMapStore.getState().elevationGrid;
    if (grid) exportElevationCSV(grid);
  }, []);
  const handleExportGeoJSON = useCallback(() => {
    const region = useMapStore.getState().selectedRegion;
    if (region) exportRegionGeoJSON(region);
  }, []);
  const handleExportCongestion = useCallback(() => {
    const active = activeTrafficSession();
    if (active) exportCongestionGeoJSON(active.graph, active.simulation.edgeStats());
  }, []);
  const handleExportProspect = useCallback(() => {
    const report = useMapStore.getState().prospectReport;
    if (report) exportProspectivityCSV(report);
  }, []);

  if (collapsed) return null;

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col overflow-y-auto border-r border-zinc-800 bg-zinc-900">
      {/* ---- Selected place ---- */}
      <Section title="Selected place">
        {selectedRegion ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <MapPin size={14} className="mt-0.5 shrink-0 text-blue-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-zinc-100">
                  {placeInfo?.name ?? 'Locating…'}
                </div>
                <div className="line-clamp-2 text-[11px] leading-snug text-zinc-500">
                  {placeInfo?.displayName ?? ''}
                </div>
              </div>
              <button
                onClick={() => {
                  setSelectedRegion(null);
                  setSelectionMode(null);
                }}
                className="cursor-pointer rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                title="Clear selection"
              >
                <X size={14} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-zinc-800/70 px-2.5 py-2 text-[11px]">
              <Stat label="Area" value={regionStats ? fmtKm2(regionStats.areaKm2) : '—'} />
              <Stat label="DEM" value={regionStats ? `${regionStats.demResolutionM.toFixed(0)} m/px` : '—'} />
              <Stat label="Min elev" value={regionStats ? `${regionStats.minElev.toFixed(0)} m` : '—'} />
              <Stat label="Max elev" value={regionStats ? `${regionStats.maxElev.toFixed(0)} m` : '—'} />
              <Stat label="Mean elev" value={regionStats ? `${regionStats.meanElev.toFixed(0)} m` : '—'} />
              <Stat
                label="Buildings"
                value={regionStats && layers.buildings ? regionStats.buildingCount.toLocaleString() : '—'}
              />
              <Stat
                label="Roads"
                value={
                  regionStats && layers.roads && regionStats.roadLengthKm > 0
                    ? `${regionStats.roadLengthKm.toFixed(1)} km`
                    : '—'
                }
              />
            </div>

            <div className="rounded-md bg-zinc-800/70 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-zinc-500">
              W {selectedRegion.west.toFixed(4)}° &nbsp; E {selectedRegion.east.toFixed(4)}°
              <br />S {selectedRegion.south.toFixed(4)}° &nbsp; N {selectedRegion.north.toFixed(4)}°
            </div>

            {!regionStats && viewerMode === 'globe' && (
              <p className="text-[10px] leading-snug text-zinc-600">
                Elevation statistics are computed when the Terrain view loads this region.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-zinc-500">
              Search a place in the toolbar, or draw a box on the map.
            </p>
            <div className="flex gap-1.5">
              <SelectionBtn Icon={MousePointer2} label="Pan" active={selectionMode === null} onClick={() => setSelectionMode(null)} />
              <SelectionBtn
                Icon={Square}
                label="Draw box"
                active={selectionMode === 'bbox'}
                onClick={() => setSelectionMode(selectionMode === 'bbox' ? null : 'bbox')}
              />
            </div>
          </div>
        )}
      </Section>

      {/* ---- 3D view ---- */}
      <Section title="3D view">
        <div className="mb-3 flex rounded-lg bg-zinc-800 p-0.5">
          <ModeBtn
            Icon={Globe2}
            label="Globe"
            active={viewerMode === 'globe'}
            onClick={() => {
              setViewerMode('globe');
              set3DActive(true);
            }}
          />
          <ModeBtn
            Icon={Mountain}
            label="Terrain"
            active={viewerMode === 'terrain'}
            disabled={!selectedRegion}
            onClick={() => {
              if (!selectedRegion) return;
              setViewerMode('terrain');
              set3DActive(true);
            }}
          />
        </div>

        {viewerMode === 'terrain' && (
          <label className="mb-3 flex flex-col gap-1 text-xs text-zinc-400">
            Surface
            <select
              value={terrainTexture}
              onChange={(e) => setTerrainTexture(e.target.value as TerrainTexture)}
              className="w-full cursor-pointer rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-300 outline-none focus:border-blue-500"
            >
              {TEXTURE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1.5 text-xs text-zinc-400">
          <span className="flex items-center gap-1.5">
            <SlidersHorizontal size={12} />
            Vertical exaggeration
            <span className="ml-auto tabular-nums text-zinc-200">{verticalExaggeration.toFixed(1)}×</span>
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

        <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={underground}
            onChange={(e) => setUnderground(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer accent-blue-500"
          />
          <ArrowDownToLine size={14} className="text-zinc-500" />
          Underground camera
        </label>
      </Section>

      {/* ---- Layers ---- */}
      <Section title="Layers">
        <div className="flex flex-col gap-1">
          {LAYER_META.map(({ key, label, hint, Icon }) => (
            <label
              key={key}
              title={hint}
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

      {/* ---- Traffic ---- */}
      <Section title="Traffic simulation" defaultOpen={false}>
        <TrafficPanel />
      </Section>

      {/* ---- Building materials ---- */}
      <Section title="Building materials" defaultOpen={false}>
        {materialBreakdown && materialBreakdown.total > 0 ? (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-zinc-800/70 px-2.5 py-2 text-[11px]">
              <Stat label="Buildings" value={materialBreakdown.total.toLocaleString()} />
              <Stat
                label="OSM-tagged"
                value={`${((materialBreakdown.tagged / materialBreakdown.total) * 100).toFixed(0)} %`}
              />
              <Stat
                label="Mean confidence"
                value={`${(materialBreakdown.meanConfidence * 100).toFixed(0)} %`}
              />
            </div>

            <ul className="flex flex-col gap-1">
              {materialBreakdown.byMaterial.slice(0, 8).map((m) => (
                <li key={m.key} className="flex items-center gap-2 text-[11px]">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-zinc-700"
                    style={{ background: m.color }}
                  />
                  <span className="flex-1 truncate text-zinc-300">{m.label}</span>
                  <span className="tabular-nums text-zinc-500">{m.count.toLocaleString()}</span>
                </li>
              ))}
            </ul>

            <p className="text-[10px] leading-snug text-zinc-600">
              Materials come from <code>building:material</code> and its relatives where OSM has
              them; the rest are inferred from building use, age and height, and counted at lower
              confidence.
            </p>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">
            {layers.buildings
              ? 'Open the Terrain view to resolve building materials for this region.'
              : 'Enable the Buildings layer and open the Terrain view.'}
          </p>
        )}
      </Section>

      {/* ---- Subsurface targets ---- */}
      <Section title="Subsurface targets" defaultOpen={false}>
        <ProspectPanel />
      </Section>

      {/* ---- Geology ---- */}
      <Section title="Geology" defaultOpen={false}>
        {geologyColumn ? (
          <div className="flex flex-col gap-2">
            <div className="text-[11px] text-zinc-400">
              <span className="font-semibold text-zinc-200">{geologyColumn.name}</span>
              <span className="text-zinc-600"> · Macrostrat column {geologyColumn.col_id}</span>
            </div>
            <StratColumn units={geologyColumn.units} className="max-h-72" />
          </div>
        ) : (
          <p className="text-xs text-zinc-500">
            {layers.geology
              ? 'Open the Terrain view to load the stratigraphic column for this region.'
              : 'Enable the Geology layer and open the Terrain view to see the stratigraphic column.'}
          </p>
        )}
      </Section>

      {/* ---- Basemap ---- */}
      <Section title="2D basemap" defaultOpen={false}>
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

      {/* ---- Export ---- */}
      <Section title="Export" defaultOpen={false}>
        <div className="flex flex-col gap-1">
          <ExportBtn Icon={Image} label="Screenshot (PNG)" onClick={handleExportPNG} />
          <ExportBtn
            Icon={FileSpreadsheet}
            label={elevationGrid ? 'Elevation grid (CSV)' : 'Elevation grid (CSV) — load terrain first'}
            disabled={!elevationGrid}
            onClick={handleExportCSV}
          />
          <ExportBtn Icon={FileJson} label="Region (GeoJSON)" disabled={!selectedRegion} onClick={handleExportGeoJSON} />
          <ExportBtn
            Icon={TrafficCone}
            label={
              layers.traffic
                ? 'Congestion by link (GeoJSON)'
                : 'Congestion by link (GeoJSON) — run traffic first'
            }
            disabled={!layers.traffic}
            onClick={handleExportCongestion}
          />
          <ExportBtn
            Icon={Droplets}
            label={
              prospectReport
                ? 'Subsurface screening (CSV)'
                : 'Subsurface screening (CSV) — load geology first'
            }
            disabled={!prospectReport}
            onClick={handleExportProspect}
          />
        </div>
      </Section>

      <div className="mt-auto border-t border-zinc-800 px-4 py-3 text-[10px] leading-relaxed text-zinc-600">
        Data: © OpenStreetMap · Esri World Imagery · AWS Terrain Tiles · Macrostrat · Google · Cesium
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right tabular-nums text-zinc-200">{value}</span>
    </div>
  );
}

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
        active ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

function ModeBtn({
  Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  Icon: React.ComponentType<{ size?: number }>;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : disabled
            ? 'cursor-not-allowed text-zinc-600'
            : 'cursor-pointer text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function ExportBtn({
  Icon,
  label,
  disabled,
  onClick,
}: {
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
        disabled ? 'cursor-not-allowed text-zinc-600' : 'cursor-pointer text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
      }`}
      title={label}
    >
      <Icon size={14} className="shrink-0" />
      {label}
    </button>
  );
}
