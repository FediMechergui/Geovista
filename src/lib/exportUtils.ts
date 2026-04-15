/**
 * Export utilities: PNG screenshot, CSV elevation, GeoJSON region.
 */

import type { BBox, ElevationGrid } from "@/types/geo";

/* ================================================================== */
/*  1. Screenshot (PNG)                                                */
/* ================================================================== */

/**
 * Capture a screenshot from a canvas element (Three.js or Cesium) and
 * download it as a PNG file.
 *
 * @param canvasSelector CSS selector for the target `<canvas>` element.
 *                       Defaults to the first canvas inside `main`.
 */
export function exportScreenshotPNG(
  canvasSelector = "main canvas",
): void {
  const canvas = document.querySelector<HTMLCanvasElement>(canvasSelector);
  if (!canvas) {
    console.warn("[export] No canvas found for screenshot.");
    return;
  }

  // For WebGL canvases `preserveDrawingBuffer` must be true, or we
  // need to render a frame right before calling toDataURL.
  // Try toDataURL directly — worst case we get a blank image.
  const dataUrl = canvas.toDataURL("image/png");

  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `geovista-screenshot-${timestamp()}.png`;
  a.click();
}

/* ================================================================== */
/*  2. Elevation CSV                                                   */
/* ================================================================== */

/**
 * Export an `ElevationGrid` as a CSV file.
 * Each row: `lon, lat, elevation`.
 */
export function exportElevationCSV(grid: ElevationGrid): void {
  const { width, height, data, bbox, noDataValue } = grid;

  const lonStep = (bbox.east - bbox.west) / (width - 1 || 1);
  const latStep = (bbox.north - bbox.south) / (height - 1 || 1);

  const lines: string[] = ["longitude,latitude,elevation_m"];

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const elev = data[row * width + col];
      if (elev === noDataValue) continue;

      const lon = bbox.west + col * lonStep;
      const lat = bbox.north - row * latStep; // top-to-bottom
      lines.push(`${lon.toFixed(6)},${lat.toFixed(6)},${elev.toFixed(2)}`);
    }
  }

  downloadText(lines.join("\n"), `geovista-elevation-${timestamp()}.csv`, "text/csv");
}

/* ================================================================== */
/*  3. Region GeoJSON                                                  */
/* ================================================================== */

/**
 * Export a BBox as a GeoJSON feature with a Polygon geometry.
 */
export function exportRegionGeoJSON(bbox: BBox): void {
  const geojson = {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {
          name: "GeoVista selected region",
          west: bbox.west,
          south: bbox.south,
          east: bbox.east,
          north: bbox.north,
          exportedAt: new Date().toISOString(),
        },
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [
              [bbox.west, bbox.south],
              [bbox.east, bbox.south],
              [bbox.east, bbox.north],
              [bbox.west, bbox.north],
              [bbox.west, bbox.south], // close ring
            ],
          ],
        },
      },
    ],
  };

  const json = JSON.stringify(geojson, null, 2);
  downloadText(json, `geovista-region-${timestamp()}.geojson`, "application/geo+json");
}

/* ================================================================== */
/*  Internal helpers                                                   */
/* ================================================================== */

function timestamp(): string {
  return new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
}

function downloadText(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
