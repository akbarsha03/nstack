# nstack — MVP spec

*Open source, MIT. One command opens your web app as several users at several screen sizes, side by side, on your own machine.*

Status: draft v2, 2026-10-23. Owner: Akbar. Nothing real built yet; the UI mock is done.

## 0. Design reference (read this first)

The approved UI lives in this repo as a clickable mock: **`mock/index.html`**. Run it with `node bin/nstack.js` (or `npx github:akbarsha03/nstack`) and click through before building anything. It is the source of truth for layout, copy, interaction and keyboard shortcuts; this document is the source of truth for scope and architecture. When they disagree, the mock wins on look and feel, this doc wins on what ships.

The UX model is **macOS Spaces / Mission Control**: one persona window fills the view; a strip under the control bar shows a live thumbnail per persona plus an **All** space (every window tiled) and a **+** tile to add a persona. Click or ← / → to switch.

---

## 1. Problem

Every multi-role web app (admin / staff / customer; owner / cashier / floor worker) has to be checked as **different users** on **different screen sizes**. Today that means:

- several browser profiles or incognito windows, each logged in by hand, every day;
- DevTools device toolbar toggled per window, by hand;
- re-doing all of that after every restart, cookie expiry or deploy.

Existing tools cover only half:

| Tool | Many sizes | Many users | Open source |
|---|---|---|---|
| Responsively, Sizzy | yes | no (one session) | Responsively yes |
| Polypane | yes | yes (pane isolation) | no, paid |
| Firefox containers + RDM | per tab, manual | yes | yes |
| Chrome `--user-data-dir` | manual | yes | n/a |
| Playwright (raw) | scriptable | scriptable | yes |

Nothing open source does both as a product. That is the gap.

## 2. Who it is for

- Solo devs and small teams building role-based SaaS, admin panels, marketplaces, internal tools.
- Anyone who already runs a local dev server and has test logins.
- Not for: QA automation suites, cross-browser matrices, visual-regression pipelines. Those exist.

## 3. One-line pitch

> `nstack up` opens admin at 1440×900, storage worker at 390×844 and the customer at 820×1180, each already logged in, each in its own window, in two seconds.

## 4. MVP scope

### In

1. **Config file** `nstack.yml` in the project root: base URL, list of personas, each with a login recipe, viewport. Every space opens at the root (`baseUrl` + `/`); there is no per-persona start path.
2. **Login once, remember forever** (until it expires): `nstack login <persona>` opens one window, you log in by hand, it saves the session (cookies + localStorage) to `.nstack/<persona>.json`. Optional scripted login for apps with a plain form.
3. **`nstack up`**: opens the nstack shell window with every persona loaded in its own isolated web view at its viewport, restored session. **One persona visible at a time** (a "space"); a strip under the control bar shows live thumbnails of the rest plus an **All** space that tiles every persona, and a **+** tile to add one. Switch by click, ← / →, `1`–`9`, `0`/`a` for All, or a sideways trackpad swipe. See `mock/index.html`.
4. **Device presets**: `iphone-15`, `pixel-8`, `ipad-air`, `laptop`, `desktop`, plus `WxH` literal. Sets viewport, device scale factor, touch, user agent. The window is scaled to fit the shell while keeping its true aspect ratio; the frame title shows persona, device and real size.
5. **Sync navigation (opt-in)**: `--sync` makes a path change in one window replay in the others (relative path only, so each stays its own user). Off by default.
6. **`nstack shot [path]`**: screenshot every persona at the given path to `.nstack/shots/<persona>.png`. Handy for PR comments.
7. **Expired session handling**: on a redirect to the login URL, print "persona X logged out — run `nstack login X`" and keep going.
8. **`nstack add <name> --device <preset>`**: adds a persona to `nstack.yml` and opens its space; the **+** tile in the UI does the same.
9. **Control bar** (top of the shell): base URL, persona chips with status dot (click a logged-out chip to log in, a logged-in one to reset), `Login`, `Shot`, `Sync` toggle, `grid`/`row` (All space only), `nstack.yml` drawer, collapsible terminal pane that echoes every action as the CLI line it corresponds to.
10. **Works on macOS, Linux, Windows.**

### Out (v2 candidates, not MVP)

- Hot-reload sync, scroll sync, click mirroring.
- Dragging/resizing windows inside the shell. (Typing a path into a frame's address bar is in: Enter loads it in that persona, and Sync replays it.)
- Visual diffing, CI mode, cloud.
- Browser other than Chromium (the shell embeds Chromium; Firefox/WebKit would need a different shell).
- Network throttling, geolocation, timezone per persona (easy later, cut for now).
- Plugin system.

## 5. User experience

### 5.1 Install

```
npm i -g nstack        # or npx nstack
nstack init            # writes nstack.yml with two sample personas, downloads Chromium
```

### 5.2 Config

```yaml
# nstack.yml
baseUrl: http://localhost:3000
loginPath: /sign-in          # used to detect "logged out"
tile: grid                   # All space only: grid | row
personas:
  admin:
    device: desktop          # 1440x900 @1x
  storage:
    device: pixel-8          # 412x915 @2.6, touch, mobile UA
  customer:
    device: ipad-air
    login:                   # optional scripted login; omit to log in by hand
      fill:
        "input[name=login]": "customer@example.com"
        "input[name=password]": "$CUSTOMER_PASSWORD"   # env var
      submit: "button[type=submit]"
```

### 5.3 Commands

| Command | Does |
|---|---|
| `nstack init` | Write sample config, install Chromium |
| `nstack login <persona>` | Open one window, wait until URL leaves `loginPath`, save session |
| `nstack login --all` | Same, one after another |
| `nstack up [personas…]` | Open the shell with all (or named) personas as spaces; `--sync` to mirror paths |
| `nstack add <name> --device <preset>` | Append a persona to `nstack.yml`, open its space |
| `nstack shot [path]` | Screenshot every persona at `path` (default: `/`) |
| `nstack reset [persona]` | Delete saved sessions |

### 5.4 Spaces and tiling

Default view: one persona per space, scaled to fit the shell, true aspect ratio. The **All** space tiles every persona: `grid` shrinks all by the same factor so relative sizes stay honest; `row` gives them equal height in one horizontal scroll. The last active space, the Sync state and the tile mode persist across restarts. No OS window management at all: one shell window, everything inside it. (The v1 draft placed real OS windows on the desktop; dropped after the mock review, it was the wrong UX.)

## 6. Architecture

One desktop shell window that hosts N isolated web views. Electron gives every piece for free, so the MVP is Electron, not Playwright:

```
nstack (Node 22.12+, TypeScript, Electron, ~900 lines)
├─ cli.ts            commander: init / login / up / add / shot / reset → spawns the shell
├─ config.ts         load + validate nstack.yml (zod), expand $ENV, write-back for `add`
├─ devices.ts        preset name → { width, height, dpr, touch, userAgent } | WxH
├─ main/
│  ├─ shell.ts       BrowserWindow for the shell UI (the mock, made real)
│  ├─ spaces.ts      one WebContentsView per persona, show/hide on space switch,
│  │                 scale-to-fit, All-space tiling
│  ├─ persona.ts     session.fromPartition('persist:<name>') = isolated, persisted login;
│  │                 webContents.enableDeviceEmulation(preset); logged-out detection
│  ├─ sync.ts        did-navigate-in-page/did-navigate → broadcast relative path, echo guard
│  └─ shot.ts        webContents.capturePage() per persona → .nstack/shots/<name>.png
└─ renderer/         the control bar + strip + terminal pane (from mock/index.html)
```

Key calls:

- **Electron shell, one window**, because the approved UX (spaces, live thumbnails, All overview) needs the personas inside one surface. Playwright can only give separate OS windows.
- **Persona isolation** = Electron session partitions (`persist:<name>`). Cookies and storage persist on disk under Electron's userData; "login once" needs no code of ours. `nstack reset` deletes the partition.
- **Device emulation** = `webContents.enableDeviceEmulation` (viewport, DPR, touch) + `setUserAgent`. No Playwright device table; keep a small preset map in `devices.ts`.
- **Live thumbnails** = periodic `capturePage()` at low res (every 1–2 s, only for non-active spaces), or a CSS-scaled hidden view. Start with capturePage.
- **Sync** = listen to navigation events on each view, debounce, `loadURL(baseUrl + path)` on the rest with a guard flag. Relative path only. Skip logged-out personas and print why.
- **Logged-out detection** = URL starts with `loginPath` after a navigation that did not start there; show the "run nstack login X" placeholder in that space.
- **CLI ↔ shell**: the CLI is a thin launcher; `add`/`shot` from the terminal talk to a running shell over a local socket, or start one.

Dependencies: `electron`, `commander`, `yaml`, `zod`. Nothing else. Memory: one Chromium process tree, a renderer per persona (~60–100 MB each).

## 7. Security and privacy

- Session files hold real cookies. `.nstack/` is added to `.gitignore` by `init`.
- Secrets in config only via `$ENV` expansion; literal passwords allowed but warned.
- Never phones home. No telemetry in MVP.

## 8. Repo layout

```
nstack/
  README.md         pitch, 30-second demo GIF, install, config reference
  LICENSE           MIT
  package.json
  bin/nstack.js     CLI entry (today: serves the mock)
  mock/index.html   APPROVED UI MOCK, self-contained, the design reference (§0)
  docs/MVP.md       this document
  src/              as in §6
  examples/
    rails-devise/nstack.yml
    nextjs-auth/nstack.yml
  test/             node:test; config parsing, device mapping, sync guard
  .github/workflows/ci.yml   lint + tests + `nstack shot` against a static demo app
```

## 9. Milestones

| # | Deliverable | Est. |
|---|---|---|
| 1 | Electron shell + `up`: personas as spaces, strip with thumbnails, All space, partitions (login persists by itself) | 1.5 days |
| 2 | Device presets + scale-to-fit, logged-out placeholder, `login` / `reset` | 0.5 day |
| 3 | Control bar: chips, terminal pane, yml drawer, `add` + `+` tile | 0.5 day |
| 4 | `shot` | 0.25 day |
| 5 | `--sync` | 0.5 day |
| 6 | README with GIF, examples, npm publish as `@akbarsha03/nstack`, GitHub release | 0.5 day |

Total: ~4 days of focused work. First dogfood target: nidhi-stack (admin desktop, storage floor phone, collections tablet).

## 10. Success criteria (MVP done when)

- `npx nstack up` on nidhi-stack opens 3 logged-in personas in under 5 s after first login.
- A new user can go from `npm i -g` to three windows in under 5 minutes using only the README.
- Works on a Mac and one Linux box without code changes.
- 100+ GitHub stars in the first month is the vanity target; the real one is "I stop opening incognito windows".

## 11. Risks

- **Electron size** (~200 MB install). Accepted: it is the only thing that gives one window, isolated sessions and device emulation without custom work.
- **Apps with OTP-only login** (like ours): hand login once is the answer; sessions last as long as the app's remember cookie. Document it.

## 12. Open decisions (defaulted, change if you disagree)

1. **Shell**: Electron. Alternative: Tauri (smaller binary) but multi-webview and per-webview sessions are still rough there; revisit for v2.
2. **Language**: TypeScript.
3. **Config format**: YAML. JSON5 is the alternative; YAML reads better for a table of personas.
4. **License**: MIT.

## 13. v2 ideas (parked)

Scroll/click mirroring · Firefox/WebKit · per-persona network throttle, timezone, locale · `nstack diff` (screenshot compare between two commits) · tiny tray GUI · shared "persona packs" for common frameworks (Devise, NextAuth, Laravel Breeze) · record a login once, replay as script.
