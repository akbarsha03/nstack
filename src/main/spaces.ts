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
