"use client";

import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import * as THREE from "three";
import type { GeologicalUnit } from "@/types/geology";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CrossSectionLayer {
  /** Geological unit metadata */
  unit: GeologicalUnit;
  /** Top depth in meters from surface */
  depthTop: number;
  /** Bottom depth in meters from surface */
  depthBottom: number;
}

interface CrossSectionProps {
  /** Ordered layers, top-to-bottom */
  layers: CrossSectionLayer[];
  /** Width of the section in meters (horizontal extent) */
  sectionWidth: number;
  /** CSS class */
  className?: string;
}

interface HoverInfo {
  x: number;
  y: number;
  unit: GeologicalUnit;
  depthTop: number;
  depthBottom: number;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CrossSection({
  layers,
  sectionWidth,
  className = "",
}: CrossSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  /* ---- Derived data ---- */
  const maxDepth = useMemo(
    () => Math.max(...layers.map((l) => l.depthBottom), 1),
    [layers],
  );

  /* ---- 3D Scene setup ---- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#111");
    sceneRef.current = scene;

    // Orthographic camera (fits section exactly)
    const aspect = w / h;
    const viewH = maxDepth * 1.15;
    const viewW = viewH * aspect;
    const camera = new THREE.OrthographicCamera(
      -viewW / 2,
      viewW / 2,
      0,
      -viewH,
      0.1,
      1000,
    );
    camera.position.set(0, 0, 10);
    camera.lookAt(0, -viewH / 2, 0);
    cameraRef.current = camera;

    // Light
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(5, 5, 10);
    scene.add(dirLight);

    // Build layers as flat rectangles
    const meshes: THREE.Mesh[] = [];
    const scaleX = viewW * 0.85; // leave margin for scale bar

    for (const layer of layers) {
      const layerH = layer.depthBottom - layer.depthTop;
      if (layerH <= 0) continue;

      const geo = new THREE.PlaneGeometry(scaleX, layerH);
      const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(layer.unit.color || "#666"),
        side: THREE.DoubleSide,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, -(layer.depthTop + layerH / 2), 0);
      mesh.userData = {
        unit: layer.unit,
        depthTop: layer.depthTop,
        depthBottom: layer.depthBottom,
      };
      scene.add(mesh);
      meshes.push(mesh);
    }
    meshesRef.current = meshes;

    // Scale bar (vertical line + ticks on the right)
    const barX = viewW / 2 - viewW * 0.04;
    addScaleBar(scene, barX, maxDepth);

    // Surface line
    const surfGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-viewW / 2, 0, 1),
      new THREE.Vector3(viewW / 2, 0, 1),
    ]);
    const surfMat = new THREE.LineBasicMaterial({ color: 0x44ff44 });
    scene.add(new THREE.Line(surfGeo, surfMat));

    // Render
    renderer.render(scene, camera);

    // Resize handler
    const onResize = () => {
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      renderer.setSize(nw, nh);
      renderer.render(scene, camera);
    };
    const obs = new ResizeObserver(onResize);
    obs.observe(container);

    return () => {
      obs.disconnect();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [layers, maxDepth]);

  /* ---- Hover interaction ---- */
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const container = containerRef.current;
      const camera = cameraRef.current;
      const scene = sceneRef.current;
      const renderer = rendererRef.current;
      if (!container || !camera || !scene || !renderer) return;

      const rect = container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(meshesRef.current);

      if (hits.length > 0) {
        const hit = hits[0];
        const ud = hit.object.userData as {
          unit: GeologicalUnit;
          depthTop: number;
          depthBottom: number;
        };
        setHover({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          unit: ud.unit,
          depthTop: ud.depthTop,
          depthBottom: ud.depthBottom,
        });

        // Highlight hovered mesh
        meshesRef.current.forEach((m) => {
          (m.material as THREE.MeshPhongMaterial).emissive.setHex(
            m === hit.object ? 0x333333 : 0x000000,
          );
        });
      } else {
        setHover(null);
        meshesRef.current.forEach((m) => {
          (m.material as THREE.MeshPhongMaterial).emissive.setHex(0x000000);
        });
      }

      renderer.render(scene, camera);
    },
    [],
  );

  const handlePointerLeave = useCallback(() => {
    setHover(null);
    meshesRef.current.forEach((m) => {
      (m.material as THREE.MeshPhongMaterial).emissive.setHex(0x000000);
    });
    if (sceneRef.current && cameraRef.current && rendererRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  }, []);

  if (layers.length === 0) {
    return (
      <div className={`flex items-center justify-center text-zinc-500 text-xs ${className}`}>
        No geological data for cross-section.
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {/* Three.js canvas container */}
      <div
        ref={containerRef}
        className="h-full w-full"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      />

      {/* Hover tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute z-20 rounded bg-zinc-800/95 px-3 py-2 text-[11px] text-zinc-200 shadow-lg border border-zinc-700"
          style={{ left: hover.x + 12, top: hover.y - 10 }}
        >
          <p className="font-semibold text-zinc-100">{hover.unit.strat_name}</p>
          <p className="text-zinc-400">Lithology: {hover.unit.lith}</p>
          <p className="text-zinc-400">
            Age: {hover.unit.age_bottom} – {hover.unit.age_top} Ma
          </p>
          <p className="text-zinc-400">
            Depth: {hover.depthTop.toFixed(0)} – {hover.depthBottom.toFixed(0)} m
          </p>
        </div>
      )}

      {/* Section width label */}
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-zinc-500">
        Section width: {sectionWidth >= 1000 ? `${(sectionWidth / 1000).toFixed(1)} km` : `${sectionWidth} m`}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Scale bar helper                                                   */
/* ------------------------------------------------------------------ */

function addScaleBar(scene: THREE.Scene, x: number, maxDepth: number) {
  const pts = [
    new THREE.Vector3(x, 0, 2),
    new THREE.Vector3(x, -maxDepth, 2),
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: 0xaaaaaa });
  scene.add(new THREE.Line(geo, mat));

  // Tick marks every round interval
  const interval = niceInterval(maxDepth);
  for (let d = 0; d <= maxDepth; d += interval) {
    const tickGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x - 2, -d, 2),
      new THREE.Vector3(x + 2, -d, 2),
    ]);
    scene.add(new THREE.Line(tickGeo, mat));

    // Depth label as a sprite
    const canvas = new OffscreenCanvas(64, 24);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#aaa";
      ctx.font = "11px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${d}m`, 60, 16);
      const tex = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(x + 8, -d, 2);
      const labelScale = maxDepth * 0.07;
      sprite.scale.set(labelScale * 2, labelScale, 1);
      scene.add(sprite);
    }
  }
}

/** Pick a round tick interval given a range. */
function niceInterval(range: number): number {
  const raw = range / 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const residual = raw / magnitude;
  if (residual <= 1.5) return magnitude;
  if (residual <= 3.5) return 2 * magnitude;
  if (residual <= 7.5) return 5 * magnitude;
  return 10 * magnitude;
}
