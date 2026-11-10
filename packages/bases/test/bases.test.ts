import { describe, expect, it } from 'vitest';
import { bboxOfPoints, cutLine, flattenPath, pathLength, pieceForSize, signedArea, vertices, edgeSeam, edgeCount } from '@cad-textil/core';
import { CATALOGO, FEMININO_M, GRADE, MASCULINO_M, calca, camisa, corpoBase, mangaBase, medidasDoTamanho, paleto, saiaReta, tshirt } from '../src/index.js';
import { armholeLength, torso } from '../src/torso.js';

/** Extrai o primeiro número "x,y" de um texto. */
const nums = (s: string) => [...s.matchAll(/(\d+,\d)/g)].map((m) => Number(m[1]!.replace(',', '.')));

/** Verifica se um polígono tem auto-interseção (segmentos não adjacentes que se cruzam). */
function selfIntersects(pts: { x: number; y: number }[]): boolean {
  const n = pts.length;
  const cross = (o: any, a: any, b: any) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = pts[j]!, d = pts[(j + 1) % n]!;
      const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
      if (((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))) return true;
    }
  }
  return false;
}

describe('catálogo de bases (tamanho M)', () => {
  for (const e of CATALOGO) {
    it(`${e.genero} · ${e.nome}: moldes válidos e ficha completa`, () => {
      const b = e.gerar();
      expect(b.pecas.length).toBeGreaterThan(0);
      expect(b.descricao.length).toBeGreaterThan(20);
      expect(b.tecido.length).toBeGreaterThan(3);
      expect(b.margens.length).toBeGreaterThan(0);
      const ids = new Set<string>();
      for (const p of b.pecas) {
        expect(ids.has(p.id), `id repetido ${p.id}`).toBe(false);
        ids.add(p.id);
        const sew = flattenPath(p.outline);
        expect(Math.abs(signedArea(sew)), `${p.name} sem área`).toBeGreaterThan(1000);
        expect(selfIntersects(sew), `${p.name}: contorno se cruza`).toBe(false);
        const cut = cutLine(p);
        expect(Math.abs(signedArea(cut))).toBeGreaterThan(Math.abs(signedArea(sew)));
        expect(p.grainline).toBeDefined();
        expect(p.notes && p.notes.length > 5).toBe(true);
        expect(p.group).toBeTruthy();
        // Piques válidos (aresta existe, t em [0,1])
        for (const n of p.notches) {
          expect(n.edge).toBeLessThan(edgeCount(p.outline));
          expect(n.t).toBeGreaterThanOrEqual(0);
          expect(n.t).toBeLessThanOrEqual(1);
        }
        // Tamanho plausível de molde (entre 2 cm e 1,3 m)
        const bb = bboxOfPoints(sew);
        expect(Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY)).toBeLessThan(1300);
        expect(Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY)).toBeGreaterThan(20);
      }
    });
  }
});

describe('conferências de modelagem', () => {
  it('manga base: cabeça = cava + embebimento (fem 2 cm, masc 1,5 cm)', () => {
    for (const [m, ease] of [[FEMININO_M, 2], [MASCULINO_M, 1.5]] as const) {
      const t = torso(m, { folga: m.genero === 'feminino' ? 10 : 12 });
      const A = armholeLength(t.U, t.backArm) + armholeLength(t.U, t.frontArm);
      const b = mangaBase(m);
      const conf = b.conferencias.find((c) => c.startsWith('Cabeça'))!;
      expect(nums(conf)[0]).toBeCloseTo(A + ease, 1);
      // Largura da manga com folga sobre o bíceps
      const W = nums(b.folgas[1]!)[0]!;
      expect(W).toBeGreaterThan(m.braco + 2);
      expect(W).toBeLessThan(m.braco + 12);
    }
  });

  it('corpo base: laterais de costas e frente com o mesmo comprimento (pence descontada)', () => {
    for (const m of [FEMININO_M, MASCULINO_M]) {
      const [a, b] = nums(corpoBase(m).conferencias[0]!);
      expect(a).toBeCloseTo(b!, 1);
    }
  });

  it('calça: entreperna das costas 0,5 cm menor e laterais iguais', () => {
    for (const m of [FEMININO_M, MASCULINO_M]) {
      const b = calca(m);
      const [entre, lateral] = b.conferencias;
      const [ef, ec] = nums(entre!);
      expect(ef! - ec!).toBeCloseTo(0.5, 1);
      const [lf, lc] = nums(lateral!);
      expect(Math.abs(lf! - lc!)).toBeLessThan(0.05);
    }
  });

  it('calça: cintura e quadril acabados batem com a tabela + folga', () => {
    for (const m of [FEMININO_M, MASCULINO_M]) {
      const b = calca(m);
      const cintura = nums(b.conferencias[2]!)[0]!;
      const quadril = nums(b.conferencias[3]!)[0]!;
      expect(cintura).toBeCloseTo(m.cintura + 2, 0);
      expect(quadril).toBeCloseTo(m.quadril + 4, 0);
    }
  });

  it('saia reta: cintura acabada ≈ cintura + 2 cm e quadril + 4 cm', () => {
    const b = saiaReta(FEMININO_M);
    expect(nums(b.conferencias[0]!)[0]!).toBeGreaterThan(FEMININO_M.cintura);
    expect(nums(b.conferencias[0]!)[0]!).toBeLessThan(FEMININO_M.cintura + 4);
    expect(nums(b.conferencias[1]!)[0]!).toBeCloseTo(FEMININO_M.quadril + 4, 1);
  });

  it('paletó: costuras da manga de 2 partes iguais e cabeça ≈ cava + embebimento', () => {
    for (const m of [FEMININO_M, MASCULINO_M]) {
      const b = paleto(m);
      const [cava, frente, tras] = b.conferencias;
      const [A, cap] = nums(cava!);
      expect(cap! - A!).toBeGreaterThan(1);
      expect(cap! - A!).toBeLessThan(4.5);
      const [f1, f2] = nums(frente!);
      expect(f1).toBeCloseTo(f2!, 1);
      const [t1, t2] = nums(tras!);
      expect(t1).toBeCloseTo(t2!, 1);
    }
  });

  it('paletó: costuras costas↔lateral e lateral↔frente têm o mesmo comprimento', () => {
    for (const m of [FEMININO_M, MASCULINO_M]) {
      const conf = paleto(m).conferencias;
      for (const c of conf.filter((x) => x.startsWith('Costura costas') || x.startsWith('Costura lateral'))) {
        const [a, b] = nums(c);
        expect(a).toBeCloseTo(b!, 1);
      }
      expect(conf.filter((x) => x.startsWith('Costura costas') || x.startsWith('Costura lateral'))).toHaveLength(2);
    }
  });

  it('camisa: margem de barra diferente da costura (margem por borda)', () => {
    const b = camisa(MASCULINO_M);
    const costas = b.pecas.find((p) => p.id === 'costas')!;
    const seams = Array.from({ length: edgeCount(costas.outline) }, (_, i) => edgeSeam(costas, i));
    expect(seams).toContain(0); // dobra do centro costas
    expect(seams).toContain(10);
  });

  it('t-shirt: margens de malha (0,7 cm) e barra 2,5 cm', () => {
    const b = tshirt(FEMININO_M);
    const frente = b.pecas.find((p) => p.id === 'frente')!;
    const seams = new Set(Array.from({ length: edgeCount(frente.outline) }, (_, i) => edgeSeam(frente, i)));
    expect(seams.has(7)).toBe(true);
    expect(seams.has(25)).toBe(true);
    expect(seams.has(0)).toBe(true);
  });

  it('todas as bases geram vértices editáveis', () => {
    for (const e of CATALOGO) for (const p of e.gerar().pecas) expect(vertices(p.outline).length).toBeGreaterThanOrEqual(3);
  });
});

describe('bases graduadas (PP–GG)', () => {
  for (const e of CATALOGO) {
    it(`${e.genero} · ${e.nome}: todos os moldes graduados e cada tamanho igual à construção pela tabela`, () => {
      const g = e.gerarGraduada();
      const gen = e.genero;
      for (const p of g.pecas) {
        expect(p.grading, `${p.name} sem grade`).toBeDefined();
        expect(p.grading!.sizes).toEqual(GRADE[gen].nomes);
      }
      // Confere 2 tamanhos extremos contra a construção direta (a menos do ponto fixo = início do fio)
      for (const idx of [0, GRADE[gen].nomes.length - 1]) {
        const direct = e.gerar(medidasDoTamanho(gen, idx));
        for (const p of g.pecas) {
          const d = direct.pecas.find((q) => q.id === p.id)!;
          const sized = pieceForSize(p, idx);
          // ponto fixo = início do fio do molde base
          const shift = { x: d.grainline![0].x - p.grainline![0].x, y: d.grainline![0].y - p.grainline![0].y };
          vertices(sized.outline).forEach((q, i) => {
            const t = vertices(d.outline)[i]!;
            expect(Math.abs(q.x + shift.x - t.x) + Math.abs(q.y + shift.y - t.y), `${p.name} ponto ${i}`).toBeLessThan(1e-6);
          });
        }
      }
    });
  }

  it('áreas crescem do menor para o maior tamanho', () => {
    const g = CATALOGO.find((e) => e.genero === 'feminino' && e.nome === 'Calça')!.gerarGraduada();
    const front = g.pecas.find((p) => p.id === 'frente')!;
    const areas = front.grading!.sizes.map((_, i) => Math.abs(signedArea(flattenPath(pieceForSize(front, i).outline))));
    for (let i = 1; i < areas.length; i++) expect(areas[i]).toBeGreaterThan(areas[i - 1]!);
  });
});

describe('encaixe de bases graduadas reais', () => {
  it('calça PP–GG: todos os moldes no risco, sem sobreposição, aproveitamento > 72%', async () => {
    const { autoNest, markerItems, markerStats, overlapping } = await import('@cad-textil/core');
    const fab = { widthMm: 1500, edgeMarginMm: 10, gapMm: 2, rotation: '180' as const, faceToFace: false, resolutionMm: 3 };
    const base = CATALOGO.find((e) => e.genero === 'feminino' && e.nome === 'Calça')!.gerarGraduada();
    const items = markerItems(base.pecas, { PP: 1, P: 1, M: 1, G: 1, GG: 1 }, fab);
    const best = autoNest(items, fab, 5, 3);
    expect(best.unplaced).toHaveLength(0);
    expect(overlapping(items, best.placements, fab).size).toBe(0);
    expect(markerStats(items, best.placements, fab).efficiency).toBeGreaterThan(0.72);
  }, 60000);
});
