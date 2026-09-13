import { create } from 'zustand';
import type {
  BBox,
  SelectionMode,
  Basemap,
  LayerVisibility,
  ViewerMode,
  TerrainTexture,
  PlaceInfo,
  RegionStats,
  FlyToRequest,
  ElevationGrid,
} from '@/types/geo';
import type { GeologicalColumn } from '@/types/geology';

interface MapState {
  /* ---- 2D map ---- */
  center: [number, number];
  zoom: number;
  basemap: Basemap;
  cursorCoord: { lon: number; lat: number } | null;
  flyTo: FlyToRequest | null;

  /* ---- Selection ---- */
  selectedRegion: BBox | null;
  selectionMode: SelectionMode;

  /* ---- 3D ---- */
  is3DActive: boolean;
  viewerMode: ViewerMode;
  layers: LayerVisibility;
  verticalExaggeration: number;
  underground: boolean;
  terrainTexture: TerrainTexture;

  /* ---- Place data (derived from the selected region) ---- */
  placeInfo: PlaceInfo | null;
  regionStats: RegionStats | null;
  geologyColumn: GeologicalColumn | null;
  elevationGrid: ElevationGrid | null;

  /* ---- Actions ---- */
  setCenter: (c: [number, number]) => void;
  setZoom: (z: number) => void;
  setBasemap: (b: Basemap) => void;
  setCursorCoord: (c: { lon: number; lat: number } | null) => void;
  requestFlyTo: (center: [number, number], zoom: number) => void;

  setSelectedRegion: (b: BBox | null) => void;
  setSelectionMode: (m: SelectionMode) => void;

  set3DActive: (a: boolean) => void;
  setViewerMode: (m: ViewerMode) => void;
  toggleLayer: (l: keyof LayerVisibility) => void;
  setVerticalExaggeration: (v: number) => void;
  setUnderground: (u: boolean) => void;
  setTerrainTexture: (t: TerrainTexture) => void;

  setPlaceInfo: (p: PlaceInfo | null) => void;
  setRegionStats: (s: RegionStats | null) => void;
  setGeologyColumn: (c: GeologicalColumn | null) => void;
  setElevationGrid: (g: ElevationGrid | null) => void;
}

export const useMapStore = create<MapState>((set) => ({
  center: [10, 34],
  zoom: 3,
  basemap: 'osm',
  cursorCoord: null,
  flyTo: null,

  selectedRegion: null,
  selectionMode: null,

  is3DActive: false,
  viewerMode: 'globe',
  layers: {
    buildings: true,
    geology: false,
    water: true,
  },
  verticalExaggeration: 1.0,
  underground: false,
  terrainTexture: 'satellite',

  placeInfo: null,
  regionStats: null,
  geologyColumn: null,
  elevationGrid: null,

  setCenter: (center) => set({ center }),
  setZoom: (zoom) => set({ zoom }),
  setBasemap: (basemap) => set({ basemap }),
  setCursorCoord: (c) => set({ cursorCoord: c }),
  // Also update center/zoom so a freshly mounted map (e.g. when the split
  // pane opens) starts at the target even if the animation never runs.
  requestFlyTo: (center, zoom) =>
    set((s) => ({
      center,
      zoom,
      flyTo: { center, zoom, nonce: (s.flyTo?.nonce ?? 0) + 1 },
    })),

  // Changing the region invalidates everything derived from it.
  setSelectedRegion: (bbox) =>
    set({
      selectedRegion: bbox,
      placeInfo: null,
      regionStats: null,
      geologyColumn: null,
      elevationGrid: null,
    }),
  setSelectionMode: (mode) => set({ selectionMode: mode }),

  set3DActive: (active) => set({ is3DActive: active }),
  setViewerMode: (viewerMode) => set({ viewerMode }),
  toggleLayer: (layer) =>
    set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
  setVerticalExaggeration: (v) => set({ verticalExaggeration: v }),
  setUnderground: (u) => set({ underground: u }),
  setTerrainTexture: (terrainTexture) => set({ terrainTexture }),

  setPlaceInfo: (placeInfo) => set({ placeInfo }),
  setRegionStats: (regionStats) => set({ regionStats }),
  setGeologyColumn: (geologyColumn) => set({ geologyColumn }),
  setElevationGrid: (elevationGrid) => set({ elevationGrid }),
}));
