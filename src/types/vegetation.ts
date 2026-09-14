/**
 * Vegetation the digital twin can actually place, taken from OpenStreetMap.
 *
 * OSM maps greenery three ways and each becomes trees differently:
 *
 *   - `natural=tree` — a single surveyed tree, at a known point. Often carries
 *     `height`, `circumference`, `species` and `leaf_type`.
 *   - `natural=tree_row` — a line of trees along a way (avenues, windbreaks).
 *     Trees are stepped along it at the mapped or a default spacing.
 *   - `natural=wood`, `landuse=forest`, `leisure=park` … — an *area* of
 *     vegetation with no individual trees mapped. Trees are scattered inside
 *     it at a density that matches the tag, from a seeded RNG so the same
 *     region always produces the same wood.
 *
 * Only the first is a survey. The other two are a defensible reconstruction:
 * the canopy is where OSM says it is, but the individual trunks are generated.
 */

/** What a tree's position is based on — surfaced so the UI can be honest. */
export type TreeSource = 'surveyed' | 'row' | 'scattered';

/** Broad canopy classes, which is as much as OSM tagging reliably supports. */
export type TreeKind = 'broadleaf' | 'needleleaf' | 'palm' | 'shrub';

export interface TreeInstance {
  lon: number;
  lat: number;
  /** Total height, metres. */
  height: number;
  /** Canopy radius, metres. */
  radius: number;
  kind: TreeKind;
  source: TreeSource;
  /** 0–1, drives per-tree colour and rotation jitter. */
  variation: number;
}

/** An OSM polygon of vegetation, kept so the ground can be tinted under it. */
export interface CanopyArea {
  /** Outer ring, `[lon, lat]`. */
  ring: Array<[number, number]>;
  kind: TreeKind;
  /** Trees per hectare used to populate it. */
  density: number;
  /** `natural=wood`, `landuse=forest`, … — shown in the UI. */
  tag: string;
}

export interface VegetationData {
  trees: TreeInstance[];
  areas: CanopyArea[];
  /** Counts by source, for the panel. */
  counts: Record<TreeSource, number>;
}

export const EMPTY_VEGETATION: VegetationData = {
  trees: [],
  areas: [],
  counts: { surveyed: 0, row: 0, scattered: 0 },
};
