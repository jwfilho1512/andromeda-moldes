import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import {
  type Artwork,
  type Piece,
  type PiecePrint,
  type Vec2,
  DEFAULT_FABRIC,
  createPiece,
  exportPdfPrint,
  linearOffsets,
  mapPiece,
  markerItems,
  markerJob,
  markerPrints,
  nest,
  pieceForSize,
  placedPolygon,
  printInstances,
  printLayout,
  rect,
  setVertexRule,
  shrinkFactor,
} from '../src/index.js';

const art: Artwork = { id: 'a1', name: 'logo.png', mime: 'image/png', dataUrl: '', widthPx: 1000, heightPx: 500 };
const artP: Artwork = { id: 'aP', name: 'P.png', mime: 'image/png', dataUrl: '', widthPx: 800, heightPx: 800 };

function frente(prints: PiecePrint[]): Piece {
  return { ...createPiece('f', 'Frente', rect(0, 0, 200, 300)), prints };
}
const loc = (over: Partial<PiecePrint> = {}): PiecePrint => ({ id: 'e1', mode: 'localizada', art: { '': 'a1' }, center: { x: 100, y: 150 }, rotationDeg: 0, mirrored: false, widthMm: 100, bleedMm: 5, ...over });

/** Cantos da imagem (u,v ∈ {0,1}) em mm. */
const corners = (m: number[]): Vec2[] => [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => ({ x: m[0]! * u! + m[2]! * v! + m[4]!, y: m[1]! * u! + m[3]! * v! + m[5]! }));
const close = (a: Vec2[], b: Vec2[]) => a.every((p, i) => Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y) < 1e-6);

describe('estampas', () => {
  it('localizada: largura em mm e altura pela proporção, centrada', () => {
    const [i] = printInstances(frente([loc()]), '', [art]);
    [100, 0, 0, 50, 50, 125].forEach((v, k) => expect(i!.m[k]).toBeCloseTo(v, 9));
    // recorte = corte + sangria de 5 mm
    const xs = i!.clip.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(-5, 6);
    expect(Math.max(...xs)).toBeCloseTo(205, 6);
  });

  it('a arte acompanha o molde ao girar e espelhar', () => {
    const p = frente([loc({ rotationDeg: 30 })]);
    const before = corners(printInstances(p, '', [art])[0]!.m);
    const rot = (q: Vec2) => ({ x: -q.y + 40, y: q.x - 7 });
    expect(close(corners(printInstances(mapPiece(p, rot), '', [art])[0]!.m), before.map(rot))).toBe(true);
    const mir = (q: Vec2) => ({ x: 500 - q.x, y: q.y });
    const mp = mapPiece(p, mir);
    expect(mp.prints![0]!.mirrored).toBe(true);
    expect(close(corners(printInstances(mp, '', [art])[0]!.m), before.map(mir))).toBe(true);
  });

  it('corrida cobre o molde inteiro; total cobre a caixa sem distorcer', () => {
    const tiles = printInstances(frente([{ ...loc(), mode: 'corrida', widthMm: 50 }]), '', [art]);
    // módulo 50 × 25 mm, centrado em (100,150), cobrindo −5..205 × −5..305
    expect(tiles.length).toBe(6 * 14);
    const [t] = printInstances(frente([{ ...loc(), mode: 'total' }]), '', [art]);
    const c = corners(t!.m);
    expect(c[0]!.y).toBeCloseTo(-5, 6);
    expect(c[2]!.y).toBeCloseTo(305, 6);
    expect((c[1]!.x - c[0]!.x) / (c[2]!.y - c[1]!.y)).toBeCloseTo(2, 9); // proporção da imagem mantida
  });

  it('arte e largura por tamanho; o centro anda com a gradação', () => {
    let p = frente([loc({ art: { '': 'a1', P: 'aP' }, widthBySize: { P: 80 } })]);
    p = { ...p, grading: { sizes: ['P', 'M'], base: 1, rules: {} } };
    for (const v of [0, 1, 2, 3]) p = setVertexRule(p, v, linearOffsets(p.grading!, { x: v === 1 || v === 2 ? 10 : 0, y: 0 }));
    const small = pieceForSize(p, 0);
    const [i] = printInstances(small, 'P', [art, artP]);
    expect(i!.artId).toBe('aP');
    expect(i!.m[0]).toBeCloseTo(80, 9);
    expect(small.prints![0]!.center.x).toBeLessThan(100); // o P é mais estreito: o centro anda junto
    expect(printInstances(pieceForSize(p, 1), 'M', [art, artP])[0]!.artId).toBe('a1');
  });

  it('no encaixe, moldes estampados ficam afastados pela sangria e a localizada não espelha no par', () => {
    const p = { ...frente([loc({ bleedMm: 8 })]), cutInPairs: true, quantity: 2 };
    const fabric = { ...DEFAULT_FABRIC, widthMm: 1000, gapMm: 0, resolutionMm: 2 };
    const items = markerItems([p], { '': 1 }, fabric);
    expect(items.every((i) => i.pad === 4)).toBe(true);
    const r = nest(items, fabric);
    expect(r.unplaced).toHaveLength(0);
    const [a, b] = r.placements.map((pl) => placedPolygon(items.find((i) => i.key === pl.key)!, pl, fabric));
    const ba = { minX: Math.min(...a!.map((q) => q.x)), maxX: Math.max(...a!.map((q) => q.x)), minY: Math.min(...a!.map((q) => q.y)), maxY: Math.max(...a!.map((q) => q.y)) };
    const bb = { minX: Math.min(...b!.map((q) => q.x)), maxX: Math.max(...b!.map((q) => q.x)), minY: Math.min(...b!.map((q) => q.y)), maxY: Math.max(...b!.map((q) => q.y)) };
    const gap = Math.max(bb.minX - ba.maxX, ba.minX - bb.maxX, bb.minY - ba.maxY, ba.minY - bb.maxY);
    expect(gap).toBeGreaterThanOrEqual(8 - 1e-6);
    const inst = markerPrints([p], items, r.placements, fabric, [art]);
    expect(inst).toHaveLength(2);
    for (const i of inst) expect(i.m[0] * i.m[3] - i.m[1] * i.m[2]).toBeGreaterThan(0); // não espelhada
  });

  it('PDF de sublimação: imagem embutida, recorte, compensação de encolhimento e painéis', () => {
    const p = frente([loc()]);
    const fabric = { ...DEFAULT_FABRIC, widthMm: 1000 };
    const items = markerItems([p], { '': 1 }, fabric);
    const r = nest(items, fabric);
    const job = markerJob([p], items, r.placements, fabric);
    const prints = markerPrints([p], items, r.placements, fabric, [art]);
    const px = new Uint8Array(2 * 1 * 3).fill(200);
    const pdf = exportPdfPrint(job, prints, [{ id: 'a1', width: 2, height: 1, filter: 'FlateDecode', colorSpace: 'DeviceRGB', data: deflateSync(px) }], { shrinkXPct: 2, shrinkYPct: 1 });
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text).toContain('/Subtype /Image');
    expect(text).toContain('/Im0 Do');
    expect(text).toContain('h W n');
    expect(text.match(/\/Type \/Page /g)).toHaveLength(1);
    expect(shrinkFactor(2)).toBeCloseTo(1 / 0.98, 12);
    // rolo na vertical: largura do arquivo = largura do tecido (+ encolhimento + margens)
    const L = printLayout(job, { shrinkXPct: 2, shrinkYPct: 1 });
    expect(L.wMm).toBeCloseTo(1000 / 0.99 + 20, 6);
    // ponto do risco (X=0, Y=0) cai embaixo à direita; (X, Y=1000) embaixo à esquerda
    const T = (X: number, Y: number) => ({ x: L.t[0] * X + L.t[2] * Y + L.t[4], y: L.t[1] * X + L.t[3] * Y + L.t[5] });
    expect(T(0, 1000).x).toBeCloseTo(10, 6);
    expect(T(0, 0).x).toBeCloseTo(L.wMm - 10, 6);
    // espelhado (papel transfer): troca os lados
    const M = printLayout(job, { shrinkXPct: 2, shrinkYPct: 1, mirror: true });
    expect(M.t[2] * 1000 + M.t[4]).toBeCloseTo(L.wMm - 10, 6);
    // risco de 12 m: página única com UserUnit
    const longJob = { strokes: [{ points: [{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 1600 }], closed: true, pen: 2 as const }], labels: [] };
    const big = new TextDecoder('latin1').decode(exportPdfPrint(longJob, [], [], {}));
    expect(big).toMatch(/\/UserUnit 2\.36\d/);
    expect(big.match(/\/Type \/Page /g)).toHaveLength(1);
  });

  it('altura própria (proporção destravada), espelho vertical e ajustes da total', () => {
    const [i] = printInstances(frente([loc({ heightMm: 80, flipV: true })]), '', [art]);
    expect(i!.m[0]).toBeCloseTo(100, 9);
    expect(i!.m[3]).toBeCloseTo(-80, 9); // de cabeça para baixo
    const fit = (f: 'cobrir' | 'conter' | 'esticar') => corners(printInstances(frente([{ ...loc(), mode: 'total', fit: f }]), '', [art])[0]!.m);
    const c = fit('conter');
    expect(c[1]!.x - c[0]!.x).toBeCloseTo(210, 6); // cabe na largura (210 com sangria), sobra em cima/embaixo
    const e = fit('esticar');
    expect(e[2]!.y - e[1]!.y).toBeCloseTo(310, 6);
    expect(e[1]!.x - e[0]!.x).toBeCloseTo(210, 6);
  });

  it('repetições: espaço entre módulos, meio-salto, tijolo e espelhada', () => {
    const base = { ...loc(), mode: 'corrida' as const, widthMm: 50, heightMm: 50 };
    const grid = printInstances(frente([{ ...base, gapXMm: 10, gapYMm: 10 }]), '', [art]);
    const xs = [...new Set(grid.map((t) => Math.round(t.m[4] * 1e6) / 1e6))].sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBeCloseTo(60, 6);
    const drop = printInstances(frente([{ ...base, repeat: 'meio-salto' }]), '', [art]);
    const ysCol = (x: number) => drop.filter((t) => Math.abs(t.m[4] - x) < 1e-6).map((t) => t.m[5]);
    expect(Math.abs((ysCol(100)[0]! - ysCol(150)[0]!) % 50)).toBeCloseTo(25, 6);
    const mir = printInstances(frente([{ ...base, repeat: 'espelhada' }]), '', [art]);
    expect(mir.some((t) => t.m[0] < 0)).toBe(true);
    expect(mir.some((t) => t.m[3] < 0)).toBe(true);
    const brick = printInstances(frente([{ ...base, repeat: 'tijolo' }]), '', [art]);
    expect(brick.length).toBeGreaterThan(0);
  });

  it('textura é contínua no tecido: a grade dos módulos é a mesma em todos os moldes do risco', () => {
    const tex: PiecePrint = { ...loc(), id: 't', mode: 'textura', widthMm: 40, heightMm: 30, bleedMm: 0 };
    const a = { ...frente([tex]), id: 'a', grainline: [{ x: 100, y: 0 }, { x: 100, y: 300 }] as [Vec2, Vec2] };
    const b = { ...a, id: 'b', name: 'Costas' };
    const fabric = { ...DEFAULT_FABRIC, widthMm: 1000, gapMm: 3, edgeMarginMm: 10 };
    const items = markerItems([a, b], { '': 1 }, fabric);
    const r = nest(items, fabric);
    const inst = markerPrints([a, b], items, r.placements, fabric, [art]);
    // no risco o fio é X: o "para cima" da textura (V) aponta para +X e cada módulo mede 30 mm no comprimento
    for (const t of inst) {
      expect(t.m[2]).toBeCloseTo(30, 9);
      expect(t.m[3]).toBeCloseTo(0, 9);
      // origem dos módulos numa grade única ancorada no início do tecido (0, ourela)
      const kx = t.m[4] / 30, ky = (t.m[5] - 10) / 40;
      expect(Math.abs(kx - Math.round(kx))).toBeLessThan(1e-6);
      expect(Math.abs(ky - Math.round(ky))).toBeLessThan(1e-6);
    }
    expect(new Set(inst.map((t) => t.clip)).size).toBe(2);
  });
});
