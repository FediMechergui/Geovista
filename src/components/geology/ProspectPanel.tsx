'use client';

/**
 * Subsurface prospectivity panel.
 *
 * Shows the scored aquifer and hydrocarbon intervals, the petroleum-system
 * element bars, and — prominently, not in a footnote — what the scores are
 * and are not. Every number here comes from rock type and depth alone, so the
 * panel leads with that rather than burying it.
 */

import { useState } from 'react';
import { useMapStore } from '@/store/mapStore';
import {
  CONFIDENCE_LABELS,
  PROSPECT_DISCLAIMER,
  zoneColor,
} from '@/lib/geology/prospectivity';
import { LITHOLOGY_LABELS } from '@/lib/geology/lithology';
import type { ProspectZone } from '@/types/subsurface';
import { ChevronDown, Droplets, Flame, Info, Layers } from 'lucide-react';

/** Petroleum-system elements in the order a geologist reads them. */
const SYSTEM_ELEMENTS: Array<{ key: 'source' | 'maturity' | 'reservoir' | 'seal' | 'trap'; label: string; note?: string }> = [
  { key: 'source', label: 'Source rock' },
  { key: 'maturity', label: 'Thermal maturity' },
  { key: 'reservoir', label: 'Reservoir' },
  { key: 'seal', label: 'Seal' },
  { key: 'trap', label: 'Trap', note: 'Capped — needs seismic' },
];

export default function ProspectPanel() {
  const report = useMapStore((s) => s.prospectReport);
  const layers = useMapStore((s) => s.layers);
  const toggleLayer = useMapStore((s) => s.toggleLayer);

  if (!report) {
    return (
      <p className="text-xs leading-snug text-zinc-500">
        {layers.geology
          ? 'Open the Terrain view to screen this region’s stratigraphic column for groundwater and hydrocarbon potential.'
          : 'Enable the Geology layer and open the Terrain view to screen the column for groundwater and hydrocarbon potential.'}
      </p>
    );
  }

  const { aquifers, hydrocarbons, petroleumSystem, waterTableDepth, geothermalGradient, notes } =
    report;

  return (
    <div className="flex flex-col gap-3">
      {/* ---- What this is ---- */}
      <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
        <Info size={13} className="mt-0.5 shrink-0 text-amber-400" />
        <p className="text-[10px] leading-snug text-amber-200/90">{PROSPECT_DISCLAIMER}</p>
      </div>

      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={layers.prospect}
          onChange={() => toggleLayer('prospect')}
          className="h-3.5 w-3.5 cursor-pointer accent-blue-500"
        />
        <Layers size={14} className="text-zinc-500" />
        Highlight zones in 3D
      </label>

      {/* ---- Setting ---- */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-zinc-800/70 px-2.5 py-2 text-[11px]">
        <Stat
          label="Water table"
          value={waterTableDepth === null ? '—' : `~${waterTableDepth.toFixed(0)} m`}
        />
        <Stat label="Geothermal" value={`${geothermalGradient} °C/km`} />
        <Stat label="Aquifer targets" value={String(aquifers.length)} />
        <Stat label="HC targets" value={String(hydrocarbons.length)} />
      </div>

      {/* ---- Aquifers ---- */}
      <Group
        title="Groundwater"
        Icon={Droplets}
        iconClass="text-sky-400"
        zones={aquifers}
        empty="No interval combines the porosity and permeability needed for an aquifer."
      />

      {/* ---- Hydrocarbons ---- */}
      <Group
        title="Hydrocarbons"
        Icon={Flame}
        iconClass="text-amber-400"
        zones={hydrocarbons}
        empty="No interval has a reservoir, a seal and a mature source together."
      />

      {/* ---- Petroleum system ---- */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Petroleum system elements
        </span>
        {SYSTEM_ELEMENTS.map(({ key, label, note }) => (
          <Bar
            key={key}
            label={label}
            note={note}
            value={petroleumSystem[key]}
            color={key === 'trap' ? '#a8a29e' : '#f59e0b'}
          />
        ))}
        <p className="text-[10px] leading-snug text-zinc-600">
          {petroleumSystem.ordering
            ? 'Source sits below reservoir below seal — the right order for migration.'
            : 'The elements are not stacked in migration order, which weakens any play.'}
        </p>
      </div>

      {/* ---- Data gaps ---- */}
      {notes.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-[10px] leading-snug text-zinc-500">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function Group({
  title,
  Icon,
  iconClass,
  zones,
  empty,
}: {
  title: string;
  Icon: typeof Droplets;
  iconClass: string;
  zones: ProspectZone[];
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <Icon size={11} className={iconClass} />
        {title}
      </span>
      {zones.length === 0 ? (
        <p className="text-[10px] leading-snug text-zinc-600">{empty}</p>
      ) : (
        zones.map((zone) => <ZoneCard key={zone.id} zone={zone} />)
      )}
    </div>
  );
}

function ZoneCard({ zone }: { zone: ProspectZone }) {
  const [open, setOpen] = useState(false);
  const color = zoneColor(zone);

  return (
    <div className="rounded-md bg-zinc-800/70">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-start gap-2 px-2.5 py-1.5 text-left"
      >
        <span
          aria-hidden
          className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ background: color }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium text-zinc-200">{zone.title}</span>
          <span className="block text-[10px] text-zinc-500">
            {zone.depthTop.toFixed(0)}–{zone.depthBottom.toFixed(0)} m ·{' '}
            {LITHOLOGY_LABELS[zone.lithology]}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="text-[11px] font-semibold tabular-nums text-zinc-100">
            {(zone.score * 100).toFixed(0)}
          </span>
          <ChevronDown
            size={12}
            className={`text-zinc-500 transition-transform ${open ? '' : '-rotate-90'}`}
          />
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-1.5 border-t border-zinc-700/60 px-2.5 py-2">
          <span className="text-[10px] text-zinc-400">
            Confidence: <b className="text-zinc-200">{CONFIDENCE_LABELS[zone.confidence]}</b>
          </span>

          <div className="flex flex-col gap-1">
            {Object.entries(zone.elements).map(([key, value]) => (
              <Bar key={key} label={key} value={value} color={color} />
            ))}
          </div>

          <ul className="flex list-disc flex-col gap-0.5 pl-3.5 text-[10px] leading-snug text-zinc-400">
            {zone.evidence.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <ul className="flex list-disc flex-col gap-0.5 pl-3.5 text-[10px] leading-snug text-amber-300/70">
            {zone.caveats.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A labelled 0–1 bar; the number is always printed, never colour-only. */
function Bar({
  label,
  value,
  color,
  note,
}: {
  label: string;
  value: number;
  color: string;
  note?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-24 shrink-0 capitalize text-zinc-400">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-700">
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </span>
      <span className="w-7 shrink-0 text-right tabular-nums text-zinc-300">{pct.toFixed(0)}</span>
      {note && <span className="shrink-0 text-zinc-600">{note}</span>}
    </div>
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
