import { describe, expect, it } from 'vitest';
import {
  closestOnPath,
  createPiece,
  edgeCount,
  edgeLength,
  flattenPath,
  insertPieceVertex,
  insertVertex,
  moveVertex,
  notchGeometry,
  pathLength,
  rect,
  removePieceVertex,
  removeVertex,
  setEdgeLength,
  toggleCurve,
  translatePiece,
  vertices,
  v,
} from '../src/index.js';
import { sampleSkirtFront } from './sample.js';

describe('edição de caminho', () => {
  it('retângulo fechado tem 4 vértices e 4 arestas (fechamento explícito)', () => {
    const r = rect(0, 0, 100, 50);
    expect(vertices(r)).toHaveLength(4);
    expect(edgeCount(r)).toBe(4);
    expect(pathLength(r)).toBeCloseTo(300, 9);
  });

  it('mover o vértice 0 mantém o caminho fechado', () => {
    const r = moveVertex(rect(0, 0, 100, 50), 0, v(-10, -10));
    expect(r.start).toEqual(v(-10, -10));
    expect(r.segments.at(-1)!.to).toEqual(v(-10, -10));
  });

  it('inserir vértice numa curva não altera a forma nem o comprimento', () => {
    const p = sampleSkirtFront().outline;
    const before = pathLength(p);
    const after = insertVertex(p, 2, 0.37);
    expect(vertices(after)).toHaveLength(vertices(p).length + 1);
    expect(pathLength(after)).toBeCloseTo(before, 4);
  });

  it('inserir e remover vértice numa reta volta ao original', () => {
    const r = rect(0, 0, 100, 50);
    const back = removeVertex(insertVertex(r, 1, 0.5), 2);
    expect(vertices(back)).toEqual(vertices(r));
  });

  it('remover vértice 0 de caminho fechado funciona', () => {
    const r = removeVertex(rect(0, 0, 100, 50), 0);
    expect(vertices(r)).toEqual([v(100, 0), v(100, 50), v(0, 50)]);
    expect(edgeCount(r)).toBe(3);
  });

  it('curva criada a partir de reta nasce com o mesmo comprimento', () => {
    const c = toggleCurve(rect(0, 0, 100, 50), 0);
    expect(c.segments[0]!.kind).toBe('cubic');
    expect(edgeLength(c, 0)).toBeCloseTo(100, 6);
  });

  it('comprimento exato de aresta', () => {
    const r = setEdgeLength(rect(0, 0, 100, 50), 0, 123.4);
    expect(edgeLength(r, 0)).toBeCloseTo(123.4, 9);
  });

  it('ponto mais próximo em curva', () => {
    const p = sampleSkirtFront().outline;
    const target = flattenPath(p)[10]!;
    const hit = closestOnPath(p, { x: target.x + 0.001, y: target.y });
    expect(hit.distance).toBeLessThan(0.01);
  });
});

describe('piques presos à borda', () => {
  it('pique aponta para dentro, nos dois sentidos de contorno', () => {
    const ccw = createPiece('a', 'A', rect(0, 0, 100, 100));
    const g = notchGeometry(ccw, { edge: 0, t: 0.5, depthMm: 5 });
    expect(g.at).toEqual(v(50, 0));
    expect(g.inward.y).toBeCloseTo(1, 9);

    const cwOutline = { ...rect(0, 0, 100, 100) };
    const pts = vertices(cwOutline).reverse();
    const cw = createPiece('b', 'B', { start: pts[0]!, segments: [...pts.slice(1), pts[0]!].map((to) => ({ kind: 'line' as const, to })), closed: true });
    const g2 = notchGeometry(cw, { edge: 0, t: 0.5, depthMm: 5 });
    // aresta 0 do horário é o topo (0,100)→(100,100) → para dentro = −y
    expect(g2.at).toEqual(v(50, 100));
    expect(g2.inward.y).toBeCloseTo(-1, 9);
  });

  it('pique continua no mesmo lugar ao inserir e remover vértices', () => {
    let piece = createPiece('a', 'A', rect(0, 0, 100, 100));
    piece = { ...piece, notches: [{ edge: 0, t: 0.75, depthMm: 5 }, { edge: 2, t: 0.5, depthMm: 5 }] };
    const pos = (p: typeof piece) => p.notches.map((n) => notchGeometry(p, n).at);
    const original = pos(piece);
    const inserted = insertPieceVertex(piece, 0, 0.5);
    pos(inserted).forEach((q, i) => {
      expect(q.x).toBeCloseTo(original[i]!.x, 9);
      expect(q.y).toBeCloseTo(original[i]!.y, 9);
    });
    // Remover o vértice inserido volta exatamente ao original (aresta reta)
    const removed = removePieceVertex(inserted, 1);
    pos(removed).forEach((q, i) => {
      expect(q.x).toBeCloseTo(original[i]!.x, 9);
      expect(q.y).toBeCloseTo(original[i]!.y, 9);
    });
  });

  it('mover o molde inteiro leva fio e linhas internas junto', () => {
    const s = translatePiece(sampleSkirtFront(), 100, 50);
    expect(s.grainline![0]).toEqual(v(230, 130));
    expect(s.internals[0]!.start).toEqual(v(190, 637));
  });
});
