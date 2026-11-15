/**
 * CONSTRUÇÃO DE MOLDES (fluxo do papel / Audaces): primeiro se risca a construção — pontos,
 * retas e curvas soltas — e depois se EXTRAI o molde clicando dentro de uma área fechada.
 *
 * A extração monta um grafo plano com todas as linhas (cortadas nos cruzamentos), tira as pontas
 * soltas (linhas guia que não fecham nada), percorre as faces e devolve a face que contém o clique,
 * com as curvas preservadas (nada vira polilinha).
 */
import { type Path, type Vec2, dist, flattenPath, signedArea, sub } from './geometry.js';
import { compose, evalCubic, splitCubic } from './edit.js';

export interface CPoint {
  id: string;
  p: Vec2;
}

export interface CLine {
  id: string;
  /** Reta ou curva aberta. */
  path: Path;
  /** Curva: pontos por onde ela passa (para editar depois). */
  through?: Vec2[];
}

export interface Construction {
  points: CPoint[];
  lines: CLine[];
}

export const emptyConstruction = (): Construction => ({ points: [], lines: [] });

/* ------------------------------------------------------------------ */
/* Primitivas (reta / cúbica)                                          */
/* ------------------------------------------------------------------ */

type Prim = { kind: 'line'; a: Vec2; b: Vec2 } | { kind: 'cubic'; a: Vec2; c1: Vec2; c2: Vec2; b: Vec2 };

function primsOf(path: Path): Prim[] {
  const out: Prim[] = [];
  let cur = path.start;
  for (const s of path.segments) {
    if (s.kind === 'line') out.push({ kind: 'line', a: cur, b: s.to });
    else out.push({ kind: 'cubic', a: cur, c1: s.c1, c2: s.c2, b: s.to });
    cur = s.to;
  }
  if (path.closed && dist(cur, path.start) > 1e-9) out.push({ kind: 'line', a: cur, b: path.start });
  return out.filter((p) => dist(p.a, p.b) > 1e-9 || p.kind === 'cubic');
}

const at = (p: Prim, t: number): Vec2 => (p.kind === 'line' ? { x: p.a.x + (p.b.x - p.a.x) * t, y: p.a.y + (p.b.y - p.a.y) * t } : evalCubic(p.a, p.c1, p.c2, p.b, t));

/** Amostras (ponto + parâmetro) para achar cruzamentos. */
function samples(p: Prim): { q: Vec2; t: number }[] {
  if (p.kind === 'line') return [{ q: p.a, t: 0 }, { q: p.b, t: 1 }];
  const n = 96;
  return Array.from({ length: n + 1 }, (_, i) => ({ q: at(p, i / n), t: i / n }));
}

/** Pedaço da primitiva entre t0 e t1 (exato, a cúbica é cortada com de Casteljau). */
function sub01(p: Prim, t0: number, t1: number): Prim {
  if (p.kind === 'line') return { kind: 'line', a: at(p, t0), b: at(p, t1) };
  const [, right] = splitCubic(p.a, p.c1, p.c2, p.b, t0);
  const u = t0 >= 1 ? 1 : (t1 - t0) / (1 - t0);
  const [left] = splitCubic(right[0], right[1], right[2], right[3], Math.min(1, Math.max(0, u)));
  return { kind: 'cubic', a: left[0], c1: left[1], c2: left[2], b: left[3] };
}

const reversePrim = (p: Prim): Prim => (p.kind === 'line' ? { kind: 'line', a: p.b, b: p.a } : { kind: 'cubic', a: p.b, c1: p.c2, c2: p.c1, b: p.a });

/** Direção de saída (tangente) da primitiva no início. */
function startDir(p: Prim): Vec2 {
  const d = p.kind === 'line' ? sub(p.b, p.a) : dist(p.c1, p.a) > 1e-9 ? sub(p.c1, p.a) : dist(p.c2, p.a) > 1e-9 ? sub(p.c2, p.a) : sub(p.b, p.a);
  const l = Math.hypot(d.x, d.y) || 1;
  return { x: d.x / l, y: d.y / l };
}

/* ------------------------------------------------------------------ */
/* Grafo plano                                                         */
/* ------------------------------------------------------------------ */

const TOL = 0.05; // mm: pontas a menos disso são o mesmo nó

interface Edge {
  prim: Prim;
  u: number;
  v: number;
}

/** Corta todas as primitivas nos cruzamentos e devolve nós + arestas. */
function planarGraph(paths: Path[]): { nodes: Vec2[]; edges: Edge[] } {
  const prims = paths.flatMap(primsOf);
  const cuts: number[][] = prims.map(() => [0, 1]);
  const S = prims.map(samples);
  for (let i = 0; i < prims.length; i++) {
    for (let j = i + 1; j < prims.length; j++) {
      const A = S[i]!, B = S[j]!;
      for (let a = 0; a + 1 < A.length; a++) {
        const p = A[a]!.q, p2 = A[a + 1]!.q;
        const r = sub(p2, p);
        for (let b = 0; b + 1 < B.length; b++) {
          const q = B[b]!.q, q2 = B[b + 1]!.q;
          const s = sub(q2, q);
          const den = r.x * s.y - r.y * s.x;
          const w = sub(q, p);
          if (Math.abs(den) < 1e-12) continue;
          const ta = (w.x * s.y - w.y * s.x) / den;
          const tb = (w.x * r.y - w.y * r.x) / den;
          const lr = Math.hypot(r.x, r.y), ls = Math.hypot(s.x, s.y);
          const ea = TOL / (lr || 1), eb = TOL / (ls || 1);
          if (ta < -ea || ta > 1 + ea || tb < -eb || tb > 1 + eb) continue;
          const ca = Math.min(1, Math.max(0, ta)), cb = Math.min(1, Math.max(0, tb));
          cuts[i]!.push(A[a]!.t + (A[a + 1]!.t - A[a]!.t) * ca);
          cuts[j]!.push(B[b]!.t + (B[b + 1]!.t - B[b]!.t) * cb);
        }
      }
    }
  }
  const nodes: Vec2[] = [];
  const nodeOf = (q: Vec2) => {
    const k = nodes.findIndex((n) => dist(n, q) <= TOL);
    if (k >= 0) return k;
    nodes.push(q);
    return nodes.length - 1;
  };
  const edges: Edge[] = [];
  prims.forEach((p, i) => {
    const ts = [...new Set(cuts[i]!.map((t) => Math.round(t * 1e6) / 1e6))].sort((x, y) => x - y);
    const clean = ts.filter((t, k) => k === 0 || t - ts[k - 1]! > 1e-5);
    for (let k = 0; k + 1 < clean.length; k++) {
      const piece = sub01(p, clean[k]!, clean[k + 1]!);
      if (dist(piece.a, piece.b) <= TOL && piece.kind === 'line') continue;
      const u = nodeOf(piece.a), v = nodeOf(piece.b);
      if (u === v && piece.kind === 'line') continue;
      edges.push({ prim: { ...piece, a: nodes[u]!, b: nodes[v]! } as Prim, u, v });
    }
  });
  return { nodes, edges };
}

/** Tira as pontas soltas (nós com uma aresta só), repetindo até não sobrar nenhuma. */
function prune(edges: Edge[], nNodes: number): Edge[] {
  let es = edges;
  for (;;) {
    const deg = new Array<number>(nNodes).fill(0);
    for (const e of es) {
      deg[e.u]!++;
      deg[e.v]!++;
    }
    const next = es.filter((e) => deg[e.u]! > 1 && deg[e.v]! > 1);
    if (next.length === es.length) return es;
    es = next;
  }
}

function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}

/**
 * Contorno fechado (com as curvas) da área fechada pelas linhas que contém `inside`. Com vários
 * pontos, junta as áreas vizinhas num molde só (como clicar em cada parte no Audaces): as linhas
 * entre elas somem. null se algum ponto não estiver dentro de uma área fechada.
 */
export function extractRegion(paths: Path[], inside: Vec2 | Vec2[]): Path | null {
  const insides = Array.isArray(inside) ? inside : [inside];
  const { nodes, edges: all } = planarGraph(paths);
  const edges = prune(all, nodes.length);
  if (!edges.length || !insides.length) return null;
  interface Half {
    e: number;
    fwd: boolean;
    from: number;
    to: number;
    ang: number;
    prim: Prim;
  }
  const halves: Half[] = [];
  edges.forEach((e, i) => {
    const f = e.prim, r = reversePrim(e.prim);
    const df = startDir(f), dr = startDir(r);
    halves.push({ e: i, fwd: true, from: e.u, to: e.v, ang: Math.atan2(df.y, df.x), prim: f });
    halves.push({ e: i, fwd: false, from: e.v, to: e.u, ang: Math.atan2(dr.y, dr.x), prim: r });
  });
  const twin = (k: number) => (halves[k]!.fwd ? k + 1 : k - 1);
  /** No nó de chegada, a meia-aresta que vira menos (a partir da volta), entre as permitidas. */
  const turn = (k: number, allowed: (c: number) => boolean): number => {
    const h = halves[k]!;
    const back = halves[twin(k)]!;
    let best = -1, bestA = Infinity;
    for (let c = 0; c < halves.length; c++) {
      if (halves[c]!.from !== h.to || c === twin(k) || !allowed(c)) continue;
      let a = halves[c]!.ang - back.ang;
      while (a <= 1e-9) a += 2 * Math.PI;
      if (a < bestA) [best, bestA] = [c, a];
    }
    return best;
  };
  // todas as faces
  const faceOf = new Array<number>(halves.length).fill(-1);
  const faces: { loop: number[]; poly: Vec2[]; area: number }[] = [];
  for (let k0 = 0; k0 < halves.length; k0++) {
    if (faceOf[k0]! >= 0) continue;
    const loop: number[] = [];
    let k = k0;
    for (let guard = 0; guard <= halves.length && k >= 0 && faceOf[k]! < 0; guard++) {
      faceOf[k] = faces.length;
      loop.push(k);
      k = turn(k, () => true);
    }
    const poly = loop.flatMap((h) => flattenPath(primPath(halves[h]!.prim), 0.1).slice(0, -1));
    faces.push({ loop, poly, area: signedArea(poly) });
  }
  // a face de cada clique: a menor que contém o ponto (a externa contém tudo, mas é maior)
  const chosen = new Set<number>();
  for (const q of insides) {
    let bi = -1;
    faces.forEach((f, i) => {
      if (f.loop.length >= 2 && pointInPoly(q, f.poly) && (bi < 0 || Math.abs(f.area) < Math.abs(faces[bi]!.area))) bi = i;
    });
    if (bi < 0) return null;
    chosen.add(bi);
  }
  // borda da união: meias-arestas das faces escolhidas cuja gêmea não está nelas
  const inSel = (k: number) => chosen.has(faceOf[k]!);
  const border = (k: number) => inSel(k) && !inSel(twin(k));
  const start = halves.findIndex((_, k) => border(k));
  if (start < 0) return null;
  const loop: number[] = [];
  let k = start;
  for (let guard = 0; guard <= halves.length; guard++) {
    loop.push(k);
    k = turn(k, border);
    if (k < 0) return null;
    if (k === start) break;
  }
  return mergeCollinear(loop.map((h) => halves[h]!.prim));
}

function primPath(p: Prim): Path {
  return p.kind === 'line'
    ? { start: p.a, segments: [{ kind: 'line', to: p.b }], closed: false }
    : { start: p.a, segments: [{ kind: 'cubic', c1: p.c1, c2: p.c2, to: p.b }], closed: false };
}

/** Junta retas seguidas na mesma direção (o ponto do meio era só um cruzamento). */
function mergeCollinear(prims: Prim[]): Path {
  const ps = [...prims];
  const collinear = (a: Prim, b: Prim) => {
    if (a.kind !== 'line' || b.kind !== 'line') return false;
    const d1 = startDir(a), d2 = startDir(b);
    return Math.abs(d1.x * d2.y - d1.y * d2.x) < 1e-6 && d1.x * d2.x + d1.y * d2.y > 0;
  };
  for (let i = 0; ps.length > 3 && i < ps.length; ) {
    const j = (i + 1) % ps.length;
    if (collinear(ps[i]!, ps[j]!)) {
      const merged: Prim = { kind: 'line', a: ps[i]!.a, b: ps[j]!.b };
      if (j === 0) {
        ps.pop();
        ps[0] = merged;
        i = 0;
      } else ps.splice(i, 2, merged);
    } else i++;
  }
  const verts = ps.map((p) => p.a);
  const edges = ps.map((p) => (p.kind === 'line' ? ({ kind: 'line' } as const) : ({ kind: 'cubic', c1: p.c1, c2: p.c2 } as const)));
  let path = compose({ verts, edges, closed: true });
  // sentido anti-horário (como os outros moldes)
  if (signedArea(flattenPath(path)) < 0) {
    const rv = [...ps].reverse().map(reversePrim);
    path = compose({ verts: rv.map((p) => p.a), edges: rv.map((p) => (p.kind === 'line' ? ({ kind: 'line' } as const) : ({ kind: 'cubic', c1: p.c1, c2: p.c2 } as const))), closed: true });
  }
  return path;
}

/** Comprimento de uma linha de construção (perímetro). */
export function pathLengthOf(path: Path): number {
  const pts = flattenPath(path, 0.02);
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1]!, pts[i]!);
  return L;
}
