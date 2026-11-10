import { describe, expect, it } from 'vitest';
import {
  type Path,
  type Piece,
  allSizes,
  createPiece,
  cutLine,
  decodeDxf,
  encodeDxf,
  exportDxfAama,
  fitCubics,
  flattenPath,
  importDxf,
  linearOffsets,
  newDocument,
  notchGeometry,
  polygonDeviation,
  polyline,
  setVertexRule,
  vertices,
} from '../src/index.js';

/** Frente com curva de cava e decote, margens diferentes por borda, piques, fio e linha interna. */
function frente(): Piece {
  const outline: Path = {
    start: { x: 0, y: 0 },
    segments: [
      { kind: 'line', to: { x: 250, y: 0 } },
      { kind: 'line', to: { x: 260, y: 420 } },
      { kind: 'cubic', c1: { x: 220, y: 440 }, c2: { x: 200, y: 500 }, to: { x: 190, y: 560 } },
      { kind: 'line', to: { x: 80, y: 600 } },
      { kind: 'cubic', c1: { x: 60, y: 540 }, c2: { x: 20, y: 520 }, to: { x: 0, y: 520 } },
      { kind: 'line', to: { x: 0, y: 0 } },
    ],
    closed: true,
  };
  let p = createPiece('a', 'Frente com bolsão', outline);
  p = {
    ...p,
    seamByEdge: { '0': 30, '1': 10, '2': 10, '3': 10, '4': 10 }, // barra de 3 cm, dobra (borda 5) sem margem
    notches: [{ edge: 1, t: 0.5, depthMm: 5 }, { edge: 2, t: 0.4, depthMm: 5 }],
    grainline: [{ x: 120, y: 100 }, { x: 120, y: 450 }],
    internals: [polyline([{ x: 40, y: 200 }, { x: 140, y: 200 }, { x: 140, y: 320 }], false)],
    quantity: 2,
    cutInPairs: true,
    group: 'Camisa teste',
  };
  return p;
}

function graded(): Piece {
  let p = frente();
  p = { ...p, grading: { sizes: ['P', 'M', 'G'], base: 1, rules: {} } };
  const g = p.grading!;
  p = setVertexRule(p, 1, linearOffsets(g, { x: 10, y: 0 }));
  p = setVertexRule(p, 2, linearOffsets(g, { x: 10, y: 12 }));
  p = setVertexRule(p, 3, linearOffsets(g, { x: 6, y: 15 }));
  p = setVertexRule(p, 4, linearOffsets(g, { x: 3, y: 15 }));
  p = setVertexRule(p, 5, linearOffsets(g, { x: 0, y: 12 }));
  return p;
}

const doc = (pieces: Piece[]) => ({ ...newDocument('Teste DXF'), pieces });

describe('ajuste de curvas', () => {
  it('reconstrói uma Bézier a partir dos pontos achatados com erro < 0,05 mm', () => {
    const path: Path = { start: { x: 0, y: 0 }, segments: [{ kind: 'cubic', c1: { x: 50, y: 120 }, c2: { x: 180, y: -40 }, to: { x: 250, y: 60 } }], closed: false };
    const pts = flattenPath(path, 0.05);
    const cubics = fitCubics(pts, 0.05);
    expect(cubics.length).toBeLessThanOrEqual(3);
    const back = cubics.flatMap((c, i) => flattenPath({ start: c[0], segments: [{ kind: 'cubic', c1: c[1], c2: c[2], to: c[3] }], closed: false }, 0.01).slice(i ? 1 : 0));
    // compara como polilinhas abertas (fecha em si para usar a métrica de polígono)
    expect(polygonDeviation([...pts, ...[...pts].reverse()], [...back, ...[...back].reverse()])).toBeLessThan(0.1);
  });
});

describe('DXF-AAMA', () => {
  it('ida e volta: contorno, margens, piques, fio, linhas internas e textos (< 0,3 mm)', () => {
    const p = frente();
    const text = exportDxfAama(doc([p]));
    expect(text).toContain('AC1009');
    expect(text).toContain('Units: METRIC');
    expect(text).toContain('Piece Name: Frente com bolsão');
    const r = importDxf(text);
    expect(r.unit).toBe('mm');
    expect(r.unitSource).toBe('Units');
    expect(r.styleName).toBe('Teste DXF');
    expect(r.pieces).toHaveLength(1);
    const q = r.pieces[0]!;
    expect(q.name).toBe('Frente com bolsão');
    expect(q.quantity).toBe(2);
    expect(q.cutInPairs).toBe(true);
    expect(q.group).toBe('Camisa teste');
    // mesmos vértices (cantos e pontos de curva preservados)
    expect(vertices(q.outline)).toHaveLength(vertices(p.outline).length);
    // linha de costura e linha de corte
    expect(polygonDeviation(flattenPath(q.outline), flattenPath(p.outline))).toBeLessThan(0.3);
    expect(polygonDeviation(cutLine(q), cutLine(p))).toBeLessThan(0.3);
    expect(q.seamByEdge?.['0']).toBe(30);
    expect(q.seamByEdge?.['5']).toBeUndefined();
    // piques no mesmo lugar
    expect(q.notches).toHaveLength(2);
    p.notches.forEach((n, i) => {
      const a = notchGeometry(p, n).at, b = notchGeometry(q, q.notches[i]!).at;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.05);
    });
    expect(q.grainline![0].x).toBeCloseTo(120, 3);
    expect(q.grainline![1].y).toBeCloseTo(450, 3);
    expect(q.internals).toHaveLength(1);
    expect(vertices(q.internals[0]!)).toHaveLength(3);
  });

  it('acentos sobrevivem à gravação em Windows-1252', () => {
    const bytes = encodeDxf(exportDxfAama(doc([frente()])));
    expect(bytes.includes(0xe3)).toBe(true); // "ã" em 1252
    const r = importDxf(decodeDxf(bytes));
    expect(r.pieces[0]!.name).toBe('Frente com bolsão');
  });

  it('molde graduado: um bloco por tamanho e a grade volta igual (< 0,3 mm em cada tamanho)', () => {
    const p = graded();
    const text = exportDxfAama(doc([p]));
    expect(text.match(/\nBLOCK\r\n/g)).toHaveLength(3);
    expect(text).toContain('Sample Size: M');
    const r = importDxf(text);
    expect(r.sizes).toEqual(['P', 'M', 'G']);
    expect(r.pieces).toHaveLength(1);
    const q = r.pieces[0]!;
    expect(q.grading?.sizes).toEqual(['P', 'M', 'G']);
    expect(q.grading?.base).toBe(1);
    const a = allSizes(p), b = allSizes(q);
    a.forEach((s, i) => {
      expect(polygonDeviation(cutLine(b[i]!.piece), cutLine(s.piece))).toBeLessThan(0.3);
    });
  });

  it('exportar só o tamanho base', () => {
    const text = exportDxfAama(doc([graded()]), undefined, { sizes: 'base' });
    expect(text.match(/\nBLOCK\r\n/g)).toHaveLength(1);
    const r = importDxf(text);
    expect(r.pieces[0]!.grading).toBeUndefined();
  });

  it('arquivo em polegadas (Units: ENGLISH) é convertido para mm', () => {
    const dxf = [
      '0', 'SECTION', '2', 'BLOCKS',
      '0', 'BLOCK', '8', '1', '2', 'SQ', '70', '0', '10', '0', '20', '0',
      '0', 'POLYLINE', '8', '1', '66', '1', '70', '1',
      '0', 'VERTEX', '8', '1', '10', '0', '20', '0',
      '0', 'VERTEX', '8', '1', '10', '10', '20', '0',
      '0', 'VERTEX', '8', '1', '10', '10', '20', '10',
      '0', 'VERTEX', '8', '1', '10', '0', '20', '10',
      '0', 'SEQEND',
      '0', 'TEXT', '8', '1', '10', '1', '20', '1', '40', '1', '1', 'Piece Name: Quadrado',
      '0', 'ENDBLK',
      '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'INSERT', '8', '1', '2', 'SQ', '10', '5', '20', '0',
      '0', 'TEXT', '8', '1', '10', '0', '20', '0', '40', '1', '1', 'Units: ENGLISH',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n');
    const r = importDxf(dxf);
    expect(r.unit).toBe('in');
    const q = r.pieces[0]!;
    expect(q.name).toBe('Quadrado');
    const vs = vertices(q.outline);
    expect(vs).toHaveLength(4);
    const xs = vs.map((v) => v.x), ys = vs.map((v) => v.y);
    expect(Math.min(...xs)).toBeCloseTo(127, 6); // INSERT em x = 5 pol
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(254, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(254, 6);
  });

  it('DXF comum (sem blocos): cada contorno fechado vira molde; arco por bulge vira curva', () => {
    const dxf = [
      '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      // retângulo 300×200 com o lado de cima em arco (bulge)
      '0', 'LWPOLYLINE', '8', '0', '90', '4', '70', '1',
      '10', '0', '20', '0', '10', '300', '20', '0', '10', '300', '20', '200', '42', '0.3', '10', '0', '20', '200',
      // segundo molde
      '0', 'LWPOLYLINE', '8', '0', '90', '3', '70', '1',
      '10', '500', '20', '0', '10', '700', '20', '0', '10', '600', '20', '150',
      // linha interna dentro do primeiro
      '0', 'LINE', '8', '8', '10', '50', '20', '50', '11', '250', '21', '50',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n');
    const r = importDxf(dxf);
    expect(r.unitSource).toBe('$INSUNITS');
    expect(r.pieces).toHaveLength(2);
    const a = r.pieces.find((p) => vertices(p.outline).length === 4)!;
    expect(a.outline.segments.some((s) => s.kind === 'cubic')).toBe(true);
    expect(a.internals).toHaveLength(1);
    const b = r.pieces.find((p) => p !== a)!;
    expect(vertices(b.outline)).toHaveLength(3);
  });
});
