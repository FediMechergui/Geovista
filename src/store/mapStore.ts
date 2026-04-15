import { create } from 'zustand';
import { BBox, SelectionMode, Basemap, LayerVisibility } from '@/types/geo';

interface MapState {
  center: [number, number];
  zoom: number;
  selectedRegion: BBox | null;
  selectionMode: SelectionMode;
  basemap: Basemap;
  layers: LayerVisibility;
  is3DActive: boolean;
  verticalExaggeration: number;
  underground: boolean;
  cursorCoord: { lon: number; lat: number } | null;

  setCenter: (c: [number, number]) => void;
  setZoom: (z: number) => void;
  setSelectedRegion: (b: BBox | null) => void;
  setSelectionMode: (m: SelectionMode) => void;
  toggleLayer: (l: keyof LayerVisibility) => void;
  setBasemap: (b: Basemap) => void;
  set3DActive: (a: boolean) => void;
  setVerticalExaggeration: (v: number) => void;
  setUnderground: (u: boolean) => void;
  setCursorCoord: (c: { lon: number; lat: number } | null) => void;
}

export const useMapStore = create<MapState>((set) => ({
  center: [10, 34],
  zoom: 3,
  selectedRegion: null,
  selectionMode: null,
  basemap: 'osm',
  layers: {
    terrain: true,
    buildings: true,
    geology: false,
    bathymetry: false,
    satellite: false,
    contours: false,
  },
  is3DActive: false,
  verticalExaggeration: 1.5,
  underground: false,
  cursorCoord: null,

  setCenter: (center) => set({ center }),
  setZoom: (zoom) => set({ zoom }),
  setSelectedRegion: (bbox) => set({ selectedRegion: bbox }),
  setSelectionMode: (mode) => set({ selectionMode: mode }),
  toggleLayer: (layer) =>
    set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
  setBasemap: (basemap) => set({ basemap }),
  set3DActive: (active) => set({ is3DActive: active }),
  setVerticalExaggeration: (v) => set({ verticalExaggeration: v }),
  setUnderground: (u) => set({ underground: u }),
  setCursorCoord: (c) => set({ cursorCoord: c }),
}));
