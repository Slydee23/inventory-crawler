// Extract game IDs (achievements/unlocks, relics, arcanas, dungeons, …) from a Vampire Crawlers APK.
//
// Usage:  node --max-old-space-size=6000 tools/extract-apk-ids.mjs <path/to/game.apk> [--write]
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
  return nodes.filter((n) => !/\.(resS|resource)$/.test(n.name)).map((n) => ({ name: n.name, buf: data.subarray(n.off, n.off + n.size) }));
}

// ---------------------------------------------------------------- Unity SerializedFile (no type trees needed)

function parseSerialized(buf) {
  let o = 0;
  const be32 = () => { const v = buf.readUInt32BE(o); o += 4; return v; };
  be32(); be32(); const version = be32(); let dataOffset = be32();
  if (version < 19) throw new Error('SerializedFile version too old: ' + version);
  let le = buf[o] === 0; o += 4;
  if (version >= 22) { o += 4; o += 8; dataOffset = Number(buf.readBigUInt64BE(o)); o += 8; o += 8; }
  const u8 = () => buf[o++];
  const i16 = () => { const v = le ? buf.readInt16LE(o) : buf.readInt16BE(o); o += 2; return v; };
  const i32 = () => { const v = le ? buf.readInt32LE(o) : buf.readInt32BE(o); o += 4; return v; };
  const u32 = () => { const v = le ? buf.readUInt32LE(o) : buf.readUInt32BE(o); o += 4; return v; };
  const i64 = () => { const v = le ? buf.readBigInt64LE(o) : buf.readBigInt64BE(o); o += 8; return v; };
  const cstr = () => { const s = o; while (buf[o]) o++; return buf.toString('utf8', s, o++); };
  const align = () => { o = (o + 3) & ~3; };
  cstr(); i32();
  const typeTree = u8() !== 0;
  const readTree = () => {
    const nodes = i32(), strSize = i32();
    o += nodes * (version >= 19 ? 32 : 24) + strSize;
  };
  const readTypes = (isRef) => {
    const types = [];
    for (let n = i32(), k = 0; k < n; k++) {
      const t = { classID: i32() };
      u8(); i16();
      if (isRef || t.classID === 114) o += 16;
      o += 16;
      if (typeTree) {
        readTree();
        if (version >= 21) { if (isRef) { cstr(); cstr(); cstr(); } else { const d = i32(); o += 4 * d; } }
      }
      types.push(t);
    }
    return types;
  };
  const types = readTypes(false);
  const objects = [];
  for (let n = i32(), k = 0; k < n; k++) {
    align();
    const pathID = i64();
    const start = dataOffset + (version >= 22 ? Number(i64()) : u32());
    const size = u32();
    const t = types[i32()];
    objects.push({ pathID, start, size, classID: t?.classID });
  }
  for (let n = i32(), k = 0; k < n; k++) { i32(); align(); i64(); }
  const externals = [];
  for (let n = i32(), k = 0; k < n; k++) { cstr(); o += 16; i32(); externals.push(cstr().split('/').pop()); }
  return { objects, externals };
}

// ---------------------------------------------------------------- analysis

const apk = readFileSync(apkPath);
const zip = zipEntries(apk);
const files = {};
for (const name of ['assets/bin/Data/data.unity3d', 'assets/bin/Data/datapack.unity3d']) {
  const e = zip.get(name);
  if (!e) { console.warn('missing in APK:', name); continue; }
  for (const f of unityFsFiles(zipRead(apk, e))) {
    try { files[f.name] = { name: f.name, buf: f.buf, ...parseSerialized(f.buf) }; } catch { /* not a serialized file */ }
  }
}

const lookup = {};
for (const f of Object.values(files)) {
  lookup[f.name] = new Map();
  for (const ob of f.objects) { ob.file = f.name; lookup[f.name].set(ob.pathID.toString(), ob); }
}
const readStr = (b, at) => { const n = b.readInt32LE(at); return n >= 0 && n < 512 ? b.toString('utf8', at + 4, at + 4 + n) : ''; };
const alignUp = (n) => (n + 3) & ~3;
const targetFile = (f, fid) => (fid === 0 ? f.name : f.externals[fid - 1]);

// MonoScript (115): m_Name, m_ExecutionOrder, m_PropertiesHash(16), m_ClassName
for (const f of Object.values(files)) for (const ob of f.objects) {
  if (ob.classID !== 115) continue;
  const name = readStr(f.buf, ob.start);
  ob.scriptClass = readStr(f.buf, alignUp(ob.start + 4 + Buffer.byteLength(name)) + 20) || name;
}
// MonoBehaviour (114): m_GameObject PPtr, m_Enabled, m_Script PPtr, m_Name
const behaviours = [];
for (const f of Object.values(files)) for (const ob of f.objects) {
  if (ob.classID !== 114) continue;
  const fid = f.buf.readInt32LE(ob.start + 16), pid = f.buf.readBigInt64LE(ob.start + 20);
  ob.cls = lookup[targetFile(f, fid)]?.get(pid.toString())?.scriptClass ?? '?';
  ob.name = readStr(f.buf, ob.start + 28);
  ob.fieldsStart = alignUp(ob.start + 32 + Buffer.byteLength(ob.name));
  behaviours.push(ob);
}
/** Objects referenced by PPtrs inside an object's fields. */
function refsOf(ob) {
  const f = files[ob.file]; const out = [];
  for (let p = ob.fieldsStart; p + 12 <= ob.start + ob.size; p += 4) {
    const fid = f.buf.readInt32LE(p);
    if (fid < 0 || fid > f.externals.length) continue;
    const pid = f.buf.readBigInt64LE(p + 4);
    if (pid === 0n) continue;
    const t = lookup[targetFile(f, fid)]?.get(pid.toString());
    if (t && t !== ob && t.classID === 114) out.push(t);
  }
  return out;
}
/**
 * Save ID = first ID-like string field after m_Name (falls back to the asset name).
 * Achievements keep it right after m_Name; relics/gems store it deep inside the object.
 */
function saveId(ob, re, window = Infinity) {
  const b = files[ob.file].buf, end = ob.start + ob.size;
  for (let p = ob.fieldsStart; p + 4 < Math.min(end, ob.fieldsStart + window); p++) {
    const n = b.readInt32LE(p);
    if (n > 3 && n < 100 && p + 4 + n <= end) { const s = b.toString('latin1', p + 4, p + 4 + n); if (re.test(s)) return s; }
  }
  return ob.name;
}

const ACH = /^[A-Za-z-]*Achievement_[A-Za-z0-9_]+$/;
const isAch = (o) => /Achievement$/.test(o.cls) && o.cls !== 'EnemyAchievementUnlockOnDeath';
const CATEGORY = {
  FccConfig: ['characters', /^FCC_[A-Za-z0-9_']+$/],
  RelicConfig: ['relics', /^RelicConfig_[A-Za-z0-9_]+$/],
  PowerUpConfig: ['powerUps', /^PowerUp_[A-Za-z0-9_]+$/],
  GemConfig: ['gems', /^GemConfig_[A-Za-z0-9_]+$/],
  ArcanaConfig: ['arcanas', /^ArcanaConfig_[A-Za-z0-9_]+$/],
  EbbAndComboArcanaConfig: ['arcanas', /^ArcanaConfig_[A-Za-z0-9_]+$/],
  DungeonConfig: ['dungeons', /^Dungeon_[A-Za-z0-9_]+$/],
  TownBuildingConfig: ['buildings', /^TownBuilding_[A-Za-z0-9_]+$/],
  CardConfig: ['cards', /^Card_[A-Za-z0-9_]+$/],
};
const idOf = (o) => (isAch(o) ? saveId(o, ACH, 400) : CATEGORY[o.cls] ? saveId(o, CATEGORY[o.cls][1]) : o.name);

// Content packs: <Pack>_XxxDatabase objects list what the game actually loads
const result = {
  source: apkPath.split(/[\\/]/).pop(),
  extracted: new Date().toISOString().slice(0, 10),
  achievements: new Set(), characters: new Set(), relics: new Set(), powerUps: new Set(), gems: new Set(),
  arcanas: new Set(), dungeons: new Set(), buildings: new Set(), cards: new Set(),
  pack: {}, deprecated: [], achievementAssetNames: {}, unlockedBy: {}, unlocks: {},
};
for (const db of behaviours.filter((o) => /Database$/.test(o.cls) && !/Multi/.test(o.cls))) {
  const pack = db.name.split('_')[0];
  for (const t of refsOf(db)) {
    if (/^Test/i.test(t.name)) continue;
    const cat = isAch(t) ? 'achievements' : CATEGORY[t.cls]?.[0];
    if (!cat) continue;
    const id = idOf(t);
    if (cat === 'arcanas' && /DEPRECATED/i.test(t.name)) result.deprecated.push(id);
    result[cat].add(id);
    result.pack[id] ??= pack;
    if (isAch(t) && t.name !== id) result.achievementAssetNames[id] = t.name;
  }
}
// What unlocks what: content objects reference their unlock achievement
for (const o of behaviours) {
  if (/Database$|MultiGroup$/.test(o.cls) || isAch(o) || o.cls === 'ProgressionData' || /^Test/i.test(o.name)) continue;
  const content = CATEGORY[o.cls] || ['PassiveEventConfig', 'EnemyEncounterConfig'].includes(o.cls);
  if (!content) continue;
  const id = CATEGORY[o.cls] ? idOf(o) : `${o.cls.replace('Config', '')}:${o.name}`;
  for (const t of refsOf(o)) {
    if (!isAch(t)) continue;
    const ach = idOf(t);
    if (CATEGORY[o.cls]) result.unlockedBy[id] ??= ach;
    (result.unlocks[ach] ??= []).includes(id) || result.unlocks[ach].push(id);
  }
}
// Card types (CardConfig/FccConfig -> CardType object), keyed by save ID
result.cardTypes = {};
for (const o of behaviours) {
  if ((o.cls !== 'CardConfig' && o.cls !== 'FccConfig') || /^Test/i.test(o.name) || /_Test_/.test(o.name)) continue;
  const id = idOf(o);
  if (!result.cards.has(id) && !result.characters.has(id)) continue;
  const types = [...new Set(refsOf(o).filter((t) => t.cls === 'CardType').map((t) => t.name.replace(/^CardType_/, '')))];
  result.cardTypes[id] = types.includes('Character') ? 'Character' : types[0] ?? 'Other';
}
// Gem rarity (GemConfig -> GemQualityConfig); index matches GemFrequencies / UnlockedGemRarities values in saves
const RARITY = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
result.gemRarity = {};
for (const o of behaviours) {
  if (o.cls !== 'GemConfig') continue;
  const id = idOf(o);
  if (!result.gems.has(id)) continue;
  const q = refsOf(o).find((t) => t.cls === 'GemQualityConfig')?.name.replace(/^GemQuality_/, '');
  if (q && RARITY.includes(q)) result.gemRarity[id] = RARITY.indexOf(q);
}
for (const k of ['achievements', 'characters', 'relics', 'powerUps', 'gems', 'arcanas', 'dungeons', 'buildings', 'cards']) {
  result[k] = [...result[k]].sort();
}
result.deprecated.sort();

for (const [k, v] of Object.entries(result)) {
  if (Array.isArray(v)) console.log(`${k.padEnd(14)} ${v.length}`);
}
const packs = {};
for (const p of Object.values(result.pack)) packs[p] = (packs[p] ?? 0) + 1;
console.log('packs:', packs, '| unlock links:', Object.keys(result.unlockedBy).length, '| asset name ≠ save ID:', Object.keys(result.achievementAssetNames).length);

if (flags.includes('--write')) {
  const url = new URL('../data/ids.json', import.meta.url);
  const ids = JSON.parse(readFileSync(url, 'utf8'));
  ids.apk = result;
  writeFileSync(url, JSON.stringify(ids, null, 2) + '\n');
  console.log('merged into data/ids.json → "apk"');
}
