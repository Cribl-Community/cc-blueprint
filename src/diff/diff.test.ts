import { describe, expect, it } from 'vitest';
import { demoRaw, destination, inventory, pipeline, route, source } from '../../test/inventory';
import { normalize } from '../model/normalize';
import { planL01Fix } from '../fix/l01';
import { diffInventory, diffReach } from './diff';

describe('diffInventory', () => {
  const before = inventory({
    routes: [route(0, { name: 'web', filter: "a=='1'" }), route(1, { name: 'drop' }), route(2, { name: 'old', filter: 'x' })],
    pipelines: [pipeline('passthru'), pipeline('p1', ['eval'])],
  });

  it('reports added, removed, and field-level route changes', () => {
    const after = inventory({
      routes: [route(0, { name: 'web', filter: "a=='2'" }), route(1, { name: 'drop' }), route(3, { name: 'new', filter: 'y' })],
      pipelines: [pipeline('passthru'), pipeline('p1', ['eval', 'drop'])],
    });
    const d = diffInventory(before, after);
    expect(d.kinds.routes.added).toEqual([{ id: 'r3', name: 'new' }]);
    expect(d.kinds.routes.removed).toEqual([{ id: 'r2', name: 'old' }]);
    expect(d.kinds.routes.changed).toEqual([
      { id: 'r0', name: 'web', fields: [{ field: 'filter', before: "a=='1'", after: "a=='2'" }] },
    ]);
    expect(d.kinds.pipelines.changed[0].fields).toEqual([
      { field: 'functions', before: '1', after: '2' },
      { field: 'function 2', before: '—', after: 'drop' },
    ]);
    expect(d.total).toBe(4);
  });

  it('reports an empty change set for identical inventories', () => {
    const d = diffInventory(before, before);
    expect(d.total).toBe(0);
    expect(d.routeOrder).toBeUndefined();
  });

  it('shows the L01 fix as a route reorder', () => {
    const inv = normalize(demoRaw());
    const plan = planL01Fix(inv.routes, 'catch_all_early')!;
    const d = diffInventory(inv, { ...inv, routes: plan.after });
    expect(d.routeOrder?.after).toEqual(['web', 'auth_to_splunk', 'auth_parse', 'noisy', 'catch_all_early', 'default']);
    expect(d.kinds.routes.changed.map((c) => `${c.name ?? c.id}: ${c.fields.map((f) => `${f.before}→${f.after}`).join()}`)).toEqual([
      'auth_to_splunk: 3→2',
      'auth_parse: 4→3',
      'noisy: 5→4',
      'catch_all_early: 2→5',
    ]);
  });

  it('flags destination setting changes', () => {
    const a = inventory({ destinations: [destination('s', { type: 'splunk', onBackpressure: 'drop' })] });
    const b = inventory({ destinations: [destination('s', { type: 'splunk', onBackpressure: 'queue' })] });
    expect(diffInventory(a, b).kinds.destinations.changed[0].fields).toEqual([
      { field: 'backpressure', before: 'drop', after: 'queue' },
    ]);
  });
});

describe('diffReach', () => {
  it('shows what the L01 fix changes for each source', () => {
    const inv = normalize(demoRaw());
    const plan = planL01Fix(inv.routes, 'catch_all_early')!;
    const [change, ...rest] = diffReach(inv, { ...inv, routes: plan.after });
    expect(rest).toEqual([]); // gen_web stops at route 1 either way
    expect(change.sourceId).toBe('gen_auth');
    expect(change.gained.map((d) => d.label)).toEqual(['2. auth_to_splunk', '3. auth_parse']);
    expect(change.lost.map((d) => `${d.label}: ${d.before}→${d.after}`)).toEqual(['5. catch_all_early: yes→unreached']);
  });

  it('reports a match that became event-dependent, and ignores routes only one side has', () => {
    const sources = [source('gen_a')];
    const before = inventory({ sources, routes: [route(0, { filter: "__inputId=='datagen:gen_a'", final: false }), route(1)] });
    const after = inventory({
      sources,
      routes: [route(0, { filter: "host=='x'", final: false }), route(1), route(2, { filter: 'new' })],
    });
    const [change] = diffReach(before, after);
    expect(change.changed.map((d) => `${d.label}: ${d.before}→${d.after}`)).toEqual(['1. route0: yes→maybe']);
    expect(change.gained).toEqual([]);
  });

  it('is empty when routing is unchanged', () => {
    const inv = normalize(demoRaw());
    expect(diffReach(inv, inv)).toEqual([]);
  });
});
