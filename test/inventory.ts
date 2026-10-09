// Test helpers: load sanitized fixtures and build small hand-made Inventories.
import workspaceClean from './fixtures/workspace-clean.json';
import workspaceDefault from './fixtures/workspace-default.json';
import fleetDefault from './fixtures/fleet-default.json';
import { demoSeed } from '../demo/seed';
import type { Destination, Inventory, Pipeline, Route, Source } from '../src/model/types';
import type { RawConfig } from '../src/model/types';

export const workspaceDefaultRaw = workspaceDefault as unknown as RawConfig;
/** A fresh Cribl.Cloud 4.20 workspace's `default_fleet` Edge Fleet, with no Edge Nodes. */
export const fleetDefaultRaw = fleetDefault as unknown as RawConfig;
/** A fresh Cribl.Cloud 4.20 workspace's `default` group, captured before seeding. */
export const workspaceCleanRaw = workspaceClean as unknown as RawConfig;

export function source(id: string, extra: Partial<Source> = {}): Source {
  return { id, type: 'datagen', disabled: false, sendToRoutes: true, connections: [], ...extra };
}

export function route(index: number, extra: Partial<Route> = {}): Route {
  return {
    id: `r${index}`,
    name: `route${index}`,
    index,
    filter: 'true',
    final: true,
    disabled: false,
    pipeline: 'passthru',
    output: 'default',
    ...extra,
  };
}

export function pipeline(id: string, fnIds: string[] = [], extra: Partial<Pipeline> = {}): Pipeline {
  return {
    id,
    functions: fnIds.map((f) => ({ id: f, disabled: false, final: false, conf: {} })),
    ...extra,
  };
}

export function destination(id: string, extra: Partial<Destination> = {}): Destination {
  return { id, type: 'devnull', disabled: false, rules: [], ...extra };
}

export function inventory(extra: Partial<Inventory> = {}): Inventory {
  return {
    group: 'test',
    sources: [],
    routes: [],
    pipelines: [pipeline('passthru')],
    destinations: [destination('devnull'), destination('default', { type: 'default', defaultId: 'devnull' })],
    packs: [],
    ...extra,
  };
}

/** The blueprint-demo seed as the API would return it after seeding a fresh group. */
export function demoRaw(): RawConfig {
  const seed = demoSeed(['sample.log']);
  return {
    group: 'blueprint-demo',
    routes: [{ id: 'default', routes: seed.routes }],
    pipelines: [{ id: 'passthru', conf: { functions: [] } }, ...seed.pipelines],
    inputs: seed.inputs,
    outputs: [{ id: 'devnull', type: 'devnull' }, { id: 'default', type: 'default', defaultId: 'devnull' }, ...seed.outputs],
    packs: [],
  };
}
