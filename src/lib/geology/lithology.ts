/**
 * Lithology normalisation and first-order petrophysics.
 *
 * Macrostrat reports rock type as free text — "sandstone, shale", "dolomite",
 * "basalt flows, tuff". This module turns that into a small set of classes
 * with the properties that control whether a rock can hold and release water
 * or hydrocarbons: porosity, permeability, sealing capacity, organic richness,
 * and how much of its storage comes from fractures or karst rather than pores.
 *
 * The numbers are representative literature values for a typical example of
 * the class at shallow to moderate burial. They are used to rank units
 * *against each other* in one column, never to predict an absolute yield.
 */

import type { LithologyClass, PetroPhysics } from '@/types/subsurface';

/* ================================================================== */
/*  Class properties                                                   */
/* ================================================================== */

export const PETROPHYSICS: Record<LithologyClass, PetroPhysics> = {
  conglomerate: {
    porosity: 0.25,
    logPermMd: 3.4,
    sealQuality: 0.02,
    sourcePotential: 0.0,
    secondaryPorosity: 0.15,
    freshwaterLikely: true,
  },
  sandstone: {
    porosity: 0.22,
    logPermMd: 2.6,
    sealQuality: 0.05,
    sourcePotential: 0.02,
    secondaryPorosity: 0.1,
    freshwaterLikely: true,
  },
  alluvium: {
    porosity: 0.3,
    logPermMd: 3.8,
    sealQuality: 0.02,
    sourcePotential: 0.02,
    secondaryPorosity: 0.05,
    freshwaterLikely: true,
  },
  glacial: {
    // Till is tight; outwash sand and gravel is not. The class average sits
    // between, which is why glacial units score moderately either way.
    porosity: 0.2,
    logPermMd: 1.4,
    sealQuality: 0.3,
    sourcePotential: 0.01,
    secondaryPorosity: 0.05,
    freshwaterLikely: true,
  },
  siltstone: {
    porosity: 0.16,
    logPermMd: 0.2,
    sealQuality: 0.45,
    sourcePotential: 0.15,
    secondaryPorosity: 0.08,
    freshwaterLikely: true,
  },
  shale: {
    porosity: 0.08,
    logPermMd: -4.0,
    sealQuality: 0.88,
    sourcePotential: 0.75,
    secondaryPorosity: 0.2,
    freshwaterLikely: false,
  },
  mudstone: {
    porosity: 0.1,
    logPermMd: -3.4,
    sealQuality: 0.82,
    sourcePotential: 0.5,
    secondaryPorosity: 0.12,
    freshwaterLikely: false,
  },
  marl: {
    porosity: 0.14,
    logPermMd: -1.8,
    sealQuality: 0.65,
    sourcePotential: 0.45,
    secondaryPorosity: 0.15,
    freshwaterLikely: false,
  },
  limestone: {
    porosity: 0.14,
    logPermMd: 1.0,
    sealQuality: 0.25,
    sourcePotential: 0.1,
    // Karst is the reason limestone hosts some of the world's biggest aquifers.
    secondaryPorosity: 0.75,
    freshwaterLikely: true,
  },
  chalk: {
    porosity: 0.32,
    logPermMd: 0.4,
    sealQuality: 0.2,
    sourcePotential: 0.08,
    secondaryPorosity: 0.55,
    freshwaterLikely: true,
  },
  dolomite: {
    porosity: 0.12,
    logPermMd: 1.4,
    sealQuality: 0.2,
    sourcePotential: 0.06,
    secondaryPorosity: 0.7,
    freshwaterLikely: true,
  },
  evaporite: {
    // Halite and anhydrite are the best regional seals there are.
    porosity: 0.03,
    logPermMd: -6.0,
    sealQuality: 0.97,
    sourcePotential: 0.05,
    secondaryPorosity: 0.02,
    freshwaterLikely: false,
  },
  coal: {
    porosity: 0.06,
    logPermMd: -2.0,
    sealQuality: 0.55,
    sourcePotential: 0.9,
    secondaryPorosity: 0.35,
    freshwaterLikely: false,
  },
  chert: {
    porosity: 0.04,
    logPermMd: -3.0,
    sealQuality: 0.7,
    sourcePotential: 0.25,
    secondaryPorosity: 0.4,
    freshwaterLikely: false,
  },
  volcanic: {
    porosity: 0.1,
    logPermMd: 0.2,
    sealQuality: 0.4,
    sourcePotential: 0.0,
    // Basalt aquifers live entirely in cooling joints and flow-top breccias.
    secondaryPorosity: 0.65,
    freshwaterLikely: true,
  },
  plutonic: {
    porosity: 0.01,
    logPermMd: -4.5,
    sealQuality: 0.9,
    sourcePotential: 0.0,
    secondaryPorosity: 0.3,
    freshwaterLikely: true,
  },
  metamorphic: {
    porosity: 0.02,
    logPermMd: -4.0,
    sealQuality: 0.85,
    sourcePotential: 0.0,
    secondaryPorosity: 0.35,
    freshwaterLikely: true,
  },
  unknown: {
    porosity: 0.1,
    logPermMd: -1.0,
    sealQuality: 0.4,
    sourcePotential: 0.1,
    secondaryPorosity: 0.2,
    freshwaterLikely: false,
  },
};

/** Display colour per class, used by the prospect panel and the 3D stack. */
export const LITHOLOGY_COLORS: Record<LithologyClass, string> = {
  sandstone: '#e0c36a',
  conglomerate: '#c9a86a',
  siltstone: '#c8b98c',
  shale: '#6b7280',
  mudstone: '#7c7f86',
  limestone: '#63b3d1',
  dolomite: '#7fa8c9',
  chalk: '#dbe9f2',
  marl: '#9fb0a8',
  evaporite: '#d8c7e8',
  coal: '#2f2f2f',
  chert: '#a08f7a',
  volcanic: '#a4553f',
  plutonic: '#b06d8a',
  metamorphic: '#8a7fa8',
  alluvium: '#d9d2ab',
  glacial: '#c6cdd4',
  unknown: '#9ca3af',
};

export const LITHOLOGY_LABELS: Record<LithologyClass, string> = {
  sandstone: 'Sandstone',
  conglomerate: 'Conglomerate',
  siltstone: 'Siltstone',
  shale: 'Shale',
  mudstone: 'Mudstone',
  limestone: 'Limestone',
  dolomite: 'Dolomite',
  chalk: 'Chalk',
  marl: 'Marl',
  evaporite: 'Evaporite',
  coal: 'Coal',
  chert: 'Chert',
  volcanic: 'Volcanic',
  plutonic: 'Plutonic',
  metamorphic: 'Metamorphic',
  alluvium: 'Alluvium',
  glacial: 'Glacial deposits',
  unknown: 'Unknown',
};

/* ================================================================== */
/*  Text → class                                                       */
/* ================================================================== */

/**
 * Keyword → class. Order matters: the list is scanned in sequence, so
 * multi-word and more specific terms come before the generic ones they
 * contain (`dolomitic limestone` before `limestone`).
 */
const KEYWORDS: Array<[RegExp, LithologyClass]> = [
  [/\b(halite|anhydrite|gypsum|evaporite|salt)\b/, 'evaporite'],
  [/\b(coal|lignite|anthracite)\b/, 'coal'],
  [/\b(chert|flint|novaculite)\b/, 'chert'],
  [/\b(chalk)\b/, 'chalk'],
  [/\b(dolostone|dolomite|dolomitic)\b/, 'dolomite'],
  [/\b(marl|marlstone)\b/, 'marl'],
  [/\b(limestone|carbonate|calcarenite|grainstone|packstone|wackestone|mudstone \(carbonate\)|travertine|reef)\b/, 'limestone'],
  [/\b(shale|argillite|claystone|clay)\b/, 'shale'],
  [/\b(mudstone|mud)\b/, 'mudstone'],
  [/\b(siltstone|silt)\b/, 'siltstone'],
  [/\b(conglomerate|breccia|gravel|diamictite)\b/, 'conglomerate'],
  [/\b(sandstone|arenite|greywacke|graywacke|arkose|quartzite \(sedimentary\)|sand)\b/, 'sandstone'],
  [/\b(alluvium|alluvial|fluvial|colluvium|loess|terrace deposits)\b/, 'alluvium'],
  [/\b(till|moraine|glacial|outwash|drift)\b/, 'glacial'],
  [/\b(basalt|andesite|rhyolite|tuff|volcanic|lava|ignimbrite|pyroclastic|dacite|trachyte)\b/, 'volcanic'],
  [/\b(granite|granodiorite|diorite|gabbro|plutonic|intrusive|syenite|tonalite|peridotite)\b/, 'plutonic'],
  [/\b(gneiss|schist|slate|phyllite|amphibolite|marble|quartzite|migmatite|metamorphic|metasediment)\b/, 'metamorphic'],
];

/**
 * Classify one Macrostrat lithology string.
 *
 * Macrostrat joins several rock types with commas, ordered roughly by
 * abundance, so the first recognised term wins — that is the dominant rock.
 * Returns every class found as well, because a "sandstone, shale" unit is an
 * interbedded sequence and behaves differently from clean sandstone.
 */
export function classifyLithology(raw: string | undefined): {
  dominant: LithologyClass;
  all: LithologyClass[];
  /** True when several distinct classes are present — an interbedded unit. */
  interbedded: boolean;
} {
  if (!raw || !raw.trim() || /^unknown$/i.test(raw.trim())) {
    return { dominant: 'unknown', all: ['unknown'], interbedded: false };
  }

  const text = raw.toLowerCase();
  const parts = text.split(/[,;/]+/).map((p) => p.trim()).filter(Boolean);
  const found: LithologyClass[] = [];

  for (const part of parts.length > 0 ? parts : [text]) {
    for (const [pattern, klass] of KEYWORDS) {
      if (pattern.test(part)) {
        if (!found.includes(klass)) found.push(klass);
        break;
      }
    }
  }

  if (found.length === 0) {
    // Fall back to scanning the whole string; Macrostrat sometimes writes
    // a phrase the comma split does not isolate.
    for (const [pattern, klass] of KEYWORDS) {
      if (pattern.test(text)) {
        found.push(klass);
        break;
      }
    }
  }

  if (found.length === 0) return { dominant: 'unknown', all: ['unknown'], interbedded: false };
  return { dominant: found[0], all: found, interbedded: found.length > 1 };
}

/**
 * Effective petrophysics for a unit, blending the dominant rock with the
 * subordinate ones. An interbedded sand–shale unit is a poorer reservoir and
 * a better seal than clean sand, which is exactly what the blend produces.
 */
export function blendedPhysics(classes: LithologyClass[]): PetroPhysics {
  if (classes.length === 0) return PETROPHYSICS.unknown;
  if (classes.length === 1) return PETROPHYSICS[classes[0]];

  // The dominant lithology carries most of the weight; the rest share the
  // remainder equally, which keeps a three-rock unit from being mush.
  const weights = classes.map((_, i) => (i === 0 ? 0.6 : 0.4 / (classes.length - 1)));

  const blend: PetroPhysics = {
    porosity: 0,
    logPermMd: 0,
    sealQuality: 0,
    sourcePotential: 0,
    secondaryPorosity: 0,
    freshwaterLikely: false,
  };

  classes.forEach((klass, i) => {
    const p = PETROPHYSICS[klass];
    const w = weights[i];
    blend.porosity += p.porosity * w;
    blend.logPermMd += p.logPermMd * w;
    blend.sealQuality += p.sealQuality * w;
    blend.sourcePotential += p.sourcePotential * w;
    blend.secondaryPorosity += p.secondaryPorosity * w;
  });

  // Fresh water only if the dominant rock usually hosts it.
  blend.freshwaterLikely = PETROPHYSICS[classes[0]].freshwaterLikely;
  return blend;
}

/** Normalise log permeability (md) onto 0–1 across the geological range. */
export function permeabilityScore(logPermMd: number): number {
  return Math.max(0, Math.min(1, (logPermMd + 6) / 10));
}

/** Normalise porosity onto 0–1, treating 35 % as the practical maximum. */
export function porosityScore(porosity: number): number {
  return Math.max(0, Math.min(1, porosity / 0.35));
}
