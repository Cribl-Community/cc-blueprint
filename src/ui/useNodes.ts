import { useEffect, useState } from 'react';
import { countNodes } from '../api/groups';
import { fetchNodes, type NodeInfo } from '../api/nodes';

export interface NodesState {
  /** Total connected nodes in the group, from the Leader's summary. */
  count?: number;
  /** Up to NODE_LIMIT nodes with details. */
  nodes?: NodeInfo[];
  error?: string;
}

/** A group's Worker or Edge Nodes, re-read on every config load (each Refresh). */
export function useNodes(group: string | null, loadedAt: Date | null): NodesState {
  const [state, setState] = useState<NodesState & { group?: string }>({});
  useEffect(() => {
    if (!group || !loadedAt) return;
    const ctrl = new AbortController();
    Promise.all([countNodes(group, ctrl.signal), fetchNodes(group, ctrl.signal)])
      .then(([count, nodes]) => setState({ group, count, nodes }))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setState({ group, error: e instanceof Error ? e.message : String(e) });
      });
    return () => ctrl.abort();
  }, [group, loadedAt]);
  return state.group === group ? state : {};
}
