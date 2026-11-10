/**
 * PRECISÃO E DESENHO: pontos notáveis (meio, interseção, perpendicular), paralelo,
 * comprimento exato de curva, piques e pontos por medida, organização de moldes.
 */
import { type Path, type Vec2, add, bboxOfPoints, cross, dist, flattenPath, normalize, scale, sub, offsetPolygon } from './geometry.js';
import { compose, decompose, edgeControls, edgeLength, insertPieceVertex, pointOnEdge, setEdgeLength, translatePiece } from './edit.js';
import { cutLine, type Piece } from './pattern.js';
import { insertPoints } from './modelagem.js';

/* ------------------------------------------------------------------ */
/* Medida ao longo da borda                                            */
/* ------------------------------------------------------------------ */

/** Tabela (t → comprimento acumulado) de uma aresta, para converter distância em parâmetro. */
function edgeTable(path: Path, edge: number, n = 400): { ts: number[]; ls: number[]; total: number } {
  const ts = [0], ls = [0];
  let prev = pointOnEdge(path, edge, 0);
  let acc = 0;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const p = pointOnEdge(path, edge, t);
    acc += dist(prev, p);
    ts.push(t);
    ls.push(acc);
    prev = p;
  }
  return { ts, ls, total: acc };
}

/** Parâmetro t da aresta a `s` mm do início dela. */
export function paramAtDistance(path: Path, edge: number, s: number): number {
  const { ts, ls, total } = edgeTable(path, edge);
  const target = Math.max(0, Math.min(total, s));
  let k = ls.findIndex((l) => l >= target);
  if (k <= 0) return 0;
  const f = (target - ls[k - 1]!) / (ls[k]! - ls[k - 1]! || 1);
  return ts[k - 1]! + (ts[k]! - ts[k - 1]!) * f;
}

/** Ponto no meio (pelo comprimento, não pelo parâmetro) de uma aresta. */
export function edgeMidpoint(path: Path, edge: number): Vec2 {
  const L = edgeLength(path, edge);
  return pointOnEdge(path, edge, paramAtDistance(path, edge, L / 2));
}

/* ------------------------------------------------------------------ */
/* Interseções e perpendicular                                         */
/* ------------------------------------------------------------------ */

/** Interseção de dois segmentos (ou null). */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return add(a, scale(r, t));
}

/** Pé da perpendicular de `p` sobre o segmento a–b (dentro do segmento) ou null. */
export function perpendicularFoot(p: Vec2, a: Vec2, b: Vec2): Vec2 | null {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y;
  if (l2 < 1e-12) return null;
  const t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2;
  if (t < 0 || t > 1) return null;
  return add(a, scale(ab, t));
}

/* ------------------------------------------------------------------ */
/* Paralelo                                                            */
/* ------------------------------------------------------------------ */

/** Polilinha aberta deslocada `d` mm (positivo = à esquerda do sentido), com juntas em quina. */
export function offsetOpenPolyline(pts: Vec2[], d: number): Vec2[] {
  const n = pts.length;
  if (n < 2) return pts;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)]!, cur = pts[i]!, next = pts[Math.min(n - 1, i + 1)]!;
    const t0 = normalize(sub(cur, prev)), t1 = normalize(sub(next, cur));
    const n0 = { x: -t0.y, y: t0.x }, n1 = { x: -t1.y, y: t1.x };
    if (i === 0) {
      out.push(add(cur, scale(n1, d)));
      continue;
    }
    if (i === n - 1) {
      out.push(add(cur, scale(n0, d)));
      continue;
    }
    const nb = normalize(add(n0, n1));
    const cosHalf = nb.x * n0.x + nb.y * n0.y;
    out.push(add(cur, scale(nb, d / Math.max(0.25, cosHalf))));
  }
  return out;
}

/** Remove pontos quase alinhados (a polilinha densa de curva vira poucos pontos). */
export function simplifyPolyline(pts: Vec2[], tol = 0.05): Vec2[] {
  if (pts.length < 3) return pts;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, wd = tol;
    for (let i = a + 1; i < b; i++) {
      const ab = sub(pts[b]!, pts[a]!);
      const l = Math.hypot(ab.x, ab.y) || 1;
      const dd = Math.abs(cross(ab, sub(pts[i]!, pts[a]!))) / l;
      if (dd > wd) {
        wd = dd;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = true;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Linha paralela a uma aresta do contorno, para o lado de `towards` (ex.: posição do mouse). */
export function parallelToEdge(path: Path, edge: number, distanceMm: number, towards: Vec2): Path {
  const c = edgeControls(path, edge);
  const pts = flattenPath({ start: c.p0, segments: [c.kind === 'line' ? { kind: 'line', to: c.p3 } : { kind: 'cubic', c1: c.c1, c2: c.c2, to: c.p3 }], closed: false }, 0.01);
  return parallelToPolyline(pts, distanceMm, towards);
}

/** Linha paralela a uma polilinha aberta (linha interna), para o lado de `towards`. */
export function parallelToPolyline(pts: Vec2[], distanceMm: number, towards: Vec2): Path {
  const mid = pts[Math.floor(pts.length / 2)]!;
  const k = Math.floor(pts.length / 2);
  const t = normalize(sub(pts[Math.min(pts.length - 1, k + 1)]!, pts[Math.max(0, k - 1)]!));
  const side = cross(t, sub(towards, mid)) >= 0 ? 1 : -1;
  const off = simplifyPolyline(offsetOpenPolyline(pts, side * distanceMm), 0.02);
  return { start: off[0]!, segments: off.slice(1).map((to) => ({ kind: 'line' as const, to })), closed: false };
}

/** Contorno paralelo do molde inteiro (para vistas, forros, entretelas): `distanceMm` > 0 = para fora. */
export function parallelContour(piece: Piece, distanceMm: number): Path {
  const pts = offsetPolygon(flattenPath(piece.outline, 0.01), distanceMm);
  // contorno fechado: divide no ponto mais distante do início e simplifica as duas metades
  let far = 0;
  pts.forEach((q, i) => {
    if (dist(q, pts[0]!) > dist(pts[far]!, pts[0]!)) far = i;
  });
  const s = [...simplifyPolyline(pts.slice(0, far + 1), 0.02).slice(0, -1), ...simplifyPolyline([...pts.slice(far), pts[0]!], 0.02).slice(0, -1)];
  return { start: s[0]!, segments: [...s.slice(1), s[0]!].map((to) => ({ kind: 'line' as const, to })), closed: true };
}

/* ------------------------------------------------------------------ */
/* Comprimento exato de curva                                          */
/* ------------------------------------------------------------------ */

/**
 * Ajusta o comprimento de uma borda para `lengthMm` mantendo as pontas no lugar:
 * reta → move o ponto final (como antes); curva → estica/encolhe as alças.
 */
export function setEdgeLengthExact(path: Path, edge: number, lengthMm: number): Path {
  const c = edgeControls(path, edge);
  if (c.kind === 'line') return setEdgeLength(path, edge, lengthMm);
  const chord = dist(c.p0, c.p3);
  if (lengthMm <= chord + 1e-6) throw new Error(`Uma curva entre estas pontas precisa ter mais que ${chord.toFixed(1)} mm (a reta entre elas)`);
  const d = decompose(path);
  const h1 = sub(c.c1, c.p0), h2 = sub(c.c2, c.p3);
  const withK = (k: number): Path => {
    const dd = { ...d, edges: [...d.edges] };
    dd.edges[edge] = { kind: 'cubic', c1: add(c.p0, scale(h1, k)), c2: add(c.p3, scale(h2, k)) };
    return compose(dd);
  };
  let lo = 0, hi = 1;
  while (edgeLength(withK(hi), edge) < lengthMm && hi < 64) hi *= 2;
  if (edgeLength(withK(hi), edge) < lengthMm) throw new Error('Comprimento grande demais para esta curva — mova as alças ou os pontos');
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (edgeLength(withK(m), edge) < lengthMm) lo = m;
    else hi = m;
  }
  return withK((lo + hi) / 2);
}

/* ------------------------------------------------------------------ */
/* Piques e pontos por medida                                          */
/* ------------------------------------------------------------------ */

/** Pique a `distanceMm` do vértice inicial (`fromEnd` = a partir do final) da aresta. */
export function notchAtDistance(piece: Piece, edge: number, distanceMm: number, fromEnd = false, depthMm = 5): Piece {
  const L = edgeLength(piece.outline, edge);
  if (distanceMm < 0 || distanceMm > L) throw new Error(`A borda mede ${L.toFixed(1)} mm`);
  const t = paramAtDistance(piece.outline, edge, fromEnd ? L - distanceMm : distanceMm);
  return { ...piece, notches: [...piece.notches, { edge, t, depthMm }] };
}

/** Piques dividindo a aresta em `n` partes iguais (n−1 piques). */
export function notchesDividing(piece: Piece, edge: number, n: number, depthMm = 5): Piece {
  if (n < 2) return piece;
  const L = edgeLength(piece.outline, edge);
  const notches = [...piece.notches];
  for (let k = 1; k < n; k++) notches.push({ edge, t: paramAtDistance(piece.outline, edge, (L * k) / n), depthMm });
  return { ...piece, notches };
}

/** Pontos dividindo a aresta em `n` partes iguais (a forma não muda). */
export function pointsDividing(piece: Piece, edge: number, n: number): Piece {
  if (n < 2) return piece;
  const L = edgeLength(piece.outline, edge);
  const hits = Array.from({ length: n - 1 }, (_, k) => ({ edge, t: paramAtDistance(piece.outline, edge, (L * (k + 1)) / n) }));
  return insertPoints(piece, hits).piece;
}

/** Ponto a `distanceMm` do início (ou do fim) da aresta, inserido como vértice. */
export function pointAtDistance(piece: Piece, edge: number, distanceMm: number, fromEnd = false): Piece {
  const L = edgeLength(piece.outline, edge);
  if (distanceMm <= 0 || distanceMm >= L) throw new Error(`Informe uma distância entre 0 e ${L.toFixed(1)} mm`);
  return insertPieceVertex(piece, edge, paramAtDistance(piece.outline, edge, fromEnd ? L - distanceMm : distanceMm));
}

/* ------------------------------------------------------------------ */
/* Organizar moldes                                                    */
/* ------------------------------------------------------------------ */

/** Arruma os moldes em fileiras (pela linha de corte), sem sobrepor, até `rowWidthMm` de largura. */
export function arrangePieces(pieces: Piece[], rowWidthMm = 2400, gapMm = 40): Piece[] {
  const boxes = pieces.map((p) => bboxOfPoints(cutLine(p)));
  let x = 0, y = 0, rowH = 0;
  return pieces.map((p, i) => {
    const b = boxes[i]!;
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    if (x > 0 && x + w > rowWidthMm) {
      x = 0;
      y -= rowH + gapMm;
      rowH = 0;
    }
    const moved = translatePiece(p, x - b.minX, y - b.maxY);
    x += w + gapMm;
    rowH = Math.max(rowH, h);
    return moved;
  });
}

