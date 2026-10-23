export type Device = { width: number; height: number; dpr: number; touch: boolean; userAgent?: string };

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

// desktop presets keep Electron's own (Chrome) user agent
export const PRESETS: Record<string, Device> = {
  'iphone-15': { width: 393, height: 852, dpr: 3, touch: true, userAgent: IOS },
  'pixel-8': { width: 412, height: 915, dpr: 2.625, touch: true, userAgent: ANDROID },
  'ipad-air': { width: 820, height: 1180, dpr: 2, touch: true, userAgent: IPAD },
  laptop: { width: 1280, height: 800, dpr: 1, touch: false },
  desktop: { width: 1440, height: 900, dpr: 1, touch: false },
};

// preset name or a "WxH" literal (desktop, 1x); undefined if neither
export function parseDevice(s: string): Device | undefined {
  if (Object.hasOwn(PRESETS, s)) return PRESETS[s];
  const m = /^(\d{2,4})x(\d{2,4})$/.exec(s);
  if (m) return { width: Number(m[1]), height: Number(m[2]), dpr: 1, touch: false };
}
