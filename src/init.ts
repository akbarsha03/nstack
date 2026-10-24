import fs from 'node:fs';
import path from 'node:path';

export const SAMPLE = `# nstack.yml: every key is explained at https://github.com/akbarsha03/nstack#config
baseUrl: http://localhost:3000   # your dev server
loginPath: /sign-in              # where the app sends a logged-out user
tile: grid                       # All space: grid | row
personas:
  me:                            # one space to start with; add more with nstack add or the + tile
    device: desktop              # 1440x900; also laptop, ipad-air, pixel-8, iphone-15 or WxH
    # login:                     # optional scripted login; leave out to log in by hand
    #   fill:
    #     "input[name=email]": "me@example.com"
    #     "input[name=password]": "$ME_PASSWORD"   # read from the environment
    #   submit: "button[type=submit]"
`;

// `nstack init`: write a sample config (never over an existing one) and keep .nstack/ (real cookies) out of git.
// Returns one line per thing it did or skipped.
export function init(dir: string, configFile = 'nstack.yml'): string[] {
  const out: string[] = [];
  const config = path.resolve(dir, configFile);
  if (fs.existsSync(config)) {
    out.push(`${configFile} already exists, left as is`);
  } else {
    fs.writeFileSync(config, SAMPLE);
    out.push(`wrote ${configFile} with one space: me (desktop)`);
  }
  const ignore = path.join(dir, '.gitignore');
  const text = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : '';
  if (text.split(/\r?\n/).some(l => /^\/?\.nstack\/?\*{0,2}$/.test(l.trim()))) {
    out.push('.gitignore already has .nstack/');
  } else {
    fs.writeFileSync(ignore, text + (text && !text.endsWith('\n') ? '\n' : '') + '.nstack/\n');
    out.push(`${text ? 'added .nstack/ to' : 'created'} .gitignore (saved sessions hold real cookies)`);
  }
  return out;
}
