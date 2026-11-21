import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, stringify, JsonNumber, toPlain } from '../js/json-lossless.js';
import {
  SaveFile, getIn, setIn, kvGet, kvSet, kvDelete, parseTimeSpan, formatTimeSpan,
} from '../js/save-file.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'tests', 'fixtures', 'synthetic-profile.save');

/** All *.save files below a folder (recursive). */
function findSaves(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return findSaves(p);
    return name.endsWith('.save') ? [p] : [];
  });
}

// ---------------------------------------------------------------- round trips

const roundTripFiles = [fixture, ...findSaves(join(root, 'VC Save')), ...findSaves(join(root, 'samples'))];

for (const file of roundTripFiles) {
  const label = file.slice(root.length + 1);

  test(`round trip is byte-identical: ${label}`, async () => {
    const text = readFileSync(file, 'utf8');
    const save = await SaveFile.load(text, label);
    assert.equal(save.checksumValid, true, 'stored checksum must verify');
    assert.equal(await save.serialize(), text, 'unchanged save must serialize byte-for-byte');
  });
}

test('real saves (local only) are tested when present', () => {
  // Informational: shows in the output how many real saves were covered.
  const n = roundTripFiles.length - 1;
  console.log(`  ${n} real save file(s) found in "VC Save/" / "samples/"`);
});

// ---------------------------------------------------------------- editing

test('editing a value produces a valid, re-verifiable save', async () => {
  const save = await SaveFile.load(readFileSync(fixture, 'utf8'));
  setIn(save.data, ['ProgressionSaveData', 'TotalCoins'], JsonNumber.int(99999));
  const out = await save.serialize();
  const again = await SaveFile.load(out);
  assert.equal(again.checksumValid, true);
  assert.notEqual(again.storedChecksum, save.storedChecksum);
  assert.equal(getIn(again.data, 'ProgressionSaveData', 'TotalCoins').raw, '99999');
  // Only the edited line and the checksum line differ.
  const a = readFileSync(fixture, 'utf8').split('\n');
  const b = out.split('\n');
  assert.equal(a.length, b.length);
  const diff = a.map((l, i) => (l !== b[i] ? i : -1)).filter((i) => i >= 0);
  assert.equal(diff.length, 2);
});

test('tampered save is detected', async () => {
  const text = readFileSync(fixture, 'utf8').replace('"TotalCoins": 123', '"TotalCoins": 124');
  const save = await SaveFile.load(text);
  assert.equal(save.checksumValid, false);
});

test('serialize() does not mutate the loaded save', async () => {
  const text = readFileSync(fixture, 'utf8');
  const save = await SaveFile.load(text);
  setIn(save.data, ['ProfileSaveData', 'TotalCoins'], JsonNumber.int(5));
  await save.serialize();
  assert.equal(save.storedChecksum, parse(text).get('Checksum'));
});

test('save kind detection', async () => {
  const save = await SaveFile.load(readFileSync(fixture, 'utf8'));
  assert.equal(save.kind, 'profile');
  assert.equal(save.saveSystemVersion, '0.30.0');
  const settings = await SaveFile.load('{\n  "Version": 1,\n  "Checksum": "x",\n  "Data": {\n    "MasterVolume": 1.0\n  }\n}');
  assert.equal(settings.kind, 'settings');
});

test('non-save JSON is rejected', async () => {
  await assert.rejects(SaveFile.load('{"foo": 1}'), /Not a Vampire Crawlers save/);
  await assert.rejects(SaveFile.load('not json'), SyntaxError);
});

// ---------------------------------------------------------------- lossless JSON

test('number literals are preserved', () => {
  const src = '[\n  2400.0,\n  0.9119215,\n  -0.5,\n  1E+21,\n  0,\n  123456789012345678901\n]';
  assert.equal(stringify(parse(src)), src);
});

test('key order is preserved, including numeric-like keys', () => {
  const src = '{\n  "b": 1,\n  "2": 2,\n  "a": 3,\n  "1": 4\n}';
  assert.equal(stringify(parse(src)), src);
  assert.deepEqual([...parse(src).keys()], ['b', '2', 'a', '1']);
});

test('string escaping matches Newtonsoft', () => {
  const src = '[\n  "q\\" b\\\\ t\\t n\\n u\\u0001 äö €"\n]';
  assert.equal(stringify(parse(src)), src);
});

test('plain JS numbers are rejected by the serializer', () => {
  assert.throws(() => stringify([1]), /JsonNumber/);
});

test('JsonNumber factories use .NET formatting', () => {
  assert.equal(JsonNumber.int(42).raw, '42');
  assert.equal(JsonNumber.double(1).raw, '1.0');
  assert.equal(JsonNumber.double(0.1).raw, '0.1');
  assert.equal(JsonNumber.double(1e21).raw, '1E+21');
  assert.equal(JsonNumber.float32(0.7).raw, '0.7');
  assert.equal(JsonNumber.float32(2400).raw, '2400.0');
  assert.equal(JsonNumber.float32(0.9119215).raw, '0.9119215');
  assert.equal(new JsonNumber('1.0').withValue(0.5).raw, '0.5');
  assert.equal(new JsonNumber('3').withValue(7.9).raw, '7');
  assert.throws(() => JsonNumber.double(NaN));
});

test('toPlain converts for read-only use', () => {
  assert.deepEqual(toPlain(parse('{"a": [1.5, true, null, "x"]}')), { a: [1.5, true, null, 'x'] });
});

// ---------------------------------------------------------------- helpers

test('Key/Value dictionary helpers', () => {
  const list = parse('[{"Key": "A", "Value": true}]');
  assert.equal(kvGet(list, 'A'), true);
  assert.equal(kvGet(list, 'B'), undefined);
  kvSet(list, 'A', false);
  kvSet(list, 'B', true);
  assert.deepEqual(toPlain(list), [{ Key: 'A', Value: false }, { Key: 'B', Value: true }]);
  assert.equal(kvDelete(list, 'A'), true);
  assert.equal(kvDelete(list, 'A'), false);
  assert.equal(list.length, 1);
});

test('setIn refuses unknown fields', () => {
  const data = parse('{"a": {"b": 1}}');
  assert.throws(() => setIn(data, ['a', 'c'], JsonNumber.int(1)), /Unknown field/);
});

test('TimeSpan parse/format round trip', () => {
  for (const s of ['00:07:12.0510000', '01:02:03.4560000', '00:00:05', '1.02:00:00.0000001']) {
    assert.equal(formatTimeSpan(parseTimeSpan(s)), s);
  }
  assert.equal(parseTimeSpan('01:00:00'), 3600);
  assert.equal(formatTimeSpan(90061.5), '1.01:01:01.5000000');
});
