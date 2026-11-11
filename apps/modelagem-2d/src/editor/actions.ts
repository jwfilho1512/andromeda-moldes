import {
  type Path,
  type Piece,
  arrangePieces,
  bboxOfPoints,
  closestOnPath,
  createPiece,
  insertPieceVertex,
  cutLine,
  mapPiece,
  unionBBox,
  moveVertex,
  removePieceVertex,
  translatePiece,
  vertices,
} from '@cad-textil/core';
import { type Tool, commit, commitPiece, editor, newId, nextPieceName, notify, select, selectMany, selectedIds, selectedPiece, selectedPieces } from './store';
import { pieceGeom, pointInPolygon } from './render';
import { canvasApi } from './Canvas';
import type { Base } from '@cad-textil/bases';

/** Até onde um ponto digitado conta como "em cima do contorno" (mm). */
const ON_CONTOUR_MM = 0.05;

export type PointKind = 'contorno' | 'vertice' | 'interno';

/**
 * Cria o ponto digitado por coordenadas:
 *  - em cima do contorno → vira um ponto (vértice) do contorno, como no Audaces;
 *  - em cima de um vértice que já existe → não cria nada, só serve de referência;
 *  - dentro do molde → ponto interno (furo/marcação).
 * Prefere o molde selecionado. Retorna null se o ponto ficou fora de todos os moldes.
 */
export function addPointAt(p: { x: number; y: number }): { piece: Piece; kind: PointKind } | null {
  const s = editor.get();
  const usable = s.doc.pieces.filter((q) => !s.hidden[q.id] && !s.locked[q.id]);
  const sel = usable.find((q) => q.id === s.selection.pieceId);
  const order = sel ? [sel, ...[...usable].reverse().filter((q) => q !== sel)] : [...usable].reverse();

  // 1) em cima do contorno
  for (const q of order) {
    const hit = closestOnPath(q.outline, p);
    if (hit.distance > ON_CONTOUR_MM) continue;
    const vs = vertices(q.outline);
    const n = vs.length;
    const a = vs[hit.edge]!, b = vs[(hit.edge + 1) % n]!;
    const near = (v: { x: number; y: number }) => Math.hypot(v.x - p.x, v.y - p.y) <= ON_CONTOUR_MM;
    if (near(a) || near(b)) {
      select({ pieceId: q.id, vertex: near(a) ? hit.edge : (hit.edge + 1) % n, edge: null });
      return { piece: q, kind: 'vertice' };
    }
    commitPiece(q.id, (x) => insertPieceVertex(x, hit.edge, hit.t), { pieceId: q.id, vertex: hit.edge + 1, edge: null });
    return { piece: q, kind: 'contorno' };
  }

  // 2) dentro do molde (inclui a área da margem de costura)
  const inside = (q: Piece) => pointInPolygon(p, pieceGeom(q).cut);
  const target = order.find(inside);
  if (!target) {
    notify('O ponto ficou fora dos moldes — confira X e Y', 'error');
    return null;
  }
  const at = { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 };
  commitPiece(target.id, (q) => ({ ...q, drills: [...(q.drills ?? []), at] }), { pieceId: target.id, vertex: null, edge: null });
  return { piece: target, kind: 'interno' };
}

export function setTool(tool: Tool): void {
  editor.set({ tool });
}

export function addPieceFromOutline(outline: Path, name?: string): Piece {
  const s = editor.get();
  const piece = createPiece(newId(), name ?? nextPieceName(s.doc), outline);
  commit({ ...s.doc, pieces: [...s.doc.pieces, piece] }, { pieceId: piece.id, vertex: null, edge: null });
  return piece;
}

export function deletePiece(id: string): void {
  const s = editor.get();
  commit({ ...s.doc, pieces: s.doc.pieces.filter((p) => p.id !== id) }, { pieceId: null, vertex: null, edge: null });
}

/** Delete/Backspace: remove o ponto selecionado, senão o(s) molde(s). */
export function deleteSelection(): void {
  const s = editor.get();
  const p = selectedPiece(s);
  if (!p) return;
  if (s.selection.vertex === null && s.multi.length > 1) {
    const ids = new Set(s.multi.filter((id) => !s.locked[id]));
    commit({ ...s.doc, pieces: s.doc.pieces.filter((q) => !ids.has(q.id)) }, { pieceId: null, vertex: null, edge: null }, []);
    notify(`${ids.size} moldes excluídos`);
    return;
  }
  if (s.selection.vertex !== null) {
    if (vertices(p.outline).length <= 3) {
      notify('Um molde precisa de pelo menos 3 pontos', 'error');
      return;
    }
    commitPiece(p.id, (q) => removePieceVertex(q, s.selection.vertex!), { pieceId: p.id, vertex: null, edge: null });
  } else {
    deletePiece(p.id);
  }
}

function center(p: Piece) {
  const bb = bboxOfPoints(pieceGeom(p).sew);
  return { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2, w: bb.maxX - bb.minX, h: bb.maxY - bb.minY };
}

export function duplicatePiece(id: string): void {
  const s = editor.get();
  const p = s.doc.pieces.find((q) => q.id === id);
  if (!p) return;
  const cut = bboxOfPoints(pieceGeom(p).cut);
  const copy = { ...translatePiece(p, cut.maxX - cut.minX + 20, 0), id: newId(), name: `${p.name} (cópia)` };
  commit({ ...s.doc, pieces: [...s.doc.pieces, copy] }, { pieceId: copy.id, vertex: null, edge: null });
}

/** Espelha no eixo vertical que passa pelo centro do molde. */
export function mirrorPiece(id: string): void {
  commitPiece(id, (p) => {
    const c = center(p);
    return mapPiece(p, (q) => ({ x: 2 * c.x - q.x, y: q.y }));
  });
}

/** Espelha no eixo horizontal (de cima para baixo) que passa pelo centro. */
export function mirrorPieceH(id: string): void {
  commitPiece(id, (p) => {
    const c = center(p);
    return mapPiece(p, (q) => ({ x: q.x, y: 2 * c.y - q.y }));
  });
}

/** Organiza todos os moldes em fileiras, sem sobreposição. */
export function arrangeAll(): void {
  const s = editor.get();
  if (!s.doc.pieces.length) return;
  commit({ ...s.doc, pieces: arrangePieces(s.doc.pieces, 2400, 40) });
  notify('Moldes organizados em fileiras');
  requestAnimationFrame(() => canvasApi.fit());
}

/** Gira 90° anti-horário em torno do centro. */
export function rotatePiece(id: string, deg = 90): void {
  const r = (deg * Math.PI) / 180;
  const cos = Math.round(Math.cos(r) * 1e12) / 1e12;
  const sin = Math.round(Math.sin(r) * 1e12) / 1e12;
  commitPiece(id, (p) => {
    const c = center(p);
    return mapPiece(p, (q) => ({ x: c.x + (q.x - c.x) * cos - (q.y - c.y) * sin, y: c.y + (q.x - c.x) * sin + (q.y - c.y) * cos }));
  });
}

export function toggleGrainline(id: string): void {
  commitPiece(id, (p) => {
    if (p.grainline) return { ...p, grainline: undefined };
    const c = center(p);
    return { ...p, grainline: [{ x: c.x, y: c.y - c.h * 0.3 }, { x: c.x, y: c.y + c.h * 0.3 }] };
  });
}

/** Setas: move o ponto selecionado ou o molde inteiro. */
export function nudge(dx: number, dy: number): void {
  const s = editor.get();
  const p = selectedPiece(s);
  if (!p) return;
  if (s.selection.vertex === null && s.multi.length > 1) {
    mapSelected((q) => translatePiece(q, dx, dy));
    return;
  }
  if (s.selection.vertex !== null) {
    const v = vertices(p.outline)[s.selection.vertex]!;
    commitPiece(p.id, (q) => ({ ...q, outline: moveVertex(q.outline, s.selection.vertex!, { x: v.x + dx, y: v.y + dy }) }));
  } else {
    commitPiece(p.id, (q) => translatePiece(q, dx, dy));
  }
}

export function selectPiece(id: string): void {
  select({ pieceId: id });
}

/** Insere todos os moldes de uma base, lado a lado, à direita do que já existe. */
export function insertBase(base: Pick<Base, 'nome' | 'pecas'> & { tamanho?: string }): void {
  const s = editor.get();
  const existing = s.doc.pieces.map((p) => bboxOfPoints(pieceGeom(p).cut));
  const all = existing.length ? existing.reduce(unionBBox) : null;
  let x = all ? all.maxX + 100 : 0;
  const top = all ? all.maxY : 0;
  const placed = base.pecas.map((p) => {
    const bb = bboxOfPoints(cutLine(p));
    const q = { ...translatePiece(p, x - bb.minX, top - bb.maxY), id: newId() };
    x += bb.maxX - bb.minX + 30;
    return q;
  });
  // todos os moldes inseridos ficam selecionados (para mover juntos ou salvar como base)
  commit({ ...s.doc, pieces: [...s.doc.pieces, ...placed] }, { pieceId: placed[0]?.id ?? null, vertex: null, edge: null }, placed.map((p) => p.id));
  notify(`${base.nome}${base.tamanho ? ` (${base.tamanho})` : ''} inserida: ${placed.length} moldes`);
  requestAnimationFrame(() => canvasApi.fit());
}

/* ------------------------------------------------------------------ */
/* Seleção múltipla: operações em grupo                                */
/* ------------------------------------------------------------------ */

/** Caixa (linha de corte) de um conjunto de moldes. */
export function groupBBox(pieces: Piece[]) {
  return pieces.map((p) => bboxOfPoints(pieceGeom(p).cut)).reduce(unionBBox);
}

/** Moldes da seleção que podem ser alterados (não bloqueados). */
function editable(): Piece[] {
  const s = editor.get();
  return selectedPieces(s).filter((p) => !s.locked[p.id]);
}

/** Aplica uma transformação a cada molde da seleção (um único passo de desfazer). */
function mapSelected(f: (p: Piece, all: Piece[]) => Piece): void {
  const s = editor.get();
  const list = editable();
  if (!list.length) return;
  const ids = new Set(list.map((p) => p.id));
  commit({ ...s.doc, pieces: s.doc.pieces.map((p) => (ids.has(p.id) ? f(p, list) : p)) });
}

/** Duplica a seleção (um ou vários moldes) ao lado do grupo e seleciona as cópias. */
export function duplicateSelection(): void {
  const s = editor.get();
  const list = selectedPieces(s);
  if (!list.length) return;
  const bb = groupBBox(list);
  const dx = bb.maxX - bb.minX + 20;
  const copies = list.map((p) => ({ ...translatePiece(p, dx, 0), id: newId(), name: list.length > 1 ? p.name : `${p.name} (cópia)` }));
  commit({ ...s.doc, pieces: [...s.doc.pieces, ...copies] }, { pieceId: copies[copies.length - 1]!.id, vertex: null, edge: null }, copies.map((c) => c.id));
  if (copies.length > 1) notify(`${copies.length} moldes duplicados`);
}

/** Espelha a seleção (eixo pelo centro do grupo). */
export function mirrorSelection(axis: 'h' | 'v'): void {
  const list = editable();
  if (!list.length) return;
  const bb = groupBBox(list);
  const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
  mapSelected((p) => mapPiece(p, (q) => (axis === 'h' ? { x: 2 * cx - q.x, y: q.y } : { x: q.x, y: 2 * cy - q.y })));
}

/** Gira a seleção em torno do centro do grupo (graus, anti-horário). */
export function rotateSelection(deg: number): void {
  const list = editable();
  if (!list.length) return;
  const bb = groupBBox(list);
  const c = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
  const r = (deg * Math.PI) / 180;
  const cos = Math.round(Math.cos(r) * 1e12) / 1e12, sin = Math.round(Math.sin(r) * 1e12) / 1e12;
  mapSelected((p) => mapPiece(p, (q) => ({ x: c.x + (q.x - c.x) * cos - (q.y - c.y) * sin, y: c.y + (q.x - c.x) * sin + (q.y - c.y) * cos })));
}

export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

/** Alinha os moldes selecionados pela caixa do grupo. */
export function alignSelection(mode: AlignMode): void {
  const list = editable();
  if (list.length < 2) return notify('Selecione 2 ou mais moldes para alinhar', 'error');
  const g = groupBBox(list);
  mapSelected((p) => {
    const b = bboxOfPoints(pieceGeom(p).cut);
    const dx = mode === 'left' ? g.minX - b.minX : mode === 'right' ? g.maxX - b.maxX : mode === 'centerX' ? (g.minX + g.maxX) / 2 - (b.minX + b.maxX) / 2 : 0;
    const dy = mode === 'bottom' ? g.minY - b.minY : mode === 'top' ? g.maxY - b.maxY : mode === 'centerY' ? (g.minY + g.maxY) / 2 - (b.minY + b.maxY) / 2 : 0;
    return dx || dy ? translatePiece(p, dx, dy) : p;
  });
}

/**
 * Distribui com espaço igual entre os moldes (na horizontal ou vertical).
 * `gapMm` informado = espaço fixo a partir do primeiro; senão mantém as pontas e iguala os vãos.
 */
export function distributeSelection(axis: 'x' | 'y', gapMm?: number): void {
  const list = editable();
  if (list.length < (gapMm === undefined ? 3 : 2)) return notify(gapMm === undefined ? 'Selecione 3 ou mais moldes para distribuir' : 'Selecione 2 ou mais moldes', 'error');
  const boxes = list.map((p) => ({ p, b: bboxOfPoints(pieceGeom(p).cut) }));
  const lo = (b: ReturnType<typeof bboxOfPoints>) => (axis === 'x' ? b.minX : b.minY);
  const hi = (b: ReturnType<typeof bboxOfPoints>) => (axis === 'x' ? b.maxX : b.maxY);
  boxes.sort((a, b) => lo(a.b) - lo(b.b));
  const total = boxes.reduce((acc, x) => acc + hi(x.b) - lo(x.b), 0);
  const span = hi(boxes.reduce((m, x) => (hi(x.b) > hi(m.b) ? x : m)).b) - lo(boxes[0]!.b);
  const gap = gapMm ?? (span - total) / (boxes.length - 1);
  let pos = lo(boxes[0]!.b);
  const shift = new Map<string, number>();
  for (const x of boxes) {
    shift.set(x.p.id, pos - lo(x.b));
    pos += hi(x.b) - lo(x.b) + gap;
  }
  mapSelected((p) => {
    const d = shift.get(p.id) ?? 0;
    return d ? translatePiece(p, axis === 'x' ? d : 0, axis === 'y' ? d : 0) : p;
  });
}

/** Seleciona todos os moldes visíveis e desbloqueados. */
export function selectAll(): void {
  const s = editor.get();
  const ids = s.doc.pieces.filter((p) => !s.hidden[p.id] && !s.locked[p.id]).map((p) => p.id);
  selectMany(ids);
  if (ids.length > 1) notify(`${ids.length} moldes selecionados`);
}

/** Inverte a seleção (entre os visíveis e desbloqueados). */
export function invertSelection(): void {
  const s = editor.get();
  const cur = new Set(selectedIds(s));
  selectMany(s.doc.pieces.filter((p) => !s.hidden[p.id] && !s.locked[p.id] && !cur.has(p.id)).map((p) => p.id));
}
