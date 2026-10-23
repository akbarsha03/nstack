import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseConfig } from '../src/config.js';

const ROOT = path.join(__dirname, '..', '..', 'examples');

test('every example config is valid', () => {
  const dirs = fs.readdirSync(ROOT);
  assert.ok(dirs.length >= 3);
  const env = new Proxy({}, { get: () => 'x' });
  for (const d of dirs) parseConfig(fs.readFileSync(path.join(ROOT, d, 'nstack.yml'), 'utf8'), env, `examples/${d}/nstack.yml`);
});
