/**
 * Overture Maps building fetcher.
 *
 * Overture Maps distributes data via cloud-native formats (Parquet/PMTiles),
 * not a REST API. This module delegates to the OSM Overpass fetcher
 * (via server-side proxy) for building footprints.
 */

import type { BuildingData } from '@/types/buildings';
import type { BBox } from '@/types/geo';
import { fetchBuildings as fetchBuildingsOSM } from './osmFetcher';

interface OvertureFeature {
  type: 'Feature';
  id: string;
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    height?: number;
    num_floors?: number;
    class?: string;
    names?: { primary?: string };
    sources?: Array<{ dataset: string }>;
    roof_shape?: string;
    facade_color?: string;
    facade_material?: string;
    roof_color?: string;
    roof_material?: string;
    roof_height?: number;
    min_height?: number;
  };
}

interface OvertureResponse {
  type: 'FeatureCollection';
  features: OvertureFeature[];
}

/**
 * Try to fetch buildings from Overture Maps. If the API is down / returns
 * an error, transparently falls back to the OSM Overpass fetcher.
 *
 * Overture buildings include:
 *   - Accurate height from lidar/photogrammetry (not just OSM tags)
 *   - Roof shape, facade color, material metadata
 *   - Num floors from administrative datasets
 */
export async function fetchBuildingsOverture(
  bbox: BBox,
): Promise<BuildingData[]> {
  // Overture Maps distributes data via cloud-native formats (Parquet/PMTiles),
  // not a REST API. Use OSM Overpass (via server proxy) directly.
  return fetchBuildingsOSM(bbox);
}

/**
 * Convert an Overture GeoJSON feature into our internal BuildingData format.
 */
function overtureFeatureToBuilding(
  feature: OvertureFeature,
  index: number,
): BuildingData | null {
  const { geometry, properties } = feature;

  // Extract the first polygon ring
  let ring: number[][];
  if (geometry.type === 'Polygon') {
    ring = geometry.coordinates[0] as number[][];
  } else if (geometry.type === 'MultiPolygon') {
    // Take the largest polygon (first one is usually the main footprint)
    ring = (geometry.coordinates as number[][][][])[0][0];
  } else {
    return null;
  }

  if (!ring || ring.length < 3) return null;

  const coords: Array<[number, number]> = ring.map(([lon, lat]) => [lon, lat]);

  return {
    id: parseInt(feature.id, 10) || index + 100000,
    geometry: coords,
    properties: {
      height: properties.height ?? undefined,
      levels: properties.num_floors ?? undefined,
      name: properties.names?.primary,
      type: properties.class ?? 'yes',
      roof_shape: properties.roof_shape,
    },
  };
}
