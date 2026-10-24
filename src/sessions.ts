import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { NAME, ConfigError } from './config.js';

// Every space has its own Electron session, `persist:<id>`, recorded in .nstack/sessions.json as { "<persona>": "<id>" }.
// A space gets a fresh id (name-<6 hex>) the first time it needs one, so it never inherits a login from a removed or
// renamed space of the same name; a rename moves the entry (login kept); a remove drops it and deletes the folder.
const ID = /^[a-z][a-z0-9-]{0,24}$/;
const file = (dir: string) => path.join(dir, '.nstack', 'sessions.json');

const valid = (raw: unknown, val: RegExp): Record<string, string> => !raw || typeof raw !== 'object' || Array.isArray(raw) ? {}
  : Object.fromEntries(Object.entries(raw).filter(([k, v]) => NAME.test(k) && typeof v === 'string' && val.test(v))) as Record<string, string>;
const read = (f: string) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return undefined; } };

function write(dir: string, s: Record<string, string>) {
  fs.mkdirSync(path.dirname(file(dir)), { recursive: true });
  fs.writeFileSync(file(dir), JSON.stringify(s, null, 2) + '\n');
}

// only persona-name keys and id-shaped values: ids become folder names, so a hand-edited or shipped file can't point
// outside Partitions (e.g. "../../..")
export const readSessions = (dir: string) => valid(read(file(dir)), ID);

// this persona's session id; one with no entry yet gets a fresh one (and starts logged out)
export const sessionId = (dir: string, name: string) => readSessions(dir)[name] ?? newSession(dir, name);

// a brand-new space: a session id nothing else has used
export function newSession(dir: string, name: string): string {
  const id = `${name}-${randomBytes(3).toString('hex')}`;
  if (!ID.test(id)) throw new ConfigError(`${name} is not a persona name`);
  write(dir, { ...readSessions(dir), [name]: id });
  return id;
}

export function renameSession(dir: string, from: string, to: string) {
  const { [from]: id, ...rest } = readSessions(dir);
  write(dir, id ? { ...rest, [to]: id } : rest);
}

// forget a removed space; returns the id whose folder can now be deleted (undefined: it never had one)
export function dropSession(dir: string, name: string): string | undefined {
  const { [name]: id, ...rest } = readSessions(dir);
  write(dir, rest);
  return id;
}

export const partition = (dir: string, name: string) => `persist:${sessionId(dir, name)}`;

// where Electron keeps a session on disk, under the userData main.ts / login.ts set; never outside it
export function sessionDir(dir: string, id: string) {
  const root = path.resolve(dir, '.nstack', 'electron', 'Partitions'), at = path.resolve(root, id);
  if (!ID.test(id) || !at.startsWith(root + path.sep)) throw new ConfigError(`${id} is not a session id`);
  return at;
}
export const partitionDir = (dir: string, name: string) => sessionDir(dir, sessionId(dir, name));

// session folders no space owns any more (removed spaces, and pre-sessions.json name-keyed ones)
export const orphanDirs = (entries: string[], ids: string[]) => entries.filter(e => !ids.includes(e));

// at launch, before any session is opened (Chromium holds a persist: partition open for the app's lifetime, so a
// removed space's folder can't be deleted while the shell runs): delete every folder sessions.json doesn't name
export function sweepSessions(dir: string): string[] {
  const root = path.resolve(dir, '.nstack', 'electron', 'Partitions');
  let entries: string[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; }
  const gone = orphanDirs(entries, Object.values(readSessions(dir))).filter(e => ID.test(e));
  for (const e of gone) fs.rmSync(sessionDir(dir, e), { recursive: true, force: true });
  return gone;
}
