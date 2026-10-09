import { referencedFields } from '../../model/filter';
import { functionLabel, realPipelines } from '../helpers';
import type { PipelineFunction } from '../../model/types';
import type { Rule } from '../types';

/** Functions that discard events. */
const DROPPING = new Set(['drop', 'sampling', 'dynamic_sampling', 'regex_filter', 'suppress']);
/** Functions that cost noticeable CPU per event. `serde` is the Parser function. */
const EXPENSIVE = new Set(['regex_extract', 'grok', 'serde', 'parser', 'lookup', 'geoip', 'code', 'mask', 'flatten', 'dns_lookup', 'redis']);
/** Functions that replace or reshape the event stream, after which a drop can't simply move up. */
const RESHAPING = new Set(['aggregation', 'aggregate_metrics', 'rollup_metrics', 'publish_metrics', 'otlp_metrics', 'unroll', 'json_unroll', 'chain']);
/** Fields events carry before any parsing, so a drop that only reads these could run first. */
const RAW_FIELDS = new Set(['_raw', '_time', 'host', 'source', 'sourcetype', 'index', '__inputId']);

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);

/**
 * Every field a dropping function reads: its own filter plus the expressions in its settings
 * (Sampling rules, Suppress key, Dynamic Sampling group keys, Regex Filter field). Undefined when
 * any of them can't be parsed, so the rule stays quiet.
 */
function fieldsRead(fn: PipelineFunction): string[] | undefined {
  const c = fn.conf;
  const exprs = [fn.filter ?? 'true'];
  if (fn.id === 'sampling' && Array.isArray(c.rules)) {
    for (const r of c.rules) exprs.push(str((r as { filter?: unknown })?.filter) ?? 'true');
  }
  if (fn.id === 'suppress') exprs.push(str(c.keyExpr) ?? 'true');
  if (fn.id === 'dynamic_sampling') exprs.push(str(c.sampleGroupKeys) ?? 'true');
  const fields = exprs.map(referencedFields);
  if (fields.some((f) => !f)) return undefined;
  const all = fields.flat() as string[];
  if (fn.id === 'regex_filter') all.push(str(c.field) ?? '_raw');
  return all;
}

/** Field names an Eval function sets, from its `add` list. */
function evalTargets(conf: Record<string, unknown>): string[] {
  const add = Array.isArray(conf.add) ? conf.add : [];
  return add.flatMap((a) => (a && typeof a === 'object' && typeof (a as { name?: unknown }).name === 'string' ? [(a as { name: string }).name] : []));
}

export const L13: Rule = {
  id: 'L13',
  title: 'Events dropped after expensive work',
  severity: 'info',
  rationale:
    'Functions run in order, so events a later Drop, Sampling, Regex Filter, or Suppress function discards still pay for every expensive function before it (Regex Extract, Parser, Grok, Lookup, GeoIP, Mask, Code). Reported only when everything the dropping function reads (its filter, Sampling rules, Suppress key) uses fields events have before parsing (_raw, host, source, sourcetype, index), so it can move earlier unchanged.',
  run: ({ inv }) =>
    realPipelines(inv.pipelines).flatMap((p) => {
      const fns = p.functions.map((fn, i) => ({ fn, i })).filter(({ fn }) => !fn.disabled && fn.id !== 'comment');
      return fns.flatMap(({ fn, i }, pos) => {
        if (!DROPPING.has(fn.id)) return [];
        const before = fns.slice(0, pos);
        if (before.some(({ fn: b }) => RESHAPING.has(b.id))) return [];
        const expensive = before.filter(({ fn: b }) => EXPENSIVE.has(b.id));
        if (!expensive.length) return [];
        const fields = fieldsRead(fn);
        if (!fields || !fields.every((f) => RAW_FIELDS.has(f))) return [];
        // An earlier Eval that sets a field the drop reads means the drop depends on it.
        const set = new Set(before.filter(({ fn: b }) => b.id === 'eval').flatMap(({ fn: b }) => evalTargets(b.conf)));
        if (fields.some((f) => set.has(f))) return [];
        const names = [...new Set(expensive.map(({ fn: b }) => b.id))].join(', ');
        return [
          {
            object: { kind: 'pipeline' as const, id: p.id },
            keyDetail: `f${i}`,
            location: functionLabel(i, fn),
            message: `Pipeline "${p.id}" discards events in ${functionLabel(i, fn)} after ${expensive.length} expensive function${expensive.length === 1 ? '' : 's'} (${names}) already ran on them.`,
            fix: `Move ${functionLabel(i, fn)} above ${functionLabel(expensive[0].i, expensive[0].fn)}; it only reads fields that exist before parsing.`,
            evidence: `filter: ${fn.filter || 'true'}`,
          },
        ];
      });
    }),
};
