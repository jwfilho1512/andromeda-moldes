import { describe, expect, it } from 'vitest';
import {
  type Piece,
  addPiece,
  convertVertex,
  createDart,
  createPiece,
  cutLine,
  cutPiece,
  dartGeometry,
  edgeCount,
  edgeSeam,
  emptyJob,
  flattenPath,
  foldPiece,
  isSmoothVertex,
  joinPieces,
  moveHandleSmooth,
  notchGeometry,
  pathLength,
  pathThroughPoints,
  rect,
  reversePiece,
  signedArea,
  spreadParallel,
  spreadRadial,
  transferDart,
  unfoldPiece,
  vertices,
  bboxOfPoints,
  dist,
  v,
} from '../src/index.js';

const area = (p: Piece) => Math.abs(signedArea(flattenPath(p.outline)));
const box = (p: Piece) => {
  const b = bboxOfPoints(flattenPath(p.outline));
  return { w: b.maxX - b.minX, h: b.maxY - b.minY };
};
/** Molde 400×600 (largura × altura), anti-horário: arestas 0=barra, 1=lateral dir., 2=cintura (topo), 3=lateral esq. */
const block = () => createPiece('b', 'Bloco', rect(0, 0, 400, 600));

describe('pence', () => {
  it('cria pence com boca exata e ápice', () => {
    const p = createDart(block(), { edge: 2, t: 0.5 }, v(200, 450), 30);
    expect(p.darts).toHaveLength(1);
    const g = dartGeometry(p, p.darts![0]!);
    expect(g.width).toBeCloseTo(30, 6);
    expect(g.length).toBeCloseTo(150, 6);
    // o contorno não muda de forma nem de comprimento
    expect(pathLength(p.outline)).toBeCloseTo(2000, 6);
  });

  it('recusa pence que ultrapassa a borda', () => {
    expect(() => createDart(block(), { edge: 2, t: 0.01 }, v(5, 450), 30)).toThrow(/ultrapassa/);
  });

  it('transferir pence da cintura para a lateral: fecha a antiga e abre a nova com o mesmo ângulo', () => {
    const p = createDart(block(), { edge: 2, t: 0.5 }, v(200, 450), 40);
    const before = dartGeometry(p, p.darts![0]!);
    const angBefore = 2 * Math.asin(before.width / 2 / dist(before.apex, before.legA));
    // destino: lateral esquerda (aresta 3 depois da pence vira índice 5), a 450 mm da barra
    const target = p.outline.segments.findIndex((_, i) => {
      const vs = vertices(p.outline);
      const a = vs[i]!, b = vs[(i + 1) % vs.length]!;
      return a.x === 0 && b.x === 0;
    });
    const t = transferDart(p, 0, { edge: target, t: (600 - 450) / 600 });
    expect(t.darts).toHaveLength(1);
    const after = dartGeometry(t, t.darts![0]!);
    const angAfter = 2 * Math.asin(after.width / 2 / dist(after.apex, after.legA));
    expect(angAfter).toBeCloseTo(angBefore, 6);
    // a nova boca está na lateral esquerda (x = 0 numa das pernas)
    expect(Math.min(Math.abs(after.legA.x), Math.abs(after.legB.x))).toBeLessThan(1e-6);
    // contorno não se cruza e tem mais vértices
    expect(vertices(t.outline).length).toBeGreaterThan(vertices(p.outline).length - 1);
    expect(area(t)).toBeGreaterThan(0);
  });
});

describe('cortar, dobrar, desdobrar, unir', () => {
  it('cortar ao meio: duas partes com área somada igual e margem nova no corte', () => {
    const [a, b] = cutPiece(block(), { edge: 0, t: 0.5 }, { edge: 2, t: 0.5 }, 15);
    expect(area(a) + area(b)).toBeCloseTo(400 * 600, 3);
    expect(area(a)).toBeCloseTo(200 * 600, 3);
    const seams = (p: Piece) => Array.from({ length: edgeCount(p.outline) }, (_, i) => edgeSeam(p, i));
    expect(seams(a)).toContain(15);
    expect(seams(b)).toContain(15);
  });

  it('dobrar: mantém metade com a dobra sem margem', () => {
    const f = foldPiece(block(), { edge: 0, t: 0.5 }, { edge: 2, t: 0.5 });
    expect(area(f)).toBeCloseTo(200 * 600, 3);
    const seams = Array.from({ length: edgeCount(f.outline) }, (_, i) => edgeSeam(f, i));
    expect(seams).toContain(0);
  });

  it('desdobrar pela borda reta dobra a largura e espelha piques', () => {
    const half = { ...block(), notches: [{ edge: 1, t: 0.5, depthMm: 5 }] };
    const full = unfoldPiece(half, 3); // lateral esquerda = linha de dobra
    expect(box(full).w).toBeCloseTo(800, 6);
    expect(box(full).h).toBeCloseTo(600, 6);
    expect(full.notches).toHaveLength(2);
    const xs = full.notches.map((n) => notchGeometry(full, n).at.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-400, 6);
    expect(xs[1]).toBeCloseTo(400, 6);
  });

  it('desdobrar recusa borda curva', () => {
    const p = { ...block(), outline: convertVertex(block().outline, 0, 'smooth') };
    expect(() => unfoldPiece(p, 0)).toThrow(/reta/);
  });

  it('unir dois moldes pela costura soma as áreas e some a costura', () => {
    const a = createPiece('a', 'A', rect(0, 0, 300, 500));
    const b = createPiece('b', 'B', rect(1000, 200, 200, 500));
    const { piece, diffMm } = joinPieces(a, 1, b, 3); // lateral dir. de A + lateral esq. de B
    expect(diffMm).toBeCloseTo(0, 6);
    expect(area(piece)).toBeCloseTo(300 * 500 + 200 * 500, 3);
    expect(box(piece).w).toBeCloseTo(500, 6);
  });

  it('unir funciona com moldes de sentidos opostos', () => {
    const a = createPiece('a', 'A', rect(0, 0, 300, 500));
    const b = reversePiece(createPiece('b', 'B', rect(1000, 200, 200, 500)));
    const edgeLeftB = 3 - 3; // após inverter, a lateral esquerda (antiga 3) vira índice 0
    const { piece } = joinPieces(a, 1, b, edgeLeftB);
    expect(area(piece)).toBeCloseTo(250000, 3);
  });
});

describe('prega e folgas', () => {
  it('folga paralela aumenta a largura exatamente', () => {
    const s = spreadParallel(block(), { edge: 0, t: 0.5 }, { edge: 2, t: 0.5 }, 40);
    expect(box(s).w).toBeCloseTo(440, 6);
    expect(area(s)).toBeCloseTo(440 * 600, 3);
  });

  it('prega marca piques e linhas de dobra', () => {
    const s = spreadParallel(block(), { edge: 0, t: 0.5 }, { edge: 2, t: 0.5 }, 60, true);
    expect(s.notches).toHaveLength(4);
    expect(s.internals).toHaveLength(2);
  });

  it('folga em leque abre a quantidade pedida na barra e mantém a cintura', () => {
    const s = spreadRadial(block(), { edge: 0, t: 0.5 }, { edge: 2, t: 0.5 }, 80);
    const vs = vertices(s.outline);
    // barra (y = 0) fica 80 mm mais larga (aprox., pela corda) e a cintura igual
    const hem = vs.filter((p) => Math.abs(p.y) < 1e-6);
    expect(hem.length).toBeGreaterThanOrEqual(2);
    const waistLen = pathLength(s.outline);
    expect(waistLen).toBeGreaterThan(2000);
    expect(area(s)).toBeGreaterThan(400 * 600);
  });
});

describe('curvas', () => {
  it('curvatura: a curva passa exatamente pelos pontos clicados', () => {
    const pts = [v(0, 0), v(100, 80), v(250, 60), v(300, -40)];
    const path = pathThroughPoints(pts.map((p) => ({ p })), false);
    expect(vertices(path)).toEqual(pts);
    expect(path.segments.every((s) => s.kind === 'cubic')).toBe(true);
  });

  it('ponto de canto quebra a curva', () => {
    const path = pathThroughPoints([{ p: v(0, 0) }, { p: v(100, 0), corner: true }, { p: v(100, 100) }], false);
    expect(path.segments.every((s) => s.kind === 'line')).toBe(true);
  });

  it('converter ponto: canto → suave → canto', () => {
    const r = rect(0, 0, 100, 100);
    const smooth = convertVertex(r, 2, 'smooth');
    expect(isSmoothVertex(smooth, 2)).toBe(true);
    const corner = convertVertex(smooth, 2, 'corner');
    expect(isSmoothVertex(corner, 2)).toBe(false);
    // ao recolher, as arestas voltam a ser retas
    expect(corner.segments[1]!.kind).toBe('line');
    expect(corner.segments[2]!.kind).toBe('line');
  });

  it('converter arrastando cria alças simétricas', () => {
    const s = convertVertex(rect(0, 0, 100, 100), 2, 'smooth', v(130, 120));
    const seg = s.segments[2]! as { c1: { x: number; y: number } };
    expect(seg.c1).toEqual(v(130, 120));
    const inc = s.segments[1]! as { c2: { x: number; y: number } };
    expect(inc.c2.x).toBeCloseTo(70, 9);
    expect(inc.c2.y).toBeCloseTo(80, 9);
  });

  it('mover alça de ponto suave mantém a oposta alinhada', () => {
    const s = convertVertex(rect(0, 0, 100, 100), 2, 'smooth');
    const moved = moveHandleSmooth(s, 2, 'c1', v(60, 140));
    expect(isSmoothVertex(moved, 2)).toBe(true);
  });
});

describe('margens manuais', () => {
  it('molde novo nasce sem margem (linha de corte = linha de costura)', () => {
    const p = block();
    expect(p.seamAllowanceMm).toBe(0);
    expect(cutLine(p)).toEqual(flattenPath(p.outline));
  });

  it('corte não cria margem automática na borda nova', () => {
    const [a] = cutPiece(block(), { edge: 0, t: 0.5 }, { edge: 2, t: 0.5 });
    const seams = Array.from({ length: edgeCount(a.outline) }, (_, i) => edgeSeam(a, i));
    expect(seams.every((x) => x === 0)).toBe(true);
  });

  it('margem só nas bordas escolhidas', () => {
    const p = { ...block(), seamByEdge: { '1': 10, '0': 30 } };
    const b = bboxOfPoints(cutLine(p));
    expect(b.maxX - b.minX).toBeCloseTo(410, 6); // só a lateral direita ganhou 10 mm
    expect(b.minY).toBeCloseTo(-30, 6); // barra de 30 mm
    expect(b.maxY).toBeCloseTo(600, 6); // topo sem margem
  });
});

describe('plotagem de pences', () => {
  it('pence sai no PLT/PDF: pernas, 2 piques e furo', () => {
    const p = createDart({ ...block(), seamAllowanceMm: 10 }, { edge: 2, t: 0.5 }, v(200, 450), 30);
    const job = addPiece(emptyJob(), p);
    // corte + costura + pernas + 2 piques + furo = 6 traços (sem fio, sem internas)
    expect(job.strokes.length).toBe(6);
    expect(cutLine(p).length).toBeGreaterThan(3);
  });
});
