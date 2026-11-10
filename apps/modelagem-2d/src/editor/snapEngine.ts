/**
 * GUIAS INTELIGENTES (ímã): atrai o cursor para pontos notáveis do desenho.
 * Prioridade: ponto > interseção > meio > perpendicular > guia > borda > alinhamento > grade.
 *
 * As bordas ficam num índice espacial (grade de 40 mm) reconstruído só quando o documento muda.
 */
import { type PatternDocument, type Piece, type Vec2, dist, edgeCount, edgeMidpoint, flattenPath, flattenWithEdges, perpendicularFoot, segmentIntersection, vertices } from '@cad-textil/core';
import type { SnapOpts } from './store';

interface Seg {
  a: Vec2;
  b: Vec2;
  pieceId: string;
  /** Aresta do contorno (−1 = linha interna). */
  edge: number;
  idx: number;
}

const CELL = 40;
const key = (cx: number, cy: number) => `${cx},${cy}`;

class SnapIndex {
  segs: Seg[] = [];
  verts: { p: Vec2; pieceId: string; i: number }[] = [];
  mids: { p: Vec2; pieceId: string; edge: number }[] = [];
  buckets = new Map<string, number[]>();

  constructor(pieces: Piece[]) {
    for (const piece of pieces) {
      const { points, edgeOf } = flattenWithEdges(piece.outline, 0.3);
      for (let i = 0; i < points.length; i++) this.addSeg(points[i]!, points[(i + 1) % points.length]!, piece.id, edgeOf[i]!);
      for (const path of piece.internals) {
        const pts = flattenPath(path, 0.3);
        for (let i = 0; i + 1 < pts.length; i++) this.addSeg(pts[i]!, pts[i + 1]!, piece.id, -1);
      }
      vertices(piece.outline).forEach((p, i) => this.verts.push({ p, pieceId: piece.id, i }));
      for (const path of piece.internals) for (const p of [path.start, ...path.segments.map((s) => s.to)]) this.verts.push({ p, pieceId: piece.id, i: -1 });
      for (const p of piece.drills ?? []) this.verts.push({ p, pieceId: piece.id, i: -1 });
      for (let e = 0; e < edgeCount(piece.outline); e++) this.mids.push({ p: edgeMidpoint(piece.outline, e), pieceId: piece.id, edge: e });
    }
  }

  private addSeg(a: Vec2, b: Vec2, pieceId: string, edge: number) {
    const idx = this.segs.length;
    this.segs.push({ a, b, pieceId, edge, idx });
    const x0 = Math.floor(Math.min(a.x, b.x) / CELL), x1 = Math.floor(Math.max(a.x, b.x) / CELL);
    const y0 = Math.floor(Math.min(a.y, b.y) / CELL), y1 = Math.floor(Math.max(a.y, b.y) / CELL);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy);
        let list = this.buckets.get(k);
        if (!list) this.buckets.set(k, (list = []));
        list.push(idx);
      }
  }

  near(w: Vec2, r: number): Seg[] {
    const out = new Set<number>();
    const x0 = Math.floor((w.x - r) / CELL), x1 = Math.floor((w.x + r) / CELL);
    const y0 = Math.floor((w.y - r) / CELL), y1 = Math.floor((w.y + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) for (const i of this.buckets.get(key(cx, cy)) ?? []) out.add(i);
    return [...out].map((i) => this.segs[i]!).filter((s) => segDist(w, s.a, s.b) <= r);
  }
}

function segDist(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}
function nearestOnSeg(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

let cache: { pieces: Piece[]; hidden: Record<string, boolean>; index: SnapIndex } | null = null;
function indexFor(doc: PatternDocument, hidden: Record<string, boolean>): SnapIndex {
  if (cache && cache.pieces === doc.pieces && cache.hidden === hidden) return cache.index;
  const index = new SnapIndex(doc.pieces.filter((p) => !hidden[p.id]));
  cache = { pieces: doc.pieces, hidden, index };
  return index;
}

export interface SnapResult {
  p: Vec2;
  mark: Vec2 | null;
  /** Rótulo do que atraiu (para mostrar ao lado do cursor). */
  kind: string | null;
  /** Linhas de alinhamento a desenhar (tracejadas). */
  lines: [Vec2, Vec2][];
}

export interface SnapContext {
  doc: PatternDocument;
  hidden: Record<string, boolean>;
  opts: SnapOpts;
  gridMm: number;
  /** Raio de atração em mm (pixels ÷ zoom). */
  tol: number;
  /** Último ponto desenhado (perpendicular e alinhamento a partir dele). */
  anchor?: Vec2 | null;
  /** Ponto sendo arrastado (não atrai para si nem para as bordas vizinhas). */
  exclude?: { pieceId: string; vertex: number };
}

/** Ímã inteligente. */
export function smartSnap(w: Vec2, c: SnapContext): SnapResult {
  const idx = indexFor(c.doc, c.hidden);
  const o = c.opts;
  const ex = c.exclude;
  const nOf = (pid: string) => vertices(c.doc.pieces.find((p) => p.id === pid)!.outline).length;
  const segOk = (s: Seg) => {
    if (!ex || s.pieceId !== ex.pieceId || s.edge < 0) return true;
    const n = nOf(s.pieceId);
    return s.edge !== ex.vertex && s.edge !== (ex.vertex - 1 + n) % n;
  };
  const best = (cands: Vec2[]) => {
    let b: Vec2 | null = null, bd = c.tol;
    for (const p of cands) {
      const d = dist(p, w);
      if (d <= bd) {
        bd = d;
        b = p;
      }
    }
    return b;
  };
  const done = (p: Vec2, kind: string, lines: [Vec2, Vec2][] = []): SnapResult => ({ p: { ...p }, mark: p, kind, lines });

  // 1. pontos (vértices + pontos das linhas internas)
  if (o.ponto) {
    const p = best(idx.verts.filter((v) => !(ex && v.pieceId === ex.pieceId && v.i === ex.vertex)).map((v) => v.p));
    if (p) return done(p, 'ponto');
  }
  const near = idx.near(w, c.tol * 1.5).filter(segOk);
  // guias da régua como segmentos longos (para interseção)
  const guideSegs: Seg[] = [];
  if (o.guias && c.doc.guides) {
    for (const x of c.doc.guides.x) if (Math.abs(x - w.x) <= c.tol * 1.5) guideSegs.push({ a: { x, y: w.y - 1e5 }, b: { x, y: w.y + 1e5 }, pieceId: 'guia', edge: -2, idx: -1 });
    for (const y of c.doc.guides.y) if (Math.abs(y - w.y) <= c.tol * 1.5) guideSegs.push({ a: { x: w.x - 1e5, y }, b: { x: w.x + 1e5, y }, pieceId: 'guia', edge: -2, idx: -1 });
  }
  // 2. interseções (entre bordas próximas e com as guias)
  if (o.intersecao) {
    const all = [...near, ...guideSegs];
    const pts: Vec2[] = [];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const A = all[i]!, B = all[j]!;
        if (A.pieceId === B.pieceId && A.edge >= 0 && B.edge >= 0 && Math.abs(A.idx - B.idx) <= 1) continue;
        if (dist(A.b, B.a) < 1e-9 || dist(A.a, B.b) < 1e-9) continue;
        const x = segmentIntersection(A.a, A.b, B.a, B.b);
        if (x) pts.push(x);
      }
    const p = best(pts);
    if (p) return done(p, A_GUIDE(all, p) ? 'interseção com guia' : 'interseção');
  }
  // 3. meio da borda
  if (o.meio) {
    const p = best(idx.mids.filter((m) => !(ex && m.pieceId === ex.pieceId && (m.edge === ex.vertex || m.edge === (ex.vertex - 1 + nOf(m.pieceId)) % nOf(m.pieceId)))).map((m) => m.p));
    if (p) return done(p, 'meio');
  }
  // 4. perpendicular a partir do último ponto
  if (o.perpendicular && c.anchor) {
    const feet = near.map((s) => perpendicularFoot(c.anchor!, s.a, s.b)).filter((x): x is Vec2 => !!x);
    const p = best(feet);
    if (p) return done(p, 'perpendicular', [[c.anchor, p]]);
  }
  // 5/6. guia ou borda
  let gx: number | null = null, gy: number | null = null;
  if (o.guias && c.doc.guides) {
    for (const x of c.doc.guides.x) if (Math.abs(x - w.x) <= c.tol && (gx === null || Math.abs(x - w.x) < Math.abs(gx - w.x))) gx = x;
    for (const y of c.doc.guides.y) if (Math.abs(y - w.y) <= c.tol && (gy === null || Math.abs(y - w.y) < Math.abs(gy - w.y))) gy = y;
  }
  if (o.borda && gx === null && gy === null) {
    const p = best(near.map((s) => nearestOnSeg(w, s.a, s.b)));
    if (p) return done(p, 'sobre a borda');
  }
  // 7. alinhamento horizontal/vertical com outros pontos
  let ax: Vec2 | null = null, ay: Vec2 | null = null;
  if (o.alinhamento) {
    const refs = [...idx.verts.filter((v) => !(ex && v.pieceId === ex.pieceId && v.i === ex.vertex)).map((v) => v.p), ...(c.anchor ? [c.anchor] : [])];
    for (const r of refs) {
      if (Math.abs(r.x - w.x) <= c.tol * 0.6 && (!ax || Math.abs(r.x - w.x) < Math.abs(ax.x - w.x))) ax = r;
      if (Math.abs(r.y - w.y) <= c.tol * 0.6 && (!ay || Math.abs(r.y - w.y) < Math.abs(ay.y - w.y))) ay = r;
    }
  }
  const grid = (v: number) => (c.gridMm > 0 ? Math.round(v / c.gridMm) * c.gridMm : v);
  const x = gx ?? ax?.x ?? grid(w.x);
  const y = gy ?? ay?.y ?? grid(w.y);
  const p = { x, y };
  const lines: [Vec2, Vec2][] = [];
  if (ax && gx === null) lines.push([ax, p]);
  if (ay && gy === null) lines.push([ay, p]);
  const kind = gx !== null || gy !== null ? 'guia' : ax || ay ? (ax && ay ? 'alinhado (2 eixos)' : ax ? 'alinhado na vertical' : 'alinhado na horizontal') : null;
  return { p, mark: kind ? p : null, kind, lines };
}

function A_GUIDE(all: Seg[], p: Vec2) {
  return all.some((s) => s.pieceId === 'guia' && segDist(p, s.a, s.b) < 1e-6);
}
