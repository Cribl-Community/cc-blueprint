import { describe, expect, it } from 'vitest';
import { metricQuery, sumRows } from './metrics';

describe('metricQuery', () => {
  it('filters by worker group and sums one metric per split over the window', () => {
    expect(metricQuery('default', 'route.in_events', ['route', 'input'], 0, 3_600_000)).toEqual({
      earliest: 0,
      latest: 3_600_000,
      where: '__worker_group=="default"',
      aggs: { aggregations: ['sum("route.in_events").as("value")'], splitBys: ['route', 'input'], timeWindowSeconds: 3600 },
    });
  });
});

describe('sumRows', () => {
  it('sums the alias per split key across time buckets', () => {
    const rows = [
      { _time: 1, route: 'web', input: 'datagen:gen_web', value: 10 },
      { _time: 2, route: 'web', input: 'datagen:gen_web', value: 5 },
      { _time: 1, route: 'web', input: 'datagen:gen_auth', value: 0 },
    ];
    const out = sumRows(rows, ['route', 'input'], 'value');
    expect(out.get('web\u0000datagen:gen_web')).toBe(15);
    expect(out.get('web\u0000datagen:gen_auth')).toBe(0);
  });

  it('falls back to the first numeric non-dimension field and skips rows missing a split', () => {
    const out = sumRows([{ _time: 1, input: 'a', in_events: 3 }, { _time: 1, in_events: 9 }, 'junk'], ['input'], 'value');
    expect([...out]).toEqual([['a', 3]]);
    expect(sumRows(undefined, ['input'], 'value').size).toBe(0);
  });
});
