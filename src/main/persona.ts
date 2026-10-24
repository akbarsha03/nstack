import type { WebContents } from 'electron';
import type { Device } from '../devices.js';

// Chromium drops cookies without an expiry on quit, which would log out e.g. a default Rails session on every
// restart. Give them 30 days so "log in once" holds; the app can still clear them by logging out.
// Returns a function that resolves once every rewrite so far has landed (call before flushing / quitting).
export function keepSessionCookies(wc: WebContents) {
  const { cookies } = wc.session;
  const pending = new Set<Promise<void>>();
  cookies.on('changed', (_e, c, _cause, removed) => {
    if (removed || !c.session || !c.domain) return;
    const p = cookies.set({
      url: `http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path ?? '/'}`,
      name: c.name, value: c.value, domain: c.hostOnly ? undefined : c.domain, path: c.path,
      secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: Date.now() / 1000 + 30 * 86400,
    }).catch(() => {}).finally(() => pending.delete(p));
    pending.add(p);
  });
  return async () => { await Promise.all(pending); await cookies.flushStore(); };
}

// viewport, DPR, mobile viewport rules and touch at the given on-screen scale, through the DevTools protocol (what
// Chrome's device toolbar does). enableDeviceEmulation ignores <meta viewport> here, so phones lay out at 980px.
// Await it before the first load: touch support is fixed when a document is created. Call again when the scale changes.
// dontSetVisibleSize: without it Chromium resizes the render widget to the unscaled device size; Linux clips that to the
// view's bounds, macOS does not, so the page painted past its frame over the shell. The view stays at bounds = device × scale.
export async function emulate(wc: WebContents, d: Device, scale: number) {
  const dbg = wc.debugger;
  try { if (!dbg.isAttached()) dbg.attach('1.3'); } catch { return; }
  const send = (cmd: string, params: object) => dbg.sendCommand(cmd, params).catch(() => {});
  await Promise.all([
    send('Emulation.setDeviceMetricsOverride', {
      width: d.width, height: d.height, deviceScaleFactor: d.dpr, mobile: d.touch, scale, screenWidth: d.width, screenHeight: d.height, dontSetVisibleSize: true,
      // phones and tablets report how they are held (a rotated one is wider than tall)
      ...(d.touch && { screenOrientation: d.width > d.height ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } }),
    }),
    send('Emulation.setTouchEmulationEnabled', { enabled: d.touch, maxTouchPoints: d.touch ? 5 : 1 }),
    send('Emulation.setEmitTouchEventsForMouse', { enabled: d.touch, configuration: 'mobile' }),
  ]);
}

// a URL on the app's own origin under loginPath
export function onLoginPage(url: string, baseUrl: string, loginPath: string) {
  try {
    const u = new URL(url);
    return u.origin === new URL(baseUrl).origin && (u.pathname === loginPath || u.pathname.startsWith(loginPath.replace(/\/?$/, '/')));
  } catch {
    return false;
  }
}

// logged out = a navigation that started off the login page ended on it (the app redirected us there)
export const loggedOut = (from: string, to: string, baseUrl: string, loginPath: string) =>
  onLoginPage(to, baseUrl, loginPath) && !onLoginPage(from, baseUrl, loginPath);

// logged in = on the app's origin and off the login page
export const loggedIn = (url: string, baseUrl: string, loginPath: string) =>
  url.startsWith(new URL(baseUrl).origin + '/') && !onLoginPage(url, baseUrl, loginPath);
