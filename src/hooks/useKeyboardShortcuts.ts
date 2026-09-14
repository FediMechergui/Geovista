"use client";

import { useEffect } from "react";
import { useMapStore } from "@/store/mapStore";

/**
 * Global keyboard shortcuts.
 *
 *   Escape  — exit selection mode / deselect region
 *   Space   — toggle 2D ↔ 3D
 *   1       — 2D map
 *   2       — 3D view (current mode)
 *   G       — switch Globe ↔ Terrain
 *   B       — cycle 2D basemap
 *   T       — toggle the traffic simulation
 *   R       — toggle the road network
 *   ?       — toggle help panel
 */
export function useKeyboardShortcuts(onToggleHelp: () => void) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        target?.isContentEditable
      ) {
        return;
      }

      const store = useMapStore.getState();
      const can3D = store.viewerMode === "globe" || !!store.selectedRegion;

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          if (store.selectionMode) {
            store.setSelectionMode(null);
          } else if (store.selectedRegion) {
            store.setSelectedRegion(null);
            if (store.viewerMode === "terrain") store.set3DActive(false);
          }
          break;

        case " ":
          e.preventDefault();
          if (store.is3DActive) store.set3DActive(false);
          else if (can3D) store.set3DActive(true);
          break;

        case "1":
          e.preventDefault();
          store.set3DActive(false);
          break;

        case "2":
          e.preventDefault();
          if (can3D) store.set3DActive(true);
          break;

        case "g":
        case "G":
          e.preventDefault();
          if (store.viewerMode === "globe") {
            if (store.selectedRegion) store.setViewerMode("terrain");
          } else {
            store.setViewerMode("globe");
          }
          break;

        case "b":
        case "B": {
          e.preventDefault();
          const maps = ["osm", "satellite", "terrain", "dark"] as const;
          const idx = maps.indexOf(store.basemap);
          store.setBasemap(maps[(idx + 1) % maps.length]);
          break;
        }

        case "t":
        case "T":
          e.preventDefault();
          store.toggleLayer("traffic");
          break;

        case "r":
        case "R":
          e.preventDefault();
          store.toggleLayer("roads");
          break;

        case "?":
          e.preventDefault();
          onToggleHelp();
          break;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onToggleHelp]);
}
