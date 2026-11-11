import { contextBridge, ipcRenderer } from 'electron';

/** API do hub exposta à interface (window.hub). */
contextBridge.exposeInMainWorld('hub', {
  apps: () => ipcRenderer.invoke('apps'),
  release: (force: boolean) => ipcRenderer.invoke('release', force),
  install: (id: string) => ipcRenderer.invoke('install', id),
  uninstall: (id: string, path: string | null, closeFirst: boolean) => ipcRenderer.invoke('uninstall', id, path, closeFirst),
  restartApp: (id: string) => ipcRenderer.invoke('restartApp', id),
  openApp: (id: string, file?: string) => ipcRenderer.invoke('openApp', id, file),
  settings: () => ipcRenderer.invoke('settings'),
  pickWorkspace: () => ipcRenderer.invoke('pickWorkspace'),
  products: () => ipcRenderer.invoke('products'),
  createProduct: (p: { ref: string; nome: string; colecao: string; moldes: boolean }) => ipcRenderer.invoke('createProduct', p),
  reveal: (path: string) => ipcRenderer.invoke('reveal', path),
  openExternal: (url: string) => ipcRenderer.invoke('openExternal', url),
  info: () => ipcRenderer.invoke('info'),
  hubUpdate: (force: boolean) => ipcRenderer.invoke('hubUpdate', force),
  updateHub: () => ipcRenderer.invoke('updateHub'),
  onInstallProgress: (cb: (p: { id: string; phase: string; f: number }) => void) => {
    const l = (_e: unknown, p: { id: string; phase: string; f: number }) => cb(p);
    ipcRenderer.on('installProgress', l);
    return () => ipcRenderer.removeListener('installProgress', l);
  },
});
