/**
 * Operações de modelagem (equivalentes às paletas "Moldes" e "Curvas" do Audaces):
 * pence (criar / transferir), cortar, unir, dobrar, desdobrar, prega, abrir folga (paralela / leque),
 * curva por pontos (curvatura) e conversão de ponto canto ⇄ suave.
 *
 * Todas são imutáveis e preservam margens por borda, piques, pences e linhas internas.
 */
import { type Path, type Vec2, add, bboxOfPoints, cross, dist, dot, flattenPath, lerp, normalize, scale, signedArea, sub } from './geometry.js';
import {
  type Decomposed,
  type EdgeData,
  closestOnPath,
  compose,
  decompose,
  insertPieceVertex,
  mapPath,
  mapPiece,
  notchGeometry,
  pointOnEdge,
  vertices,
} from './edit.js';
import { type Dart, type Piece, edgeSeam } from './pattern.js';

export interface EdgeHit {
  edge: number;
  t: number;
}

/* ------------------------------------------------------------------ */
/* Utilitários                                                         */
/* ------------------------------------------------------------------ */

type Fn = (p: Vec2) => Vec2;
const ID: Fn = (p) => p;

export const rotateAbout = (c: Vec2, ang: number): Fn => {
  const s = Math.sin(ang), co = Math.cos(ang);
  return (p) => ({ x: c.x + (p.x - c.x) * co - (p.y - c.y) * s, y: c.y + (p.x - c.x) * s + (p.y - c.y) * co });
};
const translateBy = (d: Vec2): Fn => (p) => ({ x: p.x + d.x, y: p.y + d.y });
const mirrorAcross = (a: Vec2, b: Vec2): Fn => {
  const u = normalize(sub(b, a));
  return (p) => {
    const v = sub(p, a);
    const proj = scale(u, dot(v, u));
    return add(a, sub(scale(proj, 2), v));
  };
};
const mapEdge = (e: EdgeData, f: Fn): EdgeData => (e.kind === 'line' ? e : { kind: 'cubic', c1: f(e.c1), c2: f(e.c2) });
const reverseEdge = (e: EdgeData): EdgeData => (e.kind === 'line' ? e : { kind: 'cubic', c1: e.c2, c2: e.c1 });
const centroid = (pts: Vec2[]) => scale(pts.reduce((s, p) => add(s, p), { x: 0, y: 0 }), 1 / pts.length);

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Aresta nova: geometria + margem (mm) + origem (para levar pences). */
interface NewEdge {
  data: EdgeData;
  seam: number;
  /** Barra com cantos espelhados. */
  hem?: boolean;
  /** Chave de origem: "A:3" = aresta 3 do molde A. */
  from?: string;
}

interface Carry {
  /** Piques: posição (já transformada) e profundidade. */
  notches: { p: Vec2; depth: number }[];
  /** Pences: origem da boca + ápice já transformado. */
  darts: { from: string; apex: Vec2 }[];
  internals: Path[];
  /** Pontos internos (furos) já transformados. */
  drills: Vec2[];
}

const emptyCarry = (): Carry => ({ notches: [], darts: [], internals: [], drills: [] });

/** Margem e barra de uma aresta (para levar às arestas novas). */
function seamOf(piece: Piece, edge: number): { seam: number; hem?: boolean } {
  return piece.hemByEdge?.[String(edge)] ? { seam: edgeSeam(piece, edge), hem: true } : { seam: edgeSeam(piece, edge) };
}

/** Coleta piques/pences/internas de um molde, transformando conforme a aresta de origem. */
function collect(piece: Piece, tag: string, opts: { f?: (edge: number) => Fn | null; internals?: Fn | null } = {}): Carry {
  const c = emptyCarry();
  const fOf = opts.f ?? (() => ID);
  for (const n of piece.notches) {
    const f = fOf(n.edge);
    if (f) c.notches.push({ p: f(notchGeometry(piece, n).at), depth: n.depthMm });
  }
  for (const d of piece.darts ?? []) {
    const f = fOf(d.edge);
    if (f) c.darts.push({ from: `${tag}:${d.edge}`, apex: f(d.apex) });
  }
  if (opts.internals !== null) {
    const fi = opts.internals ?? ID;
    for (const p of piece.internals) c.internals.push(mapPath(p, fi));
    for (const p of piece.drills ?? []) c.drills.push(fi(p));
  }
  return c;
}

function merge(...cs: Carry[]): Carry {
  return { notches: cs.flatMap((c) => c.notches), darts: cs.flatMap((c) => c.darts), internals: cs.flatMap((c) => c.internals), drills: cs.flatMap((c) => c.drills) };
}

/** Monta o molde novo a partir de vértices + arestas, reposicionando piques e pences. */
function build(base: Piece, verts: Vec2[], edges: NewEdge[], carry: Carry, over: Partial<Piece> = {}): Piece {
  const outline = compose({ verts, edges: edges.map((e) => e.data), closed: true });
  const seamByEdge: Record<string, number> = {};
  const hemByEdge: Record<string, true> = {};
  edges.forEach((e, i) => {
    if (Math.abs(e.seam - base.seamAllowanceMm) > 1e-9) seamByEdge[String(i)] = e.seam;
    if (e.hem) hemByEdge[String(i)] = true;
  });
  const notches = carry.notches
    .map((n) => ({ n, hit: closestOnPath(outline, n.p) }))
    .filter(({ hit }) => hit.distance < 0.5)
    .map(({ n, hit }) => ({ edge: hit.edge, t: hit.t, depthMm: n.depth }));
  const darts: Dart[] = [];
  for (const d of carry.darts) {
    const idx = edges.findIndex((e) => e.from === d.from);
    if (idx >= 0) darts.push({ edge: idx, apex: d.apex });
  }
  return {
    ...base,
    outline,
    seamByEdge: Object.keys(seamByEdge).length ? seamByEdge : undefined,
    hemByEdge: Object.keys(hemByEdge).length ? hemByEdge : undefined,
    notches,
    darts: darts.length ? darts : undefined,
    internals: carry.internals,
    drills: carry.drills.length ? carry.drills : undefined,
    // Mudou a topologia do contorno: a grade antiga não vale mais (gradue depois de modelar).
    grading: undefined,
    ...over,
  };
}

/** Insere vértices nos pontos dados (sem deformar) e devolve o índice de cada um. */
export function insertPoints(piece: Piece, hits: EdgeHit[]): { piece: Piece; indices: number[] } {
  const positions = hits.map((h) => pointOnEdge(piece.outline, h.edge, h.t));
  const order = hits.map((h, i) => ({ ...h, i })).sort((a, b) => a.edge - b.edge || a.t - b.t);
  let p = piece;
  const cap = new Map<number, number>();
  for (let k = order.length - 1; k >= 0; k--) {
    const h = order[k]!;
    if (h.t < 1e-6 || h.t > 1 - 1e-6) continue; // já é vértice
    const c = cap.get(h.edge) ?? 1;
    p = insertPieceVertex(p, h.edge, h.t / c);
    cap.set(h.edge, h.t);
  }
  const vs = vertices(p.outline);
  const indices = positions.map((pos) => {
    let best = 0;
    vs.forEach((v, i) => {
      if (dist(v, pos) < dist(vs[best]!, pos)) best = i;
    });
    return best;
  });
  return { piece: p, indices };
}

/** Cadeia de vértices de `from` até `to` (cíclica, inclusiva) e arestas entre eles. */
function chain(d: Decomposed, piece: Piece, tag: string, from: number, to: number, f: Fn = ID) {
  const n = d.verts.length;
  const verts: Vec2[] = [f(d.verts[from]!)];
  const edges: NewEdge[] = [];
  let k = from;
  while (k !== to) {
    edges.push({ data: mapEdge(d.edges[k]!, f), ...seamOf(piece, k), from: `${tag}:${k}` });
    k = (k + 1) % n;
    verts.push(f(d.verts[k]!));
  }
  return { verts, edges };
}

/** Arestas pertencentes a uma cadeia from→to (para saber o que foi transformado). */
function edgesInChain(n: number, from: number, to: number): Set<number> {
  const s = new Set<number>();
  for (let k = from; k !== to; k = (k + 1) % n) s.add(k);
  return s;
}

/** Inverte o sentido do contorno (preservando piques, pences e margens). */
export function reversePiece(piece: Piece): Piece {
  const d = decompose(piece.outline);
  const n = d.verts.length;
  const verts = [d.verts[0]!, ...d.verts.slice(1).reverse()];
  const edges = d.edges.map((_, j) => reverseEdge(d.edges[n - 1 - j]!));
  const seamByEdge: Record<string, number> = {};
  for (const [k, v] of Object.entries(piece.seamByEdge ?? {})) seamByEdge[String(n - 1 - Number(k))] = v;
  const hemByEdge: Record<string, true> = {};
  for (const k of Object.keys(piece.hemByEdge ?? {})) hemByEdge[String(n - 1 - Number(k))] = true;
  return {
    ...piece,
    outline: compose({ verts, edges, closed: true }),
    notches: piece.notches.map((x) => ({ ...x, edge: n - 1 - x.edge, t: 1 - x.t })),
    darts: piece.darts?.map((x) => ({ ...x, edge: n - 1 - x.edge })),
    seamByEdge: piece.seamByEdge ? seamByEdge : undefined,
    hemByEdge: piece.hemByEdge ? hemByEdge : undefined,
  };
}

/** Parâmetro t de uma aresta a uma distância (mm) ao longo dela. */
function paramAtLength(path: Path, edge: number, s: number): { t: number; total: number } {
  const N = 400;
  let acc = 0;
  let prev = pointOnEdge(path, edge, 0);
  const lens = [0];
  for (let k = 1; k <= N; k++) {
    const p = pointOnEdge(path, edge, k / N);
    acc += dist(prev, p);
    lens.push(acc);
    prev = p;
  }
  const target = Math.max(0, Math.min(acc, s));
  let k = lens.findIndex((l) => l >= target);
  if (k <= 0) return { t: 0, total: acc };
  const t0 = (k - 1) / N, t1 = k / N;
  const f = (target - lens[k - 1]!) / (lens[k]! - lens[k - 1]! || 1);
  return { t: t0 + (t1 - t0) * f, total: acc };
}

function lengthAtParam(path: Path, edge: number, t: number): number {
  const N = Math.max(8, Math.round(400 * t));
  let acc = 0;
  let prev = pointOnEdge(path, edge, 0);
  for (let k = 1; k <= N; k++) {
    const p = pointOnEdge(path, edge, (t * k) / N);
    acc += dist(prev, p);
    prev = p;
  }
  return acc;
}

/* ------------------------------------------------------------------ */
/* Pence                                                               */
/* ------------------------------------------------------------------ */

/**
 * Cria uma pence com boca centrada no ponto clicado da borda, largura `widthMm`, e ápice em `apex`.
 */
export function createDart(piece: Piece, at: EdgeHit, apex: Vec2, widthMm: number): Piece {
  if (widthMm <= 0) throw new Error('A largura da pence deve ser maior que zero');
  const s0 = lengthAtParam(piece.outline, at.edge, at.t);
  const { total } = paramAtLength(piece.outline, at.edge, 0);
  if (s0 - widthMm / 2 < 0.5 || s0 + widthMm / 2 > total - 0.5) throw new Error('A boca da pence ultrapassa a borda — afaste do canto ou diminua a largura');
  const t1 = paramAtLength(piece.outline, at.edge, s0 - widthMm / 2).t;
  const t2 = paramAtLength(piece.outline, at.edge, s0 + widthMm / 2).t;
  const { piece: p, indices } = insertPoints(piece, [{ edge: at.edge, t: t1 }, { edge: at.edge, t: t2 }]);
  const [i1, i2] = indices as [number, number];
  const n = vertices(p.outline).length;
  const mouth = (i1 + 1) % n === i2 ? i1 : i2;
  return { ...p, darts: [...(p.darts ?? []), { edge: mouth, apex }] };
}

/** Pernas e ângulo de uma pence. */
export function dartGeometry(piece: Piece, dart: Dart) {
  const vs = vertices(piece.outline);
  const a = vs[dart.edge]!;
  const b = vs[(dart.edge + 1) % vs.length]!;
  return { legA: a, legB: b, apex: dart.apex, width: dist(a, b), length: dist(dart.apex, lerp(a, b, 0.5)) };
}

/**
 * Transfere a pence para outro ponto do contorno (método do pivô): a parte do molde entre a pence
 * e o destino gira em torno do ápice até fechar a pence original, abrindo a nova no destino.
 */
export function transferDart(piece: Piece, dartIndex: number, target: EdgeHit): Piece {
  const dart0 = piece.darts?.[dartIndex];
  if (!dart0) throw new Error('Pence não encontrada');
  if (target.edge === dart0.edge) throw new Error('Escolha um ponto fora da boca da pence');
  const { piece: p, indices } = insertPoints(piece, [target]);
  const tIdx = indices[0]!;
  const dart = p.darts![dartIndex]!;
  const d = decompose(p.outline);
  const n = d.verts.length;
  const e = dart.edge;
  const P = d.verts[e]!, Q = d.verts[(e + 1) % n]!, A = dart.apex;
  if (tIdx === e || tIdx === (e + 1) % n) throw new Error('Escolha um ponto fora da boca da pence');
  const qa = sub(Q, A), pa = sub(P, A);
  const rot = rotateAbout(A, Math.atan2(cross(qa, pa), dot(qa, pa)));

  const verts: Vec2[] = [P];
  const edges: NewEdge[] = [];
  const rotated = edgesInChain(n, (e + 1) % n, tIdx);
  let k = (e + 1) % n;
  while (k !== tIdx) {
    edges.push({ data: mapEdge(d.edges[k]!, rot), ...seamOf(p, k), from: `A:${k}` });
    const nv = (k + 1) % n;
    if (nv !== tIdx) verts.push(rot(d.verts[nv]!));
    k = nv;
  }
  verts.push(rot(d.verts[tIdx]!));
  edges.push({ data: { kind: 'line' }, ...seamOf(p, tIdx), from: 'nova-pence' });
  verts.push(d.verts[tIdx]!);
  k = tIdx;
  while (k !== e) {
    edges.push({ data: d.edges[k]!, ...seamOf(p, k), from: `A:${k}` });
    const nv = (k + 1) % n;
    if (nv !== e) verts.push(d.verts[nv]!);
    k = nv;
  }
  const others = { ...p, darts: p.darts!.filter((_, i) => i !== dartIndex) };
  const carry = collect(others, 'A', { f: (edge) => (edge === e ? null : rotated.has(edge) ? rot : ID) });
  carry.darts.push({ from: 'nova-pence', apex: A });
  return build(p, verts, edges, carry);
}

/* ------------------------------------------------------------------ */
/* Cortar / dobrar                                                     */
/* ------------------------------------------------------------------ */

/** Corta o molde pela reta entre dois pontos do contorno. A borda nova recebe `seamMm` (padrão: sem margem). */
export function cutPiece(piece: Piece, a: EdgeHit, b: EdgeHit, seamMm = 0): [Piece, Piece] {
  const { piece: p, indices } = insertPoints(piece, [a, b]);
  const [ia, ib] = indices as [number, number];
  if (ia === ib) throw new Error('Os dois pontos do corte são iguais');
  const d = decompose(p.outline);
  const parts = [chain(d, p, 'A', ia, ib), chain(d, p, 'A', ib, ia)].map((c) => ({
    verts: c.verts,
    edges: [...c.edges, { data: { kind: 'line' } as EdgeData, seam: seamMm, from: 'corte' }],
    set: new Set(c.edges.map((x) => Number(x.from!.split(':')[1]))),
  }));
  const all = collect(p, 'A');
  const out = parts.map((part, idx) => {
    const poly = part.verts;
    const carry: Carry = {
      notches: all.notches,
      darts: all.darts.filter((x) => part.set.has(Number(x.from.split(':')[1]))),
      internals: p.internals.filter((path) => pointInPolygon(flattenPath(path)[0]!, poly) || pointInPolygon(centroid(flattenPath(path)), poly)),
      drills: (p.drills ?? []).filter((q) => pointInPolygon(q, poly)),
    };
    let grain = p.grainline;
    if (grain && !pointInPolygon(lerp(grain[0], grain[1], 0.5), poly)) {
      const c = centroid(poly);
      const half = scale(sub(grain[1], grain[0]), 0.25);
      grain = [sub(c, half), add(c, half)];
    }
    return build(p, part.verts, part.edges, carry, { id: `${p.id}-${idx ? 'b' : 'a'}`, name: `${p.name} ${idx ? 'B' : 'A'}`, grainline: grain });
  });
  return out as [Piece, Piece];
}

/** Dobra: corta pela linha de dobra e mantém a metade que contém `keep` (ou a maior). A dobra fica sem margem. */
export function foldPiece(piece: Piece, a: EdgeHit, b: EdgeHit, keep?: Vec2): Piece {
  const [p1, p2] = cutPiece(piece, a, b, 0);
  const area = (q: Piece) => Math.abs(signedArea(flattenPath(q.outline)));
  let chosen = area(p1) >= area(p2) ? p1 : p2;
  if (keep) chosen = pointInPolygon(keep, flattenPath(p1.outline)) ? p1 : pointInPolygon(keep, flattenPath(p2.outline)) ? p2 : chosen;
  return { ...chosen, id: piece.id, name: piece.name, notes: [piece.notes, 'Cortar na dobra do tecido.'].filter(Boolean).join(' ') };
}

/** Desdobra o molde espelhando-o pela borda reta indicada (ex.: centro frente na dobra → frente inteira). */
export function unfoldPiece(piece: Piece, edge: number): Piece {
  const d = decompose(piece.outline);
  const n = d.verts.length;
  if (d.edges[edge]?.kind !== 'line') {
    const c = d.edges[edge];
    // Aceita "curva" que na prática é reta (alças sobre a corda)
    const a = d.verts[edge]!, b = d.verts[(edge + 1) % n]!;
    const straight = c && c.kind === 'cubic' && Math.abs(cross(normalize(sub(b, a)), sub(c.c1, a))) < 0.05 && Math.abs(cross(normalize(sub(b, a)), sub(c.c2, a))) < 0.05;
    if (!straight) throw new Error('A linha de dobra precisa ser uma borda reta');
  }
  const A = d.verts[edge]!, B = d.verts[(edge + 1) % n]!;
  const m = mirrorAcross(A, B);
  const first = chain(d, piece, 'A', (edge + 1) % n, edge);
  const verts = [...first.verts];
  const edges = [...first.edges];
  // Lado espelhado: percorre ao contrário, de v(edge-1) até v(edge+2)
  for (let k = (edge - 1 + n) % n; k !== edge; k = (k - 1 + n) % n) {
    edges.push({ data: mapEdge(reverseEdge(d.edges[k]!), m), ...seamOf(piece, k), from: `M:${k}` });
    if (k !== (edge + 1) % n) verts.push(m(d.verts[k]!));
  }
  const carry = merge(collect(piece, 'A', { f: (e) => (e === edge ? null : ID) }), collect(piece, 'M', { f: (e) => (e === edge ? null : m), internals: m }));
  const grain = piece.grainline;
  return build(piece, verts, edges, carry, {
    grainline: grain,
    seamByEdge: undefined,
    notes: [piece.notes?.replace(/na dobra[^.]*\.?/gi, '').trim(), 'Molde desdobrado (inteiro).'].filter(Boolean).join(' '),
  });
}

/* ------------------------------------------------------------------ */
/* Unir                                                                */
/* ------------------------------------------------------------------ */

/**
 * Une dois moldes pela costura: a borda `eb` do molde B é encaixada sobre a borda `ea` do molde A
 * (B é girado e movido) e as duas bordas desaparecem. Retorna o molde unido e a diferença de comprimento.
 */
export function joinPieces(pa: Piece, ea: number, pb0: Piece, eb0: number): { piece: Piece; diffMm: number } {
  const sa = Math.sign(signedArea(flattenPath(pa.outline)));
  let pb = pb0;
  let eb = eb0;
  const nb0 = vertices(pb0.outline).length;
  if (Math.sign(signedArea(flattenPath(pb0.outline))) !== sa) {
    pb = reversePiece(pb0);
    eb = nb0 - 1 - eb0;
  }
  const da0 = decompose(pa.outline);
  const db0 = decompose(pb.outline);
  const nA = da0.verts.length, nB = db0.verts.length;
  const a0 = da0.verts[ea]!, a1 = da0.verts[(ea + 1) % nA]!;
  const b0 = db0.verts[eb]!, b1 = db0.verts[(eb + 1) % nB]!;
  const ang = Math.atan2(a1.y - a0.y, a1.x - a0.x) - Math.atan2(b0.y - b1.y, b0.x - b1.x);
  const r = rotateAbout({ x: 0, y: 0 }, ang);
  const rb1 = r(b1);
  const f: Fn = (p) => add(r(p), sub(a0, rb1));
  const pbT = mapPiece(pb, f);
  const db = decompose(pbT.outline);
  const diffMm = Math.abs(dist(a0, a1) - dist(b0, b1));

  const verts: Vec2[] = [];
  const edges: NewEdge[] = [];
  for (let i = 0; i < nA; i++) verts.push(da0.verts[(ea + 1 + i) % nA]!);
  for (let i = 0; i < nA - 1; i++) {
    const k = (ea + 1 + i) % nA;
    edges.push({ data: da0.edges[k]!, ...seamOf(pa, k), from: `A:${k}` });
  }
  for (let i = 0; i < nB - 2; i++) verts.push(db.verts[(eb + 2 + i) % nB]!);
  for (let i = 0; i < nB - 1; i++) {
    const k = (eb + 1 + i) % nB;
    edges.push({ data: db.edges[k]!, ...seamOf(pbT, k), from: `B:${k}` });
  }
  const carry = merge(collect(pa, 'A', { f: (e) => (e === ea ? null : ID) }), collect(pbT, 'B', { f: (e) => (e === eb ? null : ID) }));
  return { piece: build(pa, verts, edges, carry, { name: `${pa.name} + ${pb0.name}` }), diffMm };
}

/* ------------------------------------------------------------------ */
/* Prega e folgas                                                      */
/* ------------------------------------------------------------------ */

/**
 * Abre o molde pela reta a→b e afasta um dos lados `amountMm` (folga paralela).
 * Com `pleat`, marca a prega (piques e linhas de dobra/colocação).
 */
export function spreadParallel(piece: Piece, a: EdgeHit, b: EdgeHit, amountMm: number, pleat = false): Piece {
  const { piece: p, indices } = insertPoints(piece, [a, b]);
  const [ia, ib] = indices as [number, number];
  const d = decompose(p.outline);
  const n = d.verts.length;
  const A = d.verts[ia]!, B = d.verts[ib]!;
  const sideB = chain(d, p, 'A', ib, ia).verts;
  const u = normalize(sub(B, A));
  let nrm = { x: -u.y, y: u.x };
  if (dot(sub(centroid(sideB), A), nrm) < 0) nrm = scale(nrm, -1);
  const move = translateBy(scale(nrm, amountMm));
  const partA = chain(d, p, 'A', ia, ib);
  const partB = chain(d, p, 'A', ib, ia, move);
  const verts = [...partA.verts, ...partB.verts];
  const edges: NewEdge[] = [
    ...partA.edges,
    { data: { kind: 'line' }, ...seamOf(p, ib), from: 'ponte-b' },
    ...partB.edges,
    { data: { kind: 'line' }, seam: edgeSeam(p, (ia - 1 + n) % n), from: 'ponte-a' },
  ];
  const bSet = edgesInChain(n, ib, ia);
  const polyB = flattenPath(compose({ verts: chain(d, p, 'A', ib, ia).verts, edges: [...chain(d, p, 'A', ib, ia).edges.map((x) => x.data), { kind: 'line' }], closed: true }));
  const carry = collect(p, 'A', { f: (e) => (bSet.has(e) ? move : ID), internals: null });
  carry.internals = p.internals.map((path) => (pointInPolygon(flattenPath(path)[0]!, polyB) ? mapPath(path, move) : path));
  carry.drills = (p.drills ?? []).map((q) => (pointInPolygon(q, polyB) ? move(q) : q));
  if (pleat) {
    carry.notches.push({ p: A, depth: 5 }, { p: B, depth: 5 }, { p: move(A), depth: 5 }, { p: move(B), depth: 5 });
    carry.internals.push(
      { start: A, segments: [{ kind: 'line', to: B }], closed: false },
      { start: move(A), segments: [{ kind: 'line', to: move(B) }], closed: false },
    );
  }
  return build(p, verts, edges, carry);
}

/**
 * Abre folga em leque: corta de `open` até o pivô `pivot` (na outra borda) e gira um dos lados
 * em torno do pivô até abrir `amountMm` na borda de `open`.
 */
export function spreadRadial(piece: Piece, open: EdgeHit, pivot: EdgeHit, amountMm: number): Piece {
  const { piece: p, indices } = insertPoints(piece, [open, pivot]);
  const [ia, ib] = indices as [number, number];
  const d = decompose(p.outline);
  const n = d.verts.length;
  const O = d.verts[ia]!, V = d.verts[ib]!;
  const R = dist(O, V);
  if (amountMm >= 2 * R) throw new Error('Abertura maior que o comprimento do corte');
  const theta = 2 * Math.asin(amountMm / (2 * R));
  const sideB = chain(d, p, 'A', ib, ia).verts;
  const u = normalize(sub(V, O));
  let nrm = { x: -u.y, y: u.x };
  if (dot(sub(centroid(sideB), O), nrm) < 0) nrm = scale(nrm, -1);
  const rot = dot(sub(rotateAbout(V, theta)(O), O), nrm) > 0 ? rotateAbout(V, theta) : rotateAbout(V, -theta);
  const partA = chain(d, p, 'A', ia, ib);
  const partB = chain(d, p, 'A', ib, ia, rot);
  const verts = [...partA.verts, ...partB.verts.slice(1)];
  const edges: NewEdge[] = [...partA.edges, ...partB.edges, { data: { kind: 'line' }, seam: edgeSeam(p, (ia - 1 + n) % n), from: 'ponte' }];
  const bSet = edgesInChain(n, ib, ia);
  const carry = collect(p, 'A', { f: (e) => (bSet.has(e) ? rot : ID) });
  return build(p, verts, edges, carry);
}

/* ------------------------------------------------------------------ */
/* Curvas                                                              */
/* ------------------------------------------------------------------ */

export interface CurvePoint {
  p: Vec2;
  /** Ponto de canto (quebra a curva). */
  corner?: boolean;
}

/** Caminho que passa EXATAMENTE pelos pontos (ferramenta Curvatura). */
export function pathThroughPoints(pts: CurvePoint[], closed: boolean): Path {
  const n = pts.length;
  if (n < 2) throw new Error('A curva precisa de pelo menos 2 pontos');
  const get = (i: number) => pts[((i % n) + n) % n]!;
  const tan = (i: number): Vec2 | null => {
    const c = get(i);
    if (c.corner) return null;
    if (!closed && (i === 0 || i === n - 1)) return null;
    return normalize(sub(get(i + 1).p, get(i - 1).p));
  };
  const spans = closed ? n : n - 1;
  const d: Decomposed = { verts: pts.map((q) => q.p), edges: [], closed };
  for (let i = 0; i < spans; i++) {
    const a = get(i).p, b = get(i + 1).p;
    const ta = tan(i), tb = tan(i + 1);
    if (!ta && !tb) {
      d.edges.push({ kind: 'line' });
      continue;
    }
    const L = dist(a, b) / 3;
    d.edges.push({
      kind: 'cubic',
      c1: ta ? add(a, scale(ta, L)) : lerp(a, b, 1 / 3),
      c2: tb ? sub(b, scale(tb, L)) : lerp(a, b, 2 / 3),
    });
  }
  if (!closed) {
    const segments = d.edges.map((e, i) => (e.kind === 'line' ? { kind: 'line' as const, to: d.verts[i + 1]! } : { kind: 'cubic' as const, c1: e.c1, c2: e.c2, to: d.verts[i + 1]! }));
    return { start: d.verts[0]!, segments, closed: false };
  }
  return compose(d);
}

function adjacent(d: Decomposed, i: number) {
  const n = d.verts.length;
  return { inc: d.closed ? (i - 1 + n) % n : i - 1, out: i < d.edges.length ? i : -1, n };
}

/** O ponto é suave (alças alinhadas dos dois lados)? */
export function isSmoothVertex(path: Path, i: number): boolean {
  const d = decompose(path);
  const { inc, out } = adjacent(d, i);
  const ei = d.edges[inc], eo = d.edges[out];
  if (inc < 0 || out < 0 || ei?.kind !== 'cubic' || eo?.kind !== 'cubic') return false;
  const v = d.verts[i]!;
  const h1 = sub(v, ei.c2), h2 = sub(eo.c1, v);
  if (Math.hypot(h1.x, h1.y) < 1e-6 || Math.hypot(h2.x, h2.y) < 1e-6) return false;
  return Math.abs(cross(normalize(h1), normalize(h2))) < 0.02 && dot(h1, h2) > 0;
}

/**
 * Converter ponto (como no Illustrator):
 *  - 'smooth': transforma o canto em ponto de curva com alças alinhadas;
 *  - 'corner': recolhe as alças (canto vivo);
 *  - handle informado: puxa alças simétricas até `handle` (arrastar com a ferramenta).
 */
export function convertVertex(path: Path, i: number, mode: 'smooth' | 'corner' | 'toggle', handle?: Vec2): Path {
  const d = decompose(path);
  const { inc, out, n } = adjacent(d, i);
  const v = d.verts[i]!;
  const prev = inc >= 0 ? d.verts[inc]! : null;
  const next = out >= 0 ? d.verts[(i + 1) % n]! : null;
  const asCubic = (k: number, a: Vec2, b: Vec2): { kind: 'cubic'; c1: Vec2; c2: Vec2 } => {
    const e = d.edges[k]!;
    return e.kind === 'cubic' ? { ...e } : { kind: 'cubic', c1: lerp(a, b, 1 / 3), c2: lerp(a, b, 2 / 3) };
  };
  const m = mode === 'toggle' ? (isSmoothVertex(path, i) ? 'corner' : 'smooth') : mode;
  if (m === 'smooth' || handle) {
    let dir: Vec2;
    let lenOut: number, lenIn: number;
    if (handle) {
      dir = normalize(sub(handle, v));
      lenOut = lenIn = dist(handle, v);
    } else {
      dir = normalize(sub(next ?? v, prev ?? v));
      lenOut = next ? dist(v, next) / 3 : 0;
      lenIn = prev ? dist(v, prev) / 3 : 0;
    }
    if (inc >= 0 && prev) {
      const e = asCubic(inc, prev, v);
      e.c2 = sub(v, scale(dir, lenIn));
      d.edges[inc] = e;
    }
    if (out >= 0 && next) {
      const e = asCubic(out, v, next);
      e.c1 = add(v, scale(dir, lenOut));
      d.edges[out] = e;
    }
  } else {
    for (const [k, which, a, b] of [[inc, 'c2', prev, v], [out, 'c1', v, next]] as const) {
      if (k < 0 || !a || !b) continue;
      const e = d.edges[k]!;
      if (e.kind !== 'cubic') continue;
      const ne = { ...e, [which]: { ...v } };
      // Se a outra alça também está sobre a corda, vira reta.
      const other = which === 'c2' ? ne.c1 : ne.c2;
      const onChord = Math.abs(cross(normalize(sub(b, a)), sub(other, a))) < 0.01;
      d.edges[k] = onChord ? { kind: 'line' } : ne;
    }
  }
  if (!d.closed) {
    const segments = d.edges.map((e, k) => (e.kind === 'line' ? { kind: 'line' as const, to: d.verts[k + 1]! } : { kind: 'cubic' as const, c1: e.c1, c2: e.c2, to: d.verts[k + 1]! }));
    return { start: d.verts[0]!, segments, closed: false };
  }
  return compose(d);
}

/**
 * Move a alça de um ponto suave mantendo a alça oposta alinhada (comprimento preservado).
 * `free` = quebra o alinhamento (Alt no Illustrator).
 */
export function moveHandleSmooth(path: Path, edge: number, which: 'c1' | 'c2', p: Vec2, free = false): Path {
  const d = decompose(path);
  const e = d.edges[edge];
  if (e?.kind !== 'cubic') return path;
  const n = d.verts.length;
  const vi = which === 'c1' ? edge : (edge + 1) % n;
  const smooth = !free && isSmoothVertex(path, vi);
  d.edges[edge] = { ...e, [which]: p };
  if (smooth) {
    const v = d.verts[vi]!;
    const dir = normalize(sub(v, p));
    if (which === 'c1') {
      const k = (edge - 1 + n) % n;
      const o = d.edges[k] as { kind: 'cubic'; c1: Vec2; c2: Vec2 };
      if (k !== edge) d.edges[k] = { ...o, c2: add(v, scale(dir, dist(o.c2, v))) };
    } else {
      const k = (edge + 1) % n;
      const o = d.edges[k] as { kind: 'cubic'; c1: Vec2; c2: Vec2 };
      if (k !== edge) d.edges[k] = { ...o, c1: add(v, scale(dir, dist(o.c1, v))) };
    }
  }
  return compose(d);
}

/** Bounding box útil para pré-visualizações. */
export function pieceCenter(piece: Piece): Vec2 {
  const bb = bboxOfPoints(flattenPath(piece.outline));
  return { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
}
