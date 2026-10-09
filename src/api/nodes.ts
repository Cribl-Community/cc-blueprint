// Worker and Edge Nodes of a group, from the Leader's node list. Only what an as-built needs is
// kept; network addresses and environment variables are deliberately dropped.
import { apiGet, type ListResponse } from './client';

export interface NodeInfo {
  id: string;
  hostname: string;
  /** Leader-reported status, e.g. `healthy`. */
  status: string;
  connected: boolean;
  /** `ubuntu 22.04`, or the platform when the OS isn't reported. */
  os: string;
  criblVersion?: string;
  /** Config version the node is running. */
  configVersion?: string;
  workerProcesses?: number;
  lastSeen?: Date;
  cpus?: number;
  memoryGiB?: number;
  diskFreePct?: number;
  /** Sources and Destinations the node reports health for, as `source <type>:<id>` / `destination <type>:<id>`. */
  reportedObjects: string[];
}

/** Node list page size. Fleets can have thousands of nodes; the summary count covers the rest. */
export const NODE_LIMIT = 100;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** `health.inputs:input:<type>:<id>` and `health.outputs:output:<type>:<id>` metric keys. */
const HEALTH_KEY = /^health\.(inputs|outputs):(?:input|output):(.+)$/;

export function parseNodes(body: ListResponse<unknown>): NodeInfo[] {
  return (body.items ?? []).map((raw) => {
    const n = obj(raw);
    const info = obj(n.info);
    const cribl = obj(info.cribl);
    const os = obj(info.os);
    const total = num(info.totalDiskSpace);
    const free = num(info.freeDiskSpace);
    const mem = num(info.totalmem);
    const reported = Object.keys(obj(n.lastMetrics)).flatMap((k) => {
      const m = HEALTH_KEY.exec(k);
      return m ? [`${m[1] === 'inputs' ? 'source' : 'destination'} ${m[2]}`] : [];
    });
    const lastMsg = num(n.lastMsgTime);
    return {
      id: String(n.id ?? ''),
      hostname: str(info.hostname) ?? String(n.id ?? 'unknown'),
      status: str(n.status) ?? 'unknown',
      connected: n.disconnected !== true,
      os: [str(os.id), str(os.version)].filter(Boolean).join(' ') || str(info.platform) || 'unknown',
      criblVersion: str(cribl.version),
      configVersion: str(obj(cribl.config).version),
      workerProcesses: num(n.workerProcesses),
      lastSeen: lastMsg ? new Date(lastMsg) : undefined,
      cpus: num(info.cpus),
      memoryGiB: mem ? Math.round((mem / 2 ** 30) * 10) / 10 : undefined,
      diskFreePct: total && free !== undefined ? Math.round((free / total) * 100) : undefined,
      reportedObjects: reported.sort(),
    };
  });
}

export async function fetchNodes(group: string, signal?: AbortSignal): Promise<NodeInfo[]> {
  const filterExp = encodeURIComponent(`group==${JSON.stringify(group)}`);
  return parseNodes(await apiGet<ListResponse<unknown>>(`/master/workers?filterExp=${filterExp}&limit=${NODE_LIMIT}`, signal));
}

/** Config versions in use and how many nodes run each, most common first. */
export function configVersions(nodes: NodeInfo[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const n of nodes) if (n.configVersion) counts.set(n.configVersion, (counts.get(n.configVersion) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Objects nodes report that the group's config doesn't contain, e.g. undeployed or local config. */
export function unknownObjects(nodes: NodeInfo[], known: Set<string>): string[] {
  return [...new Set(nodes.flatMap((n) => n.reportedObjects))].filter((o) => !known.has(o)).sort();
}
