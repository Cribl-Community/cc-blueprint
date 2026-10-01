import { routeReach } from '../../model/reach';
import { listNames, routeLabel, routesAboveCatchAll } from '../helpers';
import type { Rule } from '../types';

export const L09: Rule = {
  id: 'L09',
  title: 'Route no Source reaches',
  severity: 'warning',
  rationale:
    "Read from the Route filters, never executed: every Source that uses the Routing table either fails this Route's filter or is taken by an earlier Final Route, so the Route never receives events. Routes below a Final catch-all are left to L01. Blueprint doesn't inventory Collectors; if one feeds this Route, suppress the finding with that reason.",
  run: ({ inv }) => {
    const reach = routeReach(inv);
    if (!reach.size) return [];
    const byId = new Map(inv.routes.map((r) => [r.id, r]));
    return routesAboveCatchAll(inv.routes).flatMap((route) => {
      const verdicts = [...reach].map(([sourceId, routes]) => ({
        sourceId,
        r: routes.find((x) => x.routeId === route.id)!,
      }));
      if (verdicts.some((v) => v.r.state === 'yes' || v.r.state === 'maybe')) return [];

      const never = verdicts.filter((v) => v.r.state === 'no').map((v) => v.sourceId);
      const byStopper = new Map<string, string[]>();
      for (const v of verdicts) {
        if (v.r.state !== 'unreached' || !v.r.stoppedBy) continue;
        byStopper.set(v.r.stoppedBy, [...(byStopper.get(v.r.stoppedBy) ?? []), v.sourceId]);
      }
      const reasons = [
        ...(never.length === verdicts.length
          ? [`its filter matches none of the ${verdicts.length} Sources that use the Routing table`]
          : never.length
            ? [`its filter never matches ${listNames(never)}`]
            : []),
        ...[...byStopper].map(([stopper, sources]) => `route ${routeLabel(byId.get(stopper)!)} takes ${listNames(sources)} first`),
      ];
      const firstStopper = byStopper.keys().next().value;
      return [
        {
          object: { kind: 'route', id: route.id, name: route.name },
          message: `Route ${routeLabel(route)} receives events from no Source: ${reasons.join('; ')}.`,
          fix: firstStopper
            ? `Move "${route.name}" above "${byId.get(firstStopper)!.name}", or narrow that route's filter.`
            : 'Check the filter against the Sources it should match (renamed or deleted?), or disable the route.',
          evidence: `filter: ${route.filter || '(empty)'}`,
        },
      ];
    });
  },
};
