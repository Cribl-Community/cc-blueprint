// The normalized Inventory: one pure-data view of a Worker Group's config. Everything downstream
// (report, lint, diff, snapshots) consumes this, never raw API JSON.

/** Raw API items per endpoint, exactly as `{ items }` returned them. */
export interface RawConfig {
  group: string;
  criblVersion?: string;
  /** Optional collections that couldn't be read (e.g. no permission); treated as empty. */
  warnings?: string[];
  routes: unknown[];
  pipelines: unknown[];
  inputs: unknown[];
  outputs: unknown[];
  packs: unknown[];
}

/** For a subfleet's config: the parent Fleet an object came from, and whether it's overridden locally. */
export interface Origin {
  from: string;
  overridden: boolean;
}

export interface Connection {
  pipeline?: string;
  output: string;
}

export interface Source {
  /** Set when a subfleet inherits this object from a parent Fleet. */
  origin?: Origin;
  id: string;
  type: string;
  disabled: boolean;
  /** Pre-processing pipeline, applied before Routes or QuickConnect. */
  pipeline?: string;
  /** False when the Source uses QuickConnect instead of the Routing table. */
  sendToRoutes: boolean;
  /** QuickConnect links: Source -> Pipeline/Pack -> Destination, bypassing Routes. */
  connections: Connection[];
  /** Fields the Source adds to every event; each value is a JS expression. Absent in older snapshots. */
  metadata?: { name: string; value: string }[];
  description?: string;
}

export interface Route {
  /** Set when a subfleet inherits this object from a parent Fleet. */
  origin?: Origin;
  id: string;
  name: string;
  /** 0-based position in the Routing table; evaluation order. */
  index: number;
  filter: string;
  final: boolean;
  disabled: boolean;
  pipeline: string;
  /** Destination id; undefined when the route uses an output expression. */
  output?: string;
  outputExpression?: string;
  description?: string;
  groupId?: string;
}

export interface PipelineFunction {
  /** Function type, e.g. `eval`, `regex_extract`. */
  id: string;
  filter?: string;
  disabled: boolean;
  final: boolean;
  description?: string;
  groupId?: string;
  conf: Record<string, unknown>;
}

export interface Pipeline {
  /** Set when a subfleet inherits this object from a parent Fleet. */
  origin?: Origin;
  id: string;
  description?: string;
  functions: PipelineFunction[];
  /** `pack:<id>` entries in /pipelines are pack references, not real pipelines. */
  packId?: string;
}

export interface OutputRouterRule {
  filter: string;
  output: string;
  final: boolean;
}

export interface Destination {
  /** Set when a subfleet inherits this object from a parent Fleet. */
  origin?: Origin;
  id: string;
  type: string;
  disabled: boolean;
  /** Post-processing pipeline. */
  pipeline?: string;
  onBackpressure?: string;
  /** For the `default` alias destination: the id it points at. */
  defaultId?: string;
  /** For Output Router destinations. */
  rules: OutputRouterRule[];
  description?: string;
}

export interface Pack {
  id: string;
  displayName: string;
  version?: string;
  author?: string;
  description?: string;
}

export interface Inventory {
  group: string;
  criblVersion?: string;
  sources: Source[];
  routes: Route[];
  pipelines: Pipeline[];
  destinations: Destination[];
  packs: Pack[];
}
