/**
 * Operações de edição de caminhos e moldes — imutáveis (sempre retornam cópia).
 *
 * Convenção de caminho fechado: o último segmento termina EXATAMENTE no ponto inicial
 * (fechamento explícito), então toda aresta — inclusive a de fechamento — pode ser curva.
 *   vértices: v0 = start, v1 = seg[0].to, ...   arestas: aresta i liga vi → v(i+1)
 */
import { type Path, type Segment, type Vec2, add, dist, lerp, normalize, scale, signedArea, sub, flattenPath } from './geometry.js';
import type { Dart, Notch, Piece } from './pattern.js';
import { gradingInsert, gradingMap, gradingRemove } from './grading.js';
import { mapPrint } from './estampa-frame.js';

export type EdgeData = { kind: 'line' } | { kind: 'cubic'; c1: Vec2; c2: Vec2 };

/** Caminho como listas paralelas: vértices e arestas (aresta i liga vértice i → i+1). */
export interface Decomposed {
  verts: Vec2[];
  edges: EdgeData[];
  closed: boolean;
}

/** Garante fechamento explícito em caminhos fechados. */
export function normalizeClosed(path: Path): Path {
  if (!path.closed) return path;
  const last = path.segments[path.segments.length - 1];
  if (last && dist(last.to, path.start) < 1e-9) return path;
  return { ...path, segments: [...path.segments, { kind: 'line', to: { ...path.start } }] };
}

export function decompose(path: Path): Decomposed {
  const p = normalizeClosed(path);
  const verts = [p.start, ...p.segments.map((s) => s.to)];
  if (p.closed) verts.pop();
  const edges: EdgeData[] = p.segments.map((s) => (s.kind === 'line' ? { kind: 'line' } : { kind: 'cubic', c1: s.c1, c2: s.c2 }));
  return { verts, edges, closed: p.closed };
}

export function compose({ verts, edges, closed }: Decomposed): Path {
  const segments: Segment[] = edges.map((e, i) => {
    const to = { ...verts[(i + 1) % verts.length]! };
    return e.kind === 'line' ? { kind: 'line', to } : { kind: 'cubic', c1: e.c1, c2: e.c2, to };
  });
  return { start: { ...verts[0]! }, segments, closed };
}

export function vertices(path: Path): Vec2[] {
  return decompose(path).verts;
}

export function edgeCount(path: Path): number {
  return normalizeClosed(path).segments.length;
}

/** Pontos de controle da aresta i: [p0, c1, c2, p3] (reta: c1/c2 nos terços). */
export function edgeControls(path: Path, i: number): { kind: 'line' | 'cubic'; p0: Vec2; c1: Vec2; c2: Vec2; p3: Vec2 } {
  const { verts, edges } = decompose(path);
  const e = edges[i];
  if (!e) throw new Error(`Aresta ${i} não existe`);
  const p0 = verts[i]!;
  const p3 = verts[(i + 1) % verts.length]!;
  return e.kind === 'line'
    ? { kind: 'line', p0, c1: lerp(p0, p3, 1 / 3), c2: lerp(p0, p3, 2 / 3), p3 }
    : { kind: 'cubic', p0, c1: e.c1, c2: e.c2, p3 };
}

export function evalCubic(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * c1.x + c * c2.x + d * p3.x, y: a * p0.y + b * c1.y + c * c2.y + d * p3.y };
}

export function cubicDerivative(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = 3 * u * u, b = 6 * u * t, c = 3 * t * t;
  return {
    x: a * (c1.x - p0.x) + b * (c2.x - c1.x) + c * (p3.x - c2.x),
    y: a * (c1.y - p0.y) + b * (c2.y - c1.y) + c * (p3.y - c2.y),
  };
}

export function pointOnEdge(path: Path, i: number, t: number): Vec2 {
  const c = edgeControls(path, i);
  return c.kind === 'line' ? lerp(c.p0, c.p3, t) : evalCubic(c.p0, c.c1, c.c2, c.p3, t);
}

export function tangentOnEdge(path: Path, i: number, t: number): Vec2 {
  const c = edgeControls(path, i);
  return normalize(c.kind === 'line' ? sub(c.p3, c.p0) : cubicDerivative(c.p0, c.c1, c.c2, c.p3, t));
}

/** Comprimento da aresta i em mm. */
export function edgeLength(path: Path, i: number): number {
  const c = edgeControls(path, i);
  if (c.kind === 'line') return dist(c.p0, c.p3);
  const pts = flattenPath({ start: c.p0, segments: [{ kind: 'cubic', c1: c.c1, c2: c.c2, to: c.p3 }], closed: false }, 0.0005);
  let l = 0;
  for (let k = 1; k < pts.length; k++) l += dist(pts[k - 1]!, pts[k]!);
  return l;
}

/** Divide Bézier cúbica em t (De Casteljau) — exato, a forma não muda. */
export function splitCubic(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, t: number): [[Vec2, Vec2, Vec2, Vec2], [Vec2, Vec2, Vec2, Vec2]] {
  const a = lerp(p0, c1, t), b = lerp(c1, c2, t), c = lerp(c2, p3, t);
  const d = lerp(a, b, t), e = lerp(b, c, t);
  const m = lerp(d, e, t);
  return [[p0, a, d, m], [m, e, c, p3]];
}

/* ------------------------------------------------------------------ */
/* Edição de caminho                                                   */
/* ------------------------------------------------------------------ */

/** Move o vértice i; as alças de curva ligadas a ele acompanham. */
export function moveVertex(path: Path, i: number, p: Vec2): Path {
  const d = decompose(path);
  const n = d.verts.length;
  const delta = sub(p, d.verts[i]!);
  d.verts[i] = p;
  const incoming = d.closed ? (i - 1 + n) % n : i - 1;
  const outgoing = i < d.edges.length ? i : -1;
  const inc = d.edges[incoming];
  if (incoming >= 0 && inc?.kind === 'cubic') d.edges[incoming] = { ...inc, c2: add(inc.c2, delta) };
  const out = d.edges[outgoing];
  if (outgoing >= 0 && out?.kind === 'cubic') d.edges[outgoing] = { ...out, c1: add(out.c1, delta) };
  return compose(d);
}

/** Move uma alça de curva da aresta i. */
export function moveHandle(path: Path, i: number, which: 'c1' | 'c2', p: Vec2): Path {
  const d = decompose(path);
  const e = d.edges[i];
  if (e?.kind !== 'cubic') return path;
  d.edges[i] = { ...e, [which]: p };
  return compose(d);
}

/** Insere vértice na aresta i em t ∈ (0,1). A forma não muda. Novo vértice = i+1. */
export function insertVertex(path: Path, i: number, t: number): Path {
  const d = decompose(path);
  const c = edgeControls(path, i);
  if (c.kind === 'line') {
    d.verts.splice(i + 1, 0, lerp(c.p0, c.p3, t));
    d.edges.splice(i, 1, { kind: 'line' }, { kind: 'line' });
  } else {
    const [l, r] = splitCubic(c.p0, c.c1, c.c2, c.p3, t);
    d.verts.splice(i + 1, 0, l[3]);
    d.edges.splice(i, 1, { kind: 'cubic', c1: l[1], c2: l[2] }, { kind: 'cubic', c1: r[1], c2: r[2] });
  }
  return compose(d);
}

/** Remove o vértice i (mín. 3 vértices em fechado, 2 em aberto). */
export function removeVertex(path: Path, i: number): Path {
  const d = decompose(path);
  const n = d.verts.length;
  if (n <= (d.closed ? 3 : 2)) return path;
  if (!d.closed && (i === 0 || i === n - 1)) {
    d.verts.splice(i, 1);
    d.edges.splice(i === 0 ? 0 : d.edges.length - 1, 1);
    return compose(d);
  }
  const prevIdx = d.closed ? (i - 1 + n) % n : i - 1;
  const prev = d.edges[prevIdx]!;
  const next = d.edges[i]!;
  const merged: EdgeData =
    prev.kind === 'line' && next.kind === 'line'
      ? { kind: 'line' }
      : {
          kind: 'cubic',
          c1: prev.kind === 'cubic' ? prev.c1 : d.verts[prevIdx]!,
          c2: next.kind === 'cubic' ? next.c2 : d.verts[(i + 1) % n]!,
        };
  d.edges[prevIdx] = merged;
  d.edges.splice(i, 1);
  d.verts.splice(i, 1);
  return compose(d);
}

/** Alterna aresta i entre reta e curva (a curva nasce reta, com alças nos terços). */
export function toggleCurve(path: Path, i: number): Path {
  const d = decompose(path);
  const c = edgeControls(path, i);
  d.edges[i] = c.kind === 'line' ? { kind: 'cubic', c1: c.c1, c2: c.c2 } : { kind: 'line' };
  return compose(d);
}

/** Define o comprimento exato de uma aresta reta, movendo o vértice final na mesma direção. */
export function setEdgeLength(path: Path, i: number, lengthMm: number): Path {
  const c = edgeControls(path, i);
  if (c.kind !== 'line') throw new Error('Comprimento exato só em aresta reta');
  const dir = normalize(sub(c.p3, c.p0));
  const n = vertices(path).length;
  return moveVertex(path, (i + 1) % n, add(c.p0, scale(dir, lengthMm)));
}

export function translatePath(path: Path, dx: number, dy: number): Path {
  return mapPath(path, (p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function mapPath(path: Path, f: (p: Vec2) => Vec2): Path {
  return {
    start: f(path.start),
    closed: path.closed,
    segments: path.segments.map((s) => (s.kind === 'line' ? { kind: 'line', to: f(s.to) } : { kind: 'cubic', c1: f(s.c1), c2: f(s.c2), to: f(s.to) })),
  };
}

export interface ClosestHit {
  edge: number;
  t: number;
  point: Vec2;
  distance: number;
}

/** Ponto do caminho mais próximo de p. */
export function closestOnPath(path: Path, p: Vec2): ClosestHit {
  let best: ClosestHit = { edge: -1, t: 0, point: path.start, distance: Infinity };
  const count = edgeCount(path);
  for (let i = 0; i < count; i++) {
    const c = edgeControls(path, i);
    if (c.kind === 'line') {
      const ab = sub(c.p3, c.p0);
      const l2 = ab.x * ab.x + ab.y * ab.y;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - c.p0.x) * ab.x + (p.y - c.p0.y) * ab.y) / l2));
      const q = lerp(c.p0, c.p3, t);
      const dd = dist(p, q);
      if (dd < best.distance) best = { edge: i, t, point: q, distance: dd };
    } else {
      const N = 64;
      let bt = 0, bd = Infinity;
      for (let k = 0; k <= N; k++) {
        const dd = dist(p, evalCubic(c.p0, c.c1, c.c2, c.p3, k / N));
        if (dd < bd) { bd = dd; bt = k / N; }
      }
      // Refinamento por busca local
      let step = 1 / N;
      while (step > 1e-7) {
        for (const t of [bt - step, bt + step]) {
          if (t < 0 || t > 1) continue;
          const dd = dist(p, evalCubic(c.p0, c.c1, c.c2, c.p3, t));
          if (dd < bd) { bd = dd; bt = t; }
        }
        step /= 2;
      }
      if (bd < best.distance) best = { edge: i, t: bt, point: evalCubic(c.p0, c.c1, c.c2, c.p3, bt), distance: bd };
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Molde                                                               */
/* ------------------------------------------------------------------ */

export function createPiece(id: string, name: string, outline: Path): Piece {
  // Sem margem automática: a margem é aplicada borda a borda pelo modelista.
  return { id, name, outline: normalizeClosed(outline), seamAllowanceMm: 0, internals: [], notches: [], quantity: 1, cutInPairs: false };
}

/** Aplica uma transformação de pontos ao molde inteiro (contorno, internas, fio). */
export function mapPiece(piece: Piece, f: (p: Vec2) => Vec2): Piece {
  return {
    ...piece,
    outline: mapPath(piece.outline, f),
    internals: piece.internals.map((p) => mapPath(p, f)),
    grainline: piece.grainline ? [f(piece.grainline[0]), f(piece.grainline[1])] : undefined,
    darts: piece.darts?.map((d) => ({ ...d, apex: f(d.apex) })),
    drills: piece.drills?.map(f),
    grading: gradingMap(piece.grading, f),
    prints: piece.prints?.map((pr) => mapPrint(pr, f)),
  };
}

export function translatePiece(piece: Piece, dx: number, dy: number): Piece {
  return mapPiece(piece, (p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Posição e direção para dentro de um pique. */
export function notchGeometry(piece: Piece, notch: Notch): { at: Vec2; inward: Vec2 } {
  const at = pointOnEdge(piece.outline, notch.edge, notch.t);
  const tan = tangentOnEdge(piece.outline, notch.edge, notch.t);
  // Anti-horário → interior à esquerda da tangente.
  const ccw = signedArea(flattenPath(piece.outline)) > 0;
  const inward = ccw ? { x: -tan.y, y: tan.x } : { x: tan.y, y: -tan.x };
  return { at, inward };
}

/** Insere vértice no contorno do molde, preservando a posição dos piques. */
export function insertPieceVertex(piece: Piece, edge: number, t: number): Piece {
  const notches = piece.notches.map((n): Notch => {
    if (n.edge < edge) return n;
    if (n.edge > edge) return { ...n, edge: n.edge + 1 };
    return n.t < t ? { ...n, t: n.t / t } : { ...n, edge: edge + 1, t: (n.t - t) / (1 - t) };
  });
  const darts = piece.darts?.map((d): Dart => (d.edge > edge ? { ...d, edge: d.edge + 1 } : d));
  return {
    ...piece,
    outline: insertVertex(piece.outline, edge, t),
    notches,
    darts,
    grading: gradingInsert(piece.grading, edge, t, vertices(piece.outline).length),
    seamByEdge: remapSeams(piece, (e) => (e < edge ? [e] : e === edge ? [e, e + 1] : [e + 1])),
    hemByEdge: remapHems(piece, (e) => (e < edge ? [e] : e === edge ? [e, e + 1] : [e + 1])),
  };
}

/** Reindexa margens por borda: f(arestaAntiga) → novas arestas que herdam a margem. */
function remapSeams(piece: Piece, f: (e: number) => number[]): Record<string, number> | undefined {
  if (!piece.seamByEdge) return undefined;
  const out: Record<string, number> = {};
  for (const [k, mm] of Object.entries(piece.seamByEdge)) for (const e of f(Number(k))) if (e >= 0 && out[e] === undefined) out[e] = mm;
  return out;
}

/** Reindexa as barras espelhadas do mesmo jeito que as margens. */
function remapHems(piece: Piece, f: (e: number) => number[]): Record<string, true> | undefined {
  if (!piece.hemByEdge) return undefined;
  const out: Record<string, true> = {};
  for (const k of Object.keys(piece.hemByEdge)) for (const e of f(Number(k))) if (e >= 0) out[e] = true;
  return Object.keys(out).length ? out : undefined;
}

/** Remove vértice do contorno; piques das arestas unidas são reposicionados aproximadamente. */
export function removePieceVertex(piece: Piece, i: number): Piece {
  const n = vertices(piece.outline).length;
  if (n <= 3) return piece;
  const prev = (i - 1 + n) % n;
  const notches = piece.notches.map((nt): Notch => {
    const newIndex = (e: number) => (i === 0 ? e - 1 : e > i ? e - 1 : e);
    if (nt.edge === prev) return { ...nt, edge: newIndex(prev), t: nt.t * 0.5 };
    if (nt.edge === i) return { ...nt, edge: newIndex(prev), t: 0.5 + nt.t * 0.5 };
    return { ...nt, edge: newIndex(nt.edge) };
  });
  const newIndex = (e: number) => (i === 0 ? e - 1 : e > i ? e - 1 : e);
  // A borda unida herda a margem da borda anterior.
  const seamByEdge = remapSeams(piece, (e) => (e === i ? [] : [newIndex(e)]));
  const hemByEdge = remapHems(piece, (e) => (e === i ? [] : [newIndex(e)]));
  // Pence cuja boca usa o vértice removido deixa de existir.
  const darts = piece.darts?.filter((d) => d.edge !== i && d.edge !== prev).map((d) => ({ ...d, edge: newIndex(d.edge) }));
  return { ...piece, outline: removeVertex(piece.outline, i), notches, seamByEdge, hemByEdge, darts, grading: gradingRemove(piece.grading, i) };
}
