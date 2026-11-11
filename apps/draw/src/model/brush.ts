/**
 * Pincéis: o traço vira uma forma vetorial (contorno preenchido) com espessura variável.
 * Sai igual na tela, no SVG e no PDF da ficha.
 */
import { type Path, type Vec2, add, flattenPath, normalize, scale, sub } from '@cad-textil/core';
import { cumLength, dedupe } from './geom';
import type { Brush, BrushKind } from './types';

export const BRUSH_LABEL: Record<BrushKind, string> = {
  caligrafico: 'Caligráfico',
  afinado: 'Afinado nas pontas',
  marcador: 'Marcador',
  grafite: 'Grafite (esboço)',
};

const r = (n: number) => Math.round(n * 1000) / 1000;
const poly = (pts: Vec2[], close = true) => (pts.length ? `M${pts.map((p) => `${r(p.x)} ${r(p.y)}`).join('L')}${close ? 'Z' : ''}` : '');

/** Ruído determinístico em [-1, 1] (o esboço não muda a cada redesenho). */
function noise(i: number, seed: number) {
  const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** Ruído suave ao longo do traço (varia devagar, como a mão no lápis). */
function smoothNoise(x: number, seed: number) {
  const i = Math.floor(x), f = x - i;
  const t = (1 - Math.cos(f * Math.PI)) / 2;
  return noise(i, seed) * (1 - t) + noise(i + 1, seed) * t;
}

/** Normal (esquerda) em cada ponto, média das arestas vizinhas. */
function normals(pts: Vec2[], closed: boolean): Vec2[] {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = closed ? pts[(i - 1 + n) % n]! : pts[Math.max(0, i - 1)]!;
    const b = closed ? pts[(i + 1) % n]! : pts[Math.min(n - 1, i + 1)]!;
    const u = normalize(sub(b, a));
    return { x: u.y, y: -u.x };
  });
}

function densify(pts: Vec2[], closed: boolean, step: number): Vec2[] {
  const out: Vec2[] = [];
  const n = pts.length;
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const a = pts[i]!, b = pts[(i + 1) % n]!;
    const k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let j = 0; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
  }
  if (!closed) out.push(pts[n - 1]!);
  return out;
}

export interface BrushRender {
  /** Contorno preenchido (cor do traço). */
  fill: string;
  /** Traços finos extras (grafite). */
  strokes: { d: string; width: number; opacity: number }[];
}

/** Desenho do pincel ao longo do caminho. */
export function brushRender(path: Path, b: Brush): BrushRender {
  let pts = dedupe(flattenPath(path, 0.03));
  const closed = path.closed;
  if (closed && pts.length > 2) {
    const f = pts[0]!, l = pts[pts.length - 1]!;
    if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-6) pts = pts.slice(0, -1);
  }
  if (pts.length < 2) return { fill: '', strokes: [] };
  // pontos bem distribuídos para a espessura variar ao longo de retas longas também
  pts = densify(pts, closed, Math.max(0.25, b.size * 0.5));
  const nr = normals(pts, closed);
  const cum = cumLength(closed ? [...pts, pts[0]!] : pts);
  const total = cum[cum.length - 1] || 1;
  const half = b.size / 2;

  if (b.kind === 'grafite') {
    // 3 passadas finas e levemente tremidas, como lápis
    // 3 passadas finas, cada uma desviando devagar (comprimento de onda ~ 6× a espessura)
    const wave = Math.max(1, b.size * 6);
    const strokes = [0, 1, 2].map((k) => {
      const line = pts.map((p, i) => add(p, scale(nr[i]!, smoothNoise(cum[i]! / wave, k + 1) * half * 0.45 + (k - 1) * half * 0.18)));
      return { d: poly(closed ? [...line, line[0]!] : line, false), width: Math.max(0.05, b.size * 0.16), opacity: k === 1 ? 0.95 : 0.5 };
    });
    return { fill: '', strokes };
  }

  const width = (i: number): number => {
    const t = cum[i]! / total;
    if (b.kind === 'afinado') return closed ? half : half * Math.max(0.06, Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.55));
    if (b.kind === 'caligrafico') {
      const a = ((b.angle ?? 35) * Math.PI) / 180;
      const pen = { x: Math.cos(a), y: Math.sin(a) };
      const n = nr[i]!;
      // largura = projeção da ponta chata sobre a normal do traço
      return half * Math.max(0.12, Math.abs(n.x * pen.x + n.y * pen.y));
    }
    return half; // marcador
  };
  const left = pts.map((p, i) => add(p, scale(nr[i]!, width(i))));
  const right = pts.map((p, i) => sub(p, scale(nr[i]!, width(i))));
  if (closed) return { fill: poly(left) + poly([...right].reverse()), strokes: [] };
  if (b.kind === 'marcador') {
    // pontas redondas
    const cap = (c: Vec2, dir: Vec2) => Array.from({ length: 9 }, (_, k) => {
      const ang = Math.atan2(dir.y, dir.x) - Math.PI / 2 + (Math.PI * k) / 8;
      return { x: c.x + Math.cos(ang) * half, y: c.y + Math.sin(ang) * half };
    });
    const end = pts[pts.length - 1]!, start = pts[0]!;
    const dEnd = normalize(sub(end, pts[pts.length - 2]!)), dStart = normalize(sub(start, pts[1]!));
    return { fill: poly([...left, ...cap(end, dEnd).slice(1, -1), ...[...right].reverse(), ...cap(start, dStart).slice(1, -1)]), strokes: [] };
  }
  return { fill: poly([...left, ...[...right].reverse()]), strokes: [] };
}
