/**
 * Nominatim (OpenStreetMap) geocoding — search and reverse lookup.
 * Usage policy: max 1 request/second, only on explicit user action.
 */

import type { BBox, PlaceInfo } from '@/types/geo';
import { NOMINATIM_API } from '@/lib/constants';

export interface GeocodeResult extends PlaceInfo {
  lon: number;
  lat: number;
  /** Nominatim's bounding box for the feature. */
  bbox: BBox;
}

interface NominatimSearchRow {
  name?: string;
  display_name: string;
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string]; // south, north, west, east
  category?: string;
  type?: string;
}

interface NominatimReverseRow {
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  address?: Record<string, string>;
  error?: string;
}

/**
 * Largest region we build a twin for automatically (deg²). ~0.012 ≈ 10 km ×
 * 10 km at mid latitudes — enough for a city centre with full building
 * detail. Users can always draw a larger box by hand.
 */
const MAX_TWIN_AREA_DEG2 = 0.012;
/** Half-size of the box used for oversized results (countries, big cities): ~5.5 km. */
const DEFAULT_HALF_SPAN_DEG = 0.025;
/** Half-size for point features so a POI still gets a meaningful neighbourhood. */
const MIN_HALF_SPAN_DEG = 0.006;

export async function searchPlace(query: string): Promise<GeocodeResult | null> {
  const url = `${NOMINATIM_API}/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const rows = (await res.json()) as NominatimSearchRow[];
  const row = rows[0];
  if (!row) return null;

  const [s, n, w, e] = row.boundingbox.map(Number);
  return {
    name: row.name || row.display_name.split(',')[0],
    displayName: row.display_name,
    category: row.type ?? row.category,
    lon: parseFloat(row.lon),
    lat: parseFloat(row.lat),
    bbox: { south: s, north: n, west: w, east: e },
  };
}

export async function reversePlace(lon: number, lat: number): Promise<PlaceInfo | null> {
  const url = `${NOMINATIM_API}/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const row = (await res.json()) as NominatimReverseRow;
  if (row.error || !row.display_name) return null;

  const a = row.address ?? {};
  const local =
    a.suburb || a.neighbourhood || a.village || a.town || a.city_district || a.city || row.name;
  const region = [a.city || a.town || a.county, a.state, a.country]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(', ');

  return {
    name: local || row.display_name.split(',')[0],
    displayName: region || row.display_name,
    category: row.type ?? row.category,
  };
}

/**
 * Turn a geocoder result into a sensible twin region: clamp oversized
 * results (countries, large cities) and expand point features.
 */
export function twinRegionFor(result: GeocodeResult): BBox {
  const { bbox, lon, lat } = result;
  const area = (bbox.east - bbox.west) * (bbox.north - bbox.south);
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));

  if (area > MAX_TWIN_AREA_DEG2 || area < (MIN_HALF_SPAN_DEG * 2) ** 2) {
    const h = area > MAX_TWIN_AREA_DEG2 ? DEFAULT_HALF_SPAN_DEG : MIN_HALF_SPAN_DEG;
    return {
      west: lon - h / cosLat,
      east: lon + h / cosLat,
      south: lat - h,
      north: lat + h,
    };
  }
  return bbox;
}
