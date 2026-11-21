// Extract game IDs (achievements/unlocks, relics, arcanas, dungeons, …) from a Vampire Crawlers APK.
//
// Usage:  node tools/extract-apk-ids.mjs <path/to/game.apk> [--write]
//
// Reads only: opens the APK (zip), decompresses the Unity bundles data.unity3d / datapack.unity3d
// (UnityFS, LZ4) in memory and scans them for length-prefixed ID strings. Nothing is executed and
// no game assets are written to disk. With --write the ID lists are merged into data/ids.json
// (key "apk"); without it a summary is printed.
//
// Achievement objects carry two name fields: the asset name and the ID that is stored in the save.
// The second one is the save ID (e.g. asset "…_TinyBridge_01_Demo" has ID "…_TinyBridge_01").
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const [apkPath, ...flags] = process.argv.slice(2);
if (!apkPath) {
  console.error('Usage: node tools/extract-apk-ids.mjs <game.apk> [--write]');
  process.exit(1);
}

// ---------------------------------------------------------------- zip (APK)

function zipEntries(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a zip/APK file');
  let count = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  if (cd === 0xffffffff || count === 0xffff) { // zip64
    const loc = buf.readUInt32LE(eocd - 20) === 0x07064b50 ? Number(buf.readBigUInt64LE(eocd - 12)) : -1;
    if (loc < 0) throw new Error('zip64 locator missing');
    count = Number(buf.readBigUInt64LE(loc + 32));
    cd = Number(buf.readBigUInt64LE(loc + 48));
  }
  const entries = new Map();
  for (let i = 0, p = cd; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    let csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    let local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    // zip64 extra field
    let x = p + 46 + nlen;
    const xend = x + xlen;
    while (x < xend) {
      const id = buf.readUInt16LE(x), sz = buf.readUInt16LE(x + 2);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (local === 0xffffffff) { local = Number(buf.readBigUInt64LE(q)); }
      }
      x += 4 + sz;
    }
    entries.set(name, { method, csize, usize, local });
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}

function zipRead(buf, e) {
  const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
  const data = buf.subarray(start, start + e.csize);
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRawSync(data);
  throw new Error('Unsupported zip method ' + e.method);
}

// ---------------------------------------------------------------- UnityFS (LZ4)

function lz4Decode(src, outSize) {
  const out = Buffer.alloc(outSize);
  let s = 0, d = 0;
  while (s < src.length) {
    const token = src[s++];
    let lit = token >> 4;
    if (lit === 15) { let b; do { b = src[s++]; lit += b; } while (b === 255); }
    src.copy(out, d, s, s + lit); s += lit; d += lit;
    if (s >= src.length) break;
    const off = src[s] | (src[s + 1] << 8); s += 2;
    let ml = token & 15;
    if (ml === 15) { let b; do { b = src[s++]; ml += b; } while (b === 255); }
    ml += 4;
    let m = d - off;
    for (let i = 0; i < ml; i++) out[d++] = out[m++];
  }
  return out;
}
const unpack = (buf, comp, usize) => {
  if (comp === 0) return buf;
  if (comp === 2 || comp === 3) return lz4Decode(buf, usize);
  throw new Error('Unsupported Unity compression ' + comp);
};

/** @returns {Buffer[]} contained files of a UnityFS bundle */
function unityFsFiles(b) {
  let o = 0;
  const cstr = () => { const st = o; while (b[o]) o++; return b.toString('utf8', st, o++); };
  if (cstr() !== 'UnityFS') throw new Error('Not a UnityFS bundle');
  const ver = b.readUInt32BE(o); o += 4; cstr(); cstr(); o += 8;
  const ci = b.readUInt32BE(o), ui = b.readUInt32BE(o + 4), fl = b.readUInt32BE(o + 8); o += 12;
  if (ver >= 7) o = (o + 15) & ~15;
  let info;
  if (fl & 0x80) info = b.subarray(b.length - ci);
  else { info = b.subarray(o, o + ci); o += ci; }
  info = unpack(info, fl & 0x3f, ui);
  if (fl & 0x200) o = (o + 15) & ~15;
  let i = 16;
  const nb = info.readUInt32BE(i); i += 4;
  const blocks = [];
  for (let k = 0; k < nb; k++) { blocks.push([info.readUInt32BE(i), info.readUInt32BE(i + 4), info.readUInt16BE(i + 8)]); i += 10; }
  const nn = info.readUInt32BE(i); i += 4;
  const nodes = [];
  for (let k = 0; k < nn; k++) {
    const off = Number(info.readBigUInt64BE(i)), size = Number(info.readBigUInt64BE(i + 8)); i += 20;
    const st = i; while (info[i]) i++; const name = info.toString('utf8', st, i++);
    nodes.push({ off, size, name });
  }
  const data = Buffer.alloc(blocks.reduce((a, x) => a + x[0], 0));
  let w = 0;
  for (const [u, c, f] of blocks) { unpack(b.subarray(o, o + c), f & 0x3f, u).copy(data, w); w += u; o += c; }
  // .resS / .resource hold textures/audio only — skip them
  return nodes.filter((n) => !/\.(resS|resource)$/.test(n.name)).map((n) => data.subarray(n.off, n.off + n.size));
}

// ---------------------------------------------------------------- scan

const apk = readFileSync(apkPath);
const zip = zipEntries(apk);
const files = [];
for (const name of ['assets/bin/Data/data.unity3d', 'assets/bin/Data/datapack.unity3d']) {
  const e = zip.get(name);
  if (!e) { console.warn('missing in APK:', name); continue; }
  files.push(...unityFsFiles(zipRead(apk, e)));
}

const PREFIX = /^(FCC|Card|RelicConfig|ArcanaConfig|GemConfig|PowerUp|TownBuilding|Dungeon)_[A-Za-z0-9_]+$/;
const ACH = /^[A-Za-z]*Achievement_[A-Za-z0-9_]+$/;
const found = new Set();
const achievementObjects = [];
for (const b of files) {
  const strAt = (i, re) => {
    if (i < 0 || i + 4 > b.length) return null;
    const n = b.readInt32LE(i);
    if (n < 4 || n > 100 || i + 4 + n > b.length) return null;
    const s = b.toString('latin1', i + 4, i + 4 + n);
    return re.test(s) ? s : null;
  };
  for (let i = 0; i < b.length - 8; i++) {
    const p = strAt(i, PREFIX);
    if (p) { found.add(p); i += 3 + p.length; continue; }
    const a = strAt(i, ACH);
    if (!a) continue;
    let id = null, at = -1;
    for (let j = i + 4 + a.length; j < i + 170; j++) { const t = strAt(j, ACH); if (t) { id = t; at = j; break; } }
    if (id) { achievementObjects.push({ name: a, id }); i = at + 3 + id.length; } else i += 3 + a.length;
  }
}

const byPrefix = (p) => [...found].filter((s) => s.startsWith(p + '_')).sort();
const isTest = (s) => /^Test|_Test|BlahBlahBlah|_teaser$|_Demo$/i.test(s);
const achievements = [...new Set(achievementObjects.filter((o) => !isTest(o.name) && !isTest(o.id)).map((o) => o.id))].sort();
const result = {
  source: apkPath.split(/[\\/]/).pop(),
  extracted: new Date().toISOString().slice(0, 10),
  achievements,
  achievementAssetNames: Object.fromEntries(achievementObjects.filter((o) => o.name !== o.id).map((o) => [o.id, o.name])),
  characters: byPrefix('FCC').filter((s) => !/_(Actions|Played|Discovered|Triggered|Attack)/.test(s)),
  relics: byPrefix('RelicConfig'),
  arcanas: byPrefix('ArcanaConfig'),
  dungeons: byPrefix('Dungeon').filter((s) => !isTest(s)),
  buildings: byPrefix('TownBuilding'),
  powerUps: byPrefix('PowerUp'),
  gems: byPrefix('GemConfig'),
  cards: byPrefix('Card').filter((s) => !/_(Played|Discovered|Damage|Level|Duration)$/.test(s)),
};

for (const [k, v] of Object.entries(result)) {
  if (Array.isArray(v)) console.log(`${k.padEnd(14)} ${v.length}`);
}
console.log(`asset name ≠ save ID: ${Object.keys(result.achievementAssetNames).length}`);

if (flags.includes('--write')) {
  const url = new URL('../data/ids.json', import.meta.url);
  const ids = JSON.parse(readFileSync(url, 'utf8'));
  ids.apk = result;
  writeFileSync(url, JSON.stringify(ids, null, 2) + '\n');
  console.log('merged into data/ids.json → "apk"');
}
