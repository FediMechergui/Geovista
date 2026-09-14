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

/** Area in square degrees. Not a real area — only ever compared to a cap. */
export function bboxAreaDeg2(bbox: BBox): number {
  return Math.max(0, bbox.east - bbox.west) * Math.max(0, bbox.north - bbox.south);
}

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
 * Shrink a bbox around its centre until its area is at most `maxArea` deg².
 * Returns the original box, and `clamped: false`, when it already fits.
 */
export function clampBBoxArea(bbox: BBox, maxArea: number): ClampedBBox {
  const w = bbox.east - bbox.west;
  const h = bbox.north - bbox.south;
  const area = w * h;
  if (area <= maxArea || area <= 0) return { bbox, clamped: false };

  const k = Math.sqrt(maxArea / area);
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
 * Caps per layer, in square degrees. Roads are the most generous because the
 * road query returns far fewer vertices per km² than buildings do.
 */
export const MAX_AREA_DEG2 = {
  /** `way["building"]` + relations + parts, with `out geom`. */
  buildings: 0.02,
  /** Trees, tree rows and wooded outlines. */
  vegetation: 0.02,
} as const;
