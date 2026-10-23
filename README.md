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

## Status

Spec + UI mock, nothing real yet. The product spec is [docs/MVP.md](docs/MVP.md).

## npm name

`nstack` is already taken on npm. When this ships it will publish as `@akbarsha03/nstack` (the command stays `nstack`). Not published yet.

## License

MIT
