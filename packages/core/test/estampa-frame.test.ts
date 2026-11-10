import { describe, expect, it } from 'vitest';
import { type Artwork, type PiecePrint, type PrintFrame, type Vec2, applyPrintFrame, createPiece, printFrame, printInstances, rect } from '../src/index.js';

const art: Artwork = { id: 'a1', name: 'logo.png', mime: 'image/png', dataUrl: '', widthPx: 1000, heightPx: 500 };
const arts = new Map([[art.id, art]]);
const piece = (prints: PiecePrint[]) => ({ ...createPiece('f', 'Frente', rect(0, 0, 200, 300)), grainline: [{ x: 100, y: 20 }, { x: 130, y: 280 }] as [Vec2, Vec2], prints });
const base = (over: Partial<PiecePrint>): PiecePrint => ({ id: 'e1', mode: 'localizada', art: { '': 'a1' }, center: { x: 100, y: 150 }, rotationDeg: 20, mirrored: true, widthMm: 80, bleedMm: 0, ...over });

const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) < 0.02;
const sameFrame = (a: PrintFrame, b: PrintFrame) => near(a.O, b.O) && near(a.U, b.U) && near(a.V, b.V);
const scaleAbout = (f: PrintFrame, p: Vec2, kx: number, ky: number): PrintFrame => {
  // escala no referencial do próprio quadro, com o ponto p fixo
  const U = { x: f.U.x * kx, y: f.U.y * kx }, V = { x: f.V.x * ky, y: f.V.y * ky };
  // p = O + a·U + b·V  →  mesmos (a, b) no novo quadro
  const det = f.U.x * f.V.y - f.U.y * f.V.x;
  const dx = p.x - f.O.x, dy = p.y - f.O.y;
  const a = (dx * f.V.y - dy * f.V.x) / det, b = (f.U.x * dy - f.U.y * dx) / det;
  return { O: { x: p.x - a * U.x - b * V.x, y: p.y - a * U.y - b * V.y }, U, V };
};
const rotAbout = (f: PrintFrame, c: Vec2, deg: number): PrintFrame => {
  const r = (deg * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
  const R = (v: Vec2) => ({ x: v.x * co - v.y * si, y: v.x * si + v.y * co });
  const O = R({ x: f.O.x - c.x, y: f.O.y - c.y });
  return { O: { x: O.x + c.x, y: O.y + c.y }, U: R(f.U), V: R(f.V) };
};

describe('quadro da estampa (alças de escala e giro)', () => {
  for (const mode of ['localizada', 'corrida', 'textura'] as const) {
    for (const flipV of [false, true]) {
      it(`${mode}${flipV ? ' (de cabeça p/ baixo)' : ''}: escalar e girar pelo quadro dá o mesmo desenho`, () => {
        const pr = base({ mode, flipV, offsetMm: { x: 7, y: -3 } });
        const p = piece([pr]);
        const f0 = printFrame(p, pr, '', arts)!;
        // sem mudança = mesma estampa
        expect(sameFrame(printFrame(p, applyPrintFrame(p, pr, '', arts, f0), '', arts)!, f0)).toBe(true);
        // escala proporcional ×1,5 pelo canto
        const f1 = scaleAbout(f0, f0.O, 1.5, 1.5);
        const p1 = applyPrintFrame(p, pr, '', arts, f1);
        expect(p1.widthMm).toBeCloseTo(120, 2);
        expect(p1.heightMm).toBeUndefined(); // proporção continua travada
        expect(sameFrame(printFrame(p, p1, '', arts)!, f1)).toBe(true);
        // só a altura ×2: destrava
        const f2 = scaleAbout(f0, f0.O, 1, 2);
        const p2 = applyPrintFrame(p, pr, '', arts, f2);
        expect(p2.heightMm).toBeCloseTo(80, 2);
        expect(sameFrame(printFrame(p, p2, '', arts)!, f2)).toBe(true);
        // giro de 35° em volta do centro do quadro
        const c = { x: f0.O.x + (f0.U.x + f0.V.x) / 2, y: f0.O.y + (f0.U.y + f0.V.y) / 2 };
        const f3 = rotAbout(f0, c, 35);
        const p3 = applyPrintFrame(p, pr, '', arts, f3);
        expect(p3.rotationDeg).toBeCloseTo(55, 4);
        expect(sameFrame(printFrame(p, p3, '', arts)!, f3)).toBe(true);
      });
    }
  }

  it('escala vale para todos os tamanhos', () => {
    const pr = base({ widthBySize: { P: 60, G: 100 } });
    const p = piece([pr]);
    const f0 = printFrame(p, pr, 'P', arts)!;
    const out = applyPrintFrame(p, pr, 'P', arts, scaleAbout(f0, f0.O, 2, 2));
    expect(out.widthBySize).toEqual({ P: 120, G: 200 });
    expect(out.widthMm).toBe(160);
  });

  it('total: o quadro só gira (o tamanho segue o molde)', () => {
    const pr = base({ mode: 'total', mirrored: false, rotationDeg: 0 });
    const p = piece([pr]);
    const f0 = printFrame(p, pr, '', arts)!;
    const out = applyPrintFrame(p, pr, '', arts, rotAbout(scaleAbout(f0, f0.O, 3, 3), pr.center, 90));
    expect(out.rotationDeg).toBeCloseTo(90, 6);
    expect(out.widthMm).toBe(80);
    expect(printInstances(piece([out]), '', arts).length).toBe(1);
  });
});
