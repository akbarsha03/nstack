import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { loadConfig, ConfigError } from './config.js';
import { serveMock } from './mock.js';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
const program = new Command('nstack')
  .version(pkg.version)
  .description('open your web app as several users at several screen sizes');

program.command('up')
  .description('open the shell with every (or the named) persona as a space')
  .argument('[personas...]', 'persona names from nstack.yml (default: all)')
  .option('-c, --config <file>', 'config file', 'nstack.yml')
  .action((names: string[], opts: { config: string }) => {
    const file = path.resolve(opts.config);
    let config;
    try {
      config = loadConfig(file);
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      console.error(e.message);
      process.exit(1);
    }
    const all = Object.keys(config.personas);
    const unknown = names.filter(n => !all.includes(n));
    if (unknown.length) {
      console.error(`unknown persona: ${unknown.join(', ')}. ${path.basename(file)} has: ${all.join(', ')}`);
      process.exit(1);
    }
    const electron = require('electron') as unknown as string;
    const args = [path.join(__dirname, 'main', 'main.js')];
    if (needsNoSandbox(electron)) {
      args.unshift('--no-sandbox');
      console.error(`note: Chromium sandbox unavailable here, running without it. Fix: sudo chown root ${sandboxPath(electron)} && sudo chmod 4755 ${sandboxPath(electron)}`);
    }
    const child = spawn(electron, args, {
      stdio: 'inherit',
      env: { ...process.env, NSTACK_UP: JSON.stringify({ config, names: names.length ? names : all, dir: path.dirname(file) }) },
    });
    child.on('exit', code => process.exit(code ?? 1));
    process.on('SIGINT', () => child.kill('SIGINT'));
  });

program.command('mock', { isDefault: true }).description('serve and open the clickable UI mock').action(serveMock);

for (const cmd of ['init', 'login', 'add', 'shot', 'reset']) {
  program.command(cmd, { hidden: true }).allowUnknownOption().allowExcessArguments().action(() => {
    console.error(`nstack ${cmd}: not built yet, see docs/MVP.md`);
    process.exit(1);
  });
}

const sandboxPath = (electron: string) => path.join(path.dirname(electron), 'chrome-sandbox');

// Ubuntu 24+ blocks unprivileged user namespaces, so Chromium needs a setuid chrome-sandbox or it aborts
function needsNoSandbox(electron: string) {
  if (process.platform !== 'linux') return false;
  try {
    if (fs.readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() !== '1') return false;
  } catch {
    return false;
  }
  try {
    const st = fs.statSync(sandboxPath(electron));
    return !(st.uid === 0 && st.mode & 0o4000);
  } catch {
    return true;
  }
}

program.parse();
