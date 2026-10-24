import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import type { Config } from '../config.js';
import { parseDevice, rotated, PRESETS, type Device } from '../devices.js';
import { emulate, loggedOut } from './persona.js';
import { partition } from '../aliases.js';

// png: absolute path; file: the same as shown to people (relative to the project when inside it, else ~); dir: the run folder, shown the same way
export type Shot = { name: string; status: 'ok' | 'out' | 'fail'; line: string; dir: string; png?: string; file?: string; width?: number; height?: number };

const pad = (s: string, n = 10) => s.padEnd(n);
// `path` as typed, or the root; always app-relative so each persona stays on its own user
export const shotPath = (p: string | undefined) => !p ? '/' : p.startsWith('/') ? p : '/' + p;

// a path as a folder-name suffix: /storage/search?q=og → storage-search-q-og
export const slug = (p: string) => p.replace(/[^a-z0-9]+/gi, '-').replace(/^-+/, '').slice(0, 40).replace(/-+$/, '');

// one folder per run: 2026-10-24-0712, or 2026-10-24-0712-storage-search when a path was given (local time)
export function runName(t: Date, at?: string) {
  const n = (x: number) => String(x).padStart(2, '0');
  const stamp = `${t.getFullYear()}-${n(t.getMonth() + 1)}-${n(t.getDate())}-${n(t.getHours())}${n(t.getMinutes())}`;
  const s = at ? slug(at) : '';
  return s ? `${stamp}-${s}` : stamp;
}

// admin-desktop-1440x900@1x.png; a WxH device is labelled custom
export const deviceLabel = (device: string) => Object.hasOwn(PRESETS, device) ? device : 'custom';
export const shotFile = (name: string, device: string, d: Device) => `${name}-${deviceLabel(device)}-${d.width}x${d.height}@${d.dpr}x.png`;

export type Row = { persona: string; device: string; d: Device; url: string; status: string; file?: string; image?: { width: number; height: number } };

// README.md of a run folder: what each image is, for a person or an agent reading the folder
export function manifest(o: { time: Date; baseUrl: string; at?: string; rows: Row[] }) {
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  return [
    `# nstack shot · ${o.time.toISOString()} · ${o.baseUrl}`,
    '',
    `Path: \`${shotPath(o.at)}\``,
    '',
    '| File | Persona | Device | Orientation | Viewport (CSS px) | Pixel ratio | Image size (px) | Touch / mobile UA | URL | Status |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...o.rows.map(r => '| ' + [
      r.file ?? '—', r.persona, r.device, r.d.width > r.d.height ? 'landscape' : 'portrait', `${r.d.width}×${r.d.height}`, `${r.d.dpr}`, r.image ? `${r.image.width}×${r.image.height}` : '—',
      `${r.d.touch ? 'touch' : 'no touch'} / ${r.d.userAgent ? 'mobile UA' : 'desktop UA'}`, r.url, r.status,
    ].map(cell).join(' | ') + ' |'),
    '',
    '## How to read these',
    '',
    'Each persona is a separate logged-in session of the same app, shot at the path above. The page is laid out at the',
    "device's viewport in CSS px and rendered at its pixel ratio (so media queries and srcset match the device); the PNG is",
    'saved at the viewport size, which is the image size column. Mobile devices use a mobile user agent and touch input.',
    'A persona with no file was skipped; its status says why.',
    '',
  ].join('\n');
}

// `nstack shot`: each persona in its own hidden offscreen window at its real viewport size, so the open spaces are
// left where they are. Same partition (aliases.ts) = same login. Each run gets its own folder under `shots`
// (default .nstack/shots): one PNG per persona plus a README.md describing them.
export async function shoot(config: Config, names: string[], dir: string, at?: string, skip = new Set<string>(), shots = path.join(dir, '.nstack', 'shots'), landscape = new Set<string>()): Promise<Shot[]> {
  const time = new Date(), show = (p: string) => path.relative(dir, p).startsWith('..') ? p.replace(os.homedir(), '~') : path.relative(dir, p);
  fs.mkdirSync(shots, { recursive: true });
  let run = path.join(shots, runName(time, at));
  for (let i = 2; ; i++) {
    try { fs.mkdirSync(run); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    run = path.join(shots, `${runName(time, at)}-${i}`);
  }
  const out: Shot[] = [], rows: Row[] = [];
  for (const name of names) {
    const device = config.personas[name].device, d = (landscape.has(name) ? rotated : (x: Device) => x)(parseDevice(device)!), file = path.join(run, shotFile(name, device, d)), rel = show(file);
    const url = config.baseUrl.replace(/\/$/, '') + shotPath(at);
    const row = { persona: name, device, d, url };
    const gone = (): Shot => {
      rows.push({ ...row, status: 'logged out' });
      return { name, status: 'out', dir: show(run), line: `${pad(name)} logged out — run nstack login ${name}` };
    };
    if (skip.has(name)) { out.push(gone()); continue; }
    const win = new BrowserWindow({
      show: false, width: d.width, height: d.height, useContentSize: true,
      webPreferences: { partition: partition(dir, name), offscreen: true, backgroundThrottling: false },
    });
    const wc = win.webContents;
    let painted = false;
    wc.on('paint', () => { painted = true; });
    try {
      if (d.userAgent) wc.setUserAgent(d.userAgent);
      await wc.loadURL('about:blank');
      await emulate(wc, d, 1);
      await wc.loadURL(url);
      // let client-side redirects and late paints land
      await new Promise(r => setTimeout(r, 500));
      if (wc.isLoading()) await new Promise<void>(r => wc.once('did-stop-loading', () => r()));
      if (loggedOut(url, wc.getURL(), config.baseUrl, config.loginPath)) { out.push(gone()); continue; }
      // capturing before the first frame fails (UnknownVizError under xvfb); wait for one, then retry once
      if (!painted) await Promise.race([new Promise(r => wc.once('paint', r)), new Promise(r => setTimeout(r, 5000))]);
      let img = await wc.capturePage().catch(() => new Promise(r => setTimeout(r, 1000)).then(() => wc.capturePage()));
      const s = img.getSize();
      if (s.width !== d.width || s.height !== d.height) img = img.resize({ width: d.width, height: d.height, quality: 'best' });
      fs.writeFileSync(file, img.toPNG());
      rows.push({ ...row, url: wc.getURL(), status: 'ok', file: path.basename(file), image: img.getSize() });
      out.push({ name, status: 'ok', dir: show(run), png: file, file: rel, width: d.width, height: d.height, line: `${pad(name)} → ${rel}  ${d.width}×${d.height}  ${new URL(wc.getURL()).pathname}` });
    } catch (e) {
      rows.push({ ...row, status: `failed: ${(e as Error).message}` });
      out.push({ name, status: 'fail', dir: show(run), line: `${pad(name)} could not shoot ${url}: ${(e as Error).message}` });
    } finally {
      win.destroy();
    }
  }
  fs.writeFileSync(path.join(run, 'README.md'), manifest({ time, baseUrl: config.baseUrl, at, rows }));
  return out;
}
