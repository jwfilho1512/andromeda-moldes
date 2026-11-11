import { contextBridge, ipcRenderer } from 'electron';

/** API mínima e segura exposta ao editor (window.cad). */
contextBridge.exposeInMainWorld('cad', {
  isDesktop: true,
  platform: process.platform,
  openFile: () => ipcRenderer.invoke('openFile'),
  importFile: (filterName: string, exts: string[]) => ipcRenderer.invoke('importFile', filterName, exts),
  basesLoad: () => ipcRenderer.invoke('basesLoad'),
  basesSave: (text: string) => ipcRenderer.invoke('basesSave', text),
  saveFile: (content: string, path: string | null, defaultName: string) => ipcRenderer.invoke('saveFile', content, path, defaultName),
  exportFile: (data: Uint8Array | string, defaultName: string, filterName: string, ext: string) =>
    ipcRenderer.invoke('exportFile', data, defaultName, filterName, ext),
  confirmClose: (dirty: boolean) => ipcRenderer.invoke('confirmClose', dirty),
  onOpenPath: (cb: (f: { path: string; name: string; content: string }) => void) => {
    const listener = (_e: unknown, f: { path: string; name: string; content: string }) => cb(f);
    ipcRenderer.on('openPath', listener);
    ipcRenderer.send('rendererReady');
    return () => ipcRenderer.removeListener('openPath', listener);
  },
  onMenu: (cb: (cmd: string) => void) => {
    const listener = (_e: unknown, cmd: string) => cb(cmd);
    ipcRenderer.on('menu', listener);
    return () => ipcRenderer.removeListener('menu', listener);
  },
});
