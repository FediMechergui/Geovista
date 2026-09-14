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
import type { MaterialBreakdown } from '@/types/buildings';
import type { ProspectivityReport } from '@/types/subsurface';
import type { VegetationData } from '@/types/vegetation';
import type { SimConfig, TrafficStats } from '@/types/traffic';
import { DEFAULT_SIM_CONFIG, EMPTY_TRAFFIC_STATS } from '@/types/traffic';

/** Whether the traffic simulation is running, and how it is displayed. */
export interface TrafficUiState {
  running: boolean;
  /** Colour the road ribbons by level of service instead of by road class. */
  showCongestion: boolean;
  /** Draw the signal heads. */
  showSignals: boolean;
}

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
  materialBreakdown: MaterialBreakdown | null;
  prospectReport: ProspectivityReport | null;
  /** Trees placed from OSM for the selected region. */
  vegetation: VegetationData | null;

  /* ---- Traffic ---- */
  trafficConfig: SimConfig;
  trafficUi: TrafficUiState;
  trafficStats: TrafficStats;
  /** Set while the road network is being fetched and built. */
  trafficLoading: boolean;
  /** Non-null when the network could not be loaded for this region. */
  trafficError: string | null;

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
  setMaterialBreakdown: (b: MaterialBreakdown | null) => void;
  setProspectReport: (r: ProspectivityReport | null) => void;
  setVegetation: (v: VegetationData | null) => void;

  setTrafficConfig: (patch: Partial<SimConfig>) => void;
  setTrafficUi: (patch: Partial<TrafficUiState>) => void;
  setTrafficStats: (s: TrafficStats) => void;
  setTrafficLoading: (loading: boolean) => void;
  setTrafficError: (error: string | null) => void;
}

/** Everything derived from the selected region, cleared when it changes. */
const CLEARED_REGION_DATA = {
  placeInfo: null,
  regionStats: null,
  geologyColumn: null,
  elevationGrid: null,
  materialBreakdown: null,
  prospectReport: null,
  vegetation: null,
  trafficStats: EMPTY_TRAFFIC_STATS,
  trafficError: null,
} as const;

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
    roads: true,
    traffic: false,
    prospect: false,
    trees: true,
  },
  verticalExaggeration: 1.0,
  underground: false,
  terrainTexture: 'satellite',

  placeInfo: null,
  regionStats: null,
  geologyColumn: null,
  elevationGrid: null,
  materialBreakdown: null,
  prospectReport: null,
  vegetation: null,

  trafficConfig: DEFAULT_SIM_CONFIG,
  trafficUi: { running: true, showCongestion: true, showSignals: true },
  trafficStats: EMPTY_TRAFFIC_STATS,
  trafficLoading: false,
  trafficError: null,

  setCenter: (center) => set({ center }),
  setZoom: (zoom) => set({ zoom }),
  setBasemap: (basemap) => set({ basemap }),
  setCursorCoord: (c) => set({ cursorCoord: c }),
  requestFlyTo: (center, zoom) =>
    set((s) => ({
      flyTo: { center, zoom, nonce: (s.flyTo?.nonce ?? 0) + 1 },
    })),

  // Changing the region invalidates everything derived from it.
  setSelectedRegion: (bbox) => set({ selectedRegion: bbox, ...CLEARED_REGION_DATA }),
  setSelectionMode: (mode) => set({ selectionMode: mode }),

  set3DActive: (active) => set({ is3DActive: active }),
  setViewerMode: (viewerMode) => set({ viewerMode }),
  toggleLayer: (layer) =>
    set((s) => {
      const layers = { ...s.layers, [layer]: !s.layers[layer] };
      // Traffic needs roads: turning traffic on turns roads on with it.
      if (layer === 'traffic' && layers.traffic) layers.roads = true;
      // Prospect zones live inside the geology stack.
      if (layer === 'prospect' && layers.prospect) layers.geology = true;
      return { layers };
    }),
  setVerticalExaggeration: (v) => set({ verticalExaggeration: v }),
  setUnderground: (u) => set({ underground: u }),
  setTerrainTexture: (terrainTexture) => set({ terrainTexture }),

  setPlaceInfo: (placeInfo) => set({ placeInfo }),
  setRegionStats: (regionStats) => set({ regionStats }),
  setGeologyColumn: (geologyColumn) => set({ geologyColumn }),
  setElevationGrid: (elevationGrid) => set({ elevationGrid }),
  setMaterialBreakdown: (materialBreakdown) => set({ materialBreakdown }),
  setProspectReport: (prospectReport) => set({ prospectReport }),
  setVegetation: (vegetation) => set({ vegetation }),

  setTrafficConfig: (patch) =>
    set((s) => ({ trafficConfig: { ...s.trafficConfig, ...patch } })),
  setTrafficUi: (patch) => set((s) => ({ trafficUi: { ...s.trafficUi, ...patch } })),
  setTrafficStats: (trafficStats) => set({ trafficStats }),
  setTrafficLoading: (trafficLoading) => set({ trafficLoading }),
  setTrafficError: (trafficError) => set({ trafficError }),
}));
