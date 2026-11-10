/**
 * TIFF PARA A GRÁFICA DE SUBLIMAÇÃO: o risco com as artes, em pixels na resolução escolhida,
 * em tamanho real (com a resolução gravada no arquivo) e compactado (Deflate).
 *
 * É desenhado em faixas de linhas, então riscos de vários metros não estouram a memória.
 * Mesma montagem do PDF (printLayout): rolo na vertical, espelho opcional, compensação de encolhimento.
 */
import { type Artwork, type PlotJob, type PrintInstance, type PrintPdfOptions, printLayout } from '@cad-textil/core';

export interface TiffOptions extends PrintPdfOptions {
  dpi: number;
}

/** Tamanho do arquivo em pixels. */
export function tiffSize(job: PlotJob, opts: TiffOptions) {
  const { wMm, hMm } = printLayout(job, opts);
  const ppm = opts.dpi / 25.4;
  return { wMm, hMm, wPx: Math.max(1, Math.round(wMm * ppm)), hPx: Math.max(1, Math.round(hMm * ppm)) };
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function bitmaps(arts: Artwork[]): Promise<Map<string, ImageBitmap>> {
  const out = new Map<string, ImageBitmap>();
  for (const a of arts) {
    // decodifica o data URL direto (fetch de data: pode ser bloqueado pela política de segurança)
    const b64 = a.dataUrl.slice(a.dataUrl.indexOf(',') + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    out.set(a.id, await createImageBitmap(new Blob([bytes], { type: a.mime })));
  }
  return out;
}

export async function renderTiff(
  job: PlotJob,
  prints: PrintInstance[],
  arts: Artwork[],
  opts: TiffOptions,
  onProgress?: (frac: number) => void,
): Promise<Uint8Array> {
  const { hMm, t } = printLayout(job, opts);
  const { wPx, hPx } = tiffSize(job, opts);
  if (wPx > 32000) throw new Error(`Largura de ${wPx} px passa do limite — diminua a resolução (dpi)`);
  const ppm = opts.dpi / 25.4;
  const used = new Set(prints.map((p) => p.artId));
  const imgs = await bitmaps(arts.filter((a) => used.has(a.id)));

  // grupos que dividem o recorte, com a faixa de linhas (pixels) que ocupam
  const groups: { clip: PrintInstance['clip']; items: PrintInstance[]; y0: number; y1: number }[] = [];
  for (let i = 0; i < prints.length; ) {
    const clip = prints[i]!.clip;
    let e = i;
    while (e < prints.length && prints[e]!.clip === clip) e++;
    let lo = Infinity, hi = -Infinity;
    for (const q of clip) {
      const y = t[1] * q.x + t[3] * q.y + t[5];
      const row = (hMm - y) * ppm;
      lo = Math.min(lo, row);
      hi = Math.max(hi, row);
    }
    groups.push({ clip, items: prints.slice(i, e), y0: lo - 2, y1: hi + 2 });
    i = e;
  }

  const rows = Math.max(16, Math.min(hPx, Math.floor(12e6 / wPx)));
  const cv = new OffscreenCanvas(wPx, rows);
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  const strips: Uint8Array[] = [];
  for (let r0 = 0; r0 < hPx; r0 += rows) {
    const n = Math.min(rows, hPx - r0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, wPx, rows);
    // página (mm, Y para cima) → pixels da faixa; depois risco (mm) → página
    g.setTransform(ppm, 0, 0, -ppm, 0, hMm * ppm - r0);
    g.transform(t[0], t[1], t[2], t[3], t[4], t[5]);
    for (const gr of groups) {
      if (gr.y1 < r0 || gr.y0 > r0 + n) continue;
      g.save();
      g.beginPath();
      gr.clip.forEach((q, k) => (k ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
      g.closePath();
      g.clip();
      for (const it of gr.items) {
        const img = imgs.get(it.artId);
        if (!img) continue;
        g.save();
        g.transform(it.m[0], it.m[1], it.m[2], it.m[3], it.m[4], it.m[5]);
        g.transform(1 / img.width, 0, 0, -1 / img.height, 0, 1); // pixel da imagem → quadrado unitário (v para cima)
        g.drawImage(img, 0, 0);
        g.restore();
      }
      g.restore();
    }
    if (opts.outlines) {
      g.strokeStyle = '#808080';
      g.lineWidth = 0.3;
      for (const s of job.strokes) {
        if (s.pen !== 1 || s.points.length < 2) continue;
        g.beginPath();
        s.points.forEach((q, k) => (k ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
        if (s.closed) g.closePath();
        g.stroke();
      }
    }
    const px = g.getImageData(0, 0, wPx, n).data;
    const rgb = new Uint8Array(wPx * n * 3);
    for (let k = 0, j = 0; k < px.length; k += 4, j += 3) {
      rgb[j] = px[k]!;
      rgb[j + 1] = px[k + 1]!;
      rgb[j + 2] = px[k + 2]!;
    }
    strips.push(await deflate(rgb));
    onProgress?.(Math.min(1, (r0 + n) / hPx));
    await new Promise((r) => setTimeout(r, 0));
  }
  imgs.forEach((b) => b.close());
  return tiffFile(wPx, hPx, rows, strips, opts.dpi);
}

/** Monta o TIFF (little-endian, RGB 8 bits, Deflate, resolução em dpi). */
export function tiffFile(w: number, h: number, rowsPerStrip: number, strips: Uint8Array[], dpi: number): Uint8Array {
  const S = strips.length;
  const entries: [number, number, number, number[] | number][] = []; // tag, tipo, contagem, valor
  const SHORT = 3, LONG = 4, RATIONAL = 5;
  const nTags = 13;
  const ifdOff = 8;
  const ifdSize = 2 + nTags * 12 + 4;
  let extra = ifdOff + ifdSize;
  const bpsOff = extra;
  extra += 6;
  const xresOff = extra;
  extra += 8;
  const yresOff = extra;
  extra += 8;
  const offsOff = extra;
  extra += S > 1 ? 4 * S : 0;
  const cntsOff = extra;
  extra += S > 1 ? 4 * S : 0;
  const dataStart = extra;
  const total = dataStart + strips.reduce((a, b) => a + b.length, 0);
  if (total > 0xffffffff) throw new Error('TIFF passaria de 4 GB — diminua a resolução (dpi)');
  const stripOffs: number[] = [];
  let o = dataStart;
  for (const st of strips) {
    stripOffs.push(o);
    o += st.length;
  }
  entries.push([256, LONG, 1, w], [257, LONG, 1, h], [258, SHORT, 3, bpsOff], [259, SHORT, 1, 8], [262, SHORT, 1, 2]);
  entries.push([273, LONG, S, S > 1 ? offsOff : stripOffs[0]!], [277, SHORT, 1, 3], [278, LONG, 1, rowsPerStrip]);
  entries.push([279, LONG, S, S > 1 ? cntsOff : strips[0]!.length], [282, RATIONAL, 1, xresOff], [283, RATIONAL, 1, yresOff], [284, SHORT, 1, 1], [296, SHORT, 1, 2]);

  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out[0] = 0x49;
  out[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifdOff, true);
  dv.setUint16(ifdOff, nTags, true);
  entries.forEach(([tag, type, count, val], i) => {
    const p = ifdOff + 2 + i * 12;
    dv.setUint16(p, tag, true);
    dv.setUint16(p + 2, type, true);
    dv.setUint32(p + 4, count, true);
    if (type === SHORT && count === 1) dv.setUint16(p + 8, val as number, true);
    else dv.setUint32(p + 8, val as number, true);
  });
  dv.setUint32(ifdOff + 2 + nTags * 12, 0, true);
  for (let k = 0; k < 3; k++) dv.setUint16(bpsOff + 2 * k, 8, true);
  const den = 1000;
  dv.setUint32(xresOff, Math.round(dpi * den), true);
  dv.setUint32(xresOff + 4, den, true);
  dv.setUint32(yresOff, Math.round(dpi * den), true);
  dv.setUint32(yresOff + 4, den, true);
  if (S > 1) {
    stripOffs.forEach((v, k) => dv.setUint32(offsOff + 4 * k, v, true));
    strips.forEach((st, k) => dv.setUint32(cntsOff + 4 * k, st.length, true));
  }
  strips.forEach((st, k) => out.set(st, stripOffs[k]!));
  return out;
}
