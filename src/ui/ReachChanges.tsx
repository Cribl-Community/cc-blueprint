import { Tag, Text } from '@capra/core';
import type { ReachChange, RouteReachDelta } from '../diff/diff';
import type { ReachState } from '../model/reach';

const REACH_STATE: Record<ReachState, string> = {
  yes: 'definite match',
  maybe: 'depends on event content',
  no: 'filter no longer matches',
  unreached: 'taken by an earlier Final route',
  disabled: 'route disabled',
};

const deltaList = (deltas: RouteReachDelta[], why: (d: RouteReachDelta) => string) =>
  deltas.map((d) => `${d.label} (${why(d)})`).join(', ');

/** Per-Source list of routes gained, lost, or whose match changed. */
export default function ReachChanges({ reach }: { reach: ReachChange[] }) {
  return (
    <>
      {reach.length === 0 ? (
        <Text>No Source gained or lost a Route. Read from the Route filters, so event-dependent filters count as reachable.</Text>
      ) : (
        <ul className="diff-list">
          {reach.map((c) => (
            <li key={c.sourceId}>
              <strong>{c.sourceId}</strong>
              <ul className="reach-deltas">
                {c.gained.length > 0 && (
                  <li>
                    <Tag color="success">Now reaches</Tag> {deltaList(c.gained, (d) => REACH_STATE[d.after])}
                  </li>
                )}
                {c.lost.length > 0 && (
                  <li>
                    <Tag color="danger">No longer reaches</Tag> {deltaList(c.lost, (d) => REACH_STATE[d.after])}
                  </li>
                )}
                {c.changed.length > 0 && (
                  <li>
                    <Tag color="warning">Match changed</Tag>{' '}
                    {deltaList(c.changed, (d) => `${REACH_STATE[d.before]} → ${REACH_STATE[d.after]}`)}
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
