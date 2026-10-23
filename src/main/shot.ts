import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import type { Config } from '../config.js';
import { parseDevice } from '../devices.js';
import { emulate, loggedOut } from './persona.js';

export type Shot = { name: string; status: 'ok' | 'out' | 'fail'; line: string; png?: string; width?: number; height?: number };

const pad = (s: string, n = 10) => s.padEnd(n);
// `path` as typed, or the persona's start; always app-relative so each persona stays on its own user
export const shotPath = (p: string | undefined, start: string) => !p ? start : p.startsWith('/') ? p : '/' + p;

// `nstack shot`: each persona in its own hidden offscreen window at its real viewport size, so the open spaces are
// left where they are. Same `persist:<name>` partition = same login. Writes .nstack/shots/<name>.png.
export async function shoot(config: Config, names: string[], dir: string, at?: string, skip = new Set<string>()): Promise<Shot[]> {
  const shots = path.join(dir, '.nstack', 'shots');
  fs.mkdirSync(shots, { recursive: true });
  const out: Shot[] = [];
  for (const name of names) {
    const d = parseDevice(config.personas[name].device)!, rel = `.nstack/shots/${name}.png`, file = path.join(shots, `${name}.png`);
    const url = config.baseUrl.replace(/\/$/, '') + shotPath(at, config.personas[name].start);
    const gone = (): Shot => {
      fs.rmSync(file, { force: true }); // a stale shot of this persona would pass for a fresh one
      return { name, status: 'out', line: `${pad(name)} logged out — run nstack login ${name}` };
    };
    if (skip.has(name)) { out.push(gone()); continue; }
    const win = new BrowserWindow({
      show: false, width: d.width, height: d.height, useContentSize: true,
      webPreferences: { partition: `persist:${name}`, offscreen: true, backgroundThrottling: false },
    });
    const wc = win.webContents;
    try {
      if (d.userAgent) wc.setUserAgent(d.userAgent);
      await wc.loadURL('about:blank');
      await emulate(wc, d, 1);
      await wc.loadURL(url);
      // let client-side redirects and late paints land
      await new Promise(r => setTimeout(r, 500));
      if (wc.isLoading()) await new Promise<void>(r => wc.once('did-stop-loading', () => r()));
      if (loggedOut(url, wc.getURL(), config.baseUrl, config.loginPath)) { out.push(gone()); continue; }
      let img = await wc.capturePage();
      const s = img.getSize();
      if (s.width !== d.width || s.height !== d.height) img = img.resize({ width: d.width, height: d.height, quality: 'best' });
      fs.writeFileSync(file, img.toPNG());
      out.push({ name, status: 'ok', png: file, width: d.width, height: d.height, line: `${pad(name)} → ${rel}  ${d.width}×${d.height}  ${new URL(wc.getURL()).pathname}` });
    } catch (e) {
      out.push({ name, status: 'fail', line: `${pad(name)} could not load ${url}: ${(e as Error).message}` });
    } finally {
      win.destroy();
    }
  }
  return out;
}
