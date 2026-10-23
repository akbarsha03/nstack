import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, WebContentsView, ipcMain, type Rectangle } from 'electron';
import type { Config } from '../config.js';
import { tileGrid, nextSpace, spaceForKey } from './spaces.js';

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

function layout() {
  if (space === 'all') {
    tileGrid(stage, names.length).forEach((r, i) => {
      const v = views.get(names[i])!;
      v.setBounds(r);
      v.setVisible(true);
    });
  } else {
    // hidden views keep full-stage bounds so their thumbnails render at a real size
    for (const [name, v] of views) {
      v.setBounds(stage);
      v.setVisible(name === space);
    }
  }
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
    if (v.getBounds().width === 0) continue;
    try {
      const img = await v.webContents.capturePage(undefined, { stayHidden: true });
      if (!img.isEmpty()) win.webContents.send('nstack:thumb', name, img.resize({ height: 124 }).toDataURL());
    } catch {}
  }
}

// Chromium drops cookies without an expiry on quit, which would log out e.g. a default Rails session on every
// restart. Give them 30 days so "log in once" holds; the app can still clear them by logging out.
function keepSessionCookies(v: WebContentsView) {
  const { cookies } = v.webContents.session;
  cookies.on('changed', (_e, c, _cause, removed) => {
    if (removed || !c.session || !c.domain) return;
    cookies.set({
      url: `http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path ?? '/'}`,
      name: c.name, value: c.value, domain: c.hostOnly ? undefined : c.domain, path: c.path,
      secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: Date.now() / 1000 + 30 * 86400,
    }).catch(() => {});
  });
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
    keepSessionCookies(v);
    win.contentView.addChildView(v);
    v.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (isMain && code !== -3) console.error(`${name.padEnd(10)} could not load ${url}: ${desc}`);
    });
    v.webContents.loadURL(startUrl(name));
    views.set(name, v);
    console.log(`${name.padEnd(10)} ${config.personas[name].device.padEnd(9)} → ${startUrl(name)}`);
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
