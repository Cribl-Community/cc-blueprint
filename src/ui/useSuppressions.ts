import { useCallback, useEffect, useState } from 'react';
import type { Finding } from '../lint/types';
import { loadSuppressions, suppress, unsuppress, type SuppressionDoc } from '../store/suppressions';

export interface SuppressionsApi {
  doc: SuppressionDoc;
  /** Load or save error, shown in the Linter tab. */
  error?: string;
  loading: boolean;
  suppress: (finding: Finding, reason: string) => Promise<void>;
  unsuppress: (findingKey: string) => Promise<void>;
}

const EMPTY: SuppressionDoc = { schema: 1, items: {} };

export async function currentUser(): Promise<string | undefined> {
  try {
    const u = await window.getCriblUser();
    return u.username;
  } catch {
    return undefined;
  }
}

export function useSuppressions(group: string | null): SuppressionsApi {
  const [state, setState] = useState<{ group: string | null; doc: SuppressionDoc; error?: string }>({
    group: null,
    doc: EMPTY,
  });

  useEffect(() => {
    if (!group) return;
    let live = true;
    loadSuppressions(group)
      .then((doc) => live && setState({ group, doc }))
      .catch((e: unknown) => live && setState({ group, doc: EMPTY, error: `Couldn't load suppressions: ${String(e)}` }));
    return () => {
      live = false;
    };
  }, [group]);

  const doSuppress = useCallback(
    async (finding: Finding, reason: string) => {
      if (!group) return;
      const doc = await suppress(group, finding, reason, { by: await currentUser() });
      setState({ group, doc });
    },
    [group],
  );

  const doUnsuppress = useCallback(
    async (findingKey: string) => {
      if (!group) return;
      const doc = await unsuppress(group, findingKey);
      setState({ group, doc });
    },
    [group],
  );

  const current = state.group === group;
  return {
    doc: current ? state.doc : EMPTY,
    error: current ? state.error : undefined,
    loading: !current,
    suppress: doSuppress,
    unsuppress: doUnsuppress,
  };
}
