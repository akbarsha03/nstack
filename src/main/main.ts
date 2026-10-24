import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, WebContentsView, dialog, ipcMain, nativeImage, type Rectangle } from 'electron';
import { addPersona, removePersona, renamePersona, quickName, parseConfig, ConfigError, type Config } from '../config.js';
import { parseDevice, rotated, PRESETS, type Device } from '../devices.js';
import { serve } from '../ipc.js';
import { addAlias, partition } from '../aliases.js';
import { nextSpace, spaceForKey, fitFrames, rowFrames, rowWidth, packFrames, inset, reorder, type Frame, type Rect } from './spaces.js';
import { keepSessionCookies, emulate, loggedOut } from './persona.js';
import { login } from './login-window.js';
import { shoot } from './shot.js';
import { createSync, relPath, type SyncPrefs } from './sync.js';

type Persona = Config['personas'][string];
const up = JSON.parse(process.env.NSTACK_UP!) as { config: Config; names: string[]; dir: string; file: string; space?: string; sync?: boolean };
const { config, dir, file } = up;
const nstackDir = path.join(dir, '.nstack');
// per-project profile: each persona's `persist:` partition (aliases.ts keeps a renamed one's) (cookies, storage) lives under here
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
let term = saved.term === true; // terminal pane open; starts collapsed
let tile: 'grid' | 'row' = saved.tile === 'grid' || saved.tile === 'row' ? saved.tile : config.tile;
const saveState = () => { try { fs.writeFileSync(stateFile, JSON.stringify({ space, tile, sync: sync.on, syncPrefs: sync.prefs, order: names, shotDir, landscape: [...landscape], term })); } catch {} };

const THUMB_MS = 1500;
let win: BrowserWindow;
let ready = false;
let stage: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
let covered = false; // a dialog or the yml drawer is open; native views paint above the shell page, so hide them
const views = new Map<string, WebContentsView>();
const nameOf = new Map<WebContentsView, string>(); // a view's current persona name; a rename changes it under live listeners
const devices = new Map<string, Device>();
const out = new Set<string>(); // personas the app bounced to loginPath
const base = config.baseUrl.replace(/\/$/, '');
const home = base + '/'; // every space opens at the app's root
// phones/tablets turned to landscape with the ⟳ in their frame; devices keeps the config device, dims() what is shown
const landscape = new Set<string>(Array.isArray(saved.landscape) ? saved.landscape : []);
const dims = (name: string) => landscape.has(name) ? rotated(devices.get(name)!) : devices.get(name)!;
const size = (name: string) => `${dims(name).width}×${dims(name).height}`;
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
  space, tile, sync: sync.on, syncPrefs: sync.prefs, personas: names.map(n => ({ name: n, device: config.personas[n].device, width: dims(n).width, height: dims(n).height, out: out.has(n) })),
});

// All in row mode scrolls sideways when the row is wider than the stage (not persisted)
let scrollX = 0, scrollMax = 0;
const shift = (r: Rect): Rect => ({ ...r, x: r.x - scrollX });

// scrolling only moves views; emulation (scale) is redone on a real re-layout only
function layout(scrollOnly = false) {
  const all = space === 'all', sizes = names.map(dims);
  // native views paint above the page, so keep 48px clear at each side for the stage's ‹ › arrows (32 here + the 16 gap)
  const room = { ...stage, x: stage.x + 32, width: Math.max(0, stage.width - 64) };
  // hidden views keep their single-space size so their thumbnails render at a real size
  let frames: Frame[] = !all ? sizes.map(d => fitFrames([inset(room, 16)], [d])[0])
    : tile === 'row' ? rowFrames(room, sizes, 16)
    : packFrames(room, sizes, 16);
  const total = all && tile === 'row' ? rowWidth(room, frames, 16) : 0;
  scrollMax = Math.max(0, total - room.width);
  scrollX = Math.round(Math.max(0, Math.min(scrollX, scrollMax)));
  if (scrollMax) frames = frames.map(f => ({ ...f, frame: shift(f.frame), view: shift(f.view), addr: shift(f.addr) }));
  names.forEach((name, i) => {
    const v = views.get(name)!, f = frames[i];
    v.setBounds(f.view);
    v.setVisible((all || name === space) && !out.has(name) && !covered);
    if (!scrollOnly) emulate(v.webContents, dims(name), f.scale);
  });
  win.webContents.send('nstack:scroll', { x: scrollX, max: scrollMax, stage: room.width, total });
  win.webContents.send('nstack:frames', names.map((name, i) => ({
    name, device: config.personas[name].device, size: size(name), rect: frames[i].frame, addr: frames[i].addr, shown: all || name === space, out: out.has(name), touch: devices.get(name)!.touch, landscape: landscape.has(name), url: rel(views.get(name)!.webContents.getURL()),
  })));
}

// one re-layout per frame however fast a swipe or a scrollbar drag sends positions
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
function scrollTo(x: number) {
  if (!scrollMax || !Number.isFinite(x)) return;
  scrollX = x;
  scrollTimer ??= setTimeout(() => { scrollTimer = undefined; layout(true); }, 16);
}

function goTo(id: string) {
  if (!spaces().includes(id)) return;
  if (id !== space) scrollX = 0;
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

// a frame's reload button, ⌘/Ctrl+R: driven, so Sync does not replay a path every space already shows
function reload(who: string[]) {
  who = who.filter(n => views.has(n) && !out.has(n));
  if (!who.length) return;
  for (const n of who) { sync.drive(n); views.get(n)!.webContents.reload(); }
  log(`# reload ${who.join(', ')}`);
}
// ⌘/Ctrl+R anywhere in the window (shell page or a persona's page) reloads the current space, or every one in All,
// never the shell page itself
const reloadKey = (e: Electron.Event, i: Electron.Input) => {
  if (i.type !== 'keyDown' || !(i.meta || i.control) || i.alt || i.key.toLowerCase() !== 'r') return;
  e.preventDefault();
  reload(space === 'all' ? names : [space]);
};

// ⟳ in a phone's or tablet's frame: portrait ↔ landscape (re-emulated by layout())
function rotate(name: string) {
  if (!views.has(name) || !devices.get(name)!.touch) return;
  if (!landscape.delete(name)) landscape.add(name);
  log(`# rotate ${name} → ${landscape.has(name) ? 'landscape' : 'portrait'} ${size(name)}`);
  saveState();
  layout();
  sendState();
}

function setTile(m: string) {
  if (m !== 'grid' && m !== 'row') return;
  tile = m;
  scrollX = 0;
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

function watchLogin(v: WebContentsView) {
  let from = home, at = from;
  const check = (to: string) => {
    const name = nameOf.get(v);
    if (!name) return; // removed
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
  v.webContents.on('did-stop-loading', () => sync.stopped(nameOf.get(v)!));
}

// one isolated view per persona; returns its line for the terminal
function open(name: string): Line {
  const d = parseDevice(config.personas[name].device)!;
  devices.set(name, d);
  const v = new WebContentsView({
    webPreferences: { partition: partition(dir, name), preload: path.join(__dirname, 'persona-preload.js'), backgroundThrottling: false },
  });
  v.setVisible(false);
  if (d.userAgent) v.webContents.setUserAgent(d.userAgent);
  keepSessionCookies(v.webContents);
  nameOf.set(v, name);
  watchLogin(v);
  v.webContents.on('before-input-event', reloadKey);
  win.contentView.addChildView(v);
  v.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (isMain && code !== -3) log(null, [['bad', `${pad(nameOf.get(v)!)} could not load ${url}: ${desc}`]]);
  });
  views.set(name, v);
  // the DevTools protocol needs a live page to answer, so emulate on a blank one, then go
  load(name, 'about:blank').then(() => emulate(v.webContents, dims(name), 1)).then(() => load(nameOf.get(v)!, home))
    .then(() => v.webContents.navigationHistory.clear()); // no Back to the blank page
  return ['', `${pad(name)} ${pad(config.personas[name].device, 9)} ${pad(size(name), 9)} → ${home}`];
}

const addCmd = (name: string, p: { device: string }) => `nstack add ${name} --device ${p.device}`;

// a persona already written to nstack.yml (by the CLI or by the + tile) gets its space
function added(name: string, p: Persona): Line[] {
  if (views.has(name)) throw new ConfigError(`${name} is already open`);
  config.personas[name] = p;
  const view = open(name);
  names.push(name);
  const lines: Line[] = [['dim', `added personas.${name} to ${path.basename(file)} · ${size(name)}`], view];
  log(addCmd(name, p), lines);
  goTo(name);
  win.show();
  return lines;
}

// a persona already cut from nstack.yml (by the CLI or the strip's ×) loses its space; its session stays on disk
function removed(name: string): Line[] {
  const v = views.get(name);
  if (!v && !names.includes(name)) throw new ConfigError(`${name} is not open here`);
  if (v) { win.contentView.removeChildView(v); v.webContents.close(); nameOf.delete(v); }
  views.delete(name); devices.delete(name); out.delete(name); landscape.delete(name); delete config.personas[name];
  if (names.includes(name)) names.splice(names.indexOf(name), 1);
  const { [name]: _, ...follow } = sync.prefs.follow;
  sync.setPrefs({ follow });
  const lines: Line[] = [['dim', `removed personas.${name} from ${path.basename(file)} · session kept in .nstack/`]];
  log(`nstack remove ${name}`, lines);
  if (space === name) goTo(names.length === 1 ? names[0] : 'all');
  else { layout(); sendState(); saveState(); }
  return lines;
}

// a persona already renamed in nstack.yml (by the CLI or the tile menu): same view, same login, new name everywhere
function renamed(from: string, to: string): Line[] {
  if (!names.includes(from)) throw new ConfigError(`${from} is not open here`);
  const move = <V>(m: Map<string, V>) => { if (m.has(from)) { m.set(to, m.get(from)!); m.delete(from); } };
  move(views); move(devices);
  nameOf.set(views.get(to)!, to);
  if (out.delete(from)) out.add(to);
  if (landscape.delete(from)) landscape.add(to);
  config.personas[to] = config.personas[from];
  delete config.personas[from];
  names[names.indexOf(from)] = to;
  const { [from]: f, ...follow } = sync.prefs.follow;
  sync.setPrefs({ follow: f === undefined ? follow : { ...follow, [to]: f } });
  if (space === from) space = to;
  addAlias(dir, from, to);
  const lines: Line[] = [['dim', `renamed personas.${from} → ${to} in ${path.basename(file)} · login kept`]];
  log(`nstack rename ${from} ${to}`, lines);
  layout();
  sendState();
  saveState();
  if (space === to) win.setTitle(`nstack · ${to}`);
  return lines;
}

const busy = new Set<string>();
async function logIn(name: string) {
  if (busy.has(name)) return;
  busy.add(name);
  log(`nstack login ${name}`);
  const ok = await login(config, name, partition(dir, name), (c, t) => log(null, [[c, t]]));
  busy.delete(name);
  if (!ok) return;
  out.delete(name);
  load(name, home);
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
    const shots = await shoot(config, names, dir, at, out, to, landscape);
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
  win.webContents.on('before-input-event', reloadKey);

  log('nstack up' + (sync.on ? ' --sync' : ''), [['dim', `config ${path.basename(file)} · baseUrl ${config.baseUrl}`], ...names.map(open)]);
  log(null, [['dim', `${names.length} spaces + All · showing ${space} · sync ${sync.on ? 'on' : 'off'} · close the window or Ctrl+C to quit`]]);

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'));
  ipcMain.on('nstack:ready', () => {
    ready = true;
    win.webContents.send('nstack:init', {
      version: pkg.version, baseUrl: config.baseUrl, file: path.basename(file), dir: dir.replace(os.homedir(), '~'),
      presets: Object.entries(PRESETS).map(([k, d]) => [k, d.width, d.height]), term,
    });
    win.webContents.send('nstack:log', history);
    goTo(space);
  });
  ipcMain.on('nstack:stage', (_e, r: Rectangle) => { stage = r; layout(); });
  ipcMain.on('nstack:go', (_e, id: string) => goTo(id));
  ipcMain.on('nstack:key', (_e, key: string) => onKey(key));
  ipcMain.on('nstack:reorder', (_e, order: string[]) => setOrder(order));
  ipcMain.on('nstack:term', (_e, open: boolean) => { term = open === true; saveState(); });
  // the stage's scrollbar (absolute x) and sideways swipes / Shift+wheel, from the shell page or inside a persona's page
  ipcMain.on('nstack:scroll', (_e, x: number) => scrollTo(Number(x)));
  ipcMain.on('nstack:wheel', (_e, w: { dx: number; dy: number; shift: boolean }) => {
    if (space === 'all' && tile === 'row') scrollTo(scrollX + Number(w.shift && !w.dx ? w.dy : w.dx));
  });
  ipcMain.on('nstack:reload', (_e, name: string) => reload([name]));
  ipcMain.on('nstack:rotate', (_e, name: string) => rotate(name));
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
  // no name = a device shape clicked in the + dialog: pick a free one
  ipcMain.on('nstack:add', (_e, a: { name?: string; device: string; login: boolean }) => {
    a.name ||= quickName(a.device, [...names, ...Object.keys(config.personas)]);
    try {
      const { text, persona } = addPersona(fs.readFileSync(file, 'utf8'), a.name, { device: a.device }, path.basename(file));
      fs.writeFileSync(file, text);
      added(a.name!, persona);
      if (a.login) logIn(a.name!);
    } catch (e) {
      log(addCmd(a.name!, a), [['bad', (e as Error).message]]);
    }
  });
  // Screenshot button: ask for a folder first (native views would paint over the dialog, so hide them meanwhile)
  ipcMain.on('nstack:remove', (_e, name: string) => {
    try {
      fs.writeFileSync(file, removePersona(fs.readFileSync(file, 'utf8'), name, path.basename(file)));
      removed(name);
    } catch (e) {
      log(`nstack remove ${name}`, [['bad', (e as Error).message]]);
    }
  });
  ipcMain.on('nstack:rename', (_e, a: { from: string; to: string }) => {
    try {
      fs.writeFileSync(file, renamePersona(fs.readFileSync(file, 'utf8'), a.from, a.to, path.basename(file)));
      renamed(a.from, a.to);
    } catch (e) {
      log(`nstack rename ${a.from} ${a.to}`, [['bad', (e as Error).message]]);
    }
  });
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
  // `nstack add` / `nstack remove` / `nstack rename` / `nstack shot` from a terminal in this folder
  serve(dir, async msg => {
    if (msg && 'shot' in msg) return { shots: (await shot(msg.shot ?? undefined)).map(({ name, status, line }) => ({ name, status, line })) };
    if (typeof msg?.rename?.from === 'string' && typeof msg.rename.to === 'string') return { lines: renamed(msg.rename.from, msg.rename.to).map(l => l[1]) };
    if (typeof msg?.remove === 'string') return { lines: removed(msg.remove).map(l => l[1]) };
    // the CLI already wrote nstack.yml; read the persona from there rather than trusting the socket
    const p = typeof msg?.add === 'string' && parseConfig(fs.readFileSync(file, 'utf8'), process.env, path.basename(file)).personas[msg.add];
    if (!p) throw new Error(`${msg?.add} is not in ${path.basename(file)}`);
    return { lines: added(msg.add, p).map(l => l[1]) };
  }).then(s => app.on('will-quit', () => s.close()), e => log(null, [['bad', `nstack add from a terminal will start a new shell: ${e.message}`]]));
  setInterval(thumbs, THUMB_MS);
});

app.on('window-all-closed', () => app.quit());
