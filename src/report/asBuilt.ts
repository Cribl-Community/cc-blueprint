// Inventory -> As-Built view model. Pure: shared by the As-Built tab and the Markdown export.
import type { ReferenceGraph, Ref } from '../model/graph';
import { deliveries, EXPRESSION_OUTPUT, type Delivery } from '../model/delivery';
import { routeReach, type ReachState } from '../model/reach';
import type { Inventory, Origin } from '../model/types';

export interface OriginSummary {
  /** Parent Fleets objects were inherited from. */
  parents: string[];
  inherited: number;
  overridden: number;
  local: number;
}

export interface AsBuiltSummary {
  sources: { total: number; enabled: number; quickConnect: number };
  routes: { total: number; enabled: number };
  pipelines: number;
  destinations: number;
  packs: number;
  /** Present only when some object was inherited from a parent Fleet. */
  origin?: OriginSummary;
}

export interface RouteRow {
  id: string;
  /** Subfleet provenance: `inherited from <fleet>`, `overridden (from <fleet>)`, or undefined for local objects. */
  origin?: string;
  position: number;
  name: string;
  filter: string;
  pipeline: string;
  output: string;
  final: boolean;
  enabled: boolean;
}

export interface SourceRow {
  id: string;
  /** Subfleet provenance: `inherited from <fleet>`, `overridden (from <fleet>)`, or undefined for local objects. */
  origin?: string;
  type: string;
  mode: 'Routes' | 'QuickConnect';
  preProcessing: string;
  enabled: boolean;
}

export interface PipelineRow {
  id: string;
  /** Subfleet provenance: `inherited from <fleet>`, `overridden (from <fleet>)`, or undefined for local objects. */
  origin?: string;
  functions: number;
  disabledFunctions: number;
  usedBy: string;
}

export interface DestinationRow {
  id: string;
  /** Subfleet provenance: `inherited from <fleet>`, `overridden (from <fleet>)`, or undefined for local objects. */
  origin?: string;
  type: string;
  backpressure: string;
  postProcessing: string;
  usedBy: string;
}

export interface PackRow {
  id: string;
  name: string;
  version: string;
}

export interface ReachCell {
  state: ReachState;
  /** Final and a definite match: this Source's events stop here. */
  stops: boolean;
}

export interface ReachMatrix {
  routes: { id: string; label: string; enabled: boolean; reachedBy: number }[];
  /** One row per enabled Source that uses the Routing table; cells follow `routes`. */
  rows: { sourceId: string; type: string; cells: ReachCell[] }[];
  /** Enabled QuickConnect Sources, which bypass the Routing table. */
  quickConnect: string[];
}

export interface DeliveryMatrix {
  /** Destinations that receive data from at least one Source, in inventory order. */
  destinations: { id: string; label: string; disabled: boolean; missing: boolean }[];
  /** One row per enabled Source; cells follow `destinations`, undefined where nothing arrives. */
  rows: { sourceId: string; mode: 'Routes' | 'QuickConnect'; cells: (Delivery | undefined)[] }[];
}

export interface AsBuilt {
  group: string;
  criblVersion?: string;
  summary: AsBuiltSummary;
  routes: RouteRow[];
  reach: ReachMatrix;
  delivery: DeliveryMatrix;
  sources: SourceRow[];
  pipelines: PipelineRow[];
  destinations: DestinationRow[];
  packs: PackRow[];
}

const KIND_LABEL: Record<Ref['kind'], string> = {
  route: 'route',
  source: 'source',
  quickconnect: 'QuickConnect',
  destination: 'destination',
  router: 'router',
  alias: 'default alias',
  chain: 'chained from',
};

export function describeRefs(refs: Ref[] | undefined, inv: Inventory): string {
  if (!refs?.length) return '—';
  const routeName = (id: string) => inv.routes.find((r) => r.id === id)?.name ?? id;
  return refs
    .map((r) => `${KIND_LABEL[r.kind]} ${r.kind === 'route' ? routeName(r.from) : r.from}`)
    .join(', ');
}

const REACH_TEXT: Record<ReachState, string> = {
  yes: '✓',
  maybe: '?',
  no: '—',
  unreached: '·',
  disabled: 'off',
};

/** Short cell text for the reach matrix, shared by the UI and the Markdown export. */
export const reachLabel = (c: ReachCell) => (c.stops ? '✓ stops' : REACH_TEXT[c.state]);

export const REACH_LEGEND =
  '✓ matches; ✓ stops: Final match, so later Routes never see these events; ? depends on event content; — filter never matches; · never reached (stopped by an earlier Route); off: Route disabled';

/** Enabled Routes no routed Source can reach, even possibly. */
export const unreachedRoutes = (m: ReachMatrix) => m.routes.filter((r) => r.enabled && r.reachedBy === 0);

export function buildReachMatrix(inv: Inventory): ReachMatrix {
  const routes = [...inv.routes].sort((a, b) => a.index - b.index);
  const rows = [...routeReach(inv)].map(([sourceId, cells]) => ({
    sourceId,
    type: inv.sources.find((s) => s.id === sourceId)?.type ?? '',
    cells: cells.map(({ state, stops }) => ({ state, stops })),
  }));
  return {
    routes: routes.map((r, i) => ({
      id: r.id,
      label: `${r.index + 1}. ${r.name}`,
      enabled: !r.disabled,
      reachedBy: rows.filter((row) => ['yes', 'maybe'].includes(row.cells[i].state)).length,
    })),
    rows,
    quickConnect: inv.sources.filter((s) => !s.sendToRoutes && !s.disabled).map((s) => s.id),
  };
}

/** Column header: the destination id, flagged when it is disabled or not in the inventory. */
export const destinationHeader = (d: DeliveryMatrix['destinations'][number]) =>
  `${d.label}${d.disabled ? ' (disabled)' : d.missing ? ' (missing)' : ''}`;

/** Enabled Sources whose data reaches no Destination at all. */
export const undelivered = (m: DeliveryMatrix) => m.rows.filter((r) => r.cells.every((c) => !c)).map((r) => r.sourceId);

/** Short cell text for the delivery matrix. */
export const deliveryLabel = (d: Delivery | undefined) => (!d ? '—' : d.strength === 'yes' ? '✓' : '?');

export const DELIVERY_LEGEND =
  '✓ arrives; ? depends on event content; — nothing arrives. Follows Routes, QuickConnect, the default alias, and Output Router rules.';

export function buildDeliveryMatrix(inv: Inventory): DeliveryMatrix {
  const bySource = deliveries(inv);
  const used = new Set([...bySource.values()].flat().map((d) => d.destinationId));
  const known = inv.destinations.map((d) => d.id);
  const ids = [...known.filter((id) => used.has(id)), ...[...used].filter((id) => !known.includes(id)).sort()];
  const byId = new Map(inv.destinations.map((d) => [d.id, d]));
  return {
    destinations: ids.map((id) => ({
      id,
      label: id,
      disabled: byId.get(id)?.disabled ?? false,
      missing: id !== EXPRESSION_OUTPUT && !byId.has(id),
    })),
    rows: inv.sources
      .filter((s) => !s.disabled && bySource.has(s.id))
      .map((s) => {
        const found = new Map(bySource.get(s.id)!.map((d) => [d.destinationId, d]));
        return { sourceId: s.id, mode: s.sendToRoutes ? 'Routes' : 'QuickConnect', cells: ids.map((id) => found.get(id)) };
      }),
  };
}

export const originLabel = (o: Origin | undefined) =>
  !o ? undefined : o.overridden ? `overridden (from ${o.from})` : `inherited from ${o.from}`;

function summarizeOrigins(objects: { origin?: Origin }[]): OriginSummary | undefined {
  const inherited = objects.filter((o) => o.origin);
  if (!inherited.length) return undefined;
  return {
    parents: [...new Set(inherited.map((o) => o.origin!.from))].sort(),
    inherited: inherited.filter((o) => !o.origin!.overridden).length,
    overridden: inherited.filter((o) => o.origin!.overridden).length,
    local: objects.length - inherited.length,
  };
}

export function buildAsBuilt(inv: Inventory, graph: ReferenceGraph): AsBuilt {
  const pipelines = inv.pipelines.filter((p) => !p.packId);
  return {
    group: inv.group,
    criblVersion: inv.criblVersion,
    summary: {
      sources: {
        total: inv.sources.length,
        enabled: inv.sources.filter((s) => !s.disabled).length,
        quickConnect: inv.sources.filter((s) => s.connections.length > 0).length,
      },
      routes: { total: inv.routes.length, enabled: inv.routes.filter((r) => !r.disabled).length },
      pipelines: pipelines.length,
      destinations: inv.destinations.length,
      packs: inv.packs.length,
      origin: summarizeOrigins([...inv.sources, ...inv.routes, ...pipelines, ...inv.destinations]),
    },
    routes: inv.routes.map((r) => {
      const resolved = r.output ? graph.resolveDestination(r.output) : undefined;
      return {
        id: r.id,
        position: r.index + 1,
        name: r.name,
        filter: r.filter,
        pipeline: r.pipeline,
        output: r.output
          ? resolved !== r.output
            ? `${r.output} → ${resolved}`
            : r.output
          : `expression: ${r.outputExpression ?? ''}`,
        final: r.final,
        enabled: !r.disabled,
        origin: originLabel(r.origin),
      };
    }),
    reach: buildReachMatrix(inv),
    delivery: buildDeliveryMatrix(inv),
    sources: inv.sources.map((s) => ({
      id: s.id,
      type: s.type,
      mode: s.sendToRoutes ? 'Routes' : 'QuickConnect',
      preProcessing: s.pipeline ?? '—',
      enabled: !s.disabled,
      origin: originLabel(s.origin),
    })),
    pipelines: pipelines.map((p) => ({
      id: p.id,
      functions: p.functions.length,
      disabledFunctions: p.functions.filter((f) => f.disabled).length,
      usedBy: describeRefs(graph.pipelineRefs.get(p.id), inv),
      origin: originLabel(p.origin),
    })),
    destinations: inv.destinations.map((d) => ({
      id: d.id,
      type: d.defaultId ? `default → ${graph.resolveDestination(d.id)}` : d.type,
      backpressure: d.onBackpressure ?? '—',
      postProcessing: d.pipeline ?? '—',
      usedBy: describeRefs(graph.destinationRefs.get(d.id), inv),
      origin: originLabel(d.origin),
    })),
    packs: inv.packs.map((p) => ({ id: p.id, name: p.displayName, version: p.version ?? '—' })),
  };
}
