"use client";

import { useCallback, useState } from "react";
import { Copy, Check } from "lucide-react";
import { useMapStore } from "@/store/mapStore";
import {
  transform,
  getUTMEpsg,
  getUTMZone,
} from "@/lib/analysis/coordTransform";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type CRSMode = "wgs84" | "dms" | "utm";

interface CoordDisplayProps {
  /** Optional elevation at cursor in meters */
  elevation?: number | null;
  /** CSS class on root container */
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

function toDMS(decimal: number, isLat: boolean): string {
  const abs = Math.abs(decimal);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(2);
  const dir = isLat ? (decimal >= 0 ? "N" : "S") : decimal >= 0 ? "E" : "W";
  return `${d}°${String(m).padStart(2, "0")}′${String(s).padStart(5, "0")}″${dir}`;
}

function formatWGS84(lon: number, lat: number): string {
  return `${lat.toFixed(6)}°, ${lon.toFixed(6)}°`;
}

function formatDMS(lon: number, lat: number): string {
  return `${toDMS(lat, true)}  ${toDMS(lon, false)}`;
}

function formatUTM(lon: number, lat: number): string {
  const epsg = getUTMEpsg(lon, lat);
  const [easting, northing] = transform("EPSG:4326", epsg, [lon, lat]);
  const zone = getUTMZone(lon);
  const band = lat >= 0 ? "N" : "S";
  return `${zone}${band}  ${easting.toFixed(1)}E  ${northing.toFixed(1)}N`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CoordDisplay({
  elevation = null,
  className = "",
}: CoordDisplayProps) {
  const cursorCoord = useMapStore((s) => s.cursorCoord);
  const [mode, setMode] = useState<CRSMode>("wgs84");
  const [copied, setCopied] = useState(false);

  const formatted = cursorCoord
    ? mode === "wgs84"
      ? formatWGS84(cursorCoord.lon, cursorCoord.lat)
      : mode === "dms"
        ? formatDMS(cursorCoord.lon, cursorCoord.lat)
        : formatUTM(cursorCoord.lon, cursorCoord.lat)
    : "—";

  const handleCopy = useCallback(() => {
    if (!cursorCoord) return;
    navigator.clipboard.writeText(formatted).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [cursorCoord, formatted]);

  const cycleCRS = useCallback(() => {
    setMode((prev) =>
      prev === "wgs84" ? "dms" : prev === "dms" ? "utm" : "wgs84",
    );
  }, []);

  return (
    <div
      className={`flex items-center gap-2 rounded bg-zinc-900/80 px-2 py-1 text-[11px] font-mono text-zinc-300 backdrop-blur ${className}`}
    >
      {/* CRS badge — click to cycle */}
      <button
        onClick={cycleCRS}
        className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-300 hover:bg-zinc-600 transition-colors"
        title="Click to change coordinate format"
      >
        {mode === "wgs84" ? "DD" : mode === "dms" ? "DMS" : "UTM"}
      </button>

      {/* Coordinates */}
      <span className="min-w-50 select-all">{formatted}</span>

      {/* Elevation */}
      {elevation != null && (
        <span className="text-zinc-500">
          Elev:{" "}
          <span className="text-zinc-300">{elevation.toFixed(1)} m</span>
        </span>
      )}

      {/* Copy button */}
      <button
        onClick={handleCopy}
        className="ml-auto rounded p-0.5 text-zinc-500 hover:text-zinc-200 transition-colors"
        title="Copy coordinates to clipboard"
        disabled={!cursorCoord}
      >
        {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
      </button>
    </div>
  );
}
