import { useMemo, useState } from 'react';
import { Alert, Button, Switch, Table, Tag, Text, defineColumns } from '@capra/core';
import type { ReferenceGraph } from '../model/graph';
import type { Finding } from '../lint/types';
import type { Delivery } from '../model/delivery';
import { routeReach } from '../model/reach';
import type { Inventory } from '../model/types';
import {
  buildAsBuilt,
  DELIVERY_LEGEND,
  deliveryLabel,
  destinationHeader,
  undelivered,
  type DeliveryMatrix,
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
import { routeKey, type Throughput } from '../api/metrics';
import { compact } from './format';
import { configVersions, unknownObjects, type NodeInfo } from '../api/nodes';
import type { HealthState } from './useHealth';
import type { NodesState } from './useNodes';
import type { ThroughputState } from './useThroughput';

interface Props {
  inventory: Inventory;
  graph: ReferenceGraph;
  /** Open findings (suppressions already applied). */
  findings: Finding[];
  suppressed: SuppressedFinding[];
  health: HealthState;
  throughput: ThroughputState;
  /** Worker or Edge Nodes, labelled for the group's kind. */
  nodes: NodesState & { label: string };
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
type LiveCell = ReachCell & { events?: number };
type ReachItem = { id: string; source: string; [route: `r:${string}`]: LiveCell };

function ReachTable({ matrix, live }: { matrix: ReachMatrix; live?: Throughput }) {
  const columns = useMemo(
    () =>
      defineColumns<ReachItem>([
        { id: 'source', label: 'Source' },
        ...matrix.routes.map((r) => ({
          id: `r:${r.id}` as const,
          label: r.label,
          render: (c: LiveCell) => {
            const kind = c.stops ? 'stops' : c.state;
            // Events arrived where the filter analysis says none can: the config likely changed this hour.
            const surprise = c.events !== undefined && c.events > 0 && (c.state === 'no' || c.state === 'unreached');
            const title = `${REACH_TITLE[kind]}${c.events !== undefined ? ` · ${c.events.toLocaleString()} events in the last hour` : ''}${surprise ? ' — although the filters say none should arrive; the config may have changed in the last hour' : ''}`;
            return (
              <span className={`reach reach--${kind}${surprise ? ' reach--surprise' : ''}`} title={title}>
                {reachLabel(c)}
                {c.events !== undefined && <span className="reach-count">{compact(c.events)}</span>}
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
    ...Object.fromEntries(
      row.cells.map((c, i) => [
        `r:${matrix.routes[i].id}`,
        { ...c, events: live ? (live.routeBySource.get(routeKey(matrix.routes[i].id, `${row.type}:${row.sourceId}`)) ?? 0) : undefined },
      ]),
    ),
  })) as ReachItem[];
  const unreached = unreachedRoutes(matrix);
  return (
    <>
      <Text>
        Which Routes each Source&apos;s events can reach, read from the Route filters. Only the input id and literal
        Source fields are known, so filters on event content show as &ldquo;?&rdquo;.
        {live && ' Each cell also shows the events that actually arrived in the last hour.'}
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

type DeliveryItem = { id: string; source: string; [dest: `d:${string}`]: Delivery | undefined };

function DeliveryTable({ matrix }: { matrix: DeliveryMatrix }) {
  const columns = useMemo(
    () =>
      defineColumns<DeliveryItem>([
        { id: 'source', label: 'Source' },
        ...matrix.destinations.map((d) => ({
          id: `d:${d.id}` as const,
          label: destinationHeader(d),
          render: (c: Delivery | undefined) => (
            <span
              className={`reach reach--${!c ? 'no' : c.strength}`}
              title={c ? `${c.strength === 'yes' ? 'Arrives' : 'May arrive, depending on event content'} via ${c.via.join(', ')}` : 'Nothing arrives'}
            >
              {deliveryLabel(c)}
            </span>
          ),
        })),
      ]),
    [matrix],
  );
  const items = matrix.rows.map((row) => ({
    id: row.sourceId,
    source: row.mode === 'QuickConnect' ? `${row.sourceId} (QuickConnect)` : row.sourceId,
    ...Object.fromEntries(row.cells.map((c, i) => [`d:${matrix.destinations[i].id}`, c])),
  })) as DeliveryItem[];
  const none = undelivered(matrix);
  return (
    <>
      <Text>
        Where each enabled Source&apos;s data ends up, following Routes, QuickConnect, the default alias, and Output Router
        rules. Hover a cell to see the path.
      </Text>
      <div className="reach-scroll">
        <Table
          items={items}
          columns={columns}
          visibleColumns={['source', ...matrix.destinations.map((d) => `d:${d.id}` as const)]}
          density="compact"
        />
      </div>
      <Text variant="body-sm-normal">{DELIVERY_LEGEND}</Text>
      {none.length > 0 && (
        <Text>
          <strong>Reaches no Destination:</strong> {none.join(', ')}
        </Text>
      )}
    </>
  );
}

type NodeRow = NodeInfo & Record<string, unknown>;

const nodeColumns = defineColumns<NodeRow>([
  { id: 'hostname', label: 'Hostname' },
  { id: 'status', label: 'Status', render: (v) => <Tag color={v === 'healthy' ? 'success' : 'warning'}>{String(v)}</Tag> },
  { id: 'connected', label: 'Connected', render: yesNo },
  { id: 'os', label: 'OS' },
  { id: 'criblVersion', label: 'Cribl', render: (v) => (v ? String(v).split('-')[0] : '—') },
  { id: 'configVersion', label: 'Config version', render: (v) => (v ? mono(v) : '—') },
  { id: 'lastSeen', label: 'Last seen', render: (v) => (v instanceof Date ? v.toLocaleString() : '—') },
  {
    id: 'cpus',
    label: 'Resources',
    render: (_v, row) =>
      [row.cpus && `${row.cpus} CPU`, row.memoryGiB && `${row.memoryGiB} GiB`, row.diskFreePct !== undefined && `${row.diskFreePct}% disk free`]
        .filter(Boolean)
        .join(' · ') || '—',
  },
]);

function NodesSection({ nodes, inventory }: { nodes: Props['nodes']; inventory: Inventory }) {
  if (nodes.error) {
    return (
      <section className="section">
        <Text as="h2" variant="heading">{nodes.label}</Text>
        <Text variant="body-sm-normal">{`Node details unavailable: ${nodes.error}`}</Text>
      </section>
    );
  }
  if (!nodes.nodes) return null;
  const list = nodes.nodes;
  const versions = configVersions(list);
  const known = new Set([
    ...inventory.sources.map((s) => `source ${s.type}:${s.id}`),
    ...inventory.destinations.map((d) => `destination ${d.type}:${d.id}`),
  ]);
  const unknown = unknownObjects(list, known);
  const total = Math.max(nodes.count ?? 0, list.length);
  return (
    <Section title={nodes.label} count={total}>
      {versions.length > 1 && (
        <Alert appearance="warning" title="Nodes run different config versions">
          {`${versions.map(([v, n]) => `${v} on ${n} node${n === 1 ? '' : 's'}`).join(', ')}. Deploy the latest config so every node runs the same one.`}
        </Alert>
      )}
      {unknown.length > 0 && (
        <Alert appearance="info" title="Nodes report objects that aren't in this config">
          {`${unknown.join(', ')}. The nodes are probably running config that hasn't been deployed since it changed, or local changes.`}
        </Alert>
      )}
      <Table
        items={list as NodeRow[]}
        columns={nodeColumns}
        visibleColumns={['hostname', 'status', 'connected', 'os', 'criblVersion', 'configVersion', 'lastSeen', 'cpus']}
        density="compact"
      />
      {total > list.length && <Text variant="body-sm-normal">{`Showing the first ${list.length} of ${total} nodes.`}</Text>}
    </Section>
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

/** Live health line and a warning listing enabled objects that aren't Green. */
function HealthSummary({ health, inventory }: { health: HealthState; inventory: Inventory }) {
  if (health.error) {
    return <Text variant="body-sm-normal">{`Live health unavailable: ${health.error}`}</Text>;
  }
  if (!health.health) return null;
  const enabled = new Set([
    ...inventory.sources.filter((s) => !s.disabled).map((s) => `source:${s.id}`),
    ...inventory.destinations.filter((d) => !d.disabled).map((d) => `destination:${d.id}`),
  ]);
  const bad = [...health.health].filter(([key, h]) => enabled.has(key) && (h.health === 'Red' || h.health === 'Yellow'));
  const at = health.at?.toLocaleTimeString();
  if (!bad.length) return <Text variant="body-sm-normal">{`Live health: every Source and Destination is Green (checked ${at}).`}</Text>;
  const red = bad.some(([, h]) => h.health === 'Red');
  return (
    <Alert appearance={red ? 'danger' : 'warning'} title={`${bad.length} not healthy (checked ${at})`}>
      {bad
        .map(([key, h]) => `${key.replace(':', ' ')}: ${h.health === 'Red' ? 'critical' : 'degraded'}${h.error ? ` (${h.error})` : ''}`)
        .join('; ')}
    </Alert>
  );
}

/** Last-hour event counts per diagram node key (Sources, Routes, Destinations). */
function nodeCounts(inv: Inventory, t: Throughput): Map<string, number> {
  return new Map([
    ...inv.sources.map((s) => [`source:${s.id}`, t.sources.get(`${s.type}:${s.id}`) ?? 0] as const),
    ...inv.routes.map((r) => [`route:${r.id}`, t.routes.get(r.id) ?? 0] as const),
    ...inv.destinations.map((d) => [`destination:${d.id}`, t.destinations.get(`${d.type}:${d.id}`) ?? 0] as const),
  ]);
}

export default function AsBuiltTab({ inventory, graph, findings, suppressed, health, throughput, nodes }: Props) {
  const [showCounts, setShowCounts] = useState(false);
  const counts = useMemo(
    () => (throughput.throughput ? nodeCounts(inventory, throughput.throughput) : undefined),
    [inventory, throughput.throughput],
  );
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
          {nodes.count !== undefined && (
            <Stat label={nodes.label} value={nodes.count} detail={nodes.count === 0 ? 'none connected' : 'connected'} />
          )}
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
        <HealthSummary health={health} inventory={inventory} />
        {counts ? (
          <label className="rule-switch">
            <Switch aria-label="Show last-hour events" size="sm" checked={showCounts} onChange={(e) => setShowCounts(e.target.checked)} />
            <span>Show events from the last hour on Sources, Routes, and Destinations</span>
          </label>
        ) : (
          throughput.error && <Text variant="body-sm-normal">{`Event counts unavailable: ${throughput.error}`}</Text>
        )}
        <FlowDiagram
          layout={layout}
          graph={graph}
          reach={reach}
          health={health.health}
          counts={counts}
          showCounts={showCounts && !!counts}
        />
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

      <NodesSection nodes={nodes} inventory={inventory} />
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
          <ReachTable matrix={report.reach} live={throughput.throughput} />
        </Section>
      )}
      {report.delivery.rows.length > 0 && (
        <Section title="Source → Destination" count={report.delivery.rows.length}>
          <DeliveryTable matrix={report.delivery} />
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
