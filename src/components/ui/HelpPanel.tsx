"use client";

import {
  X,
  MousePointer2,
  Square,
  Keyboard,
  Layers,
  Mountain,
  Globe2,
  Download,
  HelpCircle,
  Search,
} from "lucide-react";

export default function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="animate-fade-in absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <HelpCircle size={16} className="text-blue-400" />
            Help &amp; Legend
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <SectionTitle icon={<Search size={14} />} title="Build a digital twin" />
          <ul className="mb-4 space-y-1 text-xs text-zinc-400">
            <li><b className="text-zinc-300">Search</b> — type a place name and press Enter; a region is chosen and the 3D view opens.</li>
            <li><b className="text-zinc-300">Draw</b> — pick the box tool, drag on the map, then “Build digital twin”.</li>
          </ul>

          <SectionTitle icon={<Globe2 size={14} />} title="Globe view" />
          <ul className="mb-4 space-y-1 text-xs text-zinc-400">
            <li><b className="text-zinc-300">Photorealistic</b> — Google 3D Tiles: photogrammetry of real cities and terrain.</li>
            <li><b className="text-zinc-300">Terrain + Buildings</b> — Cesium World Terrain with OSM Buildings; click a building for its OSM attributes.</li>
            <li><b className="text-zinc-300">Navigate</b> — left-drag rotates, right-drag / wheel zooms, middle-drag tilts.</li>
          </ul>

          <SectionTitle icon={<Mountain size={14} />} title="Terrain view" />
          <ul className="mb-4 space-y-1 text-xs text-zinc-400">
            <li><b className="text-zinc-300">Surface</b> — satellite imagery, OSM land use, or elevation tint.</li>
            <li><b className="text-zinc-300">Buildings</b> — OSM footprints extruded and seated on the terrain.</li>
            <li><b className="text-zinc-300">Geology</b> — Macrostrat layers below the surface; enable Underground camera to look beneath.</li>
            <li><b className="text-zinc-300">Measure</b> — ruler tool: click two points for distance and an elevation profile.</li>
          </ul>

          <SectionTitle icon={<Keyboard size={14} />} title="Keyboard shortcuts" />
          <ShortcutTable
            rows={[
              ["Esc", "Exit selection / deselect region"],
              ["Space", "Toggle 2D ↔ 3D"],
              ["1", "2D map"],
              ["2", "3D view"],
              ["G", "Globe ↔ Terrain"],
              ["B", "Cycle 2D basemap"],
              ["?", "Toggle this panel"],
            ]}
          />

          <SectionTitle icon={<Layers size={14} />} title="Layers" />
          <ul className="mb-4 space-y-1 text-xs text-zinc-400">
            <li><b className="text-zinc-300">Buildings</b> — OSM footprints (terrain) / Cesium OSM Buildings (globe)</li>
            <li><b className="text-zinc-300">Geology</b> — Macrostrat stratigraphic column, also shown in the sidebar</li>
            <li><b className="text-zinc-300">Sea level</b> — translucent water plane at 0 m</li>
          </ul>

          <SectionTitle icon={<MousePointer2 size={14} />} title="2D map tools" />
          <ToolRow icon={<MousePointer2 size={12} />} label="Pan" desc="Drag to pan, wheel to zoom." />
          <ToolRow icon={<Square size={12} />} label="Draw box" desc="Drag a rectangle to select a region." />

          <SectionTitle icon={<Download size={14} />} title="Export" />
          <ul className="mb-2 space-y-1 text-xs text-zinc-400">
            <li><b className="text-zinc-300">PNG</b> — screenshot of the current 3D view</li>
            <li><b className="text-zinc-300">CSV</b> — elevation grid (lon, lat, elevation) once terrain has loaded</li>
            <li><b className="text-zinc-300">GeoJSON</b> — selected region polygon</li>
          </ul>
        </div>

        <div className="border-t border-zinc-800 px-5 py-2.5 text-[10px] text-zinc-600">
          Data: © OpenStreetMap · Esri · AWS Terrain Tiles · Macrostrat · Google · Cesium
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-2 mt-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 first:mt-0">
      {icon}
      {title}
    </div>
  );
}

function ShortcutTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
      {rows.map(([key, desc]) => (
        <div key={key} className="contents">
          <span className="kbd">{key}</span>
          <span className="text-zinc-400">{desc}</span>
        </div>
      ))}
    </div>
  );
}

function ToolRow({ icon, label, desc }: { icon: React.ReactNode; label: string; desc: string }) {
  return (
    <div className="mb-1.5 flex items-start gap-2 text-xs">
      <span className="mt-0.5 shrink-0 text-zinc-500">{icon}</span>
      <span>
        <b className="text-zinc-300">{label}</b>{" "}
        <span className="text-zinc-500">— {desc}</span>
      </span>
    </div>
  );
}
