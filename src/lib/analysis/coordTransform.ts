/**
 * Coordinate reference system (CRS) transformations and geodesic math.
 *
 * Uses proj4js for CRS projection. All 120 UTM zones (N & S) are
 * pre-registered at module load so `getUTMEpsg()` always returns a
 * code that `transform()` can immediately use.
 *
 * Distance math uses the Haversine formula — accurate to a few meters
 * on distances up to ~1000 km, good enough for most UI uses. Swap in
 * Vincenty/Karney if you need sub-millimeter accuracy on long lines.
 */

import proj4 from 'proj4';

// ---------- CRS registration -----------------------------------------------

proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');
proj4.defs(
  'EPSG:3857',
  '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
);

// Pre-register all UTM zones: EPSG:326xx (N hemisphere) and EPSG:327xx (S).
for (let zone = 1; zone <= 60; zone++) {
  const zz = String(zone).padStart(2, '0');
  proj4.defs(
    `EPSG:326${zz}`,
    `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`,
  );
  proj4.defs(
    `EPSG:327${zz}`,
    `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`,
  );
}

// ---------- Public API ------------------------------------------------------

/**
 * Transform a 2D coordinate between two registered CRS.
 * Input and output are `[x, y]` / `[lon, lat]` tuples.
 */
export function transform(
  from: string,
  to: string,
  coord: [number, number],
): [number, number] {
  const result = proj4(from, to, coord);
  return [result[0], result[1]];
}

/**
 * UTM zone number (1–60) containing the given longitude.
 * Note: this is the simple global rule — special cases for Svalbard
 * and SW Norway are ignored.
 */
export function getUTMZone(longitude: number): number {
  return Math.floor((longitude + 180) / 6) + 1;
}

/**
 * EPSG code for the UTM zone containing a given lon/lat.
 *   - Northern hemisphere → EPSG:326xx
 *   - Southern hemisphere → EPSG:327xx
 */
export function getUTMEpsg(longitude: number, latitude: number): string {
  const zone = getUTMZone(longitude);
  const hemisphere = latitude >= 0 ? '326' : '327';
  return `EPSG:${hemisphere}${String(zone).padStart(2, '0')}`;
}

/**
 * Great-circle (Haversine) distance between two points, in meters.
 * Uses the WGS84 mean radius (6 371 000 m).
 */
export function geodesicDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
