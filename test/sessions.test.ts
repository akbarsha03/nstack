import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sessionId, newSession, renameSession, dropSession, readSessions, partition, partitionDir, sessionDir, orphanDirs, sweepSessions } from '../src/sessions.js';
import { ConfigError } from '../src/config.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nstack-sess-'));
const sessions = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, '.nstack', 'sessions.json'), 'utf8'));

test('every space gets a fresh id on first use, and keeps it', () => {
  const dir = tmp();
  const id = sessionId(dir, 'admin');
  assert.match(id, /^admin-[0-9a-f]{6}$/);
  assert.equal(partition(dir, 'admin'), `persist:${id}`);
  assert.notEqual(newSession(dir, 'admin'), id, 'adding the same name again is another session');
});

test('rename keeps the id, remove drops the entry, a re-added name starts fresh', () => {
  const dir = tmp();
  const id = newSession(dir, 'a');
  renameSession(dir, 'a', 'b');
  assert.deepEqual(sessions(dir), { b: id });
  assert.notEqual(newSession(dir, 'a'), id, 'a new `a` does not share the renamed one\'s login');
  assert.equal(dropSession(dir, 'b'), id);
  assert.deepEqual(Object.keys(sessions(dir)), ['a']);
});

test('ids that are not id-shaped are ignored; paths stay inside Partitions', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.nstack'));
  fs.writeFileSync(path.join(dir, '.nstack', 'sessions.json'), JSON.stringify({ evil: '../../..', '../x': 'admin', boss: 'admin', n: 5 }));
  assert.deepEqual(readSessions(dir), { boss: 'admin' });
  assert.equal(partitionDir(dir, 'boss'), path.resolve(dir, '.nstack/electron/Partitions/admin'));
  assert.match(partitionDir(dir, 'evil'), /Partitions[\/\\]evil-[0-9a-f]{6}$/);
  for (const bad of ['..', '../..', '', '.', 'A'])
    assert.throws(() => sessionDir(dir, bad), (e: Error) => e instanceof ConfigError);
  assert.throws(() => partitionDir(dir, '..'), (e: Error) => e instanceof ConfigError);
});

test('the launch sweep deletes session folders no space owns', () => {
  assert.deepEqual(orphanDirs(['admin', 'a-1f2e3d', 'b-000000'], ['a-1f2e3d']), ['admin', 'b-000000']);
  const dir = tmp(), parts = path.join(dir, '.nstack', 'electron', 'Partitions');
  const keep = newSession(dir, 'keep');
  for (const d of [keep, 'admin', 'gone-abcdef']) fs.mkdirSync(path.join(parts, d), { recursive: true });
  fs.writeFileSync(path.join(parts, 'stray-file'), 'x');
  assert.deepEqual(sweepSessions(dir).sort(), ['admin', 'gone-abcdef']);
  assert.deepEqual(fs.readdirSync(parts).sort(), [keep, 'stray-file'].sort());
});
