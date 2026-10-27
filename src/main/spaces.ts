export type Rect = { x: number; y: number; width: number; height: number };

// ← / → and the stage's ‹ › walk the strip order (All first), wrapping around at both ends
export const nextSpace = (spaces: string[], cur: string, d: number) =>
  spaces[(((spaces.indexOf(cur) + d) % spaces.length) + spaces.length) % spaces.length];

// 0 or a = All, 1–9 = nth persona
export function spaceForKey(names: string[], key: string): string | undefined {
  if (key === '0' || key === 'a') return 'all';
  if (/^[1-9]$/.test(key)) return names[Number(key) - 1];
}

// the top bar's Reload all, ⌘/Ctrl+Shift+R: every space that has a view, hidden ones too; nothing to do with none
export function reloadAll(names: Iterable<string>, reload: (who: string[]) => void) {
  const all = [...names];
  if (all.length) reload(all);
}

// strip order: the names in `order` first (unknown ones dropped), then any it leaves out, in their old order
export const reorder = (names: string[], order: string[]) =>
  [...new Set(order.filter(n => names.includes(n))), ...names.filter(n => !order.includes(n))];

export const BAR = 24; // frame title bar height, matches .frame .bar in renderer/index.html
export const ADDR = 32; // nstack's address row above each frame: 26px (.addr in renderer/index.html) + 6px gap
const ADDR_H = 26;
export type Frame = { frame: Rect; view: Rect; addr: Rect; scale: number };

// scale each device to fit its cell (address row and title bar included) keeping its true aspect ratio, never above 1:1, centred
export function fitFrames(cells: Rect[], sizes: { width: number; height: number }[]): Frame[] {
  return sizes.map((d, i) => {
    const c = cells[i], scale = Math.max(0.05, Math.min(c.width / d.width, (c.height - BAR - ADDR) / d.height, 1));
    const width = Math.round(d.width * scale), height = Math.round(d.height * scale);
    const x = c.x + Math.floor((c.width - width) / 2), y = c.y + ADDR + Math.floor((c.height - height - BAR - ADDR) / 2);
    return { scale, frame: { x, y, width, height: height + BAR }, view: { x, y: y + BAR, width, height }, addr: { x, y: y - ADDR, width, height: ADDR_H } };
  });
}

type Size = { width: number; height: number };
const at = (scale: number, x: number, y: number, width: number, height: number): Frame =>
  ({ scale, addr: { x, y, width, height: ADDR_H }, frame: { x, y: y + ADDR, width, height: height + BAR }, view: { x, y: y + ADDR + BAR, width, height } });

// shelf-pack in strip order at scale s: each row as many as fit the width; indexes per row
function shelves(stage: Rect, sizes: Size[], s: number, gap: number) {
  const rows: number[][] = [];
  let w = Infinity;
  sizes.forEach((d, i) => {
    const fw = Math.round(d.width * s);
    if (rows.length && w + gap + fw <= stage.width - 2 * gap) { rows[rows.length - 1].push(i); w += gap + fw; }
    else { rows.push([i]); w = fw; }
  });
  return rows;
}

// All space, grid mode: every space at one shared scale (relative sizes stay honest), as large as fits, packed in strip
// order into rows with equal gaps and the whole block centred, so the spaces read as one cluster. Rows are top-aligned
// so the address bars in a row line up. Never above 1:1; at the 0.05 floor a block too big for the stage overflows it.
export function packFrames(stage: Rect, sizes: Size[], gap = 16): Frame[] {
  const foot = (d: Size, s: number) => Math.round(d.height * s) + BAR + ADDR;
  const fits = (s: number) => {
    if (sizes.some(d => Math.round(d.width * s) > stage.width - 2 * gap)) return false;
    const rows = shelves(stage, sizes, s, gap);
    return rows.reduce((h, r) => h + Math.max(...r.map(i => foot(sizes[i], s))), 0) + gap * (rows.length - 1) <= stage.height - 2 * gap;
  };
  let lo = 0.05, hi = 1;
  if (fits(1)) lo = 1;
  else for (let k = 0; k < 25; k++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
  const s = Math.max(0.05, Math.floor(lo * 1000) / 1000);
  const rows = shelves(stage, sizes, s, gap), rowH = rows.map(r => Math.max(...r.map(i => foot(sizes[i], s))));
  const blockH = rowH.reduce((a, b) => a + b, 0) + gap * (rows.length - 1);
  const out: Frame[] = [];
  let y = stage.y + Math.max(gap, Math.floor((stage.height - blockH) / 2));
  rows.forEach((r, j) => {
    const ws = r.map(i => Math.round(sizes[i].width * s)), rowW = ws.reduce((a, b) => a + b, 0) + gap * (r.length - 1);
    let x = stage.x + Math.max(gap, Math.floor((stage.width - rowW) / 2));
    r.forEach((i, k) => { out[i] = at(s, x, y, ws[k], Math.round(sizes[i].height * s)); x += ws[k] + gap; });
    y += rowH[j] + gap;
  });
  return out;
}

export const inset = (r: Rect, p: number): Rect => ({ x: r.x + p, y: r.y + p, width: Math.max(0, r.width - 2 * p), height: Math.max(0, r.height - 2 * p) });

// All space, row mode: one row, every window as tall as the stage allows (never above 1:1), left to right. A row wider
// than the stage starts at the left edge and main scrolls it sideways; a narrower one is centred. Rows are top-aligned.
export function rowFrames(stage: Rect, sizes: Size[], gap = 8): Frame[] {
  const avail = Math.max(20, stage.height - 2 * gap - BAR - ADDR);
  const scales = sizes.map(d => Math.min(1, avail / d.height));
  const ws = sizes.map((d, i) => Math.round(d.width * scales[i])), hs = sizes.map((d, i) => Math.round(d.height * scales[i]));
  const content = ws.reduce((a, b) => a + b, 0) + gap * (sizes.length - 1);
  let x = stage.x + Math.max(gap, Math.floor((stage.width - content) / 2));
  const y = stage.y + Math.floor((stage.height - Math.max(0, ...hs) - BAR - ADDR) / 2);
  return sizes.map((_, i) => { const f = at(scales[i], x, y, ws[i], hs[i]); x += ws[i] + gap; return f; });
}

// the row's full width from the stage's left edge, its trailing gap included (> stage.width when it scrolls)
export const rowWidth = (stage: Rect, frames: Frame[], gap = 8) =>
  frames.length ? frames[frames.length - 1].frame.x + frames[frames.length - 1].frame.width + gap - stage.x : 0;
