/**
 * Desenho → SVG (texto). A mesma função desenha a tela e o arquivo exportado, então o que se vê
 * é exatamente o que sai.
 */
import { mirrored, mirrorX, pathD } from './geom';
import { fillValue, patternDef } from './patterns';
import { stitchShapeStrokes } from './stitch';
import { trimParts } from './trims';
import type { DrawDoc, Fill, Shape, TrimShape } from './types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (x: number) => Math.round(x * 1000) / 1000;

function trimSvg(sh: TrimShape, at = sh.at, flip = false): string {
  const parts = trimParts(sh.trim)
    .map((p, i) =>
      p.fill
        ? `<path d="${p.d}" fill="${sh.color}"/>`
        : `<path d="${p.d}" fill="${i === 0 ? '#fff' : 'none'}" stroke="${sh.color}" stroke-width="${p.w}" stroke-linejoin="round"/>`,
    )
    .join('');
  return `<g transform="translate(${n(at.x)} ${n(at.y)}) rotate(${n(flip ? -sh.rot : sh.rot)}) scale(${n(flip ? -sh.size : sh.size)} ${n(sh.size)})">${parts}</g>`;
}

/**
 * SVG de uma forma. `hit` > 0 acrescenta um traço invisível dessa largura para facilitar o clique.
 */
export function shapeSvg(sh: Shape, hit = 0): string {
  if (sh.hidden) return '';
  switch (sh.kind) {
    case 'path': {
      const paths = sh.mirror !== undefined ? mirrored(sh.path, sh.mirror) : [sh.path];
      const st = sh.style;
      const dash = st.dash?.length ? ` stroke-dasharray="${st.dash.join(' ')}"` : '';
      const extra = sh.subpaths?.map(pathD).join('') ?? '';
      const rule = sh.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
      return paths
        .map((p, i) => {
          const d = pathD(p) + (i === 0 ? extra : '');
          const closed = p.closed || (!!extra && i === 0);
          const fill = closed ? fillValue(st.fill) : 'none';
          const main = `<path d="${d}" fill="${fill}"${rule} stroke="${st.stroke ?? 'none'}" stroke-width="${st.width}" stroke-linejoin="round" stroke-linecap="round"${dash}/>`;
          const h = hit ? `<path d="${d}" fill="${closed && st.fill ? 'transparent' : 'none'}" stroke="transparent" stroke-width="${hit}" class="hit"/>` : '';
          return main + h;
        })
        .join('');
    }
    case 'stitch': {
      const strokes = stitchShapeStrokes(sh);
      const c = sh.stitch.color;
      const body = strokes
        .map((s) => `<path d="${s.d}" fill="${s.fill ? c : 'none'}" stroke="${c}" stroke-width="${s.width}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} stroke-linecap="round"/>`)
        .join('');
      const h = hit
        ? (sh.mirror !== undefined ? mirrored(sh.path, sh.mirror) : [sh.path]).map((p) => `<path d="${pathD(p)}" fill="none" stroke="transparent" stroke-width="${hit}" class="hit"/>`).join('')
        : '';
      return body + h;
    }
    case 'trim':
      return trimSvg(sh) + (sh.mirror !== undefined ? trimSvg(sh, mirrorX(sh.mirror)(sh.at), true) : '');
    case 'image':
      return `<image href="${sh.href}" x="${n(sh.at.x)}" y="${n(sh.at.y)}" width="${n(sh.w)}" height="${n(sh.h)}" preserveAspectRatio="none" opacity="${sh.opacity}"/>`;
    case 'text': {
      const t = (x: number) =>
        `<text x="${n(x)}" y="${n(sh.at.y)}" font-size="${sh.size}" fill="${sh.color}" font-family="Helvetica, Arial, sans-serif">${esc(sh.text)}</text>`;
      return t(sh.at.x);
    }
    case 'group':
      return sh.children
        .map((c) => {
          const inner = shapeSvg(sh.mirror !== undefined && c.mirror === undefined ? { ...c, mirror: sh.mirror } : c, hit);
          // na tela, cada filho leva o id (para editar dentro do grupo sem desagrupar)
          return hit ? `<g data-cid="${c.id}">${inner}</g>` : inner;
        })
        .join('');
  }
}

/** Todos os preenchimentos de tecido usados (para os <pattern> do <defs>). */
export function collectFills(shapes: Shape[], out = new Map<string, Fill>()): Map<string, Fill> {
  for (const sh of shapes) {
    if (sh.kind === 'path' && sh.style.fill?.kind === 'pattern') out.set(fillValue(sh.style.fill), sh.style.fill);
    if (sh.kind === 'group') collectFills(sh.children, out);
  }
  return out;
}

export function defsSvg(shapes: Shape[]): string {
  const fills = [...collectFills(shapes).values()];
  return fills.map((f) => (f.kind === 'pattern' ? patternDef(f) : '')).join('');
}

/** Documento inteiro como arquivo SVG em escala (mm). */
export function docToSvg(doc: DrawDoc, opts: { background?: boolean } = {}): string {
  const shapes = doc.layers.filter((l) => l.visible).flatMap((l) => l.shapes);
  const { w, h } = doc.artboard;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">` +
    `<title>${esc(doc.name)}</title><defs>${defsSvg(shapes)}</defs>` +
    (opts.background !== false ? `<rect width="${w}" height="${h}" fill="#fff"/>` : '') +
    shapes.map((s) => shapeSvg(s)).join('') +
    `</svg>`
  );
}
