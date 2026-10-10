import { describe, expect, it } from 'vitest';
import { findLinks, outputEndpoints } from './lineage';

// Field names from the OutputCriblTcp/OutputCriblHttp and InputCriblTcp/InputCriblHttp schemas;
// Stream ports as in a fresh Cribl.Cloud group (10300 TCP, 10200 HTTP).
const streams = [
  {
    group: 'default',
    inputs: [
      { id: 'in_cribl_tcp', type: 'cribl_tcp', host: '0.0.0.0', port: 10300 },
      { id: 'in_cribl_http', type: 'cribl_http', host: '0.0.0.0', port: 10200 },
      { id: 'in_syslog', type: 'syslog', port: 9514 },
    ],
  },
  { group: 'emea', inputs: [{ id: 'in_cribl_tcp', type: 'cribl_tcp', port: 10300 }] },
];

describe('outputEndpoints', () => {
  it('reads single and load-balanced TCP hosts and HTTP URLs, with default ports', () => {
    expect(outputEndpoints({ type: 'cribl_tcp', host: 'Default.ws1.cribl.cloud', port: 10300 })).toEqual([{ host: 'default.ws1.cribl.cloud', port: 10300 }]);
    expect(outputEndpoints({ type: 'cribl_tcp', loadBalanced: true, hosts: [{ host: 'a.example.com' }, { host: 'b.example.com', port: 9000 }] })).toEqual([
      { host: 'a.example.com', port: 10300 },
      { host: 'b.example.com', port: 9000 },
    ]);
    expect(outputEndpoints({ type: 'cribl_http', url: 'https://default.ws1.cribl.cloud:10200' })).toEqual([{ host: 'default.ws1.cribl.cloud', port: 10200 }]);
    expect(outputEndpoints({ type: 'cribl_http', urls: [{ url: 'http://w1.example.com' }, { url: 'not a url' }] })).toEqual([{ host: 'w1.example.com', port: 80 }]);
    expect(outputEndpoints({ type: 'webhook', url: 'https://x.example.com' })).toEqual([]);
  });
});

describe('findLinks', () => {
  it('is certain when the Cloud hostname names the group, and prefers that group', () => {
    const links = findLinks([{ group: 'default_fleet', outputs: [{ id: 'to_stream', type: 'cribl_tcp', host: 'default.ws1.cribl.cloud', port: 10300 }] }], streams);
    expect(links).toEqual([
      {
        fleet: 'default_fleet',
        output: 'to_stream',
        transport: 'cribl_tcp',
        endpoint: 'default.ws1.cribl.cloud:10300',
        group: 'default',
        input: 'in_cribl_tcp',
        confidence: 'certain',
      },
    ]);
  });

  it('lists every same-port receiver as possible when the host does not name a group', () => {
    const links = findLinks([{ group: 'f', outputs: [{ id: 'lb', type: 'cribl_tcp', host: 'stream-lb.example.com', port: 10300 }] }], streams);
    expect(links.map((l) => `${l.group}/${l.input}:${l.confidence}`)).toEqual(['default/in_cribl_tcp:possible', 'emea/in_cribl_tcp:possible']);
  });

  it('needs the same transport and port, and skips disabled ends', () => {
    expect(findLinks([{ group: 'f', outputs: [{ id: 'h', type: 'cribl_http', url: 'https://default.ws1.cribl.cloud:10300' }] }], streams)).toEqual([]);
    expect(findLinks([{ group: 'f', outputs: [{ id: 'off', type: 'cribl_tcp', host: 'default.x', port: 10300, disabled: true }] }], streams)).toEqual([]);
    const disabledIn = [{ group: 'default', inputs: [{ id: 'in_cribl_tcp', type: 'cribl_tcp', port: 10300, disabled: true }] }];
    expect(findLinks([{ group: 'f', outputs: [{ id: 'o', type: 'cribl_tcp', host: 'default.x', port: 10300 }] }], disabledIn)).toEqual([]);
  });
});
