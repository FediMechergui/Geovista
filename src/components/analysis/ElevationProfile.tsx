"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { geodesicDistance } from "@/lib/analysis/coordTransform";
import { HYPSOMETRIC_STOPS } from "@/lib/constants";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ProfilePoint {
  lon: number;
  lat: number;
  elevation: number;
}

interface ElevationProfileProps {
  /** Ordered array of sample points along the line */
  points: ProfilePoint[];
  /** Optional CSS class on the root container */
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Build cumulative distance + elevation rows for Recharts. */
function buildChartData(pts: ProfilePoint[]) {
  let cumDist = 0;
  return pts.map((pt, i) => {
    if (i > 0) {
      cumDist += geodesicDistance(
        pts[i - 1].lat,
        pts[i - 1].lon,
        pt.lat,
        pt.lon,
      );
    }
    return { distance: Math.round(cumDist), elevation: pt.elevation };
  });
}

/** Convert HYPSOMETRIC_STOPS into a `<linearGradient>` stop list. */
function buildGradientStops(minElev: number, maxElev: number) {
  const range = maxElev - minElev || 1;
  return HYPSOMETRIC_STOPS.filter(
    (s) => s.elev >= minElev - 500 && s.elev <= maxElev + 500,
  ).map((s) => ({
    offset: `${Math.max(0, Math.min(100, ((s.elev - minElev) / range) * 100))}%`,
    color: s.color,
  }));
}

/* ------------------------------------------------------------------ */
/*  Stat helpers                                                       */
/* ------------------------------------------------------------------ */

function computeStats(data: { elevation: number }[]) {
  const elevs = data.map((d) => d.elevation);
  const min = Math.min(...elevs);
  const max = Math.max(...elevs);
  const avg = elevs.reduce((a, b) => a + b, 0) / elevs.length;
  return { min, max, avg };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ElevationProfile({
  points,
  className = "",
}: ElevationProfileProps) {
  const chartData = useMemo(() => buildChartData(points), [points]);

  const stats = useMemo(() => computeStats(chartData), [chartData]);

  const gradientStops = useMemo(
    () => buildGradientStops(stats.min, stats.max),
    [stats.min, stats.max],
  );

  if (points.length < 2) {
    return (
      <div className={`flex items-center justify-center text-zinc-500 text-xs ${className}`}>
        Draw a line on the map to see an elevation profile.
      </div>
    );
  }

  const totalDist = chartData[chartData.length - 1].distance;

  return (
    <div className={`flex flex-col gap-2 p-2 ${className}`}>
      {/* ---- Stats row ---- */}
      <div className="flex items-center gap-4 text-[11px] text-zinc-400">
        <span>
          Distance: <b className="text-zinc-200">{formatDist(totalDist)}</b>
        </span>
        <span>
          Min: <b className="text-blue-400">{stats.min.toFixed(1)} m</b>
        </span>
        <span>
          Max: <b className="text-red-400">{stats.max.toFixed(1)} m</b>
        </span>
        <span>
          Avg: <b className="text-yellow-400">{stats.avg.toFixed(1)} m</b>
        </span>
      </div>

      {/* ---- Chart ---- */}
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
          <defs>
            <linearGradient id="hypsoGrad" x1="0" y1="1" x2="0" y2="0">
              {gradientStops.map((s, i) => (
                <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={0.8} />
              ))}
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#333" />

          <XAxis
            dataKey="distance"
            tickFormatter={(v) => formatDist(Number(v))}
            tick={{ fontSize: 10, fill: "#888" }}
            stroke="#555"
            label={{ value: "Distance", position: "insideBottom", offset: -2, fontSize: 10, fill: "#888" }}
          />

          <YAxis
            tickFormatter={(v) => `${Number(v).toFixed(0)} m`}
            tick={{ fontSize: 10, fill: "#888" }}
            stroke="#555"
            domain={["auto", "auto"]}
          />

          <Tooltip
            contentStyle={{ background: "#1e1e1e", border: "1px solid #444", fontSize: 11 }}
            labelFormatter={(v) => `${formatDist(Number(v))}`}
            formatter={(v) => [`${Number(v).toFixed(1)} m`, "Elevation"]}
          />

          {/* Average reference line */}
          <ReferenceLine
            y={stats.avg}
            stroke="#facc15"
            strokeDasharray="4 4"
            strokeWidth={1}
          />

          <Area
            type="monotone"
            dataKey="elevation"
            stroke="#60a5fa"
            fill="url(#hypsoGrad)"
            fillOpacity={1}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Formatting utils                                                   */
/* ------------------------------------------------------------------ */

function formatDist(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}
