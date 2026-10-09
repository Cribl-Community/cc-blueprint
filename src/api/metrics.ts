// Last-hour event counts from the leader's metrics store (`POST /system/metrics/query`). Metrics are
// leader-level, so the group is a `where` filter, not a `/m/<group>` prefix (that path 404s).
// Inputs and outputs are identified as `<type>:<id>`; routes by route id.

export interface Throughput {
  earliest: number;
  latest: number;
  /** Events received, keyed by `<type>:<id>` of the Source. */
  sources: Map<string, number>;
  /** Events sent, keyed by `<type>:<id>` of the Destination. */
  destinations: Map<string, number>;
  /** Events into each Route, keyed by route id. */
  routes: Map<string, number>;
  /** Events into each Route from each Source, keyed by `routeKey(routeId, inputId)`. */
  routeBySource: Map<string, number>;
}

export const routeKey = (routeId: string, inputId: string) => `${routeId}\u0000${inputId}`;

const WINDOW_MS = 60 * 60 * 1000;
/**
 * Cribl aligns buckets to the clock, so a 1-hour bucket over 19:30–20:30 comes back as two whole
 * hours. Five-minute buckets aligned to the window, keeping only those starting inside it, give the
 * last hour to within five minutes.
 */
const BUCKET_S = 300;

/** One aggregation's rows, as returned under `results`. Shape varies, so parsing is lenient. */
type Row = Record<string, unknown>;

/**
 * Sums `alias` per split key across rows (one row per time bucket and split value). Falls back to
 * the first numeric non-dimension field when the alias isn't present.
 */
export function sumRows(rows: unknown, splitBys: string[], alias: string, sinceSeconds = 0): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(rows)) return out;
  for (const r of rows as Row[]) {
    if (!r || typeof r !== 'object') continue;
    // Rows without every split field are totals across the split; buckets before the window are dropped.
    if (splitBys.some((s) => typeof r[s] !== 'string')) continue;
    if (typeof r.starttime === 'number' && r.starttime < sinceSeconds) continue;
    let value = r[alias];
    if (typeof value !== 'number') {
      value = Object.entries(r).find(([k, v]) => typeof v === 'number' && !k.startsWith('_') && !splitBys.includes(k))?.[1];
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const key = splitBys.map((s) => r[s] as string).join('\u0000');
    out.set(key, (out.get(key) ?? 0) + value);
  }
  return out;
}

/** The request body for one metric, summed per split over the last hour for a group. */
export function metricQuery(group: string, metric: string, splitBys: string[], earliest: number, latest: number) {
  return {
    earliest,
    latest,
    where: `__worker_group==${JSON.stringify(group)}`,
    aggs: {
      aggregations: [`sum(${JSON.stringify(metric)}).as("value")`],
      splitBys,
      timeWindowSeconds: BUCKET_S,
    },
  };
}

async function query(body: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${window.CRIBL_API_URL}/system/metrics/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`POST /system/metrics/query failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { results?: unknown }).results;
}

/** Window start, aligned down to a bucket boundary, in milliseconds. */
export const windowStart = (now: number) => Math.floor((now - WINDOW_MS) / (BUCKET_S * 1000)) * BUCKET_S * 1000;

export async function fetchThroughput(group: string, signal?: AbortSignal, now = Date.now()): Promise<Throughput> {
  const earliest = windowStart(now);
  const run = async (metric: string, splitBys: string[]) =>
    sumRows(await query(metricQuery(group, metric, splitBys, earliest, now), signal), splitBys, 'value', earliest / 1000);
  const [sources, destinations, routes, routeBySource] = await Promise.all([
    run('total.in_events', ['input']),
    run('total.out_events', ['output']),
    run('route.in_events', ['route']),
    run('route.in_events', ['route', 'input']),
  ]);
  return { earliest, latest: now, sources, destinations, routes, routeBySource };
}
