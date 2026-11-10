import { describe, expect, it } from 'vitest';
import {
  type FabricSpec,
  type Piece,
  autoNest,
  bboxOfPoints,
  createPiece,
  emptyGrading,
  linearOffsets,
  markerItems,
  markerJob,
  markerStats,
  nest,
  optimizeStep,
  overlapping,
  placedPolygon,
  rect,
  rng,
  setVertexRule,
  spreadResult,
  v,
} from '../src/index.js';

const FAB: FabricSpec = { widthMm: 1000, edgeMarginMm: 0, gapMm: 0, rotation: 'fixo', faceToFace: false, resolutionMm: 2 };

/** Retângulo comprimento × largura com o fio no comprimento (horizontal). */
function bar(id: string, len: number, wid: number, qty = 1): Piece {
  return { ...createPiece(id, id, rect(0, 0, len, wid)), grainline: [v(10, wid / 2), v(len - 10, wid / 2)], quantity: qty };
}

describe('lista de moldes do pedido', () => {
  it('molde sem grade: quantidade × total de peças do pedido', () => {
    const items = markerItems([bar('a', 400, 250, 2)], { M: 3 }, FAB);
    expect(items).toHaveLength(6);
  });

  it('molde graduado: só os tamanhos pedidos, cada um no seu tamanho', () => {
    let p: Piece = { ...bar('a', 400, 250), grading: emptyGrading(['P', 'M', 'G'], 1) };
    p = setVertexRule(p, 1, linearOffsets(p.grading!, v(20, 0)));
    p = setVertexRule(p, 2, linearOffsets(p.grading!, v(20, 0)));
    const items = markerItems([p], { P: 1, G: 2 }, FAB);
    expect(items.map((i) => i.size)).toEqual(['P', 'G', 'G']);
    const wP = bboxOfPoints(items[0]!.poly).maxX;
    const wG = bboxOfPoints(items[1]!.poly).maxX;
    expect(wP).toBeCloseTo(380, 6);
    expect(wG).toBeCloseTo(420, 6);
  });

  it('o fio fica no comprimento do rolo (molde em pé é deitado)', () => {
    const p = { ...createPiece('m', 'Manga', rect(0, 0, 250, 600)), grainline: [v(125, 50), v(125, 550)] as [ReturnType<typeof v>, ReturnType<typeof v>] };
    const it = markerItems([p], { M: 1 }, FAB)[0]!;
    const b = bboxOfPoints(it.poly);
    expect(b.maxX).toBeCloseTo(600, 6);
    expect(b.maxY).toBeCloseTo(250, 6);
  });

  it('cortar em par: um espelhado; face com face: um só', () => {
    const p = { ...bar('m', 400, 250, 2), cutInPairs: true };
    const items = markerItems([p], { M: 1 }, FAB);
    expect(items.map((i) => i.mirror)).toEqual([false, true]);
    expect(markerItems([p], { M: 1 }, { ...FAB, faceToFace: true })).toHaveLength(1);
  });
});

describe('encaixe automático', () => {
  it('8 retângulos 400×250 em tecido de 1 m: risco de 800 mm, 100% de aproveitamento', () => {
    const items = markerItems([bar('a', 400, 250, 8)], { M: 1 }, FAB);
    const { placements, unplaced } = nest(items, FAB);
    expect(unplaced).toHaveLength(0);
    const st = markerStats(items, placements, FAB);
    expect(st.lengthMm).toBeCloseTo(800, 6);
    expect(st.efficiency).toBeCloseTo(1, 6);
    expect(overlapping(items, placements, FAB).size).toBe(0);
  });

  it('distância entre moldes é respeitada', () => {
    const fab = { ...FAB, gapMm: 10 };
    const items = markerItems([bar('a', 400, 240, 4)], { M: 1 }, fab);
    const { placements } = nest(items, fab);
    const polys = placements.map((pl) => bboxOfPoints(placedPolygon(items.find((i) => i.key === pl.key)!, pl, fab)));
    for (let i = 0; i < polys.length; i++)
      for (let j = i + 1; j < polys.length; j++) {
        const a = polys[i]!, b = polys[j]!;
        const dx = Math.max(b.minX - a.maxX, a.minX - b.maxX);
        const dy = Math.max(b.minY - a.maxY, a.minY - b.maxY);
        expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(10 - 1e-6);
      }
  });

  it('margem da ourela e largura respeitadas; nada sobreposto em moldes irregulares', () => {
    const fab: FabricSpec = { ...FAB, widthMm: 1500, edgeMarginMm: 10, gapMm: 2, rotation: '180', resolutionMm: 3 };
    const tri = (id: string): Piece => ({
      ...createPiece(id, id, { start: v(0, 0), segments: [{ kind: 'line', to: v(600, 0) }, { kind: 'line', to: v(100, 300) }, { kind: 'line', to: v(0, 0) }], closed: true }),
      grainline: [v(50, 50), v(500, 50)],
      quantity: 6,
    });
    const items = markerItems([tri('t'), bar('b', 500, 200, 3)], { M: 1 }, fab);
    const { placements, unplaced } = autoNest(items, fab, 30);
    expect(unplaced).toHaveLength(0);
    expect(overlapping(items, placements, fab).size).toBe(0);
    for (const pl of placements) {
      const bb = bboxOfPoints(placedPolygon(items.find((i) => i.key === pl.key)!, pl, fab));
      expect(bb.minY).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(bb.maxY).toBeLessThanOrEqual(1490 + 1e-6);
    }
    // triângulos girados 180° se encaixam uns nos outros: aproveitamento razoável
    // triângulos são um caso difícil; o automático nunca é pior que a passada única
    const single = markerStats(items, nest(items, fab).placements, fab).efficiency;
    const auto = markerStats(items, placements, fab).efficiency;
    expect(auto).toBeGreaterThanOrEqual(single - 1e-9);
    expect(auto).toBeGreaterThan(0.55);
  });

  it('molde mais largo que o tecido fica de fora (não é forçado)', () => {
    const items = markerItems([bar('big', 400, 1200)], { M: 1 }, FAB);
    const { unplaced } = nest(items, FAB);
    expect(unplaced).toHaveLength(1);
  });

  it('otimização nunca piora o risco', () => {
    const fab: FabricSpec = { ...FAB, widthMm: 1000, rotation: '180', resolutionMm: 4 };
    const pieces = [bar('a', 530, 330, 3), bar('b', 270, 410, 4), bar('c', 610, 170, 3)];
    const items = markerItems(pieces, { M: 1 }, fab);
    const first = nest(items, fab);
    const l0 = markerStats(items, first.placements, fab).lengthMm;
    const state = { order: [...items].sort((a, b) => b.area - a.area).map((i) => i.key), rotPref: {}, lookahead: 1, toleranceMm: 0, best: { ...first, length: l0 } };
    optimizeStep(items, fab, state, rng(42), 25);
    expect(state.best.length).toBeLessThanOrEqual(l0 + 1e-6);
    expect(overlapping(items, state.best.placements, fab).size).toBe(0);
  });

  it('encaixar restantes mantém os moldes fixados onde estão', () => {
    const items = markerItems([bar('a', 400, 250, 4)], { M: 1 }, FAB);
    const fixed = [{ key: items[0]!.key, x: 1000, y: 0, rot: 0 as const }];
    const { placements } = nest(items, FAB, { fixed });
    expect(placements.find((p) => p.key === items[0]!.key)).toEqual(fixed[0]);
    expect(overlapping(items, placements, FAB).size).toBe(0);
  });

  it('PLT do risco: um contorno de corte por molde + borda do tecido', () => {
    const p = bar('a', 400, 250, 4);
    const items = markerItems([p], { M: 1 }, FAB);
    const { placements } = nest(items, FAB);
    const job = markerJob([p], items, placements, FAB);
    const cuts = job.strokes.filter((s) => s.pen === 1 && s.closed);
    expect(cuts).toHaveLength(4);
    expect(job.strokes.some((s) => s.pen === 2 && s.closed)).toBe(true);
  });
});

describe('enfesto', () => {
  it('consumo por peça = (risco + pontas) × folhas / peças', () => {
    const r = spreadResult(2400, 5, { plies: 40, endAllowanceMm: 20 });
    expect(r.plyLengthM).toBeCloseTo(2.44, 9);
    expect(r.fabricTotalM).toBeCloseTo(97.6, 9);
    expect(r.garments).toBe(200);
    expect(r.perGarmentM).toBeCloseTo(0.488, 9);
  });
});

describe('segurança da grade com vários intervalos', () => {
  it('moldes irregulares (com reentrâncias) nunca se sobrepõem, em várias resoluções e folgas', () => {
    const rand = rng(99);
    const blob = (id: string): Piece => {
      // estrela irregular (bem côncava)
      const n = 9;
      const pts = Array.from({ length: n * 2 }, (_, k) => {
        const a = (k / (n * 2)) * Math.PI * 2;
        const rr = (k % 2 ? 60 : 160) + rand() * 40;
        return v(200 + Math.cos(a) * rr, 200 + Math.sin(a) * rr);
      });
      return { ...createPiece(id, id, { start: pts[0]!, segments: [...pts.slice(1), pts[0]!].map((to) => ({ kind: 'line' as const, to })), closed: true }), grainline: [v(100, 200), v(300, 200)], quantity: 5 };
    };
    for (const [res, gap] of [[2, 0], [3, 2], [5, 4]] as const) {
      const fab: FabricSpec = { widthMm: 900, edgeMarginMm: 5, gapMm: gap, rotation: '90', faceToFace: false, resolutionMm: res };
      const items = markerItems([blob('a'), blob('b')], { M: 1 }, fab);
      const best = autoNest(items, fab, 6, 7);
      expect(best.unplaced).toHaveLength(0);
      expect(overlapping(items, best.placements, fab).size).toBe(0);
    }
  }, 120000);
});

describe('comprimento máximo do risco', () => {
  it('moldes que não cabem no comprimento máximo ficam de fora', () => {
    const fab = { ...FAB, maxLengthMm: 800 };
    const items = markerItems([bar('a', 400, 250, 12)], { M: 1 }, fab);
    const { placements, unplaced } = nest(items, fab);
    expect(placements).toHaveLength(8);
    expect(unplaced).toHaveLength(4);
    expect(markerStats(items, placements, fab).lengthMm).toBeLessThanOrEqual(800 + 1e-6);
  });
});
