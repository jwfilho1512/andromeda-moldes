/** Ponte com o sistema: Electron (window.cad) no desktop, fallback de navegador para testes. */

export interface FileRef {
  path: string | null;
  name: string;
}

interface CadApi {
  isDesktop: true;
  platform: string;
  openFile(): Promise<{ path: string; name: string; content: string } | null>;
  importFile(filterName: string, exts: string[]): Promise<{ path: string; name: string; data: Uint8Array } | null>;
  basesLoad(): Promise<string | null>;
  basesSave(text: string): Promise<boolean>;
  saveFile(content: string, path: string | null, defaultName: string): Promise<FileRef | null>;
  exportFile(data: Uint8Array | string, defaultName: string, filterName: string, ext: string): Promise<FileRef | null>;
  confirmClose(dirty: boolean): Promise<boolean>;
  onMenu(cb: (cmd: string) => void): () => void;
  /** Arquivo .ctx aberto pelo sistema (duplo clique / "Abrir com"). */
  onOpenPath?(cb: (f: { path: string; name: string; content: string }) => void): () => void;
}

declare global {
  interface Window {
    cad?: CadApi;
  }
}

const api = window.cad;

function download(data: Uint8Array | string, name: string, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const platform = {
  isDesktop: !!api,

  open(): Promise<{ path: string | null; name: string; content: string } | null> {
    if (api) return api.openFile();
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.ctx,application/json';
      input.onchange = async () => {
        const f = input.files?.[0];
        resolve(f ? { path: null, name: f.name, content: await f.text() } : null);
      };
      input.click();
    });
  },

  /** Escolhe um arquivo para importar (DXF…) e devolve os bytes. */
  importFile(filterName: string, exts: string[]): Promise<{ name: string; data: Uint8Array } | null> {
    if (api) return api.importFile(filterName, exts);
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = exts.map((e) => `.${e}`).join(',');
      input.onchange = async () => {
        const f = input.files?.[0];
        resolve(f ? { name: f.name, data: new Uint8Array(await f.arrayBuffer()) } : null);
      };
      input.click();
    });
  },

  async save(content: string, path: string | null, defaultName: string): Promise<FileRef | null> {
    if (api) return api.saveFile(content, path, defaultName);
    download(content, defaultName, 'application/json');
    return { path: null, name: defaultName };
  },

  async exportFile(data: Uint8Array | string, defaultName: string, filterName: string, ext: string): Promise<FileRef | null> {
    if (api) return api.exportFile(data, defaultName, filterName, ext);
    download(data, defaultName, ext === 'pdf' ? 'application/pdf' : 'application/octet-stream');
    return { path: null, name: defaultName };
  },

  /** Minhas bases: arquivo na pasta do usuário (app) ou armazenamento local (navegador). */
  async basesLoad(): Promise<string | null> {
    if (api) return api.basesLoad();
    try {
      return localStorage.getItem('moldes.minhasBases');
    } catch {
      return null;
    }
  },

  async basesSave(text: string): Promise<boolean> {
    if (api) return api.basesSave(text);
    try {
      localStorage.setItem('moldes.minhasBases', text);
      return true;
    } catch {
      return false;
    }
  },

  confirmClose(dirty: boolean) {
    return api?.confirmClose(dirty) ?? Promise.resolve(true);
  },

  onMenu(cb: (cmd: string) => void): () => void {
    return api ? api.onMenu(cb) : () => {};
  },

  onOpenPath(cb: (f: { path: string; name: string; content: string }) => void): () => void {
    return api?.onOpenPath ? api.onOpenPath(cb) : () => {};
  },
};
