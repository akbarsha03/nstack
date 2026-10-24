import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createSync, relPath, type SyncPrefs } from '../src/main/sync.js';

const BASE = 'http://localhost:3000';
const url = (p: string) => BASE + p;

// three personas; `go` behaves like a page: it loads, commits (did-navigate) and stops loading
function setup(t: TestContext, opts: { on?: boolean; out?: string[]; follow?: (name: string, p: string) => void; prefs?: Partial<SyncPrefs>; current?: string } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const gone: [string, string][] = [], reports: [string, string, [string, string | undefined][]][] = [];
  const names = ['a', 'b', 'c'];
  const s = createSync({
    baseUrl: BASE, on: opts.on ?? true, prefs: opts.prefs, isCurrent: n => n === (opts.current ?? 'a'),
    go: (n, p) => { gone.push([n, p]); opts.follow?.(n, p); },
    targets: leader => names.filter(n => n !== leader).map(n => [n, opts.out?.includes(n) ? 'logged out' : undefined]),
    report: (l, p, r) => reports.push([l, p, r]),
  });
  return { s, gone, reports };
}

test('relPath keeps path, query and hash on the app origin only', () => {
  assert.equal(relPath('http://localhost:3000/p?x=1#h', BASE), '/p?x=1#h');
  assert.equal(relPath('http://localhost:3000', BASE), '/');
  assert.equal(relPath('https://localhost:3000/p', BASE), undefined);
  assert.equal(relPath('about:blank', BASE), undefined);
});

test('off by default: nothing is mirrored', (t: TestContext) => {
  const { s, gone } = setup(t, { on: false });
  s.navigated('a', url('/p'));
  t.mock.timers.tick(1000);
  assert.deepEqual(gone, []);
});

test('A to /p moves B and C to /p exactly once, followers do not echo back', (t: TestContext) => {
  const tm = t.mock.timers;
  // a follower commits the page, then its router does a replaceState, then it stops loading
  const { s, gone, reports } = setup(t, { follow: (n, p) => { s.navigated(n, url(p)); s.navigated(n, url(p + '?tab=1')); s.stopped(n); } });
  s.navigated('a', url('/p'));
  tm.tick(300);
  assert.deepEqual(gone, [['b', '/p'], ['c', '/p']]);
  assert.equal(reports.length, 1);
  tm.tick(5000);
  assert.deepEqual(gone, [['b', '/p'], ['c', '/p']], 'no ping-pong');
});

test('a client-side redirect right after a follower stopped loading is still an echo', (t: TestContext) => {
  const tm = t.mock.timers;
  const { s, gone } = setup(t, { follow: (n) => s.stopped(n) });
  s.navigated('a', url('/p'));
  tm.tick(300);
  tm.tick(1000);
  s.navigated('b', url('/p/redirected'));
  tm.tick(1000);
  assert.equal(gone.length, 2);
  // once the guard window is over, B is the user's again
  s.navigated('b', url('/q'));
  tm.tick(300);
  assert.deepEqual(gone.slice(2), [['a', '/q'], ['c', '/q']]);
});

test('a persona main is still loading never leads', (t: TestContext) => {
  const tm = t.mock.timers;
  const { s, gone } = setup(t);
  s.drive('a'); // start page / Up / login
  s.navigated('a', url('/dashboard'));
  tm.tick(10_000);
  assert.deepEqual(gone, []);
});

test('SPA bursts are debounced to the last path', (t: TestContext) => {
  const tm = t.mock.timers;
  const { s, gone } = setup(t);
  s.navigated('a', url('/p'));
  tm.tick(100);
  s.navigated('a', url('/p?page=2'));
  tm.tick(100);
  s.navigated('a', url('/p?page=3'));
  tm.tick(300);
  assert.deepEqual(gone, [['b', '/p?page=3'], ['c', '/p?page=3']]);
});

test('logged-out personas are skipped and reported', (t: TestContext) => {
  const tm = t.mock.timers;
  const { s, gone, reports } = setup(t, { out: ['c'] });
  s.navigated('a', url('/p'));
  tm.tick(300);
  assert.deepEqual(gone, [['b', '/p']]);
  assert.deepEqual(reports[0], ['a', '/p', [['b', undefined], ['c', 'logged out']]]);
});

test('turning sync off drops a pending broadcast', (t: TestContext) => {
  const tm = t.mock.timers;
  const { s, gone } = setup(t);
  s.navigated('a', url('/p'));
  s.set(false);
  tm.tick(1000);
  assert.deepEqual(gone, []);
  assert.equal(s.on, false);
});

test('prefs.query off replays the pathname only', (t: TestContext) => {
  const { s, gone } = setup(t, { prefs: { query: false } });
  s.navigated('a', url('/p?x=1#h'));
  t.mock.timers.tick(300);
  assert.deepEqual(gone, [['b', '/p'], ['c', '/p']]);
});

test('prefs.leaderOnlyCurrent: a space you are not looking at does not lead', (t: TestContext) => {
  const { s, gone } = setup(t, { prefs: { leaderOnlyCurrent: true }, current: 'a' });
  s.navigated('b', url('/q'));
  t.mock.timers.tick(300);
  assert.deepEqual(gone, []);
  s.navigated('a', url('/p'));
  t.mock.timers.tick(300);
  assert.deepEqual(gone, [['b', '/p'], ['c', '/p']]);
});

test('prefs.follow: unchecked spaces are skipped and reported', (t: TestContext) => {
  const { s, gone, reports } = setup(t, { prefs: { follow: { c: false } } });
  s.navigated('a', url('/p'));
  t.mock.timers.tick(300);
  assert.deepEqual(gone, [['b', '/p']]);
  assert.deepEqual(reports[0][2], [['b', undefined], ['c', 'not following (sync prefs)']]);
});

test('setPrefs applies to the next navigation and keeps sync on', (t: TestContext) => {
  const { s, gone } = setup(t);
  s.setPrefs({ query: false });
  s.navigated('a', url('/p?x=1'));
  t.mock.timers.tick(300);
  assert.deepEqual(gone, [['b', '/p'], ['c', '/p']]);
  assert.equal(s.on, true);
  assert.equal(s.prefs.leaderOnlyCurrent, false);
});
