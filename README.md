<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/Three.js-0.183-black?logo=three.js" alt="Three.js" />
  <img src="https://img.shields.io/badge/CesiumJS-1.140-blue?logo=cesium" alt="CesiumJS" />
  <img src="https://img.shields.io/badge/MapLibre_GL-5.23-orange" alt="MapLibre" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

# 🌍 GeoVista

**A professional 3D geomatics visualization platform** for exploring terrain, buildings, geology and bathymetry in an interactive split-pane 2D/3D web application.

Built with Next.js 16, Three.js, CesiumJS, MapLibre GL and Zustand.

![GeoVista Preview](https://via.placeholder.com/1200x600/0a0a0a/3b82f6?text=GeoVista+—+3D+Geomatics+Visualization)

---

## ✨ Features

### 🗺️ 2D Map (MapLibre GL)
- OpenStreetMap, Satellite, Terrain, Dark basemaps
- Bounding box selection tool for region picking
- Real-time cursor coordinates (WGS84 / DMS / UTM)
- Nominatim geocoder search
- Navigation controls & scale bar

### 🏔️ 3D Terrain Viewer (Three.js + React Three Fiber)
- SRTM elevation data with hypsometric coloring
- Adjustable vertical exaggeration (0.5× – 10×)
- 3D OSM buildings (extruded footprints)
- Subsurface geological layers (Macrostrat API)
- Measurement tools with geodesic distance
- Elevation profile (Recharts AreaChart)
- Underground camera mode

### 🌐 Globe View (CesiumJS + Resium)
- Full Earth globe with OSM imagery
- Terrain exaggeration & underground translucency
- 3D measurement entities
- Depth-tested labels

### 📊 Analysis Tools
- **Elevation Profile** — Recharts AreaChart with hypsometric gradient fill, min/max/avg stats
- **Coordinate Display** — Real-time DD / DMS / UTM with clipboard copy
- **Geological Cross-Section** — Interactive Three.js cross-section with hover tooltips
- **Stratigraphic Column** — SVG column with lithology patterns, age ranges, and detail view

### 🧰 General
- Keyboard shortcuts (`Esc`, `Space`, `1`/`2`, `B`, `?`)
- Error boundaries with retry on all panels
- Help/Legend panel
- Responsive layout (desktop + tablet + mobile)
- Dark theme throughout
- Split-pane resizable panels (2D left / 3D right)

### 📤 Export
- **PNG** — Screenshot the current 3D canvas
- **CSV** — Export elevation grid (lon, lat, elevation)
- **GeoJSON** — Export selected region as a Polygon feature

### ⚡ Performance
- Dynamic imports (CesiumJS, Three.js loaded only on client)
- Web Worker for terrain mesh vertex computation
- Tile-based progressive loading (center-first spiral)
- 3-tier LOD (Level of Detail): z12 / z10 / z8

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router, Turbopack) |
| Language | TypeScript 5, React 19 |
| 3D Engine | [Three.js](https://threejs.org) 0.183 + [@react-three/fiber](https://docs.pmnd.rs/react-three-fiber) 9 |
| Globe | [CesiumJS](https://cesium.com) 1.140 + [Resium](https://resium.reearth.io) 1.20 |
| 2D Map | [MapLibre GL](https://maplibre.org) 5.23 + [react-map-gl](https://visgl.github.io/react-map-gl) 8 |
| State | [Zustand](https://zustand-demo.pmnd.rs) 5 |
| Charts | [Recharts](https://recharts.org) 3 |
| Styling | [Tailwind CSS](https://tailwindcss.com) 4 |
| Icons | [Lucide React](https://lucide.dev) |
| Projections | [proj4js](http://proj4js.org) |
| GeoTIFF | [geotiff.js](https://geotiffjs.github.io) |
| Spatial | [@turf/turf](https://turfjs.org) |

---

## 📂 Project Structure

```
geovista/
├── public/textures/           # Static assets (terrain textures, etc.)
├── src/
│   ├── app/
│   │   ├── globals.css        # Tailwind + Cesium/MapLibre overrides + animations
│   │   ├── layout.tsx         # Root layout (dark theme, fonts, metadata)
│   │   └── page.tsx           # Main page (split-pane, error boundaries, shortcuts)
│   ├── components/
│   │   ├── analysis/
│   │   │   ├── CoordDisplay.tsx       # Real-time cursor coords (DD/DMS/UTM)
│   │   │   └── ElevationProfile.tsx   # Recharts elevation profile
│   │   ├── geology/
│   │   │   ├── CrossSection.tsx       # Three.js geological cross-section
│   │   │   └── StratColumn.tsx        # SVG stratigraphic column
│   │   ├── map/
│   │   │   └── WorldMap.tsx           # MapLibre GL 2D map
│   │   ├── ui/
│   │   │   ├── Attribution.tsx        # Data credits footer
│   │   │   ├── ErrorBoundary.tsx      # React error boundary with retry
│   │   │   ├── HelpPanel.tsx          # Help/legend modal
│   │   │   ├── Sidebar.tsx            # Layer toggles, settings, export
│   │   │   └── Toolbar.tsx            # Brand, view toggle, search
│   │   └── viewer3d/
│   │       ├── CesiumViewer.tsx       # CesiumJS globe view
│   │       └── TerrainViewer.tsx      # R3F 3D terrain viewer
│   ├── hooks/
│   │   └── useKeyboardShortcuts.ts    # Global keyboard shortcuts
│   ├── lib/
│   │   ├── constants.ts               # Tile URLs, API endpoints, hypsometric stops
│   │   ├── exportUtils.ts             # PNG/CSV/GeoJSON export functions
│   │   ├── analysis/
│   │   │   └── coordTransform.ts      # proj4 CRS transforms, geodesic distance
│   │   ├── bathymetry/                # (placeholder for GEBCO integration)
│   │   ├── buildings/
│   │   │   └── osmFetcher.ts          # Overpass API building fetcher
│   │   ├── geology/
│   │   │   └── macrostratApi.ts       # Macrostrat geology API client
│   │   └── terrain/
│   │       ├── demLoader.ts           # DEM tile + GeoTIFF loaders
│   │       ├── meshGenerator.ts       # Three.js mesh generators
│   │       ├── progressiveLoader.ts   # Tile-based progressive loading + LOD
│   │       └── terrainWorker.ts       # Web Worker for vertex computation
│   ├── store/
│   │   └── mapStore.ts                # Zustand global state
│   └── types/
│       ├── buildings.ts               # BuildingData interface
│       ├── geo.ts                     # BBox, Coordinate, ElevationGrid, etc.
│       └── geology.ts                 # GeologicalUnit, GeologicalColumn, etc.
├── eslint.config.mjs
├── next.config.mjs
├── package.json
├── postcss.config.mjs
└── tsconfig.json
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18.18
- **npm** ≥ 9

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/geovista.git
cd geovista

# Install dependencies
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for production

```bash
npm run build
npm start
```

### Type-check

```bash
npx tsc --noEmit
```

### Lint

```bash
npm run lint
```

---

## 🎹 Keyboard Shortcuts

| Key | Action |
|---|---|
| `Esc` | Exit selection mode / deselect region |
| `Space` | Toggle 2D ↔ 3D view |
| `1` | Switch to 2D map |
| `2` | Switch to 3D viewer |
| `B` | Cycle basemap (OSM → Satellite → Terrain → Dark) |
| `?` | Toggle help panel |

---

## 🌐 Data Sources & Attribution

| Source | Data | License |
|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org) | Basemap tiles, building footprints | ODbL |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | SRTM elevation (Terrarium encoding) | Public Domain |
| [Macrostrat](https://macrostrat.org) | Geological columns, surface geology | CC-BY |
| [GEBCO](https://www.gebco.net) | Bathymetry data | Free for research |
| [Nominatim](https://nominatim.openstreetmap.org) | Geocoding | ODbL |

---

## 📦 Key Dependencies

```json
{
  "next": "16.2.3",
  "react": "19.2.4",
  "three": "0.183.0",
  "@react-three/fiber": "9.6.0",
  "@react-three/drei": "10.7.0",
  "cesium": "1.140.0",
  "resium": "1.20.1",
  "maplibre-gl": "5.23.0",
  "react-map-gl": "8.1.0",
  "zustand": "5.0.0",
  "recharts": "3.8.0",
  "proj4": "2.15.0",
  "geotiff": "3.0.1",
  "@turf/turf": "7.3.0"
}
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built with ❤️ for the geomatics community
</p>
