import { describe, expect, it } from 'vitest';
import {
  addPiece,
  arrangePieces,
  bboxOfPoints,
  convertVertex,
  createPiece,
  cutLine,
  edgeLength,
  edgeMidpoint,
  emptyJob,
  exportPdfTiled,
  flattenPath,
  notchAtDistance,
  notchGeometry,
  notchesDividing,
  parallelContour,
  parallelToEdge,
  pathLength,
  perpendicularFoot,
  PT_PER_MM,
  pointsDividing,
  rect,
  segmentIntersection,
  setEdgeLengthExact,
  tileGrid,
  vertices,
  v,
} from '../src/index.js';

const block = () => createPiece('b', 'Bloco', rect(0, 0, 400, 600));

describe('pontos notáveis', () => {
  it('meio de reta e meio de curva (pelo comprimento real)', () => {
    expect(edgeMidpoint(rect(0, 0, 400, 600), 0)).toEqual(v(200, 0));
    const curved = convertVertex(rect(0, 0, 400, 600), 1, 'smooth', v(520, 60));
    const m = edgeMidpoint(curved, 0);
    // medir de cada ponta até o meio dá metade do comprimento
    const L = edgeLength(curved, 0);
    const pts = flattenPath({ start: curved.start, segments: [curved.segments[0]!], closed: false }, 0.001);
    let acc = 0, at = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
      if (Math.hypot(pts[i]!.x - m.x, pts[i]!.y - m.y) < 0.5) at = acc;
    }
    expect(Math.abs(at - L / 2)).toBeLessThan(1);
  });

  it('interseção de segmentos e pé da perpendicular', () => {
    expect(segmentIntersection(v(0, 0), v(10, 10), v(0, 10), v(10, 0))).toEqual(v(5, 5));
    expect(segmentIntersection(v(0, 0), v(1, 0), v(0, 1), v(1, 1))).toBeNull();
    expect(perpendicularFoot(v(3, 7), v(0, 0), v(10, 0))).toEqual(v(3, 0));
  });
});

describe('paralelo', () => {
  it('paralela a 20 mm da barra, para dentro', () => {
    const p = parallelToEdge(rect(0, 0, 400, 600), 0, 20, v(200, 300));
    const pts = vertices(p);
    expect(pts.every((q) => Math.abs(q.y - 20) < 1e-9)).toBe(true);
    expect(pathLength(p)).toBeCloseTo(400, 6);
  });

  it('contorno paralelo de 10 mm para fora', () => {
    const b = bboxOfPoints(flattenPath(parallelContour(block(), 10)));
    expect(b.maxX - b.minX).toBeCloseTo(420, 6);
    expect(b.maxY - b.minY).toBeCloseTo(620, 6);
  });
});

describe('comprimento exato', () => {
  it('curva ganha o comprimento pedido mantendo as pontas', () => {
    const curved = convertVertex(convertVertex(rect(0, 0, 400, 600), 0, 'smooth', v(40, -60)), 1, 'smooth', v(460, 60));
    const out = setEdgeLengthExact(curved, 0, 432.5);
    expect(edgeLength(out, 0)).toBeCloseTo(432.5, 3);
    expect(vertices(out)[0]).toEqual(vertices(curved)[0]);
    expect(vertices(out)[1]).toEqual(vertices(curved)[1]);
  });

  it('curva não pode ficar menor que a reta entre as pontas', () => {
    const curved = convertVertex(rect(0, 0, 400, 600), 1, 'smooth');
    expect(() => setEdgeLengthExact(curved, 0, 390)).toThrow(/reta/);
  });
});

describe('piques e pontos por medida', () => {
  it('pique a 120 mm do início e a 50 mm do fim', () => {
    let p = notchAtDistance(block(), 0, 120);
    p = notchAtDistance(p, 1, 50, true);
    expect(notchGeometry(p, p.notches[0]!).at).toEqual(v(120, 0));
    const at = notchGeometry(p, p.notches[1]!).at;
    expect(at.x).toBeCloseTo(400, 9);
    expect(at.y).toBeCloseTo(550, 6);
  });

  it('dividir a borda em 4: piques e pontos', () => {
    const n = notchesDividing(block(), 0, 4);
    expect(n.notches.map((x) => notchGeometry(n, x).at.x)).toEqual([100, 200, 300]);
    const pts = pointsDividing(block(), 0, 4);
    expect(vertices(pts.outline)).toHaveLength(7);
    expect(pathLength(pts.outline)).toBeCloseTo(2000, 6);
  });
});

describe('organizar moldes', () => {
  it('em fileiras, sem sobrepor e sem passar da largura', () => {
    const ps = [0, 1, 2, 3, 4].map((i) => createPiece(`p${i}`, 'P', rect(i * 7, i * 3, 300 + i * 50, 200 + i * 40)));
    const out = arrangePieces(ps, 1000, 20);
    const boxes = out.map((p) => bboxOfPoints(cutLine(p)));
    for (const b of boxes) expect(b.maxX).toBeLessThanOrEqual(1000 + 1e-9);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, c = boxes[j]!;
        expect(a.maxX <= c.minX || c.maxX <= a.minX || a.maxY <= c.minY || c.maxY <= a.minY).toBe(true);
      }
  });
});

describe('PDF em folhas A4', () => {
  const job = addPiece(emptyJob(), createPiece('b', 'Bloco', rect(0, 0, 1200, 500)));
  const text = (b: Uint8Array) => String.fromCharCode(...b);

  it('grade de folhas: 1200 × 500 mm em A4 retrato (área útil 190 × 277) = 7 × 2', () => {
    const g = tileGrid(job, { paper: 'A4' });
    expect([g.cols, g.rows]).toEqual([7, 2]);
    expect(g.iw).toBe(190);
  });

  it('PDF: folha de instruções + 14 folhas, sem "ajustar à página", desenho em escala', () => {
    const t = text(exportPdfTiled(job, { paper: 'A4', title: 'Teste' }));
    expect((t.match(/\/Type \/Page /g) ?? []).length).toBe(15);
    expect(t).toContain('/PrintScaling /None');
    // o desenho (objeto único) tem exatamente 1200 × 500 mm
    const bbox = t.match(/\/BBox \[0 0 ([\d.]+) ([\d.]+)\]/)!;
    expect(Number(bbox[1]) / PT_PER_MM).toBeCloseTo(1200, 3);
    expect(Number(bbox[2]) / PT_PER_MM).toBeCloseTo(500, 3);
    // folha da coluna 3 desloca o desenho 2 × 190 mm
    expect(t).toContain(`1 0 0 1 ${((10 - 380) * PT_PER_MM).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} `);
    // quadrado de conferência de 100 mm na folha de instruções
    expect(t).toContain(`${(100 * PT_PER_MM).toFixed(4).replace(/0+$/, '')} ${(100 * PT_PER_MM).toFixed(4).replace(/0+$/, '')} re S`);
  });

  it('paisagem e A3 reduzem o número de folhas', () => {
    expect(tileGrid(job, { paper: 'A4', orientation: 'paisagem' }).cols).toBe(5);
    expect(tileGrid(job, { paper: 'A3' }).cols * tileGrid(job, { paper: 'A3' }).rows).toBeLessThan(14);
  });
});
