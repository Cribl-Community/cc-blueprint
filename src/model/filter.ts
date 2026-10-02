// Static analysis of Route filter expressions. Answers "can events from this Source match this
// filter?" with three values: yes, no, or maybe (it depends on event content). Filters are parsed
// with a small recursive-descent parser and never executed. Anything outside the supported subset
// makes the whole filter "maybe", so the analyzer can be incomplete but never claims a wrong yes/no.
//
// Supported: string/number/boolean/null/regex literals, field names (`host`, `__inputId`, `a.b`),
// parentheses, `!`, `&&`, `||`, `==`, `===`, `!=`, `!==`, and the string methods startsWith,
// endsWith, includes, toLowerCase, toUpperCase, plus regex `.test(...)`.

export type Tri = 'yes' | 'maybe' | 'no';

/** Field values known for every event from one Source; any other field is unknown. */
export type KnownFields = Record<string, string>;

type Value = { known: true; v: unknown } | { known: false };
const UNKNOWN: Value = { known: false };
const known = (v: unknown): Value => ({ known: true, v });

type Node =
  | { t: 'lit'; v: unknown }
  | { t: 'field'; name: string }
  | { t: 'not'; e: Node }
  | { t: 'and' | 'or'; a: Node; b: Node }
  | { t: 'eq'; neg: boolean; strict: boolean; a: Node; b: Node }
  | { t: 'call'; target: Node; method: string; args: Node[] };

class Unsupported extends Error {}

type Tok =
  | { k: 'str'; v: string }
  | { k: 'num'; v: number }
  | { k: 're'; v: RegExp }
  | { k: 'id'; v: string }
  | { k: 'op'; v: string };

const OPS = ['===', '!==', '==', '!=', '&&', '||', '!', '(', ')', '.', ','];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  // A `/` starts a regex literal only where an operand is expected.
  const operandExpected = () => {
    const last = toks[toks.length - 1];
    return !last || (last.k === 'op' && last.v !== ')');
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "'" || c === '"') {
      let s = '';
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') i++;
        s += src[i++] ?? '';
      }
      if (i >= src.length) throw new Unsupported('unterminated string');
      i++;
      toks.push({ k: 'str', v: s });
    } else if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!;
      toks.push({ k: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))!;
      toks.push({ k: 'id', v: m[0] });
      i += m[0].length;
    } else if (c === '/' && operandExpected()) {
      // Body: escapes, character classes (which may contain an unescaped `/`), or any other char.
      const m = /^\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/([dgimsuy]*)/.exec(src.slice(i));
      if (!m) throw new Unsupported('bad regex');
      toks.push({ k: 're', v: new RegExp(m[1], m[2].replace(/[gy]/g, '')) });
      i += m[0].length;
    } else {
      const op = OPS.find((o) => src.startsWith(o, i));
      if (!op) throw new Unsupported(`unsupported character ${c}`);
      toks.push({ k: 'op', v: op });
      i += op.length;
    }
  }
  return toks;
}

function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peekOp = (v: string) => toks[p]?.k === 'op' && toks[p].v === v;
  const expectOp = (v: string) => {
    if (!peekOp(v)) throw new Unsupported(`expected ${v}`);
    p++;
  };

  const or = (): Node => {
    let a = and();
    while (peekOp('||')) {
      p++;
      a = { t: 'or', a, b: and() };
    }
    return a;
  };
  const and = (): Node => {
    let a = equality();
    while (peekOp('&&')) {
      p++;
      a = { t: 'and', a, b: equality() };
    }
    return a;
  };
  const equality = (): Node => {
    let a = unary();
    for (;;) {
      const op = ['===', '!==', '==', '!='].find(peekOp);
      if (!op) return a;
      p++;
      a = { t: 'eq', neg: op.startsWith('!'), strict: op.length === 3, a, b: unary() };
    }
  };
  const unary = (): Node => {
    if (peekOp('!')) {
      p++;
      return { t: 'not', e: unary() };
    }
    return postfix();
  };
  const postfix = (): Node => {
    let e = primary();
    while (peekOp('.')) {
      p++;
      const name = toks[p];
      if (name?.k !== 'id') throw new Unsupported('expected name after .');
      p++;
      if (peekOp('(')) {
        p++;
        const args: Node[] = [];
        if (!peekOp(')')) {
          args.push(or());
          while (peekOp(',')) {
            p++;
            args.push(or());
          }
        }
        expectOp(')');
        e = { t: 'call', target: e, method: name.v, args };
      } else if (e.t === 'field') {
        e = { t: 'field', name: `${e.name}.${name.v}` };
      } else {
        throw new Unsupported('property access on a non-field');
      }
    }
    return e;
  };
  const primary = (): Node => {
    const tok = toks[p++];
    if (!tok) throw new Unsupported('unexpected end');
    switch (tok.k) {
      case 'str':
      case 'num':
      case 're':
        return { t: 'lit', v: tok.v };
      case 'id':
        if (tok.v === 'true') return { t: 'lit', v: true };
        if (tok.v === 'false') return { t: 'lit', v: false };
        if (tok.v === 'null') return { t: 'lit', v: null };
        if (tok.v === 'undefined') return { t: 'lit', v: undefined };
        return { t: 'field', name: tok.v };
      case 'op':
        if (tok.v === '(') {
          const e = or();
          expectOp(')');
          return e;
        }
        throw new Unsupported(`unexpected ${tok.v}`);
    }
  };

  const node = or();
  if (p !== toks.length) throw new Unsupported('trailing tokens');
  return node;
}

const truth = (v: Value): Tri => (!v.known ? 'maybe' : v.v ? 'yes' : 'no');
const fromTri = (t: Tri): Value => (t === 'maybe' ? UNKNOWN : known(t === 'yes'));

const STRING_METHODS: Record<string, (s: string, args: unknown[]) => unknown> = {
  startsWith: (s, [a]) => s.startsWith(String(a)),
  endsWith: (s, [a]) => s.endsWith(String(a)),
  includes: (s, [a]) => s.includes(String(a)),
  toLowerCase: (s) => s.toLowerCase(),
  toUpperCase: (s) => s.toUpperCase(),
};

function evaluate(n: Node, fields: KnownFields): Value {
  switch (n.t) {
    case 'lit':
      return known(n.v);
    case 'field':
      return Object.hasOwn(fields, n.name) ? known(fields[n.name]) : UNKNOWN;
    case 'not': {
      const t = truth(evaluate(n.e, fields));
      return t === 'maybe' ? UNKNOWN : known(t === 'no');
    }
    case 'and': {
      // Kleene logic: one definite "no" decides an AND even when the other side is unknown.
      const a = truth(evaluate(n.a, fields));
      const b = truth(evaluate(n.b, fields));
      return fromTri(a === 'no' || b === 'no' ? 'no' : a === 'yes' && b === 'yes' ? 'yes' : 'maybe');
    }
    case 'or': {
      const a = truth(evaluate(n.a, fields));
      const b = truth(evaluate(n.b, fields));
      return fromTri(a === 'yes' || b === 'yes' ? 'yes' : a === 'no' && b === 'no' ? 'no' : 'maybe');
    }
    case 'eq': {
      const a = evaluate(n.a, fields);
      const b = evaluate(n.b, fields);
      if (!a.known || !b.known) return UNKNOWN;
      // Operands are primitives here, so loose equality is safe to apply directly.
      const same = n.strict ? a.v === b.v : a.v == b.v;
      return known(n.neg ? !same : same);
    }
    case 'call': {
      const target = evaluate(n.target, fields);
      const args = n.args.map((a) => evaluate(a, fields));
      if (!target.known || args.some((a) => !a.known)) return UNKNOWN;
      const argv = args.map((a) => (a as { v: unknown }).v);
      if (target.v instanceof RegExp && n.method === 'test') return known(target.v.test(String(argv[0])));
      const method = STRING_METHODS[n.method];
      if (typeof target.v === 'string' && method) return known(method(target.v, argv));
      return UNKNOWN;
    }
  }
}

/** Can events carrying `fields` match `filter`? Unparseable or unsupported filters are "maybe". */
export function evalFilter(filter: string, fields: KnownFields): Tri {
  // Never throws: this runs while the app renders, so any surprise (an unsupported regex flag, a
  // pattern this engine rejects) degrades to "maybe" instead of taking the page down.
  try {
    return truth(evaluate(parse(filter.trim() === '' ? 'true' : filter), fields));
  } catch {
    return 'maybe';
  }
}

/** The value of a constant expression (a string literal), or undefined if it isn't one. */
export function constantString(expr: string): string | undefined {
  try {
    const node = parse(expr);
    return node.t === 'lit' && typeof node.v === 'string' ? node.v : undefined;
  } catch {
    return undefined;
  }
}
