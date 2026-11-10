import { DEFAULT_FLATTEN_TOLERANCE_MM } from './units.js';

/** Ponto/vetor 2D em milímetros. */
export interface Vec2 {
  x: number;
  y: number;
}

export type Segment =
  | { kind: 'line'; to: Vec2 }
  | { kind: 'cubic'; c1: Vec2; c2: Vec2; to: Vec2 };

/** Caminho vetorial: ponto inicial + segmentos (retas e Béziers cúbicas). */
export interface Path {
  start: Vec2;
  segments: Segment[];
  closed: boolean;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const normalize = (a: Vec2): Vec2 => {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};

/* ------------------------------------------------------------------ */
/* Construtores                                                        */
/* ------------------------------------------------------------------ */

/** Polígono/polilinha a partir de pontos (mm). Fechado → fechamento explícito até o início. */
export function polyline(points: Vec2[], closed: boolean): Path {
  if (points.length < 2) throw new Error('polyline: precisa de pelo menos 2 pontos');
  const [start, ...rest] = points as [Vec2, ...Vec2[]];
  const segments: Segment[] = rest.map((to) => ({ kind: 'line', to }));
  if (closed) segments.push({ kind: 'line', to: { ...start } });
  return { start, segments, closed };
}

/** Retângulo com canto inferior-esquerdo em (x,y), largura w e altura h, em mm. */
export function rect(x: number, y: number, w: number, h: number): Path {
  return polyline([v(x, y), v(x + w, y), v(x + w, y + h), v(x, y + h)], true);
}

/* ------------------------------------------------------------------ */
/* Achatamento (curva → polilinha)                                     */
/* ------------------------------------------------------------------ */

function cubicIsFlat(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, tol: number): boolean {
  // Distância máxima dos pontos de controle até a corda p0→p3 limita o desvio da curva.
  const chord = sub(p3, p0);
  const l = len(chord);
  if (l < 1e-12) return dist(p0, c1) <= tol && dist(p0, c2) <= tol;
  const d1 = Math.abs(cross(chord, sub(c1, p0))) / l;
  const d2 = Math.abs(cross(chord, sub(c2, p0))) / l;
  // O desvio da Bézier é no máximo 3/4 do maior desvio dos controles.
  return 0.75 * Math.max(d1, d2) <= tol;
}

function flattenCubic(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, tol: number, out: Vec2[], depth = 0): void {
  if (depth >= 24 || cubicIsFlat(p0, c1, c2, p3, tol)) {
    out.push(p3);
    return;
  }
  // Subdivisão de De Casteljau em t = 0,5
  const p01 = lerp(p0, c1, 0.5);
  const p12 = lerp(c1, c2, 0.5);
  const p23 = lerp(c2, p3, 0.5);
  const p012 = lerp(p01, p12, 0.5);
  const p123 = lerp(p12, p23, 0.5);
  const mid = lerp(p012, p123, 0.5);
  flattenCubic(p0, p01, p012, mid, tol, out, depth + 1);
  flattenCubic(mid, p123, p23, p3, tol, out, depth + 1);
}

/**
 * Converte o caminho em lista de pontos. Para caminho fechado, o último ponto
 * NÃO repete o primeiro (o fechamento é implícito).
 */
export function flattenPath(path: Path, tolerance = DEFAULT_FLATTEN_TOLERANCE_MM): Vec2[] {
  const out: Vec2[] = [path.start];
  let cur = path.start;
  for (const seg of path.segments) {
    if (seg.kind === 'line') out.push(seg.to);
    else flattenCubic(cur, seg.c1, seg.c2, seg.to, tolerance, out);
    cur = seg.to;
  }
  if (path.closed && out.length > 1 && dist(out[0]!, out[out.length - 1]!) < 1e-9) out.pop();
  return out;
}

/**
 * Achata o caminho e informa a qual segmento original (aresta) pertence cada trecho:
 * edgeOf[k] = aresta do trecho points[k] → points[k+1] (em fechado, o último trecho volta ao início).
 */
export function flattenWithEdges(path: Path, tolerance = DEFAULT_FLATTEN_TOLERANCE_MM): { points: Vec2[]; edgeOf: number[] } {
  const points: Vec2[] = [path.start];
  const producer: number[] = [-1];
  let cur = path.start;
  path.segments.forEach((seg, e) => {
    const before = points.length;
    if (seg.kind === 'line') points.push(seg.to);
    else flattenCubic(cur, seg.c1, seg.c2, seg.to, tolerance, points);
    for (let k = before; k < points.length; k++) producer.push(e);
    cur = seg.to;
  });
  let closingEdge = path.segments.length; // fechamento implícito (não deveria ocorrer após normalizeClosed)
  if (path.closed && points.length > 1 && dist(points[0]!, points[points.length - 1]!) < 1e-9) {
    points.pop();
    closingEdge = producer.pop()!;
  }
  const edgeOf = points.map((_, k) => (k + 1 < points.length ? producer[k + 1]! : closingEdge));
  return { points, edgeOf };
}

/* ------------------------------------------------------------------ */
/* Medidas                                                             */
/* ------------------------------------------------------------------ */

/** Comprimento de uma polilinha (mm). */
export function polylineLength(points: Vec2[], closed: boolean): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1]!, points[i]!);
  if (closed && points.length > 2) total += dist(points[points.length - 1]!, points[0]!);
  return total;
}

/** Comprimento real do caminho (mm) — achatado com tolerância fina (0,0005 mm). */
export function pathLength(path: Path): number {
  return polylineLength(flattenPath(path, 0.0005), path.closed);
}

/** Área com sinal (mm²). Positiva = anti-horário. */
export function signedArea(points: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function bboxOfPoints(points: Vec2[]): BBox {
  const b: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    if (p.x < b.minX) b.minX = p.x;
    if (p.y < b.minY) b.minY = p.y;
    if (p.x > b.maxX) b.maxX = p.x;
    if (p.y > b.maxY) b.maxY = p.y;
  }
  return b;
}

export function unionBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/* ------------------------------------------------------------------ */
/* Transformações                                                      */
/* ------------------------------------------------------------------ */

/** Transformação rígida (sem escala — escala nunca é permitida em molde). */
export interface Placement {
  x: number;
  y: number;
  /** Rotação em graus, anti-horária, em torno da origem do molde. */
  rotationDeg: number;
  /** Espelhar no eixo X (molde "par" / lado oposto). Aplicado antes da rotação. */
  mirror: boolean;
}

export const IDENTITY: Placement = { x: 0, y: 0, rotationDeg: 0, mirror: false };

export function applyPlacement(p: Vec2, t: Placement): Vec2 {
  const px = t.mirror ? -p.x : p.x;
  const r = (t.rotationDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: px * c - p.y * s + t.x, y: px * s + p.y * c + t.y };
}

/* ------------------------------------------------------------------ */
/* Margem de costura (offset de polígono)                              */
/* ------------------------------------------------------------------ */

/**
 * Desloca um polígono fechado para FORA por `distance` mm (margem de costura).
 * Juntas em quina viva (miter) com limite: se a quina ficar mais longa que
 * `miterLimit × distance`, ela é chanfrada (2 pontos) — igual ao comportamento de CADs têxteis.
 *
 * Limitação atual (v0.1): não resolve auto-interseções em reentrâncias muito fechadas.
 */
export function offsetPolygon(points: Vec2[], distance: number, miterLimit = 4): Vec2[] {
  return offsetPolygonVar(points, points.map(() => distance), miterLimit);
}

/**
 * Offset com distância POR TRECHO: distances[i] vale para o trecho points[i] → points[i+1]
 * (o último trecho fecha no ponto 0). Permite barra de 30 mm, laterais de 10 mm e dobra com 0.
 */
export function offsetPolygonVar(points: Vec2[], distances: number[], miterLimit = 4): Vec2[] {
  const n = points.length;
  if (n < 3) throw new Error('offsetPolygon: polígono precisa de 3+ pontos');
  if (distances.length !== n) throw new Error('offsetPolygonVar: uma distância por trecho');
  // Garante orientação anti-horária, para que a normal "para fora" seja (dy, -dx).
  let pts = points;
  let ds = distances;
  if (signedArea(points) < 0) {
    pts = [...points].reverse();
    // trecho k invertido = trecho original (n-2-k) mod n
    ds = pts.map((_, k) => distances[(((n - 2 - k) % n) + n) % n]!);
  }

  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const dPrev = ds[(i - 1 + n) % n]!;
    const dNext = ds[i]!;
    const d0 = normalize(sub(cur, prev));
    const d1 = normalize(sub(next, cur));
    const n0 = { x: d0.y, y: -d0.x };
    const n1 = { x: d1.y, y: -d1.x };
    const a = add(cur, scale(n0, dPrev)); // fim do trecho anterior deslocado
    const b = add(cur, scale(n1, dNext)); // início do próximo trecho deslocado

    const denom = cross(d0, d1);
    if (Math.abs(denom) < 1e-9) {
      // Colinear: um ponto (ou degrau, se as margens mudam).
      if (Math.abs(dPrev - dNext) < 1e-9) out.push(a);
      else out.push(a, b);
      continue;
    }
    // Interseção das duas retas deslocadas.
    const t = cross(sub(b, a), d1) / denom;
    const miter = add(a, scale(d0, t));
    if (dist(miter, cur) <= miterLimit * Math.max(Math.abs(dPrev), Math.abs(dNext), 1e-9)) out.push(miter);
    else out.push(a, b); // chanfro
  }
  // Remove pontos repetidos consecutivos (ex.: canto com margem 0 dos dois lados)
  return out.filter((p, k) => dist(p, out[(k + 1) % out.length]!) > 1e-9 || out.length <= 3);
}
