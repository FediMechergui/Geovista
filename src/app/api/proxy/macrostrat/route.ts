import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy for the Macrostrat API.
 * Avoids CORS / browser-level network issues.
 *
 * Route: GET /api/proxy/macrostrat?url=/columns?lat=X&lng=Y&...
 * The `url` query param is appended to the Macrostrat base URL.
 */

const MACROSTRAT_BASE = 'https://macrostrat.org/api/v2';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const path = searchParams.get('path');

    if (!path) {
      return NextResponse.json(
        { error: 'Missing "path" query parameter' },
        { status: 400 },
      );
    }

    // Rebuild query string: take all params except "path"
    const forwardParams = new URLSearchParams();
    searchParams.forEach((value, key) => {
      if (key !== 'path') {
        forwardParams.set(key, value);
      }
    });

    const qs = forwardParams.toString();
    const url = `${MACROSTRAT_BASE}${path}${qs ? `?${qs}` : ''}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json(
        { error: `Macrostrat returned ${response.status}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: 'Proxy error', detail: String(err) },
      { status: 502 },
    );
  }
}
