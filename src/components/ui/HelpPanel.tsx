"use client";

import {
  X,
  MousePointer2,
  Square,
  Keyboard,
  Layers,
  Mountain,
  Box,
  Download,
  HelpCircle,
} from "lucide-react";

/* ================================================================== */
/*  Help / Legend panel                                                 */
/* ================================================================== */

export default function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="animate-fade-in absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Keyboard */}
          <SectionTitle icon={<Keyboard size={14} />} title="Keyboard Shortcuts" />
          <ShortcutTable
            rows={[
              ["Esc", "Exit selection / deselect region"],
              ["Space", "Toggle 2D ↔ 3D view"],
              ["1", "Switch to 2D map"],
              ["2", "Switch to 3D viewer"],
              ["B", "Cycle basemap"],
              ["?", "Toggle this help panel"],
            ]}
          />

          {/* Selection tools */}
          <SectionTitle icon={<MousePointer2 size={14} />} title="Selection Tools" />
          <ToolRow icon={<MousePointer2 size={12} />} label="Pan" desc="Click and drag to pan the map." />
          <ToolRow icon={<Square size={12} />} label="Bbox" desc="Draw a bounding box to select a region for 3D terrain loading." />

          {/* Layers */}
          <SectionTitle icon={<Layers size={14} />} title="Layers" />
          <ul className="mb-4 space-y-1 text-xs text-zinc-400">
            <li><b className="text-zinc-300">Terrain</b> — SRTM elevation with hypsometric coloring</li>
            <li><b className="text-zinc-300">Buildings</b> — OpenStreetMap 3D building footprints</li>
            <li><b className="text-zinc-300">Geology</b> — Macrostrat subsurface geological layers</li>
            <li><b className="text-zinc-300">Bathymetry</b> — Underwater elevation (GEBCO)</li>
            <li><b className="text-zinc-300">Satellite</b> — Satellite imagery overlay</li>
            <li><b className="text-zinc-300">Contours</b> — Elevation contour lines</li>
          </ul>

          {/* 3D Viewer */}
          <SectionTitle icon={<Mountain size={14} />} title="3D Viewer Controls" />
          <ul className="mb-4 space-y-1 text-xs text-zinc-400">
            <li><b className="text-zinc-300">Orbit</b> — Left-click drag</li>
            <li><b className="text-zinc-300">Pan</b> — Right-click drag</li>
            <li><b className="text-zinc-300">Zoom</b> — Scroll wheel</li>
            <li><b className="text-zinc-300">Vertical Exaggeration</b> — Sidebar slider (0.5× – 10×)</li>
            <li><b className="text-zinc-300">Underground</b> — Toggle to see subsurface geology</li>
          </ul>

          {/* Analysis */}
          <SectionTitle icon={<Box size={14} />} title="Analysis Tools" />
          <ul className="mb-4 space-y-1 text-xs text-zinc-400">
            <li><b className="text-zinc-300">Elevation Profile</b> — Draw a line to see terrain cross-section</li>
            <li><b className="text-zinc-300">Coordinate Display</b> — Real-time cursor coords (DD / DMS / UTM)</li>
            <li><b className="text-zinc-300">Cross Section</b> — Interactive geological cross-section</li>
            <li><b className="text-zinc-300">Strat Column</b> — Vertical stratigraphic column</li>
          </ul>

          {/* Export */}
          <SectionTitle icon={<Download size={14} />} title="Export" />
          <ul className="mb-2 space-y-1 text-xs text-zinc-400">
            <li><b className="text-zinc-300">PNG</b> — Screenshot the current 3D view</li>
            <li><b className="text-zinc-300">CSV</b> — Export elevation grid data</li>
            <li><b className="text-zinc-300">GeoJSON</b> — Export selected region polygon</li>
          </ul>
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-5 py-2.5 text-[10px] text-zinc-600">
          Data: © OpenStreetMap · SRTM/NASA · Macrostrat · GEBCO
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

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

function ToolRow({
  icon,
  label,
  desc,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
}) {
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
