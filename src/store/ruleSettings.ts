// Per-group rule settings: one KV document, `rules/<group>`, keyed by rule id. Only rules that
// differ from their defaults are stored, so a rule set back to its default disappears from the doc.
import { RULES } from '../lint/rules';
import { compareFindings } from '../lint/runner';
import type { Finding, Severity } from '../lint/types';
import { httpKv, kvKey, type KvClient } from './kv';

export interface RuleSetting {
  enabled?: boolean;
  severity?: Severity;
  by?: string;
  at: string;
}

export interface RuleSettingsDoc {
  schema: 1;
  rules: Record<string, RuleSetting>;
}

const key = (group: string) => kvKey('rules', group);
export const emptyRuleSettings = (): RuleSettingsDoc => ({ schema: 1, rules: {} });
const defaults = new Map(RULES.map((r) => [r.id, r.severity]));

export async function loadRuleSettings(group: string, kv: KvClient = httpKv): Promise<RuleSettingsDoc> {
  const text = await kv.get(key(group));
  if (!text) return emptyRuleSettings();
  try {
    const doc = JSON.parse(text) as RuleSettingsDoc;
    return doc && doc.schema === 1 && doc.rules ? doc : emptyRuleSettings();
  } catch {
    return emptyRuleSettings();
  }
}

/**
 * Changes one rule's settings. Re-reads first so a teammate's concurrent edit to another rule
 * isn't lost. Values equal to the rule's defaults are dropped.
 */
export async function setRuleSetting(
  group: string,
  ruleId: string,
  change: { enabled?: boolean; severity?: Severity },
  opts: { by?: string; now?: Date; kv?: KvClient } = {},
): Promise<RuleSettingsDoc> {
  const kv = opts.kv ?? httpKv;
  const doc = await loadRuleSettings(group, kv);
  const next = { ...doc.rules[ruleId], ...change };
  const enabled = next.enabled === false ? false : undefined;
  const severity = next.severity && next.severity !== defaults.get(ruleId) ? next.severity : undefined;
  if (enabled === undefined && severity === undefined) delete doc.rules[ruleId];
  else doc.rules[ruleId] = { enabled, severity, by: opts.by, at: (opts.now ?? new Date()).toISOString() };
  await kv.put(key(group), JSON.stringify(doc));
  return doc;
}

/** Rule ids turned off for the group. */
export const disabledRules = (doc: RuleSettingsDoc) =>
  new Set(Object.entries(doc.rules).filter(([, s]) => s.enabled === false).map(([id]) => id));

/** The severity a rule reports at for this group. */
export const effectiveSeverity = (doc: RuleSettingsDoc, ruleId: string): Severity | undefined =>
  doc.rules[ruleId]?.severity ?? defaults.get(ruleId);

/** Drops findings from disabled rules and applies severity overrides, keeping lint's sort order. */
export function applyRuleSettings(findings: Finding[], doc: RuleSettingsDoc): Finding[] {
  const off = disabledRules(doc);
  return findings
    .filter((f) => !off.has(f.ruleId))
    .map((f) => {
      const severity = doc.rules[f.ruleId]?.severity;
      return severity && severity !== f.severity ? { ...f, severity } : f;
    })
    .sort(compareFindings);
}
