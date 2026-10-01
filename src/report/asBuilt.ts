// Inventory -> As-Built view model. Pure: shared by the As-Built tab and the Markdown export.
import type { ReferenceGraph, Ref } from '../model/graph';
import { routeReach, type ReachState } from '../model/reach';
import type { Inventory } from '../model/types';

export interface AsBuiltSummary {
  sources: { total: number; enabled: number; quickConnect: number };
  routes: { total: number; enabled: number };
  pipelines: number;
  destinations: number;
  packs: number;
}

export interface RouteRow {
  id: string;
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
  type: string;
  mode: 'Routes' | 'QuickConnect';
  preProcessing: string;
  enabled: boolean;
}

export interface PipelineRow {
  id: string;
  functions: number;
  disabledFunctions: number;
  usedBy: string;
}

export interface DestinationRow {
  id: string;
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

export interface AsBuilt {
  group: string;
  criblVersion?: string;
  summary: AsBuiltSummary;
  routes: RouteRow[];
  reach: ReachMatrix;
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
      };
    }),
    reach: buildReachMatrix(inv),
    sources: inv.sources.map((s) => ({
      id: s.id,
      type: s.type,
      mode: s.sendToRoutes ? 'Routes' : 'QuickConnect',
      preProcessing: s.pipeline ?? '—',
      enabled: !s.disabled,
    })),
    pipelines: pipelines.map((p) => ({
      id: p.id,
      functions: p.functions.length,
      disabledFunctions: p.functions.filter((f) => f.disabled).length,
      usedBy: describeRefs(graph.pipelineRefs.get(p.id), inv),
    })),
    destinations: inv.destinations.map((d) => ({
      id: d.id,
      type: d.defaultId ? `default → ${graph.resolveDestination(d.id)}` : d.type,
      backpressure: d.onBackpressure ?? '—',
      postProcessing: d.pipeline ?? '—',
      usedBy: describeRefs(graph.destinationRefs.get(d.id), inv),
    })),
    packs: inv.packs.map((p) => ({ id: p.id, name: p.displayName, version: p.version ?? '—' })),
  };
}
