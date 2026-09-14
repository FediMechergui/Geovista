/**
 * Load CesiumJS from the static build, once.
 *
 * See `./index` for why Cesium is not bundled. The script tag is injected
 * rather than rendered so that the promise can be awaited inside the globe's
 * dynamic import, which guarantees `window.Cesium` exists before any module
 * that reads it is evaluated.
 *
 * `CESIUM_BASE_URL` must be set before the script runs — Cesium reads it at
 * evaluation time to find its Workers and Assets.
 */

import { CESIUM_BASE_URL } from '@/lib/constants';

const SCRIPT_ID = 'cesiumjs';

let pending: Promise<void> | null = null;

export function loadCesium(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('CesiumJS can only be loaded in the browser.'));
  }
  if (window.Cesium) return Promise.resolve();
  if (pending) return pending;

  (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = CESIUM_BASE_URL;

  pending = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');

    script.addEventListener('load', () => {
      if (window.Cesium) resolve();
      else reject(new Error('CesiumJS loaded but did not define window.Cesium.'));
    });
    script.addEventListener('error', () => {
      // Let a later attempt retry rather than caching the failure forever.
      pending = null;
      script.remove();
      reject(new Error(`Failed to load CesiumJS from ${CESIUM_BASE_URL}/Cesium.js`));
    });

    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = `${CESIUM_BASE_URL}/Cesium.js`;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return pending;
}
