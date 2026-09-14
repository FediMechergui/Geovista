/**
 * The single client every Overpass query goes through.
 *
 * Two things had to live in one place.
 *
 * **A timeout is not an error, as far as HTTP is concerned.** When a query
 * exceeds its `[timeout:N]` or the server's memory budget, Overpass answers
 * `200 OK` with whatever it managed to collect *and* a `remark` field saying
 * what went wrong. Read naively that is indistinguishable from a complete
 * answer, so a query that died two seconds in looks like a region with two
 * buildings in it. Every caller here treats a `remark` as the failure it is.
 *
 * **Overpass allows about two concurrent slots per IP.** The globe asks for
 * roads, buildings and vegetation the moment a region is selected, and the
 * proxy makes all three arrive from one address, so the third is refused or
 * starved. Requests are therefore queued and issued one at a time: three
 * queries that each finish beat three that each time out.
 */

/** Server-side budget, seconds. Kept under the proxy's own 60 s ceiling. */
export const QUERY_TIMEOUT_S = 55;

/** Remarks Overpass uses for "you did not get everything". */
const FATAL_REMARK = /timed out|out of memory|runtime error|Query run out/i;

export interface OverpassResult<T> {
  elements: T[];
}

/** One query in flight at a time; the rest wait their turn. */
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  // Keep the chain alive even when a link rejects.
  chain = run.catch(() => undefined);
  return run;
}

/**
 * Run an Overpass QL query and return its elements.
 *
 * Throws on transport failure, on a non-OK status, and on a truncated answer —
 * the caller gets an error it can show rather than a plausible-looking
 * fraction of the data.
 */
export async function overpassQuery<T>(
  query: string,
  signal?: AbortSignal,
): Promise<T[]> {
  return enqueue(async () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const response = await fetch('/api/proxy/overpass', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal,
    });

    if (!response.ok) {
      throw new Error(`Overpass returned ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OverpassResult<T> & { remark?: string };

    if (data.remark && FATAL_REMARK.test(data.remark)) {
      throw new Error(
        `Overpass could not finish this query (${data.remark.trim()}). ` +
          'Try a smaller region.',
      );
    }

    return data.elements ?? [];
  });
}
