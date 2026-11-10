/**
 * ANDAR MOLDE ("walk pieces"): rola um molde encostado na costura de outro para conferir se
 * as costuras se encontram — comprimento até os cantos, piques e continuidade das curvas na junção.
 *
 * Um "percurso" é o contorno do molde lido a partir de um vértice inicial, num sentido,
 * como polilinha densa com comprimento acumulado (mm).
 */
import { type Vec2, add, cross, dist, dot, flattenPath, normalize, scale, signedArea, sub } from './geometry.js';
import { decompose, notchGeometry } from './edit.js';
import { isSmoothVertex } from './modelagem.js';
import type { Piece } from './pattern.js';

export interface WalkPath {
  pieceId: string;
  start: number;
  dir: 1 | -1;
  points: Vec2[];
  /** Comprimento acumulado em cada ponto (mm). */
  cum: number[];
  total: number;
  /** Posições (mm ao longo do percurso) dos cantos vivos. */
  corners: number[];
  /** Posições dos vértices (todos). */
  vertexArc: number[];
  /** Posições dos piques. */
  notches: number[];
  /** +1 = interior do molde à esquerda do sentido do percurso; −1 = à direita. */
  interior: 1 | -1;
}

/** Percurso do contorno a partir do vértice `start`, no sentido `dir` (+1 = ordem dos vértices). */
export function walkPath(piece: Piece, start: number, dir: 1 | -1): WalkPath {
  const d = decompose(piece.outline);
  const n = d.verts.length;
  const points: Vec2[] = [d.verts[start]!];
  const cum = [0];
  const vertexArc: number[] = [0];
  const corners: number[] = [];
  if (!isSmoothVertex(piece.outline, start)) corners.push(0);
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const v = (start + dir * k + n * 2) % n;
    const next = (v + dir + n) % n;
    const edge = dir === 1 ? v : next; // aresta entre v e next
    const e = d.edges[edge]!;
    const seg = flattenPath(
      e.kind === 'line'
        ? { start: d.verts[v]!, segments: [{ kind: 'line', to: d.verts[next]! }], closed: false }
        : dir === 1
          ? { start: d.verts[v]!, segments: [{ kind: 'cubic', c1: e.c1, c2: e.c2, to: d.verts[next]! }], closed: false }
          : { start: d.verts[v]!, segments: [{ kind: 'cubic', c1: e.c2, c2: e.c1, to: d.verts[next]! }], closed: false },
      0.005,
    );
    for (let i = 1; i < seg.length; i++) {
      acc += dist(points[points.length - 1]!, seg[i]!);
      points.push(seg[i]!);
      cum.push(acc);
    }
    if (k < n - 1) {
      vertexArc.push(acc);
      if (!isSmoothVertex(piece.outline, next)) corners.push(acc);
    }
  }
  const area = signedArea(flattenPath(piece.outline));
  const path: WalkPath = {
    pieceId: piece.id,
    start,
    dir,
    points,
    cum,
    total: acc,
    corners,
    vertexArc,
    notches: [],
    interior: (Math.sign(area) * dir >= 0 ? 1 : -1) as 1 | -1,
  };
  path.notches = piece.notches.map((nt) => projectOnPath(path, notchGeometry(piece, nt).at)).sort((a, b) => a - b);
  return path;
}

/** Ponto e tangente (unitária) a `s` mm do início do percurso. */
export function pointAt(path: WalkPath, s: number): { p: Vec2; t: Vec2 } {
  const target = Math.max(0, Math.min(path.total, s));
  let lo = 0, hi = path.cum.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    // Num canto exato, vale a borda de onde se vem (segmento anterior).
    if (path.cum[m]! < target) lo = m;
    else hi = m;
  }
  const a = path.points[lo]!, b = path.points[hi]!;
  const L = path.cum[hi]! - path.cum[lo]!;
  const f = L > 0 ? (target - path.cum[lo]!) / L : 0;
  return { p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, t: normalize(sub(b, a)) };
}

/** Posição (mm ao longo do percurso) do ponto do percurso mais próximo de `p`. */
export function projectOnPath(path: WalkPath, p: Vec2, maxS = Infinity): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < path.points.length - 1; i++) {
    if (path.cum[i]! > maxS) break;
    const a = path.points[i]!, b = path.points[i + 1]!;
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
    const q = add(a, scale(ab, t));
    const dd = dist(p, q);
    if (dd < bd) {
      bd = dd;
      best = path.cum[i]! + t * Math.sqrt(l2);
    }
  }
  return Math.min(best, maxS);
}

const leftNormal = (t: Vec2): Vec2 => ({ x: -t.y, y: t.x });

/**
 * Transformação rígida que coloca o molde B encostado em A na posição `s`:
 * o ponto de B a `s` mm coincide com o de A, as tangentes ficam alinhadas e
 * o interior de B fica do lado OPOSTO ao de A (se preciso, B é espelhado).
 */
export function walkTransform(A: WalkPath, B: WalkPath, s: number): { f: (p: Vec2) => Vec2; mirrored: boolean } {
  const a = pointAt(A, s);
  const b = pointAt(B, s);
  const nA = scale(leftNormal(a.t), A.interior);
  const nB = scale(leftNormal(b.t), B.interior);
  // Base de destino: (tA, −nA). Base de origem: (tB, nB).
  const tx = a.t, ny = scale(nA, -1);
  const f = (p: Vec2): Vec2 => {
    const r = sub(p, b.p);
    const u = dot(r, b.t);
    const w = dot(r, nB);
    return add(a.p, add(scale(tx, u), scale(ny, w)));
  };
  // Espelhado se a base de origem e a de destino têm orientações diferentes.
  const mirrored = Math.sign(cross(b.t, nB)) !== Math.sign(cross(tx, ny));
  return { f, mirrored };
}

export interface WalkReport {
  s: number;
  /** Próximo canto à frente em cada molde (mm do início) e diferença B − A. */
  nextCornerA: number | null;
  nextCornerB: number | null;
  cornerDiff: number | null;
  /** Piques de A e B à frente/atrás: pares mais próximos e diferença B − A (mm). */
  notchPairs: { a: number; b: number; diff: number }[];
  /** Ângulo na junção do início (180° = curva contínua, sem bico). */
  startAngleDeg: number;
}

/** Relatório do andar molde na posição `s`. */
export function walkReport(pieceA: Piece, A: WalkPath, pieceB: Piece, B: WalkPath, s: number): WalkReport {
  const eps = 0.5;
  // Canto da costura em análise: o primeiro de A à frente (incluindo onde já está)
  // e, em B, o canto correspondente (o mais próximo dele).
  const nextA = A.corners.find((c) => c > Math.max(eps, s - eps)) ?? null;
  let nextB: number | null = null;
  if (nextA !== null) for (const c of B.corners) if (c > eps && (nextB === null || Math.abs(c - nextA) < Math.abs(nextB - nextA))) nextB = c;
  // Só os piques do trecho de costura em análise: do início até o próximo canto (ou até onde já andou).
  const reachA = Math.max(s, nextA ?? A.total) + eps;
  const reachB = Math.max(s, nextB ?? B.total) + eps;
  const nbs = B.notches.filter((x) => x <= reachB);
  const notchPairs = A.notches
    .filter((x) => x <= reachA)
    .map((na) => {
      let best = nbs[0];
      for (const nb of nbs) if (best === undefined || Math.abs(nb - na) < Math.abs(best - na)) best = nb;
      return best === undefined ? null : { a: na, b: best, diff: best - na };
    })
    .filter((x): x is { a: number; b: number; diff: number } => !!x && Math.abs(x.diff) < 50);
  // Continuidade na junção: bordas vizinhas (sentido contrário ao percurso) de A e B transformado.
  const backA = walkPath(pieceA, A.start, (-A.dir) as 1 | -1);
  const backB = walkPath(pieceB, B.start, (-B.dir) as 1 | -1);
  const { f } = walkTransform(A, B, 0);
  const tA = pointAt(backA, 0).t;
  const o = f(backB.points[0]!);
  const tB = normalize(sub(f(pointAt(backB, Math.min(2, backB.total)).p), o));
  const ang = (Math.acos(Math.max(-1, Math.min(1, dot(tA, tB)))) * 180) / Math.PI;
  return {
    s,
    nextCornerA: nextA,
    nextCornerB: nextB,
    cornerDiff: nextA !== null && nextB !== null ? nextB - nextA : null,
    notchPairs,
    startAngleDeg: ang,
  };
}

/** Ponto do contorno original de B que está encostado em A na posição `s` (para marcar pique). */
export function walkContact(A: WalkPath, B: WalkPath, s: number) {
  return { onA: pointAt(A, s).p, onB: pointAt(B, s).p };
}

