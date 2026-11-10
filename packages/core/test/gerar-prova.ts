/**
 * Gera arquivos de prova de escala em ./out:
 *   prova-escala.plt  → enviar ao plotter
 *   prova-escala.pdf  → imprimir em "Tamanho real / 100%"
 *   prova-escala.ctx  → arquivo nativo
 * Depois de imprimir: o quadrado deve medir 100 × 100 mm e a régua 500 mm.
 *
 * Rodar: npm run prova
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { addPiece, addScaleCheck, emptyJob, exportHpgl, exportPdf, newDocument, rect, serializeDocument, v } from '../src/index.js';
import { sampleSkirtFront } from './sample.js';

const job = emptyJob();
const skirt = sampleSkirtFront();
addPiece(job, skirt, { placement: { x: 20, y: 20, rotationDeg: 0, mirror: false } });
addScaleCheck(job, v(340, 20), 100);
// Régua de 500 mm com marcas a cada 10 mm (marcas maiores a cada 50 mm)
job.strokes.push({ points: [v(340, 160), v(840, 160)], closed: false, pen: 1 });
for (let mm = 0; mm <= 500; mm += 10) {
  const h = mm % 50 === 0 ? 8 : 4;
  job.strokes.push({ points: [v(340 + mm, 160), v(340 + mm, 160 + h)], closed: false, pen: 1 });
}
job.labels.push({ at: v(590, 180), text: 'Régua 500 mm', heightMm: 5 });
job.strokes.push({ points: rect(340, 220, 500, 200).segments.map((s) => s.to).concat([v(340, 220)]), closed: true, pen: 2 });
job.labels.push({ at: v(590, 320), text: 'Retângulo 500 x 200 mm', heightMm: 5 });

mkdirSync('out', { recursive: true });
writeFileSync('out/prova-escala.plt', exportHpgl(job));
writeFileSync('out/prova-escala.pdf', exportPdf(job, { title: 'Prova de escala' }));
const doc = newDocument('Prova de escala');
doc.pieces.push(skirt);
writeFileSync('out/prova-escala.ctx', serializeDocument(doc));
console.log('Gerado: out/prova-escala.plt, out/prova-escala.pdf, out/prova-escala.ctx');
