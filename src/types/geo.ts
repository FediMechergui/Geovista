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
  resolution: number;
}

export type SelectionMode = 'bbox' | 'polygon' | 'circle' | null;
export type Basemap = 'osm' | 'satellite' | 'terrain' | 'dark';

export interface LayerVisibility {
  terrain: boolean;
  buildings: boolean;
  geology: boolean;
  bathymetry: boolean;
  satellite: boolean;
  contours: boolean;
}
