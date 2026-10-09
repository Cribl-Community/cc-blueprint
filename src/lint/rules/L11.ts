import { makeResolver } from '../../model/graph';
import { listNames } from '../helpers';
import type { Rule } from '../types';

export const L11: Rule = {
  id: 'L11',
  title: 'Data sent to a disabled Destination',
  severity: 'error',
  rationale:
    "A disabled Destination doesn't deliver anything, so events that enabled Routes, QuickConnect links, or Output Router rules send to it are lost. The default alias is followed, so a Route to `default` counts when the alias points at a disabled Destination.",
  run: ({ inv }) => {
    const resolve = makeResolver(inv.destinations);
    return inv.destinations
      .filter((d) => d.disabled)
      .flatMap((d) => {
        const hits = (output: string | undefined) => !!output && resolve(output) === d.id;
        const senders = [
          ...inv.routes.filter((r) => !r.disabled && hits(r.output)).map((r) => `route "${r.name}"`),
          ...inv.sources
            .filter((s) => !s.disabled && !s.sendToRoutes && s.connections.some((c) => hits(c.output)))
            .map((s) => `QuickConnect "${s.id}"`),
          ...inv.destinations
            .filter((r) => !r.disabled && r.id !== d.id && r.rules.some((rule) => hits(rule.output)))
            .map((r) => `router "${r.id}"`),
        ];
        if (!senders.length) return [];
        return [
          {
            object: { kind: 'destination' as const, id: d.id },
            message: `Destination "${d.id}" is disabled, but ${listNames(senders)} still send${senders.length === 1 ? 's' : ''} data to it, so those events are not delivered.`,
            fix: 'Re-enable the Destination, or point those Routes and links at an active one.',
            evidence: `disabled: Yes · type: ${d.type}`,
          },
        ];
      });
  },
};
