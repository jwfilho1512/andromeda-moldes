/**
 * ARQUIVO PARA A GRÁFICA DE SUBLIMAÇÃO: o enfesto/risco com as artes dentro de cada molde, em
 * escala 1:1 (mais a compensação de encolhimento do tecido), numa página única.
 *
 * - Rolo na vertical (padrão): a largura do arquivo é a largura do tecido e o comprimento do risco
 *   desce na página — como a gráfica imprime no rolo de papel.
 * - Espelhar: para papel transfer (a face impressa vai virada contra o tecido).
 * - Riscos maiores que 5,08 m (limite de página do PDF) usam /UserUnit (PDF 1.6): continua uma
 *   página só, em tamanho real; se o RIP da gráfica não aceitar, use o TIFF.
 * - Cada imagem entra uma vez e é desenhada recortada pela linha de corte + sangria.
 */
import { PT_PER_MM } from '../units.js';
import { type PlotJob, jobBBox } from '../plot.js';
import type { PrintInstance } from '../estampa.js';
import { shrinkFactor } from '../estampa.js';
import { PDF_MAX_PAGE_MM } from './pdf.js';

export interface PdfImage {
  id: string;
  width: number;
  height: number;
  /** DCTDecode = bytes do JPEG como estão; FlateDecode = pixels compactados (zlib). */
  filter: 'DCTDecode' | 'FlateDecode';
  colorSpace: 'DeviceRGB' | 'DeviceGray' | 'DeviceCMYK';
  data: Uint8Array;
  /** Transparência (cinza 8 bits, zlib), opcional. */
  alpha?: Uint8Array;
  /** JPEG CMYK do Photoshop (Adobe) vem invertido. */
  invertCmyk?: boolean;
}

export interface PrintPdfOptions {
  title?: string;
  /** Margem branca em volta (mm). */
  marginMm?: number;
  /** Encolhimento do tecido no comprimento do rolo (X do risco) e na largura (Y), em %. */
  shrinkXPct?: number;
  shrinkYPct?: number;
  /** Contornos (linha de corte) finos por cima das artes. Padrão: não. */
  outlines?: boolean;
  /** Espelhar o arquivo (papel transfer). */
  mirror?: boolean;
  /** Comprimento do risco na vertical do arquivo (padrão: sim). */
  rollVertical?: boolean;
}

/** Tamanho final do arquivo (mm) e a transformação risco → página (matriz PDF em mm). */
export function printLayout(job: PlotJob, opts: PrintPdfOptions = {}) {
  const m = opts.marginMm ?? 10;
  const kx = shrinkFactor(opts.shrinkXPct ?? 0), ky = shrinkFactor(opts.shrinkYPct ?? 0);
  const bb = jobBBox(job);
  const vertical = opts.rollVertical !== false;
  const lenMm = (bb.maxX - bb.minX) * kx, widMm = (bb.maxY - bb.minY) * ky;
  const wMm = (vertical ? widMm : lenMm) + 2 * m;
  const hMm = (vertical ? lenMm : widMm) + 2 * m;
  // [a b c d e f]: x' = a·X + c·Y + e ; y' = b·X + d·Y + f
  let t: [number, number, number, number, number, number] = vertical
    ? [0, kx, -ky, 0, ky * bb.maxY + m, m - kx * bb.minX]
    : [kx, 0, 0, ky, m - kx * bb.minX, m - ky * bb.minY];
  if (opts.mirror) t = [-t[0], t[1], -t[2], t[3], wMm - t[4], t[5]];
  return { wMm, hMm, t };
}

const num = (n: number): string => {
  const s = n.toFixed(4);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
};

function ascii(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

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

export function exportPdfPrint(job: PlotJob, prints: PrintInstance[], images: PdfImage[], opts: PrintPdfOptions = {}): Uint8Array {
  const { wMm, hMm, t } = printLayout(job, opts);
  // acima do limite do PDF: unidade de usuário maior (página continua em tamanho real)
  const big = Math.max(wMm, hMm);
  const unit = big > PDF_MAX_PAGE_MM ? Math.ceil((big / PDF_MAX_PAGE_MM) * 1000) / 1000 : 1;
  const k = PT_PER_MM / unit; // mm → unidades da página

  const objs: (Uint8Array | string)[] = [];
  const streams = new Map<number, Uint8Array>();
  const add = (dict: string, stream?: Uint8Array) => {
    objs.push(dict);
    if (stream) streams.set(objs.length, stream);
    return objs.length;
  };
  const catalog = add('');
  const pagesObj = add('');
  const imgRef = new Map<string, number>();
  for (const im of images) {
    if (!prints.some((p) => p.artId === im.id)) continue;
    let smask = '';
    if (im.alpha) {
      const sm = add(`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${im.alpha.length} >>`, im.alpha);
      smask = ` /SMask ${sm} 0 R`;
    }
    const decode = im.colorSpace === 'DeviceCMYK' && im.invertCmyk ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
    imgRef.set(
      im.id,
      add(`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /${im.colorSpace} /BitsPerComponent 8 /Filter /${im.filter}${decode}${smask} /Length ${im.data.length} >>`, im.data),
    );
  }
  const names = new Map([...imgRef.keys()].map((id, i) => [id, `Im${i}`]));
  const xobj = [...imgRef.entries()].map(([id, ref]) => `/${names.get(id)} ${ref} 0 R`).join(' ');

  const c: string[] = [];
  // fundo branco + transformação risco (mm) → página
  c.push('1 g', `0 0 ${num(wMm * k)} ${num(hMm * k)} re f`);
  c.push('q', `${t.map((v) => num(v * k)).join(' ')} cm`);
  // agrupa as imagens que dividem o mesmo recorte (módulos da corrida/textura): recorta uma vez só
  for (let i = 0; i < prints.length; ) {
    const clip = prints[i]!.clip;
    let e = i;
    while (e < prints.length && prints[e]!.clip === clip) e++;
    const group = prints.slice(i, e);
    i = e;
    if (clip.length < 3) continue;
    c.push('q', `${num(clip[0]!.x)} ${num(clip[0]!.y)} m`);
    for (const q of clip.slice(1)) c.push(`${num(q.x)} ${num(q.y)} l`);
    c.push('h W n');
    for (const p of group) {
      const name = names.get(p.artId);
      if (name) c.push(`q ${p.m.map(num).join(' ')} cm /${name} Do Q`);
    }
    c.push('Q');
  }
  if (opts.outlines) {
    c.push(`0.5 G ${num(0.2)} w 1 J 1 j`);
    for (const s of job.strokes) {
      if (s.pen !== 1 || s.points.length < 2) continue;
      const [f, ...rest] = s.points;
      c.push(`${num(f!.x)} ${num(f!.y)} m`, ...rest.map((q) => `${num(q.x)} ${num(q.y)} l`), s.closed ? 'h S' : 'S');
    }
  }
  c.push('Q');
  const content = ascii(c.join('\n'));
  const cs = add(`<< /Length ${content.length} >>`, content);
  const userUnit = unit !== 1 ? ` /UserUnit ${num(unit)}` : '';
  const kids = [add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(wMm * k)} ${num(hMm * k)}]${userUnit} /Resources << /XObject << ${xobj} >> >> /Contents ${cs} 0 R >>`)];
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R /ViewerPreferences << /PrintScaling /None >> >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title ${pdfString(opts.title ?? 'Risco sublimação')} /Producer (Andromeda Moldes) >>`);

  // montagem binária
  const parts: Uint8Array[] = [];
  let len = 0;
  const push = (b: Uint8Array) => {
    parts.push(b);
    len += b.length;
  };
  push(ascii('%PDF-1.6\n%\xe2\xe3\xcf\xd3\n'));
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(len);
    push(ascii(`${i + 1} 0 obj\n${body as string}\n`));
    const st = streams.get(i + 1);
    if (st) {
      push(ascii('stream\n'));
      push(st);
      push(ascii('\nendstream\n'));
    }
    push(ascii('endobj\n'));
  });
  const xref = len;
  let tail = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) tail += `${String(off).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  push(ascii(tail));
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
