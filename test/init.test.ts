import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, SAMPLE } from '../src/init.js';
import { parseConfig, addPersona } from '../src/config.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nstack-init-'));
const read = (dir: string, f: string) => fs.readFileSync(path.join(dir, f), 'utf8');

test('the sample config is valid and `nstack add` can extend it', () => {
  const c = parseConfig(SAMPLE, {});
  assert.deepEqual(c.personas, { me: { device: 'desktop' } });
  const { text } = addPersona(SAMPLE, 'staff', { device: 'pixel-8' });
  assert.deepEqual(Object.keys(parseConfig(text, {}).personas), ['me', 'staff']);
});

test('fresh folder: writes nstack.yml and a .gitignore with .nstack/', () => {
  const dir = tmp();
  init(dir);
  assert.equal(read(dir, 'nstack.yml'), SAMPLE);
  assert.equal(read(dir, '.gitignore'), '.nstack/\n');
});

test('never overwrites a config; appends to an existing .gitignore once', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'nstack.yml'), 'mine');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules');
  assert.match(init(dir).join('\n'), /already exists/);
  assert.equal(read(dir, 'nstack.yml'), 'mine');
  assert.equal(read(dir, '.gitignore'), 'node_modules\n.nstack/\n');
  assert.match(init(dir).join('\n'), /already has \.nstack/);
  assert.equal(read(dir, '.gitignore'), 'node_modules\n.nstack/\n');
});

test('an existing /.nstack entry counts', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.gitignore'), 'x\n/.nstack\n');
  init(dir, 'other.yml');
  assert.equal(read(dir, '.gitignore'), 'x\n/.nstack\n');
  assert.ok(fs.existsSync(path.join(dir, 'other.yml')));
});
