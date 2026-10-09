import { useEffect, useState } from 'react';
import { fetchThroughput, type Throughput } from '../api/metrics';

export interface ThroughputState {
  throughput?: Throughput;
  /** Why event counts aren't shown (no permission, request failed). */
  error?: string;
}

/** Last-hour event counts for a group, re-read whenever `loadedAt` changes (each Refresh). */
export function useThroughput(group: string | null, loadedAt: Date | null): ThroughputState {
  const [state, setState] = useState<ThroughputState & { group?: string }>({});
  useEffect(() => {
    if (!group || !loadedAt) return;
    const ctrl = new AbortController();
    fetchThroughput(group, ctrl.signal)
      .then((throughput) => setState({ group, throughput }))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setState({ group, error: e instanceof Error ? e.message : String(e) });
      });
    return () => ctrl.abort();
  }, [group, loadedAt]);
  return state.group === group ? state : {};
}
