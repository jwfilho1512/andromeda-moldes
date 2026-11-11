/** Estado e ações da Minha biblioteca (carrega ao abrir, salva a cada mudança). */
import { useSyncExternalStore } from 'react';
import { importSvg } from './model/importSvg';
import { type AssetCat, type UserAsset, type UserLibrary, assetShapes, emptyLibrary, makeAsset, mergeLibrary, parseLibrary } from './model/userlib';
import type { Shape } from './model/types';
import { platform } from './platform';
import { Store, addShapes, cloneShape, editor, newId, notify, selectedShapes, setTool } from './state';
import { group } from './lib/kit';
import { canvasApi } from './ui/Canvas';

export const userLib = new Store<{ lib: UserLibrary; loaded: boolean }>({ lib: emptyLibrary(), loaded: false });

export function useUserLib() {
  return useSyncExternalStore(userLib.subscribe, userLib.get);
}

export async function loadUserLib() {
  const text = await platform.libLoad();
  let lib = emptyLibrary();
  if (text) {
    try {
      lib = parseLibrary(text);
    } catch {
      notify('A Minha biblioteca salva estava com problema e foi ignorada', 'erro');
    }
  }
  userLib.set({ lib, loaded: true });
}

async function save(lib: UserLibrary) {
  userLib.set({ lib });
  const ok = await platform.libSave(JSON.stringify(lib));
  if (!ok) notify('Não foi possível guardar a biblioteca neste computador', 'erro');
}

/** Salva a seleção como asset. */
export async function addSelectionAsset(name: string, cat: AssetCat) {
  const sel = selectedShapes();
  if (!sel.length) return notify('Selecione o desenho que vai para a biblioteca', 'erro');
  const a = makeAsset(name, cat, sel, editor.get().doc.scale);
  await save({ ...userLib.get().lib, assets: [...userLib.get().lib.assets, a] });
  notify(`"${a.name}" salvo na Minha biblioteca`);
}

export async function removeAsset(id: string) {
  await save({ ...userLib.get().lib, assets: userLib.get().lib.assets.filter((a) => a.id !== id) });
}

export async function updateAsset(id: string, patch: Partial<Pick<UserAsset, 'name' | 'cat'>>) {
  await save({ ...userLib.get().lib, assets: userLib.get().lib.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
}

/** Coloca o asset no desenho (centro da vista; peça com simetria entra no eixo). */
export function insertAsset(a: UserAsset) {
  const s = editor.get();
  const shapes = assetShapes(a, s.doc.scale).map(cloneShape);
  const symmetric = shapes.some((x) => x.mirror !== undefined || (x.kind === 'group' && x.children.some((c) => c.mirror !== undefined)));
  const c = canvasApi.center();
  const at = { x: symmetric ? s.axis : c.x, y: c.y - 20 };
  const g: Shape = shapes.length === 1 ? moveTo(shapes[0]!, at) : group(a.name, shapes, at);
  if (editor.get().view !== 'desenho') editor.set({ view: 'desenho' });
  addShapes([g]);
  setTool('select');
}

const moveTo = (s: Shape, at: { x: number; y: number }): Shape => ({ ...(group('x', [s], at) as Extract<Shape, { kind: 'group' }>).children[0]!, id: newId(), name: s.name });

/** Importa para a biblioteca: pacotes .adrawlib e arquivos SVG (cada SVG vira um asset). */
export async function importIntoLibrary(files: { name: string; data: Uint8Array }[], cat: AssetCat) {
  let lib = userLib.get().lib;
  let added = 0;
  const errors: string[] = [];
  for (const f of files) {
    const ext = f.name.toLowerCase().split('.').pop();
    const text = new TextDecoder().decode(f.data);
    try {
      if (ext === 'adrawlib' || ext === 'json') {
        const r = mergeLibrary(lib, parseLibrary(text));
        lib = r.lib;
        added += r.added;
      } else if (ext === 'svg') {
        const r = importSvg(text);
        if (!r.shapes.length) throw new Error('sem desenho');
        // SVG entra no tamanho do arquivo (mm do papel) = escala do documento atual
        lib = { ...lib, assets: [...lib.assets, makeAsset(f.name.replace(/\.svg$/i, ''), cat, r.shapes, editor.get().doc.scale)] };
        added++;
      } else errors.push(`${f.name}: use SVG ou pacote .adrawlib`);
    } catch (err) {
      errors.push(`${f.name}: ${(err as Error).message}`);
    }
  }
  if (added) await save(lib);
  notify(`${added} asset(s) na Minha biblioteca${errors.length ? ' · ' + errors.join(' · ') : ''}`, errors.length && !added ? 'erro' : 'info');
}

export async function importLibraryDialog(cat: AssetCat) {
  const f = await platform.importFile('SVG ou biblioteca (.adrawlib)', ['svg', 'adrawlib']);
  if (f) await importIntoLibrary([f], cat);
}

/** Pacote com a biblioteca inteira (ou só uma categoria) para passar aos colegas. */
export async function exportLibrary(cat?: AssetCat) {
  const lib = userLib.get().lib;
  const assets = cat ? lib.assets.filter((a) => a.cat === cat) : lib.assets;
  if (!assets.length) return notify('A biblioteca ainda está vazia', 'erro');
  const ref = await platform.exportFile(JSON.stringify({ ...lib, assets }), 'Minha biblioteca.adrawlib', 'Biblioteca do Andromeda Draw', 'adrawlib');
  if (ref) notify(`Biblioteca exportada: ${ref.name} (${assets.length} asset(s))`);
}
