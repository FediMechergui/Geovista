"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import { useMapStore } from "@/store/mapStore";
import Toolbar from "@/components/ui/Toolbar";
import Sidebar from "@/components/ui/Sidebar";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import Attribution from "@/components/ui/Attribution";
import HelpPanel from "@/components/ui/HelpPanel";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

/* ------------------------------------------------------------------ */
/*  Dynamic imports — heavy libs only on the client, no SSR            */
/* ------------------------------------------------------------------ */

const WorldMap = dynamic(() => import("@/components/map/WorldMap"), {
  ssr: false,
  loading: () => <MapPlaceholder />,
});

const TerrainViewer = dynamic(
  () => import("@/components/viewer3d/TerrainViewer"),
  {
    ssr: false,
    loading: () => <ViewerPlaceholder label="Loading 3D Viewer…" />,
  },
);

/* CesiumViewer is available for globe mode — lazy-loaded on demand */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CesiumViewer = dynamic(
  () => import("@/components/viewer3d/CesiumViewer"),
  {
    ssr: false,
    loading: () => <ViewerPlaceholder label="Loading Globe…" />,
  },
);

/* ================================================================== */
/*  Home page                                                          */
/* ================================================================== */

export default function Home() {
  const is3DActive = useMapStore((s) => s.is3DActive);
  const selectedRegion = useMapStore((s) => s.selectedRegion);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);

  const toggleHelp = useCallback(() => setHelpOpen((o) => !o), []);

  /* Keyboard shortcuts */
  useKeyboardShortcuts(toggleHelp);

  const show3D = is3DActive && selectedRegion;

  return (
    <div className="flex h-screen flex-col">
      {/* Top toolbar */}
      <Toolbar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
      />

      {/* Content area: sidebar + map/viewer */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — hidden on mobile unless explicitly open */}
        <div className={`${sidebarOpen ? "block" : "hidden"} md:block`}>
          <Sidebar collapsed={!sidebarOpen} />
        </div>

        {/* Main canvas area */}
        <main className="relative flex-1">
          <ErrorBoundary label="Map / Viewer">
            {!show3D ? (
              /* -------- 2D only -------- */
              <ErrorBoundary label="2D Map">
                <WorldMap />
              </ErrorBoundary>
            ) : (
              /* -------- Split pane: 2D left · 3D right -------- */
              <PanelGroup orientation="horizontal">
                <Panel defaultSize={40} minSize={20}>
                  <ErrorBoundary label="2D Map">
                    <WorldMap />
                  </ErrorBoundary>
                </Panel>

                <PanelResizeHandle className="w-1.5" />

                <Panel defaultSize={60} minSize={30}>
                  <ErrorBoundary label="3D Viewer">
                    <TerrainViewer />
                  </ErrorBoundary>
                </Panel>
              </PanelGroup>
            )}
          </ErrorBoundary>
        </main>
      </div>

      {/* Attribution footer */}
      <Attribution />

      {/* Help / Legend overlay */}
      {helpOpen && <HelpPanel onClose={toggleHelp} />}
    </div>
  );
}

/* ================================================================== */
/*  Placeholders shown while dynamic imports load                      */
/* ================================================================== */

function MapPlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-900">
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-blue-500" />
        Loading map…
      </div>
    </div>
  );
}

function ViewerPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-950">
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-blue-500" />
        {label}
      </div>
    </div>
  );
}
