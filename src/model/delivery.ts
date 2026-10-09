// Where each Source's data ends up: Source → Route (or QuickConnect) → Destination, following the
// `default` alias and Output Router rules. Router rules are filters too, so they're evaluated with
// the same analyzer as Routes: in order, and a Final rule that definitely matches stops the walk.
import { evalFilter, type KnownFields, type Tri } from './filter';
import { makeResolver } from './graph';
import { knownFields, routeReach } from './reach';
import type { Inventory } from './types';

export type Strength = 'yes' | 'maybe';

/** Destination id for routes that pick their destination with an output expression. */
export const EXPRESSION_OUTPUT = '(output expression)';

export interface Delivery {
  /** Final destination id, after the `default` alias and Output Routers. */
  destinationId: string;
  strength: Strength;
  /** How the data gets there: `route <name>` or `QuickConnect`, plus `router <id>` hops. */
  via: string[];
}

const weaker = (a: Strength, b: Tri): Strength => (a === 'yes' && b === 'yes' ? 'yes' : 'maybe');

/** Pipelines can rewrite fields; past a real one, only the input id is still trusted. */
const fieldsAfter = (pipeline: string | undefined, fields: KnownFields): KnownFields =>
  !pipeline || pipeline === 'passthru'
    ? fields
    : fields.__inputId !== undefined
      ? { __inputId: fields.__inputId }
      : {};

/** Deliveries for every enabled Source, keyed by Source id. */
export function deliveries(inv: Inventory): Map<string, Delivery[]> {
  const resolve = makeResolver(inv.destinations);
  const byId = new Map(inv.destinations.map((d) => [d.id, d]));
  const routes = new Map(inv.routes.map((r) => [r.id, r]));
  const reach = routeReach(inv);
  const out = new Map<string, Delivery[]>();

  for (const source of inv.sources.filter((s) => !s.disabled)) {
    const found = new Map<string, Delivery>();
    const add = (destinationId: string, strength: Strength, via: string[]) => {
      const prev = found.get(destinationId);
      if (!prev) found.set(destinationId, { destinationId, strength, via });
      else {
        if (strength === 'yes') prev.strength = 'yes';
        for (const v of via) if (!prev.via.includes(v)) prev.via.push(v);
      }
    };

    const expand = (output: string, strength: Strength, fields: KnownFields, via: string[], depth: number) => {
      const id = resolve(output);
      const router = byId.get(id);
      if (!router?.rules.length || depth > 3) return add(id, strength, via);
      for (const rule of router.rules) {
        const verdict = evalFilter(rule.filter, fields);
        if (verdict === 'no') continue;
        expand(rule.output, weaker(strength, verdict), fields, [...via, `router ${id}`], depth + 1);
        if (verdict === 'yes' && rule.final) break;
      }
    };

    const fields = knownFields(source);
    for (const r of reach.get(source.id) ?? []) {
      if (r.state !== 'yes' && r.state !== 'maybe') continue;
      const route = routes.get(r.routeId)!;
      const via = [`route ${route.name}`];
      if (!route.output) add(EXPRESSION_OUTPUT, r.state, via);
      else expand(route.output, r.state, fieldsAfter(route.pipeline, fields), via, 0);
    }
    if (!source.sendToRoutes) {
      for (const c of source.connections) {
        expand(c.output, 'yes', fieldsAfter(c.pipeline, fields), ['QuickConnect'], 0);
      }
    }
    out.set(source.id, [...found.values()]);
  }
  return out;
}
