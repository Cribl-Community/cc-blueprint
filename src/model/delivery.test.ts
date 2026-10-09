import { describe, expect, it } from 'vitest';
import { destination, inventory, route, source } from '../../test/inventory';
import { deliveries, EXPRESSION_OUTPUT } from './delivery';

const router = destination('router1', {
  type: 'router',
  rules: [
    { filter: "__inputId=='datagen:gen_a'", output: 'lake', final: true },
    { filter: "env=='prod'", output: 'archive', final: false },
    { filter: 'true', output: 'default', final: true },
  ],
});
const destinations = [
  destination('devnull'),
  destination('default', { type: 'default', defaultId: 'devnull' }),
  destination('lake'),
  destination('archive'),
  router,
];
const tagged = { metadata: [{ name: 'env', value: "'prod'" }] };

const summary = (inv: Parameters<typeof deliveries>[0]) =>
  Object.fromEntries(
    [...deliveries(inv)].map(([id, ds]) => [id, ds.map((d) => `${d.destinationId}:${d.strength}`).sort()]),
  );

describe('deliveries', () => {
  it('follows routes through Output Router rules and the default alias', () => {
    const inv = inventory({
      sources: [source('gen_a'), source('gen_b', tagged)],
      routes: [route(0, { output: 'router1' })],
      destinations,
    });
    expect(summary(inv)).toEqual({
      gen_a: ['lake:yes'], // first rule is Final and matches
      gen_b: ['archive:yes', 'devnull:yes'], // non-Final rule copies, then the catch-all via default → devnull
    });
    expect(deliveries(inv).get('gen_a')![0].via).toEqual(['route route0', 'router router1']);
  });

  it('includes QuickConnect sources, and stops trusting metadata after a real pipeline', () => {
    const inv = inventory({
      sources: [
        source('qc', { ...tagged, sendToRoutes: false, connections: [{ pipeline: 'passthru', output: 'router1' }] }),
        source('qc_piped', { ...tagged, sendToRoutes: false, connections: [{ pipeline: 'enrich', output: 'router1' }] }),
      ],
      destinations,
    });
    expect(summary(inv)).toEqual({
      qc: ['archive:yes', 'devnull:yes'],
      qc_piped: ['archive:maybe', 'devnull:yes'], // `env` may have been rewritten by the pipeline
    });
  });

  it('marks output expressions, maybe-routes, and sources that reach nothing', () => {
    const inv = inventory({
      sources: [source('gen_a'), source('gen_b'), source('off', { disabled: true })],
      routes: [
        route(0, { filter: "host=='x'", output: undefined, outputExpression: "'lake'", final: false }),
        route(1, { filter: "__inputId=='datagen:gen_a'", output: 'lake' }),
      ],
      destinations,
    });
    expect(summary(inv)).toEqual({
      gen_a: [`${EXPRESSION_OUTPUT}:maybe`, 'lake:yes'],
      gen_b: [`${EXPRESSION_OUTPUT}:maybe`],
    });
  });
});
