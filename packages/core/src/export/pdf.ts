import { PT_PER_MM } from '../units.js';
import { type PlotJob, jobBBox } from '../plot.js';

/**
 * Exportador PDF vetorial em escala 1:1, sem dependências externas.
 *
 * - 1 mm = 72/25,4 pt. Coordenadas gravadas com 4 casas em pt (erro < 0,00002 mm).
 * - /ViewerPreferences /PrintScaling /None: o leitor NÃO aplica "ajustar à página".
 * - Página única do tamanho do trabalho + margem (limite do PDF: 5080 mm por lado).
 *   Para impressora comum, use exportPdfTiled (folhas A4/A3 com marcas de registro).
 */
export interface PdfOptions {
  marginMm?: number;
  title?: string;
}

/** Limite de tamanho de página da especificação PDF: 14400 pt = 5080 mm. */
export const PDF_MAX_PAGE_MM = 14400 / PT_PER_MM;

const PEN_WIDTH_MM: Record<1 | 2 | 3, number> = { 1: 0.35, 2: 0.2, 3: 0.2 };

const num = (n: number): string => {
  const s = n.toFixed(4);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
};

/** String literal PDF em WinAnsi (latin-1 cobre os acentos do português). */
function pdfString(text: string): string {
  let out = '(';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (code < 32 || code > 255) out += '?';
    else if (code > 126) out += '\\' + code.toString(8).padStart(3, '0');
    else out += ch;
  }
  return out + ')';
}

function toBytes(s: string): Uint8Array {
  // Conteúdo é 100% ASCII (acentos já escapados em octal), então 1 char = 1 byte.
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

export function exportPdf(job: PlotJob, opts: PdfOptions = {}): Uint8Array {
  const margin = opts.marginMm ?? 10;
  const bb = jobBBox(job);
  const widthMm = bb.maxX - bb.minX + 2 * margin;
  const heightMm = bb.maxY - bb.minY + 2 * margin;
  if (widthMm > PDF_MAX_PAGE_MM || heightMm > PDF_MAX_PAGE_MM) {
    throw new Error(
      `Trabalho de ${widthMm.toFixed(0)} x ${heightMm.toFixed(0)} mm excede o limite de página PDF ` +
        `(${PDF_MAX_PAGE_MM.toFixed(0)} mm). Use o arquivo PLT ou a divisão em folhas.`,
    );
  }
  const ox = margin - bb.minX;
  const oy = margin - bb.minY;
  const X = (mm: number) => num((mm + ox) * PT_PER_MM);
  const Y = (mm: number) => num((mm + oy) * PT_PER_MM);

  const c: string[] = ['1 J 1 j']; // pontas e juntas arredondadas
  for (const pen of [2, 1] as const) {
    const strokes = job.strokes.filter((s) => s.pen === pen);
    if (strokes.length === 0) continue;
    c.push(`${num(PEN_WIDTH_MM[pen] * PT_PER_MM)} w`);
    for (const s of strokes) {
      if (s.points.length < 2) continue;
      const [first, ...rest] = s.points;
      c.push(`${X(first!.x)} ${Y(first!.y)} m`);
      for (const p of rest) c.push(`${X(p.x)} ${Y(p.y)} l`);
      c.push(s.closed ? 'h S' : 'S');
    }
  }
  for (const l of job.labels) {
    const size = l.heightMm * PT_PER_MM * 1.4; // altura de maiúscula ≈ 0,72 do corpo
    const approxWidthMm = l.text.length * l.heightMm * 0.75;
    c.push(`BT /F1 ${num(size)} Tf ${X(l.at.x - approxWidthMm / 2)} ${Y(l.at.y - l.heightMm / 2)} Td ${pdfString(l.text)} Tj ET`);
  }
  const content = c.join('\n');

  const W = num(widthMm * PT_PER_MM);
  const H = num(heightMm * PT_PER_MM);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Title ${pdfString(opts.title ?? 'Molde')} /Producer (Andromeda Moldes) >>`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return toBytes(pdf);
}

/* ------------------------------------------------------------------ */
/* PDF em folhas (A4/A3) para impressora comum                         */
/* ------------------------------------------------------------------ */

export const PAPERS = { A4: [210, 297], A3: [297, 420] } as const;

export interface TiledPdfOptions {
  paper: keyof typeof PAPERS;
  orientation?: 'retrato' | 'paisagem';
  /** Margem que a impressora não imprime (mm). */
  printerMarginMm?: number;
  title?: string;
}

/** Operações de desenho do trabalho em pt, com origem no canto mínimo do trabalho. */
function drawingOps(job: PlotJob): { ops: string; wMm: number; hMm: number } {
  const bb = jobBBox(job);
  const X = (mm: number) => num((mm - bb.minX) * PT_PER_MM);
  const Y = (mm: number) => num((mm - bb.minY) * PT_PER_MM);
  const c: string[] = ['1 J 1 j'];
  for (const pen of [2, 1] as const) {
    const strokes = job.strokes.filter((s) => s.pen === pen);
    if (!strokes.length) continue;
    c.push(`${num(PEN_WIDTH_MM[pen] * PT_PER_MM)} w`);
    for (const s of strokes) {
      if (s.points.length < 2) continue;
      const [first, ...rest] = s.points;
      c.push(`${X(first!.x)} ${Y(first!.y)} m`);
      for (const p of rest) c.push(`${X(p.x)} ${Y(p.y)} l`);
      c.push(s.closed ? 'h S' : 'S');
    }
  }
  for (const l of job.labels) {
    const size = l.heightMm * PT_PER_MM * 1.4;
    const approxWidthMm = l.text.length * l.heightMm * 0.75;
    c.push(`BT /F1 ${num(size)} Tf ${X(l.at.x - approxWidthMm / 2)} ${Y(l.at.y - l.heightMm / 2)} Td ${pdfString(l.text)} Tj ET`);
  }
  return { ops: c.join('\n'), wMm: bb.maxX - bb.minX, hMm: bb.maxY - bb.minY };
}

const rowName = (i: number) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : '');

/** Divide o trabalho em folhas: retorna a grade de folhas (para conferência e testes). */
export function tileGrid(job: PlotJob, opts: TiledPdfOptions) {
  const [pw0, ph0] = PAPERS[opts.paper];
  const [pw, ph] = opts.orientation === 'paisagem' ? [ph0, pw0] : [pw0, ph0];
  const m = opts.printerMarginMm ?? 10;
  const iw = pw - 2 * m, ih = ph - 2 * m;
  const { wMm, hMm } = drawingOps(job);
  const cols = Math.max(1, Math.ceil(wMm / iw - 1e-9));
  const rows = Math.max(1, Math.ceil(hMm / ih - 1e-9));
  return { pw, ph, m, iw, ih, cols, rows, wMm, hMm };
}

/**
 * PDF em várias folhas A4/A3 em escala 1:1. Folha 1 = instruções (quadrado de 10 cm para conferir
 * a escala + mapa de montagem). Cada folha tem moldura de corte, cruzes de registro nos cantos e o
 * nome (linha letra, coluna número). Cortar na moldura e emendar lado a lado.
 */
export function exportPdfTiled(job: PlotJob, opts: TiledPdfOptions): Uint8Array {
  const g = tileGrid(job, opts);
  const { ops } = drawingOps(job);
  const P = (mm: number) => num(mm * PT_PER_MM);
  const objs: string[] = [];
  const add = (body: string) => {
    objs.push(body);
    return objs.length; // número do objeto
  };
  const catalog = add('');
  const pages = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const form = add(
    `<< /Type /XObject /Subtype /Form /BBox [0 0 ${P(g.wMm)} ${P(g.hMm)}] /Resources << /Font << /F1 ${font} 0 R >> >> /Length ${ops.length} >>\nstream\n${ops}\nendstream`,
  );
  const kids: number[] = [];
  const page = (content: string) => {
    const cs = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${P(g.pw)} ${P(g.ph)}] /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Fm0 ${form} 0 R >> >> /Contents ${cs} 0 R >>`));
  };
  const text = (xMm: number, yMm: number, sizePt: number, t: string) => `BT /F1 ${sizePt} Tf ${P(xMm)} ${P(yMm)} Td ${pdfString(t)} Tj ET`;

  // Folha de instruções
  {
    const c: string[] = ['0 G 0.5 w'];
    const top = g.ph - g.m - 8;
    c.push(text(g.m, top, 16, opts.title ?? 'Molde'));
    c.push(text(g.m, top - 8, 10, `Imprima em TAMANHO REAL (100%, sem "ajustar à página"). ${g.cols * g.rows} folha(s) ${opts.paper}.`));
    c.push(text(g.m, top - 13, 10, 'Confira: o quadrado abaixo deve medir exatamente 10 x 10 cm com régua.'));
    c.push(`${P(g.m)} ${P(top - 120)} ${P(100)} ${P(100)} re S`);
    c.push(text(g.m + 30, top - 72, 12, '10 x 10 cm'));
    // mapa de montagem
    const mapY = top - 135;
    c.push(text(g.m, mapY, 10, 'Montagem (cortar na moldura de cada folha e emendar):'));
    const cell = Math.min(18, (g.pw - 2 * g.m) / g.cols, 120 / g.rows);
    for (let r = 0; r < g.rows; r++) {
      for (let col = 0; col < g.cols; col++) {
        const x = g.m + col * cell, y = mapY - 6 - (r + 1) * cell;
        c.push(`${P(x)} ${P(y)} ${P(cell)} ${P(cell)} re S`);
        c.push(text(x + 1.5, y + cell / 2 - 1.2, Math.max(5, Math.min(9, cell * 1.6)), `${rowName(r)}${col + 1}`));
      }
    }
    page(c.join('\n'));
  }

  // Folhas do desenho (linha A = topo do desenho)
  for (let r = 0; r < g.rows; r++) {
    for (let col = 0; col < g.cols; col++) {
      const x0 = col * g.iw; // recorte do desenho (mm, origem embaixo-esquerda)
      const y0 = g.hMm - (r + 1) * g.ih;
      const c: string[] = [];
      c.push('q', `${P(g.m)} ${P(g.m)} ${P(g.iw)} ${P(g.ih)} re W n`, `1 0 0 1 ${P(g.m - x0)} ${P(g.m - y0)} cm`, '/Fm0 Do', 'Q');
      // moldura de corte (tracejada) + cruzes de registro
      c.push('0 G 0.4 w [3 2] 0 d', `${P(g.m)} ${P(g.m)} ${P(g.iw)} ${P(g.ih)} re S`, '[] 0 d 0.6 w');
      for (const [cx, cy] of [[g.m, g.m], [g.m + g.iw, g.m], [g.m, g.m + g.ih], [g.m + g.iw, g.m + g.ih]] as const) {
        c.push(`${P(cx - 5)} ${P(cy)} m ${P(cx + 5)} ${P(cy)} l S`, `${P(cx)} ${P(cy - 5)} m ${P(cx)} ${P(cy + 5)} l S`);
      }
      c.push(text(g.m + 2, g.m - 6, 8, `${rowName(r)}${col + 1}  ·  linha ${rowName(r)}, coluna ${col + 1} de ${g.cols}  ·  ${opts.title ?? ''}`));
      page(c.join('\n'));
    }
  }

  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R /ViewerPreferences << /PrintScaling /None >> >>`;
  objs[pages - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title ${pdfString(opts.title ?? 'Molde')} /Producer (Andromeda Moldes) >>`);
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return toBytes(pdf);
}
