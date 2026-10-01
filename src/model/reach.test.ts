import { describe, expect, it } from 'vitest';
import { inventory, route, source } from '../../test/inventory';
import { buildGraph } from './graph';
import { knownFields, routeReach } from './reach';
import { layoutFlow } from '../report/flowLayout';
import { traceHover } from '../report/trace';

const inv = inventory({
  sources: [
    source('gen_auth'),
    source('gen_web'),
    source('relay', { type: 'cribl_http' }),
    source('qc', { sendToRoutes: false, connections: [{ pipeline: 'passthru', output: 'devnull' }] }),
    source('off', { disabled: true }),
  ],
  routes: [
    route(0, { name: 'web', filter: "__inputId=='datagen:gen_web'" }),
    route(1, { name: 'auth_copy', filter: "__inputId=='datagen:gen_auth'", final: false }),
    route(2, { name: 'auth', filter: "__inputId=='datagen:gen_auth'", output: 'devnull' }),
    route(3, { name: 'noisy', filter: "sourcetype=='noise'" }),
    route(4, { name: 'off', disabled: true }),
    route(5, { name: 'default' }),
  ],
});

const states = (id: string) => routeReach(inv).get(id)!.map((r) => r.state);

describe('routeReach', () => {
  it('walks the Routing table per source, stopping at a definite Final match', () => {
    // A non-Final match lets a copy continue; the Final match stops it.
    expect(states('gen_auth')).toEqual(['no', 'yes', 'yes', 'unreached', 'disabled', 'unreached']);
    expect(states('gen_web')).toEqual(['yes', 'unreached', 'unreached', 'unreached', 'disabled', 'unreached']);
    expect(routeReach(inv).get('gen_auth')!.map((r) => r.stops)).toEqual([false, false, true, false, false, false]);
  });

  it("treats a relay source's input id as unknown, so a maybe never stops it", () => {
    expect(states('relay')).toEqual(['maybe', 'maybe', 'maybe', 'maybe', 'disabled', 'yes']);
  });

  it('covers only enabled sources that use the Routing table', () => {
    expect([...routeReach(inv).keys()]).toEqual(['gen_auth', 'gen_web', 'relay']);
  });
});

describe('knownFields', () => {
  it('trusts literal metadata values only when no pre-processing pipeline can rewrite them', () => {
    const metadata = [
      { name: 'cribl_env', value: "'dev'" },
      { name: 'computed', value: 'C.os.hostname()' },
    ];
    expect(knownFields(source('a', { metadata }))).toEqual({ __inputId: 'datagen:a', cribl_env: 'dev' });
    expect(knownFields(source('a', { metadata, pipeline: 'pre' }))).toEqual({ __inputId: 'datagen:a' });
  });
});

describe('traceHover', () => {
  const graph = buildGraph(inv);
  const layout = layoutFlow(inv, graph);
  const reach = routeReach(inv);
  const hover = (key: string) => traceHover(layout.nodes.find((n) => n.key === key)!, graph, reach);

  it('lights only the routes a source can reach', () => {
    const { nodes } = hover('source:gen_auth');
    expect(nodes.get('route:r1')).toBe('yes');
    expect(nodes.get('route:r2')).toBe('yes');
    expect(nodes.has('route:r0')).toBe(false);
    expect(nodes.has('route:r5')).toBe(false);
  });

  it('lights only the sources that can reach a route, dashed where it depends on events', () => {
    const { nodes, flows } = hover('route:r2');
    expect(nodes.get('source:gen_auth')).toBe('yes');
    expect(nodes.get('source:relay')).toBe('maybe');
    expect(nodes.has('source:gen_web')).toBe(false);
    expect(flows.get('bus:relay')).toBe('maybe');
  });

  it('traces a destination back through its routes to the sources that reach them', () => {
    const { nodes } = hover('destination:devnull');
    expect(nodes.get('route:r2')).toBe('yes');
    expect(nodes.get('source:gen_auth')).toBe('yes');
    expect(nodes.get('source:qc')).toBe('yes'); // QuickConnect straight to devnull
  });
});
