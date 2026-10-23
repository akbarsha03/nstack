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

// /a is where persona a starts; a moment later its SPA router pushes /p twice (one click, two in-page navigations).
// /p, like a real app, rewrites its own URL on load: a follower that echoed that would bounce everyone again.
const PAGES: Record<string, string> = {
  '/a': '<script>setTimeout(() => { history.pushState({}, "", "/p"); history.pushState({}, "", "/p?x=1") }, 3000)</script>',
  '/b': 'b', '/c': 'c',
  '/p': '<script>history.replaceState({}, "", location.pathname + location.search + "&tab=1")</script>',
};

test('nstack up --sync: A to /p moves B and C there exactly once, no ping-pong', e2e, async () => {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url!);
    const body = PAGES[new URL(req.url!, 'http://x').pathname];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' }).end(`<!doctype html><body>${body ?? 'not found'}`);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nstack-sync-'));
  fs.writeFileSync(path.join(dir, 'nstack.yml'), `baseUrl: http://127.0.0.1:${(server.address() as { port: number }).port}
loginPath: /login
personas:
  a: { device: desktop, start: /a }
  b: { device: iphone-15, start: /b }
  c: { device: 1000x700, start: /c }
`);
  let out = '';
  const up = spawn(process.execPath, [BIN, 'up', '--sync'], { cwd: dir });
  up.stdout.on('data', d => { out += d; });
  up.stderr.on('data', d => { out += d; });
  try {
    const until = Date.now() + 60_000;
    while (!out.includes('sync /p?x=1 from a')) {
      assert.ok(Date.now() < until, `never synced:\n${out}`);
      await wait(250);
    }
    await wait(5000); // long enough for any echo to come back round
    const pages = hits.filter(h => !h.startsWith('/favicon'));
    assert.deepEqual(pages.filter(h => h.startsWith('/p')), ['/p?x=1', '/p?x=1'], `${pages}\n${out}`);
    assert.deepEqual(pages.filter(h => !h.startsWith('/p')).sort(), ['/a', '/b', '/c'], `${pages}`);
    assert.equal(out.match(/\(sync\)/g)?.length, 2, out);
  } finally {
    up.kill('SIGINT');
    await new Promise(r => up.once('exit', r));
    server.close();
  }
});
