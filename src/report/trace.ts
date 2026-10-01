// What the flow diagram lights when a node is hovered. Pure, so it can be tested without React.
// Route reach decides which Sources and Routes connect: a definite filter match lights solid, a
// match that depends on event content lights as "maybe", and routes a Source can't reach stay dark.
import type { ReferenceGraph } from '../model/graph';
import type { ReachState, RouteReach } from '../model/reach';
import { busFlow, type LayoutNode } from './flowLayout';

export type Strength = 'yes' | 'maybe';

export interface Trace {
  /** Node keys (`route:<id>`, ...) to light. */
  nodes: Map<string, Strength>;
  /** Hover flow ids (route ids, QuickConnect source ids, bus flows) to light. */
  flows: Map<string, Strength>;
}

const strengthOf = (state: ReachState | undefined): Strength | undefined =>
  state === 'yes' ? 'yes' : state === 'maybe' ? 'maybe' : undefined;

/** The stronger of two strengths; `yes` beats `maybe`. */
export const stronger = (a: Strength | undefined, b: Strength | undefined): Strength | undefined =>
  a === 'yes' || b === 'yes' ? 'yes' : (a ?? b);

export function traceHover(
  node: LayoutNode,
  graph: ReferenceGraph,
  reach: Map<string, RouteReach[]>,
): Trace {
  const nodes = new Map<string, Strength>([[node.key, 'yes']]);
  const flows = new Map<string, Strength>();
  const light = (map: Map<string, Strength>, key: string, s: Strength) => {
    if (map.get(key) !== 'yes') map.set(key, s);
  };

  const lightPath = (kind: 'route' | 'quickconnect', via: string, s: Strength) => {
    light(flows, via, s);
    light(nodes, kind === 'route' ? `route:${via}` : `source:${via}`, s);
    for (const f of graph.flows) {
      if (f.kind !== kind || f.via !== via) continue;
      light(nodes, `pipeline:${f.pipeline}`, s);
      if (f.output) light(nodes, `destination:${f.output}`, s);
    }
  };

  /** Light every routed Source that can reach one of `routeIds`, at its best strength. */
  const lightSourcesReaching = (routeIds: Set<string>) => {
    for (const [sourceId, routes] of reach) {
      const s = routes
        .filter((r) => routeIds.has(r.routeId))
        .reduce<Strength | undefined>((best, r) => stronger(best, strengthOf(r.state)), undefined);
      if (!s) continue;
      light(flows, busFlow(sourceId), s);
      light(nodes, `source:${sourceId}`, s);
    }
  };

  switch (node.column) {
    case 'source': {
      const routes = reach.get(node.id);
      if (routes) {
        light(flows, busFlow(node.id), 'yes');
        for (const r of routes) {
          const s = strengthOf(r.state);
          if (s) lightPath('route', r.routeId, s);
        }
      }
      for (const f of graph.flows) {
        if (f.kind === 'quickconnect' && f.via === node.id) lightPath('quickconnect', f.via, 'yes');
      }
      break;
    }
    case 'route':
      lightPath('route', node.id, 'yes');
      lightSourcesReaching(new Set([node.id]));
      break;
    case 'pipeline':
    case 'destination': {
      const through = graph.flows.filter((f) =>
        node.column === 'pipeline' ? f.pipeline === node.id : f.output === node.id,
      );
      for (const f of through) lightPath(f.kind, f.via, 'yes');
      lightSourcesReaching(new Set(through.filter((f) => f.kind === 'route').map((f) => f.via)));
      break;
    }
  }
  return { nodes, flows };
}
