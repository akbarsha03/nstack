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

const Schema = z.strictObject({
  baseUrl: z.url({ protocol: /^https?$/, error: 'must be an http(s) URL' }),
  loginPath: urlPath.default('/sign-in'),
  tile: z.enum(['grid', 'row']).default('grid'),
  personas: z.record(z.string(), Persona).superRefine((p, ctx) => {
    if (!Object.keys(p).length) ctx.addIssue({ code: 'custom', message: 'add at least one persona' });
    for (const name of Object.keys(p)) {
      if (!/^[a-z][a-z0-9-]{0,15}$/.test(name)) ctx.addIssue({ code: 'custom', path: [name], message: 'persona names are lowercase letters, digits and dashes, max 16' });
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
