// Suppressions: one KV document per group, `suppress/<group>`, keyed by finding key.
import type { Finding } from '../lint/types';
import { httpKv, kvKey, type KvClient } from './kv';

export interface Suppression {
  reason: string;
  by?: string;
  at: string;
  /** Finding message when suppressed, so stale entries can still be explained. */
  message: string;
}

export interface SuppressionDoc {
  schema: 1;
  items: Record<string, Suppression>;
}

const key = (group: string) => kvKey('suppress', group);
const empty = (): SuppressionDoc => ({ schema: 1, items: {} });

export async function loadSuppressions(group: string, kv: KvClient = httpKv): Promise<SuppressionDoc> {
  const text = await kv.get(key(group));
  if (!text) return empty();
  try {
    const doc = JSON.parse(text) as SuppressionDoc;
    return doc && doc.schema === 1 && doc.items ? doc : empty();
  } catch {
    return empty();
  }
}

/** Read-modify-write, re-reading first so a teammate's concurrent edit isn't lost. */
async function update(group: string, change: (doc: SuppressionDoc) => void, kv: KvClient): Promise<SuppressionDoc> {
  const doc = await loadSuppressions(group, kv);
  change(doc);
  await kv.put(key(group), JSON.stringify(doc));
  return doc;
}

export function suppress(
  group: string,
  finding: Finding,
  reason: string,
  opts: { by?: string; now?: Date; kv?: KvClient } = {},
): Promise<SuppressionDoc> {
  const trimmed = reason.trim();
  if (!trimmed) return Promise.reject(new Error('A reason is required'));
  return update(
    group,
    (doc) => {
      doc.items[finding.key] = {
        reason: trimmed,
        by: opts.by,
        at: (opts.now ?? new Date()).toISOString(),
        message: finding.message,
      };
    },
    opts.kv ?? httpKv,
  );
}

export function unsuppress(group: string, findingKey: string, kv: KvClient = httpKv): Promise<SuppressionDoc> {
  return update(group, (doc) => void delete doc.items[findingKey], kv);
}

/** Splits findings into active and suppressed; also returns suppressions that match nothing now. */
/** `ignoreRules`: rules turned off for the group, whose suppressions aren't stale, just idle. */
export function applySuppressions(findings: Finding[], doc: SuppressionDoc, ignoreRules: Set<string> = new Set()) {
  const active: Finding[] = [];
  const suppressed: { finding: Finding; suppression: Suppression }[] = [];
  for (const f of findings) {
    const s = doc.items[f.key];
    if (s) suppressed.push({ finding: f, suppression: s });
    else active.push(f);
  }
  const live = new Set(findings.map((f) => f.key));
  const stale = Object.entries(doc.items)
    .filter(([k]) => !live.has(k) && !ignoreRules.has(k.split('/')[0]))
    .map(([k, s]) => ({ key: k, suppression: s }));
  return { active, suppressed, stale };
}
