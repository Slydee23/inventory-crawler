// Load / verify / write Vampire Crawlers save files.

import { parse, stringify, JsonNumber, clone } from './json-lossless.js';
import { computeChecksum } from './checksum.js';

/** @typedef {'profile' | 'settings' | 'unknown'} SaveKind */

export class SaveFile {
  /**
   * @param {Map<string, any>} root parsed envelope
   * @param {string} originalText
   * @param {string} [fileName]
   */
  constructor(root, originalText, fileName = '') {
    this.root = root;
    this.originalText = originalText;
    this.fileName = fileName;
    /** @type {boolean | null} null until verify() ran */
    this.checksumValid = null;
  }

  /**
   * Parse save text. Throws on invalid JSON or wrong envelope.
   * @param {string} text
   * @param {string} [fileName]
   */
  static async load(text, fileName = '') {
    const root = parse(text);
    if (!(root instanceof Map) || !root.has('Data') || !root.has('Checksum')) {
      throw new Error('Not a Vampire Crawlers save file (missing "Data" or "Checksum").');
    }
    const save = new SaveFile(root, text, fileName);
    await save.verify();
    return save;
  }

  /** @returns {Map<string, any>} */
  get data() {
    return this.root.get('Data');
  }

  get storedChecksum() {
    return this.root.get('Checksum');
  }

  /** @returns {SaveKind} */
  get kind() {
    const d = this.data;
    if (d instanceof Map && d.has('ProgressionSaveData')) return 'profile';
    if (d instanceof Map && d.has('MasterVolume')) return 'settings';
    return 'unknown';
  }

  /** Game's save system version, e.g. "0.30.0" (profile saves only). */
  get saveSystemVersion() {
    return this.data instanceof Map ? this.data.get('saveSystemVersion') ?? null : null;
  }

  /** Recompute checksum and compare with the stored one. */
  async verify() {
    this.checksumValid = (await computeChecksum(this.data)) === this.storedChecksum;
    return this.checksumValid;
  }

  /**
   * Serialize with a freshly computed checksum. Does not mutate this object.
   * @returns {Promise<string>}
   */
  async serialize() {
    const root = clone(this.root);
    root.set('Checksum', await computeChecksum(root.get('Data')));
    const text = stringify(root, { indent: '  ', newline: '\n' });
    // Safety net: the output must parse and verify.
    const check = await SaveFile.load(text, this.fileName);
    if (!check.checksumValid) throw new Error('Internal error: written save does not verify.');
    return text;
  }
}

// ---------------------------------------------------------------- path helpers

/**
 * Get a nested value by path, e.g. get(data, 'ProgressionSaveData', 'TotalCoins').
 * @param {any} node
 * @param {...(string|number)} path
 */
export function getIn(node, ...path) {
  let cur = node;
  for (const p of path) {
    if (cur instanceof Map) cur = cur.get(p);
    else if (Array.isArray(cur)) cur = cur[p];
    else return undefined;
  }
  return cur;
}

/** Set a nested value. Parent must exist. */
export function setIn(node, path, value) {
  const parent = getIn(node, ...path.slice(0, -1));
  const last = path[path.length - 1];
  if (parent instanceof Map) {
    if (!parent.has(last)) throw new Error(`Unknown field "${path.join('.')}"`);
    parent.set(last, value);
  } else if (Array.isArray(parent)) {
    parent[last] = value;
  } else {
    throw new Error(`Path not found: ${path.join('.')}`);
  }
}

// ---------------------------------------------------------------- [{Key, Value}] dictionaries

/** @param {any[]} list */
export function kvFind(list, key) {
  return list.find((e) => e instanceof Map && e.get('Key') === key);
}

/** @param {any[]} list @returns {any} value or undefined */
export function kvGet(list, key) {
  return kvFind(list, key)?.get('Value');
}

/**
 * Set or append an entry. New entries are appended at the end (as the game does).
 * @param {any[]} list
 */
export function kvSet(list, key, value) {
  const entry = kvFind(list, key);
  if (entry) entry.set('Value', value);
  else list.push(new Map([['Key', key], ['Value', value]]));
}

/** @param {any[]} list */
export function kvDelete(list, key) {
  const idx = list.findIndex((e) => e instanceof Map && e.get('Key') === key);
  if (idx >= 0) list.splice(idx, 1);
  return idx >= 0;
}

// ---------------------------------------------------------------- .NET TimeSpan ("hh:mm:ss.fffffff")

/** @returns {number} seconds */
export function parseTimeSpan(s) {
  const m = /^(?:(\d+)\.)?(\d+):(\d{2}):(\d{2})(?:\.(\d{1,7}))?$/.exec(s);
  if (!m) throw new Error(`Invalid TimeSpan: ${s}`);
  const [, days = '0', h, min, sec, frac = '0'] = m;
  return (+days * 24 + +h) * 3600 + +min * 60 + +sec + Number(`0.${frac}`);
}

/** Format seconds like .NET TimeSpan.ToString() ("c" format). */
export function formatTimeSpan(totalSeconds) {
  const ticks = Math.round(totalSeconds * 1e7);
  const frac = ticks % 1e7;
  let secs = (ticks - frac) / 1e7;
  const days = Math.floor(secs / 86400);
  secs -= days * 86400;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const two = (n) => String(n).padStart(2, '0');
  let out = `${days ? days + '.' : ''}${two(h)}:${two(m)}:${two(s)}`;
  if (frac) out += '.' + String(frac).padStart(7, '0');
  return out;
}

export { JsonNumber };
