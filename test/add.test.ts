import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPersona, parseConfig, ConfigError } from '../src/config.js';

const SPEC = `# nstack.yml
baseUrl: http://localhost:3000
loginPath: /sign-in          # used to detect "logged out"
personas:
  admin:
    device: desktop          # 1440x900 @1x
    start: /dashboard
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
  const { text, persona } = addPersona(SPEC, 'cashier', { device: 'iphone-15', start: '/pos' });
  const lines = SPEC.split('\n');
  assert.equal(text, [...lines.slice(0, 13), '  cashier:', '    device: iphone-15', '    start: /pos', ...lines.slice(13)].join('\n'));
  assert.deepEqual(persona, { device: 'iphone-15', start: '/pos' });
  const c = parseConfig(text, { CUSTOMER_PASSWORD: 'x' });
  assert.deepEqual(Object.keys(c.personas), ['admin', 'customer', 'cashier']);
  assert.equal(c.tile, 'grid');
});

test('follows the file indentation, adds a trailing newline, defaults start', () => {
  const { text, persona } = addPersona('baseUrl: http://x\npersonas:\n    admin:\n        device: desktop', 'pos', { device: '1366x768' });
  assert.equal(text, 'baseUrl: http://x\npersonas:\n    admin:\n        device: desktop\n    pos:\n        device: 1366x768\n');
  assert.equal(persona.start, '/');
});

test('quotes a start path that would not be plain YAML', () => {
  const { text } = addPersona('baseUrl: http://x\npersonas:\n  a: {}\n', 'b', { device: 'laptop', start: '/x: #y' });
  assert.equal(parseConfig(text).personas.b.start, '/x: #y');
});

test('flow-style personas map still gets the persona', () => {
  const { text } = addPersona('baseUrl: http://x # app\npersonas: {admin: {device: desktop}}\n', 'b', { device: 'pixel-8' });
  assert.deepEqual(Object.keys(parseConfig(text).personas), ['admin', 'b']);
  assert.match(text, /# app/);
});

test('rejects bad names, devices, paths and duplicates', () => {
  const bad = (name: string, p: { device: string; start?: string }, re: RegExp) =>
    assert.throws(() => addPersona(SPEC, name, p), (e: Error) => e instanceof ConfigError && re.test(e.message));
  bad('Cashier', { device: 'desktop' }, /lowercase/);
  bad('cashier', { device: 'galaxy' }, /unknown device/);
  bad('cashier', { device: 'desktop', start: 'pos' }, /must start with \//);
  bad('admin', { device: 'desktop' }, /admin is already in nstack\.yml/);
  assert.throws(() => addPersona('baseUrl: [x', 'a', { device: 'desktop' }), /not valid YAML/);
});
