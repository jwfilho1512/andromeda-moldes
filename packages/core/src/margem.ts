/**
 * MARGEM DE COSTURA para dentro ou para fora.
 *  - para fora (padrão): a linha desenhada é a costura; a margem cresce para fora.
 *  - para dentro: a linha desenhada vira o CORTE; a costura entra a margem.
 *  - remover mantendo o corte: a linha de corte vira o contorno (sem margem).
 *
 * Mover uma borda paralela: cada canto vai para o cruzamento das bordas vizinhas (já movidas ou
 * não), seguindo a direção delas no canto — exato em retas; nas curvas, as alças acompanham.
 */
import { type Vec2, add, cross, dist, flattenPath, scale, signedArea, sub } from './geometry.js';
import { compose, decompose, tangentOnEdge } from './edit.js';
import { type Piece, edgeSeam } from './pattern.js';

/** Move bordas paralelas para dentro do molde (mm por aresta; negativo = para fora). */
export function shiftEdges(piece: Piece, shifts: Map<number, number>): Piece {
  const d = decompose(piece.outline);
  const n = d.verts.length;
  const ccw = signedArea(flattenPath(piece.outline)) > 0;
  const inward = (t: Vec2): Vec2 => (ccw ? { x: -t.y, y: t.x } : { x: t.y, y: -t.x });
  const sh = (e: number) => shifts.get(e) ?? 0;
  const verts = d.verts.map((v, i) => {
    const prev = (i - 1 + n) % n, next = i;
    const sp = sh(prev), sn = sh(next);
    if (!sp && !sn) return v;
    const tA = tangentOnEdge(piece.outline, prev, 1);
    const tB = tangentOnEdge(piece.outline, next, 0);
    const pA = add(v, scale(inward(tA), sp));
    const pB = add(v, scale(inward(tB), sn));
    const den = cross(tA, tB);
    if (Math.abs(den) < 1e-6) {
      // canto suave (bordas na mesma direção): anda pela normal
      return add(v, scale(inward(tB), (sp + sn) / (sp && sn ? 2 : 1)));
    }
    const s = cross(sub(pB, pA), tB) / den;
    const q = add(pA, scale(tA, s));
    // canto muito agudo: não deixa o ponto fugir
    const lim = 10 * Math.max(Math.abs(sp), Math.abs(sn));
    return dist(q, v) > lim ? add(v, scale(inward(tB), sn || sp)) : q;
  });
  const edges = d.edges.map((e, i) => {
    if (e.kind === 'line') return e;
    const a = sub(verts[i]!, d.verts[i]!), b = sub(verts[(i + 1) % n]!, d.verts[(i + 1) % n]!);
    return { kind: 'cubic' as const, c1: add(e.c1, a), c2: add(e.c2, b) };
  });
  return { ...piece, outline: compose({ verts, edges, closed: true }) };
}

/** Margem `mm` nas bordas, para fora (contorno = costura) ou para dentro (contorno = corte). */
export function applySeam(piece: Piece, edges: number[], mm: number, dir: 'fora' | 'dentro'): Piece {
  if (!(mm >= 0)) throw new Error('A margem não pode ser negativa');
  let p = piece;
  if (dir === 'dentro' && mm > 0) {
    // o contorno desenhado vira a linha de corte: a costura entra a margem inteira
    p = shiftEdges(piece, new Map(edges.map((e) => [e, mm])));
  }
  const seamByEdge = { ...(p.seamByEdge ?? {}) };
  for (const e of edges) seamByEdge[String(e)] = mm;
  return { ...p, seamByEdge };
}

/** Tira a margem das bordas; `keepCut` = a linha de corte vira o contorno (o molde não encolhe). */
export function removeSeam(piece: Piece, edges: number[], keepCut: boolean): Piece {
  const p = keepCut ? shiftEdges(piece, new Map(edges.map((e) => [e, -edgeSeam(piece, e)]))) : piece;
  const seamByEdge = { ...(p.seamByEdge ?? {}) };
  const hemByEdge = { ...(p.hemByEdge ?? {}) };
  for (const e of edges) {
    seamByEdge[String(e)] = 0;
    delete hemByEdge[String(e)];
  }
  return { ...p, seamByEdge, hemByEdge: Object.keys(hemByEdge).length ? hemByEdge : undefined };
}

export const allEdges = (piece: Piece): number[] => decompose(piece.outline).edges.map((_, i) => i);
