import { describe, expect, it } from 'vitest';
import {
  HPGL_UNITS_PER_MM,
  PT_PER_MM,
  type Piece,
  addPiece,
  addScaleCheck,
  cutLine,
  emptyJob,
  exportHpgl,
  exportPdf,
  flattenPath,
  newDocument,
  offsetPolygon,
  parseDocument,
  pathLength,
  rect,
  serializeDocument,
  signedArea,
  bboxOfPoints,
  dist,
  v,
} from '../src/index.js';
import { sampleSkirtFront } from './sample.js';

const rectPiece = (w: number, h: number, seam = 0): Piece => ({
  id: 'r',
  name: 'Retângulo',
  outline: rect(0, 0, w, h),
  seamAllowanceMm: seam,
  internals: [],
  notches: [],
  quantity: 1,
  cutInPairs: false,
});

/** Lê todas as coordenadas de PU/PD de um HPGL. */
function hpglCoords(hpgl: string): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (const m of hpgl.matchAll(/P[UD]([-\d,]+);/g)) {
    const nums = m[1]!.split(',').map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i]!, y: nums[i + 1]! });
  }
  return pts;
}

const pdfText = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe('geometria (mm)', () => {
  it('comprimento de quarto de círculo por Bézier bate com π·r/2 (erro < 0,03%)', () => {
    const r = 500;
    const k = 0.5522847498 * r; // constante da aproximação circular cúbica
    const arc = { start: v(r, 0), segments: [{ kind: 'cubic' as const, c1: v(r, k), c2: v(k, r), to: v(0, r) }], closed: false };
    expect(Math.abs(pathLength(arc) - (Math.PI * r) / 2) / ((Math.PI * r) / 2)).toBeLessThan(0.0003);
  });

  it('achatamento respeita a tolerância de 0,01 mm em relação à curva real', () => {
    const p = sampleSkirtFront().outline;
    const fine = flattenPath(p, 0.0001);
    const coarse = flattenPath(p, 0.01);
    // Todo ponto da versão fina fica a ≤ 0,01 mm de algum segmento da versão grossa.
    const segDist = (q: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      return dist(q, { x: a.x + t * dx, y: a.y + t * dy });
    };
    for (const q of fine) {
      let best = Infinity;
      for (let i = 0; i < coarse.length; i++) best = Math.min(best, segDist(q, coarse[i]!, coarse[(i + 1) % coarse.length]!));
      expect(best).toBeLessThanOrEqual(0.0101);
    }
  });

  it('margem de costura de 10 mm num retângulo 1000×500 gera 1020×520', () => {
    const out = offsetPolygon(flattenPath(rect(0, 0, 1000, 500)), 10);
    const bb = bboxOfPoints(out);
    expect(bb.maxX - bb.minX).toBeCloseTo(1020, 9);
    expect(bb.maxY - bb.minY).toBeCloseTo(520, 9);
    expect(signedArea(out)).toBeCloseTo(1020 * 520, 6);
  });

  it('margem funciona com polígono em sentido horário', () => {
    const cw = flattenPath(rect(0, 0, 100, 100)).reverse();
    const bb = bboxOfPoints(offsetPolygon(cw, 5));
    expect(bb.maxX - bb.minX).toBeCloseTo(110, 9);
  });
});

describe('exportação PLT/HPGL em escala 1:1', () => {
  it('retângulo de 1000×500 mm sai com exatamente 40000×20000 unidades', () => {
    const hpgl = exportHpgl(addPiece(emptyJob(), rectPiece(1000, 500)), { labels: false });
    const pts = hpglCoords(hpgl);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(1000 * HPGL_UNITS_PER_MM);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(500 * HPGL_UNITS_PER_MM);
    expect(hpgl.startsWith('IN;')).toBe(true);
  });

  it('molde com curvas: cada ponto HPGL fica a ≤ 0,0125 mm da geometria (sem erro acumulado)', () => {
    const piece = sampleSkirtFront();
    const job = addPiece(emptyJob(), piece, { showSewLine: false });
    job.strokes = job.strokes.filter((s) => s.pen === 1 && s.closed); // só o corte
    const hpgl = exportHpgl(job, { labels: false, marginMm: 0 });
    const cut = job.strokes[0]!.points;
    const bb = bboxOfPoints(cut);
    const pts = hpglCoords(hpgl);
    // PU + PD (fechado repete o 1º ponto)
    expect(pts.length).toBe(cut.length + 1);
    cut.forEach((p, i) => {
      const q = pts[i]!;
      expect(Math.abs(q.x / HPGL_UNITS_PER_MM - (p.x - bb.minX))).toBeLessThanOrEqual(0.0125);
      expect(Math.abs(q.y / HPGL_UNITS_PER_MM - (p.y - bb.minY))).toBeLessThanOrEqual(0.0125);
    });
  });

  it('peça grande (enfesto de 8 m) mantém a precisão', () => {
    const hpgl = exportHpgl(addPiece(emptyJob(), rectPiece(8000, 1600)), { labels: false });
    const xs = hpglCoords(hpgl).map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(320000);
  });

  it('textos com acento não quebram o arquivo', () => {
    const hpgl = exportHpgl(addPiece(emptyJob(), { ...rectPiece(100, 100), name: 'Manga Coração' }));
    expect(hpgl).toContain('LBManga Coracao\x03');
  });
});

describe('exportação PDF em escala 1:1', () => {
  it('página = trabalho + margens, convertida exatamente para pontos', () => {
    const bytes = exportPdf(addPiece(emptyJob(), rectPiece(1000, 500)), { marginMm: 10 });
    const text = pdfText(bytes);
    const mb = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)!;
    expect(Number(mb[1]) / PT_PER_MM).toBeCloseTo(1020, 3);
    expect(Number(mb[2]) / PT_PER_MM).toBeCloseTo(520, 3);
  });

  it('retângulo de 1000 mm no conteúdo mede 1000 mm (erro < 0,001 mm)', () => {
    const text = pdfText(exportPdf(addPiece(emptyJob(), rectPiece(1000, 500)), { marginMm: 10 }));
    const xs = [...text.matchAll(/([\d.]+) ([\d.]+) [ml]\n/g)].map((m) => Number(m[1]) / PT_PER_MM);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1000, 3);
  });

  it('desliga o "ajustar à página" na impressão', () => {
    expect(pdfText(exportPdf(addScaleCheck(emptyJob(), v(0, 0))))).toContain('/PrintScaling /None');
  });

  it('tabela xref aponta para os offsets corretos', () => {
    const text = pdfText(exportPdf(addPiece(emptyJob(), sampleSkirtFront())));
    const xrefAt = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const offs = [...text.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    expect(offs.length).toBe(6);
    offs.forEach((o, i) => expect(text.startsWith(`${i + 1} 0 obj\n`, o)).toBe(true));
  });

  it('recusa página maior que o limite do PDF em vez de escalar', () => {
    expect(() => exportPdf(addPiece(emptyJob(), rectPiece(6000, 100)))).toThrow(/excede/);
  });
});

describe('arquivo nativo .ctx', () => {
  it('salva e abre sem perder nada', () => {
    const doc = newDocument('Coleção Teste');
    doc.pieces.push(sampleSkirtFront());
    const back = parseDocument(serializeDocument(doc));
    expect(back).toEqual(doc);
    expect(cutLine(back.pieces[0]!)).toEqual(cutLine(doc.pieces[0]!));
  });

  it('rejeita arquivo de outro formato', () => {
    expect(() => parseDocument('{"format":"outro"}')).toThrow();
  });
});
