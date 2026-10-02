import { describe, expect, it } from 'vitest';
import { constantString, evalFilter } from './filter';

const syslog = { __inputId: 'syslog:in_syslog', cribl_env: 'dev' };

describe('evalFilter', () => {
  it.each([
    ['true', 'yes'],
    ['', 'yes'],
    ['false', 'no'],
    ["__inputId=='syslog:in_syslog'", 'yes'],
    ["__inputId==='cribl:CriblLogs'", 'no'],
    ["__inputId!='cribl:CriblLogs'", 'yes'],
    ["__inputId.startsWith('syslog:')", 'yes'],
    ["__inputId.startsWith('splunk')", 'no'],
    ["!__inputId.startsWith('splunk')", 'yes'],
    ["__inputId.toLowerCase().includes('syslog')", 'yes'],
    ['/^syslog:/.test(__inputId)', 'yes'],
    ["cribl_env=='dev'", 'yes'],
  ] as const)('%s → %s with a known input id', (filter, expected) => {
    expect(evalFilter(filter, syslog)).toBe(expected);
  });

  it('answers maybe when the filter depends on event content', () => {
    expect(evalFilter('host=="megaai"', syslog)).toBe('maybe');
    expect(evalFilter("sourcetype=='noise'", syslog)).toBe('maybe');
    expect(evalFilter("_raw.includes('test')", syslog)).toBe('maybe');
  });

  it('uses Kleene logic: one definite side can decide && and ||', () => {
    expect(evalFilter("__inputId=='cribl:CriblLogs' && host=='x'", syslog)).toBe('no');
    expect(evalFilter("__inputId=='syslog:in_syslog' && host=='x'", syslog)).toBe('maybe');
    expect(evalFilter("__inputId=='syslog:in_syslog' || host=='x'", syslog)).toBe('yes');
    expect(evalFilter("(__inputId=='a:b' || host=='x') && true", syslog)).toBe('maybe');
  });

  it('answers maybe for anything outside the supported subset, never yes or no', () => {
    expect(evalFilter("C.Lookup('x.csv').match(host)", syslog)).toBe('maybe');
    expect(evalFilter('Math.random() > 0.5', syslog)).toBe('maybe');
    expect(evalFilter("__e['host'] == 'x'", syslog)).toBe('maybe');
    expect(evalFilter("__inputId == 'unterminated", syslog)).toBe('maybe');
    expect(evalFilter("__inputId.match(/syslog/)", syslog)).toBe('maybe');
  });

  it('reads regex literals with a / inside a character class', () => {
    expect(evalFilter('/^syslog:[^/]+$/.test(__inputId)', syslog)).toBe('yes');
    expect(evalFilter('/a[/]b/.test(__inputId)', syslog)).toBe('no');
    expect(evalFilter('/[^/]+/.test(uri)', syslog)).toBe('maybe');
  });

  it('never throws, even on patterns it cannot compile', () => {
    for (const f of ['/(/.test(host)', '/a/zz.test(host)', '/[/', ')', '((', "'"]) {
      expect(() => evalFilter(f, syslog)).not.toThrow();
      expect(evalFilter(f, syslog)).toBe('maybe');
    }
  });

  it('does not execute the filter', () => {
    let called = false;
    (globalThis as Record<string, unknown>).__probe = () => (called = true);
    expect(evalFilter('__probe()', syslog)).toBe('maybe');
    expect(called).toBe(false);
    delete (globalThis as Record<string, unknown>).__probe;
  });
});

describe('constantString', () => {
  it('returns the value of a string literal only', () => {
    expect(constantString("'dev'")).toBe('dev');
    expect(constantString('"prod"')).toBe('prod');
    expect(constantString('dev')).toBeUndefined();
    expect(constantString("'a' + 'b'")).toBeUndefined();
  });
});
