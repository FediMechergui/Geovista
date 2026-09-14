/**
 * OSM building footprints and the tags that drive material-accurate rendering.
 */

/** Every construction-material tag GeoVista reads off an OSM building. */
export interface BuildingProperties {
  /** `height` or `building:height`, metres. */
  height?: number;
  /** `building:levels`. */
  levels?: number;
  /** `building:min_level` — levels skipped at the bottom (building parts). */
  minLevel?: number;
  /** `min_height`, metres — the base of a building part above ground. */
  minHeight?: number;
  name?: string;
  /** The `building=*` value. */
  type?: string;
  /** `roof:shape`. */
  roofShape?: string;
  /** `roof:height`, metres. */
  roofHeight?: number;
  /** `roof:levels`. */
  roofLevels?: number;
  /** `roof:orientation` — `along` (default) or `across`. */
  roofOrientation?: string;

  /* ---- Materials ---- */
  /** `building:material` — the dominant structural/visible material. */
  material?: string;
  /** `building:facade:material` — overrides `material` for walls when present. */
  facadeMaterial?: string;
  /** `roof:material`. */
  roofMaterial?: string;
  /** `building:colour` as a CSS colour or an OSM colour name. */
  colour?: string;
  /** `roof:colour`. */
  roofColour?: string;

  /* ---- Context used to infer missing materials ---- */
  /** `start_date` parsed to a year, if it looks like one. */
  startYear?: number;
  /** `amenity` / `shop` / `office` / `tourism` — hints at glassy commercial stock. */
  useHint?: string;
  /** `historic` presence — pushes inference toward traditional materials. */
  historic?: boolean;
  /** `building:condition` or `condition`. */
  condition?: string;
}

export interface BuildingData {
  id: number;
  geometry: Array<[number, number]>;
  properties: BuildingProperties;
  /**
   * `building:part=*` polygons belonging to this outline, when the building is
   * mapped with Simple 3D Buildings. Parts replace the parent's extrusion.
   */
  parts?: BuildingData[];
}

/** How a building's rendered material was arrived at. */
export type MaterialSource =
  | 'tagged' // an explicit OSM material tag
  | 'colour' // an explicit colour tag but no material
  | 'inferred-use' // guessed from building type / amenity
  | 'inferred-era' // guessed from start_date
  | 'default'; // global fallback

/** Physically-based render parameters for one surface. */
export interface SurfaceMaterial {
  /** Canonical material key, e.g. `brick`, `glass`, `concrete`. */
  key: string;
  /** Human label for the UI. */
  label: string;
  /** Base colour as a CSS hex string. */
  color: string;
  /** 0 = mirror, 1 = fully diffuse. */
  roughness: number;
  /** 0 = dielectric, 1 = metal. */
  metalness: number;
  /** Fresnel strength for dielectrics, 0–1. */
  reflectivity: number;
  /** Whether the facade gets a procedural window grid. */
  windows: boolean;
  /** Emissive strength of lit windows at dusk, 0–1. */
  windowGlow: number;
  /** Per-instance colour variation allowed, 0–1. */
  variation: number;
}

/** The resolved material assignment for one building. */
export interface BuildingMaterialAssignment {
  facade: SurfaceMaterial;
  roof: SurfaceMaterial;
  /** Where the facade material came from. */
  source: MaterialSource;
  /** 0–1 — how much to trust the assignment. */
  confidence: number;
}

/** Aggregate material mix for the loaded region, shown in the sidebar. */
export interface MaterialBreakdown {
  total: number;
  /** Buildings carrying an explicit `building:material`-family tag. */
  tagged: number;
  /** Material key → building count, descending. */
  byMaterial: Array<{ key: string; label: string; color: string; count: number }>;
  /** Mean confidence across the region, 0–1. */
  meanConfidence: number;
}
