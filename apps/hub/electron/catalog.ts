/**
 * Catálogo do Andromeda Fashion Studio e regras puras (sem acesso ao sistema), testáveis:
 * qual instalador baixar, comparação de versões e montagem da lista de produtos.
 */

/** Repositório público onde ficam os instaladores (página de Releases). */
export const REPO = 'jwfilho1512/andromeda-moldes';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;

export type AppId = 'draw' | 'moldes' | '3d';
export type AnyId = AppId | 'hub';

export interface AppDef {
  id: AppId;
  /** Nome do app instalado (productName). */
  name: string;
  short: string;
  desc: string;
  /** Começo do nome dos instaladores nas Releases. */
  asset: string;
  /** Extensão dos arquivos do app. */
  ext: string;
  soon?: boolean;
}

export const APPS: AppDef[] = [
  { id: 'draw', name: 'Andromeda Draw', short: 'Draw', desc: 'Desenho de moda, croqui e ficha técnica', asset: 'Andromeda-Draw', ext: 'adraw' },
  { id: 'moldes', name: 'Andromeda Moldes', short: 'Moldes', desc: 'Modelagem 2D, graduação, estampa, risco e encaixe', asset: 'Andromeda-Moldes', ext: 'ctx' },
  { id: '3d', name: 'Andromeda 3D', short: '3D', desc: 'Prova virtual: avatar, costura e simulação de tecido', asset: 'Andromeda-3D', ext: 'a3d', soon: true },
];

/** O próprio hub (não aparece como cartão; atualiza a si mesmo). */
export const HUB: Omit<AppDef, 'id'> & { id: 'hub' } = {
  id: 'hub',
  name: 'Andromeda Fashion Studio',
  short: 'Hub',
  desc: 'Instala, atualiza e abre os apps',
  asset: 'Andromeda-Fashion-Studio',
  ext: '',
};

/** Onde o hub está rodando dá para trocar por uma versão nova? (não dá dentro do .dmg nem em pasta temporária do macOS) */
export function selfUpdateBlocker(platform: string, exePath: string, packaged: boolean): string | null {
  if (!packaged) return 'Atualização automática só no app instalado';
  if (platform === 'darwin') {
    if (exePath.startsWith('/Volumes/')) return 'Arraste o Andromeda Fashion Studio para Aplicativos para ele poder se atualizar';
    if (exePath.includes('/AppTranslocation/')) return 'Mova o Andromeda Fashion Studio para Aplicativos (o macOS o abriu de um lugar temporário) para ele poder se atualizar';
  }
  if (platform !== 'darwin' && platform !== 'win32') return 'Sistema sem atualização automática';
  return null;
}

/** Pasta .app que contém o executável no Mac (…/X.app/Contents/MacOS/X → …/X.app). */
export function macBundleOf(exePath: string): string | null {
  const i = exePath.indexOf('.app/Contents/MacOS/');
  return i < 0 ? null : exePath.slice(0, i + 4);
}

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface Release {
  tag: string;
  version: string;
  page: string;
  assets: ReleaseAsset[];
}

/** Resposta da API do GitHub (releases/latest) → só o que interessa. */
export function parseRelease(json: unknown): Release {
  const r = json as { tag_name?: string; html_url?: string; assets?: { name: string; browser_download_url: string; size: number }[] };
  if (!r || typeof r.tag_name !== 'string') throw new Error('Resposta inesperada do GitHub');
  return {
    tag: r.tag_name,
    version: r.tag_name.replace(/^v/i, ''),
    page: r.html_url ?? RELEASES_URL,
    assets: (r.assets ?? []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
  };
}

/** Instalador certo para o sistema: .dmg do Mac (chip Apple ou Intel) ou .exe do Windows. */
export function pickAsset(assets: ReleaseAsset[], app: Pick<AppDef, 'asset'>, platform: string, arch: string): ReleaseAsset | null {
  const mine = assets.filter((a) => a.name.startsWith(`${app.asset}-`));
  if (platform === 'darwin') {
    const x64 = mine.find((a) => a.name.endsWith('-mac-x64.dmg')) ?? null;
    // chip Apple roda a versão Intel pelo Rosetta; o Mac Intel não roda a versão de chip Apple
    return arch === 'arm64' ? (mine.find((a) => a.name.endsWith('-mac-arm64.dmg')) ?? x64) : x64;
  }
  if (platform === 'win32') return mine.find((a) => a.name.endsWith('.exe')) ?? null;
  return null;
}

/** -1, 0 ou 1 comparando "0.10.2" com "0.9.0" (números por partes). */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Produtos                                                            */
/* ------------------------------------------------------------------ */

/** Arquivo encontrado na pasta de trabalho. */
export interface FoundFile {
  path: string;
  name: string;
  dir: string;
  mtime: number;
  kind: 'adraw' | 'ctx';
  /** Só para .adraw: dados da ficha. */
  ficha?: { ref?: string; nome?: string; colecao?: string; status?: string; moldes?: { path: string; name: string } | null };
}

export interface Product {
  key: string;
  ref: string;
  nome: string;
  colecao: string;
  status: string;
  dir: string;
  desenho: string | null;
  moldes: string[];
  mtime: number;
}

const base = (name: string) => name.replace(/\.[^.]+$/, '');

/**
 * Junta desenhos (.adraw) e moldes (.ctx) em produtos: o .ctx vinculado na ficha é do produto;
 * sem vínculo, moldes na mesma pasta de um único desenho também são; o resto vira produto só de moldes.
 */
export function groupProducts(files: FoundFile[]): Product[] {
  const draws = files.filter((f) => f.kind === 'adraw');
  const ctxs = files.filter((f) => f.kind === 'ctx');
  const used = new Set<string>();
  const products: Product[] = draws.map((d) => {
    const linked = d.ficha?.moldes?.path;
    const moldes = ctxs.filter((c) => c.path === linked).map((c) => c.path);
    moldes.forEach((m) => used.add(m));
    return {
      key: d.path,
      ref: d.ficha?.ref?.trim() || base(d.name),
      nome: d.ficha?.nome?.trim() || base(d.name),
      colecao: d.ficha?.colecao ?? '',
      status: d.ficha?.status ?? 'rascunho',
      dir: d.dir,
      desenho: d.path,
      moldes,
      mtime: d.mtime,
    };
  });
  // moldes sem vínculo na mesma pasta de exatamente um desenho
  for (const c of ctxs) {
    if (used.has(c.path)) continue;
    const same = products.filter((p) => p.dir === c.dir && p.desenho);
    if (same.length === 1) {
      same[0]!.moldes.push(c.path);
      same[0]!.mtime = Math.max(same[0]!.mtime, c.mtime);
      used.add(c.path);
    }
  }
  for (const c of ctxs) {
    if (used.has(c.path)) continue;
    products.push({ key: c.path, ref: base(c.name), nome: base(c.name), colecao: '', status: '', dir: c.dir, desenho: null, moldes: [c.path], mtime: c.mtime });
  }
  return products.sort((a, b) => b.mtime - a.mtime);
}

/** Nome de pasta seguro a partir de referência e nome. */
export function productFolderName(ref: string, nome: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  return [clean(ref), clean(nome)].filter(Boolean).join(' - ') || 'Novo produto';
}

/** Documento inicial do Draw (o Draw completa o resto da ficha ao abrir). */
export function newDrawDoc(ref: string, nome: string, colecao: string, moldes: { path: string; name: string } | null) {
  return {
    format: 'andromeda-draw',
    version: 1,
    name: ref || nome,
    artboard: { w: 420, h: 297 },
    scale: 5,
    layers: [
      { id: 'croqui', name: 'Croqui', visible: true, locked: false, shapes: [] },
      { id: 'desenho', name: 'Desenho', visible: true, locked: false, shapes: [] },
    ],
    ficha: { ref, nome, colecao, status: 'rascunho', data: new Date().toISOString().slice(0, 10), moldes },
  };
}
