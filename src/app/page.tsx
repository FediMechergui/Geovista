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
import { usePlaceIdentity } from "@/hooks/usePlaceIdentity";

/* ------------------------------------------------------------------ */
/*  Dynamic imports — heavy libs only on the client, no SSR            */
/* ------------------------------------------------------------------ */

const WorldMap = dynamic(() => import("@/components/map/WorldMap"), {
  ssr: false,
  loading: () => <Placeholder label="Loading map…" />,
});

const TerrainViewer = dynamic(() => import("@/components/viewer3d/TerrainViewer"), {
  ssr: false,
  loading: () => <Placeholder label="Loading terrain viewer…" />,
});

const CesiumViewer = dynamic(() => import("@/components/viewer3d/CesiumViewer"), {
  ssr: false,
  loading: () => <Placeholder label="Loading globe…" />,
});

/* ================================================================== */
/*  Home page                                                          */
/* ================================================================== */

export default function Home() {
  const is3DActive = useMapStore((s) => s.is3DActive);
  const viewerMode = useMapStore((s) => s.viewerMode);
  const selectedRegion = useMapStore((s) => s.selectedRegion);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const toggleHelp = useCallback(() => setHelpOpen((o) => !o), []);

  useKeyboardShortcuts(toggleHelp);
  usePlaceIdentity();

  // The globe works without a region; the terrain twin needs one.
  const show3D = is3DActive && (viewerMode === "globe" || !!selectedRegion);

  return (
    <div className="relative flex h-screen flex-col">
      <Toolbar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} />

      <div className="flex flex-1 overflow-hidden">
        <div className={`${sidebarOpen ? "block" : "hidden"} md:block`}>
          <Sidebar collapsed={!sidebarOpen} />
        </div>

        <main className="relative flex-1">
          <ErrorBoundary label="Map / Viewer">
            {!show3D ? (
              <ErrorBoundary label="2D Map">
                <WorldMap />
              </ErrorBoundary>
            ) : (
              <PanelGroup orientation="horizontal">
                <Panel defaultSize={35} minSize={15}>
                  <ErrorBoundary label="2D Map">
                    <WorldMap />
                  </ErrorBoundary>
                </Panel>

                <PanelResizeHandle className="w-1.5" />

                <Panel defaultSize={65} minSize={30}>
                  {viewerMode === "globe" ? (
                    <ErrorBoundary label="Globe">
                      <CesiumViewer />
                    </ErrorBoundary>
                  ) : (
                    <ErrorBoundary label="Terrain Viewer">
                      <TerrainViewer />
                    </ErrorBoundary>
                  )}
                </Panel>
              </PanelGroup>
            )}
          </ErrorBoundary>
        </main>
      </div>

      <Attribution />

      {helpOpen && <HelpPanel onClose={toggleHelp} />}
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-950">
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-blue-500" />
        {label}
      </div>
    </div>
  );
}
