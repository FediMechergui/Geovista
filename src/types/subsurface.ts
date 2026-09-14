/**
 * Subsurface resource-prospectivity types.
 *
 * ⚠️  Everything in this module is a **lithology-derived heuristic**, not a
 * survey. Real groundwater and petroleum assessment needs well logs, seismic
 * reflection data, geochemistry and structural mapping — none of which is
 * available from a free public API. What GeoVista can do honestly is read the
 * Macrostrat stratigraphic column, classify each unit's rock type, and score
 * the classic play elements (porosity / permeability / seal / maturity) that
 * geologists use as a first-pass screen. Treat the output as "where a
 * geologist would look next", never as "there is water/oil here".
 */

/** Normalised rock class distilled from Macrostrat's free-text lithology. */
export type LithologyClass =
  | 'sandstone'
  | 'conglomerate'
  | 'siltstone'
  | 'shale'
  | 'mudstone'
  | 'limestone'
  | 'dolomite'
  | 'chalk'
  | 'marl'
  | 'evaporite'
  | 'coal'
  | 'chert'
  | 'volcanic'
  | 'plutonic'
  | 'metamorphic'
  | 'alluvium'
  | 'glacial'
  | 'unknown';

/**
 * First-order petrophysical properties per rock class. Ranges are broad
 * literature values for "typical" rock of that class at shallow-to-moderate
 * burial; they are used only for relative scoring between units.
 */
export interface PetroPhysics {
  /** Representative total porosity, fraction 0–1. */
  porosity: number;
  /** log10 of permeability in millidarcy. −6 ≈ tight, +4 ≈ gravel. */
  logPermMd: number;
  /** Capacity to act as a seal / aquitard, 0–1. */
  sealQuality: number;
  /** Capacity to source hydrocarbons (organic richness potential), 0–1. */
  sourcePotential: number;
  /** Fracture / karst bonus applied when the unit is brittle or soluble, 0–1. */
  secondaryPorosity: number;
  /** Whether groundwater in this class is typically fresh (vs. saline/brine). */
  freshwaterLikely: boolean;
}

export type ProspectKind = 'aquifer' | 'hydrocarbon';

/** Confidence in a scored zone — always capped because the inputs are coarse. */
export type ProspectConfidence = 'low' | 'moderate' | 'indicative';

/** One scored interval in the stratigraphic column. */
export interface ProspectZone {
  id: string;
  kind: ProspectKind;
  /** Human label, e.g. "Nubian Sandstone — confined aquifer". */
  title: string;
  /** Stratigraphic unit name the zone is based on. */
  unitName: string;
  lithology: LithologyClass;
  /** Depth below the local surface, metres. */
  depthTop: number;
  depthBottom: number;
  /** 0–1 composite score. */
  score: number;
  confidence: ProspectConfidence;
  /** Short lines explaining what drove the score (shown in the UI). */
  evidence: string[];
  /** What is missing before this could be called a real target. */
  caveats: string[];
  /** Per-element breakdown; keys differ by `kind`. */
  elements: Record<string, number>;
}

/** Petroleum-system completeness for the column as a whole. */
export interface PetroleumSystem {
  /** Best source-rock score found in the column, 0–1. */
  source: number;
  /** Best reservoir score, 0–1. */
  reservoir: number;
  /** Best seal score, 0–1. */
  seal: number;
  /** Proxy for trap presence — stratigraphic only, structure is unknown. */
  trap: number;
  /** Thermal maturity of the best source rock, 0–1 (peak oil window = 1). */
  maturity: number;
  /** Whether source sits below reservoir below seal in the right order. */
  ordering: boolean;
}

export interface ProspectivityReport {
  /** Macrostrat column the analysis is based on. */
  columnId: number;
  columnName: string;
  lat: number;
  lng: number;
  /** Mean surface elevation used for depth references, metres. */
  surfaceElevation: number;
  /** Estimated depth to the water table below ground, metres (heuristic). */
  waterTableDepth: number | null;
  /** Estimated geothermal gradient used for maturity, °C/km. */
  geothermalGradient: number;
  aquifers: ProspectZone[];
  hydrocarbons: ProspectZone[];
  petroleumSystem: PetroleumSystem;
  /** Notes about data gaps for this particular column. */
  notes: string[];
}
