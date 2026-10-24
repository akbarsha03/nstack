import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, WebContentsView, dialog, ipcMain, nativeImage, type Rectangle } from 'electron';
import { addPersona, parseConfig, ConfigError, type Config } from '../config.js';
import { parseDevice, PRESETS, type Device } from '../devices.js';
import { serve } from '../ipc.js';
import { tileGrid, nextSpace, spaceForKey, fitFrames, rowFrames, inset, reorder } from './spaces.js';
import { keepSessionCookies, emulate, loggedOut } from './persona.js';
import { login } from './login-window.js';
import { shoot } from './shot.js';
import { createSync, relPath, type SyncPrefs } from './sync.js';

type Persona = Config['personas'][string];
const up = JSON.parse(process.env.NSTACK_UP!) as { config: Config; names: string[]; dir: string; file: string; space?: string; sync?: boolean };
const { config, dir, file } = up;
const nstackDir = path.join(dir, '.nstack');
// per-project profile: each persona's `persist:<name>` partition (cookies, storage) lives under here
app.setPath('userData', path.join(nstackDir, 'electron'));

// last space, tile mode, Sync and its prefs, and the strip order survive restarts
const stateFile = path.join(nstackDir, 'state.json');
const saved = (() => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; } })();
// strip order (dragged in the strip, saved); grows with `nstack add` / the + tile
const names = reorder(up.names, Array.isArray(saved.order) ? saved.order : []);
const spaces = () => ['all', ...names];
let space: string = up.space ?? saved.space ?? names[0];
if (!spaces().includes(space)) space = names[0];
let shotDir: string | undefined = typeof saved.shotDir === 'string' ? saved.shotDir : undefined; // last folder the Screenshot button saved to
let tile: 'grid' | 'row' = saved.tile === 'grid' || saved.tile === 'row' ? saved.tile : config.tile;
const saveState = () => { try { fs.writeFileSync(stateFile, JSON.stringify({ space, tile, sync: sync.on, syncPrefs: sync.prefs, order: names, shotDir })); } catch {} };

const THUMB_MS = 1500;
let win: BrowserWindow;
let ready = false;
let stage: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
let covered = false; // a dialog or the yml drawer is open; native views paint above the shell page, so hide them
const views = new Map<string, WebContentsView>();
const devices = new Map<string, Device>();
const out = new Set<string>(); // personas the app bounced to loginPath
const base = config.baseUrl.replace(/\/$/, '');
const startUrl = (name: string) => base + config.personas[name].start;
const size = (name: string) => `${devices.get(name)!.width}×${devices.get(name)!.height}`;
const pad = (s: string, n = 10) => s.padEnd(n);
const rel = (url: string) => relPath(url, config.baseUrl) ?? url; // what a frame's address bar shows

const sync = createSync({
  baseUrl: config.baseUrl,
  on: up.sync || saved.sync === true,
  prefs: saved.syncPrefs,
  isCurrent: name => name === space,
  go: (name, at) => views.get(name)!.webContents.loadURL(base + at).catch(() => {}),
  targets: leader => names.filter(n => n !== leader).map(n => [n, out.has(n) ? `logged out, not synced — run nstack login ${n}` : undefined]),
  report: (leader, at, results) => log(null, [['dim', `sync ${at} from ${leader}`],
    ...results.map(([n, skip]): Line => skip ? ['bad', `${pad(n)} ${skip}`] : ['', `${pad(n)} → ${at}  (sync)`])]),
});
// every load main starts goes through here, so sync can tell it from the user's own navigation
const load = (name: string, url: string) => { sync.drive(name); return views.get(name)!.webContents.loadURL(url).catch(() => {}); };

// terminal pane: every action as the CLI line it stands for. Result lines also go to stdout, `# …` notes do not.
type Line = [cls: string, text: string];
const history: Line[] = [];
function log(cmd: string | null, lines: Line[] = []) {
  if (!cmd?.startsWith('#')) for (const [c, t] of lines) (c === 'bad' ? console.error : console.log)(t);
  const all: Line[] = cmd ? [['cmd', '$ ' + cmd], ...lines] : lines;
  history.push(...all);
  if (ready) win.webContents.send('nstack:log', all);
}

const sendState = () => ready && win.webContents.send('nstack:state', {
  space, tile, sync: sync.on, syncPrefs: sync.prefs, personas: names.map(n => ({ name: n, device: config.personas[n].device, width: devices.get(n)!.width, height: devices.get(n)!.height, out: out.has(n) })),
});

function layout() {
  const all = space === 'all', sizes = names.map(n => devices.get(n)!);
  // hidden views keep their single-space size so their thumbnails render at a real size
  const frames = !all ? sizes.map(d => fitFrames([inset(stage, 16)], [d])[0])
    : tile === 'row' ? rowFrames(stage, sizes, 16)
    : fitFrames(tileGrid(stage, names.length, 16), sizes, true);
  names.forEach((name, i) => {
    const v = views.get(name)!, f = frames[i];
    v.setBounds(f.view);
    v.setVisible((all || name === space) && !out.has(name) && !covered);
    emulate(v.webContents, devices.get(name)!, f.scale);
  });
  win.webContents.send('nstack:frames', names.map((name, i) => ({
    name, device: config.personas[name].device, size: size(name), rect: frames[i].frame, shown: all || name === space, out: out.has(name), url: rel(views.get(name)!.webContents.getURL()),
  })));
}

function goTo(id: string) {
  if (!spaces().includes(id)) return;
  if (id !== space) log(`# space → ${id === 'all' ? 'All' : `${id}  ${config.personas[id].device} ${size(id)}`}`);
  space = id;
  layout();
  sendState();
  win.setTitle(`nstack · ${id === 'all' ? 'All' : id}`);
  if (!covered) (id === 'all' ? win.webContents : views.get(id)!.webContents).focus();
  saveState();
}

const onKey = (key: string) => {
  const id = key === 'ArrowRight' ? nextSpace(spaces(), space, 1) : key === 'ArrowLeft' ? nextSpace(spaces(), space, -1) : spaceForKey(names, key);
  if (id && id !== space) goTo(id);
};

function setSync(on: boolean) {
  sync.set(on);
  log(`# --sync ${on ? 'on' : 'off'}`, [['dim', on ? 'path changes now replay in every space (relative path, each keeps its own user)' : 'spaces navigate on their own']]);
  saveState();
  sendState();
}

function setPrefs(p: Partial<SyncPrefs>) {
  sync.setPrefs({ query: p.query !== false, leaderOnlyCurrent: p.leaderOnlyCurrent === true, follow: Object.fromEntries(names.map(n => [n, p.follow?.[n] !== false])) });
  const { query, leaderOnlyCurrent, follow } = sync.prefs;
  log(`# sync prefs: query ${query ? 'on' : 'off'} · leader ${leaderOnlyCurrent ? 'current' : 'any'} · follow ${names.filter(n => follow[n] !== false).join(',') || 'none'}`);
  saveState();
  sendState();
}

function setOrder(order: string[]) {
  names.splice(0, names.length, ...reorder(names, Array.isArray(order) ? order : []));
  log(`# order: ${names.join(', ')}`);
  saveState();
  layout();
  sendState();
}

function setTile(m: string) {
  if (m !== 'grid' && m !== 'row') return;
  tile = m;
  log(`# tile: ${m}`, [['dim', m === 'row' ? 'All space: one row, equal heights' : 'All space: grid, true relative sizes']]);
  saveState();
  if (space === 'all') { layout(); sendState(); } else goTo('all');
}

let tick = 0;
async function thumbs() {
  tick++;
  for (const [name, v] of views) {
    // the visible persona is skipped most ticks; only spaces you can't see need a live preview
    if (name === space && tick % 5) continue;
    if (v.getBounds().width === 0 || out.has(name)) continue;
    try {
      const img = await v.webContents.capturePage(undefined, { stayHidden: true });
      if (!img.isEmpty()) win.webContents.send('nstack:thumb', name, img.resize({ height: 124 }).toDataURL());
    } catch {}
  }
}

function watchLogin(name: string, v: WebContentsView) {
  let from = startUrl(name), at = from;
  const check = (to: string) => {
    if (!out.has(name) && loggedOut(from, to, config.baseUrl, config.loginPath)) {
      out.add(name);
      log(null, [['bad', `${pad(name)} logged out — run nstack login ${name}`]]);
      layout();
      sendState();
    }
    at = to;
    if (ready) win.webContents.send('nstack:url', { name, path: rel(to) });
    if (!out.has(name)) sync.navigated(name, to);
  };
  v.webContents.on('did-start-navigation', d => { if (d.isMainFrame && !d.isSameDocument) from = d.url; });
  v.webContents.on('did-navigate', (_e, url) => check(url));
  v.webContents.on('did-navigate-in-page', (_e, url, isMain) => { if (isMain) { from = at; check(url); } });
  v.webContents.on('did-stop-loading', () => sync.stopped(name));
}

// one isolated view per persona; returns its line for the terminal
function open(name: string): Line {
  const d = parseDevice(config.personas[name].device)!;
  devices.set(name, d);
  const v = new WebContentsView({
    webPreferences: { partition: `persist:${name}`, preload: path.join(__dirname, 'persona-preload.js'), backgroundThrottling: false },
  });
  v.setVisible(false);
  if (d.userAgent) v.webContents.setUserAgent(d.userAgent);
  keepSessionCookies(v.webContents);
  watchLogin(name, v);
  win.contentView.addChildView(v);
  v.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (isMain && code !== -3) log(null, [['bad', `${pad(name)} could not load ${url}: ${desc}`]]);
  });
  views.set(name, v);
  // the DevTools protocol needs a live page to answer, so emulate on a blank one, then go
  load(name, 'about:blank').then(() => emulate(v.webContents, d, 1)).then(() => load(name, startUrl(name)))
    .then(() => v.webContents.navigationHistory.clear()); // no Back to the blank page
  return ['', `${pad(name)} ${pad(config.personas[name].device, 9)} ${pad(size(name), 9)} → ${startUrl(name)}`];
}

const addCmd = (name: string, p: Persona) => `nstack add ${name} --device ${p.device}${p.start === '/' ? '' : ` --start ${p.start}`}`;

// a persona already written to nstack.yml (by the CLI or by the + tile) gets its space
function added(name: string, p: Persona): Line[] {
  if (views.has(name)) throw new ConfigError(`${name} is already open`);
  config.personas[name] = p;
  const view = open(name);
  names.push(name);
  const lines: Line[] = [['dim', `added personas.${name} to ${path.basename(file)} · start ${p.start} · ${size(name)}`], view];
  log(addCmd(name, p), lines);
  goTo(name);
  win.show();
  return lines;
}

const busy = new Set<string>();
async function logIn(name: string) {
  if (busy.has(name)) return;
  busy.add(name);
  log(`nstack login ${name}`);
  const ok = await login(config, name, (c, t) => log(null, [[c, t]]));
  busy.delete(name);
  if (!ok) return;
  out.delete(name);
  load(name, startUrl(name));
  layout();
  sendState();
}

async function reset(name: string) {
  await views.get(name)!.webContents.session.clearStorageData();
  out.add(name);
  log(`nstack reset ${name}`, [['dim', `${pad(name)} session deleted → run nstack login ${name}`]]);
  layout();
  sendState();
}

// Shot button and `nstack shot` from a terminal; personas already known to be logged out are skipped
let shooting = false;
async function shot(at?: string, to?: string) {
  if (shooting) throw new Error('a shot is already running');
  shooting = true;
  try {
    const shots = await shoot(config, names, dir, at, out, to);
    log(`nstack shot${at ? ' ' + at : ''}`, shots.map(s => [s.status === 'ok' ? 'ok' : 'bad', s.line]));
    return shots;
  } finally {
    shooting = false;
  }
}

app.whenReady().then(() => {
  fs.mkdirSync(nstackDir, { recursive: true });
  win = new BrowserWindow({
    width: 1440, height: 960, backgroundColor: '#0c0f13', title: 'nstack',
    webPreferences: { preload: path.join(__dirname, 'shell-preload.js') },
  });
  win.loadFile(path.join(__dirname, '..', '..', '..', 'renderer', 'index.html'));

  log('nstack up' + (sync.on ? ' --sync' : ''), [['dim', `config ${path.basename(file)} · baseUrl ${config.baseUrl}`], ...names.map(open)]);
  log(null, [['dim', `${names.length} spaces + All · showing ${space} · sync ${sync.on ? 'on' : 'off'} · close the window or Ctrl+C to quit`]]);

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'));
  ipcMain.on('nstack:ready', () => {
    ready = true;
    win.webContents.send('nstack:init', {
      version: pkg.version, baseUrl: config.baseUrl, file: path.basename(file), dir: dir.replace(os.homedir(), '~'),
      presets: Object.entries(PRESETS).map(([k, d]) => [k, d.width, d.height]),
    });
    win.webContents.send('nstack:log', history);
    goTo(space);
  });
  ipcMain.on('nstack:stage', (_e, r: Rectangle) => { stage = r; layout(); });
  ipcMain.on('nstack:go', (_e, id: string) => goTo(id));
  ipcMain.on('nstack:key', (_e, key: string) => onKey(key));
  ipcMain.on('nstack:reorder', (_e, order: string[]) => setOrder(order));
  ipcMain.on('nstack:tile', (_e, m: string) => setTile(m));
  ipcMain.on('nstack:sync', () => setSync(!sync.on));
  ipcMain.on('nstack:syncprefs', (_e, p: Partial<SyncPrefs>) => setPrefs(p ?? {}));
  // a frame's address bar: not driven, so with Sync on the other spaces follow like any navigation of yours
  ipcMain.on('nstack:goto', (_e, a: { name: string; path: string }) => {
    const v = views.get(a.name), p = String(a.path ?? '').trim();
    if (!v || !p) return;
    const url = /^https?:\/\//i.test(p) ? p : base + (p.startsWith('/') ? p : '/' + p);
    log(`# ${a.name} → ${rel(url)}`);
    v.webContents.loadURL(url).catch(() => {});
  });
  const cover = (on: boolean) => { covered = on; layout(); };
  ipcMain.on('nstack:covered', (_e, on: boolean) => cover(on));
  ipcMain.on('nstack:yml', () => win.webContents.send('nstack:yml', fs.readFileSync(file, 'utf8')));
  ipcMain.on('nstack:chip', (_e, name: string) => { if (views.has(name)) out.has(name) ? logIn(name) : reset(name); });
  ipcMain.on('nstack:login', (_e, name?: string) => {
    const who = name ?? names.find(n => out.has(n));
    if (who && views.has(who)) logIn(who);
    else log('nstack login --all', [['ok', `all ${names.length} sessions valid, nothing to do`]]);
  });
  // Up: every logged-in persona back to its start page
  ipcMain.on('nstack:up', () => {
    for (const n of names) if (!out.has(n)) load(n, startUrl(n));
    log('nstack up', names.map(n => out.has(n) ? ['bad', `${pad(n)} logged out  → run nstack login ${n}`] : ['', `${pad(n)} → ${startUrl(n)}`]));
  });
  ipcMain.on('nstack:add', (_e, a: { name: string; device: string; start: string; login: boolean }) => {
    try {
      const { text, persona } = addPersona(fs.readFileSync(file, 'utf8'), a.name, { device: a.device, start: a.start }, path.basename(file));
      fs.writeFileSync(file, text);
      added(a.name, persona);
      if (a.login) logIn(a.name);
    } catch (e) {
      log(addCmd(a.name, { device: a.device, start: a.start }), [['bad', (e as Error).message]]);
    }
  });
  // Screenshot button: ask for a folder first (native views would paint over the dialog, so hide them meanwhile)
  ipcMain.on('nstack:shot', async () => {
    cover(true);
    const pick = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'], defaultPath: shotDir ?? path.join(nstackDir, 'shots'), buttonLabel: 'Save screenshots here',
    }).finally(() => cover(false));
    if (pick.canceled || !pick.filePaths[0]) return win.webContents.send('nstack:shots', null);
    shotDir = pick.filePaths[0];
    saveState();
    shot(undefined, shotDir).then(shots => win.webContents.send('nstack:shots', shots.map(s => ({
      ...s, src: s.png && nativeImage.createFromPath(s.png).resize({ height: Math.min(340, s.height!) }).toDataURL(),
    }))), e => { log('nstack shot', [['bad', (e as Error).message]]); win.webContents.send('nstack:shots', null); });
  });
  // `nstack add` / `nstack shot` from a terminal in this folder
  serve(dir, async msg => {
    if (msg && 'shot' in msg) return { shots: (await shot(msg.shot ?? undefined)).map(({ name, status, line }) => ({ name, status, line })) };
    // the CLI already wrote nstack.yml; read the persona from there rather than trusting the socket
    const p = typeof msg?.add === 'string' && parseConfig(fs.readFileSync(file, 'utf8'), process.env, path.basename(file)).personas[msg.add];
    if (!p) throw new Error(`${msg?.add} is not in ${path.basename(file)}`);
    return { lines: added(msg.add, p).map(l => l[1]) };
  }).then(s => app.on('will-quit', () => s.close()), e => log(null, [['bad', `nstack add from a terminal will start a new shell: ${e.message}`]]));
  setInterval(thumbs, THUMB_MS);
});

app.on('window-all-closed', () => app.quit());
