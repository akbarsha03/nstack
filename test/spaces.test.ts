import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSpace, spaceForKey, focusTarget, fitFrames, rowFrames, rowWidth, packFrames, reorder, reloadAll, BAR, ADDR, type Frame } from '../src/main/spaces.js';

test('arrow keys walk the strip and wrap around at the ends', () => {
  const s = ['all', 'admin', 'storage', 'customer'];
  assert.equal(nextSpace(s, 'admin', 1), 'storage');
  assert.equal(nextSpace(s, 'admin', -1), 'all');
  assert.equal(nextSpace(s, 'all', -1), 'customer');
  assert.equal(nextSpace(s, 'customer', 1), 'all');
});

test('a logged-out space hands keyboard focus to the shell, so arrows keep cycling past it', () => {
  const out = new Set(['storage']);
  assert.equal(focusTarget('storage', out), 'shell');
  assert.equal(focusTarget('admin', out), 'admin');
  assert.equal(focusTarget('all', out), 'shell');
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

// a packed space's whole footprint: address row through the bottom of the frame
const box = (f: Frame) => ({ x: f.addr.x, y: f.addr.y, r: f.addr.x + f.addr.width, b: f.frame.y + f.frame.height });
const apart = (fs: Frame[]) => fs.every((a, i) => fs.every((b, j) => {
  const p = box(a), q = box(b);
  return i === j || p.r <= q.x || q.r <= p.x || p.b <= q.y || q.b <= p.y;
}));
const DESK = { width: 1440, height: 900 }, PHONE = { width: 393, height: 852 }, TAB = { width: 820, height: 1180 };

test('All grid: one space fills the stage', () => {
  const stage = { x: 0, y: 0, width: 1200, height: 800 };
  const [f] = packFrames(stage, [DESK]);
  assert.ok(f.scale <= 1 && f.scale > 0.7);
  const b = box(f);
  assert.ok(b.x >= 16 && b.r <= 1184 && b.y >= 16 && b.b <= 784);
  assert.ok(b.b - b.y > 800 - 32 - 20 || b.r - b.x > 1200 - 32 - 20, 'touches the limiting side');
});

test('All grid: 4 equal spaces make 2×2 at the largest scale', () => {
  const f = packFrames({ x: 0, y: 0, width: 1200, height: 1000 }, [DESK, DESK, DESK, DESK]);
  assert.equal(new Set(f.map(x => x.scale)).size, 1);
  assert.deepEqual(f.map(x => x.addr.y), [f[0].addr.y, f[0].addr.y, f[2].addr.y, f[2].addr.y]);
  assert.ok(f[2].addr.y > f[0].addr.y && f[1].addr.x > f[0].addr.x);
  // a hair bigger and 2×2 no longer fits either way
  const s = f[0].scale, w = Math.round(1440 * s), h = Math.round(900 * s) + BAR + ADDR;
  assert.ok(2 * w + 16 <= 1200 - 32 && 2 * h + 16 <= 1000 - 32);
  assert.ok(2 * Math.round(1440 * (s + 0.01)) + 16 > 1200 - 32 || 2 * (Math.round(900 * (s + 0.01)) + BAR + ADDR) + 16 > 1000 - 32);
});

test('All grid: phone, desktop, tablet packed apart, inside, equal gaps, honest sizes', () => {
  const stage = { x: 0, y: 50, width: 1400, height: 800 };
  const f = packFrames(stage, [PHONE, DESK, TAB]);
  assert.ok(apart(f));
  assert.ok(f.every(x => x.scale === f[0].scale && x.scale <= 1));
  for (const x of f.map(box)) assert.ok(x.x >= 16 && x.r <= 1400 - 16 && x.y >= 50 + 16 && x.b <= 850 - 16);
  // one row here: top-aligned, 16px apart, in strip order
  assert.ok(f.every(x => x.addr.y === f[0].addr.y));
  assert.equal(box(f[1]).x - box(f[0]).r, 16);
  assert.equal(box(f[2]).x - box(f[1]).r, 16);
  assert.ok(Math.abs(f[1].view.width / f[0].view.width - 1440 / 393) < 0.05);
});

test('All grid: strip order is kept left to right, top to bottom', () => {
  const f = packFrames({ x: 0, y: 0, width: 900, height: 1000 }, [DESK, PHONE, TAB, PHONE, DESK]);
  for (let i = 1; i < f.length; i++) {
    const [p, q] = [box(f[i - 1]), box(f[i])];
    assert.ok(q.y > p.y ? true : q.y === p.y && q.x > p.x, `space ${i} after ${i - 1}`);
  }
  assert.ok(apart(f));
});

test('All grid: a tiny stage still gives non-overlapping frames at the 0.05 floor', () => {
  const f = packFrames({ x: 0, y: 0, width: 120, height: 60 }, [DESK, PHONE, TAB, DESK]);
  assert.ok(f.every(x => x.scale === 0.05));
  assert.ok(apart(f));
});

test('All row: every space fills the stage height; a long row overflows to the right', () => {
  const stage = { x: 0, y: 50, width: 1200, height: 800 }, avail = 800 - 32 - BAR - ADDR;
  const f = rowFrames(stage, [DESK, PHONE, TAB], 16);
  assert.ok(f.every(x => x.view.height === avail), 'all as tall as the stage allows');
  assert.ok(f.every(x => x.addr.y === f[0].addr.y && x.view.y === x.frame.y + BAR && x.addr.y === x.frame.y - ADDR));
  assert.ok(f[0].addr.y >= 50 + 16 && f[0].frame.y + f[0].frame.height <= 850 - 16);
  assert.ok(Math.abs(f[1].view.width / f[1].view.height - 393 / 852) < 0.01);
  for (let i = 1; i < f.length; i++) assert.equal(f[i].frame.x, f[i - 1].frame.x + f[i - 1].frame.width + 16);
  assert.equal(f[0].frame.x, 16, 'starts at the left edge when it overflows');
  assert.ok(rowWidth(stage, f, 16) > 1200);
  assert.equal(rowWidth(stage, f, 16), f[2].frame.x + f[2].frame.width + 16);
});

test('All row: a short row is centred and never upscaled', () => {
  const stage = { x: 0, y: 0, width: 5000, height: 5000 };
  const f = rowFrames(stage, [PHONE, PHONE], 16);
  assert.equal(f[0].view.height, 852);
  assert.equal(f[0].frame.x - stage.x, stage.width - (f[1].frame.x + f[1].frame.width) - (stage.width - 2 * 393 - 16) % 2);
  assert.ok(rowWidth(stage, f, 16) <= stage.width);
});

test('reorder follows the given order, drops unknowns, keeps the rest at the end', () => {
  assert.deepEqual(reorder(['admin', 'storage', 'customer'], ['customer', 'admin']), ['customer', 'admin', 'storage']);
  assert.deepEqual(reorder(['admin', 'storage'], ['gone', 'storage', 'storage']), ['storage', 'admin']);
  assert.deepEqual(reorder(['admin', 'storage'], []), ['admin', 'storage']);
});

test('reloadAll reloads every space with a view, and does nothing with none', () => {
  const calls: string[][] = [];
  const views = new Map([['admin', 1], ['storage', 2], ['customer', 3]]);
  reloadAll(views.keys(), who => calls.push(who));
  assert.deepEqual(calls, [['admin', 'storage', 'customer']]);
  reloadAll(new Map().keys(), who => calls.push(who));
  assert.equal(calls.length, 1);
});
