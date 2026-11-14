/**
 * Peças base no padrão de desenho técnico (flat) de mercado: proporções de uma peça real
 * (tamanho M), meia peça espelhada no centro, hierarquia de traço (contorno > costuras > pespontos),
 * avesso das costas visível pelo decote, golas e barras com espessura, pequenas dobras de caimento.
 * Unidade: 1 cm da peça (no desenho 1:10, 1 cm = 1 mm). Eixo de simetria em x = 0, y para baixo.
 */
import { type Path, type Vec2, flattenPath } from '@cad-textil/core';
import { offsetPolyline, polyPath } from '../model/geom';
import { newId } from '../state';
import { STITCH_DEFAULT } from '../model/stitch';
import type { PathShape, Shape, StitchShape, StitchType, Style } from '../model/types';
import { type Pt, curve, line, trim } from './kit';

/** Estilo da referência (mockup de mercado): cinza claro, contorno grafite, avesso mais escuro. */
export const INK = '#111113';

export const P = (x: number, y: number): Vec2 => ({ x, y });
const deg = (a: number) => (a * Math.PI) / 180;
export const pt = (v: Vec2, c = false): Pt => (c ? [v.x, v.y, 'c'] : [v.x, v.y]);
export const plus = (a: Vec2, b: Vec2) => P(a.x + b.x, a.y + b.y);
export const times = (a: Vec2, k: number) => P(a.x * k, a.y * k);
export const lerpV = (a: Vec2, b: Vec2, t: number) => P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

/* ---------------- traço ---------------- */

/** Hierarquia de traço (mm no desenho 1:10). */
/** Proporção dos guias de mercado: contorno 1 · costura 0,75 · pesponto 0,5 (tracejado) · movimento 0,25. */
export const W = { contorno: 0.5, costura: 0.34, detalhe: 0.26, dobra: 0.2 };
const WHITE = { kind: 'solid' as const, color: '#ffffff' };
/** Avesso visto pelo decote/abertura. */
export const AVESSO = { kind: 'solid' as const, color: '#ffffff' };

const mk = (path: Path, style: Style, mirror: boolean, name?: string): PathShape => ({ kind: 'path', id: newId(), ...(name ? { name } : {}), path, style, ...(mirror ? { mirror: 0 } : {}) });

/** Contorno da peça (fundo branco). */
export const body = (path: Path, name: string, mirror = true) => mk(path, { stroke: INK, width: W.contorno, fill: WHITE } as Style, mirror, name);
/** Parte sobreposta com fundo (gola, bolso, ribana, pala…). */
export const part = (path: Path, mirror = true, fill: Style['fill'] = WHITE, width = W.costura) => mk(path, { stroke: INK, width, fill } as Style, mirror);
/** Costura (linha contínua fina). */
export const seam = (path: Path, mirror = true) => mk(path, { stroke: INK, width: W.costura, fill: null, cap: 'round' } as Style, mirror);
/** Dobra de caimento (traço bem fino e curto). */
export const fold = (path: Path, mirror = true) => mk(path, { stroke: INK, width: W.dobra, fill: null, cap: 'round' } as Style, mirror);

/** Pesponto (tracejado fino). `type` duplo = agulha dupla. */
export const topstitch = (path: Path, type: StitchType = 'simples', mirror = true): StitchShape => ({
  kind: 'stitch',
  id: newId(),
  path,
  stitch: { type, ...STITCH_DEFAULT[type], len: 0.42, width: 0.14, ...(type === 'duplo' ? { gap: 0.32 } : {}), color: INK },
  ...(mirror ? { mirror: 0 } : {}),
});

/** Caminho paralelo (d > 0 = esquerda do sentido). */
export function parallel(path: Path, d: number): Path {
  return polyPath(offsetPolyline(flattenPath(path, 0.04), d));
}

/** Leva ao eixo x = 0 a ponta da polilinha que estiver mais perto dele (pelo prolongamento do trecho). */
function extendToAxis(pts: Vec2[]): Vec2[] {
  if (pts.length < 2) return pts;
  const first = Math.abs(pts[0]!.x) <= Math.abs(pts[pts.length - 1]!.x);
  const [a, b] = first ? [pts[0]!, pts[1]!] : [pts[pts.length - 1]!, pts[pts.length - 2]!];
  if (Math.abs(b.x - a.x) < 1e-9) return pts;
  const q = P(0, a.y + (-a.x / (b.x - a.x)) * (b.y - a.y));
  const out = [...pts];
  out[first ? 0 : out.length - 1] = q;
  return out;
}

/** Paralela levada até o eixo x = 0 (decotes, cós, barras que cruzam o centro). */
export function parallelToAxis(path: Path, d: number): Path {
  return polyPath(extendToAxis(offsetPolyline(flattenPath(path, 0.04), d)));
}

/** Faixa entre um caminho e sua paralela (ribana, cós, punho…), fechada. */
export function band(path: Path, d: number, toAxis = true): Path {
  const a = flattenPath(path, 0.04);
  let b = offsetPolyline(a, d);
  if (toAxis) b = extendToAxis(b);
  return polyPath([...a, ...b.reverse()], true);
}

/**
 * Faixa simétrica inteira (gola, cós, barra que cruzam o centro): a meia faixa e o espelho
 * dela num polígono só, sem traço no eixo. Use com `mirror = false`.
 */
export function bandFull(path: Path, d: number): Path {
  const a = flattenPath(path, 0.04);
  const b = extendToAxis(offsetPolyline(a, d));
  const m = (pts: Vec2[]) => pts.map((p) => P(-p.x, p.y));
  const toEnd = (pts: Vec2[]) => (Math.abs(pts[0]!.x) <= Math.abs(pts[pts.length - 1]!.x) ? [...pts].reverse() : pts);
  const A = toEnd(a), B = toEnd(b); // da ponta de fora até o eixo
  const outer = [...A, ...m(A).reverse().slice(1)];
  const inner = [...B, ...m(B).reverse().slice(1)];
  return polyPath([...outer, ...inner.reverse()], true);
}

/** x mais à direita onde o caminho cruza a horizontal y (para encostar detalhes na lateral). */
export function xAt(path: Path, y: number): number {
  const pts = flattenPath(path, 0.03);
  let best = -Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) best = Math.max(best, a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  return best;
}

/* ---------------- corpo superior ---------------- */

export type Manga = 'sem' | 'curta' | '3/4' | 'longa';

export interface Torso {
  /** Meia largura do decote (até o ponto alto do ombro). */
  nw: number;
  /** Profundidade do decote da frente e das costas (no centro). */
  front: number;
  back: number;
  /** Ponto do ombro. */
  sp: Vec2;
  /** Cava (embaixo do braço). */
  ua: Vec2;
  /** Meia largura e altura da barra. */
  hem: Vec2;
  /** Cintura marcada (opcional): ponto da lateral. */
  waist?: Vec2;
}

export interface Sleeve {
  top: Vec2;
  bottom: Vec2;
  /** Direção do braço (unitária) e normal da barra para dentro do braço. */
  dir: Vec2;
}

/** Manga montada: do ombro, inclinada, com abertura `open`. */
export function sleeveGeo(sp: Vec2, kind: Manga, opts: { len?: number; open?: number; angle?: number } = {}): Sleeve | null {
  if (kind === 'sem') return null;
  const spec = { curta: [27, 19, 16.5], '3/4': [52, 41, 13], longa: [66, 60, 10.5] }[kind];
  const a = deg(opts.angle ?? spec[0]!);
  const L = opts.len ?? spec[1]!;
  const w = opts.open ?? spec[2]!;
  const dir = P(Math.cos(a), Math.sin(a));
  const top = plus(sp, times(dir, L));
  const bottom = plus(top, times(P(-dir.y, dir.x), w));
  return { top, bottom, dir };
}

/** Linha paralela à barra da manga, `d` cm para dentro. */
export const sleeveHemLine = (s: Sleeve, d: number): Path => line([s.top.x - s.dir.x * d, s.top.y - s.dir.y * d], [s.bottom.x - s.dir.x * d, s.bottom.y - s.dir.y * d]);

/** Decote (meia curva do ponto alto do ombro até o centro). */
export function neckCurve(nw: number, depth: number, kind: 'careca' | 'v' | 'canoa' | 'u' = 'careca'): Path {
  if (kind === 'v') return curve([[nw, 0, 'c'], [nw * 0.55, depth * 0.48], [0, depth, 'c']]);
  if (kind === 'canoa') return curve([[nw, 0, 'c'], [nw * 0.62, depth * 0.82], [0, depth, 'c']]);
  if (kind === 'u') return curve([[nw, 0, 'c'], [nw * 0.92, depth * 0.62], [nw * 0.5, depth * 0.97], [0, depth, 'c']]);
  return curve([[nw, 0, 'c'], [nw * 0.8, depth * 0.55], [nw * 0.42, depth * 0.93], [0, depth, 'c']]);
}

/** Contorno do corpo com manga (meia peça, começando no centro das costas do decote). */
export function torsoOutline(t: Torso, s: Sleeve | null, opts: { armhole?: 'cava' | 'regata'; hemCurve?: number } = {}): Path {
  const pts: Pt[] = [[0, t.back, 'c'], [t.nw * 0.55, t.back * 0.7], [t.nw, 0, 'c']];
  if (s) {
    pts.push(pt(t.sp, true), pt(s.top, true), pt(s.bottom, true), pt(t.ua, true));
  } else {
    // regata: a cava sobe até a alça
    pts.push(pt(t.sp, true), [t.sp.x + 1.2, t.ua.y * 0.5], [t.ua.x - 2.6, t.ua.y - 1.6], pt(t.ua, true));
  }
  if (t.waist) pts.push([t.waist.x + (t.ua.x - t.waist.x) * 0.15, (t.ua.y + t.waist.y) / 2], pt(t.waist), [t.hem.x - (t.hem.x - t.waist.x) * 0.25, (t.waist.y + t.hem.y) / 2]);
  else pts.push([t.ua.x + (t.hem.x - t.ua.x) * 0.4, t.ua.y + (t.hem.y - t.ua.y) * 0.45]);
  const hc = opts.hemCurve ?? 0;
  if (hc) pts.push([t.hem.x, t.hem.y - hc, 'c'], [t.hem.x - hc * 0.7, t.hem.y - hc * 0.45], [t.hem.x * 0.45, t.hem.y], [0, t.hem.y + 0.3, 'c']);
  else pts.push(pt(t.hem, true), [0, t.hem.y, 'c']);
  return curve(pts);
}

/** Costura da cava (manga montada): do ombro até embaixo do braço. */
export const armholeSeam = (sp: Vec2, ua: Vec2) => curve([pt(sp, true), [sp.x + (ua.x - sp.x) * 0.55, sp.y + (ua.y - sp.y) * 0.5], pt(ua, true)]);

/** Pequenas dobras de caimento embaixo do braço e na manga. */
export function drape(ua: Vec2, _s: Sleeve | null): PathShape[] {
  return [fold(curve([[ua.x - 0.5, ua.y + 1.4], [ua.x - 1.7, ua.y + 3.2], [ua.x - 2.1, ua.y + 5.4]]))];
}

/** Cruzamento das retas a→b e c→d. */
export function cross2(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 {
  const r = P(b.x - a.x, b.y - a.y), q = P(d.x - c.x, d.y - c.y);
  const den = r.x * q.y - r.y * q.x;
  if (Math.abs(den) < 1e-12) return b;
  const t = ((c.x - a.x) * q.y - (c.y - a.y) * q.x) / den;
  return P(a.x + r.x * t, a.y + r.y * t);
}

/** Pesponto da barra da manga a `d` cm, de borda a borda da manga (até a costura de baixo). */
export function sleeveHemIn(s: Sleeve, sp: Vec2, ua: Vec2, d: Vec2 | number): Path {
  const k = typeof d === 'number' ? d : 0;
  const a0 = P(s.top.x - s.dir.x * k, s.top.y - s.dir.y * k), b0 = P(s.bottom.x - s.dir.x * k, s.bottom.y - s.dir.y * k);
  return line([cross2(a0, b0, sp, s.top).x, cross2(a0, b0, sp, s.top).y], [cross2(a0, b0, s.bottom, ua).x, cross2(a0, b0, s.bottom, ua).y]);
}

/** Avesso das costas visto pelo decote da frente (área cinza clara entre os dois decotes). */
export function insideBack(backNeck: Path, frontNeck: Path): PathShape {
  const backPts = flattenPath(backNeck, 0.04);
  const front = flattenPath(frontNeck, 0.04);
  return mk(polyPath([...backPts, ...front.slice(1)], true), { stroke: null, width: 0, fill: AVESSO }, true);
}

export { trim, line, curve };
export const cuffBand = (s: Sleeve, h: number): Path => {
  const back = times(s.dir, -h);
  return polyPath([s.top, s.bottom, plus(s.bottom, back), plus(s.top, back)], true);
};
export const shapeList = (...xs: (Shape | Shape[] | null | undefined | false)[]): Shape[] => xs.flatMap((x) => (x ? (Array.isArray(x) ? x : [x]) : []));

/**
 * Construtor de caminho com controle das tangentes (retas e Béziers), em cm.
 * Regra dos guias: toda curva que encosta no centro (decote, barra, cós) chega a 90°,
 * para a peça espelhada não ganhar bico.
 */
export class PathB {
  private start: Vec2;
  private segs: Path['segments'] = [];
  private cur: Vec2;
  constructor(x: number, y: number) {
    this.start = P(x, y);
    this.cur = this.start;
  }
  L(x: number, y: number) {
    this.cur = P(x, y);
    this.segs.push({ kind: 'line', to: this.cur });
    return this;
  }
  C(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    this.cur = P(x, y);
    this.segs.push({ kind: 'cubic', c1: P(c1x, c1y), c2: P(c2x, c2y), to: this.cur });
    return this;
  }
  /** Curva suave até (x, y) saindo na direção `t0` e chegando na direção `t1` (vetores), com "força" k. */
  S(x: number, y: number, t0: Vec2, t1: Vec2, k = 0.38) {
    const a = this.cur, b = P(x, y);
    const d = Math.hypot(b.x - a.x, b.y - a.y) * k;
    const n0 = Math.hypot(t0.x, t0.y) || 1, n1 = Math.hypot(t1.x, t1.y) || 1;
    return this.C(a.x + (t0.x / n0) * d, a.y + (t0.y / n0) * d, b.x - (t1.x / n1) * d, b.y - (t1.y / n1) * d, x, y);
  }
  get end() {
    return this.cur;
  }
  path(closed = false): Path {
    const segs = [...this.segs];
    if (closed && (this.cur.x !== this.start.x || this.cur.y !== this.start.y)) segs.push({ kind: 'line', to: this.start });
    return { start: this.start, segments: segs, closed };
  }
}
export const pb = (x: number, y: number) => new PathB(x, y);
