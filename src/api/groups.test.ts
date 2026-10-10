import { describe, expect, it } from 'vitest';
import { fleetTree, parseGroups } from './groups';

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

describe('subfleets', () => {
  it('reads the parent Fleet from `inherits`', () => {
    const [, child] = parseGroups({ items: [{ id: 'all', type: 'edge' }, { id: 'linux', type: 'edge', inherits: 'all' }] });
    expect(child).toMatchObject({ id: 'linux', kind: 'fleet', parent: 'all' });
  });

  it('orders each parent before its subfleets, with depth, tolerating missing parents and cycles', () => {
    const fleets = parseGroups({
      items: [
        { id: 'web', type: 'edge', inherits: 'linux' },
        { id: 'all', type: 'edge' },
        { id: 'linux', type: 'edge', inherits: 'all' },
        { id: 'orphan', type: 'edge', inherits: 'gone' },
        { id: 'a', type: 'edge', inherits: 'b' },
        { id: 'b', type: 'edge', inherits: 'a' },
      ],
    });
    expect(fleetTree(fleets).map(({ group, depth }) => `${'-'.repeat(depth)}${group.id}`)).toEqual([
      'all',
      '-linux',
      '--web',
      'orphan',
      'a',
      'b',
    ]);
  });
});
