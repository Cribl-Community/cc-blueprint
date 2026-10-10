import { useEffect, useState } from 'react';
import type { WorkerGroup } from '../api/groups';
import { fetchLineage } from '../api/lineage';
import type { LineageLink } from '../model/lineage';

export interface LineageState {
  links?: LineageLink[];
  error?: string;
}

/** Edge → Stream links across all groups, re-read on every config load (each Refresh). */
export function useLineage(groups: WorkerGroup[] | null, loadedAt: Date | null): LineageState {
  const [state, setState] = useState<LineageState>({});
  useEffect(() => {
    if (!groups || !loadedAt) return;
    // Only meaningful with at least one Fleet and one Worker Group.
    if (!groups.some((g) => g.kind === 'fleet') || !groups.some((g) => g.kind === 'stream')) {
      setState({ links: [] });
      return;
    }
    const ctrl = new AbortController();
    fetchLineage(groups, ctrl.signal)
      .then((links) => setState({ links }))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setState({ error: e instanceof Error ? e.message : String(e) });
      });
    return () => ctrl.abort();
  }, [groups, loadedAt]);
  return state;
}
