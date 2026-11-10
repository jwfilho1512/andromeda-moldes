import { useSyncExternalStore } from 'react';
import { type PatternDocument, type Piece, newDocument, vertices, edgeCount } from '@cad-textil/core';
import type { FileRef } from '../platform';

export type Tool =
  | 'select' | 'pan'
  | 'pen' | 'curve' | 'rect' | 'internal'
  | 'convert' | 'addPoint' | 'removePoint'
  | 'dart' | 'dartTransfer' | 'cut' | 'join' | 'fold' | 'unfold' | 'pleat' | 'spread' | 'spreadRadial'
  | 'walk'
  | 'seam'
  | 'parallel'
  | 'notch' | 'measure'
  | 'print'
  | 'coordPoint';

export type Theme = 'escuro' | 'claro' | 'escuro-total';

/** Unidade de medida da interface. */
export type LenUnit = 'mm' | 'cm' | 'pol';

/** Opções das ferramentas (barra de controle). Valores em mm. */
export interface ToolOpts {
  dartWidth: number;
  cutSeam: number;
  pleatDepth: number;
  spreadMm: number;
  notchDepth: number;
  /** Valor aplicado pela ferramenta Margem de costura. */
  seamMm: number;
  /** Ferramenta Margem: aplicar como barra com cantos espelhados (bainha de manga, calça…). */
  seamHem: boolean;
  /** Paralelo: distância (mm). */
  parallelMm: number;
  /** Piques e pontos: no clique, a uma distância do canto, ou dividindo a borda em N. */
  measureMode: 'clique' | 'distancia' | 'dividir';
  measureDistMm: number;
  divideN: number;
  /** Girar por ângulo (graus). */
  rotateDeg: number;
}

/** O que o ímã atrai (guias inteligentes). */
export interface SnapOpts {
  ponto: boolean;
  meio: boolean;
  intersecao: boolean;
  perpendicular: boolean;
  borda: boolean;
  alinhamento: boolean;
  guias: boolean;
}

export interface EdgeRef {
  pieceId: string;
  edge: number;
}

export interface Selection {
  pieceId: string | null;
  vertex: number | null;
  edge: number | null;
}

export interface EditorState {
  doc: PatternDocument;
  file: FileRef;
  dirty: boolean;
  selection: Selection;
  /** Estampa ativa (editada pelo painel e pela ferramenta Estampa). */
  activePrint: string | null;
  /** Seleção múltipla: ids dos moldes selecionados (inclui selection.pieceId). Vazia = nada ou só a seleção simples. */
  multi: string[];
  tool: Tool;
  /** Passo do ímã de grade em mm (0 = desligado). */
  snapMm: number;
  past: PatternDocument[];
  future: PatternDocument[];
  message: { text: string; kind: 'info' | 'error' } | null;
  opts: ToolOpts;
  theme: Theme;
  /** Unidade em que as medidas aparecem e são digitadas (o arquivo continua em mm). */
  unit: LenUnit;
  /** Visibilidade/bloqueio por molde (estado da tela, não vai para o arquivo). */
  hidden: Record<string, boolean>;
  locked: Record<string, boolean>;
  /** Conferência de costuras: soma das bordas A × soma das bordas B. */
  compare: { a: EdgeRef[]; b: EdgeRef[] };
  /** Gradação: mostrar ninho de tamanhos, grade padrão para moldes novos, regra copiada. */
  showGrade: boolean;
  gradeDefault: { sizes: string[]; base: number };
  ruleClipboard: { x: number; y: number }[] | null;
  /** Área de trabalho ativa. */
  workspace: 'modelagem' | 'risco';
  snap: SnapOpts;
}

/** Informações de vista (mudam a cada movimento do mouse — store separado). */
export interface ViewInfo {
  cursor: { x: number; y: number } | null;
  pxPerMm: number;
  /** Resultado da última medição. */
  measure: { a: { x: number; y: number }; b: { x: number; y: number } } | null;
}

type Listener = () => void;

export class Store<T> {
  private listeners = new Set<Listener>();
  constructor(private state: T) {}
  get = (): T => this.state;
  set = (patch: Partial<T> | ((s: T) => Partial<T>)): void => {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  };
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export const NO_SELECTION: Selection = { pieceId: null, vertex: null, edge: null };

export const editor = new Store<EditorState>({
  doc: newDocument('Sem título'),
  file: { path: null, name: 'Sem título.ctx' },
  dirty: false,
  selection: NO_SELECTION,
  multi: [],
  activePrint: null,
  tool: 'select',
  snapMm: 1,
  past: [],
  future: [],
  message: null,
  opts: { dartWidth: 30, cutSeam: 0, pleatDepth: 30, spreadMm: 40, notchDepth: 5, seamMm: 10, seamHem: false, parallelMm: 10, measureMode: 'clique', measureDistMm: 50, divideN: 2, rotateDeg: 15 },
  snap: { ponto: true, meio: true, intersecao: true, perpendicular: true, borda: true, alinhamento: true, guias: true },
  theme: loadTheme(),
  unit: loadUnit(),
  hidden: {},
  locked: {},
  compare: { a: [], b: [] },
  showGrade: true,
  gradeDefault: { sizes: ['PP', 'P', 'M', 'G', 'GG'], base: 2 },
  ruleClipboard: null,
  workspace: 'modelagem',
});

function loadUnit(): LenUnit {
  try {
    const u = localStorage.getItem('cad.unit');
    if (u === 'mm' || u === 'cm' || u === 'pol') return u;
  } catch {
    /* sem armazenamento */
  }
  return 'mm';
}

export function setUnit(unit: LenUnit): void {
  try {
    localStorage.setItem('cad.unit', unit);
  } catch {
    /* sem armazenamento */
  }
  editor.set({ unit });
}

/* ---------------- unidade de medida ---------------- */
// Tudo por dentro continua em mm; só a exibição e a digitação mudam.
export const UNIT_MM: Record<LenUnit, number> = { mm: 1, cm: 10, pol: 25.4 };
export const UNIT_LABEL: Record<LenUnit, string> = { mm: 'mm', cm: 'cm', pol: 'pol' };

export const unitLabel = (): string => UNIT_LABEL[editor.get().unit];
/** mm → unidade da interface. */
export const toUnit = (mm: number): number => mm / UNIT_MM[editor.get().unit];
/** unidade da interface → mm. */
export const fromUnit = (v: number): number => v * UNIT_MM[editor.get().unit];
/** Casas decimais na unidade atual, para um valor que em mm teria `mmDigits` casas. */
export function unitDigits(mmDigits = 1): number {
  const u = editor.get().unit;
  return u === 'mm' ? mmDigits : u === 'cm' ? Math.min(3, mmDigits + 1) : Math.min(3, mmDigits + 2);
}
/** Medida formatada na unidade atual, sem o nome da unidade ("12,5"). */
export function fmtLen(mm: number, mmDigits = 1): string {
  return fmtMm(toUnit(mm), unitDigits(mmDigits));
}
/** Medida formatada com a unidade ("12,5 mm", "1,25 cm", "0,49 pol"). */
export function fmtLenU(mm: number, mmDigits = 1): string {
  return `${fmtLen(mm, mmDigits)} ${unitLabel()}`;
}
/** Texto digitado na unidade atual → mm (null se não for número). */
export function parseLen(text: string): number | null {
  const n = parseNum(text);
  return n === null ? null : fromUnit(n);
}

function loadTheme(): Theme {
  try {
    const t = localStorage.getItem('cad.theme');
    if (t === 'escuro' || t === 'claro' || t === 'escuro-total') return t;
  } catch {
    /* sem armazenamento */
  }
  return 'escuro';
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem('cad.theme', theme);
  } catch {
    /* sem armazenamento */
  }
  editor.set({ theme });
}

export function setOpt<K extends keyof ToolOpts>(k: K, v: ToolOpts[K]): void {
  editor.set((s) => ({ opts: { ...s.opts, [k]: v } }));
}

/** Troca moldes: remove `removeIds`, acrescenta `add` (com histórico). */
export function replacePieces(removeIds: string[], add: Piece[], selectId?: string): void {
  const s = editor.get();
  const pieces = s.doc.pieces.flatMap((p) => {
    if (!removeIds.includes(p.id)) return [p];
    // o primeiro novo molde entra no lugar do primeiro removido (mantém a ordem)
    return p.id === removeIds[0] ? add : [];
  });
  if (!s.doc.pieces.some((p) => p.id === removeIds[0])) pieces.push(...add);
  commit({ ...s.doc, pieces }, { pieceId: selectId ?? add[0]?.id ?? null, vertex: null, edge: null });
}

export const viewInfo = new Store<ViewInfo>({ cursor: null, pxPerMm: 1, measure: null });

/** Estado do Andar molde (atualizado pelo canvas a cada movimento). */
export interface WalkInfo {
  aName: string;
  bName: string;
  s: number;
  frozen: boolean;
  mirrored: boolean;
  nextCornerA: number | null;
  nextCornerB: number | null;
  cornerDiff: number | null;
  notchPairs: { a: number; b: number; diff: number }[];
  startAngleDeg: number;
}
export const walkStore = new Store<{ info: WalkInfo | null }>({ info: null });

/** Ponto por coordenada: referência clicada e deslocamento digitado (mm, Y para cima). */
export interface CoordPick {
  ref: { x: number; y: number };
  /** O que o clique atraiu (canto, meio, interseção…), para mostrar na janela. */
  label: string;
  dx: number;
  dy: number;
  /** Referência veio do encadeamento (ponto recém-criado): mantém os valores digitados. */
  chained?: boolean;
}
export const coordStore = new Store<{ pick: CoordPick | null }>({ pick: null });
export function useCoordPick(): CoordPick | null {
  return useSyncExternalStore(coordStore.subscribe, () => coordStore.get().pick);
}
export function useWalk(): WalkInfo | null {
  return useSyncExternalStore(walkStore.subscribe, () => walkStore.get().info);
}

export function useEditor(): EditorState {
  return useSyncExternalStore(editor.subscribe, editor.get);
}
export function useViewInfo(): ViewInfo {
  return useSyncExternalStore(viewInfo.subscribe, viewInfo.get);
}

/* ------------------------------------------------------------------ */
/* Documento + histórico                                               */
/* ------------------------------------------------------------------ */

const HISTORY_LIMIT = 300;

export function selectedPiece(s: EditorState = editor.get()): Piece | null {
  return s.doc.pieces.find((p) => p.id === s.selection.pieceId) ?? null;
}

/** Garante que a seleção aponte para coisas que existem. */
function validSelection(doc: PatternDocument, sel: Selection): Selection {
  const piece = doc.pieces.find((p) => p.id === sel.pieceId);
  if (!piece) return NO_SELECTION;
  const nv = vertices(piece.outline).length;
  const ne = edgeCount(piece.outline);
  return {
    pieceId: piece.id,
    vertex: sel.vertex !== null && sel.vertex < nv ? sel.vertex : null,
    edge: sel.edge !== null && sel.edge < ne ? sel.edge : null,
  };
}

/** Aplica uma mudança no documento, registrando no histórico (desfazer). */
export function commit(doc: PatternDocument, selection?: Selection, multi?: string[]): void {
  editor.set((s) => {
    const sel = validSelection(doc, selection ?? s.selection);
    return {
      doc,
      past: [...s.past.slice(-HISTORY_LIMIT + 1), s.doc],
      future: [],
      dirty: true,
      selection: sel,
      multi: syncMulti(doc, sel, multi ?? s.multi),
    };
  });
}

/** Mantém a lista da seleção múltipla coerente com a seleção simples e com o documento. */
function syncMulti(doc: PatternDocument, sel: Selection, multi: string[]): string[] {
  const ids = new Set(doc.pieces.map((p) => p.id));
  const m = multi.filter((id) => ids.has(id));
  if (!sel.pieceId) return [];
  return m.includes(sel.pieceId) ? m : [sel.pieceId];
}

/** Ids dos moldes selecionados (um ou vários). */
export function selectedIds(s: EditorState = editor.get()): string[] {
  if (s.multi.length) return s.multi;
  return s.selection.pieceId ? [s.selection.pieceId] : [];
}

/** Moldes selecionados, na ordem do documento. */
export function selectedPieces(s: EditorState = editor.get()): Piece[] {
  const ids = new Set(selectedIds(s));
  return s.doc.pieces.filter((p) => ids.has(p.id));
}

/** Seleciona vários moldes; `primary` (ou o último) fica como molde ativo. */
export function selectMany(ids: string[], primary?: string): void {
  editor.set((s) => {
    const exist = new Set(s.doc.pieces.map((p) => p.id));
    const list = [...new Set(ids)].filter((id) => exist.has(id));
    const main = primary && list.includes(primary) ? primary : list[list.length - 1] ?? null;
    return { selection: { pieceId: main, vertex: null, edge: null }, multi: main ? list : [] };
  });
}

/** Shift+clique: põe ou tira o molde da seleção. */
export function toggleSelected(id: string): void {
  const cur = selectedIds();
  if (cur.includes(id)) {
    const rest = cur.filter((x) => x !== id);
    selectMany(rest, rest[rest.length - 1]);
  } else selectMany([...cur, id], id);
}

/** Atualiza um molde (por id) com registro no histórico. */
export function commitPiece(id: string, f: (p: Piece) => Piece, selection?: Selection): void {
  const s = editor.get();
  commit({ ...s.doc, pieces: s.doc.pieces.map((p) => (p.id === id ? f(p) : p)) }, selection);
}

/** Atualização ao vivo durante arraste (sem histórico); feche com endLive(base). */
export function liveUpdate(doc: PatternDocument): void {
  editor.set({ doc });
}

export function endLive(base: PatternDocument): void {
  editor.set((s) => (s.doc === base ? {} : { past: [...s.past.slice(-HISTORY_LIMIT + 1), base], future: [], dirty: true }));
}

export function undo(): void {
  editor.set((s) => {
    const prev = s.past[s.past.length - 1];
    if (!prev) return {};
    const selection = validSelection(prev, s.selection);
    return { doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future], dirty: true, selection, multi: syncMulti(prev, selection, s.multi) };
  });
}

export function redo(): void {
  editor.set((s) => {
    const next = s.future[0];
    if (!next) return {};
    const selection = validSelection(next, s.selection);
    return { doc: next, past: [...s.past, s.doc], future: s.future.slice(1), dirty: true, selection, multi: syncMulti(next, selection, s.multi) };
  });
}

export function loadDocument(doc: PatternDocument, file: FileRef): void {
  editor.set({ doc, file, dirty: false, past: [], future: [], selection: NO_SELECTION, multi: [] });
}

export function select(selection: Partial<Selection> | null): void {
  editor.set((s) => {
    const sel = selection === null ? NO_SELECTION : validSelection(s.doc, { ...NO_SELECTION, ...selection });
    return { selection: sel, multi: sel.pieceId ? [sel.pieceId] : [] };
  });
}

let msgTimer: ReturnType<typeof setTimeout> | undefined;
export function notify(text: string, kind: 'info' | 'error' = 'info'): void {
  editor.set({ message: { text, kind } });
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => editor.set({ message: null }), kind === 'error' ? 7000 : 3500);
}

export function newId(): string {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function nextPieceName(doc: PatternDocument): string {
  let n = doc.pieces.length + 1;
  while (doc.pieces.some((p) => p.name === `Molde ${n}`)) n++;
  return `Molde ${n}`;
}

/** Formata mm no padrão brasileiro. */
export function fmtMm(mm: number, digits = 1): string {
  return mm.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Aceita "12,5" ou "12.5". */
/** Número para campos de edição: sem separador de milhar (1500,5), para editar sem ambiguidade. */
export function fmtInput(mm: number, digits = 1): string {
  return mm.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
}

/**
 * Lê números no padrão brasileiro e também no internacional:
 * "12,5" · "12.5" · "1500" · "1.500" (milhar) · "1.500,5" · "1,500.5".
 */
export function parseNum(text: string): number | null {
  let t = text.trim().replace(/\s/g, '');
  if (!t) return null;
  const hasComma = t.includes(','), hasDot = t.includes('.');
  if (hasComma && hasDot) {
    // o separador que aparece por último é o decimal
    t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (hasComma) {
    t = t.replace(',', '.');
  } else if (hasDot && /^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, ''); // "1.500" = mil e quinhentos
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Liga/desliga a barra com cantos espelhados numa borda (mantém as outras). */
export function withHem(p: Piece, edge: number, on: boolean): Piece {
  const { [String(edge)]: _, ...rest } = p.hemByEdge ?? {};
  const hemByEdge = on ? { ...rest, [String(edge)]: true as const } : rest;
  return { ...p, hemByEdge: Object.keys(hemByEdge).length ? hemByEdge : undefined };
}
