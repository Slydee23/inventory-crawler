import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVersion, stampedVersion } from '../tools/stamp-version.mjs';

test('index.html carries the current asset version (run: node tools/stamp-version.mjs)', () => {
  assert.equal(stampedVersion(), computeVersion());
});
