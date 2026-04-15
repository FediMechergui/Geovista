"use client";

import { Globe2 } from "lucide-react";

/* ================================================================== */
/*  Attribution footer                                                 */
/* ================================================================== */

export default function Attribution() {
  return (
    <footer className="flex shrink-0 items-center justify-between border-t border-zinc-800 bg-zinc-900/80 px-3 py-1 text-[10px] text-zinc-600 backdrop-blur md:px-4">
      {/* Left: branding */}
      <div className="flex items-center gap-1.5">
        <Globe2 size={10} className="text-blue-500" />
        <span className="font-semibold text-zinc-500">GeoVista</span>
      </div>

      {/* Center: data credits */}
      <div className="hidden gap-1 sm:flex">
        <Credit href="https://www.openstreetmap.org/copyright" label="© OpenStreetMap" />
        <Sep />
        <Credit href="https://www.earthdata.nasa.gov/sensors/srtm" label="SRTM/NASA" />
        <Sep />
        <Credit href="https://macrostrat.org" label="Macrostrat" />
        <Sep />
        <Credit href="https://www.gebco.net" label="GEBCO" />
      </div>

      {/* Mobile: short version */}
      <div className="flex sm:hidden">
        <span>© OSM · NASA · Macrostrat · GEBCO</span>
      </div>

      {/* Right: version */}
      <span className="text-zinc-700">v1.0.0</span>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function Credit({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-zinc-500 transition-colors hover:text-zinc-300"
    >
      {label}
    </a>
  );
}

function Sep() {
  return <span className="text-zinc-700">·</span>;
}
