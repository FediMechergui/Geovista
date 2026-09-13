<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/Three.js-0.183-black?logo=three.js" alt="Three.js" />
  <img src="https://img.shields.io/badge/CesiumJS-1.140-blue?logo=cesium" alt="CesiumJS" />
  <img src="https://img.shields.io/badge/MapLibre_GL-5.23-orange" alt="MapLibre" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" alt="TypeScript" />
</p>

# 🌍 GeoVista

**Digital twins of real places, built from open data.** Search a place or draw a box on the map, and GeoVista builds an interactive 3D twin of it in two flavours:

- **Globe** — a photorealistic twin on a full CesiumJS globe: Google Photorealistic 3D Tiles (photogrammetry of real cities and terrain), or Cesium World Terrain with clickable OSM Buildings over Esri satellite imagery.
- **Terrain** — an analytical twin rendered with Three.js from raw open data: a stitched SRTM elevation mesh with satellite imagery draped on it, OSM buildings extruded and seated on the ground, a Macrostrat geology stack beneath the surface, and measurement / elevation-profile tools.

Built with Next.js 16, React 19, CesiumJS, Three.js + React Three Fiber, MapLibre GL and Zustand.

---

## ✨ Features

### 🔎 Find a place
- Type any place name (Nominatim geocoder). GeoVista picks a sensible twin region — city bounding boxes are clamped, points of interest are expanded — flies the map there and opens the 3D view.
- Or pick the box tool and drag a rectangle on the 2D map.
- Selected-place panel: reverse-geocoded name, area, min / max / mean elevation, DEM resolution, building count.

### 🌐 Globe view (CesiumJS)
- **Photorealistic** — Google Photorealistic 3D Tiles, streamed at high detail.
- **Terrain + Buildings** — Cesium World Terrain (30 m, with water mask and normals) and Cesium OSM Buildings.
- Click any OSM building for its attributes (type, estimated height, levels, address, OSM id); click anywhere for coordinates and height.
- Oblique fly-to of the selected region, region outline clamped to the ground, distance measurement with ground-clamped lines.
- Vertical exaggeration and underground (translucent globe) camera.

### 🏔️ Terrain view (Three.js)
- SRTM Terrarium tiles stitched at the highest zoom that fits a tile budget (up to z14, ~10 m/px), resampled to a 768² mesh.
- **Surface**: Esri satellite imagery stitched into a 4096² texture exactly aligned to the DEM tiles, OSM land-use rasterization, or hypsometric tint.
- OSM building footprints extruded with per-type colours, merged into a single draw call and seated on the terrain at their lowest footprint vertex.
- Macrostrat stratigraphic column rendered as sub-surface layers, plus an interactive column in the sidebar.
- Sea-level water plane, soft shadows, sky, logarithmic depth buffer (no z-fighting at degree-scale units).
- Measurement tool with geodesic distance, elevation difference and a hypsometric elevation profile.

### 📊 Analysis & export
- Cursor coordinates in DD / DMS / UTM with one-click copy.
- Export: PNG screenshot, elevation grid as CSV, selected region as GeoJSON.

### 🧰 General
- Keyboard shortcuts: `Esc`, `Space`, `1`, `2`, `G`, `B`, `?`
- Error boundaries with retry on every pane, resizable split view, dark UI.
- Server-side proxies for Overpass and Macrostrat (same-origin only, body-size capped).

---

## 🚀 Getting started

```bash
npm install
cp .env.example .env.local   # then fill in your keys (optional but recommended)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### API keys

Everything works without keys (2D map, terrain twin, satellite drape, buildings, geology). Two optional keys unlock the globe's best sources:

| Variable | Unlocks | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_CESIUM_ION_TOKEN` | Cesium World Terrain, Cesium OSM Buildings | https://ion.cesium.com/tokens (free tier) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Photorealistic 3D Tiles | Google Cloud console → enable **Map Tiles API** for the key |

Put them in `.env.local` locally, or in your hosting provider's environment settings. `NEXT_PUBLIC_*` values are inlined at build time, so redeploy after changing them.

### Build & deploy

```bash
npm run build   # copies Cesium runtime assets to public/cesium, then builds
npm start
```

Deploys to Vercel with zero configuration: import the repository, add the two environment variables above, deploy.

### Checks

```bash
npx tsc --noEmit
npm run lint
```

---

## 📂 Project structure

```
src/
├── app/
│   ├── api/proxy/{overpass,macrostrat}/  # hardened server-side proxies
│   ├── cesium/[...path]/route.ts         # dev-only: serves Cesium assets from node_modules
│   ├── globals.css · layout.tsx · page.tsx
├── components/
│   ├── analysis/    CoordDisplay (DD/DMS/UTM), ElevationProfile (Recharts)
│   ├── geology/     StratColumn (SVG), CrossSection (Three.js, unused)
│   ├── map/         WorldMap (MapLibre 2D map, region drawing)
│   ├── ui/          Toolbar (view switch + search), Sidebar, HelpPanel, ErrorBoundary, Attribution
│   └── viewer3d/    CesiumViewer (globe twin), TerrainViewer (analytical twin)
├── hooks/           useKeyboardShortcuts, usePlaceIdentity (reverse geocode)
├── lib/
│   ├── analysis/coordTransform.ts   proj4 CRS transforms, haversine distance
│   ├── buildings/osmFetcher.ts      Overpass building footprints + height estimation
│   ├── geology/macrostratApi.ts     Macrostrat columns → layer definitions
│   ├── terrain/demLoader.ts         tile math, Terrarium decode, multi-tile stitch, sampling, stats
│   ├── terrain/imageryLoader.ts     satellite tile stitcher aligned to the DEM tile grid
│   ├── terrain/landUseRasterizer.ts OSM land use → canvas texture
│   ├── terrain/meshGenerator.ts     terrain / geology / merged building meshes
│   ├── geocoding.ts                 Nominatim search + reverse, twin-region sizing
│   ├── exportUtils.ts · constants.ts
├── store/mapStore.ts                Zustand state (selection, view mode, place data)
└── types/                           geo, geology, buildings
scripts/copy-cesium.mjs              prebuild: Cesium assets → public/cesium
```

---

## 🌐 Data sources & attribution

| Source | Data | Terms |
|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Basemap, buildings, land use, geocoding (Nominatim) | ODbL |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | SRTM / global DEM (Terrarium) | Public domain / see registry |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Satellite imagery | Esri terms, attribution required |
| [Google Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles) | Photogrammetry meshes | Google Maps Platform terms, on-screen attribution required |
| [Cesium Ion](https://cesium.com/platform/cesium-ion/) | World Terrain, OSM Buildings | Cesium Ion terms |
| [Macrostrat](https://macrostrat.org) | Geological columns | CC-BY |

---

## 📄 License

MIT.
