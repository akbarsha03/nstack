# nstack — MVP spec

*Open source, MIT. One command opens your web app as several users at several screen sizes, side by side, on your own machine.*

Status: draft v1, 2026-10-23. Owner: Akbar. Nothing built yet.

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

1. **Config file** `nstack.yml` in the project root: base URL, list of personas, each with a login recipe, viewport, optional start path.
2. **Login once, remember forever** (until it expires): `nstack login <persona>` opens one window, you log in by hand, it saves the session (cookies + localStorage) to `.nstack/<persona>.json`. Optional scripted login for apps with a plain form.
3. **`nstack up`**: opens every persona in its own window at its viewport, restored session, tiled on screen. Windows stay open until Ctrl+C.
4. **Device presets**: `iphone-15`, `pixel-8`, `ipad-air`, `laptop`, `desktop`, plus `WxH` literal. Sets viewport, device scale factor, touch, user agent (Playwright's device descriptors, zero work).
5. **Sync navigation (opt-in)**: `--sync` makes a path change in one window replay in the others (relative path only, so each stays its own user). Off by default.
6. **`nstack shot [path]`**: screenshot every persona at the given path to `.nstack/shots/<persona>.png`. Handy for PR comments.
7. **Expired session handling**: on a redirect to the login URL, print "persona X logged out — run `nstack login X`" and keep going.
8. **Works on macOS, Linux, Windows** (Playwright does the browser work).

### Out (v2 candidates, not MVP)

- GUI / Electron shell. CLI only.
- Hot-reload sync, scroll sync, click mirroring.
- Visual diffing, CI mode, cloud.
- Browser other than Chromium (Firefox/WebKit are one flag away in Playwright, but untested in MVP).
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
tile: grid                   # grid | row | none
personas:
  admin:
    device: desktop          # 1440x900 @1x
    start: /dashboard
  storage:
    device: pixel-8          # 412x915 @2.6, touch, mobile UA
    start: /storage/floor
  customer:
    device: ipad-air
    start: /portal
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
| `nstack up [personas…]` | Open all (or named) personas, tiled; `--sync` to mirror paths |
| `nstack shot [path]` | Screenshot every persona at `path` (default: each `start`) |
| `nstack reset [persona]` | Delete saved sessions |

### 5.4 Window tiling

Grid: windows placed left-to-right, top-to-bottom on the primary screen using the viewport size plus browser chrome. `row`: single row, overflow allowed. `none`: let the OS place them. Screen size read from Playwright's `screen` or `osascript`/`xrandr` fallback. Good enough for MVP; a window manager fight is not worth winning.

## 6. Architecture

```
nstack (Node 20+, TypeScript, ~600 lines)
├─ cli.ts            commander: init / login / up / shot / reset
├─ config.ts         load + validate nstack.yml (zod), expand $ENV
├─ devices.ts        preset name → Playwright device descriptor | WxH
├─ session.ts        storageState read/write, expiry detection
├─ launch.ts         one Chromium per persona (separate user-data-dir), headed,
│                    --window-size/--window-position, context with viewport
├─ sync.ts           optional: page 'framenavigated' → broadcast path → others goto
└─ shot.ts           page.screenshot per persona
```

Key calls:

- One **browser per persona**, not one browser with many contexts. Reason: a headed window per context is unreliable for sizing and placement; separate `chromium.launch({ args: ['--window-size', '--window-position'] })` per persona is dumb and works. Costs memory (~150 MB each); fine for 3–6 personas.
- Persona isolation = Playwright `storageState` + its own user-data-dir. Nothing custom.
- Session file = Playwright's JSON as is. No schema of our own.
- Sync = `page.on('framenavigated')` on each page, debounce, `goto(baseUrl + path)` on the rest, with a guard flag to stop echo loops. Relative path only.
- Logged-out detection = URL starts with `loginPath` after a navigation that didn't start there.

Dependencies: `playwright` (browser + devices), `commander`, `yaml`, `zod`. Nothing else.

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
| 1 | `init`, config, `up` with hand login every time (no sessions yet) | 1 day |
| 2 | `login` + saved sessions + logged-out detection | 0.5 day |
| 3 | Device presets + tiling | 0.5 day |
| 4 | `shot` | 0.25 day |
| 5 | `--sync` | 0.5 day |
| 6 | README with GIF, examples, npm publish, GitHub release | 0.5 day |

Total: ~3 days of focused work. First dogfood target: nidhi-stack (admin desktop, storage floor phone, collections tablet).

## 10. Success criteria (MVP done when)

- `npx nstack up` on nidhi-stack opens 3 logged-in personas in under 5 s after first login.
- A new user can go from `npm i -g` to three windows in under 5 minutes using only the README.
- Works on a Mac and one Linux box without code changes.
- 100+ GitHub stars in the first month is the vanity target; the real one is "I stop opening incognito windows".

## 11. Risks

- **Window placement** varies per OS/WM. Mitigation: `tile: none` always works; grid is best-effort.
- **Apps with OTP-only login** (like ours): hand login once is the answer; sessions last as long as the app's remember cookie. Document it.
- **Chromium download** (~150 MB) on first run. Standard Playwright cost; say so in README.

## 12. Open decisions (defaulted, change if you disagree)

1. **Language**: TypeScript on Node. Alternative: Go + rod for a single binary, but loses Playwright's device table and storageState for free. TS wins for MVP.
2. **One browser per persona** vs one browser many contexts: per persona (see §6).
3. **Config format**: YAML. JSON5 is the alternative; YAML reads better for a table of personas.
4. **License**: MIT.

## 13. v2 ideas (parked)

Scroll/click mirroring · Firefox/WebKit · per-persona network throttle, timezone, locale · `nstack diff` (screenshot compare between two commits) · tiny tray GUI · shared "persona packs" for common frameworks (Devise, NextAuth, Laravel Breeze) · record a login once, replay as script.
