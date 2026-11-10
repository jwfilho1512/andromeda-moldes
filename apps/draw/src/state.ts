/** Estado do editor do Andromeda Draw (store simples + desfazer/refazer). */
import { useSyncExternalStore } from 'react';
import { emptyFicha, normalizeFicha, type Ficha } from './model/ficha';
import { type Affine, bakeMirror, transformShape } from './model/geom';
import { STITCH_DEFAULT } from './model/stitch';
import { TRIM_SIZE } from './model/trims';
import type { DrawDoc, Fill, Layer, Shape, StitchType, Style, TrimKind } from './model/types';

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

export type Tool = 'select' | 'direct' | 'pen' | 'rect' | 'ellipse' | 'line' | 'text' | 'stitch' | 'trim' | 'fill' | 'hand';
export type View = 'desenho' | 'ficha';
export type Theme = 'escuro' | 'claro';

export interface EditorState {
  doc: DrawDoc;
  file: { path: string | null; name: string };
  dirty: boolean;
  /** Ids das formas selecionadas (nível de cima das camadas). */
  selection: string[];
  activeLayer: string;
  tool: Tool;
  view: View;
  theme: Theme;
  /** Simetria ligada: o que se desenha é espelhado no eixo. */
  symmetry: boolean;
  /** Eixo de simetria (x, mm). */
  axis: number;
  style: Style;
  /** Ferramenta de pesponto, em mm da PEÇA REAL (convertidos pela escala do documento). */
  stitch: { type: StitchType; dist: number; side: 1 | -1; color: string; gap: number; len: number };
  trim: { kind: TrimKind; color: string };
  fill: Fill;
  past: DrawDoc[];
  future: DrawDoc[];
  message: { text: string; kind: 'info' | 'erro' } | null;
}

let seq = 0;
export const newId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newDoc(name = 'Sem título'): DrawDoc {
  return {
    format: 'andromeda-draw',
    version: 1,
    name,
    artboard: { w: 420, h: 297 },
    scale: 5,
    layers: [
      { id: 'croqui', name: 'Croqui', visible: true, locked: false, shapes: [] },
      { id: 'desenho', name: 'Desenho', visible: true, locked: false, shapes: [] },
    ],
    ficha: emptyFicha(),
  };
}

function loadTheme(): Theme {
  try {
    return localStorage.getItem('draw.theme') === 'claro' ? 'claro' : 'escuro';
  } catch {
    return 'escuro';
  }
}

export const editor = new Store<EditorState>({
  doc: newDoc(),
  file: { path: null, name: 'Sem título.adraw' },
  dirty: false,
  selection: [],
  activeLayer: 'desenho',
  tool: 'select',
  view: 'desenho',
  theme: loadTheme(),
  symmetry: true,
  axis: 210,
  style: { stroke: '#1b1b1f', width: 0.35, fill: { kind: 'solid', color: '#ffffff' } },
  stitch: { type: 'duplo', dist: 6, side: 1, color: '#1b1b1f', gap: STITCH_DEFAULT.duplo.gap * 10, len: STITCH_DEFAULT.duplo.len * 10 },
  trim: { kind: 'botao4', color: '#1b1b1f' },
  fill: { kind: 'pattern', pattern: 'sarja', c1: '#3d5a80', c2: '#24344d', scale: 0.6, angle: 0 },
  past: [],
  future: [],
  message: null,
});

export function useEditor<T = EditorState>(sel?: (s: EditorState) => T): T {
  return useSyncExternalStore(editor.subscribe, () => (sel ? sel(editor.get()) : (editor.get() as unknown as T)));
}

/* ------------------------------------------------------------------ */
/* Mensagens                                                           */
/* ------------------------------------------------------------------ */

let msgTimer: ReturnType<typeof setTimeout> | undefined;
export function notify(text: string, kind: 'info' | 'erro' = 'info') {
  editor.set({ message: { text, kind } });
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => editor.set({ message: null }), 4000);
}

/* ------------------------------------------------------------------ */
/* Documento                                                           */
/* ------------------------------------------------------------------ */

const HISTORY = 100;

/** Aplica uma mudança no documento com desfazer. */
export function commit(fn: (d: DrawDoc) => DrawDoc) {
  const s = editor.get();
  const doc = fn(s.doc);
  if (doc === s.doc) return;
  editor.set({ doc, past: [...s.past.slice(-HISTORY + 1), s.doc], future: [], dirty: true });
}

export function undo() {
  const s = editor.get();
  const prev = s.past[s.past.length - 1];
  if (!prev) return;
  editor.set({ doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future], dirty: true, selection: keepExisting(prev, s.selection) });
}

export function redo() {
  const s = editor.get();
  const next = s.future[0];
  if (!next) return;
  editor.set({ doc: next, past: [...s.past, s.doc], future: s.future.slice(1), dirty: true, selection: keepExisting(next, s.selection) });
}

function keepExisting(doc: DrawDoc, ids: string[]) {
  const all = new Set(doc.layers.flatMap((l) => l.shapes.map((x) => x.id)));
  return ids.filter((i) => all.has(i));
}

export function loadDoc(doc: DrawDoc, file: { path: string | null; name: string }) {
  const fixed: DrawDoc = { ...doc, ficha: normalizeFicha(doc.ficha) };
  editor.set({ doc: fixed, file, dirty: false, past: [], future: [], selection: [], activeLayer: fixed.layers[fixed.layers.length - 1]?.id ?? 'desenho', axis: fixed.artboard.w / 2 });
}

export const mapLayers = (d: DrawDoc, f: (l: Layer) => Layer): DrawDoc => ({ ...d, layers: d.layers.map(f) });

export function findShape(doc: DrawDoc, id: string): { shape: Shape; layer: Layer } | null {
  for (const layer of doc.layers) {
    const shape = layer.shapes.find((s) => s.id === id);
    if (shape) return { shape, layer };
  }
  return null;
}

export function selectedShapes(s: EditorState = editor.get()): Shape[] {
  return s.selection.map((id) => findShape(s.doc, id)?.shape).filter((x): x is Shape => !!x);
}

export function activeLayer(s: EditorState = editor.get()): Layer {
  return s.doc.layers.find((l) => l.id === s.activeLayer) ?? s.doc.layers[s.doc.layers.length - 1]!;
}

/** Acrescenta formas na camada ativa e seleciona. */
export function addShapes(shapes: Shape[], select = true) {
  const layer = activeLayer();
  if (layer.locked) {
    notify(`A camada "${layer.name}" está travada`, 'erro');
    return;
  }
  commit((d) => mapLayers(d, (l) => (l.id === layer.id ? { ...l, shapes: [...l.shapes, ...shapes] } : l)));
  if (select) editor.set({ selection: shapes.map((x) => x.id) });
}

/** Troca formas pelo id (em qualquer camada). */
export function updateShapes(ids: string[], fn: (s: Shape) => Shape) {
  const set = new Set(ids);
  commit((d) => mapLayers(d, (l) => ({ ...l, shapes: l.shapes.map((s) => (set.has(s.id) ? fn(s) : s)) })));
}

export function transformSelected(m: Affine) {
  updateShapes(editor.get().selection, (s) => transformShape(s, m));
}

export function deleteSelected() {
  const set = new Set(editor.get().selection);
  if (!set.size) return;
  commit((d) => mapLayers(d, (l) => ({ ...l, shapes: l.shapes.filter((s) => !set.has(s.id)) })));
  editor.set({ selection: [] });
}

/** Troca ids (e dos filhos) para uma cópia independente. */
export function cloneShape(s: Shape): Shape {
  return s.kind === 'group' ? { ...s, id: newId(), children: s.children.map(cloneShape) } : { ...s, id: newId() };
}

export function duplicateSelected(offset = 5) {
  const sel = selectedShapes();
  if (!sel.length) return;
  const copies = sel.map((s) => transformShape(cloneShape(s), { a: 1, b: 0, c: 0, d: 1, e: offset, f: offset }));
  addShapes(copies);
}

export function groupSelected() {
  const s = editor.get();
  const sel = selectedShapes(s);
  if (sel.length < 2) return;
  const ids = new Set(sel.map((x) => x.id));
  const g: Shape = { kind: 'group', id: newId(), children: sel };
  const target = findShape(s.doc, sel[sel.length - 1]!.id)!.layer.id;
  commit((d) =>
    mapLayers(d, (l) => {
      const shapes = l.shapes.filter((x) => !ids.has(x.id));
      return l.id === target ? { ...l, shapes: [...shapes, g] } : { ...l, shapes };
    }),
  );
  editor.set({ selection: [g.id] });
}

export function ungroupSelected() {
  const s = editor.get();
  const out: string[] = [];
  commit((d) =>
    mapLayers(d, (l) => ({
      ...l,
      shapes: l.shapes.flatMap((x) => {
        if (!s.selection.includes(x.id) || x.kind !== 'group') return [x];
        const kids = x.children.map((c) => (x.mirror !== undefined && c.mirror === undefined ? { ...c, mirror: x.mirror } : c));
        out.push(...kids.map((k) => k.id));
        return kids;
      }),
    })),
  );
  if (out.length) editor.set({ selection: out });
}

/** Simetria vira desenho de verdade (para editar os dois lados separados). */
export function expandMirrorSelected() {
  const s = editor.get();
  const out: string[] = [];
  commit((d) =>
    mapLayers(d, (l) => ({
      ...l,
      shapes: l.shapes.flatMap((x) => {
        if (!s.selection.includes(x.id) || x.mirror === undefined) return [x];
        const baked = bakeMirror(x);
        out.push(...baked.map((b) => b.id));
        return baked;
      }),
    })),
  );
  if (out.length) editor.set({ selection: out });
}

/** Ordem de empilhamento: 1 = para frente, -1 = para trás. */
export function arrangeSelected(dir: 1 | -1) {
  const set = new Set(editor.get().selection);
  commit((d) =>
    mapLayers(d, (l) => {
      const on = l.shapes.filter((x) => set.has(x.id));
      if (!on.length) return l;
      const off = l.shapes.filter((x) => !set.has(x.id));
      return { ...l, shapes: dir === 1 ? [...off, ...on] : [...on, ...off] };
    }),
  );
}

export function setFicha(patch: Partial<Ficha> | ((f: Ficha) => Partial<Ficha>)) {
  commit((d) => ({ ...d, ficha: { ...d.ficha, ...(typeof patch === 'function' ? patch(d.ficha) : patch) } }));
}

export function setTool(tool: Tool) {
  editor.set({ tool });
}

export function setStitchType(type: StitchType) {
  const def = STITCH_DEFAULT[type];
  editor.set((s) => ({ stitch: { ...s.stitch, type, gap: def.gap * 10, len: def.len * 10 } }));
}

/** Tamanho inicial do aviamento no desenho (TRIM_SIZE é para 1:10). */
export function trimDefaultSize(kind: TrimKind) {
  return (TRIM_SIZE[kind] * 10) / editor.get().doc.scale;
}

/* ------------------------------------------------------------------ */
/* Formas dentro de grupos                                             */
/* ------------------------------------------------------------------ */

/** Forma pelo id do nível de cima (`sid`) e, opcionalmente, de um filho (`cid`). */
export function resolveShape(doc: DrawDoc, sid: string, cid?: string | null): Shape | null {
  const top = findShape(doc, sid)?.shape;
  if (!top || !cid || cid === sid) return top ?? null;
  const find = (s: Shape): Shape | null => {
    if (s.id === cid) return s;
    if (s.kind === 'group') {
      for (const c of s.children) {
        const r = find(c);
        if (r) return s.mirror !== undefined && r.mirror === undefined ? { ...r, mirror: s.mirror } : r;
      }
    }
    return null;
  };
  return find(top);
}

/** Muda uma forma (de cima ou dentro de grupo). */
export function updateDeep(sid: string, cid: string | null | undefined, fn: (s: Shape) => Shape) {
  const target = cid ?? sid;
  const map = (s: Shape): Shape => {
    if (s.id === target) return fn(s);
    if (s.kind === 'group') return { ...s, children: s.children.map(map) };
    return s;
  };
  commit((d) => mapLayers(d, (l) => ({ ...l, shapes: l.shapes.map((s) => (s.id === sid ? map(s) : s)) })));
}
