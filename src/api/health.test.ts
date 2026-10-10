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

describe('per-node health', () => {
  // Captured shapes: the group summary said Green; the node said Red with an error.
  const node = (health: string, error?: string) => ({
    items: [{ id: 'in_cribl_tcp', type: 'cribl_tcp', status: { health, healthCounts: { [health]: 2 }, ...(error ? { error: { message: error } } : {}) } }],
  });

  it('keeps the worst health across nodes, the error, and which nodes reported it', () => {
    const map = parseHealth('source', node('Green'), undefined, 'node-a');
    parseHealth('source', node('Red', 'failed to parse json (this error is sampled)'), map, 'node-b');
    parseHealth('source', node('Yellow', 'slow'), map, 'node-c');
    expect(map.get('source:in_cribl_tcp')).toEqual({
      health: 'Red',
      counts: { Green: 2, Red: 2, Yellow: 2 },
      error: 'failed to parse json (this error is sampled)',
      nodes: ['node-b', 'node-c'],
    });
  });
});
