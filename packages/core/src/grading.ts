/**
 * GRADAÇÃO (ampliação/redução de tamanhos) por regra em cada ponto do contorno.
 *
 * Cada vértice tem um deslocamento (ΔX, ΔY em mm) para cada tamanho, medido a partir
 * do tamanho base (cujo deslocamento é sempre 0,0). Ao gerar um tamanho:
 *  - os vértices andam o seu deslocamento e as alças das curvas acompanham o seu vértice;
 *  - piques ficam na mesma proporção da borda;
 *  - pontos internos (fio, linhas internas, ápice de pence) andam por interpolação
 *    (média ponderada pelo inverso da distância aos vértices).
 */
import { type Path, type Vec2, add, lerp, sub } from './geometry.js';
import { compose, decompose, vertices } from './edit.js';
import type { Piece } from './pattern.js';

export interface Grading {
  /** Nomes dos tamanhos, do menor para o maior (ex.: PP, P, M, G, GG). */
  sizes: string[];
  /** Índice do tamanho base (o molde desenhado). */
  base: number;
  /** Vértice → deslocamento por tamanho (mm). Vértice sem regra = não se move. */
  rules: Record<string, Vec2[]>;
}

const ZERO: Vec2 = { x: 0, y: 0 };

export function emptyGrading(sizes: string[], base: number): Grading {
  if (base < 0 || base >= sizes.length) throw new Error('Tamanho base fora da grade');
  return { sizes: [...sizes], base, rules: {} };
}

/** Regra linear: o mesmo ΔX/ΔY a cada tamanho (acumulado a partir da base). */
export function linearOffsets(g: Pick<Grading, 'sizes' | 'base'>, step: Vec2): Vec2[] {
  return g.sizes.map((_, i) => ({ x: step.x * (i - g.base), y: step.y * (i - g.base) }));
}

export function vertexOffset(g: Grading, vertex: number, size: number): Vec2 {
  return g.rules[String(vertex)]?.[size] ?? ZERO;
}

/** Define a regra de um vértice (o tamanho base é forçado a 0,0). */
export function setVertexRule(piece: Piece, vertex: number, offsets: Vec2[]): Piece {
  const g = piece.grading;
  if (!g) throw new Error('O molde ainda não tem grade de tamanhos');
  if (offsets.length !== g.sizes.length) throw new Error('Uma regra por tamanho');
  const clean = offsets.map((o, i) => (i === g.base ? { ...ZERO } : { x: o.x, y: o.y }));
  const zero = clean.every((o) => o.x === 0 && o.y === 0);
  const rules = { ...g.rules };
  if (zero) delete rules[String(vertex)];
  else rules[String(vertex)] = clean;
  return { ...piece, grading: { ...g, rules } };
}

/** Interpolação pelo inverso da distância (para pontos internos). */
function idw(p: Vec2, anchors: Vec2[], deltas: Vec2[]): Vec2 {
  let wx = 0, wy = 0, ws = 0;
  for (let i = 0; i < anchors.length; i++) {
    const d2 = (p.x - anchors[i]!.x) ** 2 + (p.y - anchors[i]!.y) ** 2;
    if (d2 < 1e-12) return deltas[i]!;
    const w = 1 / d2;
    wx += w * deltas[i]!.x;
    wy += w * deltas[i]!.y;
    ws += w;
  }
  return ws ? { x: wx / ws, y: wy / ws } : ZERO;
}

function gradePath(path: Path, f: (p: Vec2) => Vec2): Path {
  return {
    start: f(path.start),
    closed: path.closed,
    segments: path.segments.map((s) => (s.kind === 'line' ? { kind: 'line', to: f(s.to) } : { kind: 'cubic', c1: f(s.c1), c2: f(s.c2), to: f(s.to) })),
  };
}

/** Gera o molde num tamanho da grade (o resultado não carrega a grade). */
export function pieceForSize(piece: Piece, size: number): Piece {
  const g = piece.grading;
  if (!g || size === g.base) return { ...piece, grading: undefined };
  if (size < 0 || size >= g.sizes.length) throw new Error('Tamanho fora da grade');
  const d = decompose(piece.outline);
  const n = d.verts.length;
  const deltas = d.verts.map((_, i) => vertexOffset(g, i, size));
  const verts = d.verts.map((v, i) => add(v, deltas[i]!));
  const edges = d.edges.map((e, i) =>
    e.kind === 'line' ? e : { kind: 'cubic' as const, c1: add(e.c1, deltas[i]!), c2: add(e.c2, deltas[(i + 1) % n]!) },
  );
  const inner = (p: Vec2) => add(p, idw(p, d.verts, deltas));
  return {
    ...piece,
    outline: compose({ verts, edges, closed: true }),
    internals: piece.internals.map((p) => gradePath(p, inner)),
    grainline: piece.grainline ? [inner(piece.grainline[0]), inner(piece.grainline[1])] : undefined,
    darts: piece.darts?.map((dt) => ({ ...dt, apex: inner(dt.apex) })),
    drills: piece.drills?.map(inner),
    prints: piece.prints?.map((pr) => ({ ...pr, center: inner(pr.center) })),
    grading: undefined,
  };
}

/** Todos os tamanhos do molde (rótulo + molde), do menor ao maior. */
export function allSizes(piece: Piece): { size: string; piece: Piece }[] {
  const g = piece.grading;
  if (!g) return [{ size: '', piece }];
  return g.sizes.map((size, i) => ({ size, piece: pieceForSize(piece, i) }));
}

/**
 * Calcula a grade a partir do mesmo molde construído em cada tamanho (mesma topologia),
 * tomando o vértice `ref` como ponto fixo (os outros andam em relação a ele).
 * Retorna null se algum tamanho tiver número de pontos diferente.
 */
export function gradingFromVariants(
  base: Piece,
  variants: Piece[],
  sizes: string[],
  baseIndex: number,
  ref: number | ((p: Piece) => Vec2) = 0,
): Grading | null {
  const vb = vertices(base.outline);
  const vs = variants.map((p) => vertices(p.outline));
  if (vs.some((v) => v.length !== vb.length)) return null;
  const refOf = (p: Piece, v: Vec2[]) => (typeof ref === 'number' ? v[ref]! : ref(p));
  const rb = refOf(base, vb);
  const rs = variants.map((p, j) => refOf(p, vs[j]!));
  const rules: Record<string, Vec2[]> = {};
  for (let i = 0; i < vb.length; i++) {
    const offs = vs.map((v, j) => (j === baseIndex ? { ...ZERO } : sub(sub(v[i]!, rs[j]!), sub(vb[i]!, rb))));
    if (offs.some((o) => Math.abs(o.x) > 1e-9 || Math.abs(o.y) > 1e-9)) rules[String(i)] = offs;
  }
  return { sizes: [...sizes], base: baseIndex, rules };
}

/** Reindexa a grade quando se insere um vértice na aresta `edge` em `t` (o novo ponto interpola a regra). */
export function gradingInsert(g: Grading | undefined, edge: number, t: number, n: number): Grading | undefined {
  if (!g) return g;
  const rules: Record<string, Vec2[]> = {};
  for (const [k, offs] of Object.entries(g.rules)) {
    const i = Number(k);
    rules[String(i > edge ? i + 1 : i)] = offs;
  }
  const a = g.rules[String(edge)], b = g.rules[String((edge + 1) % n)];
  if (a || b) {
    rules[String(edge + 1)] = g.sizes.map((_, s) => lerp(a?.[s] ?? ZERO, b?.[s] ?? ZERO, t));
  }
  return { ...g, rules };
}

/** Reindexa a grade quando se remove o vértice `i`. */
export function gradingRemove(g: Grading | undefined, i: number): Grading | undefined {
  if (!g) return g;
  const rules: Record<string, Vec2[]> = {};
  for (const [k, offs] of Object.entries(g.rules)) {
    const j = Number(k);
    if (j === i) continue;
    rules[String(j > i ? j - 1 : j)] = offs;
  }
  return { ...g, rules };
}

/** Aplica a parte linear de uma transformação às regras (girar/espelhar o molde gira/espelha a grade). */
export function gradingMap(g: Grading | undefined, f: (p: Vec2) => Vec2): Grading | undefined {
  if (!g) return g;
  const o = f(ZERO);
  const lin = (v: Vec2) => sub(f(v), o);
  const rules: Record<string, Vec2[]> = {};
  for (const [k, offs] of Object.entries(g.rules)) rules[k] = offs.map(lin);
  return { ...g, rules };
}

/** Maior deslocamento da grade (para conferência). */
export function gradingSpan(g: Grading): number {
  let m = 0;
  for (const offs of Object.values(g.rules)) for (const o of offs) m = Math.max(m, Math.hypot(o.x, o.y));
  return m;
}


