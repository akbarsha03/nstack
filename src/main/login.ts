import path from 'node:path';
import { app } from 'electron';
import type { Config } from '../config.js';
import { login } from './login-window.js';

// `nstack login`: one window per persona on its partition, in turn
const { config, names, dir } = JSON.parse(process.env.NSTACK_UP!) as { config: Config; names: string[]; dir: string };
app.setPath('userData', path.join(dir, '.nstack', 'electron')); // same profile as `nstack up`

app.on('window-all-closed', () => {}); // windows open one after another; quit is explicit below
app.whenReady().then(async () => {
  let ok = true;
  for (const name of names) ok = (await login(config, name)) && ok;
  app.exit(ok ? 0 : 1);
});
