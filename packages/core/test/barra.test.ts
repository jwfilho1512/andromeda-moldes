import { describe, expect, it } from 'vitest';
import { type Piece, type Vec2, createPiece, cutLine, insertPieceVertex, polyline, reversePiece, signedArea } from '../src/index.js';

/** Manga simplificada: mais estreita na barra (y = 0) e mais larga em cima. */
function manga(): Piece {
  const p = createPiece('m', 'Manga', polyline([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 240, y: 400 }, { x: -40, y: 400 }], true));
  return { ...p, seamAllowanceMm: 10, seamByEdge: { '0': 30 }, hemByEdge: { '0': true } };
}

/** Reta da margem da lateral esquerda (aresta 3: (-40,400) → (0,0)) deslocada 10 mm para fora: x em função de y. */
function leftOffsetX(y: number) {
  const t = { x: 40, y: -400 };
  const L = Math.hypot(t.x, t.y);
  const n = { x: t.y / L, y: -t.x / L }; // para fora (anti-horário)
  const p0 = { x: 0 + n.x * 10, y: 0 + n.y * 10 };
  return p0.x + ((y - p0.y) * t.x) / t.y;
}

const near = (pts: Vec2[], q: Vec2, tol = 1e-6) => pts.some((p) => Math.hypot(p.x - q.x, p.y - q.y) < tol);

describe('barra com cantos espelhados', () => {
  it('o canto da barra é o reflexo da margem da lateral sobre a linha de dobra', () => {
    const cut = cutLine(manga());
    // na linha da barra (y = −30) o canto fica onde a margem lateral estaria em y = +30, refletida
    expect(near(cut, { x: leftOffsetX(30), y: -30 })).toBe(true);
    // e o lado direito, simétrico
    expect(near(cut, { x: 200 - leftOffsetX(30), y: -30 })).toBe(true);
    // a barra abre para fora (manga afunila para baixo → barra espelhada fica mais larga embaixo)
    expect(leftOffsetX(30)).toBeLessThan(leftOffsetX(0));
    expect(Math.min(...cut.map((p) => p.y))).toBeCloseTo(-30, 9);
  });

  it('sem a opção, o canto continua em ponta (prolonga a lateral)', () => {
    const p = { ...manga(), hemByEdge: undefined };
    const cut = cutLine(p);
    expect(near(cut, { x: leftOffsetX(-30), y: -30 })).toBe(true);
  });

  it('funciona com contorno no sentido horário e sobrevive a inserir ponto', () => {
    const a = cutLine(manga());
    const r = reversePiece(manga());
    expect(signedArea(r.outline.segments.map((s) => s.to))).toBeLessThan(0);
    const b = cutLine(r);
    expect(near(b, { x: leftOffsetX(30), y: -30 })).toBe(true);
    expect(Math.abs(signedArea(b))).toBeCloseTo(Math.abs(signedArea(a)), 6);
    const c = cutLine(insertPieceVertex(manga(), 0, 0.5));
    expect(Math.abs(signedArea(c))).toBeCloseTo(Math.abs(signedArea(a)), 6);
  });
});
