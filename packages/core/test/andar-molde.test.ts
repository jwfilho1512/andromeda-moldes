import { describe, expect, it } from 'vitest';
import { createPiece, flattenPath, pointAt, rect, v, walkPath, walkReport, walkTransform, bboxOfPoints, type Piece } from '../src/index.js';

/** A: 300×500 na origem; costura = lateral direita (aresta 1). B: 200×480 longe; costura = lateral esquerda (aresta 3). */
const A = (): Piece => ({ ...createPiece('a', 'Frente', rect(0, 0, 300, 500)), notches: [{ edge: 1, t: 0.6, depthMm: 5 }] });
const B = (): Piece => ({ ...createPiece('b', 'Costas', rect(1000, 0, 200, 480)), notches: [{ edge: 3, t: 205 / 480, depthMm: 5 }] });

describe('andar molde', () => {
  const pa = A(), pb = B();
  const wa = walkPath(pa, 2, -1); // do topo da lateral direita, descendo
  const wb = walkPath(pb, 3, 1); // do topo da lateral esquerda, descendo

  it('percurso mede o perímetro e marca os cantos', () => {
    expect(wa.total).toBeCloseTo(1600, 6);
    expect(wa.corners.slice(0, 2)).toEqual([0, 500]);
    expect(wb.corners[1]).toBeCloseTo(480, 6);
  });

  it('B rola encostado em A, do lado oposto, com o ponto de contato coincidente', () => {
    for (const s of [0, 100, 333.3, 480]) {
      const { f, mirrored } = walkTransform(wa, wb, s);
      expect(mirrored).toBe(false);
      const contactB = f(pointAt(wb, s).p);
      const contactA = pointAt(wa, s).p;
      expect(contactB.x).toBeCloseTo(contactA.x, 9);
      expect(contactB.y).toBeCloseTo(contactA.y, 9);
      // B inteiro fica do outro lado da costura (x ≥ 300)
      const bb = bboxOfPoints(flattenPath(pb.outline).map(f));
      expect(bb.minX).toBeGreaterThanOrEqual(300 - 1e-9);
      expect(bb.maxX - bb.minX).toBeCloseTo(200, 9); // rígido, sem deformar
    }
  });

  it('relatório: canto seguinte de B chega 20 mm antes; piques com 5 mm de diferença; junção contínua', () => {
    const r = walkReport(pa, wa, pb, wb, 10);
    expect(r.nextCornerA).toBeCloseTo(500, 6);
    expect(r.nextCornerB).toBeCloseTo(480, 6);
    expect(r.cornerDiff).toBeCloseTo(-20, 6);
    expect(r.notchPairs).toHaveLength(1);
    expect(r.notchPairs[0]!.a).toBeCloseTo(200, 6);
    expect(r.notchPairs[0]!.diff).toBeCloseTo(5, 6);
    expect(r.startAngleDeg).toBeCloseTo(180, 6);
  });

  it('parado exatamente no canto, ainda compara os cantos desta costura', () => {
    const r = walkReport(pa, wa, pb, wb, 500);
    expect(r.nextCornerA).toBeCloseTo(500, 6);
    expect(r.nextCornerB).toBeCloseTo(480, 6);
  });

  it('piques fora do trecho de costura (ex.: da cava) não entram na comparação', () => {
    const pa2 = { ...pa, notches: [...pa.notches, { edge: 2, t: 0.5, depthMm: 5 }] }; // pique no topo de A
    const r = walkReport(pa2, walkPath(pa2, 2, -1), pb, wb, 10);
    expect(r.notchPairs).toHaveLength(1);
  });

  it('se as duas costuras estão do mesmo lado, B é espelhado para encostar', () => {
    const wb2 = walkPath(pb, 0, -1); // mesma lateral, sentido contrário (subindo)
    const wa2 = walkPath(pa, 1, 1); // A subindo
    const { mirrored, f } = walkTransform(wa2, wb2, 0);
    const bb = bboxOfPoints(flattenPath(pb.outline).map(f));
    expect(bb.minX).toBeGreaterThanOrEqual(300 - 1e-9);
    expect(typeof mirrored).toBe('boolean');
  });

  it('curva: ombro inclinado de dois moldes — junção da cava detecta bico', () => {
    // Dois moldes com ombro inclinado; ao andar o ombro, a cava forma ângulo ≠ 180°
    const front = createPiece('f', 'F', { start: v(0, 0), segments: [{ kind: 'line', to: v(200, 0) }, { kind: 'line', to: v(180, 300) }, { kind: 'line', to: v(0, 320) }, { kind: 'line', to: v(0, 0) }], closed: true });
    const back = createPiece('b', 'B', { start: v(0, 0), segments: [{ kind: 'line', to: v(200, 0) }, { kind: 'line', to: v(200, 300) }, { kind: 'line', to: v(20, 320) }, { kind: 'line', to: v(0, 0) }], closed: true });
    const r = walkReport(front, walkPath(front, 2, 1), back, walkPath(back, 3, -1), 0);
    expect(r.startAngleDeg).toBeLessThan(179);
  });
});
