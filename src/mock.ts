import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// serves the approved UI mock (mock/index.html), the design reference for the shell
export function serveMock() {
  const root = path.join(__dirname, '..', '..', 'mock');
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(body);
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    console.log(`nstack mock running at ${url}  (Ctrl+C to stop)`);
    if (!process.env.NSTACK_NO_OPEN) open(url);
  });
}

function open(url: string) {
  const [bin, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  const child = spawn(bin as string, args as string[], { stdio: 'ignore', detached: true });
  child.on('error', () => console.log(`could not open a browser, visit ${url}`));
  child.unref();
}
