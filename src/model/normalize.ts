import type {
  Connection,
  Destination,
  Inventory,
  OutputRouterRule,
  Pack,
  Pipeline,
  PipelineFunction,
  RawConfig,
  Route,
  Source,
} from './types';

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const bool = (v: unknown): boolean => v === true;

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

export const PACK_PIPELINE_PREFIX = 'pack:';

function normalizeSource(raw: unknown): Source {
  const r = obj(raw);
  const connections: Connection[] = arr(r.connections)
    .map(obj)
    .filter((c) => str(c.output))
    .map((c) => ({ output: str(c.output)!, pipeline: str(c.pipeline) }));
  return {
    id: String(r.id),
    type: str(r.type) ?? 'unknown',
    disabled: bool(r.disabled),
    pipeline: str(r.pipeline),
    // Cribl omits sendToRoutes on older sources; it defaults to true unless QuickConnect is used.
    sendToRoutes: r.sendToRoutes === undefined ? connections.length === 0 : r.sendToRoutes !== false,
    connections,
    metadata: arr(r.metadata)
      .map(obj)
      .filter((m) => str(m.name) && m.value !== undefined)
      .map((m) => ({ name: str(m.name)!, value: String(m.value) })),
    description: str(r.description),
  };
}

/** `/routes` returns tables; Stream uses one table with id `default`. */
function normalizeRoutes(tables: unknown[]): Route[] {
  const table = obj(tables.find((t) => obj(t).id === 'default') ?? tables[0]);
  return arr(table.routes).map((raw, index) => {
    const r = obj(raw);
    const usesExpression = bool(r.enableOutputExpression);
    return {
      id: String(r.id ?? index),
      name: str(r.name) ?? String(r.id ?? `route ${index + 1}`),
      index,
      filter: typeof r.filter === 'string' ? r.filter : 'true',
      final: r.final !== false,
      disabled: bool(r.disabled),
      pipeline: str(r.pipeline) ?? 'passthru',
      output: usesExpression ? undefined : (str(r.output) ?? 'default'),
      outputExpression: usesExpression ? str(r.outputExpression) : undefined,
      description: str(r.description),
      groupId: str(r.groupId),
    };
  });
}

function normalizeFunction(raw: unknown): PipelineFunction {
  const f = obj(raw);
  return {
    id: str(f.id) ?? 'unknown',
    filter: str(f.filter),
    disabled: bool(f.disabled),
    final: bool(f.final),
    description: str(f.description),
    groupId: str(f.groupId),
    conf: obj(f.conf),
  };
}

function normalizePipeline(raw: unknown): Pipeline {
  const p = obj(raw);
  const id = String(p.id);
  const conf = obj(p.conf);
  const isPack = id.startsWith(PACK_PIPELINE_PREFIX) || bool(conf.pack);
  return {
    id,
    description: str(conf.description),
    functions: arr(conf.functions).map(normalizeFunction),
    packId: isPack ? id.slice(id.startsWith(PACK_PIPELINE_PREFIX) ? PACK_PIPELINE_PREFIX.length : 0) : undefined,
  };
}

function normalizeDestination(raw: unknown): Destination {
  const d = obj(raw);
  const rules: OutputRouterRule[] = arr(d.rules)
    .map(obj)
    .filter((r) => str(r.output))
    .map((r) => ({ filter: typeof r.filter === 'string' ? r.filter : 'true', output: str(r.output)!, final: r.final !== false }));
  return {
    id: String(d.id),
    type: str(d.type) ?? 'unknown',
    disabled: bool(d.disabled),
    pipeline: str(d.pipeline),
    onBackpressure: str(d.onBackpressure),
    defaultId: str(d.defaultId),
    rules,
    description: str(d.description),
  };
}

function normalizePack(raw: unknown): Pack {
  const p = obj(raw);
  const id = String(p.id);
  return {
    id,
    displayName: str(p.displayName) ?? id,
    version: str(p.version),
    author: str(p.author),
    description: str(p.description),
  };
}

export function normalize(raw: RawConfig): Inventory {
  return {
    group: raw.group,
    criblVersion: raw.criblVersion,
    sources: raw.inputs.map(normalizeSource).sort(byId),
    routes: normalizeRoutes(raw.routes),
    pipelines: raw.pipelines.map(normalizePipeline).sort(byId),
    destinations: raw.outputs.map(normalizeDestination).sort(byId),
    packs: raw.packs.map(normalizePack).sort(byId),
  };
}
