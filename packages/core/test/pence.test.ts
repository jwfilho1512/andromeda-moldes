import { describe, expect, it } from 'vitest';
import { type Vec2, addInnerDart, createDart, dartApexAt, dartMouth, openDart, flattenPath, signedArea, createPiece, cutLine, dartGeometry, rect, reversePiece, sewLine, transferDart, v, vertices } from '../src/index.js';

/** Molde 400×600 anti-horário: aresta 2 = cintura (topo, y = 600), de (400,600) para (0,600). */
const block = (seam = 0) => ({ ...createPiece('b', 'Bloco', rect(0, 0, 400, 600)), seamAllowanceMm: seam });
const apex = v(200, 450);
const inPoly = (p: Vec2, poly: Vec2[]) => {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
};
// bico esperado: a cintura dobrada sobre a perna sobe 15·tan(2α), α = atan(15/150)
const capH = 15 * Math.tan(2 * Math.atan(15 / 150));

describe('pence com bico', () => {
  it('a costura ganha o bico no meio da pence, para fora', () => {
    const p = createDart(block(), { edge: 2, t: 0.5 }, apex, 30, { kind: 'bico' });
    const sew = sewLine(p);
    const cap = sew.find((q) => Math.abs(q.x - 200) < 1e-6 && q.y > 600);
    expect(cap).toBeDefined();
    expect(cap!.y - 600).toBeCloseTo(capH, 6);
    // o contorno guardado não muda: só a linha calculada
    expect(vertices(p.outline)).toHaveLength(6);
  });

  it('deitando para o outro lado, o bico é o mesmo numa cintura reta', () => {
    const p = createDart(block(), { edge: 2, t: 0.5 }, apex, 30, { kind: 'bico', side: 1 });
    const cap = sewLine(p).find((q) => Math.abs(q.x - 200) < 1e-6 && q.y > 600);
    expect(cap!.y - 600).toBeCloseTo(capH, 6);
  });

  it('a linha de corte acompanha o bico', () => {
    const p = createDart(block(10), { edge: 2, t: 0.5 }, apex, 30, { kind: 'bico' });
    const top = Math.max(...cutLine(p).filter((q) => Math.abs(q.x - 200) < 1).map((q) => q.y));
    expect(top).toBeGreaterThan(610 + capH - 0.5);
  });

  it('pence só marcada continua com o contorno reto', () => {
    const p = createDart(block(), { edge: 2, t: 0.5 }, apex, 30);
    expect(Math.max(...sewLine(p).map((q) => q.y))).toBeCloseTo(600, 9);
    expect(p.darts![0]!.kind).toBeUndefined();
  });
});

describe('pence recortada', () => {
  it('sem margem: o corte entra até o ápice', () => {
    const p = createDart(block(), { edge: 2, t: 0.5 }, apex, 30, { kind: 'recortada' });
    const cut = cutLine(p);
    expect(cut.some((q) => Math.abs(q.x - 200) < 1e-6 && Math.abs(q.y - 450) < 1e-6)).toBe(true);
    expect(inPoly(v(200, 590), cut)).toBe(false);
    expect(inPoly(v(150, 590), cut)).toBe(true);
  });

  it('com margem: o recorte para antes do ápice, deixando a margem nas pernas', () => {
    const p = createDart(block(10), { edge: 2, t: 0.5 }, apex, 30, { kind: 'recortada' });
    const cut = cutLine(p);
    const sinH = 15 / Math.hypot(15, 150);
    const tip = cut.find((q) => Math.abs(q.x - 200) < 1e-6 && q.y < 600);
    expect(tip!.y).toBeCloseTo(450 + 10 / sinH, 6);
    expect(inPoly(v(200, 590), cut)).toBe(false);
    // a costura passa pelo ápice
    expect(sewLine(p).some((q) => Math.abs(q.x - 200) < 1e-6 && Math.abs(q.y - 450) < 1e-6)).toBe(true);
  });

  it('pence estreita demais para a margem: o corte fica inteiro', () => {
    const p = createDart(block(10), { edge: 2, t: 0.5 }, apex, 4, { kind: 'recortada' });
    expect(inPoly(v(200, 605), cutLine(p))).toBe(true);
  });
});

describe('pence acompanha o molde', () => {
  it('arrastar o ápice muda o bico', () => {
    const p = createDart(block(), { edge: 2, t: 0.5 }, apex, 30, { kind: 'bico' });
    const longer = { ...p, darts: [{ ...p.darts![0]!, apex: v(200, 300) }] };
    const capOf = (q: typeof p) => sewLine(q).find((r) => Math.abs(r.x - 200) < 1e-6 && r.y > 600)!.y - 600;
    expect(capOf(longer)).toBeLessThan(capOf(p));
  });

  it('transferir e inverter o molde levam o tipo e o lado da pence', () => {
    const p = createDart(block(), { edge: 2, t: 0.5 }, apex, 30, { kind: 'recortada', side: 1 });
    const side = p.outline.segments.findIndex((_, i) => {
      const vs = vertices(p.outline);
      return vs[i]!.x === 0 && vs[(i + 1) % vs.length]!.x === 0;
    });
    const t = transferDart(p, 0, { edge: side, t: 0.5 });
    expect(t.darts![0]!.kind).toBe('recortada');
    expect(t.darts![0]!.side).toBe(1);
    const r = reversePiece(p);
    expect(r.darts![0]!.side).toBe(-1);
    expect(dartGeometry(r, r.darts![0]!).width).toBeCloseTo(30, 6);
  });
});

describe('boca da pence para um lado', () => {
  it('o ponto clicado vira uma perna e a abertura vai para o lado escolhido', () => {
    // cintura vai de x=400 para x=0: 'fim' = para x menor, 'inicio' = para x maior
    const fim = dartMouth(block(), { edge: 2, t: 0.5 }, 30, 'fim');
    expect(fim.legA.x).toBeCloseTo(200, 6);
    expect(fim.legB.x).toBeCloseTo(170, 6);
    const ini = dartMouth(block(), { edge: 2, t: 0.5 }, 30, 'inicio');
    expect(ini.legA.x).toBeCloseTo(230, 6);
    expect(ini.legB.x).toBeCloseTo(200, 6);
    const p = createDart(block(), { edge: 2, t: 0.5 }, v(185, 450), 30, { align: 'fim' });
    const g = dartGeometry(p, p.darts![0]!);
    expect(g.legA.x).toBeCloseTo(200, 6);
    expect(g.width).toBeCloseTo(30, 6);
  });

  it('perto do canto, abrir para o lado de dentro funciona e para fora avisa', () => {
    expect(() => createDart(block(), { edge: 2, t: 0.99 }, v(10, 450), 30, { align: 'fim' })).toThrow(/ultrapassa/);
    expect(createDart(block(), { edge: 2, t: 0.99 }, v(10, 450), 30, { align: 'inicio' }).darts).toHaveLength(1);
  });
});

describe('pence como no Audaces', () => {
  it('ápice perpendicular na profundidade digitada', () => {
    const a = dartApexAt(block(), { edge: 2, t: 0.5 }, 30, 'centro', 150);
    expect(a.x).toBeCloseTo(200, 6);
    expect(a.y).toBeCloseTo(450, 6);
    // aberta para um lado: o ápice fica no meio da boca
    const b = dartApexAt(block(), { edge: 2, t: 0.5 }, 30, 'fim', 150);
    expect(b.x).toBeCloseTo(185, 6);
    // apontando para um ponto, com a profundidade digitada
    const c = dartApexAt(block(), { edge: 2, t: 0.5 }, 30, 'centro', 100, v(300, 500));
    expect(Math.hypot(c.x - 200, c.y - 600)).toBeCloseTo(100, 6);
  });

  it('abrir pence: gira um lado pelo pivô e acrescenta a abertura sem perder a borda', () => {
    const p = openDart(block(), { edge: 2, t: 0.5 }, v(200, 450), 30, 'fim', { kind: 'bico' });
    expect(p.darts).toHaveLength(1);
    const d = p.darts![0]!;
    expect(d.kind).toBe('bico');
    const g = dartGeometry(p, d);
    expect(g.width).toBeCloseTo(30, 6);
    expect(Math.hypot(g.legA.x - 200, g.legA.y - 450)).toBeCloseTo(150, 6);
    expect(Math.hypot(g.legB.x - 200, g.legB.y - 450)).toBeCloseTo(150, 6);
    // a cintura (fora a boca) continua com 400 mm
    const vs = vertices(p.outline);
    const n = vs.length;
    const top = [(d.edge - 1 + n) % n, (d.edge + 1) % n].map((e) => Math.hypot(vs[(e + 1) % n]!.x - vs[e]!.x, vs[(e + 1) % n]!.y - vs[e]!.y));
    expect(top[0]! + top[1]!).toBeCloseTo(400, 3);
    // a quebra embaixo foi acertada: sem vértice sobrando e o contorno continua no mesmo sentido
    expect(n).toBe(7);
    expect(Math.sign(signedArea(flattenPath(p.outline)))).toBe(Math.sign(signedArea(flattenPath(block().outline))));
  });

  it('abrir para o outro lado gira a outra metade', () => {
    const a = openDart(block(), { edge: 2, t: 0.5 }, v(200, 450), 30, 'fim');
    const b = openDart(block(), { edge: 2, t: 0.5 }, v(200, 450), 30, 'inicio');
    const minX = (q: typeof a) => Math.min(...vertices(q.outline).map((x) => x.x));
    const maxX = (q: typeof a) => Math.max(...vertices(q.outline).map((x) => x.x));
    expect(minX(a)).toBeLessThan(-1); // a metade esquerda girou para fora
    expect(maxX(b)).toBeGreaterThan(401); // a direita girou
  });

  it('pence interna: losango com linhas e furos', () => {
    const p = addInnerDart(block(), v(200, 300), { topMm: 140, bottomMm: 100, widthMm: 30, marks: 'ambos' });
    expect(p.internals).toHaveLength(1);
    expect(p.drills).toHaveLength(4);
    expect(p.drills![0]!.y).toBeCloseTo(440, 6);
    expect(p.drills![2]!.y).toBeCloseTo(200, 6);
    expect(() => addInnerDart(block(), v(200, 550), { topMm: 140, bottomMm: 100, widthMm: 30 })).toThrow(/borda/);
  });
});
