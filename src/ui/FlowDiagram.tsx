import { useMemo, useState } from 'react';
import type { HealthMap } from '../api/health';
import type { ReferenceGraph } from '../model/graph';
import type { RouteReach } from '../model/reach';
import { busFlow, HEADER_H, NODE_H, NODE_W, PAD, type FlowLayout, type LayoutNode } from '../report/flowLayout';
import { stronger, traceHover, type Strength } from '../report/trace';
import { compact } from './format';

interface Props {
  layout: FlowLayout;
  graph: ReferenceGraph;
  /** Which Routes each routed Source can reach, from its Route filters. */
  reach: Map<string, RouteReach[]>;
  /** Live health for Sources and Destinations, when it could be read. */
  health?: HealthMap;
  /** Last-hour event counts per node key, when metrics could be read. */
  counts?: Map<string, number>;
  /** Show counts instead of the type/Final sublabel. */
  showCounts?: boolean;
}

const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = Math.max(24, (b.x - a.x) / 2);
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
};

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Roughly how many characters fit on one node row (body-sm text), shared by label and sublabel. */
const ROW_CHARS = 30;
const SUB_MAX = 12;

const HEALTH_TEXT = { Green: 'healthy', Yellow: 'degraded', Red: 'critical', Unknown: 'unknown' } as const;

export default function FlowDiagram({ layout, graph, reach, health, counts, showCounts }: Props) {
  const [hovered, setHovered] = useState<LayoutNode | null>(null);
  const trace = useMemo(() => (hovered ? traceHover(hovered, graph, reach) : null), [hovered, graph, reach]);

  /** Lit state classes: dark when something else is hovered, dashed when the match depends on events. */
  const litClass = (s: Strength | undefined) =>
    trace && (s ? (s === 'maybe' ? 'is-lit is-maybe' : 'is-lit') : 'is-faded');

  const busStrength = trace
    ? [...trace.flows].reduce<Strength | undefined>(
        (best, [flow, s]) => (flow.startsWith(busFlow('')) ? stronger(best, s) : best),
        undefined,
      )
    : undefined;

  const edgeClass = (flows: string[], disabled: boolean, kind: string) =>
    [
      'flow-edge',
      `flow-edge--${kind}`,
      disabled && 'is-disabled',
      litClass(flows.reduce<Strength | undefined>((best, f) => stronger(best, trace?.flows.get(f)), undefined)),
    ]
      .filter(Boolean)
      .join(' ');

  return (
    <div className="flow-scroll">
      <svg
        className="flow-diagram"
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label="Data flow from Sources through Routes and Pipelines to Destinations"
      >
        {layout.columns.map((c) => (
          <text key={c.column} className="flow-col-title" x={c.x} y={PAD + HEADER_H / 2}>
            {c.title}
          </text>
        ))}

        {layout.bus && (
          <g className={['flow-bus-group', litClass(busStrength)].filter(Boolean).join(' ')}>
            <title>
              Routing table: events from these Sources are checked against Routes in order; the first matching
              Final Route stops evaluation.
            </title>
            {/* Right-aligned in the header row so it clears both column titles. */}
            <text className="flow-bus-label" x={layout.bus.x + 4} y={PAD + HEADER_H / 2} textAnchor="end">
              Routing table
            </text>
            <line className="flow-bus" x1={layout.bus.x} x2={layout.bus.x} y1={layout.bus.y1} y2={layout.bus.y2} />
            {/* Wider invisible stroke so the 3px line is easy to hover for the tooltip. */}
            <line className="flow-bus-hit" x1={layout.bus.x} x2={layout.bus.x} y1={layout.bus.y1} y2={layout.bus.y2} />
          </g>
        )}

        {layout.edges.map((e) => (
          <path key={e.key} className={edgeClass(e.flows, e.disabled, e.kind)} d={curve(e.from, e.to)} />
        ))}

        {layout.nodes.map((n) => {
          // Disabled objects can report stale status, so they get no dot.
          const h = n.disabled ? undefined : health?.get(n.key);
          const events = counts?.get(n.key);
          const sublabel = showCounts && events !== undefined ? `${compact(events)} ev/h` : n.sublabel;
          const cls = [
            'flow-node',
            `flow-node--${n.column}`,
            n.disabled && 'is-disabled',
            n.unreferenced && 'is-unreferenced',
            n.severity && `has-${n.severity}`,
            litClass(trace?.nodes.get(n.key)),
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <g
              key={n.key}
              className={cls}
              transform={`translate(${n.x},${n.y})`}
              onMouseEnter={() => setHovered(n)}
              onMouseLeave={() => setHovered(null)}
            >
              <title>
                {`${n.label}${n.sublabel ? ` — ${n.sublabel}` : ''}${n.disabled ? ' (disabled)' : ''}${n.unreferenced ? ' (not referenced)' : ''}${n.findingCount ? ` · ${n.findingCount} finding${n.findingCount === 1 ? '' : 's'} (see Linter)` : ''}${h ? ` · live: ${HEALTH_TEXT[h.health]}${h.error ? ` (${h.error})` : ''}` : ''}${events !== undefined ? ` · ${events.toLocaleString()} events in the last hour` : ''}`}
              </title>
              <rect width={NODE_W} height={NODE_H} rx={6} />
              {h && <circle className={`flow-health flow-health--${h.health.toLowerCase()}`} cx={NODE_W - 5} cy={5} r={3.5} />}
              <text x={10} y={NODE_H / 2} className="flow-node-label">
                {truncate(n.label, ROW_CHARS - (sublabel ? Math.min(sublabel.length, SUB_MAX) + 2 : 0))}
              </text>
              {sublabel && (
                <text x={NODE_W - 10} y={NODE_H / 2} className="flow-node-sublabel" textAnchor="end">
                  {truncate(sublabel, SUB_MAX)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
