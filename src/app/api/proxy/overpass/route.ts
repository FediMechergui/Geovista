import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy for the Overpass API.
 * Avoids CORS / browser-level network issues by making the request server-side.
 * Tries multiple mirrors for resilience.
 */

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();

    let lastError: Error | null = null;

    for (const mirror of OVERPASS_MIRRORS) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);

        const response = await fetch(mirror, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          lastError = new Error(`Overpass ${mirror} returned ${response.status}`);
          continue;
        }

        const data = await response.json();
        return NextResponse.json(data);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[overpass-proxy] Mirror ${mirror} failed:`, lastError.message);
      }
    }

    return NextResponse.json(
      { error: 'All Overpass mirrors failed', detail: lastError?.message },
      { status: 502 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: 'Proxy error', detail: String(err) },
      { status: 500 },
    );
  }
}
