/**
 * CesiumJS, loaded from the static build instead of bundled.
 *
 * Cesium's ESM bundle embeds a decoder binary as a JavaScript string. Turbopack's
 * minifier rewrites that string as a template literal, where the raw NUL bytes
 * become octal escapes — which are a *syntax error* in template literals. The
 * 4 MB chunk then fails to parse and the globe never mounts:
 *
 *     Uncaught SyntaxError: Octal escape sequences are not allowed in template strings
 *
 * Minification cannot be configured (Next.js removed `swcMinify` in v15), so the
 * fix is to keep Cesium out of the bundle entirely. We already ship its runtime
 * to `public/cesium` for Workers and Assets, so `Cesium.js` is served from there
 * and read off `window.Cesium` here.
 *
 * Call `loadCesium()` (see `./load`) and await it before importing any module
 * that imports from here — the bindings below are read at module evaluation.
 * `src/app/page.tsx` does this in the globe's dynamic import.
 *
 * Import from `@/lib/cesium`, never from `'cesium'` directly; a bare import
 * pulls the bundled copy back in and the bug returns.
 */

import type * as CesiumTypes from 'cesium';

declare global {
  interface Window {
    Cesium?: typeof CesiumTypes;
  }
}

function runtime(): typeof CesiumTypes {
  const cesium = typeof window === 'undefined' ? undefined : window.Cesium;
  if (!cesium) {
    throw new Error(
      'CesiumJS is not loaded. Await loadCesium() before importing @/lib/cesium.',
    );
  }
  return cesium;
}

const C = runtime();


/* ---- Values ---- */

export const BillboardCollection = C.BillboardCollection;
export const Cartesian2 = C.Cartesian2;
export const Cartesian3 = C.Cartesian3;
export const Cartographic = C.Cartographic;
export const Cesium3DTileFeature = C.Cesium3DTileFeature;
export const Cesium3DTileset = C.Cesium3DTileset;
export const ClassificationType = C.ClassificationType;
export const Color = C.Color;
export const ColorGeometryInstanceAttribute = C.ColorGeometryInstanceAttribute;
export const Credit = C.Credit;
export const CustomHeightmapTerrainProvider = C.CustomHeightmapTerrainProvider;
export const DistanceDisplayCondition = C.DistanceDisplayCondition;
export const EllipsoidTerrainProvider = C.EllipsoidTerrainProvider;
export const Entity = C.Entity;
export const GeometryInstance = C.GeometryInstance;
export const GroundPolylineGeometry = C.GroundPolylineGeometry;
export const GroundPolylinePrimitive = C.GroundPolylinePrimitive;
export const HeightReference = C.HeightReference;
export const ImageryLayer = C.ImageryLayer;
export const Ion = C.Ion;
export const LabelStyle = C.LabelStyle;
export const Material = C.Material;
export const Math = C.Math;
export const NearFarScalar = C.NearFarScalar;
export const PerInstanceColorAppearance = C.PerInstanceColorAppearance;
export const PointPrimitiveCollection = C.PointPrimitiveCollection;
export const PolygonGeometry = C.PolygonGeometry;
export const PolygonHierarchy = C.PolygonHierarchy;
export const PolylineCollection = C.PolylineCollection;
export const PolylineColorAppearance = C.PolylineColorAppearance;
export const PolylineGlowMaterialProperty = C.PolylineGlowMaterialProperty;
export const Primitive = C.Primitive;
export const ScreenSpaceEventHandler = C.ScreenSpaceEventHandler;
export const ScreenSpaceEventType = C.ScreenSpaceEventType;
export const UrlTemplateImageryProvider = C.UrlTemplateImageryProvider;
export const VerticalOrigin = C.VerticalOrigin;
export const Viewer = C.Viewer;
export const WebMercatorTilingScheme = C.WebMercatorTilingScheme;
export const createGooglePhotorealistic3DTileset = C.createGooglePhotorealistic3DTileset;
export const createOsmBuildingsAsync = C.createOsmBuildingsAsync;
export const createWorldTerrainAsync = C.createWorldTerrainAsync;
export const defined = C.defined;
export const sampleTerrain = C.sampleTerrain;
export const sampleTerrainMostDetailed = C.sampleTerrainMostDetailed;

/* ---- Types ---- */

/**
 * The whole namespace, types only. Use it for types nested under a class,
 * such as `Cesium.ScreenSpaceEventHandler.PositionedEvent`, which a plain
 * alias cannot reach. Erased at build time, so it bundles nothing.
 */
export type * as Cesium from 'cesium';


export type BillboardCollection = CesiumTypes.BillboardCollection;
export type Cartesian2 = CesiumTypes.Cartesian2;
export type Cartesian3 = CesiumTypes.Cartesian3;
export type Cartographic = CesiumTypes.Cartographic;
export type Cesium3DTileFeature = CesiumTypes.Cesium3DTileFeature;
export type Cesium3DTileset = CesiumTypes.Cesium3DTileset;
export type ClassificationType = CesiumTypes.ClassificationType;
export type Color = CesiumTypes.Color;
export type Credit = CesiumTypes.Credit;
export type CustomHeightmapTerrainProvider = CesiumTypes.CustomHeightmapTerrainProvider;
export type DistanceDisplayCondition = CesiumTypes.DistanceDisplayCondition;
export type EllipsoidTerrainProvider = CesiumTypes.EllipsoidTerrainProvider;
export type Entity = CesiumTypes.Entity;
export type GeometryInstance = CesiumTypes.GeometryInstance;
export type GroundPolylinePrimitive = CesiumTypes.GroundPolylinePrimitive;
export type HeightReference = CesiumTypes.HeightReference;
export type ImageryLayer = CesiumTypes.ImageryLayer;
export type Material = CesiumTypes.Material;
export type NearFarScalar = CesiumTypes.NearFarScalar;
export type PointPrimitiveCollection = CesiumTypes.PointPrimitiveCollection;
export type PolylineCollection = CesiumTypes.PolylineCollection;
export type Primitive = CesiumTypes.Primitive;
export type ScreenSpaceEventHandler = CesiumTypes.ScreenSpaceEventHandler;
export type ScreenSpaceEventType = CesiumTypes.ScreenSpaceEventType;
export type UrlTemplateImageryProvider = CesiumTypes.UrlTemplateImageryProvider;
export type VerticalOrigin = CesiumTypes.VerticalOrigin;
export type Viewer = CesiumTypes.Viewer;
export type WebMercatorTilingScheme = CesiumTypes.WebMercatorTilingScheme;
export type TerrainProvider = CesiumTypes.TerrainProvider;
