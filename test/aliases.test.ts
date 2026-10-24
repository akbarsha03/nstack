import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAlias, renameAlias, addAlias, partition } from '../src/aliases.js';

test('aliases resolve through renames, stop at loops, rename back drops the alias', () => {
  assert.equal(resolveAlias({}, 'admin'), 'admin');
  assert.equal(resolveAlias({ c: 'b', b: 'a' }, 'c'), 'a');
  assert.equal(resolveAlias({ a: 'b', b: 'a' }, 'a'), 'a');
  let m = renameAlias({}, 'admin', 'boss');
  assert.deepEqual(m, { boss: 'admin' });
  m = renameAlias(m, 'boss', 'chief');
  assert.deepEqual(m, { chief: 'admin' });
  assert.deepEqual(renameAlias(m, 'chief', 'admin'), {});
});

test('a renamed persona keeps its partition across reads of .nstack/aliases.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nstack-alias-'));
  assert.equal(partition(dir, 'admin'), 'persist:admin');
  addAlias(dir, 'admin', 'boss');
  addAlias(dir, 'boss', 'chief');
  assert.equal(partition(dir, 'chief'), 'persist:admin');
  assert.equal(partition(dir, 'storage'), 'persist:storage');
});
