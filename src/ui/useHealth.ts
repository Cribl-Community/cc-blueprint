import { useEffect, useState } from 'react';
import { fetchHealth, type HealthMap, type HealthReport } from '../api/health';

export interface HealthState {
  health?: HealthMap;
  report?: Omit<HealthReport, 'health'>;
  /** Why live health isn't shown (no permission, request failed). */
  error?: string;
  at?: Date;
}

/** Live Source/Destination health for a group, re-read whenever `loadedAt` changes (each Refresh). */
export function useHealth(group: string | null, loadedAt: Date | null): HealthState {
  const [state, setState] = useState<HealthState & { group?: string }>({});
  useEffect(() => {
    if (!group || !loadedAt) return;
    const ctrl = new AbortController();
    fetchHealth(group, ctrl.signal)
      .then(({ health, ...report }) => setState({ group, health, report, at: new Date() }))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setState({ group, error: e instanceof Error ? e.message : String(e) });
      });
    return () => ctrl.abort();
  }, [group, loadedAt]);
  return state.group === group ? state : {};
}
