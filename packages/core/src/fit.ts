/**
 * AJUSTE DE CURVAS: transforma uma polilinha densa (vinda de DXF, digitalização…) em poucas
 * Béziers cúbicas editáveis, com erro máximo controlado (algoritmo de Philip J. Schneider).
 */
import { type Vec2, add, dist, dot, normalize, scale, sub } from './geometry.js';

export type Cubic = [Vec2, Vec2, Vec2, Vec2];

const bez = (b: Cubic, t: number): Vec2 => {
  const s = 1 - t;
  const a = s * s * s, c = 3 * s * s * t, d = 3 * s * t * t, e = t * t * t;
  return { x: a * b[0].x + c * b[1].x + d * b[2].x + e * b[3].x, y: a * b[0].y + c * b[1].y + d * b[2].y + e * b[3].y };
};
const bezD1 = (b: Cubic, t: number): Vec2 => {
  const s = 1 - t;
  return {
    x: 3 * s * s * (b[1].x - b[0].x) + 6 * s * t * (b[2].x - b[1].x) + 3 * t * t * (b[3].x - b[2].x),
    y: 3 * s * s * (b[1].y - b[0].y) + 6 * s * t * (b[2].y - b[1].y) + 3 * t * t * (b[3].y - b[2].y),
  };
};
const bezD2 = (b: Cubic, t: number): Vec2 => {
  const s = 1 - t;
  return {
    x: 6 * s * (b[2].x - 2 * b[1].x + b[0].x) + 6 * t * (b[3].x - 2 * b[2].x + b[1].x),
    y: 6 * s * (b[2].y - 2 * b[1].y + b[0].y) + 6 * t * (b[3].y - 2 * b[2].y + b[1].y),
  };
};

/**
 * Ajusta Béziers cúbicas a uma polilinha aberta.
 * @param tol erro máximo (mesma unidade dos pontos)
 * @param tanStart direção da curva saindo do primeiro ponto (opcional)
 * @param tanEnd direção da curva saindo do último ponto PARA TRÁS (opcional)
 */
export function fitCubics(pts: Vec2[], tol = 0.05, tanStart?: Vec2, tanEnd?: Vec2): Cubic[] {
  const p = pts.filter((q, i) => i === 0 || dist(q, pts[i - 1]!) > 1e-9);
  if (p.length < 2) return [];
  const n = p.length;
  const t1 = tanStart ? normalize(tanStart) : n >= 3 ? tangentEnd(p[0]!, p[1]!, p[2]!) : normalize(sub(p[1]!, p[0]!));
  const t2 = tanEnd ? normalize(tanEnd) : n >= 3 ? tangentEnd(p[n - 1]!, p[n - 2]!, p[n - 3]!) : normalize(sub(p[n - 2]!, p[n - 1]!));
  const out: Cubic[] = [];
  fitRec(p, 0, p.length - 1, t1, t2, !tanStart, !tanEnd, tol, out, 0);
  return out;
}

/**
 * @param free1/free2 ponta "livre" (canto): a direção da alça também é ajustada (mínimos quadrados),
 * em vez de usar a tangente estimada — muito mais exato nas pontas das curvas.
 */
function fitRec(d: Vec2[], first: number, last: number, t1: Vec2, t2: Vec2, free1: boolean, free2: boolean, tol: number, out: Cubic[], depth: number) {
  const p0 = d[first]!, p3 = d[last]!;
  if (last - first === 1) {
    const L = dist(p0, p3) / 3;
    out.push([p0, add(p0, scale(t1, L)), add(p3, scale(t2, L)), p3]);
    return;
  }
  let u = chordParams(d, first, last);
  const fixed1 = free1 && last - first >= 3 ? null : t1, fixed2 = free2 && last - first >= 3 ? null : t2;
  const gen = (uu: number[], cur?: Cubic) => {
    // distância ponto→reta tangente (converge muito mais rápido que ponto→ponto), com um pouco de ponto→ponto para estabilizar
    const nrm = cur ? uu.map((t) => { const q = normalize(bezD1(cur, t)); return { x: -q.y, y: q.x }; }) : null;
    return generateFree(d, first, last, uu, fixed1, fixed2, nrm) ?? generate(d, first, last, uu, t1, t2);
  };
  let b = gen(u);
  let { err, split } = maxError(d, first, last, b, u);
  if (err < tol) {
    out.push(b);
    return;
  }
  for (let k = 0; k < 200; k++) {
    for (let r = 0; r < 6; r++) u = reparam(d, first, last, u, b);
    b = gen(u, b);
    const prev = err;
    ({ err, split } = maxError(d, first, last, b, u));
    if (err < tol) {
      // já serve; continua refinando enquanto melhora (alças mais fiéis → gradação mais fiel)
      for (let m = 0; m < 40 && err > tol / 50; m++) {
        let uu = u;
        for (let r = 0; r < 6; r++) uu = reparam(d, first, last, uu, b);
        const bb = gen(uu, b);
        const e2 = maxError(d, first, last, bb, uu).err;
        if (e2 > err * 0.98) break;
        u = uu;
        b = bb;
        err = e2;
      }
      out.push(b);
      return;
    }
    if (k > 20 && err > prev * 0.9999) break; // parou de melhorar
  }
  if (depth > 40) {
    out.push(b);
    return;
  }
  split = Math.min(last - 1, Math.max(first + 1, split));
  const lo = Math.max(first, split - 2), hi = Math.min(last, split + 2);
  const tc = scale(tangentLagrange(d.slice(lo, hi + 1), split - lo), -1);
  fitRec(d, first, split, t1, tc, free1, false, tol, out, depth + 1);
  fitRec(d, split, last, scale(tc, -1), t2, false, free2, tol, out, depth + 1);
}

/**
 * Tangente num ponto de uma polilinha densa (derivada do polinômio de Lagrange pelos vizinhos,
 * parametrizado pelo comprimento das cordas) — bem mais exata que a direção vizinho→vizinho.
 * `pts` em ordem; `k` = índice do ponto.
 */
export function tangentLagrange(pts: Vec2[], k: number): Vec2 {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  const x = s[k]!;
  let d = { x: 0, y: 0 };
  for (let j = 0; j < pts.length; j++) {
    // L_j'(x)
    let sum = 0;
    for (let m = 0; m < pts.length; m++) {
      if (m === j) continue;
      let prod = 1 / (s[j]! - s[m]!);
      for (let l = 0; l < pts.length; l++) if (l !== j && l !== m) prod *= (x - s[l]!) / (s[j]! - s[l]!);
      sum += prod;
    }
    d = add(d, scale(pts[j]!, sum));
  }
  return normalize(d);
}

/** Tangente em b (parábola pelos 3 pontos, parametrizada pelo comprimento das cordas). */
export function tangentMid(a: Vec2, b: Vec2, c: Vec2): Vec2 {
  const h1 = dist(a, b) || 1e-12, h2 = dist(b, c) || 1e-12;
  return normalize(add(scale(sub(c, b), h1 / (h2 * (h1 + h2))), scale(sub(b, a), h2 / (h1 * (h1 + h2)))));
}

/** Tangente na ponta a, saindo em direção a b (parábola por a, b, c). */
export function tangentEnd(a: Vec2, b: Vec2, c: Vec2): Vec2 {
  const h1 = dist(a, b) || 1e-12, h2 = dist(b, c) || 1e-12;
  const t = normalize(sub(scale(sub(b, a), (h1 + h2) / (h1 * h2)), scale(sub(c, a), h1 / (h2 * (h1 + h2)))));
  return dot(t, sub(b, a)) > 0 ? t : normalize(sub(b, a));
}

function chordParams(d: Vec2[], first: number, last: number): number[] {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1]! + dist(d[i]!, d[i - 1]!));
  const total = u[u.length - 1]! || 1;
  return u.map((x) => x / total);
}

/** Mínimos quadrados com alça(s) livre(s): c1 e/ou c2 como pontos (tangente dada = só o comprimento). */
function generateFree(d: Vec2[], first: number, last: number, u: number[], t1: Vec2 | null, t2: Vec2 | null, nrm: Vec2[] | null = null): Cubic | null {
  const w = nrm ? 1e-4 : 1;
  const p0 = d[first]!, p3 = d[last]!;
  // colunas (cada uma é um vetor 2D por amostra) e resíduo
  const nc = (t1 ? 1 : 2) + (t2 ? 1 : 2);
  const M = Array.from({ length: nc }, () => new Array<number>(nc + 1).fill(0));
  for (let i = 0; i < u.length; i++) {
    const t = u[i]!, s = 1 - t;
    const b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
    const cols: Vec2[] = [];
    if (t1) cols.push(scale(t1, b1));
    else cols.push({ x: b1, y: 0 }, { x: 0, y: b1 });
    if (t2) cols.push(scale(t2, b2));
    else cols.push({ x: b2, y: 0 }, { x: 0, y: b2 });
    let base = add(scale(p0, b0), scale(p3, b3));
    if (t1) base = add(base, scale(p0, b1));
    if (t2) base = add(base, scale(p3, b2));
    const r = sub(d[first + i]!, base);
    for (let j = 0; j < nc; j++) {
      for (let k = 0; k < nc; k++) M[j]![k]! += w * dot(cols[j]!, cols[k]!);
      M[j]![nc]! += w * dot(cols[j]!, r);
    }
    if (nrm) {
      const n = nrm[i]!;
      const a = cols.map((c) => dot(n, c));
      const rn = dot(n, r);
      for (let j = 0; j < nc; j++) {
        for (let k = 0; k < nc; k++) M[j]![k]! += a[j]! * a[k]!;
        M[j]![nc]! += a[j]! * rn;
      }
    }
  }
  const z = solve(M);
  if (!z) return null;
  let k = 0;
  const c1 = t1 ? add(p0, scale(t1, z[k++]!)) : { x: z[k++]!, y: z[k++]! };
  const c2 = t2 ? add(p3, scale(t2, z[k++]!)) : { x: z[k++]!, y: z[k++]! };
  const seg = dist(p0, p3);
  if (t1 && dot(sub(c1, p0), t1) < 1e-6 * seg) return null;
  if (t2 && dot(sub(c2, p3), t2) < 1e-6 * seg) return null;
  if (dist(c1, p0) > 3 * seg + 1e-9 || dist(c2, p3) > 3 * seg + 1e-9) return null; // alças absurdas
  return [p0, c1, c2, p3];
}

/** Eliminação de Gauss com pivoteamento (matriz aumentada n×(n+1)). */
function solve(M: number[][]): number[] | null {
  const n = M.length;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    if (Math.abs(M[piv]![c]!) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

function generate(d: Vec2[], first: number, last: number, u: number[], t1: Vec2, t2: Vec2): Cubic {
  const p0 = d[first]!, p3 = d[last]!;
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < u.length; i++) {
    const t = u[i]!, s = 1 - t;
    const b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
    const a0 = scale(t1, b1), a1 = scale(t2, b2);
    c00 += dot(a0, a0);
    c01 += dot(a0, a1);
    c11 += dot(a1, a1);
    const tmp = sub(d[first + i]!, add(scale(p0, b0 + b1), scale(p3, b2 + b3)));
    x0 += dot(a0, tmp);
    x1 += dot(a1, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = Math.abs(det) < 1e-12 ? 0 : (x0 * c11 - x1 * c01) / det;
  let ar = Math.abs(det) < 1e-12 ? 0 : (c00 * x1 - c01 * x0) / det;
  const seg = dist(p0, p3);
  if (al < 1e-6 * seg || ar < 1e-6 * seg) al = ar = seg / 3;
  return [p0, add(p0, scale(t1, al)), add(p3, scale(t2, ar)), p3];
}

function maxError(d: Vec2[], first: number, last: number, b: Cubic, u: number[]) {
  let err = 0, split = Math.floor((first + last) / 2);
  for (let i = first + 1; i < last; i++) {
    const e = dist(bez(b, u[i - first]!), d[i]!);
    if (e > err) {
      err = e;
      split = i;
    }
  }
  return { err, split };
}

function reparam(d: Vec2[], first: number, last: number, u: number[], b: Cubic): number[] {
  return u.map((t, k) => {
    const p = d[first + k]!;
    const q = sub(bez(b, t), p);
    const q1 = bezD1(b, t), q2 = bezD2(b, t);
    const num = dot(q, q1);
    const den = dot(q1, q1) + dot(q, q2);
    if (Math.abs(den) < 1e-12) return t;
    return Math.max(0, Math.min(1, t - num / den));
  });
}
