/**
 * MINHA BIBLIOTECA: assets da pessoa/equipe (peças base, detalhes, aviamentos, croquis…),
 * guardados fora do desenho e usados em qualquer documento. Também vão e voltam em pacotes
 * (.adrawlib) para passar a biblioteca para os colegas.
 */
import { bboxOfShapes, transformShape } from './geom';
import type { Shape } from './types';

export type AssetCat = 'pecas' | 'detalhes' | 'aviamentos' | 'croquis' | 'estampas' | 'outros';

export const ASSET_CATS: { id: AssetCat; label: string }[] = [
  { id: 'pecas', label: 'Peças base' },
  { id: 'detalhes', label: 'Detalhes' },
  { id: 'aviamentos', label: 'Aviamentos' },
  { id: 'croquis', label: 'Croquis' },
  { id: 'estampas', label: 'Estampas e símbolos' },
  { id: 'outros', label: 'Outros' },
];

export interface UserAsset {
  id: string;
  name: string;
  cat: AssetCat;
  /** Formas com o centro de cima em (0, 0): x = 0 no meio, y = 0 no topo. */
  shapes: Shape[];
  /** Escala do documento quando foi salvo (para entrar do mesmo tamanho real em outra escala). */
  scale: number;
  createdAt: string;
}

export interface UserLibrary {
  format: 'andromeda-draw-lib';
  version: 1;
  assets: UserAsset[];
}

export const emptyLibrary = (): UserLibrary => ({ format: 'andromeda-draw-lib', version: 1, assets: [] });

/** Centraliza as formas: meio em x = 0 e topo em y = 0 (a simetria vai junto). */
export function normalizeShapes(shapes: Shape[]): Shape[] {
  const b = bboxOfShapes(shapes);
  if (!b) return shapes;
  const dx = -(b.minX + b.maxX) / 2, dy = -b.minY;
  return shapes.map((s) => transformShape(s, { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy }));
}

let seq = 0;
const newAssetId = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

export function makeAsset(name: string, cat: AssetCat, shapes: Shape[], scale: number): UserAsset {
  return { id: newAssetId(), name: name.trim() || 'Sem nome', cat, shapes: normalizeShapes(JSON.parse(JSON.stringify(shapes)) as Shape[]), scale, createdAt: new Date().toISOString() };
}

/** Lê um pacote ou a biblioteca salva; ignora o que estiver estragado. */
export function parseLibrary(text: string): UserLibrary {
  const raw = JSON.parse(text) as Partial<UserLibrary>;
  if (raw.format !== 'andromeda-draw-lib' || !Array.isArray(raw.assets)) throw new Error('Este arquivo não é uma biblioteca do Andromeda Draw');
  const cats = new Set(ASSET_CATS.map((c) => c.id));
  const assets = raw.assets.filter(
    (a): a is UserAsset => !!a && typeof a.id === 'string' && typeof a.name === 'string' && Array.isArray(a.shapes) && a.shapes.length > 0 && cats.has(a.cat),
  );
  return { format: 'andromeda-draw-lib', version: 1, assets: assets.map((a) => ({ ...a, scale: a.scale > 0 ? a.scale : 5 })) };
}

/** Junta um pacote à biblioteca: itens repetidos (mesmo id) não duplicam. */
export function mergeLibrary(lib: UserLibrary, pack: UserLibrary): { lib: UserLibrary; added: number } {
  const have = new Set(lib.assets.map((a) => a.id));
  const fresh = pack.assets.filter((a) => !have.has(a.id));
  return { lib: { ...lib, assets: [...lib.assets, ...fresh] }, added: fresh.length };
}

/** Formas do asset prontas para entrar no documento (na escala dele). */
export function assetShapes(a: UserAsset, docScale: number): Shape[] {
  const k = a.scale / docScale;
  return k === 1 ? a.shapes : a.shapes.map((s) => transformShape(s, { a: k, b: 0, c: 0, d: k, e: 0, f: 0 }));
}
