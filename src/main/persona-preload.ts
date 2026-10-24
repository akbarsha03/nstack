import { ipcRenderer } from 'electron';

// space-switch keys typed inside a persona's page, unless the app handled them or the user is typing
// sideways swipes (or Shift+wheel) scroll the All row; plain vertical page scrolling is left alone
window.addEventListener('wheel', e => {
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) ipcRenderer.send('nstack:wheel', { dx: e.deltaX, dy: e.deltaY, shift: e.shiftKey });
}, { passive: true });

window.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || !/^(ArrowLeft|ArrowRight|[0-9]|a)$/.test(e.key)) return;
  const t = e.target as HTMLElement;
  if (t.isContentEditable || t.closest?.('input, select, textarea')) return;
  e.preventDefault();
  ipcRenderer.send('nstack:key', e.key);
});
