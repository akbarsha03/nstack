import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileGrid, nextSpace, spaceForKey, fitFrames, rowFrames, reorder, BAR, ADDR } from '../src/main/spaces.js';

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

test('fitFrames keeps true aspect ratio, never upscales, centres in the cell', () => {
  const cell = { x: 0, y: 0, width: 1000, height: 600 + BAR + ADDR };
  const [phone] = fitFrames([cell], [{ width: 412, height: 915 }]);
  assert.equal(phone.scale, 600 / 915);
  assert.equal(phone.view.height, 600);
  assert.equal(phone.view.width, Math.round(412 * 600 / 915));
  assert.deepEqual(phone.addr, { x: phone.frame.x, y: 0, width: phone.frame.width, height: 26 });
  assert.equal(phone.frame.y, ADDR);
  assert.equal(phone.view.y, ADDR + BAR);
  assert.equal(phone.frame.x, Math.floor((1000 - phone.view.width) / 2));
  const [small] = fitFrames([{ x: 0, y: 0, width: 3000, height: 3000 }], [{ width: 393, height: 852 }]);
  assert.equal(small.scale, 1);
  assert.deepEqual([small.view.width, small.view.height], [393, 852]);
});

test('All grid: one shared scale so relative sizes stay honest', () => {
  const cells = tileGrid({ x: 0, y: 0, width: 1200, height: 800 }, 2);
  const f = fitFrames(cells, [{ width: 1440, height: 900 }, { width: 393, height: 852 }], true);
  assert.equal(f[0].scale, f[1].scale);
  assert.ok(f[0].view.width / f[1].view.width > 3.6);
  for (const [i, x] of f.entries()) assert.ok(x.frame.x >= cells[i].x && x.frame.x + x.frame.width <= cells[i].x + cells[i].width);
});

test('All row: one row, equal heights, fits the stage width', () => {
  const stage = { x: 0, y: 50, width: 1200, height: 800 };
  const f = rowFrames(stage, [{ width: 1440, height: 900 }, { width: 412, height: 915 }, { width: 820, height: 1180 }]);
  assert.equal(new Set(f.map(x => x.view.height)).size, 1);
  assert.ok(f.every(x => x.frame.y === f[0].frame.y && x.view.y === x.frame.y + BAR && x.addr.y === x.frame.y - ADDR && x.addr.width === x.frame.width));
  assert.ok(f[0].addr.y >= stage.y && f[0].frame.y + f[0].frame.height <= stage.y + stage.height);
  for (let i = 1; i < f.length; i++) assert.ok(f[i].frame.x >= f[i - 1].frame.x + f[i - 1].frame.width);
  const last = f[f.length - 1].frame;
  assert.ok(f[0].frame.x >= 8 && last.x + last.width <= 1200 - 8);
  assert.ok(Math.abs(f[1].view.width / f[1].view.height - 412 / 915) < 0.01);
  // a short stage: height is the limit, never upscaled past the smallest device
  const [one] = rowFrames({ x: 0, y: 0, width: 5000, height: 5000 }, [{ width: 393, height: 852 }]);
  assert.equal(one.view.height, 852);
});

test('reorder follows the given order, drops unknowns, keeps the rest at the end', () => {
  assert.deepEqual(reorder(['admin', 'storage', 'customer'], ['customer', 'admin']), ['customer', 'admin', 'storage']);
  assert.deepEqual(reorder(['admin', 'storage'], ['gone', 'storage', 'storage']), ['storage', 'admin']);
  assert.deepEqual(reorder(['admin', 'storage'], []), ['admin', 'storage']);
});
