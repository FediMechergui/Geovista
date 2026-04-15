/**
 * Web Worker: terrain mesh vertex computation.
 *
 * Offloads the heavy per-vertex elevation + hypsometric color loop
 * from the main thread. The main thread sends the raw ElevationGrid
 * data and gets back position + color buffers ready for Three.js.
 *
 * Message protocol:
 *   IN  → { width, height, data: Float32Array, bboxWidth, bboxHeight,
 *            noDataValue, verticalExaggeration, hypsoStops }
 *   OUT → { positions: Float32Array, colors: Float32Array,
 *            minElev, maxElev }
 */

/* eslint-disable no-restricted-globals */

interface HypsoStop {
  elev: number;
  r: number;
  g: number;
  b: number;
}

interface WorkerInput {
  width: number;
  height: number;
  data: Float32Array;
  bboxWidth: number;
  bboxHeight: number;
  noDataValue: number;
  verticalExaggeration: number;
  hypsoStops: HypsoStop[];
}

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const {
    width,
    height,
    data,
    bboxWidth,
    bboxHeight,
    noDataValue,
    verticalExaggeration,
    hypsoStops,
  } = e.data;

  const DEG_PER_M = 1 / 111320;
  const elevScale = verticalExaggeration * DEG_PER_M;

  const wSegs = width - 1;
  const hSegs = height - 1;
  const vertexCount = (wSegs + 1) * (hSegs + 1);

  // PlaneGeometry layout: row-major, top-left at vertex[0]
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);

  const halfW = bboxWidth / 2;
  const halfH = bboxHeight / 2;

  let minElev = Infinity;
  let maxElev = -Infinity;

  for (let j = 0; j <= hSegs; j++) {
    for (let i = 0; i <= wSegs; i++) {
      const idx = j * (wSegs + 1) + i;
      const raw = data[idx] ?? 0;
      const elev = raw === noDataValue ? 0 : raw;

      if (elev < minElev) minElev = elev;
      if (elev > maxElev) maxElev = elev;

      // x: left-to-right, y: top-to-bottom (Three.js PlaneGeometry convention)
      positions[idx * 3] = (i / wSegs) * bboxWidth - halfW;
      positions[idx * 3 + 1] = -(j / hSegs) * bboxHeight + halfH;
      positions[idx * 3 + 2] = elev * elevScale;

      // Hypsometric color
      const c = lerpHypso(elev, hypsoStops);
      colors[idx * 3] = c[0];
      colors[idx * 3 + 1] = c[1];
      colors[idx * 3 + 2] = c[2];
    }
  }

  // Transfer buffers back (zero-copy)
  const msg = {
    positions,
    colors,
    minElev,
    maxElev,
  };
  (self as unknown as Worker).postMessage(msg, [
    positions.buffer,
    colors.buffer,
  ]);
};

/* ------------------------------------------------------------------ */
/*  Hypsometric color interpolation                                    */
/* ------------------------------------------------------------------ */

function lerpHypso(
  elev: number,
  stops: HypsoStop[],
): [number, number, number] {
  if (stops.length === 0) return [0.5, 0.5, 0.5];
  if (elev <= stops[0].elev) return [stops[0].r, stops[0].g, stops[0].b];
  const last = stops[stops.length - 1];
  if (elev >= last.elev) return [last.r, last.g, last.b];

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (elev <= b.elev) {
      const t = (elev - a.elev) / (b.elev - a.elev);
      return [
        a.r + (b.r - a.r) * t,
        a.g + (b.g - a.g) * t,
        a.b + (b.b - a.b) * t,
      ];
    }
  }
  return [last.r, last.g, last.b];
}
