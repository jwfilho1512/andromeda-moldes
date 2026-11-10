import { describe, expect, it } from 'vitest';
import { flattenPath, rect, signedArea, createPiece } from '@cad-textil/core';
import { importSvg, parsePathData, parseTransform, normColor } from '../src/model/importSvg';
import { bboxOfShapes, pathBBox, shapeBBox } from '../src/model/geom';
import { docToSvg } from '../src/model/svg';
import type { GroupShape, PathShape, Shape, TextShape } from '../src/model/types';
import { newDoc } from '../src/state';
import { piecesToShapes } from '../src/model/pieces';

const paths = (shapes: Shape[]): PathShape[] => shapes.flatMap((s) => (s.kind === 'group' ? paths(s.children) : s.kind === 'path' ? [s] : []));
const area = (p: PathShape) => Math.abs(signedArea(flattenPath(p.path, 0.01)));

describe('caminhos SVG', () => {
  it('comandos relativos, H/V e fechamento', () => {
    const [s] = parsePathData('m10 10 h20 v10 h-20 z');
    expect(s!.closed).toBe(true);
    expect(s!.segs.map((g) => g.to)).toEqual([{ x: 30, y: 10 }, { x: 30, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 10 }]);
  });

  it('números colados (1.5.5, -3-4, 1e-1)', () => {
    const [s] = parsePathData('M0 0L1.5.5-3-4l1e1 0');
    expect(s!.segs.map((g) => g.to)).toEqual([{ x: 1.5, y: 0.5 }, { x: -3, y: -4 }, { x: 7, y: -4 }]);
  });

  it('S e T refletem a alça anterior; Q vira cúbica', () => {
    const [s] = parsePathData('M0 0C0 10 10 10 10 0S20 -10 20 0Q25 5 30 0T40 0');
    const c2 = s!.segs[1]!;
    expect(c2.kind === 'cubic' && c2.c1).toEqual({ x: 10, y: -10 });
    expect(s!.segs).toHaveLength(4);
  });

  it('arco: meia volta de raio 10 vira cúbicas que passam pelo ponto de cima', () => {
    const [s] = parsePathData('M0 0A10 10 0 0 1 20 0');
    const pts = flattenPath({ start: s!.start, segments: s!.segs, closed: false }, 0.001);
    const top = Math.min(...pts.map((p) => p.y));
    expect(top).toBeCloseTo(-10, 2);
    expect(pts[pts.length - 1]).toEqual({ x: 20, y: 0 });
  });
});

describe('transformações e cores', () => {
  it('translate + scale + rotate(90 cx cy)', () => {
    const m = parseTransform('translate(10 0) scale(2)');
    expect([m.a, m.d, m.e]).toEqual([2, 2, 10]);
    const r = parseTransform('rotate(90 5 5)');
    // (10,5) gira 90° em torno de (5,5) → (5,10)
    expect(r.a * 10 + r.c * 5 + r.e).toBeCloseTo(5, 9);
    expect(r.b * 10 + r.d * 5 + r.f).toBeCloseTo(10, 9);
  });

  it('cores', () => {
    expect(normColor('#abc', null)).toBe('#aabbcc');
    expect(normColor('rgb(255, 0, 128)', null)).toBe('#ff0080');
    expect(normColor('none', null)).toBeNull();
    expect(normColor('black', null)).toBe('#000000');
  });
});

describe('arquivo SVG', () => {
  it('Illustrator: classes de <style>, unidade em pt e grupo', () => {
    const svg = `<?xml version="1.0"?><!-- Generator: Adobe Illustrator 28.0.0 -->
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72">
      <defs><style>.cls-1{fill:none;stroke:#1d1d1b;stroke-width:2px}.cls-2{fill:#fff}</style></defs>
      <g id="Camiseta"><rect class="cls-2" width="72" height="36"/><path class="cls-1" d="M0 0L72 72"/></g></svg>`;
    const r = importSvg(svg);
    // 72 pt = 1 polegada = 25,4 mm
    expect(r.widthMm).toBeCloseTo(25.4, 6);
    const g = r.shapes[0] as GroupShape;
    expect(g.kind).toBe('group');
    expect(g.name).toBe('Camiseta');
    const [box, ln] = g.children as [PathShape, PathShape];
    expect(box.style.fill).toEqual({ kind: 'solid', color: '#ffffff' });
    expect(area(box)).toBeCloseTo(25.4 * 12.7, 3);
    expect(ln.style.fill).toBeNull();
    expect(ln.style.stroke).toBe('#1d1d1b');
    expect(ln.style.width).toBeCloseTo((2 * 25.4) / 72, 6);
  });

  it('largura em mm com viewBox: tamanho exato', () => {
    const r = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 1000 500"><circle cx="500" cy="250" r="100" fill="red"/></svg>`);
    const b = shapeBBox(r.shapes[0]!)!;
    expect(b.maxX - b.minX).toBeCloseTo(20, 2);
    expect(r.widthMm).toBeCloseTo(100, 9);
  });

  it('forma composta (furo) mantém os subcaminhos com evenodd', () => {
    const r = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><path fill-rule="evenodd" d="M0 0H10V10H0Z M3 3H7V7H3Z"/></svg>`);
    const p = r.shapes[0] as PathShape;
    expect(p.subpaths).toHaveLength(1);
    expect(p.fillRule).toBe('evenodd');
    expect(docToSvg({ ...newDoc(), layers: [{ id: 'l', name: 'l', visible: true, locked: false, shapes: r.shapes }] })).toContain('fill-rule="evenodd"');
  });

  it('polígono, polilinha, linha, elipse, rect arredondado, <use>, texto e herança de estilo', () => {
    const r = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="96" height="96">
      <defs><symbol id="b"><circle cx="5" cy="5" r="5"/></symbol></defs>
      <g fill="none" stroke="#333" stroke-width="2" style="stroke-dasharray: 4 2">
        <polygon points="0,0 10,0 10,10"/><polyline points="0 20 10 20 10 30"/><line x1="0" y1="40" x2="10" y2="40"/>
        <ellipse cx="50" cy="50" rx="10" ry="5"/><rect x="60" y="0" width="20" height="10" rx="3"/>
      </g>
      <use xlink:href="#b" x="80" y="80" fill="blue"/>
      <text x="10" y="90" font-size="12">Ref. 0137</text>
      <path d="M0 0" style="display:none"/>
    </svg>`);
    const ps = paths(r.shapes);
    expect(ps.length).toBe(6);
    expect(ps[0]!.style.stroke).toBe('#333333');
    expect(ps[0]!.style.dash).toEqual([4 * 25.4 / 96, 2 * 25.4 / 96]);
    expect(ps[5]!.style.fill).toEqual({ kind: 'solid', color: '#0000ff' });
    const t = r.shapes.find((s) => s.kind === 'text') as TextShape;
    expect(t.text).toBe('Ref. 0137');
    expect(t.size).toBeCloseTo((12 * 25.4) / 96, 6);
    const svg = docToSvg({ ...newDoc(), layers: [{ id: 'l', name: 'l', visible: true, locked: false, shapes: r.shapes }] });
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('arquivo que não é SVG dá erro claro', () => {
    expect(() => importSvg('<html><body/></html>')).toThrow(/não é um SVG/);
  });
});

describe('moldes como desenho', () => {
  it('retângulo de 400 × 600 mm em 1:5 vira 80 × 120 mm no desenho', () => {
    const piece = { ...createPiece('a', 'Frente', rect(0, 0, 400, 600)), seamAllowanceMm: 10 };
    const shapes = piecesToShapes([piece], 5);
    const g = shapes[0] as GroupShape;
    // linha de corte (geometria, sem a espessura do traço) inclui 10 mm de margem de cada lado
    const corte = g.children.find((c) => c.name === 'Linha de corte') as PathShape;
    const b = pathBBox(corte.path);
    expect(b.maxX - b.minX).toBeCloseTo(84, 6);
    expect(b.maxY - b.minY).toBeCloseTo(124, 6);
    expect(bboxOfShapes(shapes)).toBeTruthy();
    expect(g.children.some((c) => c.name === 'Linha de costura')).toBe(true);
  });
});
