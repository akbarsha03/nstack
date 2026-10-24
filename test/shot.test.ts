import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slug, runName, shotFile, manifest } from '../src/main/shot.js';
import { parseDevice } from '../src/devices.js';

test('run folder: local minute stamp plus the path as a slug', () => {
  const t = new Date(2026, 9, 24, 7, 12);
  assert.equal(runName(t), '2026-10-24-0712');
  assert.equal(runName(t, '/'), '2026-10-24-0712');
  assert.equal(runName(t, '/storage/search?q=og'), '2026-10-24-0712-storage-search-q-og');
  assert.equal(slug('/' + 'a'.repeat(39) + '/b'), 'a'.repeat(39));
});

test('file names carry persona, device, viewport and pixel ratio', () => {
  assert.equal(shotFile('admin', 'desktop', parseDevice('desktop')!), 'admin-desktop-1440x900@1x.png');
  assert.equal(shotFile('storage', 'pixel-8', parseDevice('pixel-8')!), 'storage-pixel-8-412x915@2.625x.png');
  assert.equal(shotFile('odd', '1366x768', parseDevice('1366x768')!), 'odd-custom-1366x768@1x.png');
});

test('README lists every persona, skipped ones included', () => {
  const md = manifest({
    time: new Date(Date.UTC(2026, 9, 24, 1, 42)), baseUrl: 'http://localhost:3000', at: '/p?a|b',
    rows: [
      { persona: 'phone', device: 'iphone-15', d: parseDevice('iphone-15')!, url: 'http://localhost:3000/p', status: 'ok', file: 'phone-iphone-15-393x852@3x.png', image: { width: 393, height: 852 } },
      { persona: 'desk', device: 'desktop', d: parseDevice('desktop')!, url: 'http://localhost:3000/p', status: 'logged out' },
    ],
  });
  assert.match(md, /^# nstack shot · 2026-10-24T01:42:00\.000Z · http:\/\/localhost:3000\n/);
  assert.match(md, /\| phone-iphone-15-393x852@3x\.png \| phone \| iphone-15 \| portrait \| 393×852 \| 3 \| 393×852 \| touch \/ mobile UA \| http:\/\/localhost:3000\/p \| ok \|/);
  assert.match(md, /\| — \| desk \| desktop \| landscape \| 1440×900 \| 1 \| — \| no touch \/ desktop UA \| .* \| logged out \|/);
  assert.match(md, /Path: `\/p\?a\|b`/);
  assert.match(md, /## How to read these/);
});
