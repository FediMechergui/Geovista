/**
 * Building-material resolution and procedural facade textures.
 *
 * ## Why this exists
 *
 * A digital twin that paints every building the same beige is a diagram, not
 * a twin. OpenStreetMap actually carries the answer for a large minority of
 * buildings — `building:material`, `building:facade:material`, `roof:material`,
 * `building:colour`, `roof:colour` — and for the rest the building's use, age
 * and size narrow it down a long way. A 1890 church is stone; a 40-storey
 * office finished in 2015 is a glass curtain wall; a warehouse is profiled
 * metal. Those are not guesses in the arbitrary sense, they are how buildings
 * of that kind are built.
 *
 * So each building gets a material *and* a record of where that material came
 * from, and the UI reports the mix and the mean confidence. Inference is
 * labelled as inference rather than dressed up as data.
 */

import type {
  BuildingData,
  BuildingMaterialAssignment,
  BuildingProperties,
  MaterialBreakdown,
  MaterialSource,
  SurfaceMaterial,
} from '@/types/buildings';

/* ================================================================== */
/*  Material library                                                   */
/* ================================================================== */

/**
 * Physically-plausible render parameters per material.
 *
 * `roughness` and `metalness` follow the usual PBR conventions: polished
 * glass and metal are smooth and reflective, masonry and render are not.
 */
export const MATERIALS: Record<string, SurfaceMaterial> = {
  brick: {
    key: 'brick',
    label: 'Brick',
    color: '#9c5a43',
    roughness: 0.92,
    metalness: 0.0,
    reflectivity: 0.18,
    windows: true,
    windowGlow: 0.1,
    variation: 0.1,
  },
  concrete: {
    key: 'concrete',
    label: 'Concrete',
    color: '#b6b4ae',
    roughness: 0.88,
    metalness: 0.0,
    reflectivity: 0.2,
    windows: true,
    windowGlow: 0.09,
    variation: 0.07,
  },
  plaster: {
    key: 'plaster',
    label: 'Render / plaster',
    color: '#ddd6c7',
    roughness: 0.9,
    metalness: 0.0,
    reflectivity: 0.2,
    windows: true,
    windowGlow: 0.08,
    variation: 0.12,
  },
  glass: {
    key: 'glass',
    label: 'Glass curtain wall',
    color: '#7d97ab',
    roughness: 0.12,
    metalness: 0.35,
    reflectivity: 0.85,
    windows: true,
    windowGlow: 0.22,
    variation: 0.05,
  },
  metal: {
    key: 'metal',
    label: 'Metal cladding',
    color: '#9aa3ab',
    roughness: 0.42,
    metalness: 0.75,
    reflectivity: 0.6,
    windows: false,
    windowGlow: 0.0,
    variation: 0.06,
  },
  steel: {
    key: 'steel',
    label: 'Steel',
    color: '#8d959d',
    roughness: 0.34,
    metalness: 0.88,
    reflectivity: 0.7,
    windows: true,
    windowGlow: 0.12,
    variation: 0.05,
  },
  stone: {
    key: 'stone',
    label: 'Stone',
    color: '#c3b9a4',
    roughness: 0.94,
    metalness: 0.0,
    reflectivity: 0.16,
    windows: true,
    windowGlow: 0.06,
    variation: 0.09,
  },
  sandstone: {
    key: 'sandstone',
    label: 'Sandstone',
    color: '#cdac7c',
    roughness: 0.95,
    metalness: 0.0,
    reflectivity: 0.14,
    windows: true,
    windowGlow: 0.06,
    variation: 0.1,
  },
  limestone: {
    key: 'limestone',
    label: 'Limestone',
    color: '#ddd3ba',
    roughness: 0.93,
    metalness: 0.0,
    reflectivity: 0.16,
    windows: true,
    windowGlow: 0.06,
    variation: 0.08,
  },
  granite: {
    key: 'granite',
    label: 'Granite',
    color: '#8f8b88',
    roughness: 0.72,
    metalness: 0.02,
    reflectivity: 0.28,
    windows: true,
    windowGlow: 0.07,
    variation: 0.07,
  },
  marble: {
    key: 'marble',
    label: 'Marble',
    color: '#eae7e1',
    roughness: 0.34,
    metalness: 0.02,
    reflectivity: 0.45,
    windows: true,
    windowGlow: 0.07,
    variation: 0.05,
  },
  wood: {
    key: 'wood',
    label: 'Timber',
    color: '#9a6f45',
    roughness: 0.88,
    metalness: 0.0,
    reflectivity: 0.18,
    windows: true,
    windowGlow: 0.1,
    variation: 0.12,
  },
  adobe: {
    key: 'adobe',
    label: 'Adobe / mud brick',
    color: '#c19a6b',
    roughness: 0.97,
    metalness: 0.0,
    reflectivity: 0.1,
    windows: true,
    windowGlow: 0.05,
    variation: 0.14,
  },
  cement_block: {
    key: 'cement_block',
    label: 'Cement block',
    color: '#b9b6ae',
    roughness: 0.93,
    metalness: 0.0,
    reflectivity: 0.16,
    windows: true,
    windowGlow: 0.06,
    variation: 0.09,
  },
  corrugated_iron: {
    key: 'corrugated_iron',
    label: 'Corrugated iron',
    color: '#8b9096',
    roughness: 0.55,
    metalness: 0.65,
    reflectivity: 0.45,
    windows: false,
    windowGlow: 0.0,
    variation: 0.1,
  },
  /* ---- Roof-only materials ---- */
  roof_tiles: {
    key: 'roof_tiles',
    label: 'Roof tiles',
    color: '#a8462e',
    roughness: 0.9,
    metalness: 0.0,
    reflectivity: 0.2,
    windows: false,
    windowGlow: 0.0,
    variation: 0.12,
  },
  slate: {
    key: 'slate',
    label: 'Slate',
    color: '#4a5058',
    roughness: 0.72,
    metalness: 0.05,
    reflectivity: 0.3,
    windows: false,
    windowGlow: 0.0,
    variation: 0.07,
  },
  copper: {
    key: 'copper',
    label: 'Copper (patinated)',
    color: '#5aa08a',
    roughness: 0.45,
    metalness: 0.7,
    reflectivity: 0.6,
    windows: false,
    windowGlow: 0.0,
    variation: 0.06,
  },
  zinc: {
    key: 'zinc',
    label: 'Zinc',
    color: '#9ba2a8',
    roughness: 0.5,
    metalness: 0.72,
    reflectivity: 0.55,
    windows: false,
    windowGlow: 0.0,
    variation: 0.05,
  },
  thatch: {
    key: 'thatch',
    label: 'Thatch',
    color: '#b99a5c',
    roughness: 0.99,
    metalness: 0.0,
    reflectivity: 0.06,
    windows: false,
    windowGlow: 0.0,
    variation: 0.12,
  },
  bitumen: {
    key: 'bitumen',
    label: 'Bitumen / felt',
    color: '#4b4b4d',
    roughness: 0.95,
    metalness: 0.0,
    reflectivity: 0.1,
    windows: false,
    windowGlow: 0.0,
    variation: 0.06,
  },
  gravel_roof: {
    key: 'gravel_roof',
    label: 'Gravel ballast',
    color: '#8e8a80',
    roughness: 0.98,
    metalness: 0.0,
    reflectivity: 0.08,
    windows: false,
    windowGlow: 0.0,
    variation: 0.1,
  },
  green_roof: {
    key: 'green_roof',
    label: 'Green roof',
    color: '#5d7f4a',
    roughness: 0.97,
    metalness: 0.0,
    reflectivity: 0.08,
    windows: false,
    windowGlow: 0.0,
    variation: 0.14,
  },
  solar: {
    key: 'solar',
    label: 'Solar panels',
    color: '#1b2a45',
    roughness: 0.22,
    metalness: 0.45,
    reflectivity: 0.7,
    windows: false,
    windowGlow: 0.0,
    variation: 0.03,
  },
};

/** Raw OSM material value → library key. */
const MATERIAL_ALIASES: Record<string, string> = {
  // Masonry
  brick: 'brick',
  bricks: 'brick',
  brick_block: 'brick',
  masonry: 'stone',
  stone: 'stone',
  natural_stone: 'stone',
  rock: 'stone',
  sandstone: 'sandstone',
  limestone: 'limestone',
  granite: 'granite',
  marble: 'marble',
  tuff: 'sandstone',
  // Cementitious
  concrete: 'concrete',
  reinforced_concrete: 'concrete',
  cement: 'concrete',
  cement_block: 'cement_block',
  concrete_block: 'cement_block',
  breeze_block: 'cement_block',
  plaster: 'plaster',
  stucco: 'plaster',
  render: 'plaster',
  clay: 'adobe',
  mud: 'adobe',
  adobe: 'adobe',
  loam: 'adobe',
  earth: 'adobe',
  // Framed / clad
  glass: 'glass',
  glass_reinforced_plastic: 'glass',
  mirror: 'glass',
  steel: 'steel',
  metal: 'metal',
  aluminium: 'metal',
  aluminum: 'metal',
  tin: 'corrugated_iron',
  corrugated_iron: 'corrugated_iron',
  corrugated_metal: 'corrugated_iron',
  sheet_metal: 'metal',
  zinc: 'zinc',
  copper: 'copper',
  bronze: 'copper',
  wood: 'wood',
  timber: 'wood',
  timber_framing: 'wood',
  log: 'wood',
  bamboo: 'wood',
  plastic: 'metal',
  pvc: 'metal',
  vinyl: 'plaster',
  eternit: 'cement_block',
  fibre_cement: 'cement_block',
  // Roof coverings
  roof_tiles: 'roof_tiles',
  tile: 'roof_tiles',
  tiles: 'roof_tiles',
  clay_tiles: 'roof_tiles',
  slate: 'slate',
  shingle: 'wood',
  wood_shingle: 'wood',
  asphalt: 'bitumen',
  asphalt_shingle: 'bitumen',
  tar_paper: 'bitumen',
  bitumen: 'bitumen',
  roofing_felt: 'bitumen',
  membrane: 'bitumen',
  gravel: 'gravel_roof',
  grass: 'green_roof',
  green_roof: 'green_roof',
  thatch: 'thatch',
  straw: 'thatch',
  reed: 'thatch',
  solar_panels: 'solar',
  photovoltaic: 'solar',
};

/** OSM colour keywords that are not valid CSS colours. */
const COLOUR_ALIASES: Record<string, string> = {
  lightbrown: '#b08968',
  darkbrown: '#5b3a29',
  lightgrey: '#cfd2d4',
  lightgray: '#cfd2d4',
  darkgrey: '#4b5057',
  darkgray: '#4b5057',
  cream: '#f2e8d5',
  beige: '#e5d9c0',
  terracotta: '#c46a4a',
  sand: '#dcc9a1',
  ochre: '#cc7722',
};

/** Parse an OSM colour value into a CSS hex, or `null` when unusable. */
export function parseOsmColour(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(value)) return value;
  if (COLOUR_ALIASES[value]) return COLOUR_ALIASES[value];
  // A bare CSS keyword we can hand straight to THREE.Color.
  if (/^[a-z]{3,20}$/.test(value)) return value;
  return null;
}

/** Normalise a raw OSM material value to a library entry. */
export function lookupMaterial(raw: string | undefined): SurfaceMaterial | null {
  if (!raw) return null;
  // OSM allows semicolon-separated lists; the first value dominates.
  const first = raw.split(';')[0].trim().toLowerCase().replace(/\s+/g, '_');
  const key = MATERIAL_ALIASES[first] ?? (MATERIALS[first] ? first : null);
  return key ? MATERIALS[key] : null;
}

/* ================================================================== */
/*  Inference                                                          */
/* ================================================================== */

/** Building use → the material that kind of building is usually built from. */
const USE_MATERIAL: Record<string, string> = {
  church: 'stone',
  cathedral: 'stone',
  chapel: 'stone',
  monastery: 'stone',
  mosque: 'stone',
  synagogue: 'stone',
  temple: 'stone',
  castle: 'stone',
  fort: 'stone',
  ruins: 'stone',
  civic: 'stone',
  government: 'stone',
  museum: 'stone',
  university: 'brick',
  school: 'brick',
  college: 'brick',
  hospital: 'concrete',
  office: 'glass',
  commercial: 'glass',
  retail: 'concrete',
  supermarket: 'concrete',
  kiosk: 'metal',
  industrial: 'metal',
  warehouse: 'metal',
  factory: 'metal',
  hangar: 'metal',
  service: 'metal',
  shed: 'wood',
  hut: 'wood',
  cabin: 'wood',
  barn: 'wood',
  farm_auxiliary: 'wood',
  stable: 'wood',
  garage: 'cement_block',
  garages: 'cement_block',
  carport: 'metal',
  apartments: 'concrete',
  residential: 'plaster',
  house: 'brick',
  detached: 'brick',
  semidetached_house: 'brick',
  terrace: 'brick',
  bungalow: 'plaster',
  dormitory: 'concrete',
  hotel: 'concrete',
  parking: 'concrete',
  roof: 'metal',
  greenhouse: 'glass',
  train_station: 'stone',
};

/** `amenity`/`shop`/`office` values that imply a modern commercial fit-out. */
const GLASSY_USE = new Set(['bank', 'office', 'mall', 'department_store', 'car', 'showroom']);

/** Roof shape assumed when `roof:shape` is absent. */
function inferRoofShape(props: BuildingProperties, footprintArea: number): string {
  if (props.roofShape) return props.roofShape.toLowerCase();

  const type = (props.type ?? '').toLowerCase();
  const levels = props.levels ?? 0;

  // Small detached residential stock is overwhelmingly pitched; anything large
  // or tall is flat, because that is how big buildings are actually roofed.
  const smallResidential =
    footprintArea < 400 &&
    levels <= 3 &&
    ['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'hut', 'cabin', 'shed', 'barn', 'farm_auxiliary'].includes(type);

  if (smallResidential) return footprintArea < 60 ? 'skillion' : 'gabled';
  if (type === 'church' || type === 'chapel') return 'gabled';
  return 'flat';
}

/** Roof covering implied by a roof shape when `roof:material` is absent. */
function inferRoofMaterial(shape: string, facadeKey: string): SurfaceMaterial {
  if (shape === 'flat') {
    return facadeKey === 'glass' || facadeKey === 'steel'
      ? MATERIALS.gravel_roof
      : MATERIALS.bitumen;
  }
  if (facadeKey === 'wood' || facadeKey === 'adobe') return MATERIALS.thatch;
  if (facadeKey === 'metal' || facadeKey === 'corrugated_iron') return MATERIALS.corrugated_iron;
  return MATERIALS.roof_tiles;
}

/** Confidence attached to each provenance. */
const SOURCE_CONFIDENCE: Record<MaterialSource, number> = {
  tagged: 0.95,
  colour: 0.7,
  'inferred-use': 0.5,
  'inferred-era': 0.55,
  default: 0.25,
};

/**
 * Resolve the facade and roof materials for one building.
 *
 * Priority, highest first:
 *   1. `building:facade:material`, else `building:material`  → `tagged`
 *   2. `building:colour` with no material                    → `colour`
 *   3. construction era from `start_date`                    → `inferred-era`
 *   4. building use / amenity                                → `inferred-use`
 *   5. a neutral render                                      → `default`
 */
export function resolveBuildingMaterial(
  props: BuildingProperties,
  footprintArea: number,
): BuildingMaterialAssignment {
  let facade: SurfaceMaterial | null = null;
  let source: MaterialSource = 'default';

  // 1. Explicit tags.
  facade = lookupMaterial(props.facadeMaterial) ?? lookupMaterial(props.material);
  if (facade) source = 'tagged';

  // 2. A colour tag alone still tells us the building is rendered/painted.
  if (!facade && props.colour) {
    const css = parseOsmColour(props.colour);
    if (css) {
      facade = { ...MATERIALS.plaster, key: 'painted', label: 'Painted render', color: css };
      source = 'colour';
    }
  }

  const type = (props.type ?? '').toLowerCase();
  const levels = props.levels ?? (props.height ? Math.round(props.height / 3.2) : 0);

  // 3. Era. Tall post-1990 commercial stock is curtain-walled; pre-1940 is
  //    masonry; the post-war decades are concrete.
  if (!facade && props.startYear) {
    const year = props.startYear;
    const commercial = type === 'office' || type === 'commercial' || type === 'retail';
    if (year >= 1990 && (commercial || levels >= 8)) facade = MATERIALS.glass;
    else if (year >= 1955) facade = MATERIALS.concrete;
    else if (year >= 1900) facade = MATERIALS.brick;
    else facade = props.historic ? MATERIALS.stone : MATERIALS.brick;
    source = 'inferred-era';
  }

  // 4. Use.
  if (!facade) {
    const useKey =
      (props.useHint && GLASSY_USE.has(props.useHint.toLowerCase()) ? 'glass' : null) ??
      USE_MATERIAL[type] ??
      null;
    if (useKey) {
      facade = MATERIALS[useKey];
      source = 'inferred-use';
    }
  }

  // A tower is a curtain wall whatever its `building=*` value says.
  if (facade && facade.key !== 'glass' && levels >= 15 && source !== 'tagged') {
    facade = MATERIALS.glass;
    source = 'inferred-use';
  }

  if (!facade) {
    facade = MATERIALS.plaster;
    source = 'default';
  }

  // A colour tag refines whichever material we landed on.
  if (source !== 'colour' && props.colour) {
    const css = parseOsmColour(props.colour);
    if (css) facade = { ...facade, color: css, variation: facade.variation * 0.4 };
  }

  /* ---- Roof ---- */
  const shape = inferRoofShape(props, footprintArea);
  let roof = lookupMaterial(props.roofMaterial);
  const roofTagged = roof !== null;
  if (!roof) roof = inferRoofMaterial(shape, facade.key);

  if (props.roofColour) {
    const css = parseOsmColour(props.roofColour);
    if (css) roof = { ...roof, color: css, variation: roof.variation * 0.4 };
  }

  // Confidence is the facade provenance, nudged up when the roof is tagged too.
  const confidence = Math.min(1, SOURCE_CONFIDENCE[source] + (roofTagged ? 0.05 : 0));

  return { facade, roof, source, confidence };
}

/** The roof shape to build, after tags and inference. */
export function roofShapeFor(props: BuildingProperties, footprintArea: number): string {
  return inferRoofShape(props, footprintArea);
}

/* ================================================================== */
/*  Region-level summary                                               */
/* ================================================================== */

/** Aggregate the material mix across a set of buildings, for the sidebar. */
export function summariseMaterials(
  buildings: BuildingData[],
  assignments: Map<number, BuildingMaterialAssignment>,
): MaterialBreakdown {
  const counts = new Map<string, { key: string; label: string; color: string; count: number }>();
  let tagged = 0;
  let confidenceSum = 0;

  for (const building of buildings) {
    const assignment = assignments.get(building.id);
    if (!assignment) continue;

    if (assignment.source === 'tagged') tagged++;
    confidenceSum += assignment.confidence;

    const { facade } = assignment;
    const entry = counts.get(facade.key);
    if (entry) entry.count++;
    else counts.set(facade.key, { key: facade.key, label: facade.label, color: facade.color, count: 1 });
  }

  const total = assignments.size;
  return {
    total,
    tagged,
    byMaterial: [...counts.values()].sort((a, b) => b.count - a.count),
    meanConfidence: total > 0 ? confidenceSum / total : 0,
  };
}

/* ================================================================== */
/*  Procedural facade textures                                         */
/* ================================================================== */

/** World size one texture tile covers, metres. */
export const TILE_WIDTH_M = 3.2;
export const FLOOR_HEIGHT_M = 3.2;

const TEXTURE_PX = 256;

export interface FacadeTextures {
  /** Albedo: the wall surface with its window openings. */
  albedo: HTMLCanvasElement;
  /** Windows only, on black — drives the emissive channel. */
  emissive: HTMLCanvasElement | null;
}

const textureCache = new Map<string, FacadeTextures>();

/** Deterministic hash → [0, 1), so a given wall always looks the same. */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Draw one tile of facade: the base material, a light surface texture
 * appropriate to it (brick courses, board lines, panel joints) and, for
 * materials that have them, a window opening.
 *
 * The tile is exactly `TILE_WIDTH_M` × `FLOOR_HEIGHT_M` in world units, so
 * window sills line up with floor levels at any building height.
 */
function drawFacadeTile(material: SurfaceMaterial, seed: number): FacadeTextures {
  const albedo = document.createElement('canvas');
  albedo.width = TEXTURE_PX;
  albedo.height = TEXTURE_PX;
  const ctx = albedo.getContext('2d');
  if (!ctx) return { albedo, emissive: null };

  ctx.fillStyle = material.color;
  ctx.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX);

  /* ---- Surface relief per material family ---- */
  ctx.lineWidth = 1;
  if (material.key === 'brick') {
    // Stretcher bond: 8 courses per 3.2 m ≈ a 400 mm course including mortar.
    const courses = 12;
    const h = TEXTURE_PX / courses;
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    for (let row = 0; row <= courses; row++) {
      const y = row * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(TEXTURE_PX, y);
      ctx.stroke();
      const offset = row % 2 === 0 ? 0 : TEXTURE_PX / 8;
      for (let c = 0; c <= 4; c++) {
        const x = offset + (c * TEXTURE_PX) / 4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + h);
        ctx.stroke();
      }
    }
  } else if (material.key === 'stone' || material.key === 'sandstone' || material.key === 'limestone' || material.key === 'granite') {
    const courses = 6;
    const h = TEXTURE_PX / courses;
    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    for (let row = 0; row <= courses; row++) {
      const y = row * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(TEXTURE_PX, y);
      ctx.stroke();
      const blocks = 2 + (row % 2);
      for (let c = 1; c < blocks; c++) {
        const x = (c * TEXTURE_PX) / blocks + hash01(seed + row * 7 + c) * 12 - 6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + h);
        ctx.stroke();
      }
    }
  } else if (material.key === 'wood') {
    const boards = 10;
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i <= boards; i++) {
      const y = (i * TEXTURE_PX) / boards;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(TEXTURE_PX, y);
      ctx.stroke();
    }
  } else if (material.key === 'corrugated_iron' || material.key === 'metal') {
    const ribs = 16;
    for (let i = 0; i < ribs; i++) {
      const x = (i * TEXTURE_PX) / ribs;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
      ctx.fillRect(x, 0, TEXTURE_PX / ribs, TEXTURE_PX);
    }
  } else if (material.key === 'concrete' || material.key === 'cement_block') {
    // Shuttering / block joints.
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    for (let i = 0; i <= 4; i++) {
      const y = (i * TEXTURE_PX) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(TEXTURE_PX, y);
      ctx.stroke();
    }
  }

  // Weathering: a subtle vertical gradient, darker toward the base.
  const gradient = ctx.createLinearGradient(0, 0, 0, TEXTURE_PX);
  gradient.addColorStop(0, 'rgba(255,255,255,0.05)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.09)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX);

  if (!material.windows) {
    return { albedo, emissive: null };
  }

  /* ---- Window opening ---- */
  const emissive = document.createElement('canvas');
  emissive.width = TEXTURE_PX;
  emissive.height = TEXTURE_PX;
  const ectx = emissive.getContext('2d');
  if (ectx) {
    ectx.fillStyle = '#000000';
    ectx.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX);
  }

  const glassy = material.key === 'glass' || material.key === 'steel';
  // A curtain wall is nearly all glazing; a masonry wall is mostly solid.
  const inset = glassy ? 0.06 : 0.26;
  const x0 = TEXTURE_PX * inset;
  const y0 = TEXTURE_PX * (glassy ? 0.1 : 0.2);
  const w = TEXTURE_PX * (1 - inset * 2);
  const h = TEXTURE_PX * (glassy ? 0.8 : 0.52);

  ctx.fillStyle = glassy ? '#2c3f52' : '#33404d';
  ctx.fillRect(x0, y0, w, h);

  // Sky reflection across the glazing.
  const glass = ctx.createLinearGradient(x0, y0, x0 + w, y0 + h);
  glass.addColorStop(0, 'rgba(190,215,235,0.55)');
  glass.addColorStop(0.5, 'rgba(120,150,180,0.25)');
  glass.addColorStop(1, 'rgba(40,55,70,0.35)');
  ctx.fillStyle = glass;
  ctx.fillRect(x0, y0, w, h);

  // Frame and a single mullion.
  ctx.strokeStyle = glassy ? 'rgba(220,225,230,0.55)' : 'rgba(245,245,240,0.75)';
  ctx.lineWidth = glassy ? 2 : 4;
  ctx.strokeRect(x0, y0, w, h);
  ctx.beginPath();
  ctx.moveTo(x0 + w / 2, y0);
  ctx.lineTo(x0 + w / 2, y0 + h);
  ctx.stroke();

  if (ectx) {
    // Roughly a third of the windows are lit, chosen deterministically.
    const lit = hash01(seed * 3.7) < 0.34;
    if (lit) {
      ectx.fillStyle = '#ffd9a0';
      ectx.fillRect(x0, y0, w, h);
    }
  }

  return { albedo, emissive };
}

/**
 * Cached facade textures for a material. Returns `null` outside the browser
 * (no canvas), which callers treat as "use a flat colour".
 */
export function facadeTextures(material: SurfaceMaterial, seed = 1): FacadeTextures | null {
  if (typeof document === 'undefined') return null;
  const cacheKey = `${material.key}:${material.color}:${seed}`;
  const cached = textureCache.get(cacheKey);
  if (cached) return cached;

  const textures = drawFacadeTile(material, seed);
  textureCache.set(cacheKey, textures);
  return textures;
}

/** Drop every cached canvas — called when a new region is loaded. */
export function clearFacadeTextureCache(): void {
  textureCache.clear();
}
