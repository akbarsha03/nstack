# nstack

Every role-based web app has to be checked as different users on different screens: admin on a desktop, the floor worker on a phone, the customer on a tablet. Today that means incognito windows, logging in by hand and toggling DevTools device mode, every day. `nstack up` opens your app as each persona, each in its own browser window at its own device size, each already logged in from a saved session, tiled side by side on your machine. Log in once with `nstack login <persona>`, screenshot everyone with `nstack shot`, mirror navigation across windows with `--sync`. Open source, local only, no cloud.

## Try the mock

```sh
npx github:akbarsha03/nstack
```

or

```sh
git clone https://github.com/akbarsha03/nstack.git && cd nstack
npm i -g . && nstack mock      # or without installing: node bin/nstack.js
```

It serves a clickable UI mock on a free local port and opens it in your browser. Each persona gets its own space, one full window at a time, like macOS Mission Control: switch with the spaces strip, ← / →, `1`–`9`, or a sideways trackpad swipe; `0` shows All windows tiled; `+` adds a persona. Up, Login, Shot and Sync act like the planned commands and print what the real CLI would. `nstack --help` lists the planned commands.

<!-- screenshot: docs/mock.png -->

## Run it (milestone 1)

```sh
git clone https://github.com/akbarsha03/nstack.git && cd nstack && npm i
cd ~/code/your-app && node ~/path/to/nstack/bin/nstack.js up      # or `npm i -g .` then `nstack up`
```

`nstack up [personas…]` reads `nstack.yml` from the current folder (or `-c <file>`) and opens one window: one space per persona plus **All**, switched with the strip, ← / →, `1`–`9`, `0`/`a`. Each persona has its own cookies and storage, kept in `.nstack/` in your project, so a login survives restarts. Minimal config:

```yaml
baseUrl: http://localhost:3000
personas:
  admin:    { device: desktop, start: /dashboard }
  customer: { device: ipad-air, start: /portal }
```

`$ENV` / `${ENV}` in any value is read from the environment. `device` is `iphone-15`, `pixel-8`, `ipad-air`, `laptop`, `desktop` (default) or a `WxH` literal like `1366x768`; each persona gets that viewport, pixel ratio, touch and user agent, scaled to fit its space.

`nstack login <persona>` (or `--all`) opens a window on the persona's session at `loginPath` (default `/sign-in`); log in by hand and it closes once the app sends you elsewhere. With a `login: { fill: {selector: value}, submit: selector }` block it fills the form for you (keep passwords in `$ENV`). A persona the app bounces to `loginPath` during `nstack up` shows a "Logged out" placeholder. Apps with OTP-only login: log in by hand once; it lasts as long as the app's session. `nstack reset [persona]` forgets saved sessions. Run `login` / `reset` while `nstack up` is closed.

The control bar on top matches the mock: persona chips (red dot = logged out, click to log in; green = click to forget the session), **Up** (every persona back to its start page), **Login** (the first logged-out persona), `grid` / `row` for the All space (remembered), and the `nstack.yml` drawer (read-only). The terminal pane at the bottom echoes every action as the CLI line it stands for; click its header to collapse it.

`nstack add <name> --device <preset> [--start /path]` appends a persona to `nstack.yml` and opens its space: in the shell already running in that folder (over a local socket), or in a new one. The **+** tile in the strip does the same from a dialog. The persona is appended as text, so the rest of the file, comments and alignment included, stays byte for byte as you wrote it; only a one-line `personas: {…}` map gets re-printed (comments kept, spacing may change). In `row` mode the windows share one height and shrink to fit the width; there is no sideways scroll yet.

`nstack shot [path]` (or **Shot**) saves every persona at its real viewport size to `.nstack/shots/<persona>.png`. `nstack up --sync` (or the **Sync** toggle, remembered) mirrors navigation: move one persona to `/invoices` and the others follow, each as its own user. Only the path is replayed (no scroll or clicks), and logged-out personas are skipped with a note in the terminal.

Linux note: on Ubuntu 24+ Chromium's sandbox needs `chrome-sandbox` to be setuid root; until then nstack runs without it and prints the one-line fix.

## Status

Milestones 1–5 of [docs/MVP.md](docs/MVP.md): shell, spaces, thumbnails, All space, per-persona sessions, device presets, login / reset, control bar, terminal pane, `nstack add`, `nstack shot`, `--sync`.

## npm name

`nstack` is already taken on npm. When this ships it will publish as `@akbarsha03/nstack` (the command stays `nstack`). Not published yet.

## License

MIT
