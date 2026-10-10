// Edge → Stream lineage: which Stream Source each Fleet's Cribl TCP/HTTP Destination feeds.
// Works on raw Source/Destination JSON, since normalized config doesn't keep hosts and ports.
//
// A link needs the same transport (cribl_tcp → cribl_tcp, cribl_http → cribl_http) and port. On
// Cribl.Cloud the receiver's hostname starts with the Stream group's id
// (`default.<workspace>.cribl.cloud`), which makes the link certain; a port-only match is
// "possible", the usual case on self-hosted deployments behind a load balancer.

export type Transport = 'cribl_tcp' | 'cribl_http';

export interface Endpoint {
  host: string;
  port: number;
}

export interface LineageLink {
  fleet: string;
  /** Destination id in the Fleet. */
  output: string;
  transport: Transport;
  /** `host:port` the Destination sends to. */
  endpoint: string;
  group: string;
  /** Source id in the Stream group. */
  input: string;
  confidence: 'certain' | 'possible';
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const DEFAULT_PORT: Record<Transport, number> = { cribl_tcp: 10300, cribl_http: 10200 };
const isTransport = (t: unknown): t is Transport => t === 'cribl_tcp' || t === 'cribl_http';

function fromUrl(url: unknown): Endpoint | undefined {
  if (typeof url !== 'string' || !url) return undefined;
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase(), port: u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80 };
  } catch {
    return undefined;
  }
}

function fromHost(host: unknown, port: unknown, fallback: number): Endpoint | undefined {
  if (typeof host !== 'string' || !host) return undefined;
  return { host: host.toLowerCase(), port: typeof port === 'number' ? port : Number(port) || fallback };
}

/** Where a Cribl TCP/HTTP Destination sends, from its single or load-balanced settings. */
export function outputEndpoints(raw: unknown): Endpoint[] {
  const o = obj(raw);
  if (!isTransport(o.type)) return [];
  const fallback = DEFAULT_PORT[o.type];
  const found =
    o.type === 'cribl_http'
      ? [fromUrl(o.url), ...arr(o.urls).map((u) => fromUrl(obj(u).url))]
      : [fromHost(o.host, o.port, fallback), ...arr(o.hosts).map((h) => fromHost(obj(h).host, obj(h).port, fallback))];
  const unique = new Map(found.filter((e): e is Endpoint => !!e).map((e) => [`${e.host}:${e.port}`, e]));
  return [...unique.values()];
}

/** Links from every Fleet's enabled Cribl Destinations to the enabled Stream Sources they reach. */
export function findLinks(
  fleets: { group: string; outputs: unknown[] }[],
  streams: { group: string; inputs: unknown[] }[],
): LineageLink[] {
  const receivers = streams.flatMap(({ group, inputs }) =>
    inputs
      .map(obj)
      .filter((i) => isTransport(i.type) && i.disabled !== true)
      .map((i) => ({ group, input: String(i.id), transport: i.type as Transport, port: Number(i.port) || DEFAULT_PORT[i.type as Transport] })),
  );
  const links: LineageLink[] = [];
  for (const { group: fleet, outputs } of fleets) {
    for (const o of outputs.map(obj).filter((o) => isTransport(o.type) && o.disabled !== true)) {
      for (const e of outputEndpoints(o)) {
        const matches = receivers.filter((r) => r.transport === o.type && r.port === e.port);
        // The Cloud ingress names the group as the first DNS label; prefer those when present.
        const named = matches.filter((r) => e.host.split('.')[0] === r.group.toLowerCase());
        for (const r of named.length ? named : matches) {
          links.push({
            fleet,
            output: String(o.id),
            transport: o.type as Transport,
            endpoint: `${e.host}:${e.port}`,
            group: r.group,
            input: r.input,
            confidence: named.length ? 'certain' : 'possible',
          });
        }
      }
    }
  }
  return links;
}
