// Lossless JSON parser/serializer.
//
// Vampire Crawlers saves are written by Newtonsoft.Json (.NET). The checksum is
// computed over the re-serialized text, so we must reproduce .NET formatting
// exactly. JSON.parse/stringify can't do that (e.g. `2400.0` becomes `2400`).
//
// Model:
//   object  -> Map<string, Value>   (keeps key order, even for numeric-like keys)
//   array   -> Value[]
//   number  -> JsonNumber           (keeps the original literal text)
//   string / boolean / null -> native JS values

/** A JSON number that remembers its exact textual representation. */
export class JsonNumber {
  /** @param {string} raw literal text as it appears in JSON */
  constructor(raw) {
    if (!/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) {
      throw new Error(`Invalid JSON number literal: ${raw}`);
    }
    /** @readonly */
    this.raw = raw;
  }

  /** Numeric value (may lose precision for huge integers). */
  get value() {
    return Number(this.raw);
  }

  /** True if the literal is written as a floating point number (.NET float/double). */
  get isFloat() {
    return /[.eE]/.test(this.raw);
  }

  /** Create an integer literal (.NET int/long). */
  static int(n) {
    const v = typeof n === 'bigint' ? n : BigInt(Math.trunc(Number(n)));
    return new JsonNumber(v.toString());
  }

  /** Create a double literal formatted like .NET/Newtonsoft (always has `.0` or exponent). */
  static double(n) {
    return new JsonNumber(formatNetFloat(String(Number(n))));
  }

  /** Create a float (System.Single) literal: shortest text that round-trips as float32. */
  static float32(n) {
    const f = Math.fround(Number(n));
    let text = String(f);
    for (let p = 1; p <= 9; p++) {
      const candidate = f.toPrecision(p);
      if (Math.fround(Number(candidate)) === f) {
        text = String(Number(candidate));
        break;
      }
    }
    return new JsonNumber(formatNetFloat(text));
  }

  /**
   * New literal of the same kind (int vs. float) as this one.
   * @param {number} n
   */
  withValue(n) {
    return this.isFloat ? JsonNumber.float32OrDouble(this, n) : JsonNumber.int(n);
  }

  /** @private */
  static float32OrDouble(prev, n) {
    // Unity mostly uses float (single); if the old literal needed more digits than
    // float32 provides, treat it as double.
    const digits = prev.raw.replace(/^-/, '').replace(/[eE].*$/, '').replace('.', '').replace(/^0+/, '');
    return digits.length > 9 ? JsonNumber.double(n) : JsonNumber.float32(n);
  }

  toString() {
    return this.raw;
  }
}

/** Convert JS number text into .NET "R" style: `1` -> `1.0`, `1e+21` -> `1E+21`. */
function formatNetFloat(text) {
  if (text === 'NaN' || text === 'Infinity' || text === '-Infinity') {
    throw new Error(`Cannot write ${text} into a save file`);
  }
  if (/e/.test(text)) {
    const [mant, exp] = text.split('e');
    const sign = exp.startsWith('-') ? '-' : '+';
    const digits = exp.replace(/^[+-]/, '').padStart(2, '0');
    return `${mant}E${sign}${digits}`;
  }
  return text.includes('.') ? text : `${text}.0`;
}

// ---------------------------------------------------------------- parser

/**
 * Parse JSON text into the lossless model.
 * @param {string} text
 * @returns {any}
 */
export function parse(text) {
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // tolerate BOM

  const fail = (msg) => {
    const line = text.slice(0, i).split('\n').length;
    throw new SyntaxError(`${msg} at line ${line} (offset ${i})`);
  };
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };

  function value() {
    ws();
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    if (text.startsWith('null', i)) { i += 4; return null; }
    return fail(`Unexpected ${c === undefined ? 'end of input' : `character '${c}'`}`);
  }

  function object() {
    i++; // {
    const map = new Map();
    ws();
    if (text[i] === '}') { i++; return map; }
    for (;;) {
      ws();
      if (text[i] !== '"') fail('Expected property name');
      const key = string();
      ws();
      if (text[i] !== ':') fail("Expected ':'");
      i++;
      if (map.has(key)) fail(`Duplicate key "${key}"`);
      map.set(key, value());
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '}') { i++; return map; }
      fail("Expected ',' or '}'");
    }
  }

  function array() {
    i++; // [
    const arr = [];
    ws();
    if (text[i] === ']') { i++; return arr; }
    for (;;) {
      arr.push(value());
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ']') { i++; return arr; }
      fail("Expected ',' or ']'");
    }
  }

  function string() {
    i++; // opening quote
    let out = '';
    for (;;) {
      const c = text[i++];
      if (c === undefined) fail('Unterminated string');
      if (c === '"') return out;
      if (c !== '\\') { out += c; continue; }
      const e = text[i++];
      switch (e) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u': {
          const hex = text.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid \\u escape');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
          break;
        }
        default: fail(`Invalid escape \\${e}`);
      }
    }
  }

  function number() {
    const m = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
    m.lastIndex = i;
    const r = m.exec(text);
    if (!r) fail('Invalid number');
    i = m.lastIndex;
    return new JsonNumber(r[0]);
  }

  const result = value();
  ws();
  if (i !== text.length) fail('Unexpected trailing content');
  return result;
}

// ---------------------------------------------------------------- serializer

/** Escape a string the way Newtonsoft.Json does by default. */
export function quote(s) {
  let out = '"';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    switch (ch) {
      case '"': out += '\\"'; break;
      case '\\': out += '\\\\'; break;
      case '\n': out += '\\n'; break;
      case '\r': out += '\\r'; break;
      case '\t': out += '\\t'; break;
      case '\b': out += '\\b'; break;
      case '\f': out += '\\f'; break;
      default:
        if (code < 0x20 || code === 0x85 || code === 0x2028 || code === 0x2029) {
          out += '\\u' + code.toString(16).padStart(4, '0');
        } else {
          out += ch;
        }
    }
  }
  return out + '"';
}

/**
 * Serialize the lossless model in Newtonsoft "Formatting.Indented" style.
 * @param {any} node
 * @param {{indent?: string, newline?: string}} [opts]
 */
export function stringify(node, { indent = '  ', newline = '\n' } = {}) {
  const write = (v, depth) => {
    if (v === null) return 'null';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (typeof v === 'string') return quote(v);
    if (v instanceof JsonNumber) return v.raw;
    if (typeof v === 'number') {
      throw new TypeError('Plain JS numbers are not allowed; wrap them in JsonNumber');
    }
    const pad = indent.repeat(depth + 1);
    const end = newline + indent.repeat(depth);
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      return '[' + v.map((x) => newline + pad + write(x, depth + 1)).join(',') + end + ']';
    }
    if (v instanceof Map) {
      if (v.size === 0) return '{}';
      const parts = [];
      for (const [k, x] of v) parts.push(newline + pad + quote(k) + ': ' + write(x, depth + 1));
      return '{' + parts.join(',') + end + '}';
    }
    throw new TypeError(`Unsupported value in JSON model: ${Object.prototype.toString.call(v)}`);
  };
  return write(node, 0);
}

// ---------------------------------------------------------------- helpers

/**
 * Convert the lossless model to plain JS (numbers become JS numbers). Read-only use.
 * @param {any} node
 */
export function toPlain(node) {
  if (node instanceof JsonNumber) return node.value;
  if (Array.isArray(node)) return node.map(toPlain);
  if (node instanceof Map) {
    const o = {};
    for (const [k, v] of node) o[k] = toPlain(v);
    return o;
  }
  return node;
}

/** Deep clone of the lossless model. */
export function clone(node) {
  if (Array.isArray(node)) return node.map(clone);
  if (node instanceof Map) return new Map([...node].map(([k, v]) => [k, clone(v)]));
  return node; // JsonNumber is immutable, primitives are values
}
