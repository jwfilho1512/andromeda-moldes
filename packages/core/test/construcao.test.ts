import { describe, expect, it } from 'vitest';
import { type Path, bboxOfPoints, extractRegion, flattenPath, pathThroughPoints, signedArea, v, vertices } from '../src/index.js';

const seg = (a: [number, number], b: [number, number]): Path => ({ start: v(a[0], a[1]), segments: [{ kind: 'line', to: v(b[0], b[1]) }], closed: false });
const curve = (pts: [number, number][]): Path => pathThroughPoints(pts.map(([x, y], i) => ({ p: v(x, y), corner: i === 0 || i === pts.length - 1 })), false);

/** Base de blusa como no vídeo: retângulo, linha da cava, decote e cava em curva, ombro e uma diagonal guia. */
function blusa(): Path[] {
  return [
    seg([0, 0], [250, 0]),
    seg([250, 0], [250, 420]),
    seg([250, 420], [0, 420]),
    seg([0, 420], [0, 0]),
    seg([0, 230], [250, 230]), // altura da cava, atravessa o retângulo
    seg([75, 420], [215, 385]), // ombro
    curve([[75, 420], [55, 360], [0, 335]]), // decote
    curve([[215, 385], [212, 290], [250, 230]]), // cava
    seg([0, 0], [120, 140]), // diagonal guia solta (não fecha nada)
  ];
}

describe('extrair molde da construção', () => {
  it('área simples: o retângulo de baixo', () => {
    const p = extractRegion(blusa(), v(125, 100))!;
    expect(p).not.toBeNull();
    const b = bboxOfPoints(flattenPath(p));
    expect(b.minX).toBeCloseTo(0, 3);
    expect(b.maxX).toBeCloseTo(250, 3);
    expect(b.maxY).toBeCloseTo(230, 3);
    expect(vertices(p)).toHaveLength(4); // a diagonal solta não entrou
  });

  it('clicando nas duas partes junta num molde só, com decote e cava em curva', () => {
    const p = extractRegion(blusa(), [v(125, 100), v(120, 300)])!;
    expect(p).not.toBeNull();
    const pts = flattenPath(p);
    const b = bboxOfPoints(pts);
    expect(b.maxY).toBeCloseTo(420, 3); // vai até o ponto do decote no alto
    expect(b.maxX).toBeCloseTo(250, 3);
    expect(signedArea(pts)).toBeGreaterThan(0); // anti-horário, como os outros moldes
    expect(p.segments.some((s) => s.kind === 'cubic')).toBe(true); // as curvas continuam curvas
    // a linha da cava que atravessava sumiu: nenhum vértice no meio do corpo em y = 230 além da lateral
    expect(vertices(p).filter((q) => Math.abs(q.y - 230) < 0.01 && q.x > 1 && q.x < 249)).toHaveLength(0);
  });

  it('fora de qualquer área fechada: nada', () => {
    expect(extractRegion(blusa(), v(400, 100))).toBeNull();
  });

  it('a parte de cima (acima do ombro) é uma área separada', () => {
    const p = extractRegion(blusa(), v(30, 410))!;
    const b = bboxOfPoints(flattenPath(p));
    expect(b.maxX).toBeLessThan(80);
    expect(b.minY).toBeGreaterThan(330);
  });
});
