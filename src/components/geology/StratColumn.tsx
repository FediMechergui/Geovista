"use client";

import { useState, useCallback, useMemo } from "react";
import type { GeologicalUnit } from "@/types/geology";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface StratColumnProps {
  /** Geological units ordered top (youngest) to bottom (oldest) */
  units: GeologicalUnit[];
  /** CSS class */
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Minimum visual height per unit so thin layers stay visible */
const MIN_UNIT_PX = 18;

/** Lithology pattern hatching — maps common lith keywords to SVG pattern ids */
const LITH_PATTERNS: Record<string, string> = {
  sandstone: "pat-dots",
  limestone: "pat-bricks",
  shale: "pat-dashes",
  granite: "pat-crosses",
  basalt: "pat-diag",
};

function matchPatternId(lith: string): string | null {
  const lower = lith.toLowerCase();
  for (const [key, id] of Object.entries(LITH_PATTERNS)) {
    if (lower.includes(key)) return id;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function StratColumn({ units, className = "" }: StratColumnProps) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Cumulative layout: each unit's top offset and visual thickness.
  const layout = useMemo(() => {
    const rows: { unit: GeologicalUnit; y: number; h: number; patId: string | null }[] = [];
    let total = 0;
    for (const u of units) {
      const h = Math.max(u.thickness, 0.1);
      rows.push({ unit: u, y: total, h, patId: matchPatternId(u.lith) });
      total += h;
    }
    return { rows, total: Math.max(total, 0.1) };
  }, [units]);

  const handleHover = useCallback((id: number | null) => setHoveredId(id), []);
  const handleClick = useCallback(
    (id: number) => setSelectedId((prev) => (prev === id ? null : id)),
    [],
  );

  if (units.length === 0) {
    return (
      <div className={`flex items-center justify-center text-xs text-zinc-500 ${className}`}>
        No stratigraphic data available.
      </div>
    );
  }

  const totalPx = Math.max(units.length * MIN_UNIT_PX, 200);

  return (
    <div className={`flex gap-3 overflow-auto ${className}`}>
      {/* ---- SVG column ---- */}
      <svg
        className="shrink-0"
        width={120}
        height={totalPx}
        viewBox={`0 0 120 ${layout.total}`}
        preserveAspectRatio="none"
      >
        <defs>
          <pattern id="pat-dots" width="6" height="6" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="0.8" fill="rgba(0,0,0,0.25)" />
          </pattern>
          <pattern id="pat-bricks" width="10" height="6" patternUnits="userSpaceOnUse">
            <rect width="10" height="6" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="0.5" />
            <line x1="5" y1="0" x2="5" y2="3" stroke="rgba(0,0,0,0.2)" strokeWidth="0.5" />
          </pattern>
          <pattern id="pat-dashes" width="8" height="4" patternUnits="userSpaceOnUse">
            <line x1="0" y1="2" x2="6" y2="2" stroke="rgba(0,0,0,0.25)" strokeWidth="0.7" />
          </pattern>
          <pattern id="pat-crosses" width="6" height="6" patternUnits="userSpaceOnUse">
            <line x1="0" y1="3" x2="6" y2="3" stroke="rgba(0,0,0,0.2)" strokeWidth="0.5" />
            <line x1="3" y1="0" x2="3" y2="6" stroke="rgba(0,0,0,0.2)" strokeWidth="0.5" />
          </pattern>
          <pattern id="pat-diag" width="6" height="6" patternUnits="userSpaceOnUse">
            <line x1="0" y1="6" x2="6" y2="0" stroke="rgba(0,0,0,0.25)" strokeWidth="0.7" />
          </pattern>
        </defs>

        {layout.rows.map(({ unit: u, y, h, patId }) => {
          const isHovered = hoveredId === u.unit_id;
          const isSelected = selectedId === u.unit_id;
          return (
            <g
              key={u.unit_id}
              onMouseEnter={() => handleHover(u.unit_id)}
              onMouseLeave={() => handleHover(null)}
              onClick={() => handleClick(u.unit_id)}
              className="cursor-pointer"
            >
              <rect
                x={10}
                y={y}
                width={100}
                height={h}
                fill={u.color || "#888"}
                stroke={isSelected ? "#fff" : isHovered ? "#aaa" : "#333"}
                strokeWidth={isSelected ? 1.5 : 0.5}
                opacity={isHovered ? 1 : 0.9}
              />
              {patId && <rect x={10} y={y} width={100} height={h} fill={`url(#${patId})`} />}
            </g>
          );
        })}
      </svg>

      {/* ---- Side labels / details ---- */}
      <div className="flex min-w-35 flex-col text-[10px] text-zinc-400">
        {layout.rows.map(({ unit: u, h }) => {
          const pxH = Math.max((h / layout.total) * totalPx, MIN_UNIT_PX);
          const isSelected = selectedId === u.unit_id;
          const isHovered = hoveredId === u.unit_id;
          return (
            <div
              key={u.unit_id}
              className={`overflow-hidden border-b border-zinc-800 px-1 transition-colors ${
                isSelected
                  ? "bg-zinc-800 text-zinc-100"
                  : isHovered
                    ? "bg-zinc-800/50 text-zinc-300"
                    : ""
              }`}
              style={{ height: pxH, minHeight: MIN_UNIT_PX }}
              onMouseEnter={() => handleHover(u.unit_id)}
              onMouseLeave={() => handleHover(null)}
              onClick={() => handleClick(u.unit_id)}
            >
              <span className="block truncate font-semibold leading-tight">{u.strat_name}</span>
              <span className="block truncate leading-tight text-zinc-500">
                {u.age_top}–{u.age_bottom} Ma · {u.lith}
              </span>
              {isSelected && u.description && (
                <span className="mt-0.5 block text-[9px] leading-tight text-zinc-400">
                  {u.description}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
