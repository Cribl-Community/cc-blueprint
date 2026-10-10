import { describe, expect, it } from 'vitest';
import { demoRaw, destination, fleetDefaultRaw, inventory, pipeline, route, source, workspaceDefaultRaw } from '../../test/inventory';
import { buildGraph } from '../model/graph';
import { normalize } from '../model/normalize';
import { buildAsBuilt, unreachedRoutes } from './asBuilt';
import { layoutFlow, NODE_W } from './flowLayout';
import { lint } from '../lint/runner';
import { cell, code, toMarkdown } from './markdown';

const demo = inventory({
  sources: [
    source('gen_web'),
    source('gen_qc', { sendToRoutes: false, connections: [{ pipeline: 'qc_pipe', output: 'lake' }] }),
    source('gen_off', { disabled: true }),
  ],
  routes: [
    route(0, { name: 'web', filter: "sourcetype=='web'", pipeline: 'web_pipe', output: 'lake', final: true }),
    route(1, { name: 'default', output: 'default' }),
  ],
  pipelines: [pipeline('passthru'), pipeline('web_pipe', ['eval', 'drop']), pipeline('qc_pipe', ['eval']), pipeline('unused', ['eval'])],
  destinations: [destination('lake', { type: 'cribl_lake', onBackpressure: 'block' }), destination('devnull'), destination('default', { type: 'default', defaultId: 'devnull' })],
});

describe('buildAsBuilt', () => {
  const report = buildAsBuilt(demo, buildGraph(demo));

  it('summarizes counts and QuickConnect usage', () => {
    expect(report.summary).toEqual({
      sources: { total: 3, enabled: 2, quickConnect: 1 },
      routes: { total: 2, enabled: 2 },
      pipelines: 4,
      destinations: 3,
      packs: 0,
    });
  });

  it('shows where the default alias really goes and who uses each object', () => {
    expect(report.routes[1].output).toBe('default → devnull');
    expect(report.pipelines.find((p) => p.id === 'unused')?.usedBy).toBe('—');
    expect(report.pipelines.find((p) => p.id === 'qc_pipe')?.usedBy).toBe('QuickConnect gen_qc');
    expect(report.destinations.find((d) => d.id === 'lake')?.usedBy).toBe('route web, QuickConnect gen_qc');
  });
});

describe('reach matrix', () => {
  it('has a row per enabled routed source and lists QuickConnect sources separately', () => {
    const { reach } = buildAsBuilt(demo, buildGraph(demo));
    expect(reach.routes.map((r) => r.label)).toEqual(['1. web', '2. default']);
    // `sourcetype=='web'` depends on event content; the catch-all default is Final.
    expect(reach.rows).toEqual([
      { sourceId: 'gen_web', type: 'datagen', cells: [{ state: 'maybe', stops: false }, { state: 'yes', stops: true }] },
    ]);
    expect(reach.quickConnect).toEqual(['gen_qc']);
  });

  it('exports the matrix and names routes no source reaches', () => {
    const inv = normalize(demoRaw()); // catch_all_early (route 2) stops every source
    const graph = buildGraph(inv);
    const report = buildAsBuilt(inv, graph);
    expect(unreachedRoutes(report.reach).map((r) => r.label)).toEqual([
      '3. auth_to_splunk',
      '4. auth_parse',
      '5. noisy',
      '6. default',
    ]);
    const md = toMarkdown(report, graph.flows, new Date(0));
    expect(md).toContain('## Source × Route reach');
    expect(md).toContain('| gen_auth | — | ✓ stops | · | · | · | · |');
    expect(md).toContain('**No Source reaches:** 3. auth_to_splunk, 4. auth_parse, 5. noisy, 6. default');
  });
});

describe('layoutFlow', () => {
  const layout = layoutFlow(demo, buildGraph(demo));

  it('puts each object type in its own column, left to right', () => {
    const xs = ['source', 'route', 'pipeline', 'destination'].map(
      (c) => layout.nodes.find((n) => n.column === c)!.x,
    );
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(xs[1] - xs[0]).toBeGreaterThan(NODE_W);
  });

  it('sends routed sources to the bus and QuickConnect sources straight to their pipeline', () => {
    const keys = layout.edges.map((e) => e.key);
    expect(keys).toContain('bus:gen_web');
    expect(keys).not.toContain('bus:gen_qc');
    expect(keys).toContain('quickconnect:gen_qc->qc_pipe');
    expect(layout.edges.find((e) => e.key === 'pair:passthru->default')?.flows).toEqual(['r1']);
  });

  it('runs source edges straight into the bus and keeps QuickConnect sources off it', () => {
    const inv = normalize(demoRaw()); // 3 routed sources beside 6 routes
    const { edges, nodes, bus } = layoutFlow(inv, buildGraph(inv));
    const busEdges = edges.filter((e) => e.key.startsWith('bus:'));
    expect(busEdges.length).toBeGreaterThan(0);
    for (const e of busEdges) expect(e.to.y).toBe(e.from.y);
    const qc = nodes.find((n) => n.id === 'gen_metrics_qc')!;
    expect(qc.y).toBeGreaterThan(bus!.y2);
  });

  it('marks unreferenced pipelines and destinations', () => {
    const unref = layout.nodes.filter((n) => n.unreferenced).map((n) => n.key);
    expect(unref).toEqual(['pipeline:unused']);
  });

  it('lays out the real workspace fixture without overlapping rows', () => {
    const inv = normalize(workspaceDefaultRaw);
    const big = layoutFlow(inv, buildGraph(inv));
    for (const col of ['source', 'route', 'pipeline', 'destination']) {
      const ys = big.nodes.filter((n) => n.column === col).map((n) => n.y);
      expect(new Set(ys).size).toBe(ys.length);
    }
  });

  it('hides unused built-in pipelines and marks nodes with their worst finding', () => {
    const inv = normalize(demoRaw());
    const graph = buildGraph(inv);
    const withBuiltins = { ...inv, pipelines: [...inv.pipelines, ...['main', 'cisco_asa'].map((id) => pipeline(id, ['eval']))] };
    const l = layoutFlow(withBuiltins, buildGraph(withBuiltins), lint(inv, graph));
    expect(l.hiddenBuiltins).toEqual(['main', 'cisco_asa']);
    expect(l.nodes.some((n) => n.id === 'main')).toBe(false);
    const node = (key: string) => l.nodes.find((n) => n.key === key)!;
    expect(node('pipeline:passthru').severity).toBeUndefined(); // used built-ins stay visible
    expect(node('route:catch_all_early')).toMatchObject({ severity: 'error', findingCount: 2 }); // L01 + L02
    expect(node('pipeline:legacy_cleanup')).toMatchObject({ severity: 'warning', unreferenced: true });
    expect(node('pipeline:all_disabled').severity).toBe('info');
    expect(node('route:web').severity).toBeUndefined();
  });

  it('handles a group with no routes', () => {
    const empty = inventory({ sources: [source('a')] });
    const l = layoutFlow(empty, buildGraph(empty));
    expect(l.bus).toBeUndefined();
    expect(l.edges).toEqual([]);
  });
});

describe('markdown', () => {
  it('escapes table cells and code spans', () => {
    expect(cell('a|b\nc')).toBe('a\\|b c');
    expect(cell('')).toBe('—');
    expect(code('x=`y`')).toBe('`` x=`y` ``'); // longer fence, padded because it ends in a backtick
    expect(code('/\\d+/')).toBe('`/\\d+/`');
  });

  it('renders a complete, deterministic report', () => {
    const md = toMarkdown(buildAsBuilt(demo, buildGraph(demo)), buildGraph(demo).flows, new Date('2026-09-26T15:04:00Z'));
    expect(md).toContain('# As-Built: test');
    expect(md).toContain('Generated 2026-09-26 15:04 UTC by Cribl Blueprint');
    expect(md).toContain("| 1 | web | `sourcetype=='web'` | web_pipe | lake | Yes | Yes |");
    expect(md).toContain('```mermaid\nflowchart LR');
    expect(md).toContain('-.->'); // QuickConnect edge
    expect(md).toContain('default → devnull');
    expect(md.split('```mermaid')[1].split('```')[0]).not.toContain('gen_off'); // disabled sources omitted
    expect(md).not.toContain('## Findings');
  });

  it('adds a masked findings table when findings are passed', () => {
    const inv = normalize(demoRaw());
    const graph = buildGraph(inv);
    const md = toMarkdown(buildAsBuilt(inv, graph), graph.flows, new Date(0), lint(inv, graph));
    expect(md).toContain('## Findings');
    expect(md).toContain('2 errors, 4 warnings, 2 info.');
    expect(md).toContain('| Error | L01 | route catch_all_early |');
    expect(md).not.toContain('FAKE0000blueprint');
    expect(md.indexOf('## Findings')).toBeLessThan(md.indexOf('## Data flow'));
  });

  it('lists suppressed findings with their reasons', () => {
    const inv = normalize(demoRaw());
    const graph = buildGraph(inv);
    const [first, ...rest] = lint(inv, graph);
    expect(toMarkdown(buildAsBuilt(inv, graph), graph.flows, new Date(0), rest)).toContain('1 error, 4 warnings, 2 info.');
    const md = toMarkdown(buildAsBuilt(inv, graph), graph.flows, new Date(0), rest, [
      { finding: first, suppression: { reason: 'Accepted: a|b', by: 'steve', at: '2026-09-28T00:00:00Z', message: first.message } },
    ]);
    expect(md).toContain('### Suppressed findings');
    expect(md).toContain('| L01 | route catch_all_early | Accepted: a\\|b | steve | 2026-09-28 |');
  });
});

describe('demo seed', () => {
  const inv = normalize(demoRaw());
  const graph = buildGraph(inv);

  it('wires the objects the demo script relies on', () => {
    expect(inv.routes.map((r) => r.id)).toEqual(['web', 'catch_all_early', 'auth_to_splunk', 'auth_parse', 'noisy', 'default']);
    expect(graph.pipelineRefs.has('legacy_cleanup')).toBe(false);
    expect(graph.destinationRefs.has('old_s3_archive')).toBe(false);
    expect(graph.pipelineRefs.get('qc_enrich')).toEqual([{ kind: 'quickconnect', from: 'gen_metrics_qc' }]);
    expect(graph.resolveDestination('default')).toBe('devnull');
  });

  it('contains no real-looking hosts or secrets', () => {
    const text = JSON.stringify(demoRaw());
    const hosts = text.match(/[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|cloud)\b/gi) ?? [];
    expect(hosts.every((h) => h.endsWith('example.com'))).toBe(true);
    expect(text).toContain('FAKE');
  });
});

describe('Edge Fleet', () => {
  it('reads a fresh fleet with the Stream model and lints it quietly', () => {
    const inv = normalize(fleetDefaultRaw);
    const graph = buildGraph(inv);
    expect(lint(inv, graph)).toEqual([]);
    const report = buildAsBuilt(inv, graph);
    expect(report.summary.sources).toEqual({ total: 12, enabled: 3, quickConnect: 3 });
    // Its enabled QuickConnect Sources send straight to devnull.
    expect(report.delivery.rows.map((r) => r.sourceId)).toEqual(['in_system_metrics', 'in_system_state', 'in_windows_metrics']);
    expect(report.delivery.destinations.map((d) => d.id)).toEqual(['devnull']);
  });
});

describe('subfleet provenance', () => {
  // A subfleet's config is served with __srcGroup/__srcOverridden on inherited objects.
  const raw = {
    ...fleetDefaultRaw,
    group: 'linux',
    inputs: (fleetDefaultRaw.inputs as Record<string, unknown>[]).map((i, n) =>
      n === 0 ? { ...i, __srcGroup: 'default_fleet', __srcOverridden: true } : n < 3 ? { ...i, __srcGroup: 'default_fleet' } : i,
    ),
  };

  it('records where each object came from and summarizes it', () => {
    const inv = normalize(raw);
    expect(inv.sources.find((s) => s.id === 'in_system_metrics')?.origin).toEqual({ from: 'default_fleet', overridden: true });
    expect(inv.sources.filter((s) => s.origin)).toHaveLength(3);
    const report = buildAsBuilt(inv, buildGraph(inv));
    expect(report.summary.origin).toMatchObject({ parents: ['default_fleet'], inherited: 2, overridden: 1 });
    expect(report.sources.find((s) => s.id === 'in_system_metrics')?.origin).toBe('overridden (from default_fleet)');
  });

  it('adds an Origin column and a summary row to the export only when something is inherited', () => {
    const inv = normalize(raw);
    const md = toMarkdown(buildAsBuilt(inv, buildGraph(inv)), [], new Date(0));
    expect(md).toContain('| Inherited config | 2 inherited and 1 overridden from default_fleet;');
    expect(md).toContain('| ID | Type | Mode | Pre-processing | Enabled | Origin |');
    expect(md).toContain('| in_system_metrics | system_metrics | QuickConnect | — | Yes | overridden (from default_fleet) |');
    const plain = normalize(fleetDefaultRaw);
    expect(toMarkdown(buildAsBuilt(plain, buildGraph(plain)), [], new Date(0))).not.toContain('Origin');
  });
});
