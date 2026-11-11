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
  saveFile(content: string, path: string | null, defaultName: string): Promise<FileRef | null>;
  exportFile(data: Uint8Array | string, defaultName: string, filterName: string, ext: string): Promise<FileRef | null>;
  printPdf(defaultName: string, landscape: boolean): Promise<FileRef | null>;
  pickLink(): Promise<{ path: string; name: string } | null>;
  libLoad(): Promise<string | null>;
  libSave(text: string): Promise<boolean>;
  openLinked(path: string): Promise<string | null>;
  confirmClose(dirty: boolean): Promise<boolean>;
  onMenu(cb: (cmd: string) => void): () => void;
  /** Arquivo .adraw aberto pelo sistema (duplo clique / "Abrir com"). */
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
      input.accept = '.adraw,application/json';
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
    download(data, defaultName, ext === 'pdf' ? 'application/pdf' : ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : 'application/octet-stream');
    return { path: null, name: defaultName };
  },

  /** PDF da janela (modo impressão). No navegador abre a impressão do sistema. */
  async printPdf(defaultName: string, landscape: boolean): Promise<FileRef | null> {
    if (api) return api.printPdf(defaultName, landscape);
    window.print();
    return null;
  },

  /** Minha biblioteca: arquivo na pasta do usuário (app) ou armazenamento local (navegador). */
  async libLoad(): Promise<string | null> {
    if (api) return api.libLoad();
    try {
      return localStorage.getItem('draw.minhaBiblioteca');
    } catch {
      return null;
    }
  },

  async libSave(text: string): Promise<boolean> {
    if (api) return api.libSave(text);
    try {
      localStorage.setItem('draw.minhaBiblioteca', text);
      return true;
    } catch {
      return false;
    }
  },

  pickLink(): Promise<{ path: string; name: string } | null> {
    return api ? api.pickLink() : Promise.resolve(null);
  },

  openLinked(path: string): Promise<string | null> {
    return api ? api.openLinked(path) : Promise.resolve('Abrir arquivos vinculados funciona no app instalado.');
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
