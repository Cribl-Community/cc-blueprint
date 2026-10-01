// Which Routes each Source's events can reach. Walks the Routing table in order per Source: a
// Final route whose filter definitely matches stops that Source's events, so every later route is
// unreached for it. A "maybe" match never stops anything, since some events may fall through.
import { constantString, evalFilter, type KnownFields, type Tri } from './filter';
import type { Inventory, Source } from './types';

export type ReachState = Tri | 'unreached' | 'disabled';

export interface RouteReach {
  routeId: string;
  state: ReachState;
  /** This route definitely takes every event from the Source (Final and a definite match). */
  stops: boolean;
  /** The filter's verdict for this Source, even when the route is unreached; absent when disabled. */
  filter?: Tri;
  /** For an unreached route: the route that stopped this Source first. */
  stoppedBy?: string;
}

/**
 * Sources that relay events from other Cribl nodes. Their events may carry the original node's
 * `__inputId`, so it isn't treated as known for them.
 */
const RELAY_TYPES = new Set(['cribl_http', 'cribl_tcp']);

/** Fields with a value known for every event from `source`, before any Route sees it. */
export function knownFields(source: Source): KnownFields {
  const fields: KnownFields = {};
  if (!RELAY_TYPES.has(source.type)) fields.__inputId = `${source.type}:${source.id}`;
  // A pre-processing pipeline can rewrite fields, so Source metadata is only trusted without one.
  if (!source.pipeline) {
    for (const m of source.metadata ?? []) {
      const value = constantString(m.value);
      if (value !== undefined && m.name !== '__inputId') fields[m.name] = value;
    }
  }
  return fields;
}

/** Route reach for one Source, in Routing table order. */
export function reachFor(source: Source, inv: Inventory): RouteReach[] {
  const fields = knownFields(source);
  let stoppedBy: string | undefined;
  return [...inv.routes]
    .sort((a, b) => a.index - b.index)
    .map((route): RouteReach => {
      if (route.disabled) return { routeId: route.id, state: 'disabled', stops: false };
      const filter = evalFilter(route.filter, fields);
      if (stoppedBy) return { routeId: route.id, state: 'unreached', stops: false, filter, stoppedBy };
      const stops = filter === 'yes' && route.final;
      if (stops) stoppedBy = route.id;
      return { routeId: route.id, state: filter, stops, filter };
    });
}

/** Route reach for every enabled Source that uses the Routing table, keyed by Source id. */
export function routeReach(inv: Inventory): Map<string, RouteReach[]> {
  return new Map(
    inv.sources.filter((s) => s.sendToRoutes && !s.disabled).map((s) => [s.id, reachFor(s, inv)]),
  );
}
