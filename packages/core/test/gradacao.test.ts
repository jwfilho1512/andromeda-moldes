import { describe, expect, it } from 'vitest';
import {
  type Piece,
  convertVertex,
  createPiece,
  emptyGrading,
  gradingFromVariants,
  insertPieceVertex,
  linearOffsets,
  mapPiece,
  notchGeometry,
  pieceForSize,
  rect,
  removePieceVertex,
  setVertexRule,
  translatePiece,
  vertices,
  v,
} from '../src/index.js';

const SIZES = ['PP', 'P', 'M', 'G', 'GG'];
/** Retângulo 400×600 com grade PP–GG (base M) e regras: canto superior direito +10/+15 por tamanho. */
function graded(): Piece {
  let p: Piece = { ...createPiece('a', 'A', rect(0, 0, 400, 600)), grading: emptyGrading(SIZES, 2) };
  p = setVertexRule(p, 2, linearOffsets(p.grading!, v(10, 15)));
  p = setVertexRule(p, 1, linearOffsets(p.grading!, v(10, 0)));
  return p;
}

describe('gradação por regra nos pontos', () => {
  it('regra linear acumulada a partir da base', () => {
    const offs = linearOffsets({ sizes: SIZES, base: 2 }, v(10, 15));
    expect(offs[0]).toEqual(v(-20, -30));
    expect(offs[2]).toEqual(v(0, 0));
    expect(offs[4]).toEqual(v(20, 30));
  });

  it('gera cada tamanho movendo só os pontos com regra', () => {
    const p = graded();
    const gg = vertices(pieceForSize(p, 4).outline);
    expect(gg[0]).toEqual(v(0, 0));
    expect(gg[1]).toEqual(v(420, 0));
    expect(gg[2]).toEqual(v(420, 630));
    expect(gg[3]).toEqual(v(0, 600));
    const pp = vertices(pieceForSize(p, 0).outline);
    expect(pp[2]).toEqual(v(380, 570));
    // tamanho base devolve o próprio molde
    expect(vertices(pieceForSize(p, 2).outline)).toEqual(vertices(p.outline));
  });

  it('alças das curvas acompanham o seu ponto', () => {
    let p = graded();
    p = { ...p, outline: convertVertex(p.outline, 2, 'smooth') };
    const before = p.outline.segments[1] as { c2: { x: number; y: number } };
    const after = pieceForSize(p, 4).outline.segments[1] as { c2: { x: number; y: number } };
    expect(after.c2.x - before.c2.x).toBeCloseTo(20, 9);
    expect(after.c2.y - before.c2.y).toBeCloseTo(30, 9);
  });

  it('piques ficam na mesma proporção da borda', () => {
    const p = { ...graded(), notches: [{ edge: 1, t: 0.5, depthMm: 5 }] };
    const gg = pieceForSize(p, 4);
    const at = notchGeometry(gg, gg.notches[0]!).at;
    expect(at.x).toBeCloseTo(420, 9);
    expect(at.y).toBeCloseTo(315, 9);
  });

  it('fio e pontos internos andam por interpolação', () => {
    const p = { ...graded(), grainline: [v(200, 100), v(200, 500)] as [ReturnType<typeof v>, ReturnType<typeof v>] };
    const gg = pieceForSize(p, 4);
    expect(gg.grainline![0].x).toBeGreaterThan(200);
    expect(gg.grainline![0].x).toBeLessThan(220);
  });

  it('inserir ponto interpola a regra; remover reindexa', () => {
    const p = graded();
    const ins = insertPieceVertex(p, 1, 0.5); // entre (400,0) e (400,600)
    const r = ins.grading!.rules['2']!;
    expect(r[4]).toEqual(v(20, 15)); // média de (20,0) e (20,30)
    expect(ins.grading!.rules['3']![4]).toEqual(v(20, 30)); // antigo vértice 2 virou 3
    const rem = removePieceVertex(ins, 2);
    expect(rem.grading!.rules['2']![4]).toEqual(v(20, 30));
  });

  it('espelhar o molde espelha a grade; mover não muda a grade', () => {
    const p = graded();
    const m = mapPiece(p, (q) => v(-q.x, q.y));
    expect(m.grading!.rules['2']![4]).toEqual(v(-20, 30));
    expect(translatePiece(p, 100, 50).grading!.rules['2']![4]).toEqual(v(20, 30));
  });

  it('grade calculada a partir dos tamanhos reconstrói cada tamanho exatamente', () => {
    const sizes = [300, 350, 400, 450, 500].map((w, i) => createPiece('r', 'R', rect(0, 0, w, 500 + i * 10)));
    const g = gradingFromVariants(sizes[2]!, sizes, SIZES, 2, 0)!;
    const base = { ...sizes[2]!, grading: g };
    sizes.forEach((s, i) => expect(vertices(pieceForSize(base, i).outline)).toEqual(vertices(s.outline)));
  });

  it('topologia diferente entre tamanhos → sem grade (null)', () => {
    const a = createPiece('r', 'R', rect(0, 0, 300, 500));
    const b = insertPieceVertex(a, 0, 0.5);
    expect(gradingFromVariants(a, [a, b, a, a, a], SIZES, 2)).toBeNull();
  });
});
