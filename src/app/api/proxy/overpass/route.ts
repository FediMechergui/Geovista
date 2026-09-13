import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy for the Overpass API.
 *
 * Avoids browser CORS issues and tries several mirrors. Hardened so the
 * route cannot be used as an open relay by third parties:
 *   - same-origin requests only (Sec-Fetch-Site / Origin check)
 *   - request body capped at 64 KB
 *   - body must be an Overpass `data=` form payload
 */

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const MAX_BODY_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 60_000;

function isSameOrigin(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;

  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return true;
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Query too large' }, { status: 413 });
  }
  if (!body.startsWith('data=')) {
    return NextResponse.json(
      { error: 'Body must be an Overpass "data=" form payload' },
      { status: 400 },
    );
  }

  let lastError: Error | null = null;

  for (const mirror of OVERPASS_MIRRORS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const response = await fetch(mirror, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: controller.signal,
      });

      if (!response.ok) {
        lastError = new Error(`Overpass ${mirror} returned ${response.status}`);
        continue;
      }

      const data = await response.json();
      return NextResponse.json(data);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[overpass-proxy] Mirror ${mirror} failed:`, lastError.message);
    } finally {
      clearTimeout(timeout);
    }
  }

  return NextResponse.json(
    { error: 'All Overpass mirrors failed', detail: lastError?.message },
    { status: 502 },
  );
}
