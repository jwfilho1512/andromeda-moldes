/**
 * Ponte com o sistema (window.hub no app). No navegador (desenvolvimento) usa uma simulação,
 * para dar para ver e testar a interface sem instalar nada.
 */
import { APPS, type AppDef, type AppId, type Product, type ReleaseAsset, REPO, parseRelease, pickAsset } from '../electron/catalog';

export type { AppDef, AppId, Product, ReleaseAsset };

export interface AppStatus extends AppDef {
  installed: boolean;
  version?: string;
  path?: string;
}

export interface ReleaseInfo {
  ok: boolean;
  error?: string;
  version?: string;
  page?: string;
  assets?: Record<string, ReleaseAsset | null>;
}

export interface Progress {
  id: string;
  phase: 'baixando' | 'instalando';
  f: number;
}

interface HubApi {
  apps(): Promise<AppStatus[]>;
  release(force: boolean): Promise<ReleaseInfo>;
  install(id: AppId): Promise<{ ok: boolean; error?: string; path?: string }>;
  openApp(id: AppId, file?: string): Promise<string | null>;
  settings(): Promise<{ workspace: string }>;
  pickWorkspace(): Promise<string | null>;
  products(): Promise<{ workspace: string; exists: boolean; products: Product[] }>;
  createProduct(p: { ref: string; nome: string; colecao: string; moldes: boolean }): Promise<{ ok: boolean; error?: string; adraw?: string; dir?: string }>;
  reveal(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  info(): Promise<{ version: string; platform: string; arch: string }>;
  onInstallProgress(cb: (p: Progress) => void): () => void;
}

declare global {
  interface Window {
    hub?: HubApi;
  }
}

/* ---------------- simulação para o navegador ---------------- */

const listeners = new Set<(p: Progress) => void>();
const installed: Record<string, string> = { moldes: '0.1.0' };
const mockProducts: Product[] = [
  { key: '1', ref: '0137', nome: 'Camiseta básica', colecao: 'Verão 27', status: 'aprovada', dir: '~/Documentos/Andromeda/0137 - Camiseta básica', desenho: '0137.adraw', moldes: ['0137.ctx'], mtime: Date.now() - 3600e3 },
  { key: '2', ref: '0142', nome: 'Calça jeans reta', colecao: 'Verão 27', status: 'desenvolvimento', dir: '~/Documentos/Andromeda/0142 - Calça jeans reta', desenho: '0142.adraw', moldes: [], mtime: Date.now() - 86400e3 },
  { key: '3', ref: 'vestido-evase', nome: 'vestido-evase', colecao: '', status: '', dir: '~/Documentos/Andromeda', desenho: null, moldes: ['vestido-evase.ctx'], mtime: Date.now() - 3 * 86400e3 },
];

const mock: HubApi = {
  async apps() {
    return APPS.map((a) => ({ ...a, installed: !!installed[a.id], version: installed[a.id] }));
  },
  async release(): Promise<ReleaseInfo> {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
      const r = parseRelease(await res.json());
      return { ok: true, version: r.version, page: r.page, assets: Object.fromEntries(APPS.map((a) => [a.id, pickAsset(r.assets, a, 'darwin', 'arm64')])) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
  async install(id) {
    for (let k = 1; k <= 20; k++) {
      await new Promise((r) => setTimeout(r, 60));
      listeners.forEach((l) => l({ id, phase: 'baixando', f: k / 20 }));
    }
    listeners.forEach((l) => l({ id, phase: 'instalando', f: 1 }));
    await new Promise((r) => setTimeout(r, 500));
    installed[id] = '0.1.0';
    return { ok: true };
  },
  async openApp(id, file) {
    return `Simulação: abriria ${APPS.find((a) => a.id === id)?.name}${file ? ` com ${file}` : ''}`;
  },
  async settings() {
    return { workspace: '~/Documentos/Andromeda' };
  },
  async pickWorkspace() {
    return null;
  },
  async products() {
    return { workspace: '~/Documentos/Andromeda', exists: true, products: mockProducts };
  },
  async createProduct(p) {
    mockProducts.unshift({ key: String(Date.now()), ref: p.ref, nome: p.nome, colecao: p.colecao, status: 'rascunho', dir: `~/Documentos/Andromeda/${p.ref} - ${p.nome}`, desenho: `${p.ref}.adraw`, moldes: p.moldes ? [`${p.ref}.ctx`] : [], mtime: Date.now() });
    return { ok: true, adraw: `${p.ref}.adraw` };
  },
  async reveal() {},
  async openExternal(url) {
    window.open(url, '_blank', 'noopener');
  },
  async info() {
    return { version: '0.1.0', platform: 'darwin', arch: 'arm64' };
  },
  onInstallProgress(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

export const hub: HubApi = window.hub ?? mock;
export const isDesktop = !!window.hub;
