import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import type { Config } from '../config.js';
import { parseDevice } from '../devices.js';
import { keepSessionCookies, loggedIn, onLoginPage } from './persona.js';

// `nstack login`: one window per persona on its partition, in turn; done once the app lets us off loginPath
const { config, names, dir } = JSON.parse(process.env.NSTACK_UP!) as { config: Config; names: string[]; dir: string };
app.setPath('userData', path.join(dir, '.nstack', 'electron')); // same profile as `nstack up`
const loginUrl = config.baseUrl.replace(/\/$/, '') + config.loginPath;

// fill every selector the way typing would (so React/Vue see it), then click submit
const fillScript = (login: NonNullable<Config['personas'][string]['login']>) => `(() => {
  for (const [sel, value] of Object.entries(${JSON.stringify(login.fill)})) {
    const el = document.querySelector(sel);
    if (!el) return 'no element for ' + sel;
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    set ? set.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const btn = document.querySelector(${JSON.stringify(login.submit)});
  if (!btn) return 'no element for ' + ${JSON.stringify(login.submit)};
  btn.click();
  return '';
})()`;

function login(name: string): Promise<boolean> {
  const p = config.personas[name], d = parseDevice(p.device)!;
  const win = new BrowserWindow({ width: d.width, height: d.height, title: `nstack login · ${name}`, webPreferences: { partition: `persist:${name}` } });
  const wc = win.webContents;
  if (d.userAgent) wc.setUserAgent(d.userAgent);
  const flush = keepSessionCookies(wc);
  let tried = false, finished = false;
  return new Promise(resolve => {
    const done = async (url: string) => {
      if (finished || !loggedIn(url, config.baseUrl, config.loginPath)) return;
      finished = true;
      await flush();
      console.log(`${name.padEnd(10)} logged in → session saved`);
      win.removeAllListeners('closed');
      win.destroy();
      resolve(true);
    };
    wc.on('did-navigate', (_e, url) => done(url));
    wc.on('did-navigate-in-page', (_e, url, isMain) => { if (isMain) done(url); });
    wc.on('did-finish-load', async () => {
      // scripted login runs once; if it does not get us in, the window stays open for a hand login
      if (!p.login || tried || !onLoginPage(wc.getURL(), config.baseUrl, config.loginPath)) return;
      tried = true;
      const err = await wc.executeJavaScript(fillScript(p.login)).catch((e: Error) => e.message);
      if (err) console.error(`${name.padEnd(10)} scripted login failed (${err}), log in by hand`);
    });
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (isMain && code !== -3) console.error(`${name.padEnd(10)} could not load ${url}: ${desc}`);
    });
    win.on('closed', () => {
      console.error(`${name.padEnd(10)} window closed before login, session not saved`);
      resolve(false);
    });
    console.log(`${name.padEnd(10)} opened ${loginUrl}, ${p.login ? 'logging in from nstack.yml' : 'log in by hand'}…`);
    win.loadURL(loginUrl);
  });
}

app.on('window-all-closed', () => {}); // windows open one after another; quit is explicit below
app.whenReady().then(async () => {
  let ok = true;
  for (const name of names) ok = (await login(name)) && ok;
  app.exit(ok ? 0 : 1);
});
