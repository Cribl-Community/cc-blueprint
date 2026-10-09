import { describe, expect, it } from 'vitest';
import { metricQuery, sumRows, windowStart } from './metrics';

describe('metricQuery', () => {
  it('filters by worker group and sums one metric per split over the window', () => {
    expect(metricQuery('default', 'route.in_events', ['route', 'input'], 0, 3_600_000)).toEqual({
      earliest: 0,
      latest: 3_600_000,
      where: '__worker_group=="default"',
      aggs: { aggregations: ['sum("route.in_events").as("value")'], splitBys: ['route', 'input'], timeWindowSeconds: 300 },
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

describe('response handling (shape captured from Cribl.Cloud 4.20)', () => {
  // A 1-hour query over 19:30–20:30 came back as two clock-aligned hours; totals had no split field.
  const captured = [
    { value: 1800, input: 'datagen:gen_auth', starttime: 1791568800, endtime: 1791572400 },
    { value: 1800, starttime: 1791568800, endtime: 1791572400 },
    { value: 1800, input: 'datagen:gen_auth', starttime: 1791572400, endtime: 1791576000 },
    { value: 1800, starttime: 1791572400, endtime: 1791576000 },
  ];

  it('drops total rows and buckets that start before the window', () => {
    expect([...sumRows(captured, ['input'], 'value', 1791572400)]).toEqual([['datagen:gen_auth', 1800]]);
    expect(sumRows(captured, ['input'], 'value').get('datagen:gen_auth')).toBe(3600); // the double count it avoids
  });

  it('aligns the window start down to a 5-minute boundary an hour back', () => {
    const now = Date.UTC(2026, 9, 9, 19, 31, 40);
    expect(new Date(windowStart(now)).toISOString()).toBe('2026-10-09T18:30:00.000Z');
  });
});
