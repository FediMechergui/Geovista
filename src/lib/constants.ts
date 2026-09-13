/**
 * Public configuration. Secrets live in `.env.local` (see `.env.example`);
 * `NEXT_PUBLIC_*` values are inlined into the client bundle at build time.
 */

/** Cesium Ion token — World Terrain + OSM Buildings in the Globe view. */
export const CESIUM_ION_TOKEN = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? '';

/** Google Maps Platform key with the Map Tiles API enabled — Photorealistic 3D Tiles. */
export const GOOGLE_MAPS_API_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

/** Google Photorealistic 3D Tiles root tileset. */
export const GOOGLE_3D_TILES_URL =
  'https://tile.googleapis.com/v1/3dtiles/root.json';

/** Where the Cesium static assets (Workers, Assets, ThirdParty, Widgets) are served. */
export const CESIUM_BASE_URL = '/cesium';

export const TILE_URLS = {
  osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  /** AWS Terrain Tiles — Terrarium-encoded elevation, free, global, up to z15. */
  terrain:
    'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  /** Esri World Imagery — free satellite/aerial tiles (attribution required). */
  satellite:
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
} as const;

export const NOMINATIM_API = 'https://nominatim.openstreetmap.org';

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
