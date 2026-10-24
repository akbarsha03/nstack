import fs from 'node:fs';
import path from 'node:path';
import { NAME, ConfigError } from './config.js';

// A renamed persona keeps its saved login: Electron's `persist:<name>` partition can't be renamed while a session is
// open, so .nstack/aliases.json maps the new name to the partition it already has: { "<to>": "<partition name>" }.
// ponytail: a new persona later given an old, aliased-away name would share that partition; clean up when it bites.
const file = (dir: string) => path.join(dir, '.nstack', 'aliases.json');

// only persona-name keys and values: the values become folder names, so a hand-edited or shipped file can't point
// outside Partitions (e.g. "../../..")
export function readAliases(dir: string): Record<string, string> {
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file(dir), 'utf8')); } catch { return {}; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => NAME.test(k) && typeof v === 'string' && NAME.test(v)));
}

// follows the chain (a renamed-again persona), stopping at a loop
export function resolveAlias(aliases: Record<string, string>, name: string): string {
  const seen = new Set<string>();
  while (Object.hasOwn(aliases, name) && !seen.has(name)) { seen.add(name); name = aliases[name]; }
  return name;
}

// pure: the alias map after renaming `from` to `to` (points straight at the partition, drops the old entry)
export function renameAlias(aliases: Record<string, string>, from: string, to: string): Record<string, string> {
  const { [from]: _, ...rest } = aliases, part = resolveAlias(aliases, from);
  return part === to ? rest : { ...rest, [to]: part };
}

export function addAlias(dir: string, from: string, to: string) {
  fs.mkdirSync(path.dirname(file(dir)), { recursive: true });
  fs.writeFileSync(file(dir), JSON.stringify(renameAlias(readAliases(dir), from, to), null, 2) + '\n');
}

// where Electron keeps a persona's partition on disk, under the userData main.ts / login.ts set; never outside it
export function partitionDir(dir: string, name: string) {
  const root = path.resolve(dir, '.nstack', 'electron', 'Partitions'), at = path.resolve(root, resolveAlias(readAliases(dir), name));
  if (!at.startsWith(root + path.sep)) throw new ConfigError(`${name} is not a persona name`);
  return at;
}

// the Electron partition holding this persona's cookies and storage
export const partition = (dir: string, name: string) => `persist:${resolveAlias(readAliases(dir), name)}`;
