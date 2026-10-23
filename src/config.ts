import fs from 'node:fs';
import YAML from 'yaml';
import { z } from 'zod';
import { parseDevice } from './devices.js';

const urlPath = z.string().startsWith('/', 'must start with /');

const Persona = z.strictObject({
  device: z.string().refine(d => parseDevice(d), 'unknown device: use iphone-15, pixel-8, ipad-air, laptop, desktop or WxH like 1366x768').default('desktop'),
  start: urlPath.default('/'),
  login: z.strictObject({ fill: z.record(z.string(), z.string()), submit: z.string() }).optional(),
});

const NAME = /^[a-z][a-z0-9-]{0,15}$/;

const Schema = z.strictObject({
  baseUrl: z.url({ protocol: /^https?$/, error: 'must be an http(s) URL' }),
  loginPath: urlPath.default('/sign-in'),
  tile: z.enum(['grid', 'row']).default('grid'),
  personas: z.record(z.string(), Persona).superRefine((p, ctx) => {
    if (!Object.keys(p).length) ctx.addIssue({ code: 'custom', message: 'add at least one persona' });
    for (const name of Object.keys(p)) {
      if (!NAME.test(name)) ctx.addIssue({ code: 'custom', path: [name], message: 'persona names are lowercase letters, digits and dashes, max 16' });
    }
  }),
});

export type Config = z.infer<typeof Schema>;

export class ConfigError extends Error {}

// "$NAME" / "${NAME}" in any string value → process env; unset is an error so a missing secret never goes out empty
function expand(value: unknown, env: NodeJS.ProcessEnv, at: string): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}|\$([A-Za-z_]\w*)/g, (_, a, b) => {
      const name = a ?? b;
      if (env[name] === undefined) throw new ConfigError(`${at}: environment variable ${name} is not set`);
      return env[name]!;
    });
  }
  if (Array.isArray(value)) return value.map((v, i) => expand(v, env, `${at}.${i}`));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v, env, at ? `${at}.${k}` : k)]));
  }
  return value;
}

export function parseConfig(text: string, env: NodeJS.ProcessEnv = process.env, file = 'nstack.yml'): Config {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (e) {
    throw new ConfigError(`${file}: not valid YAML\n  ${(e as Error).message.split('\n')[0]}`);
  }
  const res = Schema.safeParse(raw ?? {});
  if (!res.success) {
    throw new ConfigError(`${file} is invalid:\n` + res.error.issues.map(i => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n'));
  }
  return expand(res.data, env, '') as Config;
}

export function loadConfig(file: string, env: NodeJS.ProcessEnv = process.env): Config {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new ConfigError(`no config at ${file}. Create nstack.yml (see docs/MVP.md §5.2).`);
  }
  return parseConfig(text, env, file);
}

// login.fill values for password-looking fields that are written in the file instead of coming from $ENV
export function literalPasswords(text: string): string[] {
  const personas = (YAML.parse(text) ?? {}).personas ?? {};
  return Object.entries(personas).flatMap(([name, p]: [string, any]) =>
    Object.entries(p?.login?.fill ?? {})
      .filter(([sel, v]) => /pass/i.test(sel) && typeof v === 'string' && !v.includes('$'))
      .map(([sel]) => `personas.${name}.login.fill["${sel}"]`));
}

export type NewPersona = { device: string; start?: string };

// `nstack add`: the file text with personas.<name> appended. Edits the text in place so every other byte (comments,
// alignment, quoting) stays as written; only a flow-style `personas: {…}` gets re-printed by the yaml lib.
export function addPersona(text: string, name: string, p: NewPersona, file = 'nstack.yml'): { text: string; persona: Config['personas'][string] } {
  if (!NAME.test(name)) throw new ConfigError('persona names are lowercase letters, digits and dashes, max 16');
  const res = Persona.safeParse(p);
  if (!res.success) throw new ConfigError(res.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n'));
  const doc = YAML.parseDocument(text);
  if (doc.errors.length) throw new ConfigError(`${file}: not valid YAML\n  ${doc.errors[0].message.split('\n')[0]}`);
  const before = doc.toJS()?.personas ?? {};
  if (Object.hasOwn(before, name)) throw new ConfigError(`${name} is already in ${file}`);
  const entry: NewPersona = p.start ? { device: p.device, start: p.start } : { device: p.device };

  let out: string;
  const map = doc.get('personas', true);
  if (YAML.isMap(map) && !map.flow && map.items.length && map.range) {
    const key = map.items[0].key as YAML.Node;
    const col = key.range![0] - (text.lastIndexOf('\n', key.range![0]) + 1), ind = ' '.repeat(col), ind2 = ' '.repeat(col + (col || 2));
    const at = map.range[1];
    const lines = Object.entries(entry).map(([k, v]) => `${ind2}${k}: ${YAML.stringify(v).trim()}\n`).join('');
    out = text.slice(0, at) + (text[at - 1] === '\n' ? '' : '\n') + `${ind}${name}:\n${lines}` + text.slice(at);
  } else {
    doc.setIn(['personas', name], doc.createNode(entry));
    out = doc.toString();
  }
  // never write a file that lost a persona or misplaced the new one
  const after = YAML.parse(out)?.personas ?? {};
  if (JSON.stringify(after) !== JSON.stringify({ ...before, [name]: entry })) throw new ConfigError(`could not add ${name} to ${file} safely; add it by hand`);
  return { text: out, persona: res.data };
}
