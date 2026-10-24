import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, parseDevice, rotated as rot } from '../src/devices.js';

test('presets give the real viewport, DPR, touch and user agent', () => {
  const pick = (n: string) => { const d = parseDevice(n)!; return [d.width, d.height, d.dpr, d.touch]; };
  assert.deepEqual(pick('iphone-15'), [393, 852, 3, true]);
  assert.deepEqual(pick('pixel-8'), [412, 915, 2.625, true]);
  assert.deepEqual(pick('ipad-air'), [820, 1180, 2, true]);
  assert.deepEqual(pick('laptop'), [1280, 800, 1, false]);
  assert.deepEqual(pick('desktop'), [1440, 900, 1, false]);
  assert.match(PRESETS['iphone-15'].userAgent!, /iPhone.*Mobile.*Safari/);
  assert.match(PRESETS['pixel-8'].userAgent!, /Android.*Pixel 8.*Mobile/);
  assert.match(PRESETS['ipad-air'].userAgent!, /iPad/);
  assert.equal(PRESETS.desktop.userAgent, undefined); // keeps Electron's Chrome UA
});

test('WxH literal is a 1x desktop viewport; anything else is unknown', () => {
  assert.deepEqual(parseDevice('1366x768'), { width: 1366, height: 768, dpr: 1, touch: false });
  for (const s of ['1366', '1366x', 'x768', '1366X768', '0x0', 'toString', 'iphone', '']) assert.equal(parseDevice(s), undefined, s);
});

test('rotated swaps the viewport and keeps dpr, touch and user agent', () => {
  const ipad = parseDevice('ipad-air')!;
  assert.deepEqual(rot(ipad), { ...ipad, width: 1180, height: 820 });
  assert.deepEqual(rot(rot(ipad)), ipad);
});
