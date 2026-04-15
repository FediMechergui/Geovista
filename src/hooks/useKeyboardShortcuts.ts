"use client";

import { useEffect } from "react";
import { useMapStore } from "@/store/mapStore";

/**
 * Global keyboard shortcuts.
 *
 *   Escape  — exit selection mode / deselect region
 *   Space   — toggle 3D view (when region is selected)
 *   1       — switch to 2D
 *   2       — switch to 3D
 *   B       — cycle basemap
 *   ?       — toggle help panel
 *
 * @param onToggleHelp callback to open/close the help panel
 */
export function useKeyboardShortcuts(onToggleHelp: () => void) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Ignore when user is typing in an input / textarea / contenteditable
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) {
        return;
      }

      const store = useMapStore.getState();

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          if (store.selectionMode) {
            store.setSelectionMode(null);
          } else if (store.selectedRegion) {
            store.setSelectedRegion(null);
            store.set3DActive(false);
          }
          break;

        case " ": // Space
          e.preventDefault();
          if (store.selectedRegion) {
            store.set3DActive(!store.is3DActive);
          }
          break;

        case "1":
          e.preventDefault();
          store.set3DActive(false);
          break;

        case "2":
          e.preventDefault();
          if (store.selectedRegion) store.set3DActive(true);
          break;

        case "b":
        case "B": {
          e.preventDefault();
          const maps = ["osm", "satellite", "terrain", "dark"] as const;
          const idx = maps.indexOf(store.basemap);
          store.setBasemap(maps[(idx + 1) % maps.length]);
          break;
        }

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
