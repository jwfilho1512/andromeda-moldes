/**
 * Desenho → SVG (texto). A mesma função desenha a tela e o arquivo exportado, então o que se vê
 * é exatamente o que sai.
 */
import { brushRender } from './brush';
import { dimGeometry, dimValueCm, fmtCm } from './draw-tools';
import { mirrored, mirrorX, pathD } from './geom';
import { fillValue, patternDef } from './patterns';
import { stitchShapeStrokes } from './stitch';
import { trimParts } from './trims';
import type { DimShape, DrawDoc, Fill, Shape, TrimShape } from './types';

/** Escala do documento usada para o valor das cotas (ajustada por quem desenha). */
let docScale = 5;
export const setDimScale = (s: number) => {
  docScale = s;
};

function dimSvg(d: DimShape): string {
  const g = dimGeometry(d);
  const L = (a: { x: number; y: number }, b: { x: number; y: number }) => `M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}`;
  const w = Math.max(0.1, d.size * 0.05);
  const label = d.text ?? fmtCm(dimValueCm(d, docScale));
  return (
    `<path d="${g.ext.map(([a, b]) => L(a, b)).join('')}${L(g.line[0], g.line[1])}" fill="none" stroke="${d.color}" stroke-width="${w}"/>` +
    g.arrows.map((a) => `<path d="M${a.map((p) => `${n(p.x)} ${n(p.y)}`).join('L')}" fill="none" stroke="${d.color}" stroke-width="${w}" stroke-linejoin="round"/>`).join('') +
    `<text x="${n(g.text.at.x)}" y="${n(g.text.at.y)}" transform="rotate(${n(g.text.angle)} ${n(g.text.at.x)} ${n(g.text.at.y)})" font-size="${d.size}" fill="${d.color}" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica, Arial, sans-serif" paint-order="stroke" stroke="#fff" stroke-width="${d.size * 0.25}">${esc(label)}</text>`
  );
}

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
      const cap = st.cap ?? 'round';
      return paths
        .map((p, i) => {
          const d = pathD(p) + (i === 0 ? extra : '');
          const closed = p.closed || (!!extra && i === 0);
          const fill = closed ? fillValue(st.fill) : 'none';
          let main: string;
          if (st.brush && st.stroke) {
            // pincel: preenchimento da forma + traço desenhado como contorno de espessura variável
            const br = brushRender(p, st.brush);
            const op = st.brush.kind === 'marcador' ? ' fill-opacity="0.82"' : '';
            main =
              (fill !== 'none' ? `<path d="${d}" fill="${fill}"${rule} stroke="none"/>` : '') +
              (br.fill ? `<path d="${br.fill}" fill="${st.stroke}"${op} fill-rule="nonzero" stroke="none"/>` : '') +
              br.strokes.map((s) => `<path d="${s.d}" fill="none" stroke="${st.stroke}" stroke-width="${s.width}" stroke-opacity="${s.opacity}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
          } else
            main = `<path d="${d}" fill="${fill}"${rule} stroke="${st.stroke ?? 'none'}" stroke-width="${st.width}" stroke-linejoin="${cap === 'butt' ? 'miter' : 'round'}" stroke-linecap="${cap}"${dash}/>`;
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
    case 'dim': {
      const body = dimSvg(sh);
      if (!hit) return body;
      const g = dimGeometry(sh);
      return body + `<path d="M${n(sh.a.x)} ${n(sh.a.y)}L${n(g.line[0].x)} ${n(g.line[0].y)}L${n(g.line[1].x)} ${n(g.line[1].y)}L${n(sh.b.x)} ${n(sh.b.y)}" fill="none" stroke="transparent" stroke-width="${hit}" class="hit"/>`;
    }
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
  setDimScale(doc.scale);
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
