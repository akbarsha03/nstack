import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// one socket per project folder, so `nstack add` finds the shell `nstack up` opened there.
// Kept out of the project dir: a unix socket path is capped at ~104 bytes. Hashes the real path, so a symlinked folder
// (macOS /var → /private/var, where the shell's cwd comes back resolved) finds the same shell.
export function socketPath(dir: string) {
  let real = path.resolve(dir);
  try { real = fs.realpathSync.native(real); } catch {}
  const id = createHash('sha1').update(real).digest('hex').slice(0, 12);
  return process.platform === 'win32' ? `\\\\.\\pipe\\nstack-${id}` : path.join(os.tmpdir(), `nstack-${id}.sock`);
}

// one JSON line in, one JSON line back
export type Handler = (msg: any) => Promise<unknown> | unknown;

export function serve(dir: string, handler: Handler): Promise<net.Server> {
  const file = socketPath(dir);
  // ponytail: a stale socket from a crashed shell is removed unchecked; a second shell in the same folder takes it over
  if (process.platform !== 'win32') fs.rmSync(file, { force: true });
  const server = net.createServer(sock => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', async d => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      let reply: unknown;
      try { reply = await handler(JSON.parse(buf.slice(0, nl))); } catch (e) { reply = { error: (e as Error).message }; }
      sock.end(JSON.stringify(reply ?? {}) + '\n');
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve, reject) => server.once('error', reject).listen(file, () => resolve(server)));
}

// the shell's reply, or undefined when no shell is running for this folder
export function send(dir: string, msg: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    let buf = '', connected = false;
    const sock = net.connect(socketPath(dir), () => { connected = true; sock.write(JSON.stringify(msg) + '\n'); });
    sock.setEncoding('utf8');
    sock.on('data', d => { buf += d; });
    sock.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('the running shell sent a bad reply')); } });
    sock.on('error', e => (connected ? reject(e) : resolve(undefined)));
  });
}
