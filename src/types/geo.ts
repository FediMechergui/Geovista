export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface Coordinate {
  lon: number;
  lat: number;
  elevation?: number;
}

export interface ElevationGrid {
  width: number;
  height: number;
  data: Float32Array;
  bbox: BBox;
  noDataValue: number;
  /** Approximate ground resolution in meters per pixel. */
  resolution: number;
  /** Web-Mercator tile range the grid was stitched from (when tile-based). */
  tileRange?: TileRange;
}

/** Inclusive XYZ tile range at a given zoom. */
export interface TileRange {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  zoom: number;
}

export type SelectionMode = 'bbox' | null;
export type Basemap = 'osm' | 'satellite' | 'terrain' | 'dark';

/** Which 3D engine renders the selected place. */
export type ViewerMode = 'globe' | 'terrain';

/** Surface coloring for the analytical terrain viewer. */
export type TerrainTexture = 'satellite' | 'landuse' | 'hypsometric';

export interface LayerVisibility {
  buildings: boolean;
  geology: boolean;
  water: boolean;
  /** OSM road network draped on the terrain / clamped to the globe. */
  roads: boolean;
  /** Vehicle microsimulation driving on the road network. */
  traffic: boolean;
  /** Highlighted aquifer / hydrocarbon target intervals in the geology stack. */
  prospect: boolean;
  /** OSM trees, tree rows and wooded areas. */
  trees: boolean;
}

/** Reverse-geocoded identity of the selected region. */
export interface PlaceInfo {
  name: string;
  displayName: string;
  category?: string;
}

/** Derived statistics for the selected region (filled by the terrain viewer). */
export interface RegionStats {
  areaKm2: number;
  minElev: number;
  maxElev: number;
  meanElev: number;
  demResolutionM: number;
  buildingCount: number;
  /** Drivable centreline length of the loaded road network, kilometres. */
  roadLengthKm: number;
  /** Trees placed from OSM — surveyed, stepped along rows, and scattered. */
  treeCount: number;
}

/** One-shot camera request for the 2D map (nonce forces re-trigger). */
export interface FlyToRequest {
  center: [number, number];
  zoom: number;
  nonce: number;
}
