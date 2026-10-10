// Live health of a group's Sources and Destinations. Read-only and separate from config: a failure
// here (no permission, nodes offline) never blocks the report.
//
// Health is read per node (`/w/<node id>/system/status/...`). The group-level list
// (`/m/<group>/system/status/...`) was captured reporting every object Green while the node itself
// reported four Red, with errors, so it's only a fallback.
import { apiGet, type ListResponse } from './client';
import { fetchNodes } from './nodes';

export type Health = 'Green' | 'Yellow' | 'Red' | 'Unknown';

export interface ObjectHealth {
  health: Health;
  /** Worker Processes per health value, only non-zero ones, summed across nodes. */
  counts: Partial<Record<Health, number>>;
  error?: string;
  /** Hostnames of the nodes that reported this object as not Green. */
  nodes?: string[];
}

/** Keyed like layout nodes: `source:<id>` and `destination:<id>`. */
export type HealthMap = Map<string, ObjectHealth>;

export interface HealthReport {
  health: HealthMap;
  /** Nodes whose status was read, out of how many the group has (when known). */
  checkedNodes: number;
  totalNodes?: number;
  /** True when no node could be read and the group-level summary was used instead. */
  groupLevel: boolean;
}

/** Nodes queried per refresh. Fleets can have thousands; the report says how many were checked. */
export const HEALTH_NODE_LIMIT = 10;

interface RawStatus {
  id?: string;
  status?: { health?: string; healthCounts?: Partial<Record<Health, number>>; error?: { message?: string } };
}

const HEALTHS = new Set<Health>(['Green', 'Yellow', 'Red', 'Unknown']);
const RANK: Record<Health, number> = { Green: 0, Unknown: 1, Yellow: 2, Red: 3 };

/** Adds one status list to `into`, keeping the worst health per object and noting which node said so. */
export function parseHealth(
  kind: 'source' | 'destination',
  body: ListResponse<RawStatus>,
  into: HealthMap = new Map(),
  node?: string,
): HealthMap {
  for (const item of body.items ?? []) {
    if (!item.id || !item.status) continue;
    const raw = item.status.health as Health;
    const health: Health = HEALTHS.has(raw) ? raw : 'Unknown';
    const key = `${kind}:${item.id}`;
    const prev = into.get(key);
    const counts = { ...prev?.counts };
    for (const [h, n] of Object.entries(item.status.healthCounts ?? {})) {
      counts[h as Health] = (counts[h as Health] ?? 0) + (n ?? 0);
    }
    const bad = health !== 'Green' || !!item.status.error;
    const worse = !prev || RANK[health] > RANK[prev.health];
    into.set(key, {
      health: worse ? health : prev.health,
      counts,
      error: (worse && item.status.error?.message) || prev?.error || item.status.error?.message,
      nodes: bad && node ? [...(prev?.nodes ?? []), node] : prev?.nodes,
    });
  }
  return into;
}

async function statusLists(prefix: string, signal?: AbortSignal) {
  return Promise.all([
    apiGet<ListResponse<RawStatus>>(`${prefix}/system/status/inputs`, signal),
    apiGet<ListResponse<RawStatus>>(`${prefix}/system/status/outputs`, signal),
  ]);
}

export async function fetchHealth(group: string, signal?: AbortSignal): Promise<HealthReport> {
  const connected = (await fetchNodes(group, signal).catch(() => [])).filter((n) => n.connected);
  const totalNodes = connected.length;
  const nodes = connected.slice(0, HEALTH_NODE_LIMIT);
  const health: HealthMap = new Map();
  let checked = 0;
  for (const n of nodes) {
    try {
      const [inputs, outputs] = await statusLists(`/w/${encodeURIComponent(n.id)}`, signal);
      parseHealth('source', inputs, health, n.hostname);
      parseHealth('destination', outputs, health, n.hostname);
      checked++;
    } catch (e) {
      if (signal?.aborted) throw e;
      // One unreachable node shouldn't hide the others; the count of checked nodes says so.
    }
  }
  if (checked > 0) return { health, checkedNodes: checked, totalNodes, groupLevel: false };
  const [inputs, outputs] = await statusLists(`/m/${encodeURIComponent(group)}`, signal);
  return {
    health: parseHealth('destination', outputs, parseHealth('source', inputs)),
    checkedNodes: 0,
    totalNodes,
    groupLevel: true,
  };
}
