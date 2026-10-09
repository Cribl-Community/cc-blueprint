import { Tag, Text } from '@capra/core';
import type { ChangeSet, DiffKind, ReachChange, RouteReachDelta } from '../diff/diff';
import type { ReachState } from '../model/reach';
import type { Inventory } from '../model/types';

interface Props {
  diff: ChangeSet;
  before: Inventory;
  after: Inventory;
  beforeLabel: string;
  afterLabel: string;
}

const KINDS: { key: DiffKind; title: string }[] = [
  { key: 'routes', title: 'Routes' },
  { key: 'pipelines', title: 'Pipelines' },
  { key: 'sources', title: 'Sources' },
  { key: 'destinations', title: 'Destinations' },
  { key: 'packs', title: 'Packs' },
];

const label = (x: { id: string; name?: string }) => (x.name ? `${x.name} (${x.id})` : x.id);

function RouteOrder({ ids, inv, title, moved }: { ids: string[]; inv: Inventory; title: string; moved: Set<string> }) {
  const name = (id: string) => inv.routes.find((r) => r.id === id)?.name ?? id;
  return (
    <div className="order">
      <Text as="h3" variant="heading">{title}</Text>
      <ol>
        {ids.map((id, i) => (
          <li key={id} className={moved.has(id) ? 'order-item is-moved' : 'order-item'}>
            <span className="order-name">{`${i + 1}. ${name(id)}`}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const REACH_STATE: Record<ReachState, string> = {
  yes: 'definite match',
  maybe: 'depends on event content',
  no: 'filter no longer matches',
  unreached: 'taken by an earlier Final route',
  disabled: 'route disabled',
};

const deltaList = (deltas: RouteReachDelta[], why: (d: RouteReachDelta) => string) =>
  deltas.map((d) => `${d.label} (${why(d)})`).join(', ');

function ReachChanges({ reach }: { reach: ReachChange[] }) {
  return (
    <section className="section">
      <Text as="h3" variant="heading">Reach changes</Text>
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
    </section>
  );
}

export default function DiffView({ diff, before, after, beforeLabel, afterLabel }: Props) {
  if (diff.total === 0 && !diff.routeOrder) {
    return <Text>{`No differences between ${beforeLabel} and ${afterLabel}.`}</Text>;
  }
  const touched = (k: DiffKind) =>
    diff.kinds[k].added.length + diff.kinds[k].removed.length + diff.kinds[k].changed.length > 0;
  // Reach can only move when Routes or Sources changed; then "no change" is worth saying too.
  const routingChanged = !!diff.routeOrder || touched('routes') || touched('sources');
  const moved = new Set(
    diff.routeOrder ? diff.routeOrder.after.filter((id, i) => diff.routeOrder!.before.indexOf(id) !== i) : [],
  );

  return (
    <div className="diff">
      <div className="diff-summary">
        {KINDS.map(({ key, title }) => {
          const k = diff.kinds[key];
          if (!k.added.length && !k.removed.length && !k.changed.length) return null;
          return (
            <span key={key} className="diff-chip">
              <strong>{title}</strong>
              {k.added.length > 0 && <Tag color="success">{`+${k.added.length}`}</Tag>}
              {k.removed.length > 0 && <Tag color="danger">{`−${k.removed.length}`}</Tag>}
              {k.changed.length > 0 && <Tag color="warning">{`~${k.changed.length}`}</Tag>}
            </span>
          );
        })}
      </div>

      {diff.routeOrder && (
        <section className="section">
          <Text as="h3" variant="heading">Route order changed</Text>
          <div className="order-grid">
            <RouteOrder ids={diff.routeOrder.before} inv={before} title={beforeLabel} moved={moved} />
            <RouteOrder ids={diff.routeOrder.after} inv={after} title={afterLabel} moved={moved} />
          </div>
        </section>
      )}

      {(routingChanged || diff.reach.length > 0) && <ReachChanges reach={diff.reach} />}

      {KINDS.map(({ key, title }) => {
        const k = diff.kinds[key];
        if (!k.added.length && !k.removed.length && !k.changed.length) return null;
        return (
          <section key={key} className="section">
            <Text as="h3" variant="heading">{title}</Text>
            <ul className="diff-list">
              {k.added.map((x) => (
                <li key={`+${x.id}`}>
                  <Tag color="success">Added</Tag> {label(x)}
                </li>
              ))}
              {k.removed.map((x) => (
                <li key={`-${x.id}`}>
                  <Tag color="danger">Removed</Tag> {label(x)}
                </li>
              ))}
              {k.changed.map((c) => (
                <li key={`~${c.id}`}>
                  <Tag color="warning">Changed</Tag> {label(c)}
                  <table className="field-diff">
                    <tbody>
                      {c.fields.map((f) => (
                        <tr key={f.field}>
                          <th>{f.field}</th>
                          <td className="before"><code className="mono">{f.before}</code></td>
                          <td className="arrow">→</td>
                          <td className="after"><code className="mono">{f.after}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
