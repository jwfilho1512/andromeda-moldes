/** Geometria das ferramentas de desenho: traço livre, polígono/estrela, arco, tesoura e cota. */
import { type Path, type Vec2, closestOnPath, dist, insertVertex, pathThroughPoints } from '@cad-textil/core';
import { anchors, polyPath } from './geom';
import type { DimShape } from './types';

/** Simplificação de Ramer–Douglas–Peucker (tolerância em mm). */
export function simplify(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = pts[a]!, B = pts[b]!;
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const P = pts[i]!;
      const d = Math.abs((P.x - A.x) * dy - (P.y - A.y) * dx) / L;
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > tol && bi > 0) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Traço à mão livre → curva suave (passa pelos pontos simplificados). */
export function freehandPath(raw: Vec2[], tol: number, closed: boolean): Path | null {
  const pts = simplify(raw, tol);
  if (pts.length < 2) return null;
  if (closed && pts.length >= 3) {
    if (dist(pts[0]!, pts[pts.length - 1]!) < tol * 4) pts.pop();
    return pathThroughPoints(pts.map((p) => ({ p })), true);
  }
  return pathThroughPoints(pts.map((p) => ({ p })), false);
}

/** Polígono regular (ou estrela) com centro c, raio r e rotação (graus). */
export function polygonPath(c: Vec2, r: number, sides: number, rotDeg: number, star?: number): Path {
  const n = Math.max(3, Math.round(sides));
  const pts: Vec2[] = [];
  const steps = star ? n * 2 : n;
  for (let k = 0; k < steps; k++) {
    const a = (rotDeg * Math.PI) / 180 - Math.PI / 2 + (k * 2 * Math.PI) / steps;
    const rr = star && k % 2 ? r * star : r;
    pts.push({ x: c.x + rr * Math.cos(a), y: c.y + rr * Math.sin(a) });
  }
  return polyPath(pts, true);
}

/** Arco de quarto de elipse de a até b (como a ferramenta Arco do Illustrator). `flip` troca o lado. */
export function arcPath(a: Vec2, b: Vec2, flip = false): Path {
  const k = 0.5522847498;
  const corner = flip ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  const c1 = { x: a.x + (corner.x - a.x) * k, y: a.y + (corner.y - a.y) * k };
  const c2 = { x: b.x + (corner.x - b.x) * k, y: b.y + (corner.y - b.y) * k };
  return { start: a, segments: [{ kind: 'cubic', c1, c2, to: b }], closed: false };
}

/**
 * Tesoura: corta o caminho no ponto mais próximo de p.
 * Aberto → dois caminhos; fechado → um caminho aberto que começa e termina no corte.
 */
export function splitPathAt(path: Path, p: Vec2): Path[] {
  const hit = closestOnPath(path, p);
  let t = hit.t;
  let edge = hit.edge;
  let withV = path;
  if (t > 1e-6 && t < 1 - 1e-6) {
    withV = insertVertex(path, edge, t);
    edge += 1;
  } else if (t >= 1 - 1e-6) edge += 1;
  const segs = withV.segments;
  const pts = anchors(withV);
  const at = edge % (segs.length || 1);
  if (path.closed) {
    const rot = [...segs.slice(at), ...segs.slice(0, at)];
    return [{ start: pts[at]!, segments: rot, closed: false }];
  }
  if (at <= 0 || at >= segs.length) return [path];
  return [
    { start: withV.start, segments: segs.slice(0, at), closed: false },
    { start: pts[at]!, segments: segs.slice(at), closed: false },
  ];
}

/** Medida da cota no tamanho real da peça (cm), pela escala do documento. */
export const dimValueCm = (d: DimShape, scale: number) => (dist(d.a, d.b) * scale) / 10;

export const fmtCm = (cm: number) => `${(Math.round(cm * 10) / 10).toLocaleString('pt-BR')} cm`;

/** Desenho da cota: linhas de chamada, linha com setas e posição/ângulo do texto. */
export function dimGeometry(d: DimShape) {
  const dx = d.b.x - d.a.x, dy = d.b.y - d.a.y;
  const L = Math.hypot(dx, dy) || 1;
  const u = { x: dx / L, y: dy / L };
  const n = { x: u.y, y: -u.x };
  const A = { x: d.a.x + n.x * d.off, y: d.a.y + n.y * d.off };
  const B = { x: d.b.x + n.x * d.off, y: d.b.y + n.y * d.off };
  const ext = Math.sign(d.off || 1) * Math.min(1.5, d.size * 0.4);
  const head = Math.min(d.size * 0.6, L / 4);
  const arrow = (P: Vec2, dir: number) => [
    { x: P.x + dir * u.x * head + n.x * head * 0.35, y: P.y + dir * u.y * head + n.y * head * 0.35 },
    P,
    { x: P.x + dir * u.x * head - n.x * head * 0.35, y: P.y + dir * u.y * head - n.y * head * 0.35 },
  ];
  let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (ang > 90 || ang < -90) ang += 180;
  const mid = { x: (A.x + B.x) / 2 + n.x * d.size * 0.35 * Math.sign(d.off || 1), y: (A.y + B.y) / 2 + n.y * d.size * 0.35 * Math.sign(d.off || 1) };
  return {
    ext: [
      [d.a, { x: A.x + n.x * ext, y: A.y + n.y * ext }],
      [d.b, { x: B.x + n.x * ext, y: B.y + n.y * ext }],
    ] as [Vec2, Vec2][],
    line: [A, B] as [Vec2, Vec2],
    arrows: [arrow(A, 1), arrow(B, -1)],
    text: { at: mid, angle: ang },
  };
}
