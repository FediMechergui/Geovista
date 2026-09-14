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
- **Terrain** — an analytical twin rendered with Three.js from raw open data: a stitched SRTM elevation mesh with satellite imagery draped on it, OSM buildings with material-accurate facades and real roof shapes, the OSM road network with a live traffic microsimulation driving on it, a Macrostrat geology stack beneath the surface with scored groundwater and hydrocarbon intervals, and measurement / routing / elevation-profile tools.

Built with Next.js 16, React 19, CesiumJS, Three.js + React Three Fiber, MapLibre GL and Zustand.

---

## ✨ Features

### 🔎 Find a place
- Type any place name (Nominatim geocoder). GeoVista picks a sensible twin region — city bounding boxes are clamped, points of interest are expanded — flies the map there and opens the 3D view.
- Or pick the box tool and drag a rectangle on the 2D map.
- Selected-place panel: reverse-geocoded name, area, min / max / mean elevation, DEM resolution, building count.

### 🌐 Globe view (CesiumJS)
- **Photorealistic** — Google Photorealistic 3D Tiles, streamed at high detail.
- **Terrain + Buildings** — Cesium World Terrain (30 m, with water mask and normals) and Cesium OSM Buildings where an Ion token is set; **with no token at all** the globe falls back to the free AWS Terrain Tiles for relief and extrudes OSM footprints for the selected region, so it is never an empty sphere.
- **Trees** from OSM, clamped to the terrain.
- A **Data sources** panel names what is actually drawing, and which environment variable would upgrade each source — so a missing key is visible rather than silent.
- Click any OSM building for its attributes (type, estimated height, levels, address, OSM id); click anywhere for coordinates and height.
- Oblique fly-to of the selected region, region outline clamped to the ground, distance measurement with ground-clamped lines.
- Vertical exaggeration and underground (translucent globe) camera.

### 🏔️ Terrain view (Three.js)
- SRTM Terrarium tiles stitched at the highest zoom that fits a tile budget (up to z14, ~10 m/px), resampled to a 768² mesh.
- **Surface**: Esri satellite imagery stitched into a 4096² texture exactly aligned to the DEM tiles, OSM land-use rasterization, or hypsometric tint.
- Sea-level water plane, soft shadows, sky, logarithmic depth buffer (no z-fighting at degree-scale units).
- Measurement tool with geodesic distance, elevation difference and a hypsometric elevation profile.

### 🧱 Material-accurate buildings
- Reads the material tags OSM actually carries — `building:material`, `building:facade:material`, `roof:material`, `building:colour`, `roof:colour`, `min_height`, `start_date` — and maps them onto PBR materials with real roughness and metalness: brick, stone, sandstone, limestone, granite, marble, concrete, render, glass curtain wall, steel, timber, adobe, corrugated iron, and the roof coverings that go with them.
- Where OSM is silent, the material is **inferred** from building use, construction era and height (a 1890 church is stone; a 40-storey office finished in 2015 is a curtain wall; a warehouse is profiled metal) — and recorded as an inference, with a confidence score. The sidebar reports the material mix, the share that is OSM-tagged and the mean confidence.
- Walls are built quad by quad with UVs in real metres, so the procedural facade texture puts window rows on actual floor levels at any building height.
- Roofs are built to `roof:shape` — flat, gabled, hipped, pyramidal, skillion, dome, mansard, gambrel — on the footprint's oriented bounding box, with `roof:orientation` honoured.
- `building:part` (Simple 3D Buildings) replaces the parent outline, so towers, podiums and setbacks come out right.
- Everything is batched by material: a few thousand buildings cost a handful of draw calls.

### 🌳 Vegetation
- **Surveyed trees** (`natural=tree`) stand exactly where OSM puts them, with `height`, `circumference`, `species` and `leaf_type` read off the node. Where height is missing but girth is not, it comes from the trunk diameter via the usual allometric relation.
- **Tree rows** (`natural=tree_row`) are stepped along their way at the mapped or a default spacing.
- **Wooded areas** — `natural=wood`, `landuse=forest`, `leisure=park` and friends — have no individual trees in OSM, so trunks are scattered inside the polygon at a per-tag density (220/ha for woodland, 45/ha for a park) from a seeded RNG: the canopy outline is real, the individual trunks are generated, and the same region always regrows the same wood. The sidebar reports the split between surveyed, row and scattered.
- Broadleaf, needleleaf, palm and shrub canopies, each one instanced mesh per class in the Terrain view and one billboard collection on the globe — a ten-thousand-tree forest costs a handful of draw calls.

### 🚗 Roads & traffic microsimulation
- The drivable OSM network is parsed into a routable directed graph: ways split at every junction, `lanes` / `lanes:forward` / `lanes:backward`, `oneway`, `junction=roundabout`, `maxspeed` (including `mph`, `walk`, `none` and `XX:urban` implicits), bridges, tunnels and `layer`.
- Vehicles drive with the **Intelligent Driver Model**, so queues, stop-and-go waves and signal discharge emerge instead of being scripted. On top of it: two-phase signals at every OSM `traffic_signals` node (phases derived from the approach axis, with an amber drivers stop for only when they comfortably can), priority and gap acceptance at untagged junctions, stop and give-way lines, roundabout priority, spillback so congestion propagates backwards, and lane choice with discretionary lane changes.
- A realistic fleet — cars, taxis, vans, motorcycles, buses, trucks — each with its own dimensions, acceleration, comfortable braking and desired-speed factor; heavy vehicles keep to the outer lanes and off living streets.
- Fully **deterministic**: the same seed replays exactly the same traffic, which is what makes the analytics comparable between runs.
- **Congestion analytics** — per-link density, flow, space-mean speed and level of service (A–F), a live throughput chart, a hotspot table, and roads coloured by LOS. The A–F letter is shown wherever the colour is, so the scale never depends on colour alone.
- **Routing** — click two points for the fastest drivable path, with free-flow and with-traffic travel times side by side.
- The same simulation instance drives both the Three.js terrain view (instanced 3D vehicles, lane-marked carriageways, lit signal heads) and the Cesium globe (ground-clamped polylines and point primitives), so switching views never restarts the city.

### 🛢️ Subsurface screening — groundwater & hydrocarbons
- Each Macrostrat unit's free-text lithology is classified into a rock class with first-order petrophysics: porosity, permeability, sealing capacity, organic richness and secondary (fracture / karst) porosity.
- **Aquifers** are scored on storage, transmission, thickness, confinement by an overlying aquitard, and depth against the freshwater limit, with an estimated depth to the water table derived from local relief and an aridity proxy.
- **Hydrocarbons** are scored as a petroleum system: source richness × thermal maturity (from burial depth and an assumed geothermal gradient), reservoir quality after compaction, seal capacity, and stratigraphic ordering — multiplicatively, so a missing element kills the play.
- Scored intervals are highlighted inside the 3D geology stack and listed in the sidebar with their evidence and their caveats.

> ⚠️ **This is a screening indicator, not a survey.** Every number comes from lithology and depth alone. There is no seismic, no well log, no geochemistry and no water-level measurement behind it — and trap geometry, the thing that actually holds hydrocarbons in place, cannot be seen from a stratigraphic column at all, so the trap term is capped and every hydrocarbon score is capped with it. It shows where a geologist would look next. It is never evidence that water or hydrocarbons are present.

### 🗿 Geology
- Macrostrat stratigraphic column rendered as sub-surface layers, plus an interactive column in the sidebar.

### 📊 Analysis & export
- Cursor coordinates in DD / DMS / UTM with one-click copy.
- Export: PNG screenshot, elevation grid as CSV, selected region as GeoJSON, per-link congestion as GeoJSON, subsurface screening as CSV (evidence and caveats included).

### 🧰 General
- Keyboard shortcuts: `Esc`, `Space`, `1`, `2`, `G`, `B`, `T`, `R`, `?`
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

**Every feature works with no API key at all** — both 3D views, terrain, satellite drape, buildings, roads, traffic, trees and geology all come from free, keyless sources. Two optional keys swap in higher-fidelity commercial data on the globe:

| Variable | Unlocks | Without it | Where to get it |
|---|---|---|---|
| `NEXT_PUBLIC_CESIUM_ION_TOKEN` | Cesium World Terrain (30 m, water mask), Cesium OSM Buildings (global, pre-tiled) | AWS Terrain Tiles for relief; OSM footprints extruded for the selected region | https://ion.cesium.com/tokens (free tier) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Photorealistic 3D Tiles — real captured mesh, including trees | The Cesium/OSM source | Google Cloud console → enable **Map Tiles API** for the key |

Put them in `.env.local` locally (start from `.env.example`), or in your hosting provider's environment settings. `NEXT_PUBLIC_*` values are inlined at build time, so redeploy after changing them. The globe's **Data sources** panel shows which one is live at any moment.

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
npm run check:sim     # behavioural checks for the simulation, geology and material logic
npm run check:scene   # building and vegetation pipelines, from Overpass response to geometry
```

`check:sim` builds a synthetic street grid and asserts on behaviour rather than
on individual functions — that trips complete, that the same seed replays
identically, that signals cycle, that the network does not deadlock over a ten
minute run, and that speed and flow follow a proper fundamental diagram. A
traffic microsimulation fails quietly (the cars still move, only the numbers are
wrong), so these are the checks that actually catch a regression.

`check:scene` runs the real Overpass parsers against a stubbed `fetch` and the
real mesh generators on the result, then asserts on what survives: the counts at
each stage, that geometry lands inside the frame with the right handedness and
scale, that scattered trees stay inside their polygon, and that the same region
replays identically.

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
│   ├── geology/     StratColumn (SVG), ProspectPanel (screening results), CrossSection
│   ├── map/         WorldMap (MapLibre 2D map, region drawing)
│   ├── traffic/     TrafficPanel (controls, throughput chart, LOS legend, hotspots)
│   ├── ui/          Toolbar (view switch + search), Sidebar, HelpPanel, ErrorBoundary, Attribution
│   └── viewer3d/    CesiumViewer (globe twin), TerrainViewer (analytical twin)
├── hooks/           useKeyboardShortcuts, usePlaceIdentity (reverse geocode)
├── lib/
│   ├── analysis/coordTransform.ts   proj4 CRS transforms, haversine distance
│   ├── buildings/osmFetcher.ts      Overpass footprints, parts, material & roof tags
│   ├── buildings/materials.ts       OSM material → PBR params, inference, facade textures
│   ├── buildings/buildingMesh.ts    per-material batched walls + roof:shape geometry
│   ├── geology/macrostratApi.ts     Macrostrat columns → layer definitions
│   ├── geology/lithology.ts         lith text → rock class + petrophysics
│   ├── geology/prospectivity.ts     aquifer & petroleum-system scoring (heuristic)
│   ├── traffic/osmRoads.ts          Overpass drivable network + control nodes
│   ├── traffic/roadGraph.ts         junction splitting, lanes/oneway/maxspeed, local frame
│   ├── traffic/routing.ts           seeded RNG, ambient routes, A* travel-time routing
│   ├── traffic/vehicles.ts          fleet catalogue and mix
│   ├── traffic/simulation.ts        IDM car-following, signals, priority, spillback, stats
│   ├── traffic/analytics.ts         LOS scale, colours, congestion GeoJSON
│   ├── traffic/trafficMesh.ts       Three.js road ribbons, instanced vehicles, signal heads
│   ├── traffic/cesiumTraffic.ts     ground-clamped roads + vehicle primitives on the globe
│   ├── traffic/trafficService.ts    one shared graph + simulation across both viewers
│   ├── terrain/demLoader.ts         tile math, Terrarium decode, multi-tile stitch, sampling, stats
│   ├── terrain/imageryLoader.ts     satellite tile stitcher aligned to the DEM tile grid
│   ├── terrain/landUseRasterizer.ts OSM land use → canvas texture
│   ├── terrain/meshGenerator.ts     terrain surface, geology stack, prospect volumes
│   ├── geocoding.ts                 Nominatim search + reverse, twin-region sizing
│   ├── exportUtils.ts · constants.ts
├── store/mapStore.ts                Zustand state (selection, view mode, place data, traffic)
└── types/                           geo, geology, buildings, traffic, subsurface
scripts/copy-cesium.mjs              prebuild: Cesium assets → public/cesium
```

---

## 🌐 Data sources & attribution

| Source | Data | Terms |
|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Basemap, buildings and their materials, roads, land use, geocoding (Nominatim) | ODbL |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | SRTM / global DEM (Terrarium) | Public domain / see registry |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Satellite imagery | Esri terms, attribution required |
| [Google Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles) | Photogrammetry meshes | Google Maps Platform terms, on-screen attribution required |
| [Cesium Ion](https://cesium.com/platform/cesium-ion/) | World Terrain, OSM Buildings | Cesium Ion terms |
| [Macrostrat](https://macrostrat.org) | Geological columns | CC-BY |

---

## 🔬 What is measured and what is modelled

GeoVista mixes real data with models, and tries never to blur the line:

| Layer | Real data | Modelled |
|---|---|---|
| Terrain | SRTM elevation, Esri imagery | — |
| Buildings | Footprints, heights, levels, and materials where OSM has them | Material, roof shape and covering where OSM is silent — labelled as inference, with a confidence score |
| Roads | Geometry, lane counts, one-ways, speed limits, signals, roundabouts | — |
| Trees | Surveyed trees and tree rows; the outline and tag of every wooded area | Individual trunks inside a wooded area — scattered at a per-tag density, labelled as scattered and counted separately |
| Traffic | — | **Everything.** Vehicles, demand and routes are synthetic. The network they drive on is real; the traffic on it is not a measurement of anything |
| Geology | Macrostrat stratigraphic column and lithology | — |
| Subsurface targets | — | **Everything.** Scores are derived from rock type and depth alone, with no seismic, well, geochemical or water-level data. A screening indicator, not a survey |

---

## 📄 License

MIT.
