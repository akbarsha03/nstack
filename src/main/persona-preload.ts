import { ipcRenderer } from 'electron';

// sideways swipes (or Shift+wheel) scroll the All row; plain vertical page scrolling is left alone
window.addEventListener('wheel', e => {
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) ipcRenderer.send('nstack:wheel', { dx: e.deltaX, dy: e.deltaY, shift: e.shiftKey });
}, { passive: true });

// keys typed inside a persona's page, unless the app handled them or the user is typing (a field, or an ARIA widget
// where arrows move within it): 1–9 / 0 / a pick a space, ← / → go back / forward in the current one (main ignores them
// in All). The page keeps its own use of ← / → (no preventDefault). Shift+Tab, Alt+← / ⌘[ are caught in main.
// Synthetic (untrusted) events are accepted on purpose: nstack:key only navigates or picks a space in a dev shell
// showing the owner's own app, and the keys e2e test drives it that way.
window.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || !/^(ArrowLeft|ArrowRight|[0-9]|a)$/.test(e.key)) return;
  const t = e.target as HTMLElement;
  if (t.isContentEditable || t.closest?.('input, select, textarea, [role=slider], [role=tablist], [role=listbox], [role=menu], [role=menubar], [role=grid], [role=radiogroup], [role=combobox]')) return;
  if (!e.key.startsWith('Arrow')) e.preventDefault();
  ipcRenderer.send('nstack:key', e.key);
});
