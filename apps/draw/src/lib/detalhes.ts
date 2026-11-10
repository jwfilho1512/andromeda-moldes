/**
 * Detalhes avulsos (bolsos, golas, punhos, passantes, zíper…) para encaixar nas peças.
 * Desenhados em cm da peça (1:10), centrados em x = 0.
 */
import { polyPath } from '../model/geom';
import type { Shape } from '../model/types';
import { INK, curve, detail, line, patch, stitch, trim } from './kit';

export interface DetalheDef {
  id: string;
  label: string;
  cat: 'Bolsos' | 'Golas' | 'Punhos e barras' | 'Fechamentos';
  make(): Shape[];
}

const rect = (x0: number, y0: number, x1: number, y1: number) =>
  polyPath([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], true);

export const DETALHES: DetalheDef[] = [
  {
    id: 'bolso-chapa',
    label: 'Bolso chapa',
    cat: 'Bolsos',
    make: () => [patch(rect(-6, 0, 6, 14), false), stitch(line([-6, 2.2], [6, 2.2]), 'duplo', false), stitch(polyPath([{ x: -5.5, y: 0 }, { x: -5.5, y: 13.5 }, { x: 5.5, y: 13.5 }, { x: 5.5, y: 0 }]), 'simples', false)],
  },
  {
    id: 'bolso-ponta',
    label: 'Bolso chapa com ponta',
    cat: 'Bolsos',
    make: () => [
      patch(curve([[-6, 0, 'c'], [6, 0, 'c'], [6, 12, 'c'], [0, 14.5, 'c'], [-6, 12, 'c']], true), false),
      stitch(line([-6, 2], [6, 2]), 'simples', false),
      stitch(curve([[-5.5, 2], [-5.5, 11.7, 'c'], [0, 13.9, 'c'], [5.5, 11.7, 'c'], [5.5, 2]]), 'simples', false),
    ],
  },
  {
    id: 'bolso-aba',
    label: 'Bolso com aba e botão',
    cat: 'Bolsos',
    make: () => [
      patch(rect(-6, 0, 6, 14), false),
      stitch(polyPath([{ x: -5.5, y: 0.5 }, { x: -5.5, y: 13.5 }, { x: 5.5, y: 13.5 }, { x: 5.5, y: 0.5 }]), 'simples', false),
      patch(curve([[-6.4, -1.2, 'c'], [6.4, -1.2, 'c'], [6.4, 3.2, 'c'], [0, 5.2, 'c'], [-6.4, 3.2, 'c']], true), false),
      stitch(curve([[-5.9, -0.8, 'c'], [-5.9, 2.8, 'c'], [0, 4.6, 'c'], [5.9, 2.8, 'c'], [5.9, -0.8, 'c']]), 'simples', false),
      trim('botao4', 0, 3.4, false, 1.2),
    ],
  },
  {
    id: 'bolso-cargo',
    label: 'Bolso cargo (fole)',
    cat: 'Bolsos',
    make: () => [
      patch(rect(-8, 0, 8, 18), false),
      detail(line([0, 0], [0, 18]), false),
      detail(line([-1.6, 0], [-1.6, 18]), false, { dash: [0.6, 0.4] }),
      detail(line([1.6, 0], [1.6, 18]), false, { dash: [0.6, 0.4] }),
      stitch(polyPath([{ x: -7.5, y: 0.3 }, { x: -7.5, y: 17.5 }, { x: 7.5, y: 17.5 }, { x: 7.5, y: 0.3 }]), 'duplo', false),
      patch(rect(-8.5, -2, 8.5, 4.5), false),
      stitch(polyPath([{ x: -8, y: -1.5 }, { x: -8, y: 4 }, { x: 8, y: 4 }, { x: 8, y: -1.5 }]), 'simples', false),
      trim('pressao', -4.5, 2.6, false, 1.2),
      trim('pressao', 4.5, 2.6, false, 1.2),
    ],
  },
  {
    id: 'bolso-faca',
    label: 'Bolso faca',
    cat: 'Bolsos',
    make: () => [detail(curve([[0, 0, 'c'], [3.5, 7.5], [9, 10, 'c']]), false), stitch(curve([[0.6, 0], [4, 7], [9, 9.4]]), 'duplo', false)],
  },
  {
    id: 'bolso-embutido',
    label: 'Bolso embutido com vivo',
    cat: 'Bolsos',
    make: () => [patch(rect(-7, 0, 7, 1.4), false), detail(line([-7, 0.7], [7, 0.7]), false), trim('botao2', 0, 2.6, false, 1.1)],
  },
  {
    id: 'gola-polo',
    label: 'Gola polo',
    cat: 'Golas',
    make: () => [
      patch(curve([[0, -2.2, 'c'], [7.6, -1.5, 'c'], [8.4, 0.5, 'c'], [0, 1.4, 'c']])),
      patch(curve([[0.4, 3.5, 'c'], [7.5, -1, 'c'], [9.8, 2], [7.5, 9, 'c'], [2.3, 6.8], [0.8, 4.8, 'c']], true)),
      { ...patch(rect(-1.5, 3.5, 1.5, 16), false), style: { stroke: INK, width: 0.28, fill: { kind: 'solid', color: '#ffffff' } } },
      stitch(polyPath([{ x: -1.2, y: 3.5 }, { x: -1.2, y: 15.7 }, { x: 1.2, y: 15.7 }, { x: 1.2, y: 3.5 }]), 'simples', false),
      trim('botao2', 0, 7, false, 1),
      trim('botao2', 0, 10.5, false, 1),
      trim('botao2', 0, 14, false, 1),
    ],
  },
  {
    id: 'gola-colarinho',
    label: 'Colarinho social',
    cat: 'Golas',
    make: () => [
      patch(curve([[0, -2.3, 'c'], [7.6, -1.6, 'c'], [8, 0.3, 'c'], [0, 1.1, 'c']])),
      patch(curve([[0.5, 6.7, 'c'], [7.6, -1.4, 'c'], [8.9, 1.4], [8.8, 12.1, 'c'], [3.6, 10.1], [1.2, 8.1, 'c']], true)),
      stitch(curve([[8.3, 1.4], [8.2, 11.4, 'c'], [3.4, 9.5]]), 'simples'),
      trim('botao4', 0, 0, false, 0.9),
    ],
  },
  {
    id: 'gola-padre',
    label: 'Gola padre (mandarim)',
    cat: 'Golas',
    make: () => [patch(curve([[0, 4, 'c'], [6.2, 2.3], [8, -0.2, 'c'], [7.9, -3, 'c'], [3.6, -1.6], [0, 0.6, 'c']])), stitch(curve([[0, 3.4], [6, 1.9], [7.4, -0.2]]), 'simples')],
  },
  {
    id: 'gola-peterpan',
    label: 'Gola Peter Pan',
    cat: 'Golas',
    make: () => [patch(curve([[0.3, 7, 'c'], [7.4, 0, 'c'], [10.2, 3.6], [8.6, 8.4], [3.6, 9.3], [0.6, 7.4, 'c']], true)), stitch(curve([[7.8, 0.6], [9.5, 3.8], [8.1, 7.8], [3.6, 8.6]]), 'simples')],
  },
  {
    id: 'punho-social',
    label: 'Punho social',
    cat: 'Punhos e barras',
    make: () => [patch(rect(-6, 0, 6, 6.5), false), stitch(polyPath([{ x: -5.6, y: 0 }, { x: -5.6, y: 6.1 }, { x: 5.6, y: 6.1 }, { x: 5.6, y: 0 }]), 'simples', false), trim('botao4', 4, 3.3, false, 1.1)],
  },
  {
    id: 'punho-ribana',
    label: 'Punho de ribana',
    cat: 'Punhos e barras',
    make: () => [{ ...patch(rect(-5, 0, 5, 7), false), style: { stroke: INK, width: 0.28, fill: { kind: 'pattern', pattern: 'canelado', c1: '#ffffff', c2: '#7d7d86', scale: 0.5, angle: 0 } } }, stitch(line([-5, -0.5], [5, -0.5]), 'galoneira', false)],
  },
  {
    id: 'passante',
    label: 'Passante',
    cat: 'Fechamentos',
    make: () => [patch(rect(-0.6, 0, 0.6, 5.2), false), detail(line([-0.6, 0.6], [0.6, 0.6]), false), detail(line([-0.6, 4.6], [0.6, 4.6]), false)],
  },
  {
    id: 'ziper-aparente',
    label: 'Zíper aparente',
    cat: 'Fechamentos',
    make: () => [{ ...stitch(line([0, 0], [0, 20]), 'ziper', false) }, trim('cursor', 0, 1.6, false, 2.2), stitch(line([-1.2, 0], [-1.2, 20.6]), 'simples', false), stitch(line([1.2, 0], [1.2, 20.6]), 'simples', false)],
  },
  {
    id: 'cordao',
    label: 'Cordão com ilhoses',
    cat: 'Fechamentos',
    make: () => [
      trim('ilhos', -1.4, 0, false, 0.9),
      trim('ilhos', 1.4, 0, false, 0.9),
      detail(curve([[-1.4, 0, 'c'], [-2.4, 5], [-3, 10, 'c']]), false, { width: 0.32 }),
      detail(curve([[1.4, 0, 'c'], [2.2, 5.5], [3.4, 10.5, 'c']]), false, { width: 0.32 }),
      trim('terminal', -3, 10.8, false, 1.4),
      trim('terminal', 3.4, 11.3, false, 1.4),
    ],
  },
];
