// Phase 0 discovery tool (dev builds only). Pulls raw config for one Worker Group so it can be
// sanitized into test fixtures, and probes KV store behavior the docs leave unspecified.
// Removed before 1.0.0 — see DECISIONS.md.
import { metricQuery } from '../api/metrics';
import { useEffect, useState } from 'react';
import { Button, Text } from '@capra/core';

const CONFIG_ENDPOINTS = ['routes', 'pipelines', 'system/inputs', 'system/outputs', 'packs'];
const KV_PREFIX = 'phase0-probe';

type Log = (line: string) => void;

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${window.CRIBL_API_URL}${path}`);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep raw text
  }
  return { status: res.status, body };
}

function download(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function dumpGroup(group: string, log: Log) {
  const out: Record<string, unknown> = { group, capturedAt: new Date().toISOString() };
  out['system/info'] = await getJson('/system/info');
  for (const ep of CONFIG_ENDPOINTS) {
    const r = await getJson(`/m/${encodeURIComponent(group)}/${ep}`);
    log(`GET /m/${group}/${ep} -> ${r.status}`);
    out[ep] = r;
  }
  download(`blueprint-raw-${group}.json`, out);
  log(`Downloaded blueprint-raw-${group}.json`);
}

async function postJson(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${window.CRIBL_API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

/**
 * Captures the exact metric queries the throughput feature runs, raw, so the response shape can be
 * checked. Earlier probes: metrics are leader-level; relative `earliest` strings matched nothing.
 */
async function probeLive(group: string, log: Log) {
  const now = Date.now();
  const out: Record<string, unknown> = { group, capturedAt: new Date(now).toISOString() };
  for (const [metric, splitBys] of [
    ['total.in_events', ['input']],
    ['total.out_events', ['output']],
    ['route.in_events', ['route', 'input']],
  ] as const) {
    const body = metricQuery(group, metric, [...splitBys], now - 3600_000, now);
    const r = await postJson('/system/metrics/query', body);
    log(`${metric} by ${splitBys.join(', ')} -> ${r.status}`);
    out[`${metric} by ${splitBys.join(', ')}`] = { request: body, response: r };
  }
  download(`blueprint-live-${group}.json`, out);
  log(`Downloaded blueprint-live-${group}.json`);
}

async function kvStatus(method: string, key: string, body?: string, contentType = 'text/plain') {
  const res = await fetch(`${window.CRIBL_API_URL}/kvstore/${key}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': contentType },
    body,
  });
  return { status: res.status, text: await res.text() };
}

async function probeKv(log: Log) {
  const results: Record<string, unknown> = {};
  const record = (name: string, value: unknown) => {
    results[name] = value;
    log(`${name}: ${JSON.stringify(value).slice(0, 160)}`);
  };

  // Key separators: plan used ':'; Config Quest reports ':' breaks routing.
  for (const key of [`${KV_PREFIX}/slash/key`, `${KV_PREFIX}.dot.key`, `${KV_PREFIX}:colon:key`]) {
    const put = await kvStatus('PUT', key, 'x');
    const get = await kvStatus('GET', key);
    record(`key "${key}"`, { put: put.status, get: get.status, value: get.text });
  }

  // Value shape: does GET return the raw string or a {value} wrapper?
  const json = JSON.stringify({ a: 1, nested: { b: [1, 2] } });
  await kvStatus('PUT', `${KV_PREFIX}/json-text`, json);
  record('json as text/plain round-trip', await kvStatus('GET', `${KV_PREFIX}/json-text`));
  const put = await kvStatus('PUT', `${KV_PREFIX}/json-app`, json, 'application/json');
  record('json as application/json', { put: put.status, get: await kvStatus('GET', `${KV_PREFIX}/json-app`) });

  // Size ceiling.
  for (const kb of [50, 80, 95, 100, 128, 256, 1024]) {
    const r = await kvStatus('PUT', `${KV_PREFIX}/size-${kb}`, 'x'.repeat(kb * 1024));
    record(`PUT ${kb} KB`, r.status);
  }

  // Prefix listing.
  const list = await fetch(`${window.CRIBL_API_URL}/kvstore/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: `${KV_PREFIX}/` }),
  });
  record('POST /kvstore/keys', { status: list.status, body: await list.text() });

  // Clipboard (plan fallback for Markdown export).
  try {
    await navigator.clipboard.writeText('blueprint clipboard probe');
    record('clipboard.writeText', 'ok');
  } catch (e) {
    record('clipboard.writeText', `rejected: ${String(e)}`);
  }

  download('blueprint-kv-probe.json', results);
}

async function cleanupKv(log: Log) {
  const list = await fetch(`${window.CRIBL_API_URL}/kvstore/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: KV_PREFIX }),
  });
  const text = await list.text();
  let keys: string[] = [];
  try {
    const parsed = JSON.parse(text);
    keys = Array.isArray(parsed) ? parsed : (parsed.items ?? parsed.keys ?? []);
  } catch {
    log(`Could not parse key list: ${text.slice(0, 200)}`);
  }
  for (const key of keys) {
    const r = await kvStatus('DELETE', typeof key === 'string' ? key : String((key as { id?: string }).id));
    log(`DELETE ${key} -> ${r.status}`);
  }
}

export default function Phase0Probe() {
  const [groups, setGroups] = useState<string[]>([]);
  const [group, setGroup] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const log: Log = (line) => setLines((prev) => [...prev, line]);

  useEffect(() => {
    getJson('/master/groups').then((r) => {
      log(`GET /master/groups -> ${r.status}`);
      const items = (r.body as { items?: { id: string }[] })?.items ?? [];
      setGroups(items.map((g) => g.id));
      if (items[0]) setGroup(items[0].id);
    });
  }, []);

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      log(`ERROR: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Inline two-step confirm: window.confirm may be blocked by the iframe sandbox.
  const confirmCleanup = () => {
    if (!armed) return setArmed(true);
    setArmed(false);
    void run(() => cleanupKv(log))();
  };

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
      <Text as="h1" variant="heading">Blueprint — Phase 0 probe (dev only)</Text>
      <label>
        <Text>Worker Group: </Text>
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          {groups.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" disabled={!group || busy} onClick={run(() => dumpGroup(group, log))}>
          Download raw config
        </Button>
        <Button disabled={!group || busy} onClick={run(() => probeLive(group, log))}>
          Probe live status and metrics
        </Button>
        <Button disabled={busy} onClick={run(() => probeKv(log))}>
          Run KV probe
        </Button>
        <Button appearance="danger" disabled={busy} onClick={confirmCleanup}>
          {armed ? `Confirm: delete all "${KV_PREFIX}*" keys (cannot be undone)` : 'Delete probe keys'}
        </Button>
        {armed && <Button onClick={() => setArmed(false)}>Cancel</Button>}
      </div>
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{lines.join('\n')}</pre>
    </div>
  );
}
