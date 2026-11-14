import { describe, expect, it } from 'vitest';
import { allEdges, applySeam, createPiece, cutLine, rect, removeSeam, vertices, bboxOfPoints, edgeSeam } from '../src/index.js';

const block = (seam = 0) => ({ ...createPiece('b', 'Bloco', rect(0, 0, 400, 600)), seamAllowanceMm: seam });
const bb = (pts: { x: number; y: number }[]) => bboxOfPoints(pts);

describe('margem para dentro e para fora', () => {
  it('para fora: o contorno fica e o corte cresce', () => {
    const p = applySeam(block(), allEdges(block()), 10, 'fora');
    const b = bb(cutLine(p));
    expect(b.maxX - b.minX).toBeCloseTo(420, 6);
    expect(bb(vertices(p.outline)).maxX).toBeCloseTo(400, 9);
  });

  it('para dentro: o corte fica onde estava e a costura entra', () => {
    const p = applySeam(block(), allEdges(block()), 10, 'dentro');
    const b = bb(cutLine(p));
    expect(b.minX).toBeCloseTo(0, 6);
    expect(b.maxX).toBeCloseTo(400, 6);
    expect(b.maxY).toBeCloseTo(600, 6);
    const v = bb(vertices(p.outline));
    expect(v.minX).toBeCloseTo(10, 6);
    expect(v.maxX).toBeCloseTo(390, 6);
  });

  it('para dentro numa borda só: os cantos deslizam nas vizinhas', () => {
    // aresta 1 = lateral direita (x = 400)
    const p = applySeam(block(), [1], 15, 'dentro');
    const vs = vertices(p.outline);
    expect(vs[1]).toEqual({ x: 385, y: 0 });
    expect(vs[2]).toEqual({ x: 385, y: 600 });
    expect(edgeSeam(p, 1)).toBe(15);
    expect(bb(cutLine(p)).maxX).toBeCloseTo(400, 6);
  });

  it('remover mantendo o corte: o contorno vai para a linha de corte', () => {
    const p = removeSeam(block(10), allEdges(block()), true);
    const v = bb(vertices(p.outline));
    expect(v.minX).toBeCloseTo(-10, 6);
    expect(v.maxX).toBeCloseTo(410, 6);
    expect(allEdges(p).every((e) => edgeSeam(p, e) === 0)).toBe(true);
    // remover simples: o contorno fica
    const q = removeSeam(block(10), [0], false);
    expect(bb(vertices(q.outline)).minY).toBeCloseTo(0, 9);
    expect(edgeSeam(q, 0)).toBe(0);
  });
});

it('para dentro numa borda que já tinha margem: o contorno desenhado vira o corte', () => {
  const p = applySeam(block(10), [1], 15, 'dentro');
  expect(vertices(p.outline)[1]!.x).toBeCloseTo(385, 6);
  expect(bb(cutLine(p)).maxX).toBeCloseTo(400, 6);
});
