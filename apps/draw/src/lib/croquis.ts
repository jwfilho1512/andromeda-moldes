/**
 * Croquis: figuras base para desenhar a roupa por cima (camada Croqui).
 * Proporção de moda em "cabeças" (9 cabeças), traço leve, com grade opcional.
 */
import { newId } from '../state';
import type { PathShape, Shape, TextShape } from '../model/types';
import { type Pt, curve, line } from './kit';

export interface CroquiDef {
  id: string;
  label: string;
  make(): Shape[];
}

const SKIN = '#c9b8ad';
const GUIDE = '#7aa7ff';

const body = (pts: Pt[], u: number, closed = false, mirror = true): PathShape => ({
  kind: 'path',
  id: newId(),
  path: curve(pts.map((p) => (p.length === 3 ? [p[0] * u, p[1] * u, 'c'] : [p[0] * u, p[1] * u]) as Pt), closed),
  style: { stroke: SKIN, width: 0.35, fill: { kind: 'solid', color: '#fbf7f4' } },
  ...(mirror ? { mirror: 0 } : {}),
});

const guideLine = (x0: number, y: number, x1: number): PathShape => ({ kind: 'path', id: newId(), path: line([x0, y], [x1, y]), style: { stroke: GUIDE, width: 0.15, fill: null, dash: [1, 1] } });
const label = (x: number, y: number, text: string): TextShape => ({ kind: 'text', id: newId(), at: { x, y }, text, size: 3, color: GUIDE });

/** Silhueta em unidades de cabeça (u = altura da cabeça em mm). Metade direita, de cima para baixo. */
const FEM: Pt[] = [
  [0, 1.02, 'c'], [0.15, 1.02, 'c'], [0.17, 1.25], [0.86, 1.45, 'c'], [0.62, 2.05, 'c'], [0.66, 2.4], [0.47, 3.1], [0.78, 3.95], [0.68, 4.8],
  [0.47, 6.05], [0.48, 6.8], [0.24, 8.2], [0.29, 8.85, 'c'], [0.08, 8.92, 'c'], [0.1, 8.2], [0.14, 6.9], [0.12, 6.05], [0.07, 4.7], [0, 4.2, 'c'],
];
const FEM_ARM: Pt[] = [[0.86, 1.48, 'c'], [0.95, 2.4], [1.04, 3.4], [1.1, 4.25], [1.12, 4.85, 'c'], [0.95, 4.8, 'c'], [0.93, 4.2], [0.82, 3.3], [0.66, 2.2, 'c']];
const MASC: Pt[] = [
  [0, 1.02, 'c'], [0.2, 1.02, 'c'], [0.22, 1.3], [1.02, 1.5, 'c'], [0.74, 2.1, 'c'], [0.72, 2.6], [0.62, 3.2], [0.7, 3.95], [0.66, 4.8],
  [0.5, 6.05], [0.5, 6.8], [0.27, 8.2], [0.33, 8.85, 'c'], [0.08, 8.92, 'c'], [0.11, 8.2], [0.15, 6.9], [0.13, 6.05], [0.08, 4.7], [0, 4.2, 'c'],
];
const MASC_ARM: Pt[] = [[1.02, 1.53, 'c'], [1.1, 2.4], [1.16, 3.4], [1.2, 4.25], [1.22, 4.9, 'c'], [1.02, 4.85, 'c'], [1, 4.2], [0.9, 3.3], [0.76, 2.2, 'c']];

function figure(pts: Pt[], arm: Pt[], u: number, headW: number): Shape[] {
  const head: PathShape = {
    kind: 'path',
    id: newId(),
    path: curve([[0, 0, 'c'], [headW * u * 0.5, 0.12 * u], [headW * u * 0.55, 0.55 * u], [0.22 * u, 0.95 * u], [0, 1.02 * u, 'c']]),
    style: { stroke: SKIN, width: 0.35, fill: { kind: 'solid', color: '#fbf7f4' } },
    mirror: 0,
  };
  return [body(arm, u, true), body(pts, u), head];
}

function grid(u: number, w: number): Shape[] {
  const out: Shape[] = [];
  for (let k = 0; k <= 9; k++) out.push(guideLine(-w, k * u, w));
  out.push({ kind: 'path', id: newId(), path: line([0, -2], [0, 9 * u + 2]), style: { stroke: GUIDE, width: 0.15, fill: null, dash: [2, 1] } });
  for (let k = 1; k <= 9; k++) out.push(label(w + 1.5, k * u - u / 2 + 1, String(k)));
  return out;
}

const U = 24;

export const CROQUIS: CroquiDef[] = [
  { id: 'feminino', label: 'Feminino — frente', make: () => figure(FEM, FEM_ARM, U, 0.72) },
  { id: 'masculino', label: 'Masculino — frente', make: () => figure(MASC, MASC_ARM, U, 0.78) },
  { id: 'feminino-grade', label: 'Feminino com grade de 9 cabeças', make: () => [...grid(U, 32), ...figure(FEM, FEM_ARM, U, 0.72)] },
  { id: 'grade', label: 'Grade de proporção (9 cabeças)', make: () => grid(U, 32) },
];
