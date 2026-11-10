import { useSyncExternalStore } from 'react';
import {
  type FabricSpec,
  type MarkerDoc,
  type MarkerItem,
  type MarkerOrder,
  type MarkerPlacement,
  type PatternDocument,
  type Piece,
  type SpreadSpec,
  DEFAULT_FABRIC,
  exportHpgl,
  exportPdf,
  exportPdfTiled,
  PDF_MAX_PAGE_MM,
  markerItems,
  markerJob,
  markerStats,
  nest,
  bboxOfPoints,
  placedPolygon,
  polygonsOverlap,
  shapeOf,
  type PrintInstance,
  type SublimationSpec,
  DEFAULT_SUBLIMATION,
  exportPdfPrint,
  markerPrints,
  printLayout,
} from '@cad-textil/core';
import { pdfImages } from '../estampa/images';
import { renderTiff, tiffSize } from '../estampa/raster';
import { Store, editor, notify } from '../editor/store';
import { platform } from '../platform';
import NestWorker from './nest.worker?worker&inline';
import type { NestReply } from './nest.worker';

export interface RiscoState {
  fabric: FabricSpec;
  spread: SpreadSpec;
  order: MarkerOrder;
  /** Moldes do documento fora do risco. */
  excluded: Record<string, boolean>;
  placements: MarkerPlacement[];
  selected: string | null;
  running: boolean;
  progress: string;
  sublim: SublimationSpec;
}

export const risco = new Store<RiscoState>({
  fabric: { ...DEFAULT_FABRIC },
  spread: { plies: 40, endAllowanceMm: 20 },
  order: {},
  excluded: {},
  placements: [],
  selected: null,
  running: false,
  progress: '',
  sublim: { ...DEFAULT_SUBLIMATION },
});

export function useRisco(): RiscoState {
  return useSyncExternalStore(risco.subscribe, risco.get);
}

/** Tamanhos presentes no documento (na ordem da grade). */
export function docSizes(pieces: Piece[]): string[] {
  const out: string[] = [];
  for (const p of pieces) for (const s of p.grading?.sizes ?? []) if (!out.includes(s)) out.push(s);
  return out;
}

/** Quantidade padrão: 1 de cada tamanho (ou 1 peça, sem grade). */
export function effectiveOrder(pieces: Piece[], order: MarkerOrder): MarkerOrder {
  const sizes = docSizes(pieces);
  if (!sizes.length) return { '': order[''] ?? 1 };
  return Object.fromEntries(sizes.map((s) => [s, order[s] ?? 1]));
}

/* ------------------------------------------------------------------ */
/* Moldes do risco (memorizados)                                       */
/* ------------------------------------------------------------------ */

let memo: { key: unknown[]; items: MarkerItem[] } | null = null;

export function includedPieces(doc: PatternDocument = editor.get().doc, st: RiscoState = risco.get()): Piece[] {
  return doc.pieces.filter((p) => !st.excluded[p.id]);
}

export function riscoItems(): MarkerItem[] {
  const st = risco.get();
  const doc = editor.get().doc;
  const key = [doc.pieces, st.fabric, st.order, st.excluded];
  if (memo && memo.key.every((k, i) => k === key[i])) return memo.items;
  const items = markerItems(includedPieces(doc, st), effectiveOrder(doc.pieces, st.order), st.fabric);
  memo = { key, items };
  return items;
}

/* ------------------------------------------------------------------ */
/* Resultados memorizados (a tela não recalcula o que não mudou)       */
/* ------------------------------------------------------------------ */

type Placed = { poly: import('@cad-textil/core').Vec2[]; bb: ReturnType<typeof bboxOfPoints> };
let placedCache = new WeakMap<MarkerPlacement, Placed>();
let pairCache = new WeakMap<MarkerPlacement, WeakMap<MarkerPlacement, boolean>>();
let cacheFabric: FabricSpec | null = null;
let cacheItems: MarkerItem[] | null = null;

/** Polígono do molde já posicionado (memorizado por posição). */
export function placedOf(it: MarkerItem, pl: MarkerPlacement, fabric: FabricSpec): Placed {
  if (cacheFabric !== fabric || cacheItems !== riscoItems()) {
    placedCache = new WeakMap();
    pairCache = new WeakMap();
    cacheFabric = fabric;
    cacheItems = riscoItems();
  }
  let p = placedCache.get(pl);
  if (!p) {
    const poly = placedPolygon(it, pl, fabric);
    p = { poly, bb: bboxOfPoints(poly) };
    placedCache.set(pl, p);
  }
  return p;
}

/** Sobreposições, recalculando só os pares que mudaram (arrastar um molde confere só ele). */
function overlapsMemo(items: MarkerItem[], placements: MarkerPlacement[], fabric: FabricSpec): Set<string> {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const list = placements.filter((p) => byKey.has(p.key)).map((pl) => ({ pl, ...placedOf(byKey.get(pl.key)!, pl, fabric) }));
  const bad = new Set<string>();
  const top = fabric.widthMm - fabric.edgeMarginMm + 1e-6;
  for (const a of list) if (a.bb.minY < fabric.edgeMarginMm - 1e-6 || a.bb.maxY > top || a.bb.minX < -1e-6) bad.add(a.pl.key);
  const sorted = [...list].sort((a, b) => a.bb.minX - b.bb.minX);
  for (let i = 0; i < sorted.length; i++) {
    const A = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const B = sorted[j]!;
      if (B.bb.minX > A.bb.maxX) break; // varredura: os próximos estão mais à direita
      if (A.bb.maxY < B.bb.minY || B.bb.maxY < A.bb.minY) continue;
      let m = pairCache.get(A.pl);
      if (!m) pairCache.set(A.pl, (m = new WeakMap()));
      let hit = m.get(B.pl);
      if (hit === undefined) {
        hit = polygonsOverlap(A.poly, B.poly);
        m.set(B.pl, hit);
      }
      if (hit) {
        bad.add(A.pl.key);
        bad.add(B.pl.key);
      }
    }
  }
  return bad;
}

let statsMemo: { items: MarkerItem[]; placements: MarkerPlacement[]; fabric: FabricSpec; running: boolean; r: { items: MarkerItem[]; stats: ReturnType<typeof markerStats>; overlaps: Set<string> } } | null = null;

export function riscoStats() {
  const st = risco.get();
  const items = riscoItems();
  if (statsMemo && statsMemo.items === items && statsMemo.placements === st.placements && statsMemo.fabric === st.fabric && statsMemo.running === st.running) return statsMemo.r;
  // durante o encaixe automático os moldes nunca se sobrepõem: confere só no fim
  const overlaps = st.running ? new Set<string>() : overlapsMemo(items, st.placements, st.fabric);
  const r = { items, stats: markerStats(items, st.placements, st.fabric), overlaps };
  statsMemo = { items, placements: st.placements, fabric: st.fabric, running: st.running, r };
  return r;
}

/** Peças de roupa por risco (soma do pedido). */
export function garmentsPerMarker(): number {
  const doc = editor.get().doc;
  return Object.values(effectiveOrder(doc.pieces, risco.get().order)).reduce((a, b) => a + b, 0);
}

/* ------------------------------------------------------------------ */
/* Persistência no documento                                           */
/* ------------------------------------------------------------------ */

function save() {
  const st = risco.get();
  const doc = editor.get().doc;
  const m: MarkerDoc = {
    name: 'Risco 1',
    fabric: st.fabric,
    spread: st.spread,
    order: st.order,
    pieceIds: doc.pieces.filter((p) => !st.excluded[p.id]).map((p) => p.id),
    placements: st.placements,
    sublimation: st.sublim,
  };
  editor.set({ doc: { ...doc, markers: [m] }, dirty: true });
}

/** Carrega o risco salvo no arquivo (ou começa um novo). */
export function loadRiscoFrom(doc: PatternDocument) {
  const m = doc.markers?.[0];
  memo = null;
  if (!m) {
    risco.set({ placements: [], excluded: {}, order: {}, selected: null, sublim: { ...DEFAULT_SUBLIMATION } });
    return;
  }
  const excluded = Object.fromEntries(doc.pieces.filter((p) => !m.pieceIds.includes(p.id)).map((p) => [p.id, true]));
  risco.set({ fabric: { ...DEFAULT_FABRIC, ...m.fabric }, spread: m.spread, order: m.order, excluded, placements: m.placements, selected: null, sublim: { ...DEFAULT_SUBLIMATION, ...m.sublimation } });
}

/** Mudanças que alteram a lista de moldes invalidam as posições. */
export function setRisco(patch: Partial<RiscoState>, resetPlacements = false) {
  risco.set({ ...patch, ...(resetPlacements ? { placements: [], selected: null } : {}) });
  save();
}

/* ------------------------------------------------------------------ */
/* Ações                                                               */
/* ------------------------------------------------------------------ */

let stopFlag = false;

function finish(placements: MarkerPlacement[], unplaced: string[], label: string) {
  risco.set({ placements, running: false, progress: '' });
  save();
  const { stats } = riscoStats();
  notify(`${label}: ${(stats.lengthMm / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} m · aproveitamento ${(stats.efficiency * 100).toFixed(1)}%${unplaced.length ? ` · ${unplaced.length} molde(s) não couberam no tecido (largura${risco.get().fabric.maxLengthMm ? ' / comprimento máximo' : ''}) — ficaram na faixa "Fora do risco"` : ''}`, unplaced.length ? 'error' : 'info');
}

let worker: Worker | null = null;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
let lastBest: { placements: MarkerPlacement[]; unplaced: string[] } | null = null;
let lastIter = 0;

const fmtM = (mm: number) => (mm / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/**
 * Encaixe automático em processo separado (a tela não trava): avalia as estratégias clássicas
 * e depois otimiza até acabar o tempo. "Parar" mantém o melhor risco encontrado até ali.
 */
export function runNest(seconds: number) {
  const items = riscoItems();
  if (!items.length) return notify('Nenhum molde no pedido — confira os moldes e as quantidades', 'error');
  const fabric = risco.get().fabric;
  const usable = fabric.widthMm - 2 * fabric.edgeMarginMm;
  if (usable <= 0) return notify('A largura útil do tecido ficou zero ou negativa — confira largura e margem da ourela', 'error');
  worker?.terminate();
  lastBest = null;
  lastIter = 0;
  const label = seconds > 3 ? 'Otimizado' : 'Encaixe automático';
  const t0 = performance.now();
  risco.set({ running: true, progress: `Encaixando ${items.length} moldes…` });
  try {
    worker = new NestWorker();
  } catch (err) {
    risco.set({ running: false, progress: '' });
    return notify(`Não foi possível iniciar o encaixe: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
  const w = worker;
  w.onmessage = (e: MessageEvent<NestReply>) => {
    const m = e.data;
    if (m.type === 'error') {
      w.terminate();
      worker = null;
      risco.set({ running: false, progress: '' });
      notify(`O encaixe falhou: ${m.message}`, 'error');
      return;
    }
    lastBest = m.best;
    lastIter = m.iter;
    if (m.type === 'progress') {
      const left = Math.max(0, Math.ceil(seconds - (performance.now() - t0) / 1000));
      risco.set({ placements: m.best.placements, progress: `${m.iter} tentativas · melhor ${fmtM(m.best.length)} m · ${left} s` });
      return;
    }
    clearTimeout(stopTimer);
    w.terminate();
    worker = null;
    finish(m.best.placements, m.best.unplaced, `${label} (${m.iter} tentativas)`);
  };
  w.onerror = (ev) => {
    w.terminate();
    worker = null;
    risco.set({ running: false, progress: '' });
    notify(`O encaixe falhou: ${ev.message || 'erro desconhecido'}`, 'error');
  };
  w.postMessage({ type: 'start', items, fabric, seconds, seed: Date.now() & 0xffff });
}

export function stopNest() {
  if (!worker) return;
  worker.postMessage({ type: 'stop' });
  // se o processo não responder em 1,5 s, encerra e fica com o melhor já recebido
  const w = worker;
  stopTimer = setTimeout(() => {
    if (worker !== w) return;
    w.terminate();
    worker = null;
    if (lastBest) finish(lastBest.placements, lastBest.unplaced, `Parado (${lastIter} tentativas)`);
    else risco.set({ running: false, progress: '' });
  }, 1500);
}

/** Encaixa os moldes que estão fora do risco, sem mexer nos que já estão posicionados. */
export function fillRemaining() {
  const st = risco.get();
  const items = riscoItems();
  const placed = new Set(st.placements.map((p) => p.key));
  const rest = items.filter((i) => !placed.has(i.key)).sort((a, b) => b.area - a.area).map((i) => i.key);
  if (!rest.length) return notify('Todos os moldes já estão no risco');
  const res = nest(items, st.fabric, { fixed: st.placements, order: rest });
  finish(res.placements, res.unplaced, 'Restantes encaixados');
}

/** Compacta: reencaixa na ordem atual (da esquerda para a direita). */
export function compact() {
  const st = risco.get();
  const items = riscoItems();
  const order = [...st.placements].sort((a, b) => a.x - b.x || a.y - b.y).map((p) => p.key);
  const res = nest(items, st.fabric, { order });
  finish(res.placements, res.unplaced, 'Risco compactado');
}

export function clearMarker() {
  setRisco({ placements: [], selected: null });
}

export function movePlacement(key: string, x: number, y: number, persist: boolean) {
  risco.set((s) => ({ placements: s.placements.map((p) => (p.key === key ? { ...p, x, y } : p)) }));
  if (persist) save();
}

export function rotateSelected() {
  const st = risco.get();
  const pl = st.placements.find((p) => p.key === st.selected);
  const it = riscoItems().find((i) => i.key === st.selected);
  if (!pl || !it) return;
  if (st.fabric.rotation === 'fixo') return notify('Rotação bloqueada: o tecido tem sentido (configuração "Rotação: fixa")', 'error');
  const step = st.fabric.rotation === '90' ? 90 : 180;
  const rot = ((pl.rot + step) % 360) as MarkerPlacement['rot'];
  const a = shapeOf(it, pl.rot), b = shapeOf(it, rot);
  // gira em torno do centro
  const x = pl.x + a.w / 2 - b.w / 2;
  const y = pl.y + a.h / 2 - b.h / 2;
  risco.set({ placements: st.placements.map((p) => (p.key === pl.key ? { ...p, rot, x, y } : p)) });
  save();
}

export function unplaceSelected() {
  const st = risco.get();
  if (!st.selected) return;
  risco.set({ placements: st.placements.filter((p) => p.key !== st.selected), selected: null });
  save();
}

/* ------------------------------------------------------------------ */
/* Estampas no risco                                                   */
/* ------------------------------------------------------------------ */

let printKey: unknown[] = [];
let printCache = new WeakMap<MarkerPlacement, PrintInstance[]>();

/** Artes de um molde posicionado (memorizado por posição; arrastar recalcula só ele). */
export function printsOfPlacement(pl: MarkerPlacement): PrintInstance[] {
  const st = risco.get();
  const doc = editor.get().doc;
  const items = riscoItems();
  const key = [doc.pieces, doc.artworks, st.fabric, items];
  if (key.some((k, i) => k !== printKey[i])) {
    printKey = key;
    printCache = new WeakMap();
  }
  let inst = printCache.get(pl);
  if (!inst) {
    inst = doc.artworks?.length ? markerPrints(includedPieces(doc, st), items, [pl], st.fabric, doc.artworks) : [];
    printCache.set(pl, inst);
  }
  return inst;
}

export function setSublim(patch: Partial<SublimationSpec>) {
  risco.set({ sublim: { ...risco.get().sublim, ...patch } });
  save();
}

/** Arquivo para a gráfica de sublimação: o risco estampado em TIFF (pixels) ou PDF, tamanho real. */
export async function exportForPrintShop() {
  const st = risco.get();
  const doc = editor.get().doc;
  const items = riscoItems();
  if (!st.placements.length) return notify('O risco está vazio — rode o encaixe automático', 'error');
  const prints = markerPrints(includedPieces(doc, st), items, st.placements, st.fabric, doc.artworks ?? []);
  if (!prints.length) return notify('Nenhum molde do risco tem estampa — coloque a arte na aba Modelagem (painel Estampas)', 'error');
  const base = editor.get().file.name.replace(/\.[^.]+$/, '');
  const sb = st.sublim;
  const job = markerJob(includedPieces(doc, st), items, st.placements, st.fabric);
  const opts = { title: `${base} — sublimação`, shrinkXPct: sb.shrinkXPct, shrinkYPct: sb.shrinkYPct, outlines: sb.outlines, mirror: !!sb.mirror };
  const { wMm, hMm } = printLayout(job, opts);
  const size = `${(wMm / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} × ${(hMm / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} m`;
  try {
    const used = new Set(prints.map((p) => p.artId));
    const arts = (doc.artworks ?? []).filter((a) => used.has(a.id));
    let data: Uint8Array;
    let ext: 'tif' | 'pdf';
    let detail: string;
    if ((sb.format ?? 'tiff') === 'tiff') {
      const dpi = sb.dpi ?? 150;
      const px = tiffSize(job, { ...opts, dpi });
      risco.set({ progress: 'Gerando TIFF… 0%' });
      notify(`Gerando TIFF ${px.wPx} × ${px.hPx} px…`);
      let last = 0;
      data = await renderTiff(job, prints, arts, { ...opts, dpi }, (f) => {
        if (f - last >= 0.05 || f === 1) {
          last = f;
          risco.set({ progress: `Gerando TIFF… ${Math.round(f * 100)}%` });
        }
      });
      risco.set({ progress: '' });
      ext = 'tif';
      detail = `${dpi} dpi · ${px.wPx} × ${px.hPx} px`;
    } else {
      notify('Preparando as imagens para o PDF…');
      data = exportPdfPrint(job, prints, await pdfImages(arts), opts);
      ext = 'pdf';
      detail = hMm > PDF_MAX_PAGE_MM || wMm > PDF_MAX_PAGE_MM ? 'página única com UserUnit (confira 1:1 no RIP)' : 'página única 1:1';
    }
    const r = await platform.exportFile(data, `${base}-grafica.${ext}`, ext === 'tif' ? 'TIFF para sublimação' : 'PDF para sublimação', ext);
    if (r) notify(`Arquivo para gráfica: ${r.name} · ${size} · ${detail}${sb.mirror ? ' · espelhado' : ''}${sb.shrinkXPct || sb.shrinkYPct ? ` · compensação ${sb.shrinkXPct}% × ${sb.shrinkYPct}%` : ''}`);
  } catch (err) {
    risco.set({ progress: '' });
    notify(err instanceof Error ? err.message : String(err), 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Exportação                                                          */
/* ------------------------------------------------------------------ */

export async function exportMarker(kind: 'plt' | 'pdf') {
  const st = risco.get();
  const doc = editor.get().doc;
  const items = riscoItems();
  if (!st.placements.length) return notify('O risco está vazio — rode o encaixe automático', 'error');
  const job = markerJob(includedPieces(doc, st), items, st.placements, st.fabric);
  const base = editor.get().file.name.replace(/\.[^.]+$/, '');
  try {
    const r =
      kind === 'plt'
        ? await platform.exportFile(exportHpgl(job), `${base}-risco.plt`, 'Plotter HPGL (.plt)', 'plt')
        : riscoStats().stats.lengthMm + 20 > PDF_MAX_PAGE_MM
          ? await platform.exportFile(exportPdfTiled(job, { paper: 'A3', orientation: 'paisagem', title: `${base} — risco` }), `${base}-risco-A3.pdf`, 'PDF em folhas A3 (escala 1:1)', 'pdf')
          : await platform.exportFile(exportPdf(job, { title: `${base} — risco` }), `${base}-risco.pdf`, 'PDF em escala 1:1', 'pdf');
    if (r) notify(`Risco exportado: ${r.name}`);
  } catch (err) {
    notify(err instanceof Error ? err.message : String(err), 'error');
  }
}
