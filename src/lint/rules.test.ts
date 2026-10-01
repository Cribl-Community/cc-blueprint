import { describe, expect, it } from 'vitest';
import { EXPECTED_FINDINGS } from '../../demo/seed';
import { demoRaw, destination, inventory, pipeline, route, source, workspaceCleanRaw, workspaceDefaultRaw } from '../../test/inventory';
import { buildGraph } from '../model/graph';
import { normalize } from '../model/normalize';
import type { Inventory, PipelineFunction } from '../model/types';
import { isCatchAll } from './helpers';
import { L01 } from './rules/L01';
import { L02 } from './rules/L02';
import { BUILTIN_PIPELINES, L03 } from './rules/L03';
import { L04 } from './rules/L04';
import { L05 } from './rules/L05';
import { L06 } from './rules/L06';
import { L07, findSecret, mask } from './rules/L07';
import { L08 } from './rules/L08';
import { L09 } from './rules/L09';
import { L10 } from './rules/L10';
import { lint, runRule } from './runner';
import type { Rule } from './types';

const keys = (rule: Rule, inv: Inventory) => runRule(rule, inv, buildGraph(inv)).map((f) => f.key);
const fn = (id: string, conf: Record<string, unknown>, extra: Partial<PipelineFunction> = {}): PipelineFunction => ({
  id,
  conf,
  disabled: false,
  final: false,
  ...extra,
});

describe('isCatchAll', () => {
  it.each(['true', ' true ', '(true)', '!false', '1', '', '((true))'])('matches %j', (f) => expect(isCatchAll(f)).toBe(true));
  it.each(["sourcetype=='x'", 'true && x', 'false', '0', 'truthy'])('rejects %j', (f) => expect(isCatchAll(f)).toBe(false));
});

describe('L09 route no source reaches', () => {
  const sources = [source('gen_a'), source('gen_b')];

  it('fires when the filter matches none of the routed sources', () => {
    const inv = inventory({ sources, routes: [route(0, { filter: "__inputId=='datagen:gone'" }), route(1)] });
    const [f] = runRule(L09, inv, buildGraph(inv));
    expect(f.key).toBe('L09/route/r0');
    expect(f.message).toContain('its filter matches none of the 2 Sources');
    expect(f.fix).toContain('Check the filter');
  });

  it('fires when earlier Final routes take every source first, naming them', () => {
    const inv = inventory({
      sources,
      routes: [
        route(0, { filter: "__inputId=='datagen:gen_a'" }),
        route(1, { filter: "__inputId=='datagen:gen_b'" }),
        route(2, { filter: "host=='x'" }),
        route(3),
      ],
    });
    const [f] = runRule(L09, inv, buildGraph(inv));
    expect(f.key).toBe('L09/route/r2');
    expect(f.message).toBe(
      'Route 3 "route2" receives events from no Source: route 1 "route0" takes gen_a first; route 2 "route1" takes gen_b first.',
    );
    expect(f.fix).toBe('Move "route2" above "route0", or narrow that route\'s filter.');
  });

  it('stays quiet for event-dependent filters, routes below a catch-all, and groups with no routed sources', () => {
    expect(keys(L09, inventory({ sources, routes: [route(0, { filter: "host=='x'" }), route(1)] }))).toEqual([]);
    // Below a Final catch-all: L01 reports it.
    expect(keys(L09, inventory({ sources, routes: [route(0), route(1, { filter: "__inputId=='datagen:gen_a'" })] }))).toEqual([]);
    expect(keys(L09, inventory({ routes: [route(0, { filter: 'false' }), route(1)] }))).toEqual([]);
    expect(keys(L09, inventory({ sources, routes: [route(0, { filter: 'false', disabled: true }), route(1)] }))).toEqual([]);
  });
});

describe('L10 targeted source never reaches its route', () => {
  const sources = [source('gen_a'), source('gen_b'), source('web', { type: 'http' })];

  it('fires when a route written for a source sits below a Final route that takes it', () => {
    const inv = inventory({
      sources,
      routes: [
        route(0, { filter: "__inputId=='datagen:gen_a'" }),
        route(1, { filter: "__inputId.startsWith('datagen:')" }),
        route(2),
      ],
    });
    const [f] = runRule(L10, inv, buildGraph(inv));
    expect(f.key).toBe('L10/route/r1');
    expect(f.message).toBe('Route 2 "route1" matches gen_a, but route 1 "route0" is Final and takes its events first.');
    expect(f.fix).toBe('Move "route1" above "route0", or turn off Final on "route0".');
  });

  it('stays quiet when the earlier route is not Final, or the later filter matches every source', () => {
    const routes = (first: Partial<Parameters<typeof route>[1]>, filter: string) => [
      route(0, { filter: "__inputId=='datagen:gen_a'", ...first }),
      route(1, { filter }),
      route(2),
    ];
    expect(keys(L10, inventory({ sources, routes: routes({ final: false }, "__inputId.startsWith('datagen:')") }))).toEqual([]);
    expect(keys(L10, inventory({ sources, routes: routes({}, "__inputId.includes(':')") }))).toEqual([]);
  });
});

describe('L01 route shadowing', () => {
  it('fires on the first Final catch-all with enabled routes below it', () => {
    const inv = inventory({ routes: [route(0, { filter: 'x' }), route(1), route(2, { filter: 'y' }), route(3, { filter: 'z' }), route(4)] });
    const [f] = runRule(L01, inv, buildGraph(inv));
    expect(f.key).toBe('L01/route/r1');
    expect(f.message).toContain('2 routes below it never match: route2, route3');
  });

  it('does not fire for a trailing catch-all, a non-Final one, or when everything below is disabled', () => {
    expect(keys(L01, inventory({ routes: [route(0, { filter: 'x' }), route(1)] }))).toEqual([]);
    expect(keys(L01, inventory({ routes: [route(0, { final: false }), route(1, { filter: 'x' })] }))).toEqual([]);
    expect(keys(L01, inventory({ routes: [route(0), route(1, { disabled: true })] }))).toEqual([]);
    expect(keys(L01, inventory({ routes: [route(0, { disabled: true }), route(1, { filter: 'x' })] }))).toEqual([]);
    // Only other catch-alls below: redundant, not shadowed logic.
    expect(keys(L01, inventory({ routes: [route(0, { filter: 'x' }), route(1), route(2)] }))).toEqual([]);
  });
});

describe('L02 catch-all to devnull', () => {
  it('fires when a Final catch-all resolves to devnull below other routes', () => {
    const inv = inventory({ routes: [route(0, { filter: 'x', output: 'lake' }), route(1, { output: 'default' })] });
    expect(keys(L02, inv)).toEqual(['L02/route/r1']);
    expect(runRule(L02, inv, buildGraph(inv))[0].evidence).toBe('filter: true · output: default → devnull');
    const direct = inventory({ routes: [route(0, { filter: 'x' }), route(1, { output: 'devnull' })] });
    expect(runRule(L02, direct, buildGraph(direct))[0].evidence).toBe('filter: true · output: devnull');
  });

  it("does not fire for a fresh group's lone Default route or a catch-all that keeps data", () => {
    expect(keys(L02, inventory({ routes: [route(0, { output: 'default' })] }))).toEqual([]);
    const keeps = inventory({
      routes: [route(0, { filter: 'x' }), route(1, { output: 'lake' })],
      destinations: [destination('lake', { type: 'cribl_lake' })],
    });
    expect(keys(L02, keeps)).toEqual([]);
    expect(keys(L02, inventory({ routes: [route(0, { filter: 'x' }), route(1, { final: false })] }))).toEqual([]);
  });

  it('ignores a devnull catch-all that an earlier Final catch-all makes unreachable', () => {
    const inv = inventory({
      routes: [route(0, { filter: 'x' }), route(1, { output: 'lake' }), route(2, { output: 'default' })],
      destinations: [destination('lake', { type: 'cribl_lake' }), destination('devnull'), destination('default', { type: 'default', defaultId: 'devnull' })],
    });
    expect(keys(L02, inv)).toEqual([]);
  });
});

describe('L03 orphan pipeline', () => {
  it('fires for an unreferenced pipeline', () => {
    expect(keys(L03, inventory({ pipelines: [pipeline('passthru'), pipeline('unused', ['eval'])] }))).toEqual(['L03/pipeline/unused']);
  });

  it('counts chain references and skips built-ins and packs', () => {
    const inv = inventory({
      routes: [route(0, { pipeline: 'outer' })],
      pipelines: [
        pipeline('passthru'),
        pipeline('main'),
        pipeline('pack:some_pack', [], { packId: 'some_pack' }),
        { id: 'outer', functions: [fn('chain', { processor: 'inner' })] },
        pipeline('inner', ['eval']),
      ],
    });
    expect(keys(L03, inv)).toEqual([]);
  });
});

describe('L04 orphan destination', () => {
  it('fires for an unreferenced destination', () => {
    const inv = inventory({ destinations: [destination('devnull'), destination('old', { type: 's3' })] });
    expect(keys(L04, inv)).toEqual(['L04/destination/old']);
  });

  it('respects routers and QuickConnect, and stands down when outputs are dynamic', () => {
    const referenced = inventory({
      sources: [source('qc', { sendToRoutes: false, connections: [{ output: 'qc_out' }] })],
      routes: [route(0, { output: 'router' })],
      destinations: [
        destination('router', { type: 'router', rules: [{ filter: 'true', output: 'lake', final: true }] }),
        destination('lake', { type: 'cribl_lake' }),
        destination('qc_out', { type: 'webhook' }),
      ],
    });
    expect(keys(L04, referenced)).toEqual([]);
    const dynamic = inventory({
      routes: [route(0, { output: undefined, outputExpression: "'x'" })],
      destinations: [destination('old', { type: 's3' })],
    });
    expect(keys(L04, dynamic)).toEqual([]);
  });
});

describe('L05 backpressure drop', () => {
  it('fires only for enabled destinations set to drop', () => {
    const inv = inventory({
      destinations: [
        destination('a', { type: 'splunk', onBackpressure: 'drop' }),
        destination('b', { type: 'splunk', onBackpressure: 'queue' }),
        destination('c', { type: 'splunk', onBackpressure: 'block' }),
        destination('d', { type: 'splunk', onBackpressure: 'drop', disabled: true }),
      ],
    });
    expect(keys(L05, inv)).toEqual(['L05/destination/a']);
  });
});

describe('L06 pipeline does nothing', () => {
  it('fires for empty pipelines and all-disabled ones, ignoring comments', () => {
    const inv = inventory({
      pipelines: [
        pipeline('passthru'),
        pipeline('empty'),
        { id: 'off', functions: [fn('eval', {}, { disabled: true }), fn('comment', {})] },
        { id: 'works', functions: [fn('eval', {})] },
        pipeline('pack:p', [], { packId: 'p' }),
      ],
    });
    expect(keys(L06, inv)).toEqual(['L06/pipeline/empty', 'L06/pipeline/off']);
  });
});

describe('L07 hardcoded secrets', () => {
  const withEval = (name: string, value: string) =>
    inventory({ pipelines: [{ id: 'p', functions: [fn('eval', { add: [{ name, value }] })] }] });

  it('fires on secret-named fields set to a random-looking literal, masking the value', () => {
    const [f] = runRule(L07, withEval('api_key', "'sk9f8a7s6d5f4g3h2j1k'"), buildGraph(withEval('x', 'y')));
    expect(f.key).toBe('L07/pipeline/p/f0');
    expect(f.location).toBe('function 1 (eval) › add[0].value');
    expect(f.evidence).toBe("api_key = 'sk9f••••••••••••'");
    expect(JSON.stringify(f)).not.toContain('sk9f8a7s6d5f4g3h2j1k');
  });

  it('fires on key=value literals and known token formats anywhere in the conf', () => {
    expect(findSecret("'token=FAKE0000blueprint0000demo0000FAKE'")).toBe('FAKE0000blueprint0000demo0000FAKE');
    expect(findSecret("'AKIAABCDEFGHIJKLMNOP'")).toBe('AKIAABCDEFGHIJKLMNOP');
    expect(findSecret('`Bearer abcdefghij0123456789xyz`')).toBe('abcdefghij0123456789xyz');
  });

  it('does not fire on expressions, secret references, or plain words', () => {
    expect(keys(L07, withEval('token', '__e.token'))).toEqual([]);
    expect(keys(L07, withEval('password', "C.Secret('splunk_pw', 'text')"))).toEqual([]);
    expect(keys(L07, withEval('auth_type', "'basic'"))).toEqual([]);
    expect(keys(L07, withEval('token', '`${prefix}abc123def456`'))).toEqual([]);
    expect(findSecret('token=__e.token_value')).toBeUndefined();
  });

  it('masks to at most 4 visible characters', () => {
    expect(mask('abcdefghijklmnopqrstuvwxyz')).toBe('abcd••••••••••••');
    expect(mask('abc')).toBe('••••');
  });
});

describe('L08 leading .*', () => {
  const withRegex = (conf: Record<string, unknown>, extra: Partial<PipelineFunction> = {}) =>
    inventory({ pipelines: [{ id: 'p', functions: [fn('regex_extract', conf, extra)] }] });

  it.each(['/.*user=(?<u>\\w+)/', '/(.*)x/', '/(?:.*?)x/i', '/(?<all>.*)x/'])('fires on %s', (regex) => {
    expect(keys(L08, withRegex({ regex }))).toEqual(['L08/pipeline/p/f0/regex']);
  });

  it('checks regexList and mask rules, skips anchored, mid-pattern, and disabled cases', () => {
    expect(keys(L08, withRegex({ regexList: [{ regex: '/ok/' }, { regex: '/.*bad/' }] }))).toEqual([
      'L08/pipeline/p/f0/regexList[1].regex',
    ]);
    expect(keys(L08, withRegex({ rules: [{ matchRegex: '/.*card=\\d+/' }] }))).toEqual(['L08/pipeline/p/f0/rules[0].matchRegex']);
    expect(keys(L08, withRegex({ regex: '/^.*x/' }))).toEqual([]);
    expect(keys(L08, withRegex({ regex: '/user=.*/' }))).toEqual([]);
    expect(keys(L08, withRegex({ regex: '/.*x/' }, { disabled: true }))).toEqual([]);
  });
});

describe('lint', () => {
  it('finds exactly the seeded problems in the demo group, errors first', () => {
    const inv = normalize(demoRaw());
    const findings = lint(inv, buildGraph(inv));
    expect(findings.map((f) => `${f.ruleId} ${f.object.kind}:${f.object.id}`).sort()).toEqual(
      EXPECTED_FINDINGS.map((e) => `${e.rule} ${e.object}`).sort(),
    );
    expect(findings.map((f) => f.severity)).toEqual(['error', 'error', 'warning', 'warning', 'warning', 'warning', 'info', 'info']);
    expect(findings.find((f) => f.ruleId === 'L01')?.message).toContain('3 routes below it never match: auth_to_splunk, auth_parse, noisy.');
    expect(new Set(findings.map((f) => f.key)).size).toBe(findings.length);
  });

  it('finds nothing in a fresh group', () => {
    const inv = normalize(workspaceCleanRaw);
    expect(inv.routes).toHaveLength(1);
    expect(inv.pipelines.map((p) => p.id).sort()).toEqual([...BUILTIN_PIPELINES].sort());
    expect(lint(inv, buildGraph(inv))).toEqual([]);
  });

  it('is quiet about shipped defaults on the real workspace fixture', () => {
    const inv = normalize(workspaceDefaultRaw);
    const findings = lint(inv, buildGraph(inv));
    expect(findings.map((f) => f.key)).toEqual([
      'L02/route/default',
      'L03/pipeline/checkpoint_import',
      'L03/pipeline/inframetricdigestv2',
      'L03/pipeline/loadbalancer',
      'L03/pipeline/test',
      'L06/pipeline/loadbalancer',
      'L06/pipeline/test',
    ]);
  });
});
