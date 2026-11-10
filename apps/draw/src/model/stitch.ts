/**
 * Desenho dos pespontos e trilhas (zíper, franzido, elástico) ao longo de um caminho.
 * Tudo vira traços SVG simples (vetoriais), para sair igual na tela, no SVG e no PDF.
 */
import { type Path, type Vec2, add, flattenPath, scale } from '@cad-textil/core';
import { cumLength, dedupe, mirrored, offsetPolyline, pathD, pointAt, polyPath } from './geom';
import type { StitchShape, StitchStyle, StitchType } from './types';

export interface Stroke {
  d: string;
  width: number;
  dash?: string;
  /** Preenchido (ex.: dentes do zíper). */
  fill?: boolean;
}

export const STITCH_LABEL: Record<StitchType, string> = {
  simples: 'Pesponto simples',
  duplo: 'Pesponto duplo',
  triplo: 'Pesponto triplo',
  zigue: 'Zigue-zague',
  galoneira: 'Galoneira (cobertura)',
  overloque: 'Overloque',
  corrente: 'Ponto corrente',
  alinhavo: 'Alinhavo',
  ziper: 'Zíper',
  franzido: 'Franzido',
  elastico: 'Elástico',
};

/** Valores iniciais de cada tipo (mm no desenho, escala 1:10). */
export const STITCH_DEFAULT: Record<StitchType, Omit<StitchStyle, 'type' | 'color'>> = {
  simples: { gap: 0, len: 0.8, width: 0.12 },
  duplo: { gap: 0.6, len: 0.8, width: 0.12 },
  triplo: { gap: 0.5, len: 0.8, width: 0.12 },
  zigue: { gap: 0.6, len: 0.6, width: 0.12 },
  galoneira: { gap: 0.6, len: 0.8, width: 0.12 },
  overloque: { gap: 0.7, len: 0.5, width: 0.1 },
  corrente: { gap: 0.5, len: 0.9, width: 0.1 },
  alinhavo: { gap: 0, len: 2.2, width: 0.12 },
  ziper: { gap: 0.9, len: 0.45, width: 0.12 },
  franzido: { gap: 1.2, len: 0.7, width: 0.1 },
  elastico: { gap: 1.2, len: 0.35, width: 0.1 },
};

const lineD = (pts: Vec2[]) => pathD(polyPath(pts));

/** Ondas ao longo da linha: amplitude `amp` (para a esquerda +), passo `step`. */
function wave(pts: Vec2[], amp: number, step: number, sharp = true, a0 = 0): Vec2[] {
  const cum = cumLength(pts);
  const total = cum[cum.length - 1]!;
  const n = Math.max(2, Math.round(total / step));
  const out: Vec2[] = [];
  for (let k = 0; k <= n; k++) {
    const { p, dir } = pointAt(pts, cum, (k / n) * total);
    const nl = { x: dir.y, y: -dir.x };
    const side = sharp ? (k % 2 ? 1 : -1) : Math.sin((k / n) * total * (Math.PI / step));
    out.push(add(p, scale(nl, a0 + amp * side)));
  }
  return out;
}

/** Marcas perpendiculares ao longo da linha, de `from` a `to` (deslocamentos laterais). */
function ticks(pts: Vec2[], step: number, from: number, to: number, alt?: [number, number]): string {
  const cum = cumLength(pts);
  const total = cum[cum.length - 1]!;
  const n = Math.max(1, Math.floor(total / step));
  let d = '';
  for (let k = 0; k <= n; k++) {
    const { p, dir } = pointAt(pts, cum, (k + 0.5) * (total / (n + 1)));
    const nl = { x: dir.y, y: -dir.x };
    const [a, b] = alt && k % 2 ? alt : [from, to];
    d += lineD([add(p, scale(nl, a)), add(p, scale(nl, b))]);
  }
  return d;
}

function dashOf(st: StitchStyle) {
  return `${st.len} ${st.len * 0.6}`;
}

/** Traços de UM caminho (sem simetria). */
export function stitchStrokes(path: Path, st: StitchStyle): Stroke[] {
  const pts = dedupe(flattenPath(path, 0.03));
  if (pts.length < 2) return [];
  const closed = path.closed;
  const off = (d: number) => lineD(closed ? [...offsetPolyline(pts, d, true), offsetPolyline(pts, d, true)[0]!] : offsetPolyline(pts, d));
  const w = st.width;
  const g = st.gap;
  const loop = closed ? [...pts, pts[0]!] : pts;
  switch (st.type) {
    case 'simples':
      return [{ d: lineD(loop), width: w, dash: dashOf(st) }];
    case 'alinhavo':
      return [{ d: lineD(loop), width: w, dash: `${st.len} ${st.len * 0.8}` }];
    case 'duplo':
      return [off(g / 2), off(-g / 2)].map((d) => ({ d, width: w, dash: dashOf(st) }));
    case 'triplo':
      return [off(g), lineD(loop), off(-g)].map((d) => ({ d, width: w, dash: dashOf(st) }));
    case 'zigue':
      return [{ d: lineD(wave(loop, g / 2, st.len)), width: w }];
    case 'galoneira':
      return [
        ...[off(g / 2), off(-g / 2)].map((d) => ({ d, width: w, dash: dashOf(st) })),
        { d: lineD(wave(loop, g / 2, st.len * 0.9)), width: w * 0.6 },
      ];
    case 'overloque':
      return [
        { d: off(g / 2), width: w },
        { d: lineD(wave(loop, g / 2, st.len)), width: w * 0.8 },
      ];
    case 'corrente': {
      // elos: pequenas ovais encadeadas
      const cum = cumLength(loop);
      const total = cum[cum.length - 1]!;
      const n = Math.max(1, Math.round(total / st.len));
      let d = '';
      for (let k = 0; k < n; k++) {
        const a = pointAt(loop, cum, (k / n) * total);
        const b = pointAt(loop, cum, ((k + 1) / n) * total);
        const nl = { x: a.dir.y, y: -a.dir.x };
        const h = scale(nl, g / 2);
        const m1 = add(a.p, scale({ x: b.p.x - a.p.x, y: b.p.y - a.p.y }, 0.5));
        d += `M${a.p.x} ${a.p.y}Q${m1.x + h.x} ${m1.y + h.y} ${b.p.x} ${b.p.y}Q${m1.x - h.x} ${m1.y - h.y} ${a.p.x} ${a.p.y}`;
      }
      return [{ d, width: w }];
    }
    case 'ziper':
      return [
        { d: lineD(loop), width: w },
        { d: ticks(loop, st.len, 0, g / 2, [0, -g / 2]), width: w * 1.6 },
        ...[off(g * 0.9), off(-g * 0.9)].map((d) => ({ d, width: w * 0.8, dash: `${st.len * 1.6} ${st.len}` })),
      ];
    case 'franzido':
      return [{ d: ticks(loop, st.len, -g / 2, g / 2, [-g / 3, g / 3]), width: w }];
    case 'elastico':
      return [
        { d: off(g / 2), width: w },
        { d: off(-g / 2), width: w },
        { d: ticks(loop, st.len, -g / 2, g / 2), width: w * 0.8 },
      ];
  }
}

/** Traços do pesponto com a simetria aplicada. */
export function stitchShapeStrokes(sh: StitchShape): Stroke[] {
  const paths = sh.mirror !== undefined ? mirrored(sh.path, sh.mirror) : [sh.path];
  return paths.flatMap((p) => stitchStrokes(p, sh.stitch));
}

/**
 * Pesponto entre duas distâncias ao longo de uma borda. Em contorno fechado usa o caminho mais curto
 * entre os dois pontos (pode passar pelo início do contorno).
 */
export function stitchAlong(pts: Vec2[], closed: boolean, s0: number, s1: number, dist: number, side: 1 | -1): Vec2[] {
  const cum = cumLength(pts);
  const total = cum[cum.length - 1]!;
  const a = Math.min(s0, s1), b = Math.max(s0, s1);
  if (closed && b - a > total / 2) {
    const first = pts[0]!, last = pts[pts.length - 1]!;
    const loop = Math.hypot(first.x - last.x, first.y - last.y) < 1e-9 ? pts : [...pts, first];
    const ring = [...loop.slice(0, -1), ...loop];
    const t = cumLength(loop)[loop.length - 1]!;
    return stitchLine(ring, b, t + a, dist, side);
  }
  return stitchLine(pts, a, b, dist, side);
}

/**
 * Linha central de um pesponto que acompanha `pts` (poligonal da borda) entre as distâncias s0 e s1,
 * a `dist` mm da borda para o lado `side` (+1 = esquerda do percurso).
 */
export function stitchLine(pts: Vec2[], s0: number, s1: number, dist: number, side: 1 | -1): Vec2[] {
  const cum = cumLength(pts);
  const a = Math.min(s0, s1), b = Math.max(s0, s1);
  const sub: Vec2[] = [pointAt(pts, cum, a).p];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i]! > a && cum[i]! < b) sub.push(pts[i]!);
  sub.push(pointAt(pts, cum, b).p);
  return offsetPolyline(dedupe(sub), dist * side);
}
