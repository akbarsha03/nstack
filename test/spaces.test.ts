import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileGrid, nextSpace, spaceForKey } from '../src/main/spaces.js';

test('grid tiles 3 personas as 2x2 inside the stage', () => {
  const r = tileGrid({ x: 0, y: 100, width: 1000, height: 600 }, 3);
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { x: 8, y: 108, width: 488, height: 288 });
  assert.equal(r[2].y, 108 + 288 + 8);
  for (const c of r) assert.ok(c.x + c.width <= 1000 && c.y + c.height <= 700);
});

test('arrow keys walk the strip and clamp at the ends', () => {
  const s = ['all', 'admin', 'storage', 'customer'];
  assert.equal(nextSpace(s, 'admin', 1), 'storage');
  assert.equal(nextSpace(s, 'admin', -1), 'all');
  assert.equal(nextSpace(s, 'all', -1), 'all');
  assert.equal(nextSpace(s, 'customer', 1), 'customer');
});

test('digit keys pick a persona, 0 and a pick All', () => {
  const n = ['admin', 'storage', 'customer'];
  assert.equal(spaceForKey(n, '2'), 'storage');
  assert.equal(spaceForKey(n, '0'), 'all');
  assert.equal(spaceForKey(n, 'a'), 'all');
  assert.equal(spaceForKey(n, '7'), undefined);
  assert.equal(spaceForKey(n, 'x'), undefined);
});
