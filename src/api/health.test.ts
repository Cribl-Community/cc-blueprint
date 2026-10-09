import { describe, expect, it } from 'vitest';
import { parseHealth } from './health';

// Shapes captured from a Cribl.Cloud 4.20 workspace (`?metrics=true` adds type-specific metrics we ignore).
const inputs = {
  count: 2,
  items: [
    { id: 'gen_web', type: 'datagen', status: { timestamp: 1, health: 'Green', healthCounts: { Green: 1 }, metrics: { eventCount: 5 } } },
    {
      id: 'in_syslog',
      type: 'syslog',
      status: { health: 'Red', healthCounts: { Red: 1, Green: 1 }, error: { message: 'EADDRINUSE' } },
    },
  ],
};

describe('parseHealth', () => {
  it('keys status by node key and keeps health, counts, and the error message', () => {
    const map = parseHealth('destination', { items: [{ id: 'devnull', status: { health: 'Green', healthCounts: { Green: 1 } } }] }, parseHealth('source', inputs));
    expect(map.get('source:gen_web')).toEqual({ health: 'Green', counts: { Green: 1 }, error: undefined });
    expect(map.get('source:in_syslog')).toEqual({ health: 'Red', counts: { Red: 1, Green: 1 }, error: 'EADDRINUSE' });
    expect(map.get('destination:devnull')?.health).toBe('Green');
  });

  it('treats unexpected values as Unknown and skips items without an id or status', () => {
    const map = parseHealth('source', { items: [{ id: 'a', status: { health: 'Purple' } }, { id: 'b' }, { status: { health: 'Red' } }] });
    expect(map.get('source:a')?.health).toBe('Unknown');
    expect(map.size).toBe(1);
  });
});
