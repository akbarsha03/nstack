import { ipcRenderer } from 'electron';

// space-switch keys typed inside a persona's page, unless the app handled them or the user is typing
window.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || !/^(ArrowLeft|ArrowRight|[0-9]|a)$/.test(e.key)) return;
  const t = e.target as HTMLElement;
  if (t.isContentEditable || t.closest?.('input, select, textarea')) return;
  e.preventDefault();
  ipcRenderer.send('nstack:key', e.key);
});
