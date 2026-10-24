import fs from 'node:fs';
import path from 'node:path';

// A renamed persona keeps its saved login: Electron's `persist:<name>` partition can't be renamed while a session is
// open, so .nstack/aliases.json maps the new name to the partition it already has: { "<to>": "<partition name>" }.
// ponytail: a new persona later given an old, aliased-away name would share that partition; clean up when it bites.
const file = (dir: string) => path.join(dir, '.nstack', 'aliases.json');

export function readAliases(dir: string): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(file(dir), 'utf8')) ?? {}; } catch { return {}; }
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

// the Electron partition holding this persona's cookies and storage
export const partition = (dir: string, name: string) => `persist:${resolveAlias(readAliases(dir), name)}`;
