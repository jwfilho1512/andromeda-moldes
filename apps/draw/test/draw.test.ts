import { describe, expect, it } from 'vitest';
import { flattenPath, signedArea } from '@cad-textil/core';
import { BASES } from '../src/lib/bases';
import { CROQUIS } from '../src/lib/croquis';
import { DETALHES } from '../src/lib/detalhes';
import { line } from '../src/lib/kit';
import { bakeMirror, mirrored, offsetPolyline, scaleAbout, shapeBBox, transformShape } from '../src/model/geom';
import { STITCH_DEFAULT, stitchStrokes } from '../src/model/stitch';
import { docToSvg } from '../src/model/svg';
import type { PathShape, Shape, StitchType } from '../src/model/types';
import { newDoc } from '../src/state';

const half: PathShape = {
  kind: 'path',
  id: 'a',
  path: line([0, 0], [10, 0], [10, 20], [0, 20]),
  style: { stroke: '#000', width: 0.3, fill: null },
  mirror: 0,
};

describe('simetria', () => {
  it('meio contorno com as pontas no eixo vira um contorno fechado inteiro', () => {
    const ps = mirrored(half.path, 0);
    expect(ps).toHaveLength(1);
    expect(ps[0]!.closed).toBe(true);
    expect(Math.abs(signedArea(flattenPath(ps[0]!)))).toBeCloseTo(20 * 20, 6);
  });

  it('forma fora do eixo é copiada espelhada', () => {
    const ps = mirrored(line([5, 0], [8, 3]), 0);
    expect(ps).toHaveLength(2);
    expect(ps[1]!.start.x).toBeCloseTo(-5, 9);
  });

  it('caixa da forma considera o espelho; escala leva o eixo junto', () => {
    expect(shapeBBox(half)).toMatchObject({ minX: -10.15, maxX: 10.15 });
    const s = transformShape(half, scaleAbout({ x: 0, y: 0 }, 2, 2)) as PathShape;
    expect(s.mirror).toBe(0);
    expect(shapeBBox(s)!.maxX).toBeCloseTo(20.15, 6);
  });

  it('expandir simetria gera desenho real', () => {
    const baked = bakeMirror(half);
    expect(baked).toHaveLength(1);
    expect(baked[0]!.mirror).toBeUndefined();
    expect((baked[0] as PathShape).path.closed).toBe(true);
  });
});

describe('pespontos', () => {
  it('paralela a 2 mm fica exatamente a 2 mm (lado esquerdo do sentido)', () => {
    const off = offsetPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2);
    expect(off[0]!.y).toBeCloseTo(-2, 9);
    expect(off[1]!.y).toBeCloseTo(-2, 9);
  });

  it('todos os tipos geram traços', () => {
    const p = line([0, 0], [30, 0], [30, 20]);
    for (const type of Object.keys(STITCH_DEFAULT) as StitchType[]) {
      const st = stitchStrokes(p, { type, ...STITCH_DEFAULT[type], color: '#000' });
      expect(st.length, type).toBeGreaterThan(0);
      for (const s of st) expect(s.d, type).not.toMatch(/NaN/);
    }
  });

  it('pesponto duplo tem duas linhas a gap/2 de cada lado', () => {
    const st = stitchStrokes(line([0, 0], [10, 0]), { type: 'duplo', gap: 0.6, len: 1, width: 0.1, color: '#000' });
    expect(st).toHaveLength(2);
    expect(st[0]!.d).toContain('-0.3');
    expect(st[1]!.d).toContain('0.3');
  });
});

const walk = (s: Shape, f: (x: Shape) => void) => {
  f(s);
  if (s.kind === 'group') s.children.forEach((c) => walk(c, f));
};

describe('biblioteca', () => {
  it('todas as peças base geram frente e costas com o contorno fechado no eixo', () => {
    for (const b of BASES)
      for (const vista of ['frente', 'costas'] as const) {
        const shapes = b.make(b.defaults, vista);
        const corpo = shapes.find((s) => s.kind === 'path' && s.name) as PathShape;
        expect(corpo, `${b.id} ${vista}`).toBeTruthy();
        expect(mirrored(corpo.path, 0), `${b.id} ${vista} fecha no eixo`).toHaveLength(1);
        const svg = docToSvg({ ...newDoc(), layers: [{ id: 'l', name: 'l', visible: true, locked: false, shapes }] });
        expect(svg, b.id).not.toMatch(/NaN|undefined/);
      }
  });

  it('todas as opções das peças funcionam', () => {
    for (const b of BASES)
      for (const opt of b.options)
        for (const c of opt.choices ?? []) {
          const shapes = b.make({ ...b.defaults, [opt.key]: c.value }, 'frente');
          const svg = docToSvg({ ...newDoc(), layers: [{ id: 'l', name: 'l', visible: true, locked: false, shapes }] });
          expect(svg, `${b.id} ${opt.key}=${c.value}`).not.toMatch(/NaN|undefined/);
        }
  });

  it('detalhes e croquis desenham sem erro', () => {
    for (const d of [...DETALHES, ...CROQUIS]) {
      const shapes = d.make();
      expect(shapes.length, d.id).toBeGreaterThan(0);
      let n = 0;
      shapes.forEach((s) => walk(s, () => n++));
      const svg = docToSvg({ ...newDoc(), layers: [{ id: 'l', name: 'l', visible: true, locked: false, shapes }] });
      expect(svg, d.id).not.toMatch(/NaN|undefined/);
    }
  });
});

describe('arquivo SVG', () => {
  it('sai em milímetros com a prancha inteira', () => {
    const svg = docToSvg(newDoc('Teste'));
    expect(svg).toContain('width="420mm"');
    expect(svg).toContain('viewBox="0 0 420 297"');
  });
});

describe('pesponto ao longo da borda', () => {
  it('contorno fechado usa o caminho mais curto (passando pelo início)', async () => {
    const { stitchAlong } = await import('../src/model/stitch');
    const { flattenPath } = await import('@cad-textil/core');
    // quadrado 100×100 começando no canto (0,0); cliques na borda esquerda perto do início e mais abaixo
    const sq = flattenPath(line([0, 0], [100, 0], [100, 100], [0, 100], [0, 0]));
    const total = 400;
    const pts = stitchAlong(sq, true, 2, total - 60, 0, 1);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    // fica todo na borda esquerda/topo perto do canto, sem dar a volta
    for (const p of pts) expect(p.x <= 2 + 1e-9 || p.y <= 1e-9).toBe(true);
  });
});

describe('ferramentas de desenho', () => {
  it('lápis: simplifica o traço e mantém as pontas', async () => {
    const { simplify, freehandPath } = await import('../src/model/draw-tools');
    const raw = Array.from({ length: 101 }, (_, i) => ({ x: i, y: Math.sin(i / 10) * 0.02 }));
    const s = simplify(raw, 0.1);
    expect(s.length).toBe(2);
    const p = freehandPath(raw, 0.1, false)!;
    expect(p.start).toEqual({ x: 0, y: raw[0]!.y });
    expect(p.segments[p.segments.length - 1]!.to.x).toBe(100);
  });

  it('polígono e estrela', async () => {
    const { polygonPath } = await import('../src/model/draw-tools');
    const hex = polygonPath({ x: 0, y: 0 }, 10, 6, 0);
    expect(hex.segments).toHaveLength(6);
    for (const s of hex.segments) expect(Math.hypot(s.to.x, s.to.y)).toBeCloseTo(10, 9);
    const star = polygonPath({ x: 0, y: 0 }, 10, 5, 0, 0.5);
    expect(star.segments).toHaveLength(10);
    expect(Math.hypot(star.segments[0]!.to.x, star.segments[0]!.to.y)).toBeCloseTo(5, 9);
  });

  it('tesoura: corta um traço aberto em dois e abre um contorno fechado', async () => {
    const { splitPathAt } = await import('../src/model/draw-tools');
    const parts = splitPathAt(line([0, 0], [100, 0]), { x: 30, y: 1 });
    expect(parts).toHaveLength(2);
    expect(parts[0]!.segments[0]!.to.x).toBeCloseTo(30, 9);
    expect(parts[1]!.start.x).toBeCloseTo(30, 9);
    const sq = { ...line([0, 0], [10, 0], [10, 10], [0, 10], [0, 0]), closed: true };
    const open = splitPathAt(sq, { x: 10, y: 5 });
    expect(open).toHaveLength(1);
    expect(open[0]!.closed).toBe(false);
    expect(open[0]!.start).toEqual({ x: 10, y: 5 });
    expect(open[0]!.segments[open[0]!.segments.length - 1]!.to).toEqual({ x: 10, y: 5 });
  });

  it('cota mostra a medida real pela escala', async () => {
    const { dimValueCm, fmtCm } = await import('../src/model/draw-tools');
    const d = { kind: 'dim' as const, id: 'd', a: { x: 0, y: 0 }, b: { x: 102, y: 0 }, off: 4, color: '#000', size: 3 };
    expect(fmtCm(dimValueCm(d, 5))).toBe('51 cm');
    const svg = docToSvg({ ...newDoc(), scale: 5, layers: [{ id: 'l', name: 'l', visible: true, locked: false, shapes: [d] }] });
    expect(svg).toContain('51 cm');
  });

  it('pincéis geram formas sem erro (aberto e fechado)', async () => {
    const { brushRender } = await import('../src/model/brush');
    const open = line([0, 0], [50, 0], [60, 30]);
    const closed = { ...line([0, 0], [20, 0], [20, 20], [0, 20], [0, 0]), closed: true };
    for (const kind of ['caligrafico', 'afinado', 'marcador', 'grafite'] as const)
      for (const p of [open, closed]) {
        const r = brushRender(p, { kind, size: 2, angle: 30 });
        const all = r.fill + r.strokes.map((s) => s.d).join('');
        expect(all.length, kind).toBeGreaterThan(10);
        expect(all, kind).not.toMatch(/NaN/);
      }
    // afinado: fino nas pontas, cheio no meio
    const r = brushRender(line([0, 0], [100, 0]), { kind: 'afinado', size: 4 });
    const ys = (r.fill.match(/-?[\d.]+ -?[\d.]+/g) ?? []).map((s) => Math.abs(Number(s.split(' ')[1])));
    expect(Math.max(...ys)).toBeCloseTo(2, 1);
  });
});

describe('Minha biblioteca', () => {
  it('guarda centralizado, lê pacotes, junta sem duplicar e mantém o tamanho real em outra escala', async () => {
    const { makeAsset, parseLibrary, mergeLibrary, assetShapes, emptyLibrary } = await import('../src/model/userlib');
    const sq: PathShape = { kind: 'path', id: 'q', path: { ...line([100, 50], [140, 50], [140, 90], [100, 90], [100, 50]), closed: true }, style: { stroke: '#000', width: 0.3, fill: null } };
    const a = makeAsset('  Bolso  ', 'detalhes', [sq], 5);
    expect(a.name).toBe('Bolso');
    const b = shapeBBox(a.shapes[0]!)!;
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 9);
    expect(b.minY).toBeCloseTo(0, 9);
    // o original não muda
    expect(sq.path.start.x).toBe(100);
    const pack = { ...emptyLibrary(), assets: [a, { id: 'x', name: 'ruim', cat: 'nada', shapes: [] }] };
    const lib = parseLibrary(JSON.stringify(pack));
    expect(lib.assets).toHaveLength(1);
    const m1 = mergeLibrary(emptyLibrary(), lib);
    const m2 = mergeLibrary(m1.lib, lib);
    expect(m1.added).toBe(1);
    expect(m2.added).toBe(0);
    // salvo em 1:5 (40 mm no desenho = 20 cm reais) → em 1:10 entra com 20 mm
    const at10 = shapeBBox(assetShapes(a, 10)[0]!)!;
    expect(at10.maxX - at10.minX - 0.3).toBeCloseTo(20, 6);
    expect(() => parseLibrary('{"format":"outra"}')).toThrow(/biblioteca/);
  });
});
