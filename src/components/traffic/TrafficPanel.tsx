'use client';

/**
 * Traffic simulation controls and congestion analytics.
 *
 * Rendered twice: `compact` inside the 3D viewer's overlay, and full-size in
 * the sidebar. The compact form keeps the controls and the headline numbers;
 * the full form adds the throughput chart and the hotspot table.
 */

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useMapStore } from '@/store/mapStore';
import { LOS_COLORS, LOS_LABELS, kmh } from '@/lib/traffic/analytics';
import type { LevelOfService } from '@/types/traffic';
import { Car, Gauge, Loader2, Pause, Play, RotateCcw, TrafficCone } from 'lucide-react';

const LOS_ORDER: LevelOfService[] = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Chart surface and ink, matching the panel around it. */
const INK_MUTED = '#71717a';
const GRID = '#3f3f46';
const SERIES = '#38bdf8';

export default function TrafficPanel({ compact = false }: { compact?: boolean }) {
  const layers = useMapStore((s) => s.layers);
  const config = useMapStore((s) => s.trafficConfig);
  const ui = useMapStore((s) => s.trafficUi);
  const stats = useMapStore((s) => s.trafficStats);
  const loading = useMapStore((s) => s.trafficLoading);
  const error = useMapStore((s) => s.trafficError);
  const toggleLayer = useMapStore((s) => s.toggleLayer);
  const setConfig = useMapStore((s) => s.setTrafficConfig);
  const setUi = useMapStore((s) => s.setTrafficUi);

  const series = useMemo(
    () => stats.throughput.map((value, index) => ({ index, value: Math.round(value) })),
    [stats.throughput],
  );

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          <TrafficCone size={11} />
          Traffic
        </span>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400">
          <input
            type="checkbox"
            checked={layers.traffic}
            onChange={() => toggleLayer('traffic')}
            className="h-3 w-3 cursor-pointer accent-blue-500"
          />
          Simulate
        </label>
      </div>

      {loading && (
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <Loader2 size={11} className="animate-spin text-blue-400" />
          Building road network…
        </div>
      )}

      {error && !loading && <p className="text-[11px] leading-snug text-amber-400">{error}</p>}

      {layers.traffic && !error && (
        <>
          {/* ---- Transport controls ---- */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setUi({ running: !ui.running })}
              title={ui.running ? 'Pause the simulation' : 'Run the simulation'}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-zinc-800 text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              {ui.running ? <Pause size={12} /> : <Play size={12} />}
            </button>
            <button
              onClick={() => setConfig({ seed: (config.seed + 1) >>> 0 })}
              title="Reseed — replays a different but reproducible traffic pattern"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-zinc-800 text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              <RotateCcw size={12} />
            </button>
            <div className="ml-auto flex items-center gap-1 text-[11px] tabular-nums text-zinc-400">
              <Gauge size={11} />
              {config.timeScale.toFixed(1)}×
            </div>
          </div>

          <Slider
            label="Speed"
            value={config.timeScale}
            min={0.25}
            max={8}
            step={0.25}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(timeScale) => setConfig({ timeScale })}
          />
          <Slider
            label="Vehicles"
            value={config.targetVehicles}
            min={20}
            max={600}
            step={10}
            format={(v) => v.toFixed(0)}
            onChange={(targetVehicles) => setConfig({ targetVehicles })}
          />
          <Slider
            label="Heavy vehicles"
            value={config.heavyShare}
            min={0}
            max={0.5}
            step={0.01}
            format={(v) => `${(v * 100).toFixed(0)} %`}
            onChange={(heavyShare) => setConfig({ heavyShare })}
          />
          <Slider
            label="Signal cycle"
            value={config.signalCycleS}
            min={20}
            max={150}
            step={5}
            format={(v) => `${v.toFixed(0)} s`}
            onChange={(signalCycleS) => setConfig({ signalCycleS })}
          />

          <div className="flex flex-col gap-1">
            <Checkbox
              label="Colour roads by congestion"
              checked={ui.showCongestion}
              onChange={(showCongestion) => setUi({ showCongestion })}
            />
            <Checkbox
              label="Show traffic signals"
              checked={ui.showSignals}
              onChange={(showSignals) => setUi({ showSignals })}
            />
          </div>

          {/* ---- Headline numbers ---- */}
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 rounded-md bg-zinc-800/70 px-2.5 py-2 text-[11px]">
            <Stat label="On the road" value={stats.vehicles.toLocaleString()} />
            <Stat label="Mean speed" value={kmh(stats.meanSpeed)} />
            <Stat label="Congested" value={`${(stats.congestedShare * 100).toFixed(0)} %`} />
            <Stat label="Mean delay" value={`${stats.meanDelay.toFixed(0)} s`} />
            <Stat label="Trips done" value={stats.completed.toLocaleString()} />
            <Stat label="Sim time" value={`${Math.floor(stats.simTime / 60)}m ${Math.round(stats.simTime % 60)}s`} />
          </div>

          {/* ---- Throughput ---- */}
          {!compact && series.length > 2 && (
            <figure className="m-0 flex flex-col gap-1">
              <figcaption className="text-[10px] font-medium text-zinc-400">
                Trips completed per hour
                <span className="ml-1 text-zinc-600">· last {series.length * 5} s</span>
              </figcaption>
              <div className="h-24 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="throughputFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={SERIES} stopOpacity={0.42} />
                        <stop offset="100%" stopColor={SERIES} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="index" hide />
                    <YAxis
                      width={34}
                      tick={{ fill: INK_MUTED, fontSize: 9 }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      cursor={{ stroke: INK_MUTED, strokeWidth: 1 }}
                      contentStyle={{
                        background: '#18181b',
                        border: '1px solid #3f3f46',
                        borderRadius: 6,
                        fontSize: 11,
                        color: '#e4e4e7',
                      }}
                      labelFormatter={(i) => `${(Number(i) + 1 - series.length) * 5} s`}
                      formatter={(v) => [`${Number(v ?? 0)} veh/h`, 'Throughput']}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={SERIES}
                      strokeWidth={2}
                      fill="url(#throughputFill)"
                      isAnimationActive={false}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </figure>
          )}

          {/* ---- Level-of-service legend ---- */}
          {ui.showCongestion && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-zinc-400">Level of service</span>
              <div className={compact ? 'flex flex-wrap gap-1' : 'grid grid-cols-2 gap-x-2 gap-y-1'}>
                {LOS_ORDER.map((los) => (
                  <span
                    key={los}
                    title={LOS_LABELS[los]}
                    className="flex items-center gap-1 text-[10px] text-zinc-400"
                  >
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: LOS_COLORS[los] }}
                    />
                    <b className="text-zinc-200">{los}</b>
                    {!compact && <span className="truncate">{LOS_LABELS[los]}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ---- Hotspots ---- */}
          {!compact && stats.hotspots.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-zinc-400">Congestion hotspots</span>
              <table className="w-full border-collapse text-[10px]">
                <thead>
                  <tr className="text-zinc-500">
                    <th className="py-0.5 text-left font-medium">Road</th>
                    <th className="py-0.5 text-right font-medium">LOS</th>
                    <th className="py-0.5 text-right font-medium">Speed</th>
                    <th className="py-0.5 text-right font-medium">Veh</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.hotspots.map((h) => (
                    <tr key={h.edge} className="border-t border-zinc-800">
                      <td className="max-w-[7rem] truncate py-0.5 text-zinc-300" title={h.name}>
                        {h.name}
                      </td>
                      <td className="py-0.5 text-right">
                        <span
                          className="inline-flex items-center gap-1 font-semibold text-zinc-100"
                          title={LOS_LABELS[h.los]}
                        >
                          <span
                            aria-hidden
                            className="inline-block h-2 w-2 rounded-sm"
                            style={{ background: LOS_COLORS[h.los] }}
                          />
                          {h.los}
                        </span>
                      </td>
                      <td className="py-0.5 text-right tabular-nums text-zinc-400">
                        {(h.meanSpeed * 3.6).toFixed(0)}
                        <span className="text-zinc-600">/{(h.speedLimit * 3.6).toFixed(0)}</span>
                      </td>
                      <td className="py-0.5 text-right tabular-nums text-zinc-400">{h.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!compact && (
            <p className="text-[10px] leading-snug text-zinc-600">
              <Car size={10} className="mr-1 inline" />
              Synthetic traffic: vehicles follow the real OSM road geometry, lane counts, speed
              limits and signalised junctions, but the demand is generated, not measured. Reseeding
              gives a different, equally reproducible run.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-zinc-400">
      <span className="flex justify-between">
        {label}
        <span className="tabular-nums text-zinc-200">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer accent-blue-500"
      />
    </label>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[11px] text-zinc-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3 cursor-pointer accent-blue-500"
      />
      {label}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right tabular-nums text-zinc-200">{value}</span>
    </div>
  );
}
