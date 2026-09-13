'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMapStore } from '@/store/mapStore';
import { searchPlace, twinRegionFor } from '@/lib/geocoding';
import type { BBox } from '@/types/geo';
import { Globe2, Map, Mountain, PanelLeftClose, PanelLeftOpen, Search, Loader2 } from 'lucide-react';

/** 2D zoom that frames a bbox in a typical viewport. */
function zoomForBBox(b: BBox): number {
  const span = Math.max(b.east - b.west, b.north - b.south);
  return Math.max(2, Math.min(16, Math.floor(Math.log2(360 / span)) - 1));
}

export default function Toolbar({
  sidebarOpen,
  onToggleSidebar,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const is3DActive = useMapStore((s) => s.is3DActive);
  const viewerMode = useMapStore((s) => s.viewerMode);
  const selectedRegion = useMapStore((s) => s.selectedRegion);
  const set3DActive = useMapStore((s) => s.set3DActive);
  const setViewerMode = useMapStore((s) => s.setViewerMode);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!searchError) return;
    const t = setTimeout(() => setSearchError(null), 3500);
    return () => clearTimeout(t);
  }, [searchError]);

  const handleSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const q = query.trim();
      if (!q || searching) return;
      setSearching(true);
      setSearchError(null);
      try {
        const result = await searchPlace(q);
        if (!result) {
          setSearchError(`No results for “${q}”`);
          return;
        }
        const region = twinRegionFor(result);
        const store = useMapStore.getState();
        store.setSelectionMode(null);
        store.setSelectedRegion(region);
        store.setPlaceInfo({
          name: result.name,
          displayName: result.displayName,
          category: result.category,
        });
        store.requestFlyTo([result.lon, result.lat], zoomForBBox(region));
        store.set3DActive(true);
      } catch {
        setSearchError('Search failed — check your connection');
      } finally {
        setSearching(false);
      }
    },
    [query, searching],
  );

  return (
    <header className="relative flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-3">
      <button
        onClick={onToggleSidebar}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </button>

      <div className="flex items-center gap-2">
        <Globe2 size={20} className="text-blue-500" />
        <span className="text-sm font-bold tracking-tight text-zinc-100">GeoVista</span>
      </div>

      <div className="mx-2 h-5 w-px bg-zinc-700" />

      {/* View switch */}
      <div className="flex rounded-lg bg-zinc-800 p-0.5">
        <ViewBtn Icon={Map} label="2D Map" active={!is3DActive} onClick={() => set3DActive(false)} />
        <ViewBtn
          Icon={Globe2}
          label="Globe"
          title="Photorealistic globe (Google 3D Tiles / Cesium)"
          active={is3DActive && viewerMode === 'globe'}
          onClick={() => {
            setViewerMode('globe');
            set3DActive(true);
          }}
        />
        <ViewBtn
          Icon={Mountain}
          label="Terrain"
          title={selectedRegion ? 'Analytical terrain twin of the selected region' : 'Select a region first'}
          active={is3DActive && viewerMode === 'terrain'}
          disabled={!selectedRegion}
          onClick={() => {
            if (!selectedRegion) return;
            setViewerMode('terrain');
            set3DActive(true);
          }}
        />
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="ml-auto flex w-full max-w-sm">
        <div className="relative w-full">
          {searching ? (
            <Loader2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 animate-spin text-blue-400" />
          ) : (
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          )}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a place and build its twin… (e.g. Manhattan, Tunis, Zermatt)"
            className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-800 pl-8 pr-3 text-sm text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-blue-500"
          />
        </div>
      </form>

      {searchError && (
        <div className="absolute right-3 top-full z-50 mt-1 rounded-md bg-red-600/90 px-3 py-1.5 text-xs text-white shadow-lg">
          {searchError}
        </div>
      )}
    </header>
  );
}

function ViewBtn({
  Icon,
  label,
  title,
  active,
  disabled,
  onClick,
}: {
  Icon: React.ComponentType<{ size?: number }>;
  label: string;
  title?: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : disabled
            ? 'cursor-not-allowed text-zinc-600'
            : 'cursor-pointer text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}
