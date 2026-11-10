/**
 * ESTAMPAS nos moldes (sublimação, transfer, silk).
 *
 *  - localizada: uma arte num ponto do molde (ex.: logo no peito), com largura em mm;
 *  - total (engenheirada): a arte cobre o molde inteiro + sangria — normalmente uma arte por tamanho;
 *  - corrida: um módulo (rapport) repetido em grade por todo o molde.
 *
 * As imagens ficam no documento (`doc.artworks`) e cada molde guarda só a referência por tamanho,
 * então a mesma arte pode ser usada em vários moldes. A sangria (arte além da linha de corte) evita
 * fio branco na borda quando o corte ou o tecido variam um pouco.
 */
import { type Vec2, add, bboxOfPoints, dot, offsetPolygon, scale, sub } from './geometry.js';
import type { PiecePrint } from './estampa-frame.js';
import { type Piece, cutLine } from './pattern.js';

export type { PiecePrint, PrintMode, RepeatLayout, FitMode } from './estampa-frame.js';
export { mapPrint } from './estampa-frame.js';

/** Imagem da estampa guardada no documento. */
export interface Artwork {
  id: string;
  /** Nome do arquivo original. */
  name: string;
  /** 'image/png' | 'image/jpeg' */
  mime: string;
  /** Conteúdo (data URL base64). */
  dataUrl: string;
  widthPx: number;
  heightPx: number;
}

/** Uma imagem desenhada: matriz que leva o quadrado unitário da imagem (u→direita, v→cima) para mm. */
export interface PrintInstance {
  artId: string;
  /** [a, b, c, d, e, f]: x = a·u + c·v + e ; y = b·u + d·v + f (igual à matriz do PDF). */
  m: [number, number, number, number, number, number];
  /** Recorte (linha de corte + sangria), em mm. */
  clip: Vec2[];
}

/** Arte de um tamanho ('' = arte padrão de todos os tamanhos). */
export function artFor(pr: PiecePrint, size: string): string | undefined {
  return pr.art[size] || pr.art[''] || undefined;
}

/** Largura da arte (localizada) ou do módulo (corrida) num tamanho. */
export function widthFor(pr: PiecePrint, size: string): number {
  return pr.widthBySize?.[size] ?? pr.widthMm;
}

/** Área onde a arte aparece: linha de corte deslocada pela sangria. */
export function printClip(piece: Piece, pr: PiecePrint): Vec2[] {
  const cut = cutLine(piece, 0.1);
  return pr.bleedMm > 0 ? offsetPolygon(cut, pr.bleedMm) : cut;
}

/** Maior sangria entre as estampas do molde (0 = sem estampa). */
export function pieceBleed(piece: Piece): number {
  return (piece.prints ?? []).reduce((m, p) => Math.max(m, p.bleedMm), 0);
}

function axes(pr: PiecePrint, ex0: Vec2, ey0: Vec2) {
  const a = (pr.rotationDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const rot = (v: Vec2) => ({ x: v.x * c - v.y * s, y: v.x * s + v.y * c });
  let ex = rot(ex0), ey = rot(ey0);
  if (pr.mirrored) ex = scale(ex, -1);
  if (pr.flipV) ey = scale(ey, -1);
  return { ex, ey };
}

const matrix = (o: Vec2, U: Vec2, V: Vec2): PrintInstance['m'] => [U.x, U.y, V.x, V.y, o.x, o.y];

/** Direções do tecido no molde: largura (x) e comprimento/fio (y), unitárias. */
export function fabricAxes(piece: Piece): { across: Vec2; along: Vec2 } {
  const len = piece.grainline ? sub(piece.grainline[1], piece.grainline[0]) : { x: 0, y: 1 };
  const along = scale(len, 1 / (Math.hypot(len.x, len.y) || 1));
  return { across: { x: along.y, y: -along.x }, along };
}

/** Altura da arte/módulo num tamanho (proporcional à largura se não foi definida). */
export function heightFor(pr: PiecePrint, size: string, art: Pick<Artwork, 'widthPx' | 'heightPx'>): number {
  return pr.heightBySize?.[size] ?? pr.heightMm ?? (widthFor(pr, size) * art.heightPx) / art.widthPx;
}

/** Referencial do tecido: origem e direção do comprimento do rolo (fio), nas coordenadas do molde. */
export interface FabricFrame {
  origin: Vec2;
  /** Direção do comprimento do tecido (sentido do fio). */
  length: Vec2;
}

export interface PrintOptions {
  /** Limite de módulos por estampa (proteção contra módulo minúsculo). */
  maxTiles?: number;
  /** Textura: tecido onde ela é contínua (no risco). Sem isso, a prévia segue o fio do molde. */
  fabric?: FabricFrame;
}

/** Módulos em repetição cobrindo a caixa `b` (em coordenadas u,v a partir de `o`). */
function tiles(out: PrintInstance[], artId: string, clip: Vec2[], o: Vec2, ex: Vec2, ey: Vec2, W: number, H: number, pr: PiecePrint, b: { minX: number; minY: number; maxX: number; maxY: number }, maxTiles: number) {
  const sx = W + Math.max(0, pr.gapXMm ?? 0), sy = H + Math.max(0, pr.gapYMm ?? 0);
  if (!(sx > 0) || !(sy > 0)) return;
  const layout = pr.repeat ?? 'grade';
  const i0 = Math.floor(b.minX / sx) - 1, i1 = Math.ceil(b.maxX / sx) + 1;
  const j0 = Math.floor(b.minY / sy) - 1, j1 = Math.ceil(b.maxY / sy) + 1;
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > maxTiles) return;
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const odd = (k: number) => ((k % 2) + 2) % 2 === 1;
      const pu = i * sx + (layout === 'tijolo' && odd(j) ? sx / 2 : 0);
      const pv = j * sy + (layout === 'meio-salto' && odd(i) ? sy / 2 : 0);
      if (pu > b.maxX || pu + W < b.minX || pv > b.maxY || pv + H < b.minY) continue;
      let O = add(o, add(scale(ex, pu), scale(ey, pv)));
      let U = scale(ex, W), V = scale(ey, H);
      if (layout === 'espelhada' && odd(i)) [O, U] = [add(O, U), scale(U, -1)];
      if (layout === 'espelhada' && odd(j)) [O, V] = [add(O, V), scale(V, -1)];
      out.push({ artId, m: matrix(O, U, V), clip });
    }
  }
}

/**
 * Imagens a desenhar para um molde (já no tamanho e na posição final), em mm.
 * @param size nome do tamanho (escolhe a arte e as medidas daquele tamanho)
 */
export function printInstances(piece: Piece, size: string, artworks: Map<string, Artwork> | Artwork[], opts: PrintOptions = {}): PrintInstance[] {
  const arts = artworks instanceof Map ? artworks : new Map(artworks.map((a) => [a.id, a]));
  const maxTiles = opts.maxTiles ?? 20000;
  const out: PrintInstance[] = [];
  for (const pr of piece.prints ?? []) {
    const id = artFor(pr, size);
    const art = id ? arts.get(id) : undefined;
    if (!art || !art.widthPx || !art.heightPx) continue;
    const clip = printClip(piece, pr);
    if (pr.mode === 'textura') {
      // contínua no tecido: o "para cima" da arte segue o comprimento do rolo (fio)
      let len = opts.fabric?.length;
      if (!len) len = piece.grainline ? sub(piece.grainline[1], piece.grainline[0]) : { x: 0, y: 1 };
      const ey0 = scale(len, 1 / (Math.hypot(len.x, len.y) || 1));
      const { ex, ey } = axes(pr, { x: ey0.y, y: -ey0.x }, ey0);
      const off = pr.offsetMm ?? { x: 0, y: 0 };
      // no risco: início do tecido; na prévia do molde: início do fio (o deslocamento vale nos dois)
      const anchor = opts.fabric ? opts.fabric.origin : piece.grainline?.[0] ?? pr.center;
      const o = add(anchor, add(scale({ x: ey0.y, y: -ey0.x }, off.x), scale(ey0, off.y)));
      const uv = clip.map((p) => ({ x: dot(sub(p, o), ex), y: dot(sub(p, o), ey) }));
      tiles(out, art.id, clip, o, ex, ey, widthFor(pr, size), heightFor(pr, size, art), pr, bboxOfPoints(uv), maxTiles);
      continue;
    }
    const { ex, ey } = axes(pr, { x: 1, y: 0 }, { x: 0, y: 1 });
    const c = pr.center;
    if (pr.mode === 'localizada') {
      const U = scale(ex, widthFor(pr, size)), V = scale(ey, heightFor(pr, size, art));
      out.push({ artId: art.id, m: matrix(sub(sub(c, scale(U, 0.5)), scale(V, 0.5)), U, V), clip });
      continue;
    }
    // coordenadas do recorte no referencial da estampa
    const uv = clip.map((p) => ({ x: dot(sub(p, c), ex), y: dot(sub(p, c), ey) }));
    const b = bboxOfPoints(uv);
    if (pr.mode === 'total') {
      const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
      let W: number, H: number;
      if (pr.fit === 'esticar') [W, H] = [bw, bh];
      else {
        const k = (pr.fit === 'conter' ? Math.min : Math.max)(bw / art.widthPx, bh / art.heightPx);
        [W, H] = [art.widthPx * k, art.heightPx * k];
      }
      const u0 = (b.minX + b.maxX) / 2 - W / 2, v0 = (b.minY + b.maxY) / 2 - H / 2;
      out.push({ artId: art.id, m: matrix(add(c, add(scale(ex, u0), scale(ey, v0))), scale(ex, W), scale(ey, H)), clip });
      continue;
    }
    // corrida: módulos ancorados no próprio molde
    tiles(out, art.id, clip, c, ex, ey, widthFor(pr, size), heightFor(pr, size, art), pr, b, maxTiles);
  }
  return out;
}

/** Quadro de um módulo/arte: ponto = O + u·U + v·V, com (u, v) no quadrado unitário (v para cima). */
export interface PrintFrame {
  O: Vec2;
  U: Vec2;
  V: Vec2;
}

/** Ponto de partida da textura na prévia do molde (início do fio + deslocamento) e o eixo do fio. */
function texturaRef(piece: Piece, pr: PiecePrint) {
  const { across, along } = fabricAxes(piece);
  const anchor = piece.grainline?.[0] ?? pr.center;
  return { across, along, anchor };
}

/**
 * Quadro editável da estampa no tamanho dado (para as alças de escala/giro na tela):
 * localizada = a própria arte; corrida/textura = o módulo de referência; total = a arte ajustada.
 */
export function printFrame(piece: Piece, pr: PiecePrint, size: string, artworks: Map<string, Artwork>): PrintFrame | null {
  const id = artFor(pr, size);
  const art = id ? artworks.get(id) : undefined;
  if (!art || !art.widthPx || !art.heightPx) return null;
  if (pr.mode === 'localizada' || pr.mode === 'total') {
    const one = printInstances({ ...piece, prints: [{ ...pr, repeat: undefined }] }, size, artworks)[0];
    if (!one) return null;
    const [a, b, c, d, e, f] = one.m;
    return { O: { x: e, y: f }, U: { x: a, y: b }, V: { x: c, y: d } };
  }
  const W = widthFor(pr, size), H = heightFor(pr, size, art);
  if (pr.mode === 'corrida') {
    const { ex, ey } = axes(pr, { x: 1, y: 0 }, { x: 0, y: 1 });
    return { O: pr.center, U: scale(ex, W), V: scale(ey, H) };
  }
  const { across, along, anchor } = texturaRef(piece, pr);
  const { ex, ey } = axes(pr, across, along);
  const off = pr.offsetMm ?? { x: 0, y: 0 };
  return { O: add(anchor, add(scale(across, off.x), scale(along, off.y))), U: scale(ex, W), V: scale(ey, H) };
}

/**
 * Leva um quadro editado (escalado, girado ou movido na tela) de volta para a estampa.
 * A escala vale para todos os tamanhos (larguras/alturas por tamanho são multiplicadas pelo mesmo fator);
 * escala só numa direção destrava a proporção. Total: só o giro (o tamanho segue o molde).
 */
export function applyPrintFrame(piece: Piece, pr: PiecePrint, size: string, artworks: Map<string, Artwork>, fr: PrintFrame): PiecePrint {
  const id = artFor(pr, size);
  const art = id ? artworks.get(id) : undefined;
  if (!art) return pr;
  // giro: segue o eixo vertical da arte (o horizontal inverte com o espelho)
  const ey0 = pr.mode === 'textura' ? texturaRef(piece, pr).along : { x: 0, y: 1 };
  const vy = pr.flipV ? scale(fr.V, -1) : fr.V;
  const deg = ((Math.atan2(vy.y, vy.x) - Math.atan2(ey0.y, ey0.x)) * 180) / Math.PI;
  const rotationDeg = Math.round((((deg % 360) + 360) % 360) * 1e6) / 1e6 % 360;
  if (pr.mode === 'total') return { ...pr, rotationDeg };

  const W = Math.hypot(fr.U.x, fr.U.y), H = Math.hypot(fr.V.x, fr.V.y);
  const W0 = widthFor(pr, size), H0 = heightFor(pr, size, art);
  const kw = W0 > 0 ? W / W0 : 1, kh = H0 > 0 ? H / H0 : 1;
  const r1 = (n: number) => Math.round(n * 100) / 100;
  const mapRec = (r: Record<string, number> | undefined, k: number) => (r ? Object.fromEntries(Object.entries(r).map(([s, v]) => [s, r1(v * k)])) : undefined);
  let next: PiecePrint = { ...pr, rotationDeg, widthMm: r1(pr.widthMm * kw), widthBySize: mapRec(pr.widthBySize, kw) };
  const locked = pr.heightMm === undefined && !pr.heightBySize;
  if (!(locked && Math.abs(kw - kh) < 1e-6)) {
    // altura própria: parte da altura atual (proporcional, se estava travada) e aplica o fator vertical
    const ratio = art.heightPx / art.widthPx;
    const hBase = pr.heightMm ?? pr.widthMm * ratio;
    const hBy = pr.heightBySize ?? (locked && pr.widthBySize ? Object.fromEntries(Object.entries(pr.widthBySize).map(([s, v]) => [s, v * ratio])) : undefined);
    next = { ...next, heightMm: r1(hBase * kh), heightBySize: mapRec(hBy, kh) };
  }
  if (pr.mode === 'localizada') return { ...next, center: add(fr.O, scale(add(fr.U, fr.V), 0.5)) };
  if (pr.mode === 'corrida') return { ...next, center: fr.O };
  const { across, along, anchor } = texturaRef(piece, pr);
  const d = sub(fr.O, anchor);
  return { ...next, offsetMm: { x: r1(dot(d, across)), y: r1(dot(d, along)) } };
}

/** Resolução efetiva da arte (pontos por polegada) numa largura em mm. */
export function effectiveDpi(art: Artwork, widthMm: number): number {
  return widthMm > 0 ? art.widthPx / (widthMm / 25.4) : 0;
}

/**
 * Compensação de encolhimento do tecido na sublimação (prensa térmica): o papel é impresso
 * MAIOR para que, depois de encolher `pct` %, a peça fique na medida. Fator = 1 / (1 − pct/100).
 */
export function shrinkFactor(pct: number): number {
  if (!(pct > -50 && pct < 50)) throw new Error('Encolhimento fora da faixa (−50% a 50%)');
  return 1 / (1 - pct / 100);
}
