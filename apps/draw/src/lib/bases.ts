/**
 * Peças base paramétricas para desenho técnico (flat). Cada peça é desenhada pela metade e
 * espelhada no centro; detalhes que não são simétricos (carcela, braguilha, bolso de um lado só)
 * ficam sem espelho. Medidas em cm da peça real (desenho em 1:10 → 1 cm = 1 mm).
 */
import { type Path, type Vec2, flattenPath } from '@cad-textil/core';
import { offsetPolyline, polyPath } from '../model/geom';
import type { Shape } from '../model/types';
import { type Pt, curve, detail, line, outline, patch, stitch, trim } from './kit';

export type Vista = 'frente' | 'costas';

export interface OptionDef {
  key: string;
  label: string;
  choices?: { value: string; label: string }[];
  /** Campo numérico (cm). */
  min?: number;
  max?: number;
}

export interface BaseDef {
  id: string;
  label: string;
  /** Categoria na biblioteca. */
  cat: 'Superiores' | 'Inferiores' | 'Inteiras';
  options: OptionDef[];
  defaults: Record<string, string | number>;
  make(o: Record<string, string | number>, vista: Vista): Shape[];
}

const deg = (a: number) => (a * Math.PI) / 180;
const P = (x: number, y: number): Vec2 => ({ x, y });
const add = (a: Vec2, b: Vec2) => P(a.x + b.x, a.y + b.y);
const mul = (a: Vec2, k: number) => P(a.x * k, a.y * k);
const pt = (v: Vec2, c = false): Pt => (c ? [v.x, v.y, 'c'] : [v.x, v.y]);

/** Desloca uma linha (a `d` cm, + = esquerda do sentido) e leva a 1ª ponta até o eixo x = 0. */
function offsetToAxis(path: Path, d: number, toAxisStart = true): Path {
  const pts = offsetPolyline(flattenPath(path, 0.05), d);
  if (toAxisStart && pts.length > 1) {
    const a = pts[0]!, b = pts[1]!;
    if (Math.abs(b.x - a.x) > 1e-9) {
      const t = -a.x / (b.x - a.x);
      pts[0] = P(0, a.y + t * (b.y - a.y));
    }
  }
  return polyPath(pts);
}

/* ------------------------------------------------------------------ */
/* Mangas                                                              */
/* ------------------------------------------------------------------ */

type Manga = 'sem' | 'curta' | '3/4' | 'longa';

interface SleeveGeo {
  /** Pontos do contorno entre o ombro e a cava (sem incluí-los). */
  pts: Vec2[];
  /** Linha da barra da manga (de cima para baixo). */
  hem: [Vec2, Vec2] | null;
  /** Direção do braço (para linhas paralelas à barra). */
  dir: Vec2;
}

function sleeve(S: Vec2, kind: Manga, cuff = 0): SleeveGeo {
  const spec = { curta: [32, 19, 15.5], '3/4': [50, 42, 12], longa: [62, 60, 9.5 + cuff * 0.1], sem: [0, 0, 0] }[kind];
  if (kind === 'sem') return { pts: [], hem: null, dir: P(0, 1) };
  const [a, L, w] = spec as [number, number, number];
  const dir = P(Math.cos(deg(a)), Math.sin(deg(a)));
  const T = add(S, mul(dir, L));
  const B = add(T, mul(P(-dir.y, dir.x), w));
  return { pts: [T, B], hem: [T, B], dir };
}

/** Linha paralela à barra da manga, `d` cm para dentro. */
const sleeveLine = (g: SleeveGeo, d: number): Path => line([g.hem![0].x - g.dir.x * d, g.hem![0].y - g.dir.y * d], [g.hem![1].x - g.dir.x * d, g.hem![1].y - g.dir.y * d]);

/* ------------------------------------------------------------------ */
/* Decotes                                                             */
/* ------------------------------------------------------------------ */

type Gola = 'careca' | 'v' | 'canoa' | 'polo' | 'colarinho' | 'padre';

function neck(nw: number, nd: number, gola: Gola): Pt[] {
  if (gola === 'v') return [[0, nd, 'c'], [nw, 0, 'c']];
  if (gola === 'canoa') return [[0, nd, 'c'], [nw * 0.6, nd * 0.78], [nw, 0, 'c']];
  return [[0, nd, 'c'], [nw * 0.45, nd * 0.95], [nw * 0.86, nd * 0.5], [nw, 0, 'c']];
}

/** Ribana do decote: linha interna + pesponto de cobertura. */
function neckRib(nw: number, nd: number, gola: Gola, rib = 1.6): Shape[] {
  const c = curve(neck(nw, nd, gola));
  return [detail(offsetToAxis(c, -rib)), stitch(offsetToAxis(c, -rib - 0.45), 'galoneira')];
}

/* ------------------------------------------------------------------ */
/* Superiores                                                          */
/* ------------------------------------------------------------------ */

interface TopSpec {
  hw: number;
  L: number;
  nw: number;
  nd: number;
  gola: Gola;
  manga: Manga;
  /** Cava (y) no lado. */
  cava: number;
  /** Barra arredondada (camisa). */
  shirttail?: boolean;
  cuff?: number;
}

function topOutline(s: TopSpec) {
  const S = P(s.nw + 12.5, 4.3);
  const g = sleeve(S, s.manga, s.cuff);
  const U = P(s.hw, s.cava);
  const pts: Pt[] = [...neck(s.nw, s.nd, s.gola)];
  if (s.manga === 'sem') {
    const st = P(s.nw + 5, 1.1);
    pts.push(pt(st, true), [st.x + 1.2, s.cava * 0.55], [s.hw - 2.5, s.cava - 1.5], pt(U, true));
  } else {
    pts.push(pt(S, true), ...g.pts.map((p) => pt(p, true)), pt(U, true));
  }
  if (s.shirttail) pts.push([s.hw, s.L - 8, 'c'], [s.hw - 5, s.L - 4.6], [s.hw - 13, s.L - 1.2], [0, s.L, 'c']);
  else pts.push([s.hw, s.L, 'c'], [0, s.L, 'c']);
  return { path: curve(pts), S, U, g };
}

/** Costura da cava (manga montada). */
const armhole = (S: Vec2, U: Vec2) => curve([pt(S, true), [U.x - 2.4, S.y + (U.y - S.y) * 0.55], pt(U, true)]);

const camiseta: BaseDef = {
  id: 'camiseta',
  label: 'Camiseta',
  cat: 'Superiores',
  options: [
    { key: 'gola', label: 'Gola', choices: [{ value: 'careca', label: 'Careca' }, { value: 'v', label: 'V' }, { value: 'canoa', label: 'Canoa' }] },
    { key: 'manga', label: 'Manga', choices: [{ value: 'curta', label: 'Curta' }, { value: '3/4', label: '3/4' }, { value: 'longa', label: 'Longa' }] },
    { key: 'largura', label: 'Largura (busto 1/2)', min: 30, max: 80 },
    { key: 'comprimento', label: 'Comprimento', min: 30, max: 110 },
  ],
  defaults: { gola: 'careca', manga: 'curta', largura: 51, comprimento: 68 },
  make(o, vista) {
    const gola = o.gola as Gola;
    const nw = gola === 'canoa' ? 11 : 8.5;
    const nd = vista === 'costas' ? 2 : gola === 'v' ? 15 : gola === 'canoa' ? 4.5 : 8.5;
    const s: TopSpec = { hw: Number(o.largura) / 2, L: Number(o.comprimento), nw, nd, gola: vista === 'costas' ? 'careca' : gola, manga: o.manga as Manga, cava: 23 };
    const { path, S, U, g } = topOutline(s);
    const out: Shape[] = [outline(path, true, 'Corpo'), detail(armhole(S, U)), ...neckRib(nw, nd, s.gola)];
    if (g.hem) out.push(stitch(sleeveLine(g, 2.2), 'galoneira'));
    out.push(stitch(line([0, s.L - 2.4], [s.hw, s.L - 2.4]), 'galoneira'));
    return out;
  },
};

const regata: BaseDef = {
  id: 'regata',
  label: 'Regata',
  cat: 'Superiores',
  options: [
    { key: 'largura', label: 'Largura (busto 1/2)', min: 30, max: 80 },
    { key: 'comprimento', label: 'Comprimento', min: 30, max: 110 },
  ],
  defaults: { largura: 48, comprimento: 66 },
  make(o, vista) {
    const nw = 9.5, nd = vista === 'costas' ? 6 : 12;
    const s: TopSpec = { hw: Number(o.largura) / 2, L: Number(o.comprimento), nw, nd, gola: 'careca', manga: 'sem', cava: 22 };
    const { path } = topOutline(s);
    const st = P(nw + 5, 1.1);
    const cava = curve([pt(st, true), [st.x + 1.2, s.cava * 0.55], [s.hw - 2.5, s.cava - 1.5], [s.hw, s.cava, 'c']]);
    return [
      outline(path, true, 'Corpo'),
      ...neckRib(nw, nd, 'careca', 1.4),
      detail(offsetToAxis(cava, -1.4, false)),
      stitch(offsetToAxis(cava, -1.85, false), 'galoneira'),
      stitch(line([0, s.L - 2.4], [s.hw, s.L - 2.4]), 'galoneira'),
    ];
  },
};

const camisa: BaseDef = {
  id: 'camisa',
  label: 'Camisa social',
  cat: 'Superiores',
  options: [
    { key: 'manga', label: 'Manga', choices: [{ value: 'longa', label: 'Longa' }, { value: 'curta', label: 'Curta' }] },
    { key: 'bolso', label: 'Bolso', choices: [{ value: 'sim', label: 'Com bolso' }, { value: 'nao', label: 'Sem bolso' }] },
    { key: 'largura', label: 'Largura (busto 1/2)', min: 30, max: 80 },
    { key: 'comprimento', label: 'Comprimento', min: 40, max: 110 },
  ],
  defaults: { manga: 'longa', bolso: 'sim', largura: 54, comprimento: 76 },
  make(o, vista) {
    const nw = 8, nd = vista === 'costas' ? 1.5 : 7.5;
    const s: TopSpec = { hw: Number(o.largura) / 2, L: Number(o.comprimento), nw, nd, gola: 'careca', manga: o.manga as Manga, cava: 24, shirttail: true, cuff: 6 };
    const { path, S, U, g } = topOutline(s);
    const out: Shape[] = [];
    // pé de gola atrás do decote
    out.push(patch(curve([[0, -2.3, 'c'], [nw - 0.4, -1.6, 'c'], [nw, 0.3, 'c'], [0, 1.1, 'c']])));
    out.push(outline(path, true, 'Corpo'), detail(armhole(S, U)));
    if (g.hem) {
      if (s.manga === 'longa') {
        out.push(detail(sleeveLine(g, 6)), stitch(sleeveLine(g, 5.6), 'simples'));
        const c = add(g.hem[1], add(mul(g.dir, -3), mul(P(g.dir.y, -g.dir.x), 1.5)));
        out.push(trim('botao4', c.x, c.y, true, 1.1));
      } else out.push(stitch(sleeveLine(g, 2), 'simples'));
    }
    if (vista === 'frente') {
      // colarinho (duas pontas)
      out.push(patch(curve([[0.5, nd - 0.8, 'c'], [nw - 0.4, -1.4, 'c'], [nw + 0.9, 1.4], [8.8, nd + 4.6, 'c'], [3.6, nd + 2.6], [1.2, nd + 0.6, 'c']], true)));
      out.push(stitch(curve([[nw + 0.25, 1.3], [8.2, nd + 3.9, 'c'], [3.4, nd + 2]]), 'simples'));
      // carcela e botões
      out.push(detail(line([-1.6, nd + 1.2], [-1.6, s.L - 0.6]), false), detail(line([1.6, nd + 1.2], [1.6, s.L - 0.1]), false));
      out.push(stitch(line([1.25, nd + 1.4], [1.25, s.L - 0.4]), 'simples', false));
      for (let y = nd + 3; y < s.L - 7; y += 9) out.push(trim('botao4', 0, y, false, 1.15));
      if (o.bolso === 'sim') {
        out.push(patch(curve([[5, 17, 'c'], [16, 17, 'c'], [16, 28.5, 'c'], [10.5, 30.5, 'c'], [5, 28.5, 'c']], true), false));
        out.push(stitch(line([5.2, 18.8], [15.8, 18.8]), 'simples', false));
      }
    } else {
      // pala e prega macho nas costas
      const yoke = 12;
      out.push(detail(line([0, yoke], [s.hw - 2.6, yoke])), stitch(line([0, yoke + 0.4], [s.hw - 2.6, yoke + 0.4]), 'simples'));
      out.push(detail(line([-1.5, yoke], [-1.5, yoke + 3.5]), false), detail(line([1.5, yoke], [1.5, yoke + 3.5]), false));
    }
    out.push(stitch(curve([[0, s.L - 0.8, 'c'], [s.hw - 13, s.L - 2], [s.hw - 5, s.L - 5.4], [s.hw - 0.3, s.L - 8.6, 'c']]), 'simples'));
    return out;
  },
};

const moletom: BaseDef = {
  id: 'moletom',
  label: 'Moletom',
  cat: 'Superiores',
  options: [
    { key: 'bolso', label: 'Bolso', choices: [{ value: 'canguru', label: 'Canguru' }, { value: 'nao', label: 'Sem bolso' }] },
    { key: 'largura', label: 'Largura (busto 1/2)', min: 30, max: 80 },
    { key: 'comprimento', label: 'Comprimento', min: 40, max: 110 },
  ],
  defaults: { bolso: 'canguru', largura: 58, comprimento: 70 },
  make(o, vista) {
    const nw = 9, nd = vista === 'costas' ? 2.2 : 9;
    const s: TopSpec = { hw: Number(o.largura) / 2, L: Number(o.comprimento), nw, nd, gola: 'careca', manga: 'longa', cava: 26, cuff: 0 };
    const { path, S, U, g } = topOutline(s);
    const rib = { kind: 'pattern' as const, pattern: 'canelado' as const, c1: '#ffffff', c2: '#7d7d86', scale: 0.5, angle: 0 };
    const ribBand = (p: Path): Shape => ({ ...patch(p), style: { stroke: '#1b1b1f', width: 0.28, fill: rib } });
    const out: Shape[] = [outline(path, true, 'Corpo'), detail(armhole(S, U)), ...neckRib(nw, nd, 'careca', 2)];
    // barra de ribana
    out.push(ribBand(curve([[0, s.L - 7, 'c'], [s.hw - 0.4, s.L - 7, 'c'], [s.hw - 0.4, s.L, 'c'], [0, s.L, 'c']])));
    out.push(stitch(line([0, s.L - 7.5], [s.hw - 0.4, s.L - 7.5]), 'galoneira'));
    // punho de ribana
    if (g.hem) {
      const a = g.hem[0], b = g.hem[1];
      const back = mul(g.dir, -7);
      out.push(ribBand(polyPath([a, b, add(b, back), add(a, back)], true)));
    }
    if (vista === 'frente' && o.bolso === 'canguru') {
      const y0 = s.L - 25;
      const k = curve([[0, y0, 'c'], [12, y0, 'c'], [17.5, y0 + 10.5, 'c'], [17.5, s.L - 7.2, 'c'], [0, s.L - 7.2, 'c']]);
      out.push(patch(k), stitch(offsetToAxis(curve([[0, y0, 'c'], [12, y0, 'c'], [17.5, y0 + 10.5, 'c'], [17.5, s.L - 7.2, 'c']]), -0.6), 'duplo'));
    }
    return out;
  },
};

/* ------------------------------------------------------------------ */
/* Inferiores                                                          */
/* ------------------------------------------------------------------ */

interface PantsSpec {
  ww: number;
  hip: number;
  rise: number;
  L: number;
  hemOut: number;
  hemW: number;
}

function pantsOutline(p: PantsSpec): Path {
  const inner = p.hemOut - p.hemW;
  return curve([
    [0, 0, 'c'],
    [p.ww, 0, 'c'],
    [p.ww + (p.hip - p.ww) * 0.6, 9],
    [p.hip, 20],
    [p.hip - 0.6, Math.min(40, p.L * 0.6)],
    [p.hemOut, p.L, 'c'],
    [inner, p.L, 'c'],
    [inner * 0.75 + 0.6, (p.L + p.rise) * 0.55],
    [0.9, p.rise + 6],
    [0, p.rise, 'c'],
  ]);
}

const calca: BaseDef = {
  id: 'calca',
  label: 'Calça jeans 5 bolsos',
  cat: 'Inferiores',
  options: [
    { key: 'modelagem', label: 'Modelagem', choices: [{ value: 'reta', label: 'Reta' }, { value: 'skinny', label: 'Skinny' }, { value: 'wide', label: 'Wide leg' }] },
    { key: 'cintura', label: 'Cintura (1/2)', min: 25, max: 70 },
    { key: 'comprimento', label: 'Comprimento', min: 60, max: 120 },
  ],
  defaults: { modelagem: 'reta', cintura: 40, comprimento: 104 },
  make(o, vista) {
    const ww = Number(o.cintura) / 2;
    const L = Number(o.comprimento);
    const leg = { reta: [ww + 1.2, 18], skinny: [ww - 1.5, 13.5], wide: [ww + 7, 28] }[o.modelagem as 'reta'] ?? [ww + 1.2, 18];
    const p: PantsSpec = { ww, hip: ww + 4, rise: 27, L, hemOut: leg[0]!, hemW: leg[1]! };
    const inner = p.hemOut - p.hemW;
    const out: Shape[] = [outline(pantsOutline(p), true, 'Calça')];
    out.push(detail(line([0, 4], [ww + 0.25, 4])), stitch(line([0, 0.55], [ww + 0.05, 0.55]), 'simples'), stitch(line([0, 3.45], [ww + 0.2, 3.45]), 'simples'));
    out.push(stitch(line([inner, L - 2.4], [p.hemOut, L - 2.4]), 'duplo'));
    // passantes
    for (const x of [ww * 0.5, ww - 1.2]) out.push(patch(polyPath([P(x - 0.6, -0.4), P(x + 0.6, -0.4), P(x + 0.6, 4.8), P(x - 0.6, 4.8)], true)));
    if (vista === 'frente') {
      const bolso = curve([[ww * 0.62, 4, 'c'], [ww * 0.78, 9.8], [p.hip - 1.4, 13.2, 'c']]);
      out.push(detail(bolso), stitch(offsetToAxis(bolso, 0.6, false), 'duplo'));
      out.push(trim('rebite', ww * 0.62 + 0.3, 4.6, true, 0.8));
      // relojinho (só de um lado), braguilha em J e botão
      out.push(detail(polyPath([P(-ww + 1.8, 5.2), P(-ww * 0.62 - 0.4, 5.2), P(-ww * 0.62 - 1.6, 10.6)]), false));
      out.push(detail(line([0, 4], [0, 19.5]), false));
      out.push(stitch(curve([[-3.6, 4, 'c'], [-3.6, 15], [-2.6, 18.2], [0, 19.5, 'c']]), 'duplo', false));
      out.push(trim('botaoJeans', 0, 2, false, 1.7));
    } else {
      const pala = curve([[0, 10, 'c'], [ww * 0.6, 8], [p.hip - 0.2, 5.5, 'c']]);
      out.push(detail(pala), stitch(offsetToAxis(pala, -0.5), 'duplo'));
      out.push(detail(line([0, 4], [0, p.rise]), false), stitch(line([0.5, 10.4], [0.5, p.rise - 0.5]), 'duplo', false));
      const bolso = polyPath([P(5.5, 13), P(17, 12), P(17.4, 24), P(11.4, 26.6), P(5.9, 24.4)], true);
      out.push(patch(bolso), stitch(line([5.7, 14.4], [17.1, 13.4]), 'duplo'), stitch(curve([[7, 17.5, 'c'], [11.4, 20.6], [16.2, 16.8, 'c']]), 'duplo'));
      out.push(patch(polyPath([P(-14, 1), P(-8.4, 1), P(-8.4, 3.3), P(-14, 3.3)], true), false));
    }
    return out;
  },
};

const shorts: BaseDef = {
  id: 'shorts',
  label: 'Shorts com elástico',
  cat: 'Inferiores',
  options: [
    { key: 'cintura', label: 'Cintura (1/2, relaxada)', min: 25, max: 70 },
    { key: 'comprimento', label: 'Comprimento', min: 25, max: 60 },
  ],
  defaults: { cintura: 44, comprimento: 44 },
  make(o, vista) {
    const ww = Number(o.cintura) / 2;
    const L = Number(o.comprimento);
    const p: PantsSpec = { ww, hip: ww + 3, rise: 28, L, hemOut: ww + 4, hemW: ww + 1.2 };
    const out: Shape[] = [outline(pantsOutline(p), true, 'Shorts')];
    const inner = p.hemOut - p.hemW;
    out.push(detail(line([0, 4.5], [ww + 0.4, 4.5])), stitch(line([0, 2.25], [ww + 0.2, 2.25]), 'elastico'));
    out.push(stitch(line([inner, L - 2.2], [p.hemOut, L - 2.2]), 'galoneira'));
    if (vista === 'frente') {
      out.push(detail(line([ww - 0.5, 5.5], [p.hip - 0.4, 17])), stitch(line([ww - 1.1, 5.6], [p.hip - 1, 17]), 'simples'));
      out.push(trim('ilhos', -1.3, 2.4, false, 0.8), trim('ilhos', 1.3, 2.4, false, 0.8));
      out.push(detail(curve([[-1.3, 2.4, 'c'], [-2.2, 7], [-2.8, 12.5, 'c']]), false, { width: 0.32 }), detail(curve([[1.3, 2.4, 'c'], [2, 7.5], [3.2, 13, 'c']]), false, { width: 0.32 }));
      out.push(trim('terminal', -2.8, 13.3, false, 1.4), trim('terminal', 3.2, 13.8, false, 1.4));
    } else {
      out.push(detail(line([0, 4.5], [0, p.rise]), false));
      out.push(patch(polyPath([P(6, 11), P(16, 11), P(16, 21), P(6, 21)], true)), stitch(line([6.2, 12.6], [15.8, 12.6]), 'simples'));
    }
    return out;
  },
};

const saia: BaseDef = {
  id: 'saia',
  label: 'Saia',
  cat: 'Inferiores',
  options: [
    { key: 'modelo', label: 'Modelo', choices: [{ value: 'reta', label: 'Reta' }, { value: 'evase', label: 'Evasê' }, { value: 'gode', label: 'Godê' }] },
    { key: 'cintura', label: 'Cintura (1/2)', min: 25, max: 70 },
    { key: 'comprimento', label: 'Comprimento', min: 30, max: 110 },
  ],
  defaults: { modelo: 'reta', cintura: 36, comprimento: 58 },
  make(o, vista) {
    const ww = Number(o.cintura) / 2;
    const L = Number(o.comprimento);
    const hip = ww + 5;
    const hx = { reta: hip - 0.5, evase: hip + 8, gode: hip + 21 }[o.modelo as 'reta'] ?? hip;
    const drop = o.modelo === 'gode' ? 4 : 0;
    const hemPts: Pt[] = drop ? [[hx, L, 'c'], [hx * 0.5, L + drop * 0.8], [0, L + drop, 'c']] : [[hx, L, 'c'], [0, L, 'c']];
    const body = curve([[0, 0, 'c'], [ww, 0, 'c'], [ww + 3.6, 9], [hip, 20], ...hemPts]);
    const out: Shape[] = [outline(body, true, 'Saia'), detail(line([0, 3.5], [ww + 0.2, 3.5])), stitch(line([0, 0.5], [ww + 0.05, 0.5]), 'simples')];
    const hem = drop ? curve([[0, L + drop - 2], [hx * 0.5, L + drop * 0.8 - 2], [hx - 0.3, L - 2]]) : line([0, L - 2], [hx - 0.1, L - 2]);
    out.push(stitch(hem, 'simples'));
    if (o.modelo === 'reta') out.push(detail(line([ww * 0.5, 3.5], [ww * 0.5 + 0.4, 13])));
    if (vista === 'costas') {
      out.push({ ...stitch(line([0, 3.5], [0, 21]), 'ziper', false), stitch: { type: 'ziper', gap: 0.9, len: 0.45, width: 0.12, color: '#1b1b1f' } });
      out.push(trim('cursor', 0, 4.8, false, 2));
      if (o.modelo === 'reta') out.push(detail(line([0, L - 12], [0, L]), false));
    }
    return out;
  },
};

/* ------------------------------------------------------------------ */
/* Inteiras                                                            */
/* ------------------------------------------------------------------ */

const vestido: BaseDef = {
  id: 'vestido',
  label: 'Vestido',
  cat: 'Inteiras',
  options: [
    { key: 'manga', label: 'Manga', choices: [{ value: 'sem', label: 'Alça' }, { value: 'curta', label: 'Curta' }] },
    { key: 'saia', label: 'Saia', choices: [{ value: 'evase', label: 'Evasê' }, { value: 'reta', label: 'Reta' }, { value: 'gode', label: 'Godê' }] },
    { key: 'comprimento', label: 'Comprimento', min: 50, max: 150 },
  ],
  defaults: { manga: 'sem', saia: 'evase', comprimento: 98 },
  make(o, vista) {
    const L = Number(o.comprimento);
    const hw = 23.5, waist = 39, ww = 17.5;
    const nw = o.manga === 'sem' ? 9.5 : 8.5;
    const nd = vista === 'costas' ? (o.manga === 'sem' ? 7 : 2) : o.manga === 'sem' ? 13 : 9;
    const hx = { reta: 24, evase: 33, gode: 46 }[o.saia as 'reta'] ?? 33;
    const drop = o.saia === 'gode' ? 4 : 0;
    const pts: Pt[] = [...neck(nw, nd, 'careca')];
    const S = P(nw + 12.5, 4.3);
    let g: SleeveGeo | null = null;
    if (o.manga === 'sem') {
      const st = P(nw + 5, 1.1);
      pts.push(pt(st, true), [st.x + 1.2, 12], [hw - 2.5, 20.5], [hw, 22, 'c']);
    } else {
      g = sleeve(S, 'curta');
      pts.push(pt(S, true), ...g.pts.map((p) => pt(p, true)), [hw, 22, 'c']);
    }
    pts.push([hw - 1, 30], [ww, waist, 'c'], [ww + 4, waist + 10], [hx * 0.55 + 10, waist + 25]);
    if (drop) pts.push([hx, L, 'c'], [hx * 0.5, L + drop * 0.8], [0, L + drop, 'c']);
    else pts.push([hx, L, 'c'], [0, L, 'c']);
    const out: Shape[] = [outline(curve(pts), true, 'Vestido'), detail(line([0, waist], [ww, waist]))];
    if (g) out.push(detail(armhole(S, P(hw, 22))), stitch(sleeveLine(g, 2), 'simples'));
    out.push(detail(offsetToAxis(curve(neck(nw, nd, 'careca')), -0.9)));
    out.push(detail(line([8.5, waist], [9.3, waist - 9.5])));
    const hem = drop ? curve([[0, L + drop - 2], [hx * 0.5, L + drop * 0.8 - 2], [hx - 0.3, L - 2]]) : line([0, L - 2], [hx - 0.1, L - 2]);
    out.push(stitch(hem, 'simples'));
    if (vista === 'costas') {
      out.push({ ...stitch(line([0, nd + 0.5], [0, waist + 16]), 'ziper', false), stitch: { type: 'ziper', gap: 0.9, len: 0.45, width: 0.12, color: '#1b1b1f' } });
      out.push(trim('cursor', 0, nd + 1.8, false, 2));
    }
    return out;
  },
};

export const BASES: BaseDef[] = [camiseta, regata, camisa, moletom, calca, shorts, saia, vestido];

export const baseById = (id: string) => BASES.find((b) => b.id === id);
