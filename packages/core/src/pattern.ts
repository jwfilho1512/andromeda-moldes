import {
  type BBox,
  type Path,
  type Placement,
  type Vec2,
  IDENTITY,
  applyPlacement,
  bboxOfPoints,
  flattenPath,
  offsetPolygon,
  offsetPolygonVar,
  flattenWithEdges,
  unionBBox,
  add,
  dot,
  lerp,
  normalize,
  scale,
  signedArea,
  sub,
} from './geometry.js';
import { normalizeClosed } from './edit.js';
import type { Grading } from './grading.js';
import type { PiecePrint } from './estampa-frame.js';
import type { Artwork } from './estampa.js';
import type { MarkerDoc } from './marker.js';

/**
 * Pique (notch): marca de encontro na borda do molde.
 * Fica PRESO à aresta do contorno (índice + parâmetro t), então acompanha a edição do molde.
 */
export interface Notch {
  /** Índice da aresta do contorno. */
  edge: number;
  /** Posição ao longo da aresta, 0..1. */
  t: number;
  /** Profundidade do pique em mm (padrão de mercado: 3–6 mm). */
  depthMm: number;
}

/**
 * Pence: a "boca" é uma aresta do contorno (entre as duas pernas) e o ápice é um ponto interno.
 * O contorno continua fechado sobre a boca (pence marcada, como se corta na produção);
 * a pence é desenhada e plotada a partir destes dados.
 */
export interface Dart {
  /** Aresta do contorno que forma a boca da pence (vértice edge → edge+1 = pernas). */
  edge: number;
  apex: Vec2;
}

/** Molde (peça) — a unidade básica de modelagem planificada. */
export interface Piece {
  id: string;
  name: string;
  /** Linha de costura / contorno base (fechado). */
  outline: Path;
  /** Margem de costura padrão em mm. 0 = contorno já é a linha de corte. */
  seamAllowanceMm: number;
  /**
   * Margem específica por borda (índice da aresta → mm), sobrepõe a padrão.
   * Ex.: { "0": 30 } = barra de 3 cm; { "3": 0 } = linha de dobra sem margem.
   */
  seamByEdge?: Record<string, number>;
  /**
   * Barras com CANTOS ESPELHADOS (índice da aresta → true). A margem dessa borda é a profundidade
   * da barra; nos dois cantos, a margem das laterais é rebatida sobre a linha de dobra, para que a
   * barra, quando dobrada, encaixe exatamente nas laterais (bainha de manga, calça, saia…).
   */
  hemByEdge?: Record<string, true>;
  /** Peça de roupa a que o molde pertence (ex.: "Camisa social masculina M"). */
  group?: string;
  /** Observações técnicas do molde (aparecem na ficha). */
  notes?: string;
  /** Linhas internas: pences, bolsos, marcações. */
  internals: Path[];
  /**
   * Pontos internos (furo/marcação): posição de bolso, botão, casa, aplique…
   * Plotados como um círculo pequeno com cruz; no DXF-AAMA vão na camada 13 (furos).
   */
  drills?: Vec2[];
  /** Fio do tecido (sentido do urdume): segmento de 2 pontos. */
  grainline?: [Vec2, Vec2];
  notches: Notch[];
  /** Pences do molde. */
  darts?: Dart[];
  /** Grade de tamanhos (regras por ponto). */
  grading?: Grading;
  /** Quantidade a cortar por peça de roupa. */
  quantity: number;
  /** Cortar em par espelhado (ex.: manga esquerda/direita). */
  cutInPairs: boolean;
  /** Estampas do molde (localizada, total, corrida), com arte por tamanho. */
  prints?: PiecePrint[];
}

/** Documento — o arquivo nativo compartilhado por Hub, Matriz, Modelagem 2D e Risco. */
export interface PatternDocument {
  format: 'cad-textil';
  version: 1;
  units: 'mm';
  name: string;
  createdAt: string;
  pieces: Piece[];
  /** Riscos (encaixes) salvos no documento. */
  markers?: MarkerDoc[];
  /** Linhas guia puxadas da régua (x = verticais, y = horizontais), em mm. */
  guides?: { x: number[]; y: number[] };
  /** Imagens das estampas (referenciadas pelos moldes). */
  artworks?: Artwork[];
}

export const FILE_EXTENSION = '.ctx';

export function newDocument(name: string): PatternDocument {
  return { format: 'cad-textil', version: 1, units: 'mm', name, createdAt: new Date().toISOString(), pieces: [] };
}

/* ------------------------------------------------------------------ */
/* Geometria derivada do molde                                         */
/* ------------------------------------------------------------------ */

/** Polilinha da linha de corte (contorno + margem de costura). */
export function cutLine(piece: Piece, tolerance?: number): Vec2[] {
  const byEdge = piece.seamByEdge && Object.keys(piece.seamByEdge).length > 0;
  if (!byEdge) {
    const base = flattenPath(piece.outline, tolerance);
    return piece.seamAllowanceMm > 0 ? offsetPolygon(base, piece.seamAllowanceMm) : base;
  }
  const { points, edgeOf } = flattenWithEdges(piece.outline, tolerance);
  const ds = edgeOf.map((e) => edgeSeam(piece, e));
  if (ds.every((d) => d === 0)) return points;
  let cut = offsetPolygonVar(points, ds);
  for (const k of Object.keys(piece.hemByEdge ?? {})) {
    const e = Number(k);
    const h = edgeSeam(piece, e);
    if (h > 0 && edgeOf.includes(e)) cut = mirrorHemCorners(cut, points, edgeOf, e, h) ?? cut;
  }
  return cut;
}

/**
 * Cantos espelhados da barra: troca o trecho da linha de corte além da linha de dobra (a própria
 * borda da barra) pelo reflexo das margens vizinhas sobre essa linha, até a profundidade h.
 * Se a borda for curva, a dobra em cada canto é a reta tangente à borda naquele canto.
 */
function mirrorHemCorners(cut: Vec2[], pts: Vec2[], edgeOf: number[], e: number, h: number): Vec2[] | null {
  const n = pts.length;
  // pontos da borda da barra, de A (início) até B (fim)
  const ks = edgeOf.map((x, k) => (x === e ? k : -1)).filter((k) => k >= 0);
  if (!ks.length) return null;
  // trechos consecutivos (a borda pode cruzar o índice 0)
  let first = ks[0]!;
  if (ks.length < n && ks.includes(n - 1) && ks.includes(0)) first = ks.find((k) => !ks.includes((k - 1 + n) % n)) ?? first;
  const edgePts: Vec2[] = [];
  for (let j = 0; j <= ks.length; j++) edgePts.push(pts[(first + j) % n]!);
  const ccw = signedArea(pts) > 0;
  const outward = (t: Vec2) => (ccw ? { x: t.y, y: -t.x } : { x: -t.y, y: t.x });
  const A = edgePts[0]!, B = edgePts[edgePts.length - 1]!;
  const tA = normalize(sub(edgePts[1]!, A)), tB = normalize(sub(B, edgePts[edgePts.length - 2]!));
  const nA = outward(tA), nB = outward(tB);
  const dA = (p: Vec2) => dot(sub(p, A), nA);
  const dB = (p: Vec2) => dot(sub(p, B), nB);
  const refl = (p: Vec2, o: Vec2, nn: Vec2) => sub(p, scale(nn, 2 * dot(sub(p, o), nn)));
  // linha da barra (borda deslocada h para fora)
  const hemLine = edgePts.map((p, j) => {
    const a = edgePts[Math.max(0, j - 1)]!, b = edgePts[Math.min(edgePts.length - 1, j + 1)]!;
    return add(p, scale(outward(normalize(sub(b, a))), h));
  });
  // na ordem do percurso da linha de corte (anti-horária): entra pelo canto A se o contorno é anti-horário
  const [P, nP, dP, Q, nQ, dQ, line] = ccw ? [A, nA, dA, B, nB, dB, hemLine] as const : [B, nB, dB, A, nA, dA, [...hemLine].reverse()] as const;
  const m = cut.length;
  // cruzamento de entrada (de dentro para fora da dobra em P) e de saída (de fora para dentro em Q), os mais próximos dos cantos
  let iIn = -1, xIn: Vec2 | null = null, best = Infinity;
  let iOut = -1, xOut: Vec2 | null = null, bestO = Infinity;
  for (let i = 0; i < m; i++) {
    const a = cut[i]!, b = cut[(i + 1) % m]!;
    const da = dP(a), db = dP(b);
    if (da <= 0 && db > 0) {
      const x = lerp(a, b, da / (da - db));
      const dd = Math.hypot(x.x - P.x, x.y - P.y);
      if (dd < best) [best, iIn, xIn] = [dd, i, x];
    }
    const qa = dQ(a), qb = dQ(b);
    if (qa > 0 && qb <= 0) {
      const x = lerp(a, b, qa / (qa - qb));
      const dd = Math.hypot(x.x - Q.x, x.y - Q.y);
      if (dd < bestO) [bestO, iOut, xOut] = [dd, i, x];
    }
  }
  if (!xIn || !xOut) return null;
  // margem vizinha antes da entrada, refletida (do mais perto ao mais longe da dobra)
  const side = (start: Vec2, from: number, step: 1 | -1, dist: (p: Vec2) => number, o: Vec2, nn: Vec2): Vec2[] => {
    const out: Vec2[] = [];
    let prev = start;
    for (let c = 0, i = from; c < m; c++, i = (i + step + m) % m) {
      const q = cut[i]!;
      if (-dist(q) >= h) {
        const dp = -dist(prev), dq = -dist(q);
        out.push(refl(lerp(prev, q, (h - dp) / (dq - dp)), o, nn));
        return out;
      }
      out.push(refl(q, o, nn));
      prev = q;
    }
    return out;
  };
  const before = side(xIn, iIn, -1, dP, P, nP);
  const after = side(xOut, (iOut + 1) % m, 1, dQ, Q, nQ).reverse();
  const res: Vec2[] = [];
  for (let c = 0, i = (iOut + 1) % m; c < m; c++, i = (i + 1) % m) {
    res.push(cut[i]!);
    if (i === iIn) break;
  }
  res.push(xIn, ...before, ...line, ...after, xOut);
  return res.filter((p, k) => k === 0 || Math.hypot(p.x - res[k - 1]!.x, p.y - res[k - 1]!.y) > 1e-9);
}

/** Margem de costura efetiva de uma borda (mm). */
export function edgeSeam(piece: Piece, edge: number): number {
  return piece.seamByEdge?.[String(edge)] ?? piece.seamAllowanceMm;
}

export function pieceBBox(piece: Piece, placement: Placement = IDENTITY): BBox {
  return bboxOfPoints(cutLine(piece).map((p) => applyPlacement(p, placement)));
}

export function layoutBBox(items: { piece: Piece; placement: Placement }[]): BBox {
  if (items.length === 0) throw new Error('layoutBBox: nenhum molde');
  return items.map((i) => pieceBBox(i.piece, i.placement)).reduce(unionBBox);
}

/* ------------------------------------------------------------------ */
/* Arquivo nativo (.ctx) — JSON versionado                             */
/* ------------------------------------------------------------------ */

export function serializeDocument(doc: PatternDocument): string {
  return JSON.stringify(doc, null, 2);
}

export function parseDocument(text: string): PatternDocument {
  const data = JSON.parse(text) as Partial<PatternDocument>;
  if (data.format !== 'cad-textil') throw new Error('Arquivo não é do formato cad-textil');
  if (data.version !== 1) throw new Error(`Versão de arquivo não suportada: ${String(data.version)}`);
  if (data.units !== 'mm') throw new Error('Unidade do arquivo deve ser mm');
  if (!Array.isArray(data.pieces)) throw new Error('Arquivo sem lista de moldes');
  for (const p of data.pieces) {
    if (!p.outline?.closed) throw new Error(`Molde "${p.name}" sem contorno fechado`);
    if (!(p.seamAllowanceMm >= 0)) throw new Error(`Molde "${p.name}" com margem inválida`);
    p.outline = normalizeClosed(p.outline);
    p.internals ??= [];
    p.notches ??= [];
  }
  return data as PatternDocument;
}
