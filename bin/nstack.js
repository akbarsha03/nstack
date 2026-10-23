#!/usr/bin/env node
// nstack 0.0.1-mock: only `nstack mock` works. The real CLI is specced in docs/MVP.md.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HELP = `nstack 0.0.1-mock: open your web app as several users at several screen sizes

Usage: nstack [command]

  mock                       Serve and open the clickable UI mock (default)

Planned (not built yet, see docs/MVP.md):
  init                       Write sample nstack.yml, install Chromium
  login <persona> | --all    Log in by hand once, save session to .nstack/<persona>.json
  up [personas...] [--sync]  Open every persona in its own window, tiled
  shot [path]                Screenshot every persona to .nstack/shots/<persona>.png
  reset [persona]            Delete saved sessions
`;

const cmd = process.argv[2] || 'mock';

if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
  process.stdout.write(HELP);
} else if (cmd === 'mock') {
  serve();
} else if (['init', 'login', 'up', 'shot', 'reset'].includes(cmd)) {
  console.error(`nstack ${cmd}: not built yet, see docs/MVP.md. Try \`nstack mock\`.`);
  process.exit(1);
} else {
  console.error(`unknown command: ${cmd}\n`);
  process.stderr.write(HELP);
  process.exit(1);
}

function serve() {
  const root = path.join(__dirname, '..', 'mock');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(body);
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.log(`nstack mock running at ${url}  (Ctrl+C to stop)`);
    if (!process.env.NSTACK_NO_OPEN) open(url);
  });
}

function open(url) {
  const [bin, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  const child = spawn(bin, args, { stdio: 'ignore', detached: true });
  child.on('error', () => console.log(`could not open a browser, visit ${url}`));
  child.unref();
}
