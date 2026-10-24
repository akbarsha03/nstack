import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAlias, renameAlias, addAlias, partition, readAliases, partitionDir } from '../src/aliases.js';
import { ConfigError } from '../src/config.js';

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

test('aliases.json entries that are not persona names are ignored; partitionDir stays inside Partitions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nstack-alias-'));
  fs.mkdirSync(path.join(dir, '.nstack'));
  fs.writeFileSync(path.join(dir, '.nstack', 'aliases.json'), JSON.stringify({ evil: '../../..', '../x': 'admin', boss: 'admin', n: 5 }));
  assert.deepEqual(readAliases(dir), { boss: 'admin' });
  assert.equal(partitionDir(dir, 'evil'), path.resolve(dir, '.nstack/electron/Partitions/evil'));
  assert.equal(partitionDir(dir, 'boss'), path.resolve(dir, '.nstack/electron/Partitions/admin'));
  for (const bad of ['..', '../..', '', '.'])
    assert.throws(() => partitionDir(dir, bad), (e: Error) => e instanceof ConfigError);
  fs.writeFileSync(path.join(dir, '.nstack', 'aliases.json'), '[1]');
  assert.deepEqual(readAliases(dir), {});
});
