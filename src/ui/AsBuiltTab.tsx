import { useMemo } from 'react';
import { Button, Table, Tag, Text, defineColumns } from '@capra/core';
import type { ReferenceGraph } from '../model/graph';
import type { Finding } from '../lint/types';
import { routeReach } from '../model/reach';
import type { Inventory } from '../model/types';
import {
  buildAsBuilt,
  REACH_LEGEND,
  reachLabel,
  unreachedRoutes,
  type DestinationRow,
  type PackRow,
  type PipelineRow,
  type ReachCell,
  type ReachMatrix,
  type RouteRow,
  type SourceRow,
} from '../report/asBuilt';
import { layoutFlow } from '../report/flowLayout';
import { toMarkdown, type SuppressedFinding } from '../report/markdown';
import { downloadText } from './download';
import FlowDiagram from './FlowDiagram';

interface Props {
  inventory: Inventory;
  graph: ReferenceGraph;
  /** Open findings (suppressions already applied). */
  findings: Finding[];
  suppressed: SuppressedFinding[];
}

const yesNo = (v: unknown) => (v ? 'Yes' : 'No');
const mono = (v: unknown) => <code className="mono">{String(v)}</code>;
const enabledTag = (v: unknown) => (v ? <Tag color="success">Enabled</Tag> : <Tag>Disabled</Tag>);

const routeColumns = defineColumns<RouteRow & Record<string, unknown>>([
  { id: 'position', label: '#' },
  { id: 'name', label: 'Name' },
  { id: 'filter', label: 'Filter', render: mono },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'output', label: 'Destination' },
  { id: 'final', label: 'Final', render: yesNo },
  { id: 'enabled', label: 'Status', render: enabledTag },
]);

const sourceColumns = defineColumns<SourceRow & Record<string, unknown>>([
  { id: 'id', label: 'ID' },
  { id: 'type', label: 'Type' },
  { id: 'mode', label: 'Mode', render: (v) => (v === 'QuickConnect' ? <Tag color="info">QuickConnect</Tag> : String(v)) },
  { id: 'preProcessing', label: 'Pre-processing' },
  { id: 'enabled', label: 'Status', render: enabledTag },
]);

const pipelineColumns = defineColumns<PipelineRow & Record<string, unknown>>([
  { id: 'id', label: 'ID' },
  { id: 'functions', label: 'Functions' },
  { id: 'disabledFunctions', label: 'Disabled functions' },
  { id: 'usedBy', label: 'Used by' },
]);

const destinationColumns = defineColumns<DestinationRow & Record<string, unknown>>([
  { id: 'id', label: 'ID' },
  { id: 'type', label: 'Type' },
  { id: 'backpressure', label: 'Backpressure' },
  { id: 'postProcessing', label: 'Post-processing' },
  { id: 'usedBy', label: 'Used by' },
]);

const packColumns = defineColumns<PackRow & Record<string, unknown>>([
  { id: 'id', label: 'ID' },
  { id: 'name', label: 'Name' },
  { id: 'version', label: 'Version' },
]);

const REACH_TITLE: Record<string, string> = {
  stops: "Matches and Final: later Routes never see this Source's events",
  yes: "Matches: this Source's events reach this Route",
  maybe: 'Depends on event content',
  no: 'The filter never matches this Source',
  unreached: "Never reached: an earlier Final Route takes all of this Source's events",
  disabled: 'Route disabled',
};

/** Route cells are keyed `r:<route id>` so they can't collide with the Source columns. */
type ReachItem = { id: string; source: string; [route: `r:${string}`]: ReachCell };

function ReachTable({ matrix }: { matrix: ReachMatrix }) {
  const columns = useMemo(
    () =>
      defineColumns<ReachItem>([
        { id: 'source', label: 'Source' },
        ...matrix.routes.map((r) => ({
          id: `r:${r.id}` as const,
          label: r.label,
          render: (c: ReachCell) => {
            const kind = c.stops ? 'stops' : c.state;
            return (
              <span className={`reach reach--${kind}`} title={REACH_TITLE[kind]}>
                {reachLabel(c)}
              </span>
            );
          },
        })),
      ]),
    [matrix],
  );
  const items = matrix.rows.map((row) => ({
    id: row.sourceId,
    source: row.sourceId,
    ...Object.fromEntries(row.cells.map((c, i) => [`r:${matrix.routes[i].id}`, c])),
  })) as ReachItem[];
  const unreached = unreachedRoutes(matrix);
  return (
    <>
      <Text>
        Which Routes each Source&apos;s events can reach, read from the Route filters. Only the input id and literal
        Source fields are known, so filters on event content show as &ldquo;?&rdquo;.
      </Text>
      <div className="reach-scroll">
        <Table
          items={items}
          columns={columns}
          visibleColumns={['source', ...matrix.routes.map((r) => `r:${r.id}` as const)]}
          density="compact"
        />
      </div>
      <Text variant="body-sm-normal">{REACH_LEGEND}</Text>
      {unreached.length > 0 && (
        <Text>
          <strong>No Source reaches:</strong> {unreached.map((r) => r.label).join(', ')}
        </Text>
      )}
      {matrix.quickConnect.length > 0 && (
        <Text>{`QuickConnect Sources bypass the Routing table: ${matrix.quickConnect.join(', ')}.`}</Text>
      )}
    </>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="section">
      <Text as="h2" variant="heading">{`${title} (${count})`}</Text>
      {count === 0 ? <Text>None.</Text> : children}
    </section>
  );
}

function Stat({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {detail && <span className="stat-detail">{detail}</span>}
    </div>
  );
}

export default function AsBuiltTab({ inventory, graph, findings, suppressed }: Props) {
  const report = useMemo(() => buildAsBuilt(inventory, graph), [inventory, graph]);
  const layout = useMemo(() => layoutFlow(inventory, graph, findings), [inventory, graph, findings]);
  const reach = useMemo(() => routeReach(inventory), [inventory]);
  const s = report.summary;

  const exportMarkdown = () => {
    const now = new Date();
    const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
    downloadText(`as-built-${inventory.group}-${stamp}.md`, toMarkdown(report, graph.flows, now, findings, suppressed), 'text/markdown');
  };

  // Capra Table requires string/number ids; rows already carry them.
  type Rows<T> = (T & Record<string, unknown>)[];

  return (
    <div className="tab-body">
      <div className="toolbar">
        <div className="stats">
          <Stat label="Sources" value={s.sources.total} detail={`${s.sources.enabled} enabled${s.sources.quickConnect ? ` · ${s.sources.quickConnect} QuickConnect` : ''}`} />
          <Stat label="Routes" value={s.routes.total} detail={`${s.routes.enabled} enabled`} />
          <Stat label="Pipelines" value={s.pipelines} />
          <Stat label="Destinations" value={s.destinations} />
          <Stat label="Packs" value={s.packs} />
        </div>
        <Button variant="primary" onClick={exportMarkdown}>
          Export Markdown
        </Button>
      </div>

      <section className="section">
        <Text as="h2" variant="heading">Data flow</Text>
        <Text>
          Hover any Source, Route, Pipeline, or Destination to trace its path. Sources on the vertical Routing
          table line are evaluated against Routes top to bottom; QuickConnect Sources (dashed) go straight to a
          Pipeline. While tracing, Route filters decide which Sources reach which Routes: a solid line is a
          definite match, a dashed one depends on event content.
        </Text>
        <FlowDiagram layout={layout} graph={graph} reach={reach} />
        <div className="flow-legend">
          <span><span className="swatch swatch--error" /> Error</span>
          <span><span className="swatch swatch--warning" /> Warning</span>
          <span><span className="swatch swatch--info" /> Info</span>
          <span><span className="swatch swatch--unreferenced" /> Not referenced</span>
          <span><span className="swatch swatch--quickconnect" /> QuickConnect</span>
          {layout.hiddenBuiltins.length > 0 && (
            <span title={layout.hiddenBuiltins.join(', ')}>
              {`${layout.hiddenBuiltins.length} unused built-in pipeline${layout.hiddenBuiltins.length === 1 ? '' : 's'} hidden`}
            </span>
          )}
        </div>
      </section>

      <Section title="Routes" count={report.routes.length}>
        <Table
          items={report.routes as Rows<RouteRow>}
          columns={routeColumns}
          visibleColumns={['position', 'name', 'filter', 'pipeline', 'output', 'final', 'enabled']}
          density="compact"
        />
      </Section>
      {report.reach.rows.length > 0 && report.reach.routes.length > 0 && (
        <Section title="Source × Route reach" count={report.reach.rows.length}>
          <ReachTable matrix={report.reach} />
        </Section>
      )}
      <Section title="Sources" count={report.sources.length}>
        <Table
          items={report.sources as Rows<SourceRow>}
          columns={sourceColumns}
          visibleColumns={['id', 'type', 'mode', 'preProcessing', 'enabled']}
          density="compact"
        />
      </Section>
      <Section title="Pipelines" count={report.pipelines.length}>
        <Table
          items={report.pipelines as Rows<PipelineRow>}
          columns={pipelineColumns}
          visibleColumns={['id', 'functions', 'disabledFunctions', 'usedBy']}
          density="compact"
        />
      </Section>
      <Section title="Destinations" count={report.destinations.length}>
        <Table
          items={report.destinations as Rows<DestinationRow>}
          columns={destinationColumns}
          visibleColumns={['id', 'type', 'backpressure', 'postProcessing', 'usedBy']}
          density="compact"
        />
      </Section>
      <Section title="Packs" count={report.packs.length}>
        <Table
          items={report.packs as Rows<PackRow>}
          columns={packColumns}
          visibleColumns={['id', 'name', 'version']}
          density="compact"
        />
      </Section>
    </div>
  );
}
