// --sync: a path change in one persona replays in the others. Relative path only, so each stays its own user.
// Echo guard: a persona main is loading (opening at the root, login, a sync follow) is "driven" — its navigations are not
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

// query: replay ?query#hash too, else the pathname only. leaderOnlyCurrent: only isCurrent(name) leads.
// follow: personas set to false are skipped (missing = follows).
export type SyncPrefs = { query: boolean; leaderOnlyCurrent: boolean; follow: Record<string, boolean> };
export const defaultPrefs = (): SyncPrefs => ({ query: true, leaderOnlyCurrent: false, follow: {} });

export function createSync(o: {
  baseUrl: string;
  // load path in persona name; called for every target, after it was marked driven
  go: (name: string, path: string) => void;
  // every persona but the leader, as [name, why it was skipped or undefined]
  targets: (leader: string) => [string, string | undefined][];
  // one broadcast: who led, the path, and what each target did
  report: (leader: string, path: string, results: [string, string | undefined][]) => void;
  on?: boolean;
  prefs?: Partial<SyncPrefs>;
  // the space being looked at, for prefs.leaderOnlyCurrent
  isCurrent?: (name: string) => boolean;
  debounceMs?: number;
  guardMs?: number;
}) {
  const debounceMs = o.debounceMs ?? 300, guardMs = o.guardMs ?? 1500;
  const quietUntil = new Map<string, number>(); // Infinity while main is loading it
  let prefs: SyncPrefs = { ...defaultPrefs(), ...o.prefs };
  let on = !!o.on, timer: ReturnType<typeof setTimeout> | undefined;
  const driven = (name: string) => Date.now() < (quietUntil.get(name) ?? 0);

  return {
    get on() { return on; },
    set(v: boolean) { on = v; if (!v) clearTimeout(timer); },
    get prefs() { return prefs; },
    setPrefs(p: Partial<SyncPrefs>) { prefs = { ...prefs, ...p }; },
    // main is about to loadURL this persona
    drive(name: string) { quietUntil.set(name, Infinity); },
    // did-stop-loading
    stopped(name: string) { if (quietUntil.get(name) === Infinity) quietUntil.set(name, Date.now() + guardMs); },
    // did-navigate / did-navigate-in-page of a logged-in persona's main frame
    navigated(name: string, url: string) {
      const rel = relPath(url, o.baseUrl);
      if (!on || rel === undefined || driven(name) || (prefs.leaderOnlyCurrent && !o.isCurrent?.(name))) return;
      const path = prefs.query ? rel : rel.replace(/[?#].*/, '');
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!on) return;
        const results = o.targets(name).map(([n, skip]): [string, string | undefined] =>
          [n, skip ?? (prefs.follow[n] === false ? 'not following (sync prefs)' : undefined)]);
        for (const [n, skip] of results) if (!skip) { quietUntil.set(n, Infinity); o.go(n, path); }
        o.report(name, path, results);
      }, debounceMs);
    },
  };
}
