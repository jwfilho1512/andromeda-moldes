/** Geometria do Draw: caminhos, simetria, offset de linhas abertas e medidas ao longo do traço. */
import { type BBox, type Path, type Vec2, add, bboxOfPoints, dist, flattenPath, lerp, mapPath, normalize, scale, signedArea, sub, unionBBox } from '@cad-textil/core';
import type { Shape } from './types';

export { mapPath };

const r = (n: number) => Math.round(n * 1000) / 1000;
const P = (p: Vec2) => `${r(p.x)} ${r(p.y)}`;

/** `d` do SVG. */
export function pathD(path: Path): string {
  let d = `M${P(path.start)}`;
  for (const s of path.segments) d += s.kind === 'line' ? `L${P(s.to)}` : `C${P(s.c1)} ${P(s.c2)} ${P(s.to)}`;
  return path.closed ? d + 'Z' : d;
}

/** Pontos finais de cada segmento (vértices do caminho). */
export function anchors(path: Path): Vec2[] {
  return [path.start, ...path.segments.map((s) => s.to)];
}

export function reversePath(path: Path): Path {
  const pts = anchors(path);
  const segs = path.segments;
  const out: Path['segments'] = [];
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]!;
    const to = pts[i]!;
    out.push(s.kind === 'line' ? { kind: 'line', to } : { kind: 'cubic', c1: s.c2, c2: s.c1, to });
  }
  return { start: pts[pts.length - 1]!, segments: out, closed: path.closed };
}

export const mirrorX = (a: number) => (p: Vec2): Vec2 => ({ x: 2 * a - p.x, y: p.y });

const ON_AXIS = 0.5;

/**
 * Caminho com a simetria aplicada. Meio contorno aberto com as duas pontas no eixo vira UM contorno
 * fechado (frente inteira da peça); nos outros casos devolve o original e o espelho separados.
 */
export function mirrored(path: Path, axis: number): Path[] {
  const m = mapPath(path, mirrorX(axis));
  const pts = anchors(path);
  const a = pts[0]!, b = pts[pts.length - 1]!;
  if (!path.closed && pts.length > 1 && Math.abs(a.x - axis) < ON_AXIS && Math.abs(b.x - axis) < ON_AXIS) {
    const back = reversePath(m);
    const segs = [...path.segments, ...back.segments.map((s, i) => (i === back.segments.length - 1 ? { ...s, to: path.start } : s))];
    return [{ start: path.start, segments: segs, closed: true }];
  }
  return [path, m];
}

/** O caminho meio-contorno fecha no eixo? */
export function joinsOnAxis(path: Path, axis: number): boolean {
  return mirrored(path, axis).length === 1;
}

export function pathBBox(path: Path): BBox {
  return bboxOfPoints(flattenPath(path, 0.2));
}

/** Pontos de um caminho com o espelho, se houver. */
function pathsOf(sh: Shape): Path[] {
  if (sh.kind === 'path' || sh.kind === 'stitch') return sh.mirror !== undefined ? mirrored(sh.path, sh.mirror) : [sh.path];
  return [];
}

export function shapeBBox(sh: Shape): BBox | null {
  switch (sh.kind) {
    case 'path':
    case 'stitch': {
      const pad = sh.kind === 'stitch' ? sh.stitch.gap : sh.style.width / 2;
      const b = [...pathsOf(sh), ...(sh.kind === 'path' ? (sh.subpaths ?? []) : [])].map(pathBBox).reduce(unionBBox);
      return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
    }
    case 'trim': {
      const h = sh.size / 2;
      const b = { minX: sh.at.x - h, minY: sh.at.y - h, maxX: sh.at.x + h, maxY: sh.at.y + h };
      if (sh.mirror === undefined) return b;
      const mx = 2 * sh.mirror - sh.at.x;
      return unionBBox(b, { minX: mx - h, minY: b.minY, maxX: mx + h, maxY: b.maxY });
    }
    case 'image':
      return { minX: sh.at.x, minY: sh.at.y, maxX: sh.at.x + sh.w, maxY: sh.at.y + sh.h };
    case 'text': {
      const w = sh.text.length * sh.size * 0.55;
      return { minX: sh.at.x, minY: sh.at.y - sh.size, maxX: sh.at.x + w, maxY: sh.at.y + sh.size * 0.25 };
    }
    case 'group': {
      const bs = sh.children.map(shapeBBox).filter((b): b is BBox => !!b);
      return bs.length ? bs.reduce(unionBBox) : null;
    }
  }
}

export function bboxOfShapes(shapes: Shape[]): BBox | null {
  const bs = shapes.map(shapeBBox).filter((b): b is BBox => !!b);
  return bs.length ? bs.reduce(unionBBox) : null;
}

/* ------------------------------------------------------------------ */
/* Transformações                                                      */
/* ------------------------------------------------------------------ */

export interface Affine {
  /** p' = (a·x + c·y + e, b·x + d·y + f) */
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const applyAffine = (m: Affine) => (p: Vec2): Vec2 => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
export const translateM = (dx: number, dy: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });
export const scaleAbout = (o: Vec2, sx: number, sy: number): Affine => ({ a: sx, b: 0, c: 0, d: sy, e: o.x - sx * o.x, f: o.y - sy * o.y });
export function rotateAbout(o: Vec2, deg: number): Affine {
  const t = (deg * Math.PI) / 180, co = Math.cos(t), si = Math.sin(t);
  return { a: co, b: si, c: -si, d: co, e: o.x - co * o.x + si * o.y, f: o.y - si * o.x - co * o.y };
}

/** A transformação mantém retas verticais verticais (dá para levar o eixo de simetria junto)? */
const keepsAxis = (m: Affine) => Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9 && m.a > 0;

/** Desfaz a simetria: o espelho vira desenho de verdade. */
export function bakeMirror(sh: Shape): Shape[] {
  if (sh.mirror === undefined) return [sh];
  const ax = sh.mirror;
  const { mirror: _m, ...rest } = sh;
  void _m;
  switch (sh.kind) {
    case 'path':
    case 'stitch': {
      const ps = mirrored(sh.path, ax);
      return ps.map((path, i) => ({ ...(rest as typeof sh), id: i === 0 ? sh.id : `${sh.id}m`, path }));
    }
    case 'trim':
      return [{ ...(rest as typeof sh) }, { ...(rest as typeof sh), id: `${sh.id}m`, at: mirrorX(ax)(sh.at), rot: -sh.rot }];
    case 'group':
      return [{ ...(rest as typeof sh), children: sh.children.flatMap((c) => bakeMirror({ ...c, mirror: c.mirror ?? ax })) }];
    default:
      return [rest as Shape];
  }
}

export function transformShape(sh: Shape, m: Affine): Shape {
  if (sh.mirror !== undefined && !keepsAxis(m)) {
    const baked = bakeMirror(sh);
    const g: Shape = baked.length === 1 ? baked[0]! : { kind: 'group', id: sh.id, children: baked };
    return transformShape(g, m);
  }
  const f = applyAffine(m);
  const s = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  const mirror = sh.mirror === undefined ? undefined : f({ x: sh.mirror, y: 0 }).x;
  const withAxis = <T extends Shape>(x: T): T => (mirror === undefined ? x : { ...x, mirror });
  switch (sh.kind) {
    case 'path':
      return withAxis({ ...sh, path: mapPath(sh.path, f), ...(sh.subpaths ? { subpaths: sh.subpaths.map((p) => mapPath(p, f)) } : {}) });
    case 'image': {
      // imagem acompanha a caixa (sem girar)
      const pts = [sh.at, { x: sh.at.x + sh.w, y: sh.at.y }, { x: sh.at.x + sh.w, y: sh.at.y + sh.h }, { x: sh.at.x, y: sh.at.y + sh.h }].map(f);
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      return { ...sh, at: { x: Math.min(...xs), y: Math.min(...ys) }, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    case 'stitch':
      return withAxis({ ...sh, path: mapPath(sh.path, f), stitch: { ...sh.stitch, gap: sh.stitch.gap * s, len: sh.stitch.len * s } });
    case 'trim':
      return withAxis({ ...sh, at: f(sh.at), size: sh.size * s, rot: sh.rot + (Math.atan2(m.b, m.a) * 180) / Math.PI });
    case 'text':
      return withAxis({ ...sh, at: f(sh.at), size: sh.size * s });
    case 'group':
      return withAxis({ ...sh, children: sh.children.map((c) => transformShape(c, m)) });
  }
}

/* ------------------------------------------------------------------ */
/* Linhas ao longo do traço                                            */
/* ------------------------------------------------------------------ */

/** Comprimento acumulado de uma poligonal. */
export function cumLength(pts: Vec2[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  return out;
}

/** Ponto e direção a uma distância `s` do início. */
export function pointAt(pts: Vec2[], cum: number[], s: number): { p: Vec2; dir: Vec2 } {
  const total = cum[cum.length - 1]!;
  const t = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i]! < t) i++;
  const a = pts[i - 1]!, b = pts[i]!;
  const seg = cum[i]! - cum[i - 1]!;
  return { p: seg > 0 ? lerp(a, b, (t - cum[i - 1]!) / seg) : a, dir: normalize(sub(b, a)) };
}

/** Trecho da poligonal entre as distâncias s0 < s1. */
export function subPolyline(pts: Vec2[], s0: number, s1: number): Vec2[] {
  const cum = cumLength(pts);
  const out = [pointAt(pts, cum, s0).p];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i]! > s0 && cum[i]! < s1) out.push(pts[i]!);
  out.push(pointAt(pts, cum, s1).p);
  return out;
}

/** Distância ao longo da poligonal do ponto mais próximo de `q`. */
export function projectOn(pts: Vec2[], q: Vec2): { s: number; d: number; p: Vec2 } {
  const cum = cumLength(pts);
  let best = { s: 0, d: Infinity, p: pts[0]! };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const ab = sub(b, a);
    const L2 = ab.x * ab.x + ab.y * ab.y;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * ab.x + (q.y - a.y) * ab.y) / L2)) : 0;
    const p = lerp(a, b, t);
    const d = dist(p, q);
    if (d < best.d) best = { s: cum[i - 1]! + t * Math.sqrt(L2), d, p };
  }
  return best;
}

/**
 * Desloca uma poligonal aberta (ou fechada) `d` mm para a esquerda do sentido de percurso
 * (com Y para baixo: esquerda = (dy, -dx)). Juntas em quina com limite.
 */
export function offsetPolyline(pts: Vec2[], d: number, closed = false): Vec2[] {
  const n = pts.length;
  if (n < 2 || d === 0) return pts.slice();
  const nrm = (a: Vec2, b: Vec2) => {
    const u = normalize(sub(b, a));
    return { x: u.y, y: -u.x };
  };
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i - 1 + n) % n]! : pts[i - 1];
    const next = closed ? pts[(i + 1) % n]! : pts[i + 1];
    const cur = pts[i]!;
    if (!prev) out.push(add(cur, scale(nrm(cur, next!), d)));
    else if (!next) out.push(add(cur, scale(nrm(prev, cur), d)));
    else {
      const n1 = nrm(prev, cur), n2 = nrm(cur, next);
      const m = normalize(add(n1, n2));
      const cos = m.x * n1.x + m.y * n1.y;
      const k = cos > 0.25 ? d / cos : d * 4;
      out.push(add(cur, scale(m, k)));
    }
  }
  return out;
}

/** O contorno fechado gira no sentido horário (na tela, Y para baixo)? */
export const isClockwise = (pts: Vec2[]) => signedArea(pts) > 0;

/** Remove pontos repetidos. */
export function dedupe(pts: Vec2[], eps = 1e-6): Vec2[] {
  return pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]!) > eps);
}

export const polyPath = (pts: Vec2[], closed = false): Path => ({
  start: pts[0]!,
  segments: pts.slice(1).map((to) => ({ kind: 'line' as const, to })),
  closed,
});
