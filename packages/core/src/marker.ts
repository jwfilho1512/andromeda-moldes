/**
 * RISCO E ENCAIXE (marker making).
 *
 * Coordenadas do risco: X ao longo do comprimento do rolo (0 → ∞), Y na largura do tecido (0 → largura).
 * Todo molde é girado para o FIO ficar paralelo a X.
 *
 * Encaixe automático: "bottom-left" sobre grade (raster) conservadora — cada linha da grade guarda o
 * intervalo ocupado pelo molde naquela faixa, então dois moldes nunca se sobrepõem.
 */
import { type Vec2, bboxOfPoints, offsetPolygon, signedArea } from './geometry.js';
import { mapPiece } from './edit.js';
import { type Piece, cutLine } from './pattern.js';
import { pieceForSize } from './grading.js';
import { type Artwork, type PrintInstance, pieceBleed, printInstances } from './estampa.js';
import { type PlotJob, addPiece, emptyJob } from './plot.js';

export type Rot = 0 | 90 | 180 | 270;

export interface FabricSpec {
  /** Largura útil do tecido (mm). */
  widthMm: number;
  /** Margem em cada ourela (mm). */
  edgeMarginMm: number;
  /** Distância mínima entre moldes (mm). */
  gapMm: number;
  /** Rotações permitidas: fixo (só 0°), 180° (tecido sem sentido) ou 90° (qualquer). */
  rotation: 'fixo' | '180' | '90';
  /** Enfesto face com face: moldes "em par" saem do mesmo corte (não precisa espelhar). */
  faceToFace: boolean;
  /** Resolução da grade do encaixe (mm). Menor = mais justo, mais lento. */
  resolutionMm: number;
  /** Comprimento máximo do risco (mesa de corte), em mm. 0 ou ausente = sem limite. */
  maxLengthMm?: number;
}

export const DEFAULT_FABRIC: FabricSpec = { widthMm: 1500, edgeMarginMm: 10, gapMm: 2, rotation: '180', faceToFace: false, resolutionMm: 3 };

/** Pedido: quantidade de peças de roupa por tamanho. Moldes sem grade usam o total. */
export type MarkerOrder = Record<string, number>;

export interface MarkerItem {
  key: string;
  sourceId: string;
  size: string;
  name: string;
  mirror: boolean;
  /** Polígono de corte já com fio em X, normalizado (mínimo em 0,0). */
  poly: Vec2[];
  area: number;
  /** Ângulo aplicado para alinhar o fio (rad) e deslocamento da normalização. */
  grainAngle: number;
  m0: Vec2;
  /** Folga extra em volta do molde no encaixe (mm): metade da sangria das estampas. */
  pad?: number;
}

export interface MarkerPlacement {
  key: string;
  /** Posição (mm) do canto mínimo da forma girada no risco (sem a margem da ourela em Y). */
  x: number;
  y: number;
  rot: Rot;
}

export interface MarkerStats {
  lengthMm: number;
  usedAreaMm2: number;
  /** Aproveitamento: área dos moldes / (largura útil × comprimento). */
  efficiency: number;
  placed: number;
  unplaced: number;
}

const rotPt = (p: Vec2, a: number): Vec2 => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
const minOf = (pts: Vec2[]) => {
  const b = bboxOfPoints(pts);
  return { x: b.minX, y: b.minY };
};

/** Lista de moldes do risco a partir do pedido (todos os tamanhos e quantidades). */
export function markerItems(pieces: Piece[], order: MarkerOrder, fabric: FabricSpec): MarkerItem[] {
  const items: MarkerItem[] = [];
  const total = Object.values(order).reduce((a, b) => a + b, 0);
  // Estampas com sangria: dois moldes ficam a pelo menos (folga + sangria) um do outro, para a arte
  // de um não invadir o outro. Cada molde ganha metade; com estampa no risco, os lisos também.
  const maxBleed = Math.max(0, ...pieces.map(pieceBleed));
  for (const p of pieces) {
    const padOf = maxBleed > 0 ? maxBleed / 2 : 0;
    const sizes = p.grading ? p.grading.sizes.map((s, i) => ({ s, i, q: order[s] ?? 0 })) : [{ s: '', i: -1, q: total }];
    for (const { s, i, q } of sizes) {
      if (q <= 0) continue;
      const sized = i >= 0 ? pieceForSize(p, i) : p;
      const pair = sized.cutInPairs && !fabric.faceToFace;
      const perGarment = sized.cutInPairs && fabric.faceToFace ? Math.ceil(sized.quantity / 2) : sized.quantity;
      const base = cutLine(sized);
      const shared = new Map<boolean, { poly: Vec2[]; area: number; grainAngle: number; m0: Vec2 }>();
      for (let g = 0; g < q; g++) {
        for (let c = 0; c < perGarment; c++) {
          const mirror = pair && c % 2 === 1;
          const hit = shared.get(mirror);
          if (hit) {
            items.push({ key: `${p.id}|${s}|${items.length}`, sourceId: p.id, size: s, name: p.name, mirror, ...hit, ...(padOf ? { pad: padOf } : {}) });
            continue;
          }
          const pts = mirror ? base.map((v) => ({ x: -v.x, y: v.y })) : base;
          let grainAngle = 0;
          if (sized.grainline) {
            let [a, b] = sized.grainline;
            if (mirror) {
              a = { x: -a.x, y: a.y };
              b = { x: -b.x, y: b.y };
            }
            grainAngle = -Math.atan2(b.y - a.y, b.x - a.x);
          }
          const r = pts.map((v) => rotPt(v, grainAngle));
          const m0 = minOf(r);
          const poly = r.map((v) => ({ x: v.x - m0.x, y: v.y - m0.y }));
          const shape = { poly, area: Math.abs(signedArea(poly)), grainAngle, m0 };
          shared.set(mirror, shape);
          items.push({ key: `${p.id}|${s}|${items.length}`, sourceId: p.id, size: s, name: p.name, mirror, ...shape, ...(padOf ? { pad: padOf } : {}) });
        }
      }
    }
  }
  return items;
}

export function allowedRotations(fabric: FabricSpec): Rot[] {
  return fabric.rotation === 'fixo' ? [0] : fabric.rotation === '180' ? [0, 180] : [0, 90, 180, 270];
}

/** Forma do molde numa rotação (normalizada) — usada no encaixe, desenho e exportação. */
export function shapeOf(item: MarkerItem, rot: Rot): { poly: Vec2[]; m1: Vec2; w: number; h: number } {
  const a = (rot * Math.PI) / 180;
  const r = item.poly.map((v) => rotPt(v, a));
  const m1 = minOf(r);
  const poly = r.map((v) => ({ x: v.x - m1.x, y: v.y - m1.y }));
  const b = bboxOfPoints(poly);
  return { poly, m1, w: b.maxX, h: b.maxY };
}

/** Transformação: coordenadas do molde (no tamanho) → coordenadas do risco. */
export function itemTransform(item: MarkerItem, pl: MarkerPlacement, fabric: FabricSpec): (p: Vec2) => Vec2 {
  const a = (pl.rot * Math.PI) / 180;
  const { m1 } = shapeOf(item, pl.rot);
  return (p) => {
    const q = item.mirror ? { x: -p.x, y: p.y } : p;
    const g = rotPt(q, item.grainAngle);
    const n = { x: g.x - item.m0.x, y: g.y - item.m0.y };
    const r = rotPt(n, a);
    return { x: r.x - m1.x + pl.x, y: r.y - m1.y + pl.y + fabric.edgeMarginMm };
  };
}

/** Polígono do molde já posicionado no risco. */
export function placedPolygon(item: MarkerItem, pl: MarkerPlacement, fabric: FabricSpec): Vec2[] {
  return shapeOf(item, pl.rot).poly.map((v) => ({ x: v.x + pl.x, y: v.y + pl.y + fabric.edgeMarginMm }));
}

/* ------------------------------------------------------------------ */
/* Grade (raster) conservadora                                         */
/* ------------------------------------------------------------------ */

interface Raster {
  /** Por linha da grade: intervalos de células ocupados [s, e] (inclusive), ordenados. */
  rows: [number, number][][];
  wCells: number;
}

/**
 * Grade conservadora com VÁRIOS intervalos por linha (o molde ocupa só onde está —
 * outro molde pode entrar nas reentrâncias, como o gancho da calça ou a cabeça da manga).
 *
 * Para cada faixa horizontal de altura r, a ocupação é a união de:
 *  - cortes horizontais do polígono no topo, no meio, na base e na altura de cada vértice da faixa;
 *  - a faixa de x percorrida por cada aresta dentro da faixa (cobre as bordas que se movem entre os cortes).
 * Isso cobre todo ponto do polígono dentro da faixa (garantia de não sobrepor).
 */
function rasterize(poly: Vec2[], r: number, gap: number): Raster {
  const p = gap > 0 ? offsetPolygon(poly, gap / 2) : poly;
  const b = bboxOfPoints(p);
  // Desloca para que x e y comecem em 0 (a dilatação pode ter criado coordenadas negativas)
  const pts = p.map((v) => ({ x: v.x - Math.min(0, b.minX), y: v.y - Math.min(0, b.minY) }));
  const bb = bboxOfPoints(pts);
  const nRows = Math.max(1, Math.ceil(bb.maxY / r - 1e-9));
  const n = pts.length;
  const bandEdges: number[][] = Array.from({ length: nRows }, () => []);
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, c = pts[(i + 1) % n]!;
    const y0 = Math.min(a.y, c.y), y1 = Math.max(a.y, c.y);
    // Borda exatamente no limite de cima pertence à última linha (não cria linha extra).
    const j0 = Math.min(nRows - 1, Math.max(0, Math.floor(y0 / r))), j1 = Math.min(nRows - 1, Math.floor(y1 / r - 1e-12));
    for (let j = j0; j <= Math.max(j0, j1); j++) bandEdges[j]!.push(i);
  }
  const rows: [number, number][][] = [];
  for (let j = 0; j < nRows; j++) {
    const top = j * r, bot = (j + 1) * r;
    const ivs: [number, number][] = [];
    const edges = bandEdges[j]!;
    const samples = new Set<number>([top + r * 1e-4, (top + bot) / 2, bot - r * 1e-4]);
    for (const i of edges) {
      const a = pts[i]!, c = pts[(i + 1) % n]!;
      for (const v of [a, c]) if (v.y > top && v.y < bot) samples.add(v.y);
      const y0 = Math.min(a.y, c.y), y1 = Math.max(a.y, c.y);
      const ya = Math.max(y0, top), yb = Math.min(y1, bot);
      let xa: number, xb: number;
      if (Math.abs(c.y - a.y) < 1e-12) {
        xa = a.x;
        xb = c.x;
      } else {
        xa = a.x + ((c.x - a.x) * (ya - a.y)) / (c.y - a.y);
        xb = a.x + ((c.x - a.x) * (yb - a.y)) / (c.y - a.y);
      }
      ivs.push([Math.min(xa, xb), Math.max(xa, xb)]);
    }
    for (const y of samples) {
      const xs: number[] = [];
      for (const i of edges) {
        const a = pts[i]!, c = pts[(i + 1) % n]!;
        if ((a.y <= y && y < c.y) || (c.y <= y && y < a.y)) xs.push(a.x + ((c.x - a.x) * (y - a.y)) / (c.y - a.y));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) ivs.push([xs[k]!, xs[k + 1]!]);
    }
    // Para células, fundindo vizinhas
    const cells = ivs
      .map(([lo, hi]): [number, number] => [Math.floor(lo / r + 1e-9), Math.ceil(hi / r - 1e-9) - 1])
      // intervalo de largura zero exatamente na divisa entre células já está coberto pela célula vizinha
      .filter(([a, e]) => e >= a)
      .sort((u, v) => u[0] - v[0]);
    const merged: [number, number][] = [];
    for (const c of cells) {
      const last = merged[merged.length - 1];
      if (last && c[0] <= last[1] + 1) last[1] = Math.max(last[1], c[1]);
      else merged.push([c[0], c[1]]);
    }
    rows.push(merged);
  }
  const wCells = Math.ceil(bb.maxX / r - 1e-9);
  return { rows, wCells };
}

/** Ocupação do tecido: por linha, intervalos ocupados ordenados e fundidos. */
class Board {
  rows: [number, number][][];
  constructor(public nRows: number) {
    this.rows = Array.from({ length: nRows }, () => []);
  }
  /** Primeiro conflito com [s,e] nesta linha: retorna o fim do intervalo que conflita, ou -1. */
  conflict(row: number, s: number, e: number): number {
    // Intervalos ordenados e disjuntos: busca binária do primeiro com fim ≥ s.
    const list = this.rows[row]!;
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (list[m]![1] < s) lo = m + 1;
      else hi = m;
    }
    const it = list[lo];
    return it && it[0] <= e ? it[1] : -1;
  }
  add(row: number, s: number, e: number) {
    const list = this.rows[row]!;
    // insere mantendo a ordem e funde com os vizinhos que tocam
    let i = 0;
    while (i < list.length && list[i]![1] < s - 1) i++;
    let ns = s, ne = e, j = i;
    while (j < list.length && list[j]![0] <= e + 1) {
      ns = Math.min(ns, list[j]![0]);
      ne = Math.max(ne, list[j]![1]);
      j++;
    }
    list.splice(i, j - i, [ns, ne]);
  }
}

interface Shape {
  rot: Rot;
  raster: Raster;
  /** Ajuste entre a grade (dilatada) e a forma real. */
  offX: number;
  offY: number;
}

/** Cache das grades entre encaixes (a otimização chama `nest` centenas de vezes). */
const rasterCache = new WeakMap<Vec2[], Map<string, Shape[]>>();

function shapesFor(item: MarkerItem, fabric: FabricSpec, cache: Map<string, Shape[]>): Shape[] {
  const k = `${item.sourceId}|${item.size}|${item.mirror}`;
  let s = cache.get(k);
  const gap = fabric.gapMm + 2 * (item.pad ?? 0);
  const fk = `${fabric.resolutionMm}|${gap}|${fabric.rotation}`;
  if (!s) s = rasterCache.get(item.poly)?.get(fk);
  if (!s) {
    s = allowedRotations(fabric).map((rot) => {
      const { poly } = shapeOf(item, rot);
      const raster = rasterize(poly, fabric.resolutionMm, gap);
      // a dilatação de gap/2 desloca a forma real para dentro da grade
      const half = gap > 0 ? gap / 2 : 0;
      return { rot, raster, offX: half, offY: half };
    });
    let byFab = rasterCache.get(item.poly);
    if (!byFab) rasterCache.set(item.poly, (byFab = new Map()));
    byFab.set(fk, s);
  }
  cache.set(k, s);
  return s;
}

/**
 * Encontra onde a forma cabe: a posição mais à esquerda; com tolerância `tol` (células),
 * entre as posições quase tão à esquerda quanto a melhor, fica a mais baixa (assenta sem deixar buraco).
 */
function findSpot(board: Board, sh: Shape, tol = 0): { cx: number; cy: number } | null {
  const rows = sh.raster.rows;
  const h = rows.length;
  const found: { cx: number; cy: number }[] = [];
  let minX = Infinity;
  for (let y = 0; y + h <= board.nRows; y++) {
    let x0 = 0;
    for (let guard = 0; guard < 100000; guard++) {
      let moved = false;
      scan: for (let k = 0; k < h; k++) {
        for (const iv of rows[k]!) {
          const end = board.conflict(y + k, x0 + iv[0], x0 + iv[1]);
          if (end >= 0) {
            x0 = end + 1 - iv[0];
            moved = true;
            break scan;
          }
        }
      }
      if (!moved) break;
      if (x0 > minX + tol) break; // já pior que o aceitável
    }
    if (x0 <= minX + tol) {
      found.push({ cx: x0, cy: y });
      if (x0 < minX) minX = x0;
    }
  }
  let best: { cx: number; cy: number } | null = null;
  for (const f of found) {
    if (f.cx > minX + tol) continue;
    if (!best || f.cy < best.cy || (f.cy === best.cy && f.cx < best.cx)) best = f;
  }
  return best;
}

function occupy(board: Board, sh: Shape, cx: number, cy: number) {
  sh.raster.rows.forEach((ivs, k) => {
    for (const iv of ivs) board.add(cy + k, cx + iv[0], cx + iv[1]);
  });
}

export interface NestOptions {
  /** Ordem dos moldes (chaves). Padrão: maior área primeiro. */
  order?: string[];
  /**
   * Antecipação: a cada passo testa os próximos K moldes da fila e coloca o que chega mais
   * perto do início do risco (preenche os vãos à medida que aparecem). 1 = ordem estrita.
   */
  lookahead?: number;
  /** Critério da antecipação: 'left' = começa mais à esquerda; 'right' = menor ponta direita. */
  score?: 'left' | 'right';
  /** Tolerância (mm) do bottom-left: aceita até isto de recuo para assentar mais embaixo. */
  toleranceMm?: number;
  /** Rotação preferida por tipo de molde ("origem|tamanho|espelho"); se não couber, tenta as outras. */
  rotPref?: Record<string, Rot>;
  /** Moldes já posicionados que devem ficar onde estão (encaixar restantes). */
  fixed?: MarkerPlacement[];
}

/** Encaixe automático "bottom-left". Retorna posições e moldes que não couberam na largura. */
export function nest(items: MarkerItem[], fabric: FabricSpec, opts: NestOptions = {}): { placements: MarkerPlacement[]; unplaced: string[] } {
  const r = fabric.resolutionMm;
  const usable = fabric.widthMm - 2 * fabric.edgeMarginMm;
  const board = new Board(Math.floor(usable / r + 1e-9));
  const cache = new Map<string, Shape[]>();
  const byKey = new Map(items.map((i) => [i.key, i]));
  const placements: MarkerPlacement[] = [];
  const unplaced: string[] = [];

  for (const pl of opts.fixed ?? []) {
    const it = byKey.get(pl.key);
    if (!it) continue;
    const sh = shapesFor(it, fabric, cache).find((s) => s.rot === pl.rot) ?? rasterShape(it, pl.rot, fabric);
    // Posição livre (arrastada à mão): ocupa as células vizinhas para não deixar brecha.
    const fx = (pl.x - sh.offX) / r, fy = (pl.y - sh.offY) / r;
    for (const cx of new Set([Math.floor(fx), Math.ceil(fx)])) for (const cy of new Set([Math.floor(fy), Math.ceil(fy)])) if (cy >= 0 && cy + sh.raster.rows.length <= board.nRows) occupy(board, sh, cx, cy);
    placements.push(pl);
  }
  const fixedKeys = new Set((opts.fixed ?? []).map((p) => p.key));
  const order = (opts.order ?? [...items].sort((a, b) => b.area - a.area).map((i) => i.key)).filter((k) => !fixedKeys.has(k));

  const maxCells = fabric.maxLengthMm && fabric.maxLengthMm > 0 ? Math.floor(fabric.maxLengthMm / r + 1e-9) : Infinity;
  const K = Math.max(1, opts.lookahead ?? 1);
  const tol = Math.round((opts.toleranceMm ?? 0) / r);
  const mode = opts.score ?? 'left';
  const queue = order.filter((k) => byKey.has(k));
  const classOf = (it: MarkerItem) => `${it.sourceId}|${it.size}|${it.mirror}`;
  while (queue.length) {
    const window = queue.slice(0, K);
    const seen = new Map<string, { sh: Shape; cx: number; cy: number } | null>();
    let pick: { key: string; sh: Shape; cx: number; cy: number; score: number } | null = null;
    for (const key of window) {
      const it = byKey.get(key)!;
      const cls = classOf(it);
      let best = seen.get(cls);
      if (best === undefined) {
        best = null;
        const all = shapesFor(it, fabric, cache);
        const pref = opts.rotPref?.[cls];
        const pass = pref !== undefined ? [all.filter((x) => x.rot === pref), all] : [all];
        for (const shapes of pass) {
        if (best) break;
        for (const sh of shapes) {
          if (sh.raster.rows.length > board.nRows) continue;
          const spot = findSpot(board, sh, tol);
          if (!spot || spot.cx + sh.raster.wCells > maxCells) continue; // passa do comprimento máximo
          const right = spot.cx + sh.raster.wCells;
          const bestRight = best ? best.cx + best.sh.raster.wCells : Infinity;
          if (!best || right < bestRight || (right === bestRight && spot.cx < best.cx)) best = { sh, ...spot };
        }
        }
        seen.set(cls, best);
      }
      if (!best) continue;
      const score = mode === 'left' ? best.cx : best.cx + best.sh.raster.wCells;
      if (!pick || score < pick.score) pick = { key, ...best, score };
      if (K === 1) break;
    }
    if (!pick) {
      unplaced.push(queue.shift()!);
      continue;
    }
    occupy(board, pick.sh, pick.cx, pick.cy);
    placements.push({ key: pick.key, x: pick.cx * r + pick.sh.offX, y: pick.cy * r + pick.sh.offY, rot: pick.sh.rot });
    queue.splice(queue.indexOf(pick.key), 1);
  }
  return { placements, unplaced };
}

function rasterShape(it: MarkerItem, rot: Rot, fabric: FabricSpec): Shape {
  const gap = fabric.gapMm + 2 * (it.pad ?? 0);
  const half = gap > 0 ? gap / 2 : 0;
  return { rot, raster: rasterize(shapeOf(it, rot).poly, fabric.resolutionMm, gap), offX: half, offY: half };
}

/** Comprimento, aproveitamento e contagem. */
export function markerStats(items: MarkerItem[], placements: MarkerPlacement[], fabric: FabricSpec): MarkerStats {
  const byKey = new Map(items.map((i) => [i.key, i]));
  let length = 0;
  let area = 0;
  for (const pl of placements) {
    const it = byKey.get(pl.key);
    if (!it) continue;
    const { w } = shapeOf(it, pl.rot);
    length = Math.max(length, pl.x + w);
    area += it.area;
  }
  const usable = fabric.widthMm - 2 * fabric.edgeMarginMm;
  return {
    lengthMm: length,
    usedAreaMm2: area,
    efficiency: length > 0 ? area / (usable * length) : 0,
    placed: placements.length,
    unplaced: items.length - placements.length,
  };
}

/* ------------------------------------------------------------------ */
/* Otimização (várias tentativas, fica a melhor)                       */
/* ------------------------------------------------------------------ */

/** Gerador pseudoaleatório determinístico (para resultados reprodutíveis). */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Variação da ordem: troca algumas posições perto uma da outra (mantém "grandes primeiro"). */
export function perturbOrder(order: string[], rand: () => number, strength = 0.15): string[] {
  const o = [...order];
  const swaps = Math.max(1, Math.round(o.length * strength));
  for (let k = 0; k < swaps; k++) {
    const i = Math.floor(rand() * o.length);
    const j = Math.min(o.length - 1, Math.max(0, i + Math.round((rand() - 0.5) * 8)));
    [o[i], o[j]] = [o[j]!, o[i]!];
  }
  return o;
}

export interface NestBest {
  placements: MarkerPlacement[];
  unplaced: string[];
  length: number;
}

/** Estado da otimização: a melhor combinação encontrada até agora. */
export interface NestState {
  order: string[];
  rotPref: Record<string, Rot>;
  lookahead: number;
  toleranceMm: number;
  best: NestBest;
}

const better = (a: NestBest, b: NestBest) => a.unplaced.length < b.unplaced.length || (a.unplaced.length === b.unplaced.length && a.length < b.length - 1e-6);

function run(items: MarkerItem[], fabric: FabricSpec, order: string[], lookahead: number, rotPref: Record<string, Rot>, toleranceMm: number): NestBest {
  const res = nest(items, fabric, { order, lookahead, rotPref, toleranceMm });
  return { ...res, length: markerStats(items, res.placements, fabric).lengthMm };
}

/** Estratégias iniciais: três ordens clássicas (área, comprimento, largura) × antecipação × tolerância. */
export function nestCandidates(items: MarkerItem[]): { order: string[]; lookahead: number; toleranceMm: number }[] {
  const dims = new Map(items.map((i) => [i.key, bboxOfPoints(i.poly)]));
  const orders = [
    [...items].sort((a, b) => b.area - a.area),
    [...items].sort((a, b) => dims.get(b.key)!.maxX - dims.get(a.key)!.maxX),
    [...items].sort((a, b) => dims.get(b.key)!.maxY - dims.get(a.key)!.maxY),
  ].map((o) => o.map((i) => i.key));
  const out: { order: string[]; lookahead: number; toleranceMm: number }[] = [];
  // as mais promissoras primeiro (o editor pode parar no meio)
  for (const [lookahead, toleranceMm] of [[1, 40], [4, 0], [1, 80], [1, 0], [4, 40]] as const) for (const order of orders) out.push({ order, lookahead, toleranceMm });
  return out;
}

/** Avalia uma estratégia e, se for melhor, vira o estado atual. */
export function tryCandidate(items: MarkerItem[], fabric: FabricSpec, st: NestState | null, c: { order: string[]; lookahead: number; toleranceMm: number }): NestState {
  const best = run(items, fabric, c.order, c.lookahead, {}, c.toleranceMm);
  return !st || better(best, st.best) ? { ...c, rotPref: {}, best } : st;
}

/** Estado inicial: melhor das estratégias clássicas. */
export function initialNest(items: MarkerItem[], fabric: FabricSpec): NestState {
  let st: NestState | null = null;
  for (const c of nestCandidates(items)) st = tryCandidate(items, fabric, st, c);
  return st!;
}

/** Encaixe automático completo: ordens clássicas + `iterations` tentativas de melhoria. */
export function autoNest(items: MarkerItem[], fabric: FabricSpec, iterations = 20, seed = 1): NestBest {
  const state = initialNest(items, fabric);
  optimizeStep(items, fabric, state, rng(seed), iterations);
  return state.best;
}

/**
 * Otimização por busca local: a cada tentativa muda a ordem, força a rotação de um tipo de molde
 * ou muda a antecipação; fica com a mudança se o risco não piorar.
 * (O editor chama isto em fatias, para a tela não travar.)
 */
export function optimizeStep(items: MarkerItem[], fabric: FabricSpec, state: NestState, rand: () => number, iterations: number) {
  const classes = [...new Set(items.map((i) => `${i.sourceId}|${i.size}|${i.mirror}`))];
  const rots = allowedRotations(fabric);
  for (let i = 0; i < iterations; i++) {
    let order = state.order;
    let rotPref = state.rotPref;
    let lookahead = state.lookahead;
    let toleranceMm = state.toleranceMm;
    const move = rand();
    if (move < 0.5) order = perturbOrder(state.order, rand);
    else if (move < 0.75 && rots.length > 1) {
      const c = classes[Math.floor(rand() * classes.length)]!;
      rotPref = { ...state.rotPref, [c]: rots[Math.floor(rand() * rots.length)]! };
    } else if (move < 0.88) toleranceMm = [0, 15, 30, 50, 80, 120][Math.floor(rand() * 6)]!;
    else lookahead = [1, 2, 3, 4, 6][Math.floor(rand() * 5)]!;
    const res = run(items, fabric, order, lookahead, rotPref, toleranceMm);
    // aceita melhora; empate é aceito às vezes (sai de platôs)
    const tie = res.unplaced.length === state.best.unplaced.length && Math.abs(res.length - state.best.length) < 1e-6;
    if (better(res, state.best) || (tie && rand() < 0.3)) {
      state.order = order;
      state.rotPref = rotPref;
      state.lookahead = lookahead;
      state.toleranceMm = toleranceMm;
      state.best = res;
    }
  }
  return state;
}

/* ------------------------------------------------------------------ */
/* Conferência e exportação                                            */
/* ------------------------------------------------------------------ */

function segIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

function inside(p: Vec2, poly: Vec2[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}

/** Dois polígonos se sobrepõem? (cruzamento de bordas ou um dentro do outro) */
export function polygonsOverlap(pa: Vec2[], pb: Vec2[]): boolean {
  if (inside(pa[0]!, pb) || inside(pb[0]!, pa)) return true;
  // só os segmentos dentro da caixa comum
  const A = bboxOfPoints(pa), B = bboxOfPoints(pb);
  const minX = Math.max(A.minX, B.minX), maxX = Math.min(A.maxX, B.maxX), minY = Math.max(A.minY, B.minY), maxY = Math.min(A.maxY, B.maxY);
  if (minX > maxX || minY > maxY) return false;
  const inBox = (p: Vec2, q: Vec2) => !(Math.max(p.x, q.x) < minX || Math.min(p.x, q.x) > maxX || Math.max(p.y, q.y) < minY || Math.min(p.y, q.y) > maxY);
  const sa: [Vec2, Vec2][] = [], sb: [Vec2, Vec2][] = [];
  for (let i = 0; i < pa.length; i++) if (inBox(pa[i]!, pa[(i + 1) % pa.length]!)) sa.push([pa[i]!, pa[(i + 1) % pa.length]!]);
  for (let i = 0; i < pb.length; i++) if (inBox(pb[i]!, pb[(i + 1) % pb.length]!)) sb.push([pb[i]!, pb[(i + 1) % pb.length]!]);
  for (const [a1, a2] of sa) for (const [b1, b2] of sb) if (segIntersect(a1, a2, b1, b2)) return true;
  return false;
}

/** Moldes sobrepostos (ou fora da largura do tecido). */
export function overlapping(items: MarkerItem[], placements: MarkerPlacement[], fabric: FabricSpec): Set<string> {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const polys = placements.map((pl) => ({ key: pl.key, poly: placedPolygon(byKey.get(pl.key)!, pl, fabric) }));
  const boxes = polys.map((p) => bboxOfPoints(p.poly));
  const bad = new Set<string>();
  const top = fabric.widthMm - fabric.edgeMarginMm + 1e-6;
  polys.forEach((p, i) => {
    if (boxes[i]!.minY < fabric.edgeMarginMm - 1e-6 || boxes[i]!.maxY > top || boxes[i]!.minX < -1e-6) bad.add(p.key);
  });
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      const A = boxes[i]!, B = boxes[j]!;
      if (A.maxX < B.minX || B.maxX < A.minX || A.maxY < B.minY || B.maxY < A.minY) continue;
      const pa = polys[i]!.poly, pb = polys[j]!.poly;
      let hit = inside(pa[0]!, pb) || inside(pb[0]!, pa);
      for (let a = 0; !hit && a < pa.length; a++) {
        const a1 = pa[a]!, a2 = pa[(a + 1) % pa.length]!;
        for (let b = 0; b < pb.length; b++) {
          if (segIntersect(a1, a2, pb[b]!, pb[(b + 1) % pb.length]!)) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        bad.add(polys[i]!.key);
        bad.add(polys[j]!.key);
      }
    }
  }
  return bad;
}

/** Trabalho de plotagem do risco: moldes no tamanho, com nome + tamanho, e a borda do tecido. */
export function markerJob(pieces: Piece[], items: MarkerItem[], placements: MarkerPlacement[], fabric: FabricSpec): PlotJob {
  const job = emptyJob();
  const byKey = new Map(items.map((i) => [i.key, i]));
  const bySrc = new Map(pieces.map((p) => [p.id, p]));
  for (const pl of placements) {
    const it = byKey.get(pl.key);
    const src = it && bySrc.get(it.sourceId);
    if (!it || !src) continue;
    const idx = src.grading ? src.grading.sizes.indexOf(it.size) : -1;
    const sized = idx >= 0 ? pieceForSize(src, idx) : src;
    const f = itemTransform(it, pl, fabric);
    const placed = mapPiece({ ...sized, name: it.size ? `${sized.name} ${it.size}` : sized.name }, f);
    addPiece(job, placed, { showSewLine: false });
  }
  const L = markerStats(items, placements, fabric).lengthMm;
  job.strokes.push({ points: [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: fabric.widthMm }, { x: 0, y: fabric.widthMm }], closed: true, pen: 2 });
  return job;
}

/**
 * Estampas do risco: cada molde posicionado com a arte do seu tamanho. No par espelhado, a arte
 * localizada continua legível (não espelha), a não ser que a estampa peça o contrário.
 */
export function markerPrints(pieces: Piece[], items: MarkerItem[], placements: MarkerPlacement[], fabric: FabricSpec, artworks: Artwork[]): PrintInstance[] {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const bySrc = new Map(pieces.map((p) => [p.id, p]));
  const arts = new Map(artworks.map((a) => [a.id, a]));
  const out: PrintInstance[] = [];
  for (const pl of placements) {
    const it = byKey.get(pl.key);
    const src = it && bySrc.get(it.sourceId);
    if (!it || !src?.prints?.length) continue;
    const idx = src.grading ? src.grading.sizes.indexOf(it.size) : -1;
    const sized = idx >= 0 ? pieceForSize(src, idx) : src;
    let placed = mapPiece(sized, itemTransform(it, pl, fabric));
    if (it.mirror) {
      // desfaz o espelho da arte onde ela não deve espelhar: mantém o "para cima" e volta a ler normal
      placed = { ...placed, prints: placed.prints?.map((pr) => ((pr.mirrorInPair ?? pr.mode !== 'localizada') ? pr : { ...pr, mirrored: !pr.mirrored })) };
    }
    // textura: contínua no tecido — usa o giro/espelho originais (relativos ao fio), não os do molde girado
    const orig = new Map((sized.prints ?? []).map((pr) => [pr.id, pr]));
    placed = { ...placed, prints: placed.prints?.map((pr) => (pr.mode === 'textura' ? orig.get(pr.id)! : pr)) };
    out.push(...printInstances(placed, it.size, arts, { fabric: { origin: { x: 0, y: fabric.edgeMarginMm }, length: { x: 1, y: 0 } } }));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Enfesto                                                             */
/* ------------------------------------------------------------------ */

export interface SpreadSpec {
  /** Número de folhas (camadas) do enfesto. */
  plies: number;
  /** Folga em cada ponta do enfesto (mm). */
  endAllowanceMm: number;
}

export interface SpreadResult {
  /** Comprimento de cada folha (risco + 2 pontas), em metros. */
  plyLengthM: number;
  /** Tecido total do enfesto (m). */
  fabricTotalM: number;
  /** Peças de roupa cortadas no enfesto. */
  garments: number;
  /** Consumo de tecido por peça de roupa (m). */
  perGarmentM: number;
}

export function spreadResult(markerLengthMm: number, garmentsPerMarker: number, spread: SpreadSpec): SpreadResult {
  const ply = (markerLengthMm + 2 * spread.endAllowanceMm) / 1000;
  const total = ply * spread.plies;
  const garments = garmentsPerMarker * spread.plies;
  return { plyLengthM: ply, fabricTotalM: total, garments, perGarmentM: garments ? total / garments : 0 };
}

/** Sublimação: compensação de encolhimento e opções do PDF com as artes. */
export interface SublimationSpec {
  /** Encolhimento do tecido na prensa, no comprimento do rolo (%). */
  shrinkXPct: number;
  /** Encolhimento na largura do tecido (%). */
  shrinkYPct: number;
  /** Contornos finos (linha de corte) no arquivo da gráfica. */
  outlines: boolean;
  /** Mostrar as artes na tela do risco. */
  showArt: boolean;
  /** Formato do arquivo para a gráfica. */
  format?: 'tiff' | 'pdf';
  /** Resolução do TIFF (dpi). */
  dpi?: number;
  /** Espelhar o arquivo (papel transfer: a face impressa vai contra o tecido). */
  mirror?: boolean;
}

export const DEFAULT_SUBLIMATION: SublimationSpec = { shrinkXPct: 0, shrinkYPct: 0, outlines: false, showArt: true, format: 'tiff', dpi: 150, mirror: false };

/** Documento de risco salvo no .ctx. */
export interface MarkerDoc {
  sublimation?: SublimationSpec;
  name: string;
  fabric: FabricSpec;
  spread: SpreadSpec;
  order: MarkerOrder;
  /** Moldes do documento que entram no risco. */
  pieceIds: string[];
  placements: MarkerPlacement[];
}

