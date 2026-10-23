// --sync: a path change in one persona replays in the others. Relative path only, so each stays its own user.
// Echo guard: a persona main is loading (start page, Up, login, a sync follow) is "driven" — its navigations are not
// the user's until it stopped loading and then stayed quiet for guardMs (which absorbs client-side redirects and the
// router's replaceState right after load). Debounce: an SPA can fire several in-page navigations for one click;
// only the last path within debounceMs is sent.

// path + query + hash of a URL on the app's origin, else undefined
export function relPath(url: string, baseUrl: string) {
  try {
    const u = new URL(url);
    return u.origin === new URL(baseUrl).origin ? u.pathname + u.search + u.hash : undefined;
  } catch {
    return undefined;
  }
}

export type Sync = ReturnType<typeof createSync>;

export function createSync(o: {
  baseUrl: string;
  // load path in persona name; called for every target, after it was marked driven
  go: (name: string, path: string) => void;
  // every persona but the leader, as [name, why it was skipped or undefined]
  targets: (leader: string) => [string, string | undefined][];
  // one broadcast: who led, the path, and what each target did
  report: (leader: string, path: string, results: [string, string | undefined][]) => void;
  on?: boolean;
  debounceMs?: number;
  guardMs?: number;
}) {
  const debounceMs = o.debounceMs ?? 300, guardMs = o.guardMs ?? 1500;
  const quietUntil = new Map<string, number>(); // Infinity while main is loading it
  let on = !!o.on, timer: ReturnType<typeof setTimeout> | undefined;
  const driven = (name: string) => Date.now() < (quietUntil.get(name) ?? 0);

  return {
    get on() { return on; },
    set(v: boolean) { on = v; if (!v) clearTimeout(timer); },
    // main is about to loadURL this persona
    drive(name: string) { quietUntil.set(name, Infinity); },
    // did-stop-loading
    stopped(name: string) { if (quietUntil.get(name) === Infinity) quietUntil.set(name, Date.now() + guardMs); },
    // did-navigate / did-navigate-in-page of a logged-in persona's main frame
    navigated(name: string, url: string) {
      const path = relPath(url, o.baseUrl);
      if (!on || path === undefined || driven(name)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!on) return;
        const results = o.targets(name);
        for (const [n, skip] of results) if (!skip) { quietUntil.set(n, Infinity); o.go(n, path); }
        o.report(name, path, results);
      }, debounceMs);
    },
  };
}
