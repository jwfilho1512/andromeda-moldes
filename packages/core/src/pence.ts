/**
 * Pence de verdade no molde: a partir do contorno guardado (boca fechada) calcula a linha de
 * costura com o BICO (como se a pence estivesse costurada e passada para um lado) ou com o
 * triângulo RECORTADO, e o recorte na linha de corte.
 *
 * Nada disso fica gravado no contorno: é recalculado a cada desenho, então arrastar o ápice,
 * mexer nas pernas ou graduar o molde atualiza a pence e o contorno juntos.
 */
import { type Vec2, add, cross, dist, dot, flattenWithEdges, normalize, scale, sub } from './geometry.js';
import type { Dart, DartKind, Piece } from './pattern.js';

export const dartKindOf = (d: Dart): DartKind => d.kind ?? 'marcada';

/** A pence muda o contorno (bico ou recortada)? */
export const dartShapesOutline = (d: Dart) => dartKindOf(d) !== 'marcada';

const reflect = (p: Vec2, a: Vec2, u: Vec2): Vec2 => {
  const v = sub(p, a);
  return add(a, sub(scale(u, 2 * dot(v, u)), v));
};

/** Pernas, direção do meio (do ápice para a boca) e o ápice de uma pence no polígono achatado. */
function legs(d: Dart, legA: Vec2, legB: Vec2) {
  const uA = normalize(sub(legA, d.apex));
  const uB = normalize(sub(legB, d.apex));
  let c = normalize(add(uA, uB));
  if (!Number.isFinite(c.x) || Math.hypot(c.x, c.y) < 0.5) c = normalize(sub(scale(add(legA, legB), 0.5), d.apex));
  return { uA, uB, c };
}

/**
 * Bico da pence: dobra a costura do lado para onde a pence deita sobre a perna desse lado
 * e acha onde ela cruza o meio da pence. `side` = pontos da costura saindo da perna (para fora da pence).
 */
export function dartCap(apex: Vec2, leg: Vec2, center: Vec2, side: Vec2[]): Vec2 | null {
  const uLeg = normalize(sub(leg, apex));
  const h = (p: Vec2) => cross(center, sub(reflect(p, apex, uLeg), apex));
  const h0 = h(leg);
  let prev = leg, hp = h0;
  for (let i = 1; i < side.length; i++) {
    const q = side[i]!;
    const hq = h(q);
    if (Math.sign(hq) !== Math.sign(h0) && hq !== hp) {
      const t = hp / (hp - hq);
      return reflect(add(prev, scale(sub(q, prev), t)), apex, uLeg);
    }
    prev = q;
    hp = hq;
  }
  // a borda acabou antes: prolonga o último trecho
  const a = side.length > 1 ? side[side.length - 2]! : leg;
  const b = side[side.length - 1]!;
  const ha = h(a), hb = h(b);
  if (Math.abs(hb - ha) < 1e-12) return null;
  const t = ha / (ha - hb);
  if (!(t > 0)) return null;
  return reflect(add(a, scale(sub(b, a), t)), apex, uLeg);
}

/** Pontos da costura saindo do índice k, no sentido step, até ~`maxLen` mm. */
function walkFrom(points: Vec2[], k: number, step: 1 | -1, maxLen: number): Vec2[] {
  const n = points.length;
  const out = [points[k]!];
  let L = 0;
  for (let c = 1; c < n && L < maxLen; c++) {
    const q = points[(((k + step * c) % n) + n) % n]!;
    L += dist(out[out.length - 1]!, q);
    out.push(q);
  }
  return out;
}

/**
 * Linha de costura com as pences aplicadas (bico ou recorte). `recortadaComoBico` usa o bico
 * também nas recortadas (base para a linha de corte, que recebe o recorte depois).
 * edgeOf segue a convenção de `flattenWithEdges` (trecho k → k+1).
 */
export function sewLineWithDarts(piece: Piece, tolerance?: number, recortadaComoBico = false): { points: Vec2[]; edgeOf: number[] } {
  const base = flattenWithEdges(piece.outline, tolerance);
  const darts = (piece.darts ?? []).filter(dartShapesOutline);
  if (!darts.length) return base;
  const n = base.points.length;
  // começa num início de aresta, para nenhum trecho de aresta dar a volta no índice 0
  let k0 = base.edgeOf.findIndex((e, k) => e !== base.edgeOf[(k - 1 + n) % n]);
  if (k0 < 0) k0 = 0;
  const pts = [...base.points.slice(k0), ...base.points.slice(0, k0)];
  const eo = [...base.edgeOf.slice(k0), ...base.edgeOf.slice(0, k0)];
  /** inserções por índice do início da boca */
  const insert = new Map<number, { skipTo: number; add: Vec2[]; edge: number }>();
  for (const d of darts) {
    const start = eo.findIndex((e, k) => e === d.edge && (k === 0 || eo[k - 1] !== d.edge));
    if (start < 0) continue;
    let end = start;
    while (end + 1 < n && eo[end + 1] === d.edge) end++;
    const legA = pts[start]!, legB = pts[(end + 1) % n]!;
    const kind = dartKindOf(d);
    if (kind === 'recortada' && !recortadaComoBico) {
      insert.set(start, { skipTo: end + 1, add: [d.apex], edge: d.edge });
      continue;
    }
    const { c } = legs(d, legA, legB);
    const sideA = (d.side ?? -1) === -1;
    const side = sideA ? walkFrom(pts, start, -1, 400) : walkFrom(pts, (end + 1) % n, 1, 400);
    const cap = dartCap(d.apex, sideA ? legA : legB, c, side);
    // bico absurdo (borda quase paralela à perna): fica só marcada
    if (!cap || dist(cap, legA) > 4 * dist(legA, legB) + 5) continue;
    insert.set(start, { skipTo: end + 1, add: [cap], edge: d.edge });
  }
  const points: Vec2[] = [];
  const edgeOf: number[] = [];
  for (let k = 0; k < n; k++) {
    points.push(pts[k]!);
    edgeOf.push(eo[k]!);
    const ins = insert.get(k);
    if (!ins) continue;
    for (const q of ins.add) {
      points.push(q);
      edgeOf.push(ins.edge);
    }
    k = ins.skipTo - 1;
  }
  return { points, edgeOf };
}

/** Interseção do raio o + t·u (t > 0) com o polígono fechado: o trecho e o ponto mais próximos. */
function rayHit(o: Vec2, u: Vec2, poly: Vec2[]): { i: number; p: Vec2; t: number } | null {
  let best: { i: number; p: Vec2; t: number } | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const e = sub(b, a);
    const den = cross(u, e);
    if (Math.abs(den) < 1e-12) continue;
    const w = sub(a, o);
    const t = cross(w, e) / den;
    const s = cross(w, u) / den;
    if (t > 1e-9 && s >= 0 && s <= 1 && (!best || t < best.t)) best = { i, p: add(o, scale(u, t)), t };
  }
  return best;
}

function inside(p: Vec2, poly: Vec2[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}

/**
 * Recorta o triângulo da pence na linha de corte, deixando `seamMm` de margem nas pernas.
 * Se a pence for estreita demais para a margem, a linha de corte fica inteira.
 */
export function notchCutLine(cut: Vec2[], d: Dart, legA: Vec2, legB: Vec2, seamMm: number): Vec2[] {
  const { uA, uB, c } = legs(d, legA, legB);
  const sinH = Math.abs(cross(uA, c));
  if (sinH < 1e-6) return cut;
  const apex2 = add(d.apex, scale(c, seamMm / sinH));
  if (!inside(apex2, cut)) return cut;
  const hA = rayHit(apex2, uA, cut);
  const hB = rayHit(apex2, uB, cut);
  if (!hA || !hB || hA.i === hB.i) return cut;
  const m = cut.length;
  // de A até B no sentido do polígono tem de ser o trecho curto (a boca)
  const fwd = (hB.i - hA.i + m) % m;
  const [first, second] = fwd <= m / 2 ? [hA, hB] : [hB, hA];
  const out: Vec2[] = [];
  for (let c2 = 0, i = (second.i + 1) % m; c2 < m; c2++, i = (i + 1) % m) {
    out.push(cut[i]!);
    if (i === first.i) break;
  }
  out.push(first.p, apex2, second.p);
  return out;
}
