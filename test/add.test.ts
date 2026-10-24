import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPersona, parseConfig, ConfigError, quickName } from '../src/config.js';

const SPEC = `# nstack.yml
baseUrl: http://localhost:3000
loginPath: /sign-in          # used to detect "logged out"
personas:
  admin:
    device: desktop          # 1440x900 @1x
  customer:
    device: ipad-air
    login:                   # optional scripted login; omit to log in by hand
      fill:
        "input[name=password]": "$CUSTOMER_PASSWORD"   # env var
      submit: "button[type=submit]"
# kept at the end
tile: grid                   # grid | row
`;

test('appends the persona and keeps every other byte, comments included', () => {
  const { text, persona } = addPersona(SPEC, 'cashier', { device: 'iphone-15' });
  const lines = SPEC.split('\n');
  assert.equal(text, [...lines.slice(0, 12), '  cashier:', '    device: iphone-15', ...lines.slice(12)].join('\n'));
  assert.deepEqual(persona, { device: 'iphone-15' });
  const c = parseConfig(text, { CUSTOMER_PASSWORD: 'x' });
  assert.deepEqual(Object.keys(c.personas), ['admin', 'customer', 'cashier']);
  assert.equal(c.tile, 'grid');
});

test('follows the file indentation, adds a trailing newline', () => {
  const { text, persona } = addPersona('baseUrl: http://x\npersonas:\n    admin:\n        device: desktop', 'pos', { device: '1366x768' });
  assert.equal(text, 'baseUrl: http://x\npersonas:\n    admin:\n        device: desktop\n    pos:\n        device: 1366x768\n');
  assert.deepEqual(persona, { device: '1366x768' });
});

test('flow-style personas map still gets the persona', () => {
  const { text } = addPersona('baseUrl: http://x # app\npersonas: {admin: {device: desktop}}\n', 'b', { device: 'pixel-8' });
  assert.deepEqual(Object.keys(parseConfig(text).personas), ['admin', 'b']);
  assert.match(text, /# app/);
});

test('rejects bad names, devices and duplicates', () => {
  const bad = (name: string, p: { device: string }, re: RegExp) =>
    assert.throws(() => addPersona(SPEC, name, p), (e: Error) => e instanceof ConfigError && re.test(e.message));
  bad('Cashier', { device: 'desktop' }, /lowercase/);
  bad('cashier', { device: 'galaxy' }, /unknown device/);
  bad('admin', { device: 'desktop' }, /admin is already in nstack\.yml/);
  assert.throws(() => addPersona('baseUrl: [x', 'a', { device: 'desktop' }), /not valid YAML/);
});

test('quickName: the preset\'s first word, suffixed until free', () => {
  assert.deepEqual(['iphone-15', 'pixel-8', 'ipad-air', 'laptop', 'desktop'].map(p => quickName(p, [])), ['iphone', 'pixel', 'ipad', 'laptop', 'desktop']);
  assert.equal(quickName('iphone-15', ['iphone']), 'iphone-2');
  assert.equal(quickName('iphone-15', ['iphone', 'iphone-2', 'iphone-3']), 'iphone-4');
  assert.equal(quickName('1366x768', []), 'space');
  assert.equal(quickName('1366x768', ['space']), 'space-2');
});
