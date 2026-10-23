import path from 'node:path';
import { app } from 'electron';
import type { Config } from '../config.js';
import { shoot } from './shot.js';

// `nstack shot` with no shell running in this folder: shoot every persona offscreen, print, exit
const { config, names, dir, path: at } = JSON.parse(process.env.NSTACK_UP!) as { config: Config; names: string[]; dir: string; path?: string };
app.setPath('userData', path.join(dir, '.nstack', 'electron')); // same profile as `nstack up`

app.disableHardwareAcceleration(); // offscreen shots need no GPU, and CI/xvfb has none
app.on('window-all-closed', () => {}); // one window per persona, closed in turn; quit is explicit below
app.whenReady().then(async () => {
  const shots = await shoot(config, names, dir, at);
  for (const s of shots) (s.status === 'ok' ? console.log : console.error)(s.line);
  app.exit(shots.some(s => s.status === 'fail') ? 1 : 0);
});
