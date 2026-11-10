/**
 * Imagens das estampas no app: leitura do arquivo, cache para desenhar na tela e
 * conversão para o PDF de sublimação (JPEG vai direto; PNG vira pixels compactados).
 */
import type { Artwork, PdfImage, PrintInstance } from '@cad-textil/core';

type Entry = { img: HTMLImageElement; ready: boolean };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();

/** Avisa quando uma imagem termina de carregar (para redesenhar). */
export function onArtLoaded(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Imagem pronta para desenhar (ou null enquanto carrega). */
export function artImage(art: Artwork): HTMLImageElement | null {
  let e = cache.get(art.id);
  if (!e || e.img.src !== art.dataUrl) {
    const img = new Image();
    e = { img, ready: false };
    cache.set(art.id, e);
    const entry = e;
    img.onload = () => {
      entry.ready = true;
      listeners.forEach((l) => l());
    };
    img.src = art.dataUrl;
  }
  return e.ready ? e.img : null;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

function mimeOf(bytes: Uint8Array, name: string): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  return null;
}

/** Lê um arquivo de imagem (PNG/JPEG) e cria a arte com o tamanho em pixels. */
export async function readArtwork(id: string, name: string, bytes: Uint8Array): Promise<Artwork> {
  const mime = mimeOf(bytes, name);
  if (!mime) throw new Error('Formato de imagem não suportado — use PNG ou JPEG');
  const dataUrl = `data:${mime};base64,${toBase64(bytes)}`;
  const img = new Image();
  await new Promise<void>((ok, fail) => {
    img.onload = () => ok();
    img.onerror = () => fail(new Error('Não foi possível abrir a imagem'));
    img.src = dataUrl;
  });
  const art: Artwork = { id, name, mime, dataUrl, widthPx: img.naturalWidth, heightPx: img.naturalHeight };
  cache.set(id, { img, ready: true });
  return art;
}

/** Desenha as estampas no canvas. `toScreen` leva mm → pixels da tela (Y para baixo). */
export function drawPrints(
  ctx: CanvasRenderingContext2D,
  instances: PrintInstance[],
  arts: Map<string, Artwork>,
  toScreen: (p: { x: number; y: number }) => { x: number; y: number },
  view?: { w: number; h: number },
): void {
  for (const ins of instances) {
    const art = arts.get(ins.artId);
    const img = art && artImage(art);
    if (!art || !img) continue;
    const [a, b, c, d, e, f] = ins.m;
    // canto de cima-esquerda da imagem (u=0, v=1) e eixos em tela
    const o = toScreen({ x: e + c, y: f + d });
    const pu = toScreen({ x: e + c + a, y: f + d + b });
    const pv = toScreen({ x: e, y: f }); // u=0, v=0 (baixo-esquerda)
    if (view) {
      const xs = [o.x, pu.x, pv.x, pu.x + pv.x - o.x], ys = [o.y, pu.y, pv.y, pu.y + pv.y - o.y];
      if (Math.max(...xs) < 0 || Math.min(...xs) > view.w || Math.max(...ys) < 0 || Math.min(...ys) > view.h) continue;
    }
    ctx.save();
    ctx.beginPath();
    ins.clip.forEach((p, i) => {
      const s = toScreen(p);
      if (i) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
    ctx.closePath();
    ctx.clip();
    const W = img.naturalWidth, H = img.naturalHeight;
    ctx.transform((pu.x - o.x) / W, (pu.y - o.y) / W, (pv.x - o.x) / H, (pv.y - o.y) / H, o.x, o.y);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Componentes de cor e marca Adobe de um JPEG. */
function jpegInfo(b: Uint8Array): { comps: number; adobe: boolean } {
  let i = 2, comps = 3, adobe = false;
  while (i + 4 < b.length) {
    if (b[i] !== 0xff) break;
    const m = b[i + 1]!;
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (m === 0xee) adobe = true;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) comps = b[i + 9]!;
    if (m === 0xda) break;
    i += 2 + len;
  }
  return { comps, adobe };
}

/** Converte as artes usadas para o formato do PDF. */
export async function pdfImages(arts: Artwork[]): Promise<PdfImage[]> {
  const out: PdfImage[] = [];
  for (const art of arts) {
    const bytes = dataUrlBytes(art.dataUrl);
    if (art.mime === 'image/jpeg') {
      const { comps, adobe } = jpegInfo(bytes);
      out.push({ id: art.id, width: art.widthPx, height: art.heightPx, filter: 'DCTDecode', colorSpace: comps === 4 ? 'DeviceCMYK' : comps === 1 ? 'DeviceGray' : 'DeviceRGB', data: bytes, invertCmyk: comps === 4 && adobe });
      continue;
    }
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: art.mime }));
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const g = cv.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const n = bmp.width * bmp.height;
    const rgb = new Uint8Array(n * 3), alpha = new Uint8Array(n);
    let transparent = false;
    for (let k = 0; k < n; k++) {
      rgb[k * 3] = px[k * 4]!;
      rgb[k * 3 + 1] = px[k * 4 + 1]!;
      rgb[k * 3 + 2] = px[k * 4 + 2]!;
      alpha[k] = px[k * 4 + 3]!;
      if (alpha[k] !== 255) transparent = true;
    }
    out.push({ id: art.id, width: bmp.width, height: bmp.height, filter: 'FlateDecode', colorSpace: 'DeviceRGB', data: await deflate(rgb), alpha: transparent ? await deflate(alpha) : undefined });
  }
  return out;
}
