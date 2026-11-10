/**
 * Gera o PDF 1:1 e o PLT de cada base do catálogo em ./out/bases/.
 * Rodar: npm run bases
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { addPiece, bboxOfPoints, cutLine, emptyJob, exportHpgl, exportPdf, newDocument, serializeDocument } from '@cad-textil/core';
import { CATALOGO } from '../src/index.js';

const dir = 'out/bases';
mkdirSync(dir, { recursive: true });
const resumo: string[] = [];
for (const e of CATALOGO) {
  const base = e.gerar();
  const job = emptyJob();
  let x = 0;
  for (const p of base.pecas) {
    const bb = bboxOfPoints(cutLine(p));
    addPiece(job, p, { placement: { x: x - bb.minX, y: -bb.minY, rotationDeg: 0, mirror: false } });
    x += bb.maxX - bb.minX + 30;
  }
  const nome = `${e.genero}-${e.nome}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
  writeFileSync(`${dir}/${nome}.pdf`, exportPdf(job, { title: `${base.nome} ${base.tamanho}` }));
  writeFileSync(`${dir}/${nome}.plt`, exportHpgl(job));
  const doc = newDocument(`${base.nome} ${base.tamanho}`);
  doc.pieces = base.pecas;
  writeFileSync(`${dir}/${nome}.ctx`, serializeDocument(doc));
  resumo.push(`${base.nome} (${base.tamanho}): ${base.pecas.length} moldes — ${base.conferencias.join(' | ')}`);
}
console.log(resumo.join('\n'));
