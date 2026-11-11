/**
 * MINHAS BASES: moldes-base da pessoa/equipe (camisa da casa, calça da marca…), guardados fora
 * dos documentos e usados em qualquer arquivo. Dá para salvar os moldes selecionados como base,
 * editar (inserir, mexer e atualizar a base), excluir e passar para os colegas em pacote (.moldesbases).
 */
import { useSyncExternalStore } from 'react';
import { type Piece, parseDocument } from '@cad-textil/core';
import { platform } from '../platform';
import { Store, editor, notify, selectedPieces } from './store';

export type Genero = 'feminino' | 'masculino' | 'unissex' | 'infantil';
export const GENEROS: { id: Genero; label: string }[] = [
  { id: 'feminino', label: 'Feminino' },
  { id: 'masculino', label: 'Masculino' },
  { id: 'unissex', label: 'Unissex' },
  { id: 'infantil', label: 'Infantil' },
];
export const CATEGORIAS = ['Blocos', 'Malharia', 'Camisaria', 'Saias', 'Calças', 'Vestidos', 'Alfaiataria', 'Moda praia', 'Íntima', 'Infantil', 'Outras'];

export interface MyBase {
  id: string;
  nome: string;
  categoria: string;
  genero: Genero;
  descricao: string;
  pecas: Piece[];
  criadaEm: string;
  atualizadaEm: string;
}

export interface MyBasesFile {
  format: 'andromeda-moldes-bases';
  version: 1;
  bases: MyBase[];
}

export const emptyBases = (): MyBasesFile => ({ format: 'andromeda-moldes-bases', version: 1, bases: [] });

let seq = 0;
const newBaseId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;
/** Cópia independente dos moldes (o documento continua com os dele). */
const clonePieces = (ps: Piece[]): Piece[] => JSON.parse(JSON.stringify(ps)) as Piece[];

export function makeBase(info: Pick<MyBase, 'nome' | 'categoria' | 'genero' | 'descricao'>, pecas: Piece[]): MyBase {
  const now = new Date().toISOString();
  return { id: newBaseId(), nome: info.nome.trim() || 'Base sem nome', categoria: info.categoria || 'Outras', genero: info.genero, descricao: info.descricao.trim(), pecas: clonePieces(pecas), criadaEm: now, atualizadaEm: now };
}

/** Lê o arquivo salvo ou um pacote; ignora bases estragadas. */
export function parseBases(text: string): MyBasesFile {
  const raw = JSON.parse(text) as Partial<MyBasesFile>;
  if (raw.format !== 'andromeda-moldes-bases' || !Array.isArray(raw.bases)) throw new Error('Este arquivo não é um pacote de bases do Andromeda Moldes');
  const generos = new Set(GENEROS.map((g) => g.id));
  const bases = raw.bases.filter(
    (b): b is MyBase => !!b && typeof b.id === 'string' && typeof b.nome === 'string' && Array.isArray(b.pecas) && b.pecas.length > 0 && b.pecas.every((p) => !!p && typeof p === 'object' && 'outline' in p),
  );
  return { format: 'andromeda-moldes-bases', version: 1, bases: bases.map((b) => ({ ...b, genero: generos.has(b.genero) ? b.genero : 'unissex', categoria: b.categoria || 'Outras', descricao: b.descricao ?? '' })) };
}

/** Junta um pacote: a mesma base (id) vinda de novo só substitui se for mais nova. */
export function mergeBases(file: MyBasesFile, pack: MyBasesFile): { file: MyBasesFile; added: number; updated: number } {
  const byId = new Map(file.bases.map((b) => [b.id, b]));
  let added = 0, updated = 0;
  for (const b of pack.bases) {
    const cur = byId.get(b.id);
    if (!cur) {
      byId.set(b.id, b);
      added++;
    } else if (b.atualizadaEm > cur.atualizadaEm) {
      byId.set(b.id, b);
      updated++;
    }
  }
  return { file: { ...file, bases: [...byId.values()] }, added, updated };
}

/* ------------------------------------------------------------------ */
/* Estado e ações                                                      */
/* ------------------------------------------------------------------ */

export const myBases = new Store<{ file: MyBasesFile; loaded: boolean; lastInserted: string | null }>({ file: emptyBases(), loaded: false, lastInserted: null });

export function useMyBases() {
  return useSyncExternalStore(myBases.subscribe, myBases.get);
}

export async function loadMyBases() {
  const text = await platform.basesLoad();
  let file = emptyBases();
  if (text) {
    try {
      file = parseBases(text);
    } catch {
      notify('As Minhas bases salvas estavam com problema e foram ignoradas', 'error');
    }
  }
  myBases.set({ file, loaded: true });
}

async function save(file: MyBasesFile) {
  myBases.set({ file });
  if (!(await platform.basesSave(JSON.stringify(file)))) notify('Não foi possível guardar as bases neste computador', 'error');
}

/** Moldes que vão para a base: os selecionados ou, sem seleção, todos do documento. */
export function piecesForBase(): Piece[] {
  const sel = selectedPieces();
  return sel.length ? sel : editor.get().doc.pieces;
}

export async function saveAsBase(info: Pick<MyBase, 'nome' | 'categoria' | 'genero' | 'descricao'>): Promise<MyBase | null> {
  const pecas = piecesForBase();
  if (!pecas.length) {
    notify('Não há moldes no documento para virar base', 'error');
    return null;
  }
  const b = makeBase(info, pecas);
  await save({ ...myBases.get().file, bases: [...myBases.get().file.bases, b] });
  notify(`"${b.nome}" salva em Minhas bases (${b.pecas.length} moldes)`);
  return b;
}

/** Atualiza a base com os moldes atuais (fluxo de edição: inserir → mexer → atualizar). */
export async function replaceBasePieces(id: string) {
  const pecas = piecesForBase();
  if (!pecas.length) return notify('Selecione os moldes que vão substituir a base', 'error');
  const now = new Date().toISOString();
  await save({ ...myBases.get().file, bases: myBases.get().file.bases.map((b) => (b.id === id ? { ...b, pecas: clonePieces(pecas), atualizadaEm: now } : b)) });
  notify(`Base atualizada com ${pecas.length} molde(s)`);
}

export async function updateBaseInfo(id: string, patch: Partial<Pick<MyBase, 'nome' | 'categoria' | 'genero' | 'descricao'>>) {
  const now = new Date().toISOString();
  await save({ ...myBases.get().file, bases: myBases.get().file.bases.map((b) => (b.id === id ? { ...b, ...patch, atualizadaEm: now } : b)) });
}

export async function deleteBase(id: string) {
  await save({ ...myBases.get().file, bases: myBases.get().file.bases.filter((b) => b.id !== id) });
}

/** Copia uma base pronta do Andromeda para Minhas bases (para editar do jeito da casa). */
export async function copyBuiltIn(nome: string, categoria: string, genero: Genero, descricao: string, pecas: Piece[]) {
  const b = makeBase({ nome: `${nome} (minha)`, categoria, genero, descricao }, pecas);
  await save({ ...myBases.get().file, bases: [...myBases.get().file.bases, b] });
  notify(`"${b.nome}" copiada para Minhas bases`);
  return b;
}

/** Pacote para os colegas. */
export async function exportBases(ids?: string[]) {
  const bases = myBases.get().file.bases.filter((b) => !ids || ids.includes(b.id));
  if (!bases.length) return notify('Minhas bases ainda está vazia', 'error');
  const ref = await platform.exportFile(JSON.stringify({ ...emptyBases(), bases }), 'Minhas bases.moldesbases', 'Bases do Andromeda Moldes', 'moldesbases');
  if (ref) notify(`Bases exportadas: ${ref.name} (${bases.length})`);
}

/** Importa um pacote de bases ou um arquivo .ctx (todos os moldes viram uma base). */
export async function importBases(): Promise<MyBase | null> {
  const f = await platform.importFile('Pacote de bases ou arquivo de moldes', ['moldesbases', 'ctx']);
  if (!f) return null;
  const text = new TextDecoder().decode(f.data);
  try {
    if (f.name.toLowerCase().endsWith('.ctx')) {
      const doc = parseDocument(text);
      if (!doc.pieces.length) throw new Error('o arquivo não tem moldes');
      const b = makeBase({ nome: f.name.replace(/\.ctx$/i, ''), categoria: 'Outras', genero: 'unissex', descricao: `Importada de ${f.name}` }, doc.pieces);
      await save({ ...myBases.get().file, bases: [...myBases.get().file.bases, b] });
      notify(`${f.name} virou a base "${b.nome}" (${b.pecas.length} moldes)`);
      return b;
    }
    const r = mergeBases(myBases.get().file, parseBases(text));
    await save(r.file);
    notify(`${r.added} base(s) nova(s)${r.updated ? ` · ${r.updated} atualizada(s)` : ''} de ${f.name}`);
    return null;
  } catch (err) {
    notify(`Não foi possível importar ${f.name}: ${(err as Error).message}`, 'error');
    return null;
  }
}
