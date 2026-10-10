// Reads every Fleet's Destinations and every Worker Group's Sources (raw, for hosts and ports) and
// joins them into Edge → Stream links. Uses the same /m/<id>/system/{inputs,outputs} endpoints as
// the config load, so no extra permissions are needed.
import { findLinks, type LineageLink } from '../model/lineage';
import { apiGet, type ListResponse } from './client';
import type { WorkerGroup } from './groups';

/** Groups of each kind read per refresh. */
const LINEAGE_GROUP_LIMIT = 20;

export async function fetchLineage(groups: WorkerGroup[], signal?: AbortSignal): Promise<LineageLink[]> {
  const items = (group: string, ep: 'inputs' | 'outputs') =>
    apiGet<ListResponse<unknown>>(`/m/${encodeURIComponent(group)}/system/${ep}`, signal)
      .then((b) => b.items ?? [])
      // One unreadable group shouldn't hide the links between the others.
      .catch((e: unknown) => (signal?.aborted ? Promise.reject(e) : []));
  const of = (kind: WorkerGroup['kind']) => groups.filter((g) => g.kind === kind).slice(0, LINEAGE_GROUP_LIMIT);
  const [fleets, streams] = await Promise.all([
    Promise.all(of('fleet').map(async (g) => ({ group: g.id, outputs: await items(g.id, 'outputs') }))),
    Promise.all(of('stream').map(async (g) => ({ group: g.id, inputs: await items(g.id, 'inputs') }))),
  ]);
  return findLinks(fleets, streams);
}
