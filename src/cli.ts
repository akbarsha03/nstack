import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { loadConfig, addPersona, ConfigError, literalPasswords, type Config } from './config.js';
import { send } from './ipc.js';
import { serveMock } from './mock.js';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
const program = new Command('nstack')
  .version(pkg.version)
  .description('open your web app as several users at several screen sizes');

// load nstack.yml and check the named personas exist, or print why and exit 1
function load(configFile: string, names: string[], env: NodeJS.ProcessEnv = process.env) {
  const file = path.resolve(configFile);
  let config: Config;
  try {
    config = loadConfig(file, env);
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
  return { file, config, all, dir: path.dirname(file) };
}

// run one of the Electron entry points in dist/src/main with the loaded config
function launch(entry: string, payload: { config: Config; names: string[]; dir: string; file: string; space?: string }) {
  const electron = require('electron') as unknown as string;
  const args = [path.join(__dirname, 'main', entry)];
  if (needsNoSandbox(electron)) {
    args.unshift('--no-sandbox');
    console.error(`note: Chromium sandbox unavailable here, running without it. Fix: sudo chown root ${sandboxPath(electron)} && sudo chmod 4755 ${sandboxPath(electron)}`);
  }
  const child = spawn(electron, args, { stdio: 'inherit', env: { ...process.env, NSTACK_UP: JSON.stringify(payload) } });
  child.on('exit', code => process.exit(code ?? 1));
  process.on('SIGINT', () => child.kill('SIGINT'));
}

program.command('up')
  .description('open the shell with every (or the named) persona as a space')
  .argument('[personas...]', 'persona names from nstack.yml (default: all)')
  .option('-c, --config <file>', 'config file', 'nstack.yml')
  .action((names: string[], opts: { config: string }) => {
    const { file, config, all, dir } = load(opts.config, names);
    launch('main.js', { config, names: names.length ? names : all, dir, file });
  });

program.command('login')
  .description('open a window per persona, log in once, the session is kept for `nstack up`')
  .argument('[personas...]', 'persona names from nstack.yml')
  .option('--all', 'every persona, one after another')
  .option('-c, --config <file>', 'config file', 'nstack.yml')
  .action((names: string[], opts: { config: string; all?: boolean }) => {
    const { file, config, all, dir } = load(opts.config, names);
    if (!names.length && !opts.all) {
      console.error(`name a persona or pass --all. ${path.basename(file)} has: ${all.join(', ')}`);
      process.exit(1);
    }
    for (const at of literalPasswords(fs.readFileSync(file, 'utf8'))) {
      console.error(`warning: ${at} is a literal password in ${path.basename(file)}; use "$ENV_VAR" so it stays out of git`);
    }
    launch('login.js', { config, names: opts.all ? all : names, dir, file });
  });

program.command('reset')
  .description('forget saved sessions (cookies, storage) for every or the named persona')
  .argument('[personas...]', 'persona names from nstack.yml (default: all)')
  .option('-c, --config <file>', 'config file', 'nstack.yml')
  .action((names: string[], opts: { config: string }) => {
    // deleting a session needs no secrets, so unset $ENV values are fine here
    const { all, dir } = load(opts.config, names, anyEnv);
    for (const name of names.length ? names : all) {
      fs.rmSync(partitionDir(dir, name), { recursive: true, force: true });
      console.log(`${name.padEnd(10)} session deleted → run nstack login ${name}`);
    }
  });

program.command('add')
  .description('add a persona to nstack.yml and open its space (in the running shell, or a new one)')
  .argument('<name>', 'persona name: lowercase letters, digits, dashes')
  .requiredOption('-d, --device <preset>', 'iphone-15, pixel-8, ipad-air, laptop, desktop or WxH')
  .option('-s, --start <path>', 'start path, e.g. /dashboard')
  .option('-c, --config <file>', 'config file', 'nstack.yml')
  .action(async (name: string, opts: { device: string; start?: string; config: string }) => {
    const { file, dir } = load(opts.config, [], anyEnv);
    try {
      fs.writeFileSync(file, addPersona(fs.readFileSync(file, 'utf8'), name, { device: opts.device, start: opts.start }, path.basename(file)).text);
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      console.error(e.message);
      process.exit(1);
    }
    const reply = await send(dir, { add: name }).catch((e: Error) => ({ error: e.message }));
    if (reply?.error) {
      console.error(`added ${name} to ${path.basename(file)}, but the running shell said: ${reply.error}`);
      process.exit(1);
    }
    if (reply) return reply.lines.forEach((l: string) => console.log(l));
    console.log(`added personas.${name} to ${path.basename(file)} · no shell running here, opening one`);
    const { config, all } = load(opts.config, []);
    launch('main.js', { config, names: all, dir, file, space: name });
  });

program.command('mock', { isDefault: true }).description('serve and open the clickable UI mock').action(serveMock);

for (const cmd of ['init', 'shot']) {
  program.command(cmd, { hidden: true }).allowUnknownOption().allowExcessArguments().action(() => {
    console.error(`nstack ${cmd}: not built yet, see docs/MVP.md`);
    process.exit(1);
  });
}

// for commands that never send secrets: an unset $ENV reads as empty instead of failing
const anyEnv = new Proxy(process.env, { get: (env, k: string) => env[k] ?? '' });

// where Electron keeps `persist:<name>` under the userData that main.ts / login.ts set
const partitionDir = (dir: string, name: string) => path.join(dir, '.nstack', 'electron', 'Partitions', name);

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
