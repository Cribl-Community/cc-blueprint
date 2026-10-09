import { describe, expect, it } from 'vitest';
import { parseGroups } from './groups';

describe('parseGroups', () => {
  it('keeps Stream groups and Edge Fleets, Worker Groups first, and drops Search and Outpost groups', () => {
    const groups = parseGroups({
      items: [
        { id: 'default_fleet', type: 'edge' },
        { id: 'default', type: 'stream', workerCount: 2, git: { localChanges: 3 } },
        { id: 'default_search', type: 'search' },
        { id: 'default_outpost', type: 'outpost' },
        { id: 'legacy_fleet', isFleet: true },
        { id: 'legacy_search', isSearch: true },
        { id: 'legacy_stream' },
      ],
    });
    expect(groups.map((g) => `${g.id}:${g.kind}`)).toEqual([
      'default:stream',
      'legacy_stream:stream',
      'default_fleet:fleet',
      'legacy_fleet:fleet',
    ]);
    expect(groups[0]).toEqual({ id: 'default', name: 'default', kind: 'stream', workerCount: 2, localChanges: 3 });
  });

  it('sorts by display name and tolerates an empty response', () => {
    expect(parseGroups({})).toEqual([]);
    const groups = parseGroups({
      items: [
        { id: 'b', name: 'Zulu', type: 'stream' },
        { id: 'a', name: 'Alpha', type: 'stream' },
      ],
    });
    expect(groups.map((g) => g.name)).toEqual(['Alpha', 'Zulu']);
  });
});
