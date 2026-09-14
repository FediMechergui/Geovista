/**
 * Bounding-box guards shared by every Overpass-backed layer.
 *
 * Overpass bills by how much it has to read, and `out geom` returns every
 * vertex inline. A region drawn by hand has no upper bound — drag a box across
 * a whole governorate and the building query asks for a few thousand square
 * kilometres of footprints, which either times out at 45 s or returns tens of
 * megabytes. Either way the layer never appears, and from the outside it just
 * looks like nothing happened.
 *
 * So each layer clamps its request to an area it can actually serve, and says
 * so. The clamp keeps the centre of the selection, because that is what the
 * camera is looking at.
 */

import type { BBox } from '@/types/geo';

/** Ground area in km², for telling the user what they actually got. */
export function bboxAreaKm2(bbox: BBox): number {
  const midLat = ((bbox.south + bbox.north) / 2) * (Math.PI / 180);
  const widthKm = (bbox.east - bbox.west) * 111.32 * Math.cos(midLat);
  const heightKm = (bbox.north - bbox.south) * 110.57;
  return Math.abs(widthKm * heightKm);
}

export interface ClampedBBox {
  bbox: BBox;
  /** True when the request covers less than the user's selection. */
  clamped: boolean;
}

/**
 * Shrink a bbox around its centre until it covers at most `maxAreaKm2`.
 * Returns the original box, and `clamped: false`, when it already fits.
 *
 * The cap is in km² rather than square degrees on purpose. A square degree is
 * ~12 300 km² at the equator and ~9 300 km² at the latitude of New York, so a
 * degree-based cap silently means something different in every city — and it
 * is far too easy to write one that reads like a few km² and is really forty.
 */
export function clampBBoxArea(bbox: BBox, maxAreaKm2: number): ClampedBBox {
  const w = bbox.east - bbox.west;
  const h = bbox.north - bbox.south;
  const area = bboxAreaKm2(bbox);
  if (area <= maxAreaKm2 || area <= 0 || w <= 0 || h <= 0) {
    return { bbox, clamped: false };
  }

  const k = Math.sqrt(maxAreaKm2 / area);
  const cx = (bbox.west + bbox.east) / 2;
  const cy = (bbox.south + bbox.north) / 2;
  return {
    bbox: {
      west: cx - (w * k) / 2,
      east: cx + (w * k) / 2,
      south: cy - (h * k) / 2,
      north: cy + (h * k) / 2,
    },
    clamped: true,
  };
}

/**
 * Ground area each layer may request, km², sized by what Overpass can actually
 * return rather than by what looks generous. `out geom` sends every vertex, so
 * the worst case is a dense city centre: Manhattan's footprints run to
 * megabytes per few km² and do not finish inside any timeout Overpass allows.
 * Vegetation is cheaper per km² (outlines and points, not footprints) and roads
 * cheaper still.
 *
 * For scale, a place search produces a twin of roughly 20–30 km². Vegetation
 * and roads cover that whole; buildings do not, and are clamped to the middle
 * of it — a city's worth of footprints is simply more than Overpass returns.
 * The UI says so whenever that happens rather than showing a short answer.
 */
export const MAX_AREA_KM2 = {
  /** `nwr["building"]` + parts, with `out geom`. */
  buildings: 12,
  /** Trees, tree rows and wooded outlines. */
  vegetation: 40,
  /** The drivable network — geometry plus node ids to stitch junctions. */
  roads: 400,
} as const;
