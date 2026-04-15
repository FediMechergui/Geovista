'use client';

import { useMapStore } from '@/store/mapStore';
import {
  Globe2,
  Map,
  Box,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from 'lucide-react';
import { useState, useCallback } from 'react';

/* ================================================================== */
/*  Toolbar                                                            */
/* ================================================================== */

export default function Toolbar({
  sidebarOpen,
  onToggleSidebar,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const is3DActive = useMapStore((s) => s.is3DActive);
  const set3DActive = useMapStore((s) => s.set3DActive);
  const selectedRegion = useMapStore((s) => s.selectedRegion);

  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!searchQuery.trim()) return;
      // Nominatim free geocoder (OSM)
      fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(searchQuery)}`,
      )
        .then((r) => r.json())
        .then((data: Array<{ lat: string; lon: string }>) => {
          if (data[0]) {
            useMapStore.getState().setCenter([
              parseFloat(data[0].lon),
              parseFloat(data[0].lat),
            ]);
            useMapStore.getState().setZoom(10);
          }
        })
        .catch(() => {});
    },
    [searchQuery],
  );

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-3">
      {/* Sidebar toggle */}
      <button
        onClick={onToggleSidebar}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </button>

      {/* Brand */}
      <div className="flex items-center gap-2">
        <Globe2 size={20} className="text-blue-500" />
        <span className="text-sm font-bold tracking-tight text-zinc-100">
          GeoVista
        </span>
      </div>

      <div className="mx-2 h-5 w-px bg-zinc-700" />

      {/* View mode toggle */}
      <div className="flex rounded-lg bg-zinc-800 p-0.5">
        <ViewBtn
          Icon={Map}
          label="2D Map"
          active={!is3DActive}
          onClick={() => set3DActive(false)}
        />
        <ViewBtn
          Icon={Box}
          label="3D Viewer"
          active={is3DActive}
          disabled={!selectedRegion}
          onClick={() => {
            if (selectedRegion) set3DActive(true);
          }}
        />
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="ml-auto flex max-w-xs flex-1">
        <div className="relative w-full">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search location…"
            className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-800 pl-8 pr-3 text-sm text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-blue-500"
          />
        </div>
      </form>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  View mode button                                                   */
/* ------------------------------------------------------------------ */

function ViewBtn({
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
      title={disabled ? 'Select a region first' : label}
      className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : disabled
            ? 'cursor-not-allowed text-zinc-600'
            : 'text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}
