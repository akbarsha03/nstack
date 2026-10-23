import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, WebContentsView, ipcMain, type Rectangle } from 'electron';
import type { Config } from '../config.js';
import { parseDevice, type Device } from '../devices.js';
import { tileGrid, nextSpace, spaceForKey, fitFrames, inset } from './spaces.js';
import { keepSessionCookies, emulate, loggedOut } from './persona.js';

const { config, names, dir } = JSON.parse(process.env.NSTACK_UP!) as { config: Config; names: string[]; dir: string };
const nstackDir = path.join(dir, '.nstack');
// per-project profile: each persona's `persist:<name>` partition (cookies, storage) lives under here
app.setPath('userData', path.join(nstackDir, 'electron'));

const stateFile = path.join(nstackDir, 'state.json');
const spaces = ['all', ...names];
let space: string = (() => {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')).space; } catch { return names[0]; }
})();
if (!spaces.includes(space)) space = names[0];

const THUMB_MS = 1500;
let win: BrowserWindow;
let stage: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
const views = new Map<string, WebContentsView>();
const startUrl = (name: string) => config.baseUrl.replace(/\/$/, '') + config.personas[name].start;

const devices = new Map<string, Device>(names.map(n => [n, parseDevice(config.personas[n].device)!]));
const out = new Set<string>(); // personas the app bounced to loginPath

function layout() {
  const all = space === 'all';
  // hidden views keep their single-space size so their thumbnails render at a real size
  const single = names.map(n => fitFrames([inset(stage, 16)], [devices.get(n)!])[0]);
  const frames = all ? fitFrames(tileGrid(stage, names.length, 16), names.map(n => devices.get(n)!), true) : single;
  names.forEach((name, i) => {
    const v = views.get(name)!, f = frames[i];
    v.setBounds(f.view);
    v.setVisible((all || name === space) && !out.has(name));
    emulate(v.webContents, devices.get(name)!, f.scale);
  });
  win.webContents.send('nstack:frames', names.map((name, i) => {
    const d = devices.get(name)!;
    return { name, device: config.personas[name].device, size: `${d.width}×${d.height}`, rect: frames[i].frame, shown: all || name === space, out: out.has(name) };
  }));
}

function goTo(id: string) {
  if (!spaces.includes(id)) return;
  space = id;
  layout();
  win.setTitle(`nstack · ${id === 'all' ? 'All' : id}`);
  win.webContents.send('nstack:space', id);
  (id === 'all' ? win.webContents : views.get(id)!.webContents).focus();
  try { fs.writeFileSync(stateFile, JSON.stringify({ space })); } catch {}
}

const onKey = (key: string) => {
  const id = key === 'ArrowRight' ? nextSpace(spaces, space, 1) : key === 'ArrowLeft' ? nextSpace(spaces, space, -1) : spaceForKey(names, key);
  if (id && id !== space) goTo(id);
};

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
      console.error(`${name.padEnd(10)} logged out — run \`nstack login ${name}\``);
      layout();
    }
    at = to;
  };
  v.webContents.on('did-start-navigation', d => { if (d.isMainFrame && !d.isSameDocument) from = d.url; });
  v.webContents.on('did-navigate', (_e, url) => check(url));
  v.webContents.on('did-navigate-in-page', (_e, url, isMain) => { if (isMain) { from = at; check(url); } });
}

app.whenReady().then(() => {
  fs.mkdirSync(nstackDir, { recursive: true });
  win = new BrowserWindow({
    width: 1440, height: 960, backgroundColor: '#0c0f13', title: 'nstack',
    webPreferences: { preload: path.join(__dirname, 'shell-preload.js') },
  });
  win.loadFile(path.join(__dirname, '..', '..', '..', 'renderer', 'index.html'));

  for (const name of names) {
    const v = new WebContentsView({
      webPreferences: { partition: `persist:${name}`, preload: path.join(__dirname, 'persona-preload.js'), backgroundThrottling: false },
    });
    v.setVisible(false);
    const d = devices.get(name)!;
    if (d.userAgent) v.webContents.setUserAgent(d.userAgent);
    keepSessionCookies(v.webContents);
    watchLogin(name, v);
    win.contentView.addChildView(v);
    v.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (isMain && code !== -3) console.error(`${name.padEnd(10)} could not load ${url}: ${desc}`);
    });
    // the DevTools protocol needs a live page to answer, so emulate on a blank one, then go
    v.webContents.loadURL('about:blank').then(() => emulate(v.webContents, d, 1)).then(() => v.webContents.loadURL(startUrl(name))).catch(() => {})
      .then(() => v.webContents.navigationHistory.clear()); // no Back to the blank page
    views.set(name, v);
    console.log(`${name.padEnd(10)} ${config.personas[name].device.padEnd(9)} ${`${d.width}×${d.height}`.padEnd(9)} → ${startUrl(name)}`);
  }
  console.log(`${names.length} spaces + All · showing ${space} · close the window or Ctrl+C to quit`);

  ipcMain.on('nstack:ready', () => {
    win.webContents.send('nstack:init', { baseUrl: config.baseUrl, personas: names.map(n => ({ name: n, device: config.personas[n].device })), space });
    goTo(space);
  });
  ipcMain.on('nstack:stage', (_e, r: Rectangle) => { stage = r; layout(); });
  ipcMain.on('nstack:go', (_e, id: string) => goTo(id));
  ipcMain.on('nstack:key', (_e, key: string) => onKey(key));
  setInterval(thumbs, THUMB_MS);
});

app.on('window-all-closed', () => app.quit());
