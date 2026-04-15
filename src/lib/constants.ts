export const TILE_URLS = {
  osm: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  terrain:
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  /** MapTiler terrain-RGB — higher quality than Terrarium at zoom 12+. Free tier: 100k req/month. */
  terrainRGB: "https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp",
  stamen: "https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png",
  /** Satellite imagery — for texture draping on terrain. */
  satellite:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
} as const;

/** Google Photorealistic 3D Tiles endpoint (requires NEXT_PUBLIC_GOOGLE_MAPS_API_KEY). */
export const GOOGLE_3D_TILES_URL =
  'https://tile.googleapis.com/v1/3dtiles/root.json';

/** Cesium Ion access token (free tier — OSM Buildings + World Terrain). */
export const CESIUM_ION_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI4YjM3ODFkZi0zMWUzLTQ1MjgtYTRjZi05N2VjODRlYzQ0N2YiLCJpZCI6NDE4NjEwLCJpYXQiOjE3NzYyNjAyMjB9.AWrk6bbHop9SQiMPotjFXW5vEh7lwFcwzIcPHQEonOw';

/** Google Maps API key for Photorealistic 3D Tiles (free tier: 100k loads/month). */
export const GOOGLE_MAPS_API_KEY = 'AIzaSyBhjXgPkY3W-E6fV-qkgFf0KnkohsI2MsA';

/** MapTiler API key (free tier: 100k req/month — terrain-rgb, satellite). */
export const MAPTILER_API_KEY = 'aosV7l6Uy3wSPBEbvSw7';

/** Overture Maps API key. */
export const OVERTURE_API_KEY = 'live_NPk1P5NH6WbbW7nCce0X4pH6dpg9JFMu1pk1yXcFXrMmfVAFRibUY07O9Y1uTNZ5';

export const MAPLIBRE_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-tiles',
      type: 'raster' as const,
      source: 'osm',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

export const OVERPASS_API = 'https://overpass-api.de/api/interpreter';
export const MACROSTRAT_API = 'https://macrostrat.org/api/v2';

export const HYPSOMETRIC_STOPS = [
  { elev: -11000, color: '#000033' },
  { elev: -6000,  color: '#000066' },
  { elev: -2000,  color: '#0000cc' },
  { elev: -200,   color: '#3399ff' },
  { elev: 0,      color: '#66ccff' },
  { elev: 1,      color: '#006600' },
  { elev: 200,    color: '#00aa00' },
  { elev: 500,    color: '#88bb33' },
  { elev: 1000,   color: '#bbaa22' },
  { elev: 2000,   color: '#cc8800' },
  { elev: 3000,   color: '#aa6633' },
  { elev: 4000,   color: '#886655' },
  { elev: 5000,   color: '#cccccc' },
  { elev: 8000,   color: '#ffffff' },
];
