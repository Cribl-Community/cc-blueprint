// Live health of a group's Sources and Destinations, from the status endpoints. Read-only and
// separate from config: a failure here (no permission, workers offline) never blocks the report.
import { apiGet, type ListResponse } from './client';

export type Health = 'Green' | 'Yellow' | 'Red' | 'Unknown';

export interface ObjectHealth {
  health: Health;
  /** Worker Processes per health value, only non-zero ones. */
  counts: Partial<Record<Health, number>>;
  error?: string;
}

/** Keyed like layout nodes: `source:<id>` and `destination:<id>`. */
export type HealthMap = Map<string, ObjectHealth>;

interface RawStatus {
  id?: string;
  status?: { health?: string; healthCounts?: Partial<Record<Health, number>>; error?: { message?: string } };
}

const HEALTHS = new Set<Health>(['Green', 'Yellow', 'Red', 'Unknown']);

export function parseHealth(kind: 'source' | 'destination', body: ListResponse<RawStatus>, into: HealthMap = new Map()): HealthMap {
  for (const item of body.items ?? []) {
    if (!item.id || !item.status) continue;
    const h = item.status.health as Health;
    into.set(`${kind}:${item.id}`, {
      health: HEALTHS.has(h) ? h : 'Unknown',
      counts: item.status.healthCounts ?? {},
      error: item.status.error?.message,
    });
  }
  return into;
}

export async function fetchHealth(group: string, signal?: AbortSignal): Promise<HealthMap> {
  const g = `/m/${encodeURIComponent(group)}/system/status`;
  const [inputs, outputs] = await Promise.all([
    apiGet<ListResponse<RawStatus>>(`${g}/inputs`, signal),
    apiGet<ListResponse<RawStatus>>(`${g}/outputs`, signal),
  ]);
  return parseHealth('destination', outputs, parseHealth('source', inputs));
}
