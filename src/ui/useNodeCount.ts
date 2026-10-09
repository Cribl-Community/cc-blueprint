import { useEffect, useState } from 'react';
import { countNodes } from '../api/groups';

/** Connected Worker or Edge Nodes for a group, re-read on every config load; undefined if unknown. */
export function useNodeCount(group: string | null, loadedAt: Date | null): number | undefined {
  const [state, setState] = useState<{ group?: string; count?: number }>({});
  useEffect(() => {
    if (!group || !loadedAt) return;
    const ctrl = new AbortController();
    countNodes(group, ctrl.signal)
      .then((count) => setState({ group, count }))
      // Leave it unknown on failure: it's a summary detail, not worth an error banner.
      .catch(() => !ctrl.signal.aborted && setState({ group }));
    return () => ctrl.abort();
  }, [group, loadedAt]);
  return state.group === group ? state.count : undefined;
}
