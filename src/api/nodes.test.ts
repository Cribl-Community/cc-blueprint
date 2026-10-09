import { describe, expect, it } from 'vitest';
import { configVersions, parseNodes, unknownObjects } from './nodes';

// Shape of one Edge Node from /master/workers on Cribl.Cloud 4.20, sanitized.
const edgeNode = {
  id: 'node-1',
  status: 'healthy',
  group: 'default_fleet',
  info: {
    hostname: 'edge01.example.com',
    platform: 'linux',
    cpus: 32,
    totalmem: 33566314496,
    os: { id: 'ubuntu', version: '22.04', addresses: ['192.0.2.10'] },
    conn_ip: '198.51.100.7',
    env: { CRIBL_HOME: '/opt/cribl' },
    cribl: { version: '4.20.2-7199aa90', distMode: 'managed-edge', config: { version: '2a8a232' } },
    totalDiskSpace: 200,
    freeDiskSpace: 123,
  },
  workerProcesses: 1,
  lastMsgTime: 1791575736997,
  disconnected: false,
  lastMetrics: {
    'total.in_events': 267,
    'health.inputs': 2,
    'health.inputs:input:system_state:in_system_state': 0,
    'health.inputs:input:file:apache': 0,
    'health.outputs:output:devnull:devnull': 0,
    'health.outputs:output:cribl_tcp:hunger_test': 2,
  },
};

describe('parseNodes', () => {
  it('keeps what an as-built needs and drops addresses and environment', () => {
    const [n] = parseNodes({ items: [edgeNode] });
    expect(n).toEqual({
      id: 'node-1',
      hostname: 'edge01.example.com',
      status: 'healthy',
      connected: true,
      os: 'ubuntu 22.04',
      criblVersion: '4.20.2-7199aa90',
      configVersion: '2a8a232',
      workerProcesses: 1,
      lastSeen: new Date(1791575736997),
      cpus: 32,
      memoryGiB: 31.3,
      diskFreePct: 62,
      reportedObjects: [
        'destination cribl_tcp:hunger_test',
        'destination devnull:devnull',
        'source file:apache',
        'source system_state:in_system_state',
      ],
    });
    expect(JSON.stringify(n)).not.toMatch(/198\.51|192\.0\.2|CRIBL_HOME/);
  });

  it('tolerates sparse nodes', () => {
    const [n] = parseNodes({ items: [{ id: 'x', disconnected: true }] });
    expect(n).toMatchObject({ hostname: 'x', status: 'unknown', connected: false, os: 'unknown', reportedObjects: [] });
  });
});

describe('fleet checks', () => {
  const nodes = parseNodes({
    items: [edgeNode, { ...edgeNode, id: 'n2' }, { ...edgeNode, id: 'n3', info: { ...edgeNode.info, cribl: { config: { version: 'old1' } } } }],
  });

  it('counts config versions, most common first', () => {
    expect(configVersions(nodes)).toEqual([
      ['2a8a232', 2],
      ['old1', 1],
    ]);
  });

  it('lists objects nodes report that the config lacks', () => {
    const known = new Set(['source system_state:in_system_state', 'destination devnull:devnull']);
    expect(unknownObjects(nodes, known)).toEqual(['destination cribl_tcp:hunger_test', 'source file:apache']);
  });
});
