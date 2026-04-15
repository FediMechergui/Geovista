export const TILE_URLS = {
  osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  terrain: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  stamen: 'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png',
} as const;

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
