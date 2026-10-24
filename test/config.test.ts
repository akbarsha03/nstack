import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, ConfigError, literalPasswords, removePersona, renamePersona } from '../src/config.js';

const OK = `
baseUrl: http://localhost:3000
personas:
  admin:
    device: desktop
  customer:
    device: ipad-air
    login:
      fill:
        "input[name=password]": "$CUSTOMER_PASSWORD"
        "input[name=login]": "\${USER_PREFIX}@example.com"
      submit: "button[type=submit]"
`;

const env = { CUSTOMER_PASSWORD: 's3cret', USER_PREFIX: 'meera' };

test('parses a valid config and fills defaults', () => {
  const c = parseConfig(OK, env);
  assert.equal(c.baseUrl, 'http://localhost:3000');
  assert.equal(c.loginPath, '/sign-in');
  assert.equal(c.tile, 'grid');
  assert.deepEqual(Object.keys(c.personas), ['admin', 'customer']);
  assert.equal(c.personas.admin.device, 'desktop');
});

test('expands $ENV and ${ENV} in strings', () => {
  const fill = parseConfig(OK, env).personas.customer.login!.fill;
  assert.equal(fill['input[name=password]'], 's3cret');
  assert.equal(fill['input[name=login]'], 'meera@example.com');
});

test('unset env var is an error naming the var and where', () => {
  assert.throws(() => parseConfig(OK, { USER_PREFIX: 'x' }), (e: Error) =>
    e instanceof ConfigError && /CUSTOMER_PASSWORD is not set/.test(e.message) && /personas\.customer\.login\.fill/.test(e.message));
});

const bad = (yml: string, re: RegExp) => assert.throws(() => parseConfig(yml, env), (e: Error) => e instanceof ConfigError && re.test(e.message));

test('rejects invalid configs with readable messages', () => {
  bad('personas: {a: {}}', /baseUrl/);
  bad('baseUrl: localhost:3000\npersonas: {a: {}}', /baseUrl: must be an http\(s\) URL/);
  bad('baseUrl: http://x\npersonas: {}', /personas: add at least one persona/);
  bad('baseUrl: http://x\npersonas: {Admin: {}}', /lowercase/);
  bad('baseUrl: http://x\npersonas: {a: {start: /dashboard}}', /personas\.a\.start: `start` is gone: every space opens at the root; remove it from personas\.a/);
  bad('baseUrl: http://x\npersonas: {a: {strat: x}}', /personas\.a.*strat/);
  bad('baseUrl: http://x\ntile: column\npersonas: {a: {}}', /tile/);
  bad('baseUrl: [unclosed', /not valid YAML/);
  bad('', /baseUrl/);
  bad('baseUrl: http://x\npersonas: {a: {device: galaxy}}', /personas\.a\.device: unknown device/);
});

test('accepts presets and WxH devices', () => {
  const c = parseConfig('baseUrl: http://x\npersonas: {a: {device: iphone-15}, b: {device: 1366x768}}', env);
  assert.equal(c.personas.b.device, '1366x768');
});

test('flags literal passwords but not $ENV ones', () => {
  assert.deepEqual(literalPasswords(OK), []);
  const lit = OK.replace('"$CUSTOMER_PASSWORD"', 'hunter2');
  assert.deepEqual(literalPasswords(lit), ['personas.customer.login.fill["input[name=password]"]']);
});

test('removePersona cuts one entry and keeps comments and the other personas', () => {
  const yml = 'baseUrl: http://x\npersonas:\n  # the boss\n  admin:\n    device: desktop # big\n    login: {fill: {}, submit: b}\n  storage: {device: pixel-8} # floor\ntile: row # end\n';
  assert.equal(removePersona(yml, 'admin'), 'baseUrl: http://x\npersonas:\n  # the boss\n  storage: {device: pixel-8} # floor\ntile: row # end\n');
  assert.equal(removePersona(yml, 'storage'), 'baseUrl: http://x\npersonas:\n  # the boss\n  admin:\n    device: desktop # big\n    login: {fill: {}, submit: b}\ntile: row # end\n');
  assert.deepEqual(Object.keys(parseConfig(removePersona('baseUrl: http://x\npersonas: {a: {}, b: {}}\n', 'a')).personas), ['b']);
});

test('removePersona refuses a missing name and the last persona', () => {
  const no = (yml: string, name: string, re: RegExp) => assert.throws(() => removePersona(yml, name), (e: Error) => e instanceof ConfigError && re.test(e.message));
  no('baseUrl: http://x\npersonas: {a: {}, b: {}}', 'c', /c is not in nstack\.yml/);
  no('baseUrl: http://x\npersonas:\n  a: {}\n', 'a', /last persona.*at least one/);
});

test('renamePersona changes only the key, comments and order kept', () => {
  const yml = 'baseUrl: http://x\npersonas:\n  # the boss\n  admin:  # top\n    device: desktop\n  storage: {device: pixel-8} # floor\n';
  assert.equal(renamePersona(yml, 'admin', 'chief'), yml.replace('  admin:', '  chief:'));
  assert.deepEqual(Object.keys(parseConfig(renamePersona(yml, 'storage', 'floor')).personas), ['admin', 'floor']);
  assert.match(renamePersona('baseUrl: http://x\npersonas: {a: {}, b: {}}\n', 'a', 'c'), /\{c: \{\}, b: \{\}\}/);
});

test('renamePersona refuses a missing name, a taken name and a bad name', () => {
  const yml = 'baseUrl: http://x\npersonas: {a: {}, b: {}}';
  const no = (from: string, to: string, re: RegExp) => assert.throws(() => renamePersona(yml, from, to), (e: Error) => e instanceof ConfigError && re.test(e.message));
  no('c', 'd', /c is not in nstack\.yml/);
  no('a', 'b', /b is already in nstack\.yml/);
  no('a', 'Big', /lowercase/);
});
