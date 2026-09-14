/**
 * Subsurface prospectivity screening from a Macrostrat stratigraphic column.
 *
 * ## What this does, and what it does not
 *
 * It reads the column, classifies each unit's rock type, and scores the two
 * things the rocks alone can tell you about:
 *
 *   **Groundwater** — which intervals can store and transmit water (porosity
 *   × permeability × thickness), which ones confine them, whether the water at
 *   that depth is likely to still be fresh, and roughly how deep the water
 *   table sits given the local relief.
 *
 *   **Hydrocarbons** — whether the column contains the four elements a
 *   petroleum system needs: an organic-rich **source** rock that has been
 *   buried into the oil window, a porous **reservoir**, an impermeable
 *   **seal** above it, and a **trap**. The first three are readable from
 *   lithology and depth. The fourth is not.
 *
 * ## The honest caveat
 *
 * Trap geometry — the anticline, the fault block, the pinch-out that actually
 * holds the hydrocarbons in place — is a *structural* question answered by
 * seismic reflection surveys, not by a stratigraphic column. So the trap term
 * here is a stratigraphic proxy and is deliberately capped, which caps every
 * hydrocarbon score with it. Likewise there are no well logs, no
 * geochemistry, no pump tests and no water-level measurements behind the
 * aquifer scores. Everything this module produces is a **screening
 * indicator**: where a hydrogeologist or an exploration geologist would look
 * first. It is not a discovery, and the UI says so wherever a score appears.
 */

import type { GeologicalColumn, GeologicalUnit } from '@/types/geology';
import type {
  LithologyClass,
  PetroleumSystem,
  ProspectConfidence,
  ProspectZone,
  ProspectivityReport,
} from '@/types/subsurface';
import {
  blendedPhysics,
  classifyLithology,
  permeabilityScore,
  porosityScore,
} from '@/lib/geology/lithology';

/* ================================================================== */
/*  Model constants                                                    */
/* ================================================================== */

/** Below this depth groundwater is usually too saline or too costly to use. */
const FRESHWATER_LIMIT_M = 800;
/** Default geothermal gradient, °C/km — a typical stable continental value. */
const DEFAULT_GRADIENT = 25;
/** Gradient used where the column contains substantial volcanic rock. */
const VOLCANIC_GRADIENT = 38;
/** Mean annual surface temperature assumed at the top of the column, °C. */
const SURFACE_TEMP_C = 15;

/** The oil window, °C. */
const OIL_WINDOW_MIN = 60;
const OIL_WINDOW_PEAK = 100;
const OIL_WINDOW_MAX = 150;
/** Above this, liquids are cracked to gas. */
const GAS_WINDOW_MAX = 200;

/**
 * Hard ceiling on the trap term. Without seismic there is no way to know
 * whether a structure exists, so no play here can ever look like a sure thing.
 */
const TRAP_CEILING = 0.45;

/** Minimum thickness for an interval to be worth calling out, metres. */
const MIN_ZONE_THICKNESS = 15;

/* ================================================================== */
/*  Column preparation                                                 */
/* ================================================================== */

interface PreparedUnit {
  unit: GeologicalUnit;
  depthTop: number;
  depthBottom: number;
  thickness: number;
  dominant: LithologyClass;
  classes: LithologyClass[];
  interbedded: boolean;
  physics: ReturnType<typeof blendedPhysics>;
}

/**
 * Stack the column from the surface down, youngest first, and classify each
 * unit. Depths are below ground level, not below sea level.
 */
function prepare(column: GeologicalColumn, maxDepth: number): PreparedUnit[] {
  const sorted = [...column.units].sort((a, b) => a.age_top - b.age_top);

  const out: PreparedUnit[] = [];
  let depth = 0;

  for (const unit of sorted) {
    if (depth >= maxDepth) break;

    const raw = Number.isFinite(unit.thickness) && unit.thickness > 0 ? unit.thickness : 100;
    const thickness = Math.min(raw, maxDepth - depth);
    const { dominant, all, interbedded } = classifyLithology(unit.lith);

    out.push({
      unit,
      depthTop: depth,
      depthBottom: depth + thickness,
      thickness,
      dominant,
      classes: all,
      interbedded,
      physics: blendedPhysics(all),
    });

    depth += thickness;
  }

  return out;
}

/** Temperature at a depth, °C. */
function temperatureAt(depthM: number, gradient: number): number {
  return SURFACE_TEMP_C + (depthM / 1000) * gradient;
}

/**
 * Thermal maturity of a source rock, 0–1.
 *
 * Peaks in the middle of the oil window and falls away on both sides:
 * immature above it, over-cooked below it. Gas-prone temperatures keep a
 * reduced score rather than zero, because they are still a working system.
 */
function maturityAt(depthM: number, gradient: number): number {
  const t = temperatureAt(depthM, gradient);
  if (t < OIL_WINDOW_MIN) return Math.max(0, (t - 30) / (OIL_WINDOW_MIN - 30)) * 0.35;
  if (t <= OIL_WINDOW_PEAK) return 0.35 + 0.65 * ((t - OIL_WINDOW_MIN) / (OIL_WINDOW_PEAK - OIL_WINDOW_MIN));
  if (t <= OIL_WINDOW_MAX) return 1 - 0.25 * ((t - OIL_WINDOW_PEAK) / (OIL_WINDOW_MAX - OIL_WINDOW_PEAK));
  if (t <= GAS_WINDOW_MAX) return 0.75 - 0.45 * ((t - OIL_WINDOW_MAX) / (GAS_WINDOW_MAX - OIL_WINDOW_MAX));
  return 0.15;
}

/**
 * Porosity loss with burial. Sandstone compacts roughly exponentially with a
 * ~3 km e-folding depth; carbonates cement faster. This keeps deep units from
 * scoring as if they were outcrop-fresh.
 */
function compactionFactor(depthM: number, klass: LithologyClass): number {
  const carbonate = klass === 'limestone' || klass === 'dolomite' || klass === 'chalk';
  const efold = carbonate ? 2200 : 3200;
  return Math.exp(-depthM / efold);
}

/* ================================================================== */
/*  Water table                                                        */
/* ================================================================== */

/**
 * First-order depth to the water table, metres below ground.
 *
 * The water table is a subdued replica of the land surface, so relief is the
 * strongest single predictor available without measurements: flat ground near
 * a valley floor has shallow water, a steep upland does not. Latitude adds a
 * crude aridity term — the subtropical dry belts sit around 15–35°, where
 * water tables are systematically deeper.
 *
 * Returns `null` when the column has no permeable unit at all, because then
 * there is no water table worth quoting.
 */
function estimateWaterTable(
  units: PreparedUnit[],
  relief: number,
  latitude: number,
): number | null {
  const hasAquifer = units.some((u) => permeabilityScore(u.physics.logPermMd) > 0.35);
  if (!hasAquifer) return null;

  const absLat = Math.abs(latitude);
  // Peaks at 25°, falls off toward the equator and the temperate mid-latitudes.
  const aridity = Math.max(0, 1 - Math.abs(absLat - 25) / 25);
  const aridBase = 4 + aridity * 26;

  // Roughly a sixth of the local relief, which is the usual order for the
  // water-table gradient under hilly terrain.
  const reliefTerm = Math.max(0, relief) * 0.16;

  // A permeable unit right at the surface drains freely and sits deeper.
  const topUnit = units[0];
  const topDrainage = topUnit ? permeabilityScore(topUnit.physics.logPermMd) * 8 : 0;

  return Math.max(1, Math.min(150, aridBase + reliefTerm + topDrainage));
}

/* ================================================================== */
/*  Aquifer scoring                                                    */
/* ================================================================== */

function confidenceFor(score: number, unknownShare: number): ProspectConfidence {
  if (unknownShare > 0.5) return 'low';
  if (score >= 0.6 && unknownShare < 0.25) return 'indicative';
  if (score >= 0.4) return 'moderate';
  return 'low';
}

function scoreAquifers(
  units: PreparedUnit[],
  waterTable: number | null,
  unknownShare: number,
): ProspectZone[] {
  const zones: ProspectZone[] = [];

  units.forEach((unit, index) => {
    if (unit.thickness < MIN_ZONE_THICKNESS) return;

    const { physics, dominant } = unit;
    const midDepth = (unit.depthTop + unit.depthBottom) / 2;

    const compaction = compactionFactor(midDepth, dominant);
    const primary = porosityScore(physics.porosity * compaction);
    const perm = permeabilityScore(physics.logPermMd);
    const secondary = physics.secondaryPorosity;

    // A tight rock with strong fracture or karst porosity is still an aquifer —
    // the Floridan and the basalt aquifers of the Deccan work exactly that way.
    const storage = Math.max(primary, secondary * 0.85);
    const transmission = Math.max(perm, secondary * 0.8);
    if (storage < 0.18 || transmission < 0.3) return;

    // Thickness saturates: past ~250 m more rock stops adding much.
    const thicknessScore = Math.min(1, unit.thickness / 250);

    // Confinement: an overlying seal protects the aquifer and can make it
    // artesian, which is a plus for quality even though it costs recharge.
    const above = units[index - 1];
    const confinement = above ? above.physics.sealQuality : 0;

    // Depth: below the freshwater limit, water is usually brackish to saline.
    const depthPenalty =
      midDepth <= FRESHWATER_LIMIT_M
        ? 0
        : Math.min(0.75, (midDepth - FRESHWATER_LIMIT_M) / 1500);

    const freshness = physics.freshwaterLikely ? 1 : 0.55;

    const score = Math.max(
      0,
      Math.min(
        1,
        (storage * 0.3 + transmission * 0.32 + thicknessScore * 0.18 + confinement * 0.2) *
          freshness -
          depthPenalty,
      ),
    );

    if (score < 0.28) return;

    const evidence: string[] = [
      `${(physics.porosity * compaction * 100).toFixed(0)} % effective porosity at ${midDepth.toFixed(0)} m`,
      `permeability ≈ 10^${physics.logPermMd.toFixed(1)} md for ${dominant}`,
      `${unit.thickness.toFixed(0)} m thick`,
    ];
    if (secondary > 0.5) {
      evidence.push(
        dominant === 'volcanic'
          ? 'flow-top breccia and cooling joints add fracture permeability'
          : 'karst / fracture porosity likely dominates flow',
      );
    }
    if (confinement > 0.6) {
      evidence.push(`confined beneath ${above?.unit.strat_name ?? 'an overlying aquitard'}`);
    } else if (unit.depthTop < 40) {
      evidence.push('unconfined and open to recharge — and to surface contamination');
    }
    if (waterTable !== null && unit.depthBottom > waterTable) {
      evidence.push(`saturated below the estimated water table at ~${waterTable.toFixed(0)} m`);
    }

    const caveats: string[] = [
      'No pump test, well log or water-level measurement backs this — storage and yield are inferred from rock type alone.',
    ];
    if (!physics.freshwaterLikely) {
      caveats.push('Water in this lithology is often brackish; salinity is unverified.');
    }
    if (midDepth > FRESHWATER_LIMIT_M) {
      caveats.push(`Below ~${FRESHWATER_LIMIT_M} m most groundwater is saline.`);
    }
    if (unit.interbedded) {
      caveats.push('Interbedded unit — flow may be confined to thin permeable beds.');
    }

    zones.push({
      id: `aq-${unit.unit.unit_id}`,
      kind: 'aquifer',
      title: `${unit.unit.strat_name} — ${confinement > 0.6 ? 'confined' : 'unconfined'} aquifer`,
      unitName: unit.unit.strat_name,
      lithology: dominant,
      depthTop: unit.depthTop,
      depthBottom: unit.depthBottom,
      score,
      confidence: confidenceFor(score, unknownShare),
      evidence,
      caveats,
      elements: {
        storage,
        transmission,
        thickness: thicknessScore,
        confinement,
        freshness,
      },
    });
  });

  return zones.sort((a, b) => b.score - a.score);
}

/* ================================================================== */
/*  Petroleum system                                                   */
/* ================================================================== */

interface SourceCandidate {
  unit: PreparedUnit;
  richness: number;
  maturity: number;
  score: number;
}

function findSources(units: PreparedUnit[], gradient: number): SourceCandidate[] {
  return units
    .map((unit) => {
      const midDepth = (unit.depthTop + unit.depthBottom) / 2;
      const maturity = maturityAt(midDepth, gradient);
      // Thin source rocks do not charge much; 50 m is a reasonable saturation.
      const richness = unit.physics.sourcePotential * Math.min(1, unit.thickness / 50);
      return { unit, richness, maturity, score: richness * maturity };
    })
    .filter((c) => c.richness > 0.15)
    .sort((a, b) => b.score - a.score);
}

function scoreHydrocarbons(
  units: PreparedUnit[],
  gradient: number,
  unknownShare: number,
): { zones: ProspectZone[]; system: PetroleumSystem } {
  const sources = findSources(units, gradient);
  const zones: ProspectZone[] = [];

  let bestSource = 0;
  let bestMaturity = 0;
  let bestReservoir = 0;
  let bestSeal = 0;
  let bestTrap = 0;
  let ordering = false;

  if (sources.length > 0) {
    bestSource = sources[0].richness;
    bestMaturity = sources[0].maturity;
  }

  units.forEach((unit, index) => {
    if (unit.thickness < MIN_ZONE_THICKNESS) return;

    const midDepth = (unit.depthTop + unit.depthBottom) / 2;
    const compaction = compactionFactor(midDepth, unit.dominant);
    const porosity = porosityScore(unit.physics.porosity * compaction);
    const perm = permeabilityScore(unit.physics.logPermMd);
    const reservoir = Math.max(porosity * 0.55 + perm * 0.45, unit.physics.secondaryPorosity * 0.6);

    if (reservoir > bestReservoir) bestReservoir = reservoir;
    if (reservoir < 0.35) return;

    // Seal: the best sealing unit anywhere above this one. A regional seal two
    // units up still works; a leaky bed directly above does not disqualify it.
    let seal = 0;
    let sealUnit: PreparedUnit | null = null;
    for (let i = index - 1; i >= 0; i--) {
      if (units[i].physics.sealQuality > seal) {
        seal = units[i].physics.sealQuality;
        sealUnit = units[i];
      }
    }
    if (seal > bestSeal) bestSeal = seal;
    if (seal < 0.5) return;

    // Charge: any mature source below the reservoir (or, less ideally, above,
    // since hydrocarbons can migrate down a fault).
    let charge = 0;
    let chargeUnit: PreparedUnit | null = null;
    for (const candidate of sources) {
      const below = candidate.unit.depthTop >= unit.depthBottom;
      const value = candidate.score * (below ? 1 : 0.6);
      if (value > charge) {
        charge = value;
        chargeUnit = candidate.unit;
        if (below) ordering = true;
      }
    }
    if (charge < 0.12) return;

    /* ---- Trap: a stratigraphic proxy only ---- */
    // A thick, high-quality seal directly above the reservoir is the one trap
    // ingredient a column can actually evidence. Everything structural is
    // invisible here, hence the ceiling.
    const directSeal = units[index - 1];
    const directlySealed = directSeal ? directSeal.physics.sealQuality : 0;
    const sealThickness = sealUnit ? Math.min(1, sealUnit.thickness / 120) : 0;
    const trap = Math.min(TRAP_CEILING, (directlySealed * 0.6 + sealThickness * 0.4) * TRAP_CEILING / 0.9);
    if (trap > bestTrap) bestTrap = trap;

    // Chance of success is multiplicative: every element must be present.
    const score = Math.max(0, Math.min(1, Math.pow(charge * reservoir * seal * (trap / TRAP_CEILING), 0.25) * (0.55 + trap)));
    if (score < 0.22) return;

    const phase =
      temperatureAt(midDepth, gradient) > OIL_WINDOW_MAX ? 'gas-prone' : 'oil-prone';

    const evidence: string[] = [
      `reservoir: ${unit.dominant}, ${(unit.physics.porosity * compaction * 100).toFixed(0)} % porosity at ${midDepth.toFixed(0)} m`,
      `seal: ${sealUnit?.unit.strat_name ?? 'overlying unit'} (${sealUnit?.dominant ?? 'aquitard'}), sealing capacity ${(seal * 100).toFixed(0)} %`,
    ];
    if (chargeUnit) {
      const chargeDepth = (chargeUnit.depthTop + chargeUnit.depthBottom) / 2;
      evidence.push(
        `source: ${chargeUnit.unit.strat_name} at ${chargeDepth.toFixed(0)} m, ` +
          `${temperatureAt(chargeDepth, gradient).toFixed(0)} °C — ${phase}`,
      );
    }
    if (unit.physics.secondaryPorosity > 0.5) {
      evidence.push('fractured / vuggy carbonate reservoir potential');
    }

    const caveats: string[] = [
      'Trap geometry is unknown. Structural closure needs seismic reflection data, so this score is capped and cannot indicate a discovery.',
      'No well log, core, or source-rock geochemistry backs the charge estimate.',
      `Thermal maturity assumes a uniform ${gradient} °C/km gradient and no burial or uplift history.`,
    ];
    if (!ordering) {
      caveats.push('The mature source sits above the reservoir — migration would need a fault pathway.');
    }

    zones.push({
      id: `hc-${unit.unit.unit_id}`,
      kind: 'hydrocarbon',
      title: `${unit.unit.strat_name} — ${phase} reservoir target`,
      unitName: unit.unit.strat_name,
      lithology: unit.dominant,
      depthTop: unit.depthTop,
      depthBottom: unit.depthBottom,
      score,
      confidence: confidenceFor(score, unknownShare),
      evidence,
      caveats,
      elements: { charge, reservoir, seal, trap, maturity: bestMaturity },
    });
  });

  return {
    zones: zones.sort((a, b) => b.score - a.score),
    system: {
      source: bestSource,
      reservoir: bestReservoir,
      seal: bestSeal,
      trap: bestTrap,
      maturity: bestMaturity,
      ordering,
    },
  };
}

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

export interface ProspectivityOptions {
  /** Mean surface elevation of the region, metres. */
  surfaceElevation?: number;
  /** Local relief (max − min elevation), metres — drives the water table. */
  relief?: number;
  /** How deep to analyse, metres. */
  maxDepth?: number;
}

/**
 * Screen a Macrostrat column for groundwater and hydrocarbon potential.
 *
 * Returns `null` when the column carries no units, which is common outside
 * Macrostrat's better-covered regions.
 */
export function analyseProspectivity(
  column: GeologicalColumn,
  { surfaceElevation = 0, relief = 0, maxDepth = 5000 }: ProspectivityOptions = {},
): ProspectivityReport | null {
  const units = prepare(column, maxDepth);
  if (units.length === 0) return null;

  const unknownShare = units.filter((u) => u.dominant === 'unknown').length / units.length;
  const volcanicShare =
    units.filter((u) => u.dominant === 'volcanic' || u.dominant === 'plutonic').length / units.length;
  const gradient = volcanicShare > 0.3 ? VOLCANIC_GRADIENT : DEFAULT_GRADIENT;

  const waterTable = estimateWaterTable(units, relief, column.lat);
  const aquifers = scoreAquifers(units, waterTable, unknownShare);
  const { zones: hydrocarbons, system } = scoreHydrocarbons(units, gradient, unknownShare);

  const notes: string[] = [];
  if (unknownShare > 0.3) {
    notes.push(
      `${Math.round(unknownShare * 100)} % of the column has no usable lithology description — scores below are weak.`,
    );
  }
  const totalDepth = units[units.length - 1].depthBottom;
  if (totalDepth < 500) {
    notes.push(
      `Macrostrat only resolves ${totalDepth.toFixed(0)} m here, so anything deeper is unassessed.`,
    );
  }
  if (hydrocarbons.length === 0) {
    notes.push('No interval combines a reservoir, a seal and a mature source — no petroleum play is indicated.');
  }
  if (aquifers.length === 0) {
    notes.push('No interval has both the porosity and the permeability to work as an aquifer.');
  }
  if (volcanicShare > 0.3) {
    notes.push(`Volcanic-dominated column — a higher ${VOLCANIC_GRADIENT} °C/km gradient was assumed.`);
  }

  return {
    columnId: column.col_id,
    columnName: column.name,
    lat: column.lat,
    lng: column.lng,
    surfaceElevation,
    waterTableDepth: waterTable,
    geothermalGradient: gradient,
    aquifers,
    hydrocarbons,
    petroleumSystem: system,
    notes,
  };
}

/** Display colour for a zone, by kind and strength. */
export function zoneColor(zone: ProspectZone): string {
  if (zone.kind === 'aquifer') {
    return zone.score > 0.6 ? '#0ea5e9' : zone.score > 0.45 ? '#38bdf8' : '#7dd3fc';
  }
  return zone.score > 0.5 ? '#f59e0b' : zone.score > 0.35 ? '#fbbf24' : '#fcd34d';
}

/** Human label for a confidence level, spelled out so it cannot be overread. */
export const CONFIDENCE_LABELS: Record<ProspectConfidence, string> = {
  low: 'Low — weak or missing lithology data',
  moderate: 'Moderate — consistent rock types, unverified',
  indicative: 'Indicative — worth a real survey',
};

/** The disclaimer shown wherever these numbers appear. */
export const PROSPECT_DISCLAIMER =
  'Screening indicator derived from Macrostrat lithology only. No seismic, well-log, ' +
  'geochemical or water-level data is involved. Not a survey, and not evidence that ' +
  'water or hydrocarbons are present.';
