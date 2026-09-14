/**
 * Trees on the globe.
 *
 * Billboards rather than meshes, for two reasons. A `BillboardCollection` is
 * one draw call for the whole forest, and — the part that matters most —
 * Cesium will clamp a billboard to terrain itself via `heightReference`, so
 * ten thousand trees need zero terrain samples and stay planted when the
 * terrain provider swaps or the tiles refine.
 *
 * Sprites are drawn to a canvas per canopy class at load time, so there are no
 * texture assets to ship and the palette stays in one place with the Terrain
 * view's.
 */

import {
  BillboardCollection,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  HeightReference,
  NearFarScalar,
  VerticalOrigin,
  type Viewer,
} from '@/lib/cesium';

import type { TreeInstance, TreeKind } from '@/types/vegetation';

/** Trees are not worth drawing beyond this range. */
const VISIBLE_M = 25_000;

/** Billboards drawn at most. Beyond this the collection is thinned evenly. */
const MAX_BILLBOARDS = 9000;

const SPRITE_PX = 128;

const CROWN: Record<TreeKind, [string, string]> = {
  broadleaf: ['#6aa84f', '#3f7a35'],
  needleleaf: ['#40734a', '#25492f'],
  palm: ['#7cb45c', '#4e8c3f'],
  shrub: ['#8bb266', '#5c8f45'],
};

const TRUNK: Record<TreeKind, string> = {
  broadleaf: '#5c4632',
  needleleaf: '#4a3a2b',
  palm: '#7a6547',
  shrub: '#5a4a35',
};

const spriteCache = new Map<TreeKind, HTMLCanvasElement>();

/** Draw one tree silhouette. Cheap, and it keeps the look consistent. */
function sprite(kind: TreeKind): HTMLCanvasElement {
  const cached = spriteCache.get(kind);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_PX;
  canvas.height = SPRITE_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const [light, dark] = CROWN[kind];
  const mid = SPRITE_PX / 2;

  // Trunk.
  const trunkTop = kind === 'palm' ? SPRITE_PX * 0.3 : SPRITE_PX * 0.62;
  ctx.fillStyle = TRUNK[kind];
  ctx.fillRect(mid - SPRITE_PX * 0.045, trunkTop, SPRITE_PX * 0.09, SPRITE_PX - trunkTop);

  const gradient = ctx.createLinearGradient(0, 0, SPRITE_PX, SPRITE_PX);
  gradient.addColorStop(0, light);
  gradient.addColorStop(1, dark);
  ctx.fillStyle = gradient;

  if (kind === 'needleleaf') {
    for (const [y, halfWidth] of [
      [SPRITE_PX * 0.08, 0.16],
      [SPRITE_PX * 0.3, 0.26],
      [SPRITE_PX * 0.52, 0.34],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(mid, y);
      ctx.lineTo(mid + SPRITE_PX * halfWidth, y + SPRITE_PX * 0.24);
      ctx.lineTo(mid - SPRITE_PX * halfWidth, y + SPRITE_PX * 0.24);
      ctx.closePath();
      ctx.fill();
    }
  } else if (kind === 'palm') {
    for (let i = 0; i < 7; i++) {
      const angle = Math.PI + (i / 6) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(mid, trunkTop);
      ctx.quadraticCurveTo(
        mid + Math.cos(angle) * SPRITE_PX * 0.3,
        trunkTop + Math.sin(angle) * SPRITE_PX * 0.22,
        mid + Math.cos(angle) * SPRITE_PX * 0.46,
        trunkTop + Math.sin(angle) * SPRITE_PX * 0.1 + SPRITE_PX * 0.1,
      );
      ctx.lineWidth = SPRITE_PX * 0.07;
      ctx.strokeStyle = gradient;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  } else {
    // Overlapping blobs read as foliage far better than one smooth ellipse.
    const blobs: Array<[number, number, number]> =
      kind === 'shrub'
        ? [[0, 0.7, 0.3], [-0.2, 0.78, 0.22], [0.2, 0.78, 0.22]]
        : [[0, 0.34, 0.3], [-0.22, 0.46, 0.24], [0.22, 0.46, 0.24], [0, 0.56, 0.26]];
    for (const [dx, cy, r] of blobs) {
      ctx.beginPath();
      ctx.arc(mid + dx * SPRITE_PX, cy * SPRITE_PX, r * SPRITE_PX, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  spriteCache.set(kind, canvas);
  return canvas;
}

/** Forget the cached sprites — only needed if the palette ever changes. */
export function clearTreeSpriteCache(): void {
  spriteCache.clear();
}

export interface CesiumTreeLayer {
  readonly count: number;
  setVisible(visible: boolean): void;
  destroy(): void;
}

/**
 * Plant `trees` on the globe. Returns `null` when there is nothing to plant.
 */
export function createCesiumTreeLayer(
  viewer: Viewer,
  trees: TreeInstance[],
): CesiumTreeLayer | null {
  if (trees.length === 0) return null;

  const collection = new BillboardCollection({ scene: viewer.scene });
  const visibility = new DistanceDisplayCondition(0, VISIBLE_M);
  // Trees hold their real size up close and stop shrinking into invisibility
  // when the camera pulls back to neighbourhood range.
  const scaleByDistance = new NearFarScalar(200, 1.0, VISIBLE_M, 0.35);

  const stride = Math.max(1, Math.ceil(trees.length / MAX_BILLBOARDS));
  let count = 0;

  for (let i = 0; i < trees.length; i += stride) {
    const tree = trees[i];
    collection.add({
      position: Cartesian3.fromDegrees(tree.lon, tree.lat),
      image: sprite(tree.kind),
      sizeInMeters: true,
      width: Math.max(1.2, tree.radius * 2),
      height: Math.max(1.5, tree.height),
      verticalOrigin: VerticalOrigin.BOTTOM,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      distanceDisplayCondition: visibility,
      scaleByDistance,
      // A little per-tree brightness stops a wood looking like wallpaper.
      color: Color.fromHsl(0, 0, 0.86 + tree.variation * 0.14, 1),
    });
    count++;
  }

  viewer.scene.primitives.add(collection);

  return {
    count,
    setVisible(visible: boolean) {
      collection.show = visible;
    },
    destroy() {
      if (!viewer.isDestroyed() && !collection.isDestroyed()) {
        viewer.scene.primitives.remove(collection);
      }
    },
  };
}
