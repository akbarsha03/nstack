import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { send } from '../src/ipc.js';

// drives the real Electron shell, so it needs the electron binary and a display (CI: xvfb-run). NSTACK_E2E=1 to run.
const e2e = { skip: !process.env.NSTACK_E2E && 'set NSTACK_E2E=1 (needs electron + a display)' };
const BIN = path.join(__dirname, '..', '..', 'bin', 'nstack.js');

// a static demo app: /private bounces to /login the way an app does for a logged-out user
const PAGES: Record<string, string> = {
  '/x': '<h1>demo /x</h1>',
  '/private': '<script>location.replace("/login")</script>',
  '/login': '<form><input name=email><button>Sign in</button></form>',
};
const png = (file: string) => { const b = fs.readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('nstack shot: one PNG per persona at its real viewport size, logged-out personas skipped', e2e, async () => {
  const server = http.createServer((req, res) => {
    const body = PAGES[req.url!];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' }).end(`<!doctype html><body style="background:#5eead4">${body ?? 'not found'}`);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nstack-shot-'));
  fs.writeFileSync(path.join(dir, 'nstack.yml'), `baseUrl: http://127.0.0.1:${(server.address() as { port: number }).port}
loginPath: /login
personas:
  phone: { device: iphone-15 }
  desk: { device: desktop }
  odd: { device: 1000x700 }
`);
  // async: spawnSync would block the demo server in this same process
  const run = (...args: string[]) => new Promise<{ code: number | null; out: string }>(resolve => {
    const c = spawn(process.execPath, [BIN, 'shot', ...args], { cwd: dir, timeout: 90_000 });
    let out = '';
    c.stdout.on('data', d => { out += d; });
    c.stderr.on('data', d => { out += d; });
    c.on('close', code => resolve({ code, out }));
  });
  // each run writes .nstack/shots/<stamp>-<path slug>[-n]/<persona>-<device>-<WxH>@<dpr>x.png plus a README.md
  const sizes = { phone: [393, 852], desk: [1440, 900], odd: [1000, 700] };
  const expectShots = (r: { code: number | null; out: string }) => {
    assert.equal(r.code, 0, r.out);
    for (const [n, wh] of Object.entries(sizes)) {
      const m = r.out.match(new RegExp(`${n} +→ (\\.nstack/shots/[0-9-]+-x(?:-\\d+)?/${n}-[a-z0-9-]+-${wh[0]}x${wh[1]}@[0-9.]+x\\.png)  ${wh[0]}×${wh[1]}  /x`));
      assert.ok(m, r.out);
      assert.deepEqual(png(path.join(dir, m[1])), wh, n);
      assert.ok(fs.existsSync(path.join(dir, path.dirname(m[1]), 'README.md')));
    }
  };
  let up: ReturnType<typeof spawn> | undefined;
  try {
    // no shell running: a headless shell shoots and exits
    expectShots(await run('/x'));
    const r = await run('/private');
    assert.equal(r.code, 0, r.out);
    for (const n of Object.keys(sizes)) {
      assert.match(r.out, new RegExp(`${n} +logged out — run nstack login ${n}`));
    }

    // with `nstack up` running in the folder, the shell takes the shot
    up = spawn(process.execPath, [BIN, 'up'], { cwd: dir, stdio: 'ignore' });
    const until = Date.now() + 60_000;
    while (!(await send(dir, { ping: 1 }).catch(() => undefined))) {
      assert.ok(Date.now() < until, 'nstack up never opened its socket');
      await new Promise(r => setTimeout(r, 250));
    }
    const reply = await send(dir, { shot: '/x' });
    assert.deepEqual(reply.shots.map((s: { status: string }) => s.status), ['ok', 'ok', 'ok'], JSON.stringify(reply));
    expectShots(await run('/x'));
  } finally {
    const u = up;
    if (u) { u.kill('SIGINT'); await new Promise(r => u.once('exit', r)); }
    server.close();
  }
});
