'use client';

import { useEffect } from 'react';
import { useMapStore } from '@/store/mapStore';
import { reversePlace } from '@/lib/geocoding';

/**
 * Reverse-geocodes the selected region's centre so the sidebar can name the
 * place. Skipped when a search already supplied the identity.
 */
export function usePlaceIdentity() {
  const selectedRegion = useMapStore((s) => s.selectedRegion);

  useEffect(() => {
    if (!selectedRegion) return;
    if (useMapStore.getState().placeInfo) return;

    let cancelled = false;
    const lon = (selectedRegion.west + selectedRegion.east) / 2;
    const lat = (selectedRegion.south + selectedRegion.north) / 2;

    reversePlace(lon, lat)
      .then((info) => {
        if (cancelled || !info) return;
        const store = useMapStore.getState();
        if (store.selectedRegion === selectedRegion) store.setPlaceInfo(info);
      })
      .catch(() => {
        /* naming is best-effort */
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRegion]);
}
