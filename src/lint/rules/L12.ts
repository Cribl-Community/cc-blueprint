import { makeResolver } from '../../model/graph';
import { routeReach } from '../../model/reach';
import { listNames, routeLabel } from '../helpers';
import type { Route } from '../../model/types';
import type { Rule } from '../types';

export const L12: Rule = {
  id: 'L12',
  title: 'Same data delivered twice',
  severity: 'warning',
  rationale:
    'A non-Final Route sends a copy of the events it matches and lets them continue. When a later Route that the same Sources reach uses the same Pipeline and Destination, those events are stored twice, and you pay for both. Routes with different Pipelines are not reported, since they usually send deliberately different data. Read from the Route filters, never executed.',
  run: ({ inv }) => {
    const resolve = makeResolver(inv.destinations);
    const routes = new Map(inv.routes.map((r) => [r.id, r]));
    const typeOf = new Map(inv.destinations.map((d) => [d.id, d.type]));
    type Pair = { first: Route; second: Route; sources: string[]; definite: boolean };
    const pairs = new Map<string, Pair>();
    for (const [sourceId, reach] of routeReach(inv)) {
      const reached = reach
        .filter((r) => r.state === 'yes' || r.state === 'maybe')
        .map((r) => ({ route: routes.get(r.routeId)!, definite: r.state === 'yes' }))
        .filter(({ route }) => route.output && typeOf.get(resolve(route.output)) !== 'devnull');
      reached.forEach((a, i) => {
        if (a.route.final) return;
        for (const b of reached.slice(i + 1)) {
          const [first, second] = [a.route, b.route];
          if (second.pipeline !== first.pipeline || resolve(second.output!) !== resolve(first.output!)) continue;
          const key = JSON.stringify([first.id, second.id]);
          const pair = pairs.get(key) ?? { first, second, sources: [], definite: false };
          pair.sources.push(sourceId);
          pair.definite ||= a.definite && b.definite;
          pairs.set(key, pair);
        }
      });
    }
    return [...pairs.values()].map(({ first, second, sources, definite }) => {
      const dest = resolve(first.output!);
      return {
        object: { kind: 'route' as const, id: first.id, name: first.name },
        keyDetail: second.id,
        message: `Route ${routeLabel(first)} is not Final and sends to "${dest}" through "${first.pipeline}"; route ${routeLabel(second)} sends the same events there again, so ${definite ? 'they are' : 'events matching both may be'} delivered twice (from ${listNames(sources)}).`,
        fix: `Turn on Final for "${first.name}", narrow one of the filters, or send one Route elsewhere.`,
        evidence: `${first.name}: ${first.filter || '(empty)'} · ${second.name}: ${second.filter || '(empty)'}`,
      };
    });
  },
};
