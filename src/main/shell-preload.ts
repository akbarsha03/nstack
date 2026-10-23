import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('nstack', {
  send: (ch: string, ...args: unknown[]) => ipcRenderer.send(`nstack:${ch}`, ...args),
  on: (ch: string, fn: (...args: unknown[]) => void) => ipcRenderer.on(`nstack:${ch}`, (_e, ...args) => fn(...args)),
});
