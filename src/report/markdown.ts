// As-Built view model -> Markdown handoff document. Includes a Mermaid flowchart, which renders
// on GitHub, GitLab, Confluence (with the Mermaid macro), and most Markdown editors.
import type { Flow } from '../model/graph';
import type { Finding } from '../lint/types';
import type { Suppression } from '../store/suppressions';
import { REACH_LEGEND, reachLabel, unreachedRoutes, type AsBuilt } from './asBuilt';

/**
 * Makes a value safe inside a Markdown table cell. Only `|` is escaped: GFM honors `\|` even
 * inside code spans, while other backslash escapes would corrupt code-span content (regexes).
 */
export function cell(value: string | number | boolean): string {
  const s = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '—';
}

/** Wraps a value as inline code, choosing a fence longer than any backtick run inside it. */
export function code(value: string): string {
  if (!value) return '—';
  const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(longest + 1);
  const pad = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${value}${pad}${fence}`;
}

function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return '_None._\n';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n') + '\n';
}

const mermaidLabel = (s: string) => `"${s.replace(/"/g, '#quot;')}"`;

export function mermaid(report: AsBuilt, flows: Flow[]): string {
  const ids = new Map<string, string>();
  const nodeId = (kind: string, key: string) => {
    const k = `${kind}:${key}`;
    if (!ids.has(k)) ids.set(k, `${kind[0]}${ids.size}`);
    return ids.get(k)!;
  };
  const lines = ['flowchart LR'];
  const routed = report.sources.filter((s) => s.enabled && s.mode === 'Routes');
  if (routed.length && report.routes.length) {
    lines.push(`  RT[["Routing table"]]`);
    for (const s of routed) lines.push(`  ${nodeId('s', s.id)}[${mermaidLabel(s.id)}] --> RT`);
  }
  for (const r of report.routes.filter((r) => r.enabled)) {
    lines.push(`  RT --> ${nodeId('r', r.id)}(${mermaidLabel(`${r.position}. ${r.name}`)})`);
  }
  const seen = new Set<string>();
  for (const f of flows.filter((f) => !f.disabled)) {
    const start = f.kind === 'route' ? nodeId('r', f.via) : nodeId('s', f.via);
    const pipe = nodeId('p', f.pipeline);
    const arrow = f.kind === 'quickconnect' ? '-.->' : '-->';
    const first = `  ${start} ${arrow} ${pipe}{{${mermaidLabel(f.pipeline)}}}`;
    if (f.kind === 'quickconnect') lines.push(`  ${start}[${mermaidLabel(f.via)}]`);
    lines.push(first);
    if (f.output) {
      const pair = `${f.pipeline}->${f.output}`;
      if (!seen.has(pair)) {
        seen.add(pair);
        const label = f.resolvedOutput && f.resolvedOutput !== f.output ? `${f.output} → ${f.resolvedOutput}` : f.output;
        lines.push(`  ${pipe} --> ${nodeId('d', f.output)}[(${mermaidLabel(label)})]`);
      }
    }
  }
  return lines.join('\n');
}

const SEVERITY_LABEL = { error: 'Error', warning: 'Warning', info: 'Info' } as const;

export interface SuppressedFinding {
  finding: Finding;
  suppression: Suppression;
}

function suppressedSection(items: SuppressedFinding[]): string[] {
  if (!items.length) return [];
  return [
    '### Suppressed findings',
    '',
    'Reviewed and accepted. Kept here so the decision is part of the record.',
    '',
    table(
      ['Rule', 'Object', 'Reason', 'By', 'When'],
      items.map(({ finding: f, suppression: s }) => [
        f.ruleId,
        cell(`${f.object.kind} ${f.object.name ?? f.object.id}`),
        cell(s.reason),
        cell(s.by ?? '—'),
        s.at.slice(0, 10),
      ]),
    ),
  ];
}

function findingsSection(findings: Finding[], suppressed: SuppressedFinding[]): string[] {
  const out = ['## Findings', ''];
  if (!findings.length) {
    return [...out, `_No open findings: all lint rules passed${suppressed.length ? ' or were suppressed' : ''}._`, '', ...suppressedSection(suppressed)];
  }
  const count = (sev: Finding['severity']) => findings.filter((f) => f.severity === sev).length;
  const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;
  out.push(`${n(count('error'), 'error')}, ${n(count('warning'), 'warning')}, ${count('info')} info. Secrets are masked.`, '');
  out.push(
    table(
      ['Severity', 'Rule', 'Object', 'Finding', 'Fix'],
      findings.map((f) => [
        SEVERITY_LABEL[f.severity],
        f.ruleId,
        cell(`${f.object.kind} ${f.object.name ?? f.object.id}`),
        cell(f.message + (f.evidence ? ` (${f.evidence})` : '')),
        cell(f.fix),
      ]),
    ),
  );
  return [...out, ...suppressedSection(suppressed)];
}

function reachSection(report: AsBuilt): string[] {
  const m = report.reach;
  if (!m.rows.length || !m.routes.length) return [];
  const out = ['## Source × Route reach', ''];
  out.push(
    'Which Routes each Source\'s events can reach, read from the Route filters (never executed). ' +
      'Only the input id and literal Source fields are known, so filters on event content show as "?".',
  );
  out.push('');
  out.push(
    table(
      ['Source', ...m.routes.map((r) => cell(r.label))],
      m.rows.map((row) => [cell(row.sourceId), ...row.cells.map((c) => reachLabel(c))]),
    ),
  );
  out.push(REACH_LEGEND);
  out.push('');
  const unreached = unreachedRoutes(m);
  if (unreached.length) {
    out.push(`**No Source reaches:** ${unreached.map((r) => cell(r.label)).join(', ')}`);
    out.push('');
  }
  if (m.quickConnect.length) {
    out.push(`QuickConnect Sources bypass the Routing table: ${m.quickConnect.map(cell).join(', ')}.`);
    out.push('');
  }
  return out;
}

export function toMarkdown(
  report: AsBuilt,
  flows: Flow[],
  generatedAt: Date,
  findings?: Finding[],
  suppressed: SuppressedFinding[] = [],
): string {
  const s = report.summary;
  const out: string[] = [];
  out.push(`# As-Built: ${report.group}`);
  out.push('');
  out.push(
    `Generated ${generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC by Cribl Blueprint` +
      (report.criblVersion ? ` · Cribl ${report.criblVersion}` : ''),
  );
  out.push('');
  out.push('## Summary');
  out.push('');
  out.push(
    table(
      ['Object', 'Count'],
      [
        ['Sources', `${s.sources.enabled} enabled of ${s.sources.total}${s.sources.quickConnect ? ` (${s.sources.quickConnect} QuickConnect)` : ''}`],
        ['Routes', `${s.routes.enabled} enabled of ${s.routes.total}`],
        ['Pipelines', String(s.pipelines)],
        ['Destinations', String(s.destinations)],
        ['Packs', String(s.packs)],
      ],
    ),
  );
  if (findings) out.push(...findingsSection(findings, suppressed));
  out.push('## Data flow');
  out.push('');
  out.push('Solid arrows go through the Routing table; dotted arrows are QuickConnect. Disabled objects are omitted.');
  out.push('');
  out.push('```mermaid');
  out.push(mermaid(report, flows));
  out.push('```');
  out.push('');
  out.push('## Routes');
  out.push('');
  out.push('Evaluated top to bottom. A Final route stops evaluation for the events it matches.');
  out.push('');
  out.push(
    table(
      ['#', 'Name', 'Filter', 'Pipeline', 'Destination', 'Final', 'Enabled'],
      report.routes.map((r) => [
        String(r.position),
        cell(r.name),
        cell(code(r.filter)),
        cell(r.pipeline),
        cell(r.output),
        cell(r.final),
        cell(r.enabled),
      ]),
    ),
  );
  out.push(...reachSection(report));
  out.push('## Sources');
  out.push('');
  out.push(
    table(
      ['ID', 'Type', 'Mode', 'Pre-processing', 'Enabled'],
      report.sources.map((r) => [cell(r.id), cell(r.type), r.mode, cell(r.preProcessing), cell(r.enabled)]),
    ),
  );
  out.push('## Pipelines');
  out.push('');
  out.push(
    table(
      ['ID', 'Functions', 'Disabled functions', 'Used by'],
      report.pipelines.map((r) => [cell(r.id), String(r.functions), String(r.disabledFunctions), cell(r.usedBy)]),
    ),
  );
  out.push('## Destinations');
  out.push('');
  out.push(
    table(
      ['ID', 'Type', 'Backpressure', 'Post-processing', 'Used by'],
      report.destinations.map((r) => [cell(r.id), cell(r.type), cell(r.backpressure), cell(r.postProcessing), cell(r.usedBy)]),
    ),
  );
  out.push('## Packs');
  out.push('');
  out.push(table(['ID', 'Name', 'Version'], report.packs.map((r) => [cell(r.id), cell(r.name), cell(r.version)])));
  return out.join('\n');
}
