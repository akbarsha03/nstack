import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

// drives the real Electron shell, so it needs the electron binary and a display (CI: xvfb-run). NSTACK_E2E=1 to run.
const e2e = { skip: !process.env.NSTACK_E2E && 'set NSTACK_E2E=1 (needs electron + a display)' };
const BIN = path.join(__dirname, '..', '..', 'bin', 'nstack.js');
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// Chromium skips a history entry the page left without a user gesture, so a page that navigates itself has no Back.
// Sync gives the follower a real one: b (shown, first in the strip) is moved to /p by nstack when a goes there
// (after the sync guard: a navigation within 1.5s of a load counts as a redirect, not the user).
// On b (the mobile one), /p presses ← in a text field (must stay with the field), marks /mark, then presses ← on the
// page itself, which must take b back to / (no-store: no back/forward cache, so the server sees it)
const PAGES: Record<string, string> = {
  '/': '<script>if (!/Mobile/.test(navigator.userAgent) && !sessionStorage.went) { sessionStorage.went = 1; setTimeout(() => location.href = "/p", 3000) }</script>',
  '/p': `<input id="q"><script>if (/Mobile/.test(navigator.userAgent)) {
    const left = el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    setTimeout(() => left(document.getElementById('q')), 1500);
    setTimeout(() => fetch('/mark').then(() => left(document.body)), 3000);
  }</script>`,
  '/mark': '',
};

test('plain ← inside a page goes back in that space, but not while typing in a field', e2e, async () => {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url!);
    const body = PAGES[req.url!];
    res.writeHead(body !== undefined ? 200 : 404, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(`<!doctype html><body>${body ?? 'not found'}`);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nstack-keys-'));
  fs.writeFileSync(path.join(dir, 'nstack.yml'), `baseUrl: http://127.0.0.1:${(server.address() as { port: number }).port}
loginPath: /login
personas:
  b: { device: iphone-15 }
  a: { device: desktop }
`);
  let out = '';
  const up = spawn(process.execPath, [BIN, 'up', '--sync'], { cwd: dir });
  up.stdout.on('data', d => { out += d; });
  up.stderr.on('data', d => { out += d; });
  const pages = () => hits.filter(h => !h.startsWith('/favicon'));
  try {
    const until = Date.now() + 60_000;
    while (!pages().includes('/mark') && Date.now() < until) await wait(250);
    await wait(3000);
    const p = pages(), i = p.indexOf('/mark');
    assert.deepEqual(p.slice(0, i).sort(), ['/', '/', '/p', '/p'], `${p}\n${out}`);
    assert.deepEqual(p.slice(i), ['/mark', '/'], `${p}\n${out}`);
  } finally {
    up.kill('SIGINT');
    await new Promise(r => up.once('exit', r));
    server.close();
  }
});
