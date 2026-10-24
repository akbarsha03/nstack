export type Rect = { x: number; y: number; width: number; height: number };

// All space, grid mode: near-square grid of equal cells filling the stage
export function tileGrid(stage: Rect, n: number, gap = 8): Rect[] {
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  const w = Math.floor((stage.width - gap * (cols + 1)) / cols), h = Math.floor((stage.height - gap * (rows + 1)) / rows);
  return Array.from({ length: n }, (_, i) => ({
    x: stage.x + gap + (i % cols) * (w + gap),
    y: stage.y + gap + Math.floor(i / cols) * (h + gap),
    width: Math.max(0, w),
    height: Math.max(0, h),
  }));
}

// ← / → walk the strip order (All first), clamped at both ends like the mock
export const nextSpace = (spaces: string[], cur: string, d: number) =>
  spaces[Math.max(0, Math.min(spaces.length - 1, spaces.indexOf(cur) + d))];

// 0 or a = All, 1–9 = nth persona
export function spaceForKey(names: string[], key: string): string | undefined {
  if (key === '0' || key === 'a') return 'all';
  if (/^[1-9]$/.test(key)) return names[Number(key) - 1];
}

// strip order: the names in `order` first (unknown ones dropped), then any it leaves out, in their old order
export const reorder = (names: string[], order: string[]) =>
  [...new Set(order.filter(n => names.includes(n))), ...names.filter(n => !order.includes(n))];

export const BAR = 24; // frame title bar height, matches .frame .bar in renderer/index.html
export const ADDR = 32; // nstack's address row above each frame: 26px (.addr in renderer/index.html) + 6px gap
const ADDR_H = 26;
export type Frame = { frame: Rect; view: Rect; addr: Rect; scale: number };

// scale each device to fit its cell (address row and title bar included) keeping its true aspect ratio, never above 1:1, centred.
// shared: every frame uses the smallest scale, so in the All grid relative sizes stay honest.
export function fitFrames(cells: Rect[], sizes: { width: number; height: number }[], shared = false): Frame[] {
  const fit = sizes.map((d, i) => Math.max(0.05, Math.min(cells[i].width / d.width, (cells[i].height - BAR - ADDR) / d.height, 1)));
  const min = Math.min(...fit);
  return sizes.map((d, i) => {
    const scale = shared ? min : fit[i], c = cells[i];
    const width = Math.round(d.width * scale), height = Math.round(d.height * scale);
    const x = c.x + Math.floor((c.width - width) / 2), y = c.y + ADDR + Math.floor((c.height - height - BAR - ADDR) / 2);
    return { scale, frame: { x, y, width, height: height + BAR }, view: { x, y: y + BAR, width, height }, addr: { x, y: y - ADDR, width, height: ADDR_H } };
  });
}

export const inset = (r: Rect, p: number): Rect => ({ x: r.x + p, y: r.y + p, width: Math.max(0, r.width - 2 * p), height: Math.max(0, r.height - 2 * p) });

// All space, row mode: one row, every window the same height, shrunk until the row fits the stage width
// ponytail: no sideways scroll (native views sit above the shell page, so it can't scroll them); add when rows get long
export function rowFrames(stage: Rect, sizes: { width: number; height: number }[], gap = 8): Frame[] {
  const aspect = sizes.reduce((n, d) => n + d.width / d.height, 0);
  const h = Math.max(20, Math.floor(Math.min(stage.height - 2 * gap - BAR - ADDR, (stage.width - gap * (sizes.length + 1)) / aspect, ...sizes.map(d => d.height))));
  const widths = sizes.map(d => Math.round(d.width * h / d.height));
  let x = stage.x + Math.max(gap, Math.floor((stage.width - widths.reduce((a, b) => a + b, 0) - gap * (sizes.length - 1)) / 2));
  const y = stage.y + ADDR + Math.floor((stage.height - h - BAR - ADDR) / 2);
  return sizes.map((d, i) => {
    const f = { scale: h / d.height, frame: { x, y, width: widths[i], height: h + BAR }, view: { x, y: y + BAR, width: widths[i], height: h }, addr: { x, y: y - ADDR, width: widths[i], height: ADDR_H } };
    x += widths[i] + gap;
    return f;
  });
}
