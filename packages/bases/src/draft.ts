/**
 * Ferramentas de traçado de modelagem.
 *
 * O traçado é feito em CENTÍMETROS, com Y crescendo PARA BAIXO (como no papel de modelagem,
 * do pescoço para a barra). Ao gerar o molde, tudo é convertido para o modelo do sistema:
 * milímetros, Y para cima.
 */
import {
  type Path,
  type Piece,
  type Segment,
  type Vec2,
  closestOnPath,
  createPiece,
  dist,
  flattenWithEdges,
  normalize,
} from '@cad-textil/core';

export type P = Vec2; // ponto em cm, coordenadas de traçado

export const pt = (x: number, y: number): P => ({ x, y });
export const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const along = (a: P, b: P, d: number): P => {
  const u = normalize({ x: b.x - a.x, y: b.y - a.y });
  return { x: a.x + u.x * d, y: a.y + u.y * d };
};
/** Ponto a partir de `a`, com comprimento e ângulo (graus, 0 = +x, positivo = para BAIXO no traçado). */
export const polar = (a: P, len: number, deg: number): P => ({
  x: a.x + len * Math.cos((deg * Math.PI) / 180),
  y: a.y + len * Math.sin((deg * Math.PI) / 180),
});
export const lerpP = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
/** Interpola Y numa reta a→b para um dado X. */
export const yAt = (a: P, b: P, x: number) => a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
export const mirrorX = (p: P, axisX: number): P => ({ x: 2 * axisX - p.x, y: p.y });

/** Comprimento de uma polilinha em cm (para curvas, use `curveLength`). */
export const plen = (pts: P[]) => pts.slice(1).reduce((s, p, i) => s + dist(pts[i]!, p), 0);

/**
 * Curva suave passando EXATAMENTE pelos pontos (spline de Catmull-Rom por corda → Béziers).
 * startDir/endDir fixam a direção da tangente nas pontas (ex.: decote a 90° do centro da frente).
 */
export function smoothSegments(pts: P[], startDir?: P, endDir?: P): Segment[] {
  const n = pts.length;
  if (n < 2) return [];
  const tan: P[] = pts.map((p, i) => {
    if (i === 0) return normalize(startDir ?? { x: pts[1]!.x - p.x, y: pts[1]!.y - p.y });
    if (i === n - 1) return normalize(endDir ?? { x: p.x - pts[n - 2]!.x, y: p.y - pts[n - 2]!.y });
    return normalize({ x: pts[i + 1]!.x - pts[i - 1]!.x, y: pts[i + 1]!.y - pts[i - 1]!.y });
  });
  const segs: Segment[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const L = dist(a, b) / 3;
    segs.push({
      kind: 'cubic',
      c1: { x: a.x + tan[i]!.x * L, y: a.y + tan[i]!.y * L },
      c2: { x: b.x - tan[i + 1]!.x * L, y: b.y - tan[i + 1]!.y * L },
      to: b,
    });
  }
  return segs;
}

/** Comprimento de uma curva suave (cm) — mesma construção usada no molde. */
export function curveLength(pts: P[], startDir?: P, endDir?: P): number {
  const segs = smoothSegments(pts, startDir, endDir);
  const { points } = flattenWithEdges({ start: pts[0]!, segments: segs, closed: false }, 0.0005);
  return plen(points);
}

/** Converte ponto/segmento de traçado (cm, Y↓) para o modelo (mm, Y↑). */
const toModel = (p: P): Vec2 => ({ x: p.x * 10, y: -p.y * 10 });
const segToModel = (s: Segment): Segment =>
  s.kind === 'line' ? { kind: 'line', to: toModel(s.to) } : { kind: 'cubic', c1: toModel(s.c1), c2: toModel(s.c2), to: toModel(s.to) };

/* ------------------------------------------------------------------ */
/* Construtor de contorno                                              */
/* ------------------------------------------------------------------ */

export class Outline {
  private segs: Segment[] = [];
  private seams: (number | undefined)[] = [];
  private marks = new Map<string, number>();
  private cur: P;
  constructor(private start: P, startMark?: string) {
    this.cur = start;
    if (startMark) this.marks.set(startMark, 0);
  }
  /** Marca o ponto atual com um nome (para piques por distância). */
  mark(name: string): this {
    this.marks.set(name, this.segs.length);
    return this;
  }
  /** Reta até `to`. seam = margem desta borda em mm (omitido = padrão do molde). */
  line(to: P, seam?: number): this {
    this.segs.push({ kind: 'line', to });
    this.seams.push(seam);
    this.cur = to;
    return this;
  }
  /** Curva suave passando pelos pontos (o último é o ponto final). */
  curve(through: P[], opts: { seam?: number; startDir?: P; endDir?: P } = {}): this {
    const segs = smoothSegments([this.cur, ...through], opts.startDir, opts.endDir);
    for (const s of segs) {
      this.segs.push(s);
      this.seams.push(opts.seam);
    }
    this.cur = through[through.length - 1]!;
    return this;
  }
  /** Fecha com reta até o início. */
  close(seam?: number): this {
    if (dist(this.cur, this.start) > 1e-9) this.line(this.start, seam);
    return this;
  }
  build(): { outline: Path; seamByEdge: Record<string, number>; marks: Map<string, number> } {
    const seamByEdge: Record<string, number> = {};
    this.seams.forEach((s, i) => {
      if (s !== undefined) seamByEdge[String(i)] = s;
    });
    return { outline: { start: toModel(this.start), segments: this.segs.map(segToModel), closed: true }, seamByEdge, marks: this.marks };
  }
}

/* ------------------------------------------------------------------ */
/* Molde                                                               */
/* ------------------------------------------------------------------ */

export interface NotchSpec {
  /** Ponto (cm, traçado) sobre ou perto da borda. */
  at?: P;
  /** Ou: a partir de uma marca do contorno, andando `cm` ao longo da borda (dir +1 = sentido do traçado). */
  from?: string;
  cm?: number;
  dir?: 1 | -1;
  /** Pique duplo (costas da cava/manga): dois piques a 1 cm. */
  double?: boolean;
}

export interface PieceSpec {
  id: string;
  name: string;
  outline: Outline;
  /** Margem padrão (mm). */
  seam: number;
  grain: [P, P];
  quantity: number;
  cutInPairs: boolean;
  notches?: NotchSpec[];
  internals?: { pts: P[]; closed?: boolean; curve?: boolean }[];
  notes: string;
}

/** Caminha `d` mm ao longo do contorno (mm) a partir da aresta `edge`. */
function pointAlongOutline(outline: Path, edge: number, dMm: number, dir: 1 | -1): Vec2 {
  const { points, edgeOf } = flattenWithEdges(outline, 0.002);
  const n = points.length;
  let k = edgeOf.findIndex((e) => e === edge);
  if (k < 0) k = 0;
  let remaining = dMm;
  let i = k;
  for (let guard = 0; guard < n * 2; guard++) {
    const j = dir === 1 ? (i + 1) % n : (i - 1 + n) % n;
    const a = points[i]!, b = points[j]!;
    const L = dist(a, b);
    if (L >= remaining) {
      const t = remaining / L;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= L;
    i = j;
  }
  return points[k]!;
}

/** Margem a partir da qual a borda é tratada como barra (bainha) com cantos espelhados (mm). */
export const HEM_MIN_MM = 25;

export function makePiece(spec: PieceSpec, group: string): Piece {
  const { outline, seamByEdge, marks } = spec.outline.build();
  const piece = createPiece(spec.id, spec.name, outline);
  piece.seamAllowanceMm = spec.seam;
  piece.seamByEdge = Object.keys(seamByEdge).length ? seamByEdge : undefined;
  // Barras (margem de 2,5 cm ou mais) saem com cantos espelhados: dobradas, encaixam nas laterais.
  const hems = Object.entries(seamByEdge).filter(([, mm]) => mm >= HEM_MIN_MM).map(([k]) => [k, true as const]);
  piece.hemByEdge = hems.length ? Object.fromEntries(hems) : undefined;
  piece.quantity = spec.quantity;
  piece.cutInPairs = spec.cutInPairs;
  piece.grainline = [toModel(spec.grain[0]), toModel(spec.grain[1])];
  piece.group = group;
  piece.notes = spec.notes;
  piece.internals = (spec.internals ?? []).map((it) =>
    it.curve
      ? { start: toModel(it.pts[0]!), segments: smoothSegments(it.pts).map(segToModel), closed: false }
      : { start: toModel(it.pts[0]!), segments: it.pts.slice(1).map((p) => ({ kind: 'line' as const, to: toModel(p) })), closed: !!it.closed },
  );
  for (const n of spec.notches ?? []) {
    const points: Vec2[] = [];
    if (n.at) points.push(toModel(n.at));
    else if (n.from !== undefined) {
      const edge = marks.get(n.from);
      if (edge === undefined) throw new Error(`Marca "${n.from}" não existe em ${spec.name}`);
      const dir = n.dir ?? 1;
      points.push(pointAlongOutline(outline, edge, (n.cm ?? 0) * 10, dir));
      if (n.double) points.push(pointAlongOutline(outline, edge, ((n.cm ?? 0) + 1) * 10, dir));
    }
    for (const p of points) {
      const hit = closestOnPath(piece.outline, p);
      piece.notches.push({ edge: hit.edge, t: hit.t, depthMm: 5 });
    }
  }
  return piece;
}
