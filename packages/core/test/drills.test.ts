import { describe, expect, it } from 'vitest';
import { addPiece, createPiece, cutPiece, emptyJob, exportDxfAama, importDxf, mapPiece, newDocument, pieceForSize, rect } from '../src/index.js';

const base = () => ({ ...createPiece('p', 'Frente', rect(0, 0, 200, 300)), drills: [{ x: 50, y: 0 + 250 }] });

describe('pontos internos (furo/marcação)', () => {
  it('acompanham mover/espelhar o molde', () => {
    const m = mapPiece(base(), (q) => ({ x: -q.x + 10, y: q.y + 5 }));
    expect(m.drills).toEqual([{ x: -40, y: 255 }]);
  });

  it('vão para o plotter (círculo + cruz) e para o DXF na camada 13, e voltam na importação', () => {
    const job = addPiece(emptyJob(), base());
    expect(job.strokes.length).toBeGreaterThanOrEqual(4);
    const doc = { ...newDocument('t'), pieces: [base()] };
    const txt = exportDxfAama(doc);
    expect(txt).toMatch(/POINT\r?\n\s*8\r?\n13\r?\n/);
    const back = importDxf(txt);
    expect(back.pieces[0]!.drills?.length).toBe(1);
    const d = back.pieces[0]!.drills![0]!;
    // o importador reposiciona o molde, então confere a posição relativa ao canto
    const vx = Math.min(...back.pieces[0]!.outline.segments.map((s) => s.to.x)), vy = Math.min(...back.pieces[0]!.outline.segments.map((s) => s.to.y));
    expect(d.x - vx).toBeCloseTo(50, 3);
    expect(d.y - vy).toBeCloseTo(250, 3);
  });

  it('cortar o molde leva o ponto só para a parte onde ele está', () => {
    const p = base();
    const [a, b] = cutPiece(p, { edge: 0, t: 0.5 }, { edge: 2, t: 0.5 });
    expect((a.drills?.length ?? 0) + (b.drills?.length ?? 0)).toBe(1);
  });

  it('gradação move o ponto junto com o molde', () => {
    const p = { ...base(), grading: { sizes: ['P', 'M', 'G'], base: 1, rules: { '2': [{ x: -10, y: -10 }, { x: 0, y: 0 }, { x: 10, y: 10 }] } } };
    const g = pieceForSize(p, 2);
    expect(g.drills![0]!.x).toBeGreaterThan(50);
  });
});
