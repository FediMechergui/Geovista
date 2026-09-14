/**
 * Vehicle catalogue for the microsimulation.
 *
 * Dimensions are real-world averages (a European/global mix rather than a
 * US-heavy one) and the dynamics are the comfort values used in the
 * Intelligent Driver Model literature: roughly 1–1.5 m/s² acceleration and
 * 2–3 m/s² comfortable braking, with heavier vehicles slower on both counts.
 */

import type { RoadClass, VehicleKind, VehicleSpec } from '@/types/traffic';

export const VEHICLE_SPECS: Record<VehicleKind, VehicleSpec> = {
  car: {
    kind: 'car',
    length: 4.4,
    width: 1.8,
    height: 1.5,
    accel: 1.4,
    decel: 2.6,
    speedFactor: 1.0,
    minGap: 2.0,
    share: 0.62,
    palette: ['#e5e7eb', '#1f2937', '#9ca3af', '#b91c1c', '#1d4ed8', '#0f766e', '#f8fafc', '#334155'],
  },
  taxi: {
    kind: 'taxi',
    length: 4.6,
    width: 1.8,
    height: 1.55,
    accel: 1.6,
    decel: 2.9,
    // Professional drivers push a little harder than the average commuter.
    speedFactor: 1.08,
    minGap: 1.7,
    share: 0.07,
    palette: ['#facc15', '#fbbf24', '#f59e0b'],
  },
  van: {
    kind: 'van',
    length: 5.4,
    width: 2.0,
    height: 2.3,
    accel: 1.1,
    decel: 2.3,
    speedFactor: 0.95,
    minGap: 2.4,
    share: 0.14,
    palette: ['#f1f5f9', '#e2e8f0', '#cbd5e1', '#2563eb', '#15803d'],
  },
  motorcycle: {
    kind: 'motorcycle',
    length: 2.2,
    width: 0.8,
    height: 1.4,
    accel: 2.4,
    decel: 3.4,
    speedFactor: 1.12,
    minGap: 1.2,
    share: 0.05,
    palette: ['#111827', '#b91c1c', '#1d4ed8', '#f97316'],
  },
  bus: {
    kind: 'bus',
    length: 12.0,
    width: 2.55,
    height: 3.2,
    accel: 0.8,
    decel: 1.8,
    speedFactor: 0.85,
    minGap: 3.5,
    share: 0.05,
    palette: ['#dc2626', '#2563eb', '#16a34a', '#f5f5f4'],
    avoids: ['living_street'],
  },
  truck: {
    kind: 'truck',
    length: 10.5,
    width: 2.5,
    height: 3.6,
    accel: 0.7,
    decel: 1.7,
    speedFactor: 0.82,
    minGap: 4.0,
    share: 0.07,
    palette: ['#f8fafc', '#64748b', '#1e3a5f', '#7c2d12'],
    avoids: ['living_street', 'service'],
  },
};

export const VEHICLE_KINDS = Object.keys(VEHICLE_SPECS) as VehicleKind[];

/** Vehicles counted as heavy when the mix is rebalanced by `heavyShare`. */
const HEAVY: VehicleKind[] = ['bus', 'truck'];

/**
 * Build a cumulative distribution over vehicle kinds for a given heavy-vehicle
 * share. `heavyShare` rescales buses and trucks to that fraction of the fleet
 * and redistributes the difference across the light vehicles proportionally.
 */
export function fleetDistribution(heavyShare: number): Array<{ kind: VehicleKind; cumulative: number }> {
  const clamped = Math.max(0, Math.min(0.6, heavyShare));

  const baseHeavy = HEAVY.reduce((sum, k) => sum + VEHICLE_SPECS[k].share, 0);
  const baseLight = 1 - baseHeavy;

  const weights = VEHICLE_KINDS.map((kind) => {
    const spec = VEHICLE_SPECS[kind];
    const isHeavy = HEAVY.includes(kind);
    const weight = isHeavy
      ? baseHeavy > 0
        ? (spec.share / baseHeavy) * clamped
        : 0
      : baseLight > 0
        ? (spec.share / baseLight) * (1 - clamped)
        : 0;
    return { kind, weight };
  });

  const total = weights.reduce((sum, w) => sum + w.weight, 0) || 1;
  let running = 0;
  return weights.map(({ kind, weight }) => {
    running += weight / total;
    return { kind, cumulative: running };
  });
}

/** Draw a vehicle kind from a cumulative distribution. */
export function sampleKind(
  distribution: Array<{ kind: VehicleKind; cumulative: number }>,
  r: number,
): VehicleKind {
  for (const entry of distribution) {
    if (r <= entry.cumulative) return entry.kind;
  }
  return distribution[distribution.length - 1]?.kind ?? 'car';
}

/** Whether this vehicle kind is willing to use a road of this class. */
export function canUse(kind: VehicleKind, klass: RoadClass): boolean {
  const avoids = VEHICLE_SPECS[kind].avoids;
  return !avoids || !avoids.includes(klass);
}

/** Human label for the UI. */
export const VEHICLE_LABELS: Record<VehicleKind, string> = {
  car: 'Cars',
  taxi: 'Taxis',
  van: 'Vans',
  bus: 'Buses',
  truck: 'Trucks',
  motorcycle: 'Motorcycles',
};
