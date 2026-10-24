import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { loadConfig, addPersona, removePersona, renamePersona, ConfigError, literalPasswords, type Config } from './config.js';
import { send } from './ipc.js';
import { partitionDir, newSession, renameSession, dropSession, sessionDir } from './sessions.js';
import { serveMock } from './mock.js';
import { init } from './init.js';

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
function launch(entry: string, payload: { config: Config; names: string[]; dir: string; file: string; space?: string; path?: string; sync?: boolean }) {
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

program.command('init')
  .description('write a sample nstack.yml (one space) and add .nstack/ to .gitignore')
  .option('-c, --config <file>', 'config file', 'nstack.yml')
  .action((opts: { config: string }) => {
    init(process.cwd(), opts.config).forEach(l => console.log(l));
    console.log(`next: set baseUrl in ${opts.config}, run nstack login --all, then nstack up`);
  });

program.command('up')
  .description('open the shell with every (or the named) persona as a space')
  .argument('[personas...]', 'persona names from nstack.yml (default: all)')
  .option('--sync', 'a path change in one persona replays in the others (also the Sync toggle)')
  .option('-c, --config <file>', 'config file', 'nstack.yml')
  .action((names: string[], opts: { config: string; sync?: boolean }) => {
    const { file, config, all, dir } = load(opts.config, names);
    launch('main.js', { config, names: names.length ? names : all, dir, file, sync: opts.sync });
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
  .option('-c, --config <file>', 'config file', 'nstack.yml')
  .action(async (name: string, opts: { device: string; config: string }) => {
    const { file, dir } = load(opts.config, [], anyEnv);
    try {
      fs.writeFileSync(file, addPersona(fs.readFileSync(file, 'utf8'), name, { device: opts.device }, path.basename(file)).text);
      newSession(dir, name); // a new space never inherits a login
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

program.command('remove')
  .description('remove personas from nstack.yml (and their spaces from the running shell); their saved logins are deleted too')
  .argument('<personas...>', 'persona names from nstack.yml')
  .option('-c, --config <file>', 'config file', 'nstack.yml')
  .action(async (names: string[], opts: { config: string }) => {
    const { file, dir } = load(opts.config, names, anyEnv);
    try {
      fs.writeFileSync(file, names.reduce((text, n) => removePersona(text, n, path.basename(file)), fs.readFileSync(file, 'utf8')));
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      console.error(e.message);
      process.exit(1);
    }
    for (const name of names) {
      const reply = await send(dir, { remove: name }).catch((e: Error) => ({ error: e.message }));
      if (reply?.lines) { reply.lines.forEach((l: string) => console.log(l)); continue; }
      // no shell has it open: forget and delete its session here
      const id = dropSession(dir, name);
      if (id) fs.rmSync(sessionDir(dir, id), { recursive: true, force: true });
      console.log(`removed personas.${name} from ${path.basename(file)} · login deleted` + (reply?.error ? ` (running shell: ${reply.error})` : ''));
    }
  });

program.command('rename')
  .description('rename a persona in nstack.yml (and its space in the running shell); the saved login is kept')
  .argument('<from>', 'persona name in nstack.yml')
  .argument('<to>', 'new name: lowercase letters, digits, dashes')
  .option('-c, --config <file>', 'config file', 'nstack.yml')
  .action(async (from: string, to: string, opts: { config: string }) => {
    const { file, dir } = load(opts.config, [from], anyEnv);
    try {
      fs.writeFileSync(file, renamePersona(fs.readFileSync(file, 'utf8'), from, to, path.basename(file)));
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      console.error(e.message);
      process.exit(1);
    }
    // a running shell with that space moves it and its session entry; otherwise move the entry here
    const reply = await send(dir, { rename: { from, to } }).catch((e: Error) => ({ error: e.message }));
    if (reply?.lines) return reply.lines.forEach((l: string) => console.log(l));
    renameSession(dir, from, to);
    console.log(`renamed personas.${from} → ${to} in ${path.basename(file)} · login kept` + (reply?.error ? ` (running shell: ${reply.error})` : ''));
  });

program.command('shot')
  .description('screenshot every persona at path (default: /) into a new run folder under .nstack/shots')
  .argument('[path]', 'app path, e.g. /invoices')
  .option('-c, --config <file>', 'config file', 'nstack.yml')
  .action(async (at: string | undefined, opts: { config: string }) => {
    // shooting never logs in, so unset $ENV secrets are fine here
    const { file, dir, config, all } = load(opts.config, [], anyEnv);
    const reply = await send(dir, { shot: at ?? null }).catch((e: Error) => ({ error: e.message }));
    if (reply?.error) {
      console.error(`the running shell said: ${reply.error}`);
      process.exit(1);
    }
    if (reply) {
      for (const s of reply.shots) (s.status === 'ok' ? console.log : console.error)(s.line);
      process.exit(reply.shots.some((s: { status: string }) => s.status === 'fail') ? 1 : 0);
    }
    // no shell here: shoot offscreen and exit
    launch('shot-main.js', { config, names: all, dir, file, path: at });
  });

program.command('mock', { isDefault: true }).description('serve and open the clickable UI mock').action(serveMock);

// for commands that never send secrets: an unset $ENV reads as empty instead of failing
const anyEnv = new Proxy(process.env, { get: (env, k: string) => env[k] ?? '' });


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
