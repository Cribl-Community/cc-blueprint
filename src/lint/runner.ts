import type { ReferenceGraph } from '../model/graph';
import type { Inventory } from '../model/types';
import { RULES } from './rules';
import { SEVERITY_ORDER, type Finding, type Rule } from './types';

export function runRule(rule: Rule, inv: Inventory, graph: ReferenceGraph): Finding[] {
  return rule.run({ inv, graph }).map(({ keyDetail, ...hit }) => ({
    ...hit,
    ruleId: rule.id,
    severity: rule.severity,
    key: [rule.id, hit.object.kind, hit.object.id, keyDetail].filter(Boolean).join('/'),
  }));
}

/** Severity, then rule, then object. */
export const compareFindings = (a: Finding, b: Finding) =>
  SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId) || a.key.localeCompare(b.key);

/** Runs every rule; findings sorted by severity, then rule, then object. */
export function lint(inv: Inventory, graph: ReferenceGraph, rules: Rule[] = RULES): Finding[] {
  return rules.flatMap((rule) => runRule(rule, inv, graph)).sort(compareFindings);
}
