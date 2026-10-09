import { useCallback, useEffect, useState } from 'react';
import type { Severity } from '../lint/types';
import { emptyRuleSettings, loadRuleSettings, setRuleSetting, type RuleSettingsDoc } from '../store/ruleSettings';
import { currentUser } from './useSuppressions';

export interface RuleSettingsApi {
  doc: RuleSettingsDoc;
  /** Load or save error, shown in the Linter tab. */
  error?: string;
  loading: boolean;
  update: (ruleId: string, change: { enabled?: boolean; severity?: Severity }) => Promise<void>;
}

const EMPTY = emptyRuleSettings();

export function useRuleSettings(group: string | null): RuleSettingsApi {
  const [state, setState] = useState<{ group: string | null; doc: RuleSettingsDoc; error?: string }>({
    group: null,
    doc: EMPTY,
  });

  useEffect(() => {
    if (!group) return;
    let live = true;
    loadRuleSettings(group)
      .then((doc) => live && setState({ group, doc }))
      .catch((e: unknown) => live && setState({ group, doc: EMPTY, error: `Couldn't load rule settings: ${String(e)}` }));
    return () => {
      live = false;
    };
  }, [group]);

  const update = useCallback(
    async (ruleId: string, change: { enabled?: boolean; severity?: Severity }) => {
      if (!group) return;
      try {
        const doc = await setRuleSetting(group, ruleId, change, { by: await currentUser() });
        setState({ group, doc });
      } catch (e) {
        setState((s) => ({ ...s, error: `Couldn't save rule settings: ${String(e)}` }));
      }
    },
    [group],
  );

  const current = state.group === group;
  return { doc: current ? state.doc : EMPTY, error: current ? state.error : undefined, loading: !current, update };
}
