import { apiGet, type ListResponse } from './client';

export interface WorkerGroup {
  id: string;
  name: string;
  /** A Stream Worker Group or an Edge Fleet; both use the same `/m/<id>/` config API. */
  kind: 'stream' | 'fleet';
  workerCount: number;
  /** Number of uncommitted config changes, when the Leader reports it. */
  localChanges?: number;
}

interface RawGroup {
  id: string;
  name?: string;
  type?: string;
  isFleet?: boolean;
  isSearch?: boolean;
  workerCount?: number;
  git?: { localChanges?: number };
}

function kindOf(g: RawGroup): WorkerGroup['kind'] | undefined {
  if (g.type === 'stream') return 'stream';
  if (g.type === 'edge') return 'fleet';
  if (g.type) return undefined; // search, outpost, and anything newer
  // Older Leaders omit `type` and flag the group instead.
  if (g.isSearch) return undefined;
  return g.isFleet ? 'fleet' : 'stream';
}

/** Keeps Stream Worker Groups and Edge Fleets; Search and Outpost groups are out of scope. */
export function parseGroups(body: ListResponse<RawGroup>): WorkerGroup[] {
  return (body.items ?? [])
    .filter((g) => kindOf(g) !== undefined)
    .map((g) => ({
      id: g.id,
      name: g.name || g.id,
      kind: kindOf(g)!,
      workerCount: g.workerCount ?? 0,
      localChanges: g.git?.localChanges,
    }))
    // Worker Groups first, then Fleets, each by name.
    .sort((a, b) => Number(a.kind === 'fleet') - Number(b.kind === 'fleet') || a.name.localeCompare(b.name));
}

export async function listWorkerGroups(signal?: AbortSignal): Promise<WorkerGroup[]> {
  const body = await apiGet<ListResponse<RawGroup>>(
    '/master/groups?fields=git.localChanges',
    signal,
  );
  return parseGroups(body);
}

/** Connected Worker or Edge Nodes in a group, from the Leader's node summary. */
export async function countNodes(group: string, signal?: AbortSignal): Promise<number> {
  const filterExp = encodeURIComponent(`group==${JSON.stringify(group)}`);
  const body = await apiGet<{ items?: unknown[] }>(`/master/summary/workers?filterExp=${filterExp}`, signal);
  const n = body.items?.[0];
  return typeof n === 'number' ? n : 0;
}
