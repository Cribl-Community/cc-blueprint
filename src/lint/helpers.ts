// Small pure helpers shared by rules.
import type { Pipeline, PipelineFunction, Route } from '../model/types';

/**
 * True when a route filter matches every event. Deliberately literal: `true`, `!false`, `1`,
 * or empty, optionally wrapped in parentheses. Anything cleverer is not flagged.
 */
export function isCatchAll(filter: string): boolean {
  let f = filter.trim();
  while (f.startsWith('(') && f.endsWith(')')) f = f.slice(1, -1).trim();
  return f === '' || f === 'true' || f === '!false' || f === '1';
}

export const isActive = (r: Route) => !r.disabled;

/** Enabled routes above the first Final catch-all; routes below it are L01's to report. */
export function routesAboveCatchAll(routes: Route[]): Route[] {
  const active = routes.filter(isActive);
  const catchAll = active.find((r) => r.final && isCatchAll(r.filter));
  return active.filter((r) => !catchAll || r.index < catchAll.index);
}

/** `a, b, c and 2 more` */
export function listNames(names: string[], max = 5): string {
  const more = names.length > max ? ` and ${names.length - max} more` : '';
  return names.slice(0, max).join(', ') + more;
}

/** `2 "catch_all"`, a route as messages refer to it. */
export const routeLabel = (r: Route) => `${r.index + 1} "${r.name}"`;

/** Pipelines that are real (not pack references). */
export const realPipelines = (pipelines: Pipeline[]) => pipelines.filter((p) => !p.packId);

/** Functions that do work: enabled and not a Comment. */
export const workingFunctions = (p: Pipeline) => p.functions.filter((f) => !f.disabled && f.id !== 'comment');

export const functionLabel = (index: number, fn: PipelineFunction) => `function ${index + 1} (${fn.id})`;

/** Visits every string inside a function's conf with a readable path like `add[0].value`. */
export function walkStrings(value: unknown, visit: (path: string, key: string, s: string) => void, path = '', key = '') {
  if (typeof value === 'string') {
    visit(path, key, value);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, visit, `${path}[${i}]`, key));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walkStrings(v, visit, path ? `${path}.${k}` : k, k);
  }
}

/** Parses a Cribl regex literal `/body/flags`; plain strings are treated as the body. */
export function regexBody(s: string): string {
  const m = /^\/(.*)\/[a-z]*$/s.exec(s.trim());
  return m ? m[1] : s.trim();
}
