import { routeReach } from '../../model/reach';
import { listNames, routeLabel, routesAboveCatchAll } from '../helpers';
import type { Rule } from '../types';

export const L10: Rule = {
  id: 'L10',
  title: 'Targeted Source never reaches its Route',
  severity: 'warning',
  rationale:
    "The Route's filter definitely matches a specific Source, but an earlier Final Route takes all of that Source's events first, so the Route's logic never runs for it. Routes whose filter matches every Source (catch-alls) are not reported, since falling through to them is normal.",
  run: ({ inv }) => {
    const reach = routeReach(inv);
    const byId = new Map(inv.routes.map((r) => [r.id, r]));
    return routesAboveCatchAll(inv.routes).flatMap((route) => {
      const verdicts = [...reach].map(([sourceId, routes]) => ({
        sourceId,
        r: routes.find((x) => x.routeId === route.id)!,
      }));
      // No Source reaches it at all: L09 reports that.
      if (!verdicts.some((v) => v.r.state === 'yes' || v.r.state === 'maybe')) return [];
      // A filter that matches every Source isn't targeted at any of them.
      if (verdicts.every((v) => v.r.filter === 'yes')) return [];

      const byStopper = new Map<string, string[]>();
      for (const v of verdicts) {
        if (v.r.filter !== 'yes' || v.r.state !== 'unreached' || !v.r.stoppedBy) continue;
        byStopper.set(v.r.stoppedBy, [...(byStopper.get(v.r.stoppedBy) ?? []), v.sourceId]);
      }
      if (!byStopper.size) return [];

      const [[firstStopper, firstSources]] = byStopper;
      const stopper = byId.get(firstStopper)!;
      const targeted = [...byStopper.values()].flat();
      const message =
        byStopper.size === 1
          ? `Route ${routeLabel(route)} matches ${listNames(targeted)}, but route ${routeLabel(stopper)} is Final and takes ${firstSources.length === 1 ? 'its' : 'their'} events first.`
          : `Route ${routeLabel(route)} matches Sources that earlier Final routes take first: ${[...byStopper]
              .map(([id, sources]) => `${listNames(sources)} by route ${routeLabel(byId.get(id)!)}`)
              .join('; ')}.`;
      return [
        {
          object: { kind: 'route', id: route.id, name: route.name },
          message,
          fix: `Move "${route.name}" above "${stopper.name}", or turn off Final on "${stopper.name}".`,
          evidence: `filter: ${route.filter || '(empty)'} · ${stopper.name} filter: ${stopper.filter || '(empty)'}`,
        },
      ];
    });
  },
};
