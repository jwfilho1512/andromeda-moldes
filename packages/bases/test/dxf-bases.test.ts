import { describe, expect, it } from 'vitest';
import { allSizes, cutLine, decodeDxf, encodeDxf, exportDxfAama, importDxf, newDocument, polygonDeviation, vertices } from '@cad-textil/core';
import { CATALOGO } from '../src/index.js';

/** Todas as bases graduadas: exportar DXF-AAMA e reimportar sem perder precisão nem a grade. */
describe('DXF-AAMA com as bases do catálogo', () => {
  for (const e of CATALOGO) {
    it(`${e.nome} ${e.genero}: ida e volta < 0,3 mm em todos os tamanhos`, () => {
      const base = e.gerarGraduada();
      const doc = { ...newDocument(e.nome), pieces: base.pecas };
      const r = importDxf(decodeDxf(encodeDxf(exportDxfAama(doc))));
      expect(r.warnings).toEqual([]);
      expect(r.pieces).toHaveLength(base.pecas.length);
      let worst = 0;
      for (const p of base.pecas) {
        const q = r.pieces.find((x) => x.name === p.name)!;
        expect(q, p.name).toBeDefined();
        expect(vertices(q.outline).length, p.name).toBe(vertices(p.outline).length);
        expect(q.notches.length, p.name).toBe(p.notches.length);
        const a = allSizes(p), b = allSizes(q);
        expect(b.map((s) => s.size)).toEqual(a.map((s) => s.size));
        a.forEach((s, i) => (worst = Math.max(worst, polygonDeviation(cutLine(b[i]!.piece), cutLine(s.piece)))));
      }
      expect(worst).toBeLessThan(0.3);
    });
  }
});
