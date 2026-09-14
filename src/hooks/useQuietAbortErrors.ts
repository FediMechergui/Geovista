"use client";

import { useEffect } from "react";

/**
 * Stop deliberate request cancellations from being reported as page errors.
 *
 * MapLibre cancels in-flight tile requests whenever the viewport changes —
 * `SourceCache._cleanUpRasterTiles` → `_abortTile` → `AbortController.abort()`.
 * It never attaches a rejection handler to the `loadTile` promise it just
 * cancelled, so every pan and every zoom step emits an uncaught
 * `AbortError: signal is aborted without reason`. Nothing is broken — the map
 * carries on — but a few seconds of scrolling buries the console under
 * hundreds of them, and a real error scrolls straight out of view.
 *
 * An `AbortError` is by definition a cancellation someone asked for, never a
 * failure, so suppressing exactly that one name is safe. Everything else is
 * left alone and still surfaces normally. Our own aborted fetches already
 * handle their rejections; this only covers the ones thrown inside
 * dependencies we do not control.
 */
export function useQuietAbortErrors(): void {
  useEffect(() => {
    function handleRejection(event: PromiseRejectionEvent): void {
      const reason: unknown = event.reason;
      const name =
        typeof reason === "object" && reason !== null
          ? (reason as { name?: unknown }).name
          : undefined;

      if (name === "AbortError") event.preventDefault();
    }

    window.addEventListener("unhandledrejection", handleRejection);
    return () => window.removeEventListener("unhandledrejection", handleRejection);
  }, []);
}
