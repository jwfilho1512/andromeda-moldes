import { useEffect, useRef } from 'react';
import {
  type EdgeHit,
  type PatternDocument,
  type Piece,
  type Vec2,
  bboxOfPoints,
  closestOnPath,
  convertVertex,
  createDart,
  cutPiece,
  dartGeometry,
  dist,
  edgeControls,
  edgeCount,
  edgeSeam,
  foldPiece,
  insertPieceVertex,
  joinPieces,
  moveHandleSmooth,
  moveVertex,
  pathThroughPoints,
  polyline,
  rect,
  removePieceVertex,
  spreadParallel,
  spreadRadial,
  toggleCurve,
  transferDart,
  translatePiece,
  unfoldPiece,
  unionBBox,
  vertices,
  type WalkPath,
  decompose,
  mapPiece,
  pointAt,
  projectOnPath,
  walkPath,
  walkReport,
  walkTransform,
  edgeLength,
  notchAtDistance,
  notchesDividing,
  paramAtDistance,
  parallelContour,
  parallelToEdge,
  parallelToPolyline,
  pointAtDistance,
  pointOnEdge,
  pointsDividing,
  flattenPath,
  segmentIntersection,
  printInstances,
  fabricAxes,
  printFrame,
  applyPrintFrame,
  type PrintFrame,
  type PiecePrint,
} from '@cad-textil/core';
import { smartSnap } from './snapEngine';
import { type Overlay, type View, pieceGeom, pointInPolygon, render, setCanvasTheme, toScreen, toWorld } from './render';
import { type Tool, commit, commitPiece, coordStore, editor, fmtLenU, endLive, liveUpdate, newId, notify, replacePieces, select, selectMany, selectedIds, selectedPiece, toggleSelected, viewInfo, walkStore, withHem } from './store';
import { addPieceFromOutline, deleteSelection, nudge, setTool } from './actions';
import { RULER } from './render';
import { getPxPerMm } from './calibration';
import { TOOLS } from './tools';
import { runCommand } from '../commands';
import { onArtLoaded } from '../estampa/images';
import { addPrint, importArtwork } from '../estampa/actions';
import { type HandleId, frameCenter, frameHandles, resizeCursor, rotateFrame, scaleFrame } from '../estampa/handles';
import { platform } from '../platform';
import { CoordPopup } from './CoordPopup';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { kind: 'piece'; id: string; start: Vec2; base: PatternDocument; orig: Piece }
  | { kind: 'vertex'; id: string; index: number; base: PatternDocument; orig: Piece }
  | { kind: 'handle'; id: string; edge: number; which: 'c1' | 'c2'; base: PatternDocument; orig: Piece }
  | { kind: 'grain'; id: string; end: 0 | 1; base: PatternDocument; orig: Piece }
  | { kind: 'convert'; id: string; index: number; base: PatternDocument; orig: Piece; start: Vec2; moved: boolean }
  | { kind: 'rect'; a: Vec2 }
  | { kind: 'measure'; a: Vec2 }
  | { kind: 'guide'; axis: 'x' | 'y'; from: number | null }
  | { kind: 'group'; ids: string[]; start: Vec2; base: PatternDocument; origs: Map<string, Piece> }
  | { kind: 'marquee'; a: Vec2; add: boolean }
  | { kind: 'print'; id: string; printId: string; start: Vec2; base: PatternDocument; orig: Piece }
  | { kind: 'printFrame'; id: string; pr0: PiecePrint; handle: HandleId; f0: PrintFrame; size: string; start: Vec2; base: PatternDocument; orig: Piece };

interface OutlineHit extends EdgeHit {
  piece: Piece;
  point: Vec2;
  distance: number;
}

/** Ferramentas de vários cliques em andamento. */
interface Pick {
  tool: Tool;
  pieceId?: string;
  hits: OutlineHit[];
  dartIndex?: number;
}

/** Comandos de vista e de desenho acessíveis de fora do canvas (menu, painéis, janela de coordenadas). */
export const canvasApi = {
  fit: () => {},
  realSize: () => {},
  center: (): Vec2 => ({ x: 0, y: 0 }),
  /** Último ponto do desenho em andamento (caneta/curvatura/linha interna). */
  lastPenPoint: (): Vec2 | null => null,
  /** Acrescenta um ponto exato ao desenho em andamento (janela de coordenadas). */
  addPenPoint: (_p: Vec2) => {},
  finishPen: () => {},
  /** Andar molde: ações da barra de controle. */
  walkMarkNotch: () => {},
  walkFix: () => {},
  walkExit: () => {},
  /** Converte mm do molde para pixel da página (testes automatizados). */
  toPage: (_p: Vec2): Vec2 => ({ x: 0, y: 0 }),
  /** Converte mm do molde para pixel dentro da área do desenho (janelas flutuantes). */
  toLocal: (_p: Vec2): Vec2 => ({ x: 0, y: 0 }),
  /** Tamanho da área do desenho (px). */
  viewSize: (): { w: number; h: number } => ({ w: 0, h: 0 }),
};

const HIT_PX = 7;
const SNAP_PX = 9;
const MIN_Z = 0.02;
const MAX_Z = 400;
const PEN_TOOLS = new Set<Tool>(['pen', 'curve', 'internal']);
const EDGE_TOOLS = new Set<Tool>(['parallel', 'seam', 'walk', 'addPoint', 'dart', 'cut', 'join', 'fold', 'unfold', 'pleat', 'spread', 'spreadRadial', 'notch', 'dartTransfer']);
const TWO_POINT_TOOLS = new Set<Tool>(['cut', 'fold', 'pleat', 'spread', 'spreadRadial']);

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable]');

/** Restringe o ponto a ângulos de 45° em relação a `from`, mantendo a distância. */
function constrain45(from: Vec2, p: Vec2): Vec2 {
  const d = dist(from, p);
  const a = Math.round(Math.atan2(p.y - from.y, p.x - from.x) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: from.x + Math.round(Math.cos(a) * d * 1e9) / 1e9, y: from.y + Math.round(Math.sin(a) * d * 1e9) / 1e9 };
}

function segDist(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** O polígono encosta na caixa (algum ponto dentro, algum canto da caixa dentro, ou bordas que se cruzam)? */
function polyTouchesBox(poly: Vec2[], b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  if (poly.some((p) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY)) return true;
  const corners = [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }];
  if (corners.some((c) => pointInPolygon(c, poly))) return true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, c = poly[(i + 1) % poly.length]!;
    for (let k = 0; k < 4; k++) if (segmentIntersection(a, c, corners[k]!, corners[(k + 1) % 4]!)) return true;
  }
  return false;
}

export function Canvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const view: View = { cx: 400, cy: 300, z: 1, w: 0, h: 0 };
    const overlay: Overlay = {
      penPoints: [], penCorners: [], penMode: 'pen', penClosed: true, walk: null, snapKind: null, snapLines: [], guideDrag: null, preview: null, marks: [],
      pick: null, hoverEdge: null, cursor: null, snapMark: null, rect: null, measure: null, marquee: null,
    };
    let drag: Drag | null = null;
    let pick: Pick | null = null;
    let spaceDown = false;
    let frame = 0;
    let fitted = false;
    setCanvasTheme(editor.get().theme);

    const draw = () => {
      frame = 0;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render(ctx, view, editor.get(), overlay);
    };
    const invalidate = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const setZoom = (z: number) => {
      view.z = Math.min(MAX_Z, Math.max(MIN_Z, z));
      viewInfo.set({ pxPerMm: view.z });
    };
    const fail = (err: unknown) => notify(err instanceof Error ? err.message : String(err), 'error');

    /* ---------------- vista ---------------- */
    canvasApi.fit = () => {
      const s = editor.get();
      const pieces = s.doc.pieces.filter((p) => !s.hidden[p.id]);
      const bb = pieces.length ? pieces.map((p) => bboxOfPoints(pieceGeom(p).cut)).reduce(unionBBox) : { minX: 0, minY: 0, maxX: 1000, maxY: 600 };
      const bw = Math.max(bb.maxX - bb.minX, 50);
      const bh = Math.max(bb.maxY - bb.minY, 50);
      setZoom(Math.min((view.w - 80) / bw, (view.h - 80) / bh));
      view.cx = (bb.minX + bb.maxX) / 2;
      view.cy = (bb.minY + bb.maxY) / 2;
      invalidate();
    };
    canvasApi.realSize = () => {
      setZoom(getPxPerMm());
      invalidate();
    };
    canvasApi.center = () => ({ x: view.cx, y: view.cy });
    canvasApi.toLocal = (p: Vec2) => toScreen(view, p);
    canvasApi.viewSize = () => ({ w: view.w, h: view.h });
    canvasApi.toPage = (p: Vec2) => {
      const r = canvas.getBoundingClientRect();
      const sp = toScreen(view, p);
      return { x: r.left + sp.x, y: r.top + sp.y };
    };

    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      view.w = r.width;
      view.h = r.height;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      if (!fitted && r.width > 0) {
        fitted = true;
        canvasApi.fit();
      }
      draw();
    });
    ro.observe(canvas);

    /* ---------------- consultas ---------------- */
    const usable = () => {
      const s = editor.get();
      const list = s.doc.pieces.filter((p) => !s.hidden[p.id] && !s.locked[p.id]);
      const sel = list.find((p) => p.id === s.selection.pieceId);
      return sel ? [sel, ...list.filter((p) => p !== sel).reverse()] : [...list].reverse();
    };

    /** Ímã inteligente (ponto, meio, interseção, perpendicular, borda, alinhamento, guias, grade). */
    const snap = (w: Vec2, exclude?: { id: string; index: number }): { p: Vec2; mark: Vec2 | null } => {
      const s = editor.get();
      const doc = drag && 'base' in drag ? drag.base : s.doc; // durante arrastes, usa o desenho do início
      const anchor = overlay.penPoints[overlay.penPoints.length - 1] ?? (drag && (drag.kind === 'measure' || drag.kind === 'rect') ? drag.a : null);
      const r = smartSnap(w, {
        doc,
        hidden: s.hidden,
        opts: s.snap,
        gridMm: s.snapMm,
        tol: SNAP_PX / view.z,
        anchor,
        exclude: exclude ? { pieceId: exclude.id, vertex: exclude.index } : undefined,
      });
      overlay.snapKind = r.kind;
      overlay.snapLines = r.lines;
      return { p: r.p, mark: r.mark };
    };

    const hitVertex = (w: Vec2, onlyId?: string): { piece: Piece; index: number } | null => {
      const tol = (HIT_PX + 1) / view.z;
      for (const p of usable()) {
        if (onlyId && p.id !== onlyId) continue;
        const i = vertices(p.outline).findIndex((q) => dist(q, w) <= tol);
        if (i >= 0) return { piece: p, index: i };
      }
      return null;
    };

    const hitOutline = (w: Vec2, onlyId?: string, extraMm = 0, excludeId?: string): OutlineHit | null => {
      let best: OutlineHit | null = null;
      for (const p of usable()) {
        if (onlyId && p.id !== onlyId) continue;
        if (excludeId && p.id === excludeId) continue;
        const h = closestOnPath(p.outline, w);
        const tol = HIT_PX / view.z + extraMm;
        if (h.distance <= tol && (!best || h.distance < best.distance)) best = { piece: p, edge: h.edge, t: h.t, point: h.point, distance: h.distance };
      }
      return best;
    };

    /** Ponto sobre o contorno; perto de um vértice, usa o vértice exato. */
    const pickOnOutline = (w: Vec2, onlyId?: string): OutlineHit | null => {
      const v = hitVertex(w, onlyId);
      if (v) return { piece: v.piece, edge: v.index, t: 0, point: vertices(v.piece.outline)[v.index]!, distance: 0 };
      return hitOutline(w, onlyId);
    };

    const hitDart = (w: Vec2): { piece: Piece; index: number } | null => {
      const tol = HIT_PX / view.z;
      for (const p of usable()) {
        const i = (p.darts ?? []).findIndex((d) => {
          const g = dartGeometry(p, d);
          return segDist(w, g.legA, g.apex) <= tol || segDist(w, g.apex, g.legB) <= tol;
        });
        if (i >= 0) return { piece: p, index: i };
      }
      return null;
    };

    const local = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const replacePiece = (base: PatternDocument, id: string, piece: Piece) =>
      liveUpdate({ ...base, pieces: base.pieces.map((p) => (p.id === id ? piece : p)) });

    const resetPick = () => {
      pick = null;
      overlay.pick = null;
    };

    /* ---------------- andar molde ---------------- */
    let walk: { aId: string; bId: string; A: WalkPath; B: WalkPath; s: number; frozen: boolean; maxS: number } | null = null;

    /** Vértice inicial e sentido a partir do clique numa borda (ponta mais próxima do clique). */
    const walkStartOf = (h: OutlineHit): { start: number; dir: 1 | -1 } => {
      const d = decompose(h.piece.outline);
      const n = d.verts.length;
      const a = d.verts[h.edge]!, b = d.verts[(h.edge + 1) % n]!;
      return dist(h.point, a) <= dist(h.point, b) ? { start: h.edge, dir: 1 } : { start: (h.edge + 1) % n, dir: -1 };
    };

    const walkUpdate = () => {
      if (!walk) {
        overlay.walk = null;
        walkStore.set({ info: null });
        return;
      }
      const doc = editor.get().doc;
      const pa = doc.pieces.find((p) => p.id === walk!.aId);
      const pb = doc.pieces.find((p) => p.id === walk!.bId);
      if (!pa || !pb) return walkExit();
      const { f, mirrored } = walkTransform(walk.A, walk.B, walk.s);
      const moved = mapPiece(pb, f);
      const traveled: Vec2[] = [];
      for (let i = 0; i < walk.A.points.length && walk.A.cum[i]! <= walk.s; i++) traveled.push(walk.A.points[i]!);
      traveled.push(pointAt(walk.A, walk.s).p);
      overlay.walk = { piece: moved, hideId: pb.id, traveled, contact: pointAt(walk.A, walk.s).p };
      const r = walkReport(pa, walk.A, pb, walk.B, walk.s);
      walkStore.set({ info: { aName: pa.name, bName: pb.name, frozen: walk.frozen, mirrored, ...r } });
    };

    const walkExit = () => {
      walk = null;
      overlay.walk = null;
      walkStore.set({ info: null });
      invalidate();
    };
    canvasApi.walkExit = walkExit;

    canvasApi.walkMarkNotch = () => {
      if (!walk) return;
      const doc = editor.get().doc;
      const onA = pointAt(walk.A, walk.s).p;
      const onB = pointAt(walk.B, walk.s).p;
      const addNotch = (p: Piece, at: Vec2) => {
        const h = closestOnPath(p.outline, at);
        return { ...p, notches: [...p.notches, { edge: h.edge, t: h.t, depthMm: editor.get().opts.notchDepth }] };
      };
      commit({ ...doc, pieces: doc.pieces.map((p) => (p.id === walk!.aId ? addNotch(p, onA) : p.id === walk!.bId ? addNotch(p, onB) : p)) });
      const a = doc.pieces.find((p) => p.id === walk!.aId)!;
      const b = doc.pieces.find((p) => p.id === walk!.bId)!;
      walk.A = walkPath(editor.get().doc.pieces.find((p) => p.id === a.id)!, walk.A.start, walk.A.dir);
      walk.B = walkPath(editor.get().doc.pieces.find((p) => p.id === b.id)!, walk.B.start, walk.B.dir);
      notify(`Pique marcado nos dois moldes a ${fmtLenU(walk.s)} do início`);
      walkUpdate();
      invalidate();
    };

    canvasApi.walkFix = () => {
      if (!walk) return;
      const { f } = walkTransform(walk.A, walk.B, walk.s);
      const id = walk.bId;
      walkExit();
      commitPiece(id, (p) => mapPiece(p, f), { pieceId: id, vertex: null, edge: null });
      notify('Molde fixado na posição encostada');
    };

    const walkSet = (s: number) => {
      if (!walk) return;
      walk.s = Math.max(0, Math.min(walk.maxS, s));
      walkUpdate();
      invalidate();
    };

    /* ---------------- caneta / curvatura / linha interna ---------------- */
    const finishPen = () => {
      const pts = overlay.penPoints;
      const mode = overlay.penMode;
      try {
        if (mode !== 'internal') {
          if (pts.length < 3) {
            notify('Um molde precisa de pelo menos 3 pontos', 'error');
            return;
          }
          const outline = mode === 'curve' ? pathThroughPoints(pts.map((p, i) => ({ p, corner: overlay.penCorners[i] })), true) : polyline(pts, true);
          const piece = addPieceFromOutline(outline);
          notify(`${piece.name} criado sem margem — aplique a margem nas bordas com a ferramenta Margem de costura (S)`);
          setTool('select');
        } else {
          const sel = selectedPiece();
          if (pts.length >= 2 && sel) commitPiece(sel.id, (p) => ({ ...p, internals: [...p.internals, polyline(pts, false)] }));
        }
      } catch (err) {
        fail(err);
      }
      overlay.penPoints = [];
      overlay.penCorners = [];
      overlay.cursor = null;
      invalidate();
    };
    canvasApi.finishPen = finishPen;
    canvasApi.lastPenPoint = () => overlay.penPoints[overlay.penPoints.length - 1] ?? null;
    canvasApi.addPenPoint = (p: Vec2) => {
      const tool = editor.get().tool;
      if (!PEN_TOOLS.has(tool)) return;
      overlay.penMode = tool as Overlay['penMode'];
      overlay.penClosed = tool !== 'internal';
      overlay.penPoints.push(p);
      overlay.penCorners.push(false);
      invalidate();
    };

    const penClick = (w: Vec2, shift: boolean, alt: boolean) => {
      const tool = editor.get().tool;
      const closed = tool !== 'internal';
      if (!closed && !selectedPiece()) {
        notify('Selecione um molde (ferramenta Seleção) antes de desenhar a linha interna', 'error');
        return;
      }
      const pts = overlay.penPoints;
      let p = snap(w).p;
      const last = pts[pts.length - 1];
      if (shift && last) p = constrain45(last, p);
      const first = pts[0];
      if (closed && pts.length >= 3 && first && dist(toScreen(view, p), toScreen(view, first)) <= 10) {
        finishPen();
        return;
      }
      if (last && dist(p, last) < 1e-6) return;
      overlay.penMode = tool as Overlay['penMode'];
      overlay.penClosed = closed;
      pts.push(p);
      overlay.penCorners.push(tool === 'curve' ? alt : true);
    };

    /** Paralela à borda ou linha interna mais próxima do cursor (do lado do cursor). */
    const parallelAt = (w: Vec2): { pieceId: string; path: import('@cad-textil/core').Path } | null => {
      const d = editor.get().opts.parallelMm;
      const tol = HIT_PX / view.z;
      let best: { pieceId: string; dist: number; make: () => import('@cad-textil/core').Path } | null = null;
      for (const p of usable()) {
        const h = closestOnPath(p.outline, w);
        if (h.distance <= tol && (!best || h.distance < best.dist)) best = { pieceId: p.id, dist: h.distance, make: () => parallelToEdge(p.outline, h.edge, d, w) };
        for (const path of p.internals) {
          const pts = flattenPath(path, 0.05);
          let dd = Infinity;
          for (let i = 0; i + 1 < pts.length; i++) {
            const a = pts[i]!, b = pts[i + 1]!;
            const ab = { x: b.x - a.x, y: b.y - a.y };
            const t = Math.max(0, Math.min(1, ((w.x - a.x) * ab.x + (w.y - a.y) * ab.y) / (ab.x * ab.x + ab.y * ab.y || 1)));
            dd = Math.min(dd, dist(w, { x: a.x + ab.x * t, y: a.y + ab.y * t }));
          }
          if (dd <= tol && (!best || dd < best.dist)) best = { pieceId: p.id, dist: dd, make: () => parallelToPolyline(pts, d, w) };
        }
      }
      return best ? { pieceId: best.pieceId, path: best.make() } : null;
    };

    /* ---------------- ferramentas de modelagem ---------------- */
    const opts = () => editor.get().opts;

    const applyTwoPoint = (tool: Tool, piece: Piece, a: OutlineHit, b: OutlineHit, keep?: Vec2) => {
      try {
        if (tool === 'cut') {
          const [p1, p2] = cutPiece(piece, a, b, opts().cutSeam);
          replacePieces([piece.id], [{ ...p1, id: newId() }, { ...p2, id: newId() }]);
          notify(`${piece.name} cortado em duas partes (margem de ${fmtLenU(opts().cutSeam)} no corte)`);
        } else if (tool === 'fold') {
          commitPiece(piece.id, (p) => foldPiece(p, a, b, keep));
          notify('Molde dobrado — a linha de dobra ficou sem margem');
        } else if (tool === 'pleat') {
          commitPiece(piece.id, (p) => spreadParallel(p, a, b, opts().pleatDepth * 2, true));
          notify(`Prega de ${fmtLenU(opts().pleatDepth)} de profundidade (abertura ${fmtLenU(opts().pleatDepth * 2)})`);
        } else if (tool === 'spread') {
          commitPiece(piece.id, (p) => spreadParallel(p, a, b, opts().spreadMm));
          notify(`Folga de ${fmtLenU(opts().spreadMm)} aberta`);
        } else if (tool === 'spreadRadial') {
          commitPiece(piece.id, (p) => spreadRadial(p, a, b, opts().spreadMm));
          notify(`Folga em leque: ${fmtLenU(opts().spreadMm)} na borda`);
        }
      } catch (err) {
        fail(err);
      }
    };

    const toolClick = (tool: Tool, w: Vec2, alt = false) => {
      // Ferramentas de 2 pontos (+ lado, na dobra)
      if (TWO_POINT_TOOLS.has(tool)) {
        if (tool === 'fold' && pick && pick.hits.length === 2) {
          const piece = editor.get().doc.pieces.find((p) => p.id === pick!.pieceId)!;
          applyTwoPoint(tool, piece, pick.hits[0]!, pick.hits[1]!, w);
          resetPick();
          return;
        }
        const h = pickOnOutline(w, pick?.pieceId);
        if (!h) return notify('Clique sobre a borda de um molde', 'error');
        if (!pick) {
          pick = { tool, pieceId: h.piece.id, hits: [h] };
          select({ pieceId: h.piece.id });
          return;
        }
        pick.hits.push(h);
        if (tool === 'fold') {
          notify('Agora clique na metade do molde que deve ficar');
          return;
        }
        applyTwoPoint(tool, h.piece, pick.hits[0]!, h);
        resetPick();
        return;
      }
      switch (tool) {
        case 'walk': {
          if (walk) {
            walk.frozen = !walk.frozen;
            walkUpdate();
            return;
          }
          const h = hitOutline(w, undefined, 0, pick?.pieceId);
          if (!h) return notify('Clique sobre a costura de um molde, perto do ponto onde a costura começa', 'error');
          if (!pick) {
            pick = { tool, pieceId: h.piece.id, hits: [h] };
            select({ pieceId: h.piece.id, edge: h.edge });
            notify('Agora clique a costura do outro molde, perto do MESMO ponto inicial');
            return;
          }
          const a = pick.hits[0]!;
          const sa = walkStartOf(a);
          const sb = walkStartOf(h);
          const A = walkPath(a.piece, sa.start, sa.dir);
          const B = walkPath(h.piece, sb.start, sb.dir);
          walk = { aId: a.piece.id, bId: h.piece.id, A, B, s: 0, frozen: false, maxS: Math.min(A.total, B.total) };
          resetPick();
          walkUpdate();
          return;
        }
        case 'seam': {
          const h = hitOutline(w, undefined, 3);
          if (!h) return notify('Clique sobre uma borda do molde', 'error');
          const mm = alt ? 0 : opts().seamMm;
          const hem = !alt && opts().seamHem && mm > 0;
          commitPiece(h.piece.id, (p) => withHem({ ...p, seamByEdge: { ...(p.seamByEdge ?? {}), [String(h.edge)]: mm } }, h.edge, hem), { pieceId: h.piece.id, edge: h.edge, vertex: null });
          notify(hem ? `Barra de ${fmtLenU(mm)} com cantos espelhados na borda ${h.edge + 1}` : mm ? `Margem de ${fmtLenU(mm)} na borda ${h.edge + 1}` : `Borda ${h.edge + 1} sem margem`);
          return;
        }
        case 'convert': {
          const v = hitVertex(w);
          if (v) {
            select({ pieceId: v.piece.id, vertex: v.index });
            drag = { kind: 'convert', id: v.piece.id, index: v.index, base: editor.get().doc, orig: v.piece, start: w, moved: false };
          }
          return;
        }
        case 'addPoint': {
          const h = hitOutline(w);
          if (!h) return;
          const o = opts();
          try {
            if (o.measureMode === 'dividir') commitPiece(h.piece.id, (p) => pointsDividing(p, h.edge, o.divideN), { pieceId: h.piece.id, vertex: null, edge: null });
            else if (o.measureMode === 'distancia') {
              const fromEnd = h.t > 0.5;
              commitPiece(h.piece.id, (p) => pointAtDistance(p, h.edge, o.measureDistMm, fromEnd), { pieceId: h.piece.id, vertex: null, edge: null });
              notify(`Ponto a ${fmtLenU(o.measureDistMm)} do canto`);
            } else commitPiece(h.piece.id, (p) => insertPieceVertex(p, h.edge, h.t), { pieceId: h.piece.id, vertex: h.edge + 1, edge: null });
          } catch (err) {
            fail(err);
          }
          return;
        }
        case 'parallel': {
          const o = opts();
          if (alt) {
            const h = hitOutline(w, undefined, 10);
            const pc = h?.piece ?? usable().find((p) => pointInPolygon(w, pieceGeom(p).sew));
            if (!pc) return notify('Clique sobre ou perto de um molde', 'error');
            const inside = pointInPolygon(w, pieceGeom(pc).sew);
            const piece = addPieceFromOutline(parallelContour(pc, inside ? -o.parallelMm : o.parallelMm), `${pc.name} (paralelo ${fmtLenU(o.parallelMm)})`);
            notify(`${piece.name} criado`);
            return;
          }
          const par = parallelAt(w);
          if (!par) return notify('Clique numa borda ou numa linha interna', 'error');
          commitPiece(par.pieceId, (p) => ({ ...p, internals: [...p.internals, par.path] }), { pieceId: par.pieceId, vertex: null, edge: null });
          notify(`Paralela a ${fmtLenU(o.parallelMm)} criada (linha interna)`);
          return;
        }
        case 'removePoint': {
          const v = hitVertex(w);
          if (!v) return;
          if (vertices(v.piece.outline).length <= 3) return notify('Um molde precisa de pelo menos 3 pontos', 'error');
          commitPiece(v.piece.id, (p) => removePieceVertex(p, v.index), { pieceId: v.piece.id, vertex: null, edge: null });
          return;
        }
        case 'dart': {
          if (!pick) {
            const h = pickOnOutline(w);
            if (!h) return notify('Clique na borda onde fica a boca da pence', 'error');
            pick = { tool, pieceId: h.piece.id, hits: [h] };
            select({ pieceId: h.piece.id });
            return;
          }
          const piece = editor.get().doc.pieces.find((p) => p.id === pick!.pieceId)!;
          const apex = snap(w).p;
          try {
            commitPiece(piece.id, (p) => createDart(p, pick!.hits[0]!, apex, opts().dartWidth));
            notify(`Pence de ${fmtLenU(opts().dartWidth)} × ${fmtLenU(dist(apex, pick.hits[0]!.point), 0)} criada`);
          } catch (err) {
            fail(err);
          }
          resetPick();
          return;
        }
        case 'dartTransfer': {
          if (!pick) {
            const d = hitDart(w);
            if (!d) return notify('Clique sobre uma pence (pernas ou ápice)', 'error');
            pick = { tool, pieceId: d.piece.id, dartIndex: d.index, hits: [] };
            select({ pieceId: d.piece.id });
            notify('Agora clique o novo ponto da borda');
            return;
          }
          const h = pickOnOutline(w, pick.pieceId);
          if (!h) return notify('Clique sobre a borda do mesmo molde', 'error');
          try {
            commitPiece(h.piece.id, (p) => transferDart(p, pick!.dartIndex!, h));
            notify('Pence transferida');
          } catch (err) {
            fail(err);
          }
          resetPick();
          return;
        }
        case 'join': {
          // No 2º clique ignora o 1º molde (bordas recém-cortadas ficam sobrepostas).
          const h = hitOutline(w, undefined, 0, pick?.pieceId);
          if (!h) return notify('Clique sobre a borda de um molde', 'error');
          if (!pick) {
            pick = { tool, pieceId: h.piece.id, hits: [h] };
            select({ pieceId: h.piece.id, edge: h.edge });
            notify('Agora clique a borda do outro molde que costura nesta');
            return;
          }
          const a = pick.hits[0]!;
          if (h.piece.id === a.piece.id) return notify('Escolha a borda de OUTRO molde', 'error');
          try {
            const pa = editor.get().doc.pieces.find((p) => p.id === a.piece.id)!;
            const { piece, diffMm } = joinPieces(pa, a.edge, h.piece, h.edge);
            replacePieces([pa.id, h.piece.id], [{ ...piece, id: newId() }]);
            notify(diffMm > 0.5 ? `Moldes unidos — atenção: as bordas diferem ${fmtLenU(diffMm)}` : 'Moldes unidos', diffMm > 0.5 ? 'error' : 'info');
          } catch (err) {
            fail(err);
          }
          resetPick();
          return;
        }
        case 'unfold': {
          const h = hitOutline(w);
          if (!h) return notify('Clique na borda reta da dobra', 'error');
          try {
            commitPiece(h.piece.id, (p) => unfoldPiece(p, h.edge), { pieceId: h.piece.id, vertex: null, edge: null });
            notify('Molde desdobrado');
          } catch (err) {
            fail(err);
          }
          return;
        }
        case 'notch': {
          const order = usable();
          const o = opts();
          for (const p of order) {
            const hit = closestOnPath(p.outline, w);
            if (hit.distance <= edgeSeam(p, hit.edge) + HIT_PX / view.z) {
              try {
                if (o.measureMode === 'dividir') commitPiece(p.id, (q) => notchesDividing(q, hit.edge, o.divideN, o.notchDepth), { pieceId: p.id, vertex: null, edge: null });
                else if (o.measureMode === 'distancia') commitPiece(p.id, (q) => notchAtDistance(q, hit.edge, o.measureDistMm, hit.t > 0.5, o.notchDepth), { pieceId: p.id, vertex: null, edge: null });
                else commitPiece(p.id, (q) => ({ ...q, notches: [...q.notches, { edge: hit.edge, t: hit.t, depthMm: o.notchDepth }] }), { pieceId: p.id, vertex: null, edge: null });
              } catch (err) {
                fail(err);
              }
              return;
            }
          }
          notify('Clique sobre a borda de um molde para marcar o pique', 'error');
          return;
        }
      }
    };

    /* ---------------- seleção ---------------- */
    /** Molde sob o cursor (de cima para baixo), ignorando ocultos e bloqueados. */
    const pieceAt = (w: Vec2): Piece | null => {
      const s = editor.get();
      for (const p of [...s.doc.pieces].reverse()) {
        if (s.hidden[p.id] || s.locked[p.id]) continue;
        if (pointInPolygon(w, pieceGeom(p).cut)) return p;
      }
      return null;
    };

    const startGroupDrag = (w: Vec2) => {
      const s = editor.get();
      const ids = selectedIds(s).filter((id) => !s.locked[id]);
      drag = { kind: 'group', ids, start: w, base: s.doc, origs: new Map(s.doc.pieces.filter((p) => ids.includes(p.id)).map((p) => [p.id, p])) };
    };

    /** Alça (escala/giro) da estampa ativa do molde selecionado sob o ponto. */
    const printHandleAt = (w: Vec2) => {
      const s = editor.get();
      if (s.multi.length > 1) return null;
      const p = s.doc.pieces.find((q) => q.id === s.selection.pieceId);
      const prints = p?.prints ?? [];
      if (!p || !prints.length || s.locked[p.id] || s.hidden[p.id]) return null;
      const pr = prints.find((x) => x.id === s.activePrint) ?? prints[0]!;
      const arts = new Map((s.doc.artworks ?? []).map((a) => [a.id, a]));
      const size = p.grading ? p.grading.sizes[p.grading.base]! : '';
      const f = printFrame(p, pr, size, arts);
      if (!f) return null;
      const tol = (HIT_PX + 2) / view.z;
      const h = frameHandles(f, pr.mode, view.z).find((x) => dist(x.p, w) <= tol);
      return h ? { piece: p, pr, f, size, handle: h.id, p: h.p } : null;
    };

    /** Ferramenta Estampa: arrasta a arte; molde sem estampa → importa a arte no ponto do clique. */
    const printDown = (w: Vec2) => {
      const hh = printHandleAt(w);
      if (hh) {
        editor.set({ activePrint: hh.pr.id });
        drag = { kind: 'printFrame', id: hh.piece.id, pr0: hh.pr, handle: hh.handle, f0: hh.f, size: hh.size, start: w, base: editor.get().doc, orig: hh.piece };
        return;
      }
      const p = pieceAt(w);
      if (!p) {
        select(null);
        return;
      }
      if (editor.get().selection.pieceId !== p.id || editor.get().multi.length > 1) select({ pieceId: p.id });
      const prints = p.prints ?? [];
      if (!prints.length) {
        void (async () => {
          const doc = editor.get().doc;
          const art = doc.artworks?.length ? doc.artworks[doc.artworks.length - 1]! : await importArtwork();
          if (art) addPrint(p.id, 'localizada', art.id, w);
        })();
        return;
      }
      // a localizada sob o cursor tem prioridade; senão a ativa; senão a primeira
      const arts = new Map((editor.get().doc.artworks ?? []).map((a) => [a.id, a]));
      const size = p.grading ? p.grading.sizes[p.grading.base]! : '';
      const hit = prints.find((pr) => {
        if (pr.mode !== 'localizada') return false;
        const one = printInstances({ ...p, prints: [pr] }, size, arts)[0];
        if (!one) return false;
        const [a, b, c, d, e, f] = one.m;
        return pointInPolygon(w, [{ x: e, y: f }, { x: e + a, y: f + b }, { x: e + a + c, y: f + b + d }, { x: e + c, y: f + d }]);
      });
      const pr = hit ?? prints.find((x) => x.id === editor.get().activePrint) ?? prints[0]!;
      editor.set({ activePrint: pr.id });
      drag = { kind: 'print', id: p.id, printId: pr.id, start: w, base: editor.get().doc, orig: p };
    };

    const selectDown = (w: Vec2, alt: boolean, shift: boolean) => {
      const s = editor.get();
      const tol = HIT_PX / view.z;
      // Shift: põe/tira o molde da seleção; no vazio, caixa que soma à seleção
      if (shift) {
        const p = pieceAt(w);
        if (p) toggleSelected(p.id);
        else drag = { kind: 'marquee', a: w, add: true };
        return;
      }
      // Vários selecionados: arrastar qualquer um deles move o grupo
      if (s.multi.length > 1) {
        const p = pieceAt(w);
        if (p && s.multi.includes(p.id)) {
          startGroupDrag(w);
          return;
        }
      }
      const sel = s.multi.length > 1 ? undefined : s.doc.pieces.find((p) => p.id === s.selection.pieceId && !s.hidden[p.id] && !s.locked[p.id]);
      if (sel) {
        for (let i = 0; i < edgeCount(sel.outline); i++) {
          const c = edgeControls(sel.outline, i);
          if (c.kind !== 'cubic') continue;
          for (const which of ['c1', 'c2'] as const) {
            if (dist(c[which], w) <= tol) {
              select({ pieceId: sel.id, edge: i });
              drag = { kind: 'handle', id: sel.id, edge: i, which, base: editor.get().doc, orig: sel };
              return;
            }
          }
        }
        if (sel.grainline) {
          for (const end of [0, 1] as const) {
            if (dist(sel.grainline[end], w) <= tol) {
              drag = { kind: 'grain', id: sel.id, end, base: s.doc, orig: sel };
              return;
            }
          }
        }
        const vi = vertices(sel.outline).findIndex((q) => dist(q, w) <= tol);
        if (vi >= 0) {
          select({ pieceId: sel.id, vertex: vi });
          drag = { kind: 'vertex', id: sel.id, index: vi, base: editor.get().doc, orig: sel };
          return;
        }
        const hit = closestOnPath(sel.outline, w);
        if (hit.distance <= tol) {
          if (alt) {
            commitPiece(sel.id, (p) => insertPieceVertex(p, hit.edge, hit.t), { pieceId: sel.id, vertex: hit.edge + 1, edge: null });
            return;
          }
          select({ pieceId: sel.id, edge: hit.edge });
          drag = { kind: 'piece', id: sel.id, start: w, base: editor.get().doc, orig: sel };
          return;
        }
      }
      for (const p of [...s.doc.pieces].reverse()) {
        if (s.hidden[p.id] || s.locked[p.id]) continue;
        if (pointInPolygon(w, pieceGeom(p).cut)) {
          if (p.id !== s.selection.pieceId || s.selection.vertex !== null || s.selection.edge !== null) select({ pieceId: p.id });
          drag = { kind: 'piece', id: p.id, start: w, base: editor.get().doc, orig: p };
          return;
        }
      }
      // Guias: arrastar para mover; soltar na régua apaga
      const g = s.doc.guides;
      const gt = 5 / view.z;
      const gx = g?.x.find((x) => Math.abs(x - w.x) <= gt);
      const gy = g?.y.find((y) => Math.abs(y - w.y) <= gt);
      if (gx !== undefined) {
        drag = { kind: 'guide', axis: 'x', from: gx };
        return;
      }
      if (gy !== undefined) {
        drag = { kind: 'guide', axis: 'y', from: gy };
        return;
      }
      // Vazio: caixa de seleção (clique simples limpa a seleção ao soltar)
      drag = { kind: 'marquee', a: w, add: false };
    };

    /* ---------------- eventos de ponteiro ---------------- */
    const onDown = (e: PointerEvent) => {
      canvas.focus();
      const sp = local(e);
      const w = toWorld(view, sp.x, sp.y);
      const tool = editor.get().tool;
      // Puxar guia da régua: de cima = guia horizontal; da esquerda = guia vertical.
      if (e.button === 0 && (sp.y <= RULER || sp.x <= RULER) && !(sp.y <= RULER && sp.x <= RULER)) {
        drag = { kind: 'guide', axis: sp.y <= RULER ? 'y' : 'x', from: null };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button === 1 || (e.button === 0 && (spaceDown || tool === 'pan'))) {
        drag = { kind: 'pan', sx: sp.x, sy: sp.y, cx: view.cx, cy: view.cy };
        canvas.style.cursor = 'grabbing';
      } else if (e.button === 0) {
        if (tool === 'select') selectDown(w, e.altKey, e.shiftKey);
        else if (PEN_TOOLS.has(tool)) penClick(w, e.shiftKey, e.altKey);
        else if (tool === 'rect') {
          const a = snap(w).p;
          drag = { kind: 'rect', a };
          overlay.rect = { a, b: a };
        } else if (tool === 'measure') {
          const a = snap(w).p;
          drag = { kind: 'measure', a };
          overlay.measure = { a, b: a };
        } else if (tool === 'print') printDown(w);
        else if (tool === 'coordPoint') {
          // referência: o que o ímã atrair (canto, meio, interseção, ponto); a janela abre ao lado
          const sn = snap(w);
          coordStore.set({ pick: { ref: sn.p, label: overlay.snapKind ?? 'clique livre', dx: 0, dy: 0 } });
          overlay.snapMark = null;
          invalidate();
          return;
        }
        else toolClick(tool, w, e.altKey);
      } else return;
      canvas.setPointerCapture(e.pointerId);
      syncPickOverlay();
      invalidate();
    };

    const syncPickOverlay = () => {
      if (!pick) {
        overlay.pick = null;
        return;
      }
      const pts = pick.hits.map((h) => h.point);
      overlay.pick =
        pick.tool === 'dart'
          ? { points: pts, kind: 'dart', dartWidth: editor.get().opts.dartWidth }
          : pick.tool === 'fold' && pts.length === 2
            ? { points: pts, kind: 'fold-side' }
            : TWO_POINT_TOOLS.has(pick.tool)
              ? { points: pts, kind: 'line' }
              : { points: pts, kind: 'dart-pick' };
    };

    const onMove = (e: PointerEvent) => {
      const sp = local(e);
      const w = toWorld(view, sp.x, sp.y);
      const s = editor.get();
      viewInfo.set({ cursor: w });
      overlay.snapMark = null;
      overlay.snapKind = null;
      overlay.snapLines = [];
      overlay.hoverEdge = null;
      overlay.preview = null;
      overlay.marks = [];
      const free = e.altKey;

      if (drag) {
        switch (drag.kind) {
          case 'guide': {
            const g = s.snapMm > 0 ? s.snapMm : 0.1;
            const val = Math.round((drag.axis === 'x' ? w.x : w.y) / g) * g;
            overlay.guideDrag = { axis: drag.axis, value: val, remove: sp.x <= RULER || sp.y <= RULER };
            break;
          }
          case 'pan':
            view.cx = drag.cx - (sp.x - drag.sx) / view.z;
            view.cy = drag.cy + (sp.y - drag.sy) / view.z;
            break;
          case 'piece': {
            let dx = w.x - drag.start.x;
            let dy = w.y - drag.start.y;
            if (s.snapMm > 0 && !free) {
              dx = Math.round(dx / s.snapMm) * s.snapMm;
              dy = Math.round(dy / s.snapMm) * s.snapMm;
            }
            replacePiece(drag.base, drag.id, translatePiece(drag.orig, dx, dy));
            break;
          }
          case 'vertex': {
            const sn = free ? { p: w, mark: null } : snap(w, { id: drag.id, index: drag.index });
            overlay.snapMark = sn.mark;
            replacePiece(drag.base, drag.id, { ...drag.orig, outline: moveVertex(drag.orig.outline, drag.index, sn.p) });
            break;
          }
          case 'handle': {
            const p = free ? w : snap(w).p;
            replacePiece(drag.base, drag.id, { ...drag.orig, outline: moveHandleSmooth(drag.orig.outline, drag.edge, drag.which, p, free) });
            break;
          }
          case 'convert': {
            if (!drag.moved && dist(toScreen(view, w), toScreen(view, drag.start)) < 4) break;
            drag.moved = true;
            replacePiece(drag.base, drag.id, { ...drag.orig, outline: convertVertex(drag.orig.outline, drag.index, 'smooth', w) });
            break;
          }
          case 'grain': {
            const g = [...drag.orig.grainline!] as [Vec2, Vec2];
            const other = g[drag.end === 0 ? 1 : 0];
            g[drag.end] = e.shiftKey ? constrain45(other, snap(w).p) : snap(w).p;
            replacePiece(drag.base, drag.id, { ...drag.orig, grainline: g });
            break;
          }
          case 'rect':
            overlay.rect = { a: drag.a, b: snap(w).p };
            break;
          case 'group': {
            let dx = w.x - drag.start.x;
            let dy = w.y - drag.start.y;
            if (s.snapMm > 0 && !free) {
              dx = Math.round(dx / s.snapMm) * s.snapMm;
              dy = Math.round(dy / s.snapMm) * s.snapMm;
            }
            const g = drag;
            liveUpdate({ ...g.base, pieces: g.base.pieces.map((p) => (g.origs.has(p.id) ? translatePiece(g.origs.get(p.id)!, dx, dy) : p)) });
            break;
          }
          case 'marquee':
            overlay.marquee = { a: drag.a, b: w };
            break;
          case 'print': {
            let dx = w.x - drag.start.x;
            let dy = w.y - drag.start.y;
            if (s.snapMm > 0 && !free) {
              dx = Math.round(dx / s.snapMm) * s.snapMm;
              dy = Math.round(dy / s.snapMm) * s.snapMm;
            }
            const d0 = drag;
            const ax = fabricAxes(d0.orig);
            replacePiece(d0.base, d0.id, {
              ...d0.orig,
              prints: d0.orig.prints?.map((x) => {
                if (x.id !== d0.printId) return x;
                // textura: mexe no deslocamento no tecido (vale na prévia e no risco)
                if (x.mode === 'textura') {
                  const o = x.offsetMm ?? { x: 0, y: 0 };
                  return { ...x, offsetMm: { x: o.x + dx * ax.across.x + dy * ax.across.y, y: o.y + dx * ax.along.x + dy * ax.along.y } };
                }
                return { ...x, center: { x: x.center.x + dx, y: x.center.y + dy } };
              }),
            });
            break;
          }
          case 'printFrame': {
            const d0 = drag;
            const arts = new Map((d0.base.artworks ?? []).map((a) => [a.id, a]));
            let fr: PrintFrame;
            if (d0.handle === 'rot') {
              // total gira em volta do próprio centro; as outras, em volta do meio da arte/módulo
              const c = d0.pr0.mode === 'total' ? d0.pr0.center : frameCenter(d0.f0);
              let deg = ((Math.atan2(w.y - c.y, w.x - c.x) - Math.atan2(d0.start.y - c.y, d0.start.x - c.x)) * 180) / Math.PI;
              if (e.shiftKey) deg = Math.round((d0.pr0.rotationDeg + deg) / 15) * 15 - d0.pr0.rotationDeg;
              fr = rotateFrame(d0.f0, c, deg);
            } else fr = scaleFrame(d0.f0, d0.handle, w, { fromCenter: e.altKey, free: e.shiftKey });
            const pr1 = applyPrintFrame(d0.orig, d0.pr0, d0.size, arts, fr);
            replacePiece(d0.base, d0.id, { ...d0.orig, prints: d0.orig.prints?.map((x) => (x.id === d0.pr0.id ? pr1 : x)) });
            break;
          }
          case 'measure': {
            const sn = snap(w);
            overlay.snapMark = sn.mark;
            overlay.measure = { a: drag.a, b: sn.p };
            viewInfo.set({ measure: overlay.measure });
            break;
          }
        }
      } else if (PEN_TOOLS.has(s.tool)) {
        const sn = snap(w);
        const last = overlay.penPoints[overlay.penPoints.length - 1];
        overlay.cursor = e.shiftKey && last ? constrain45(last, sn.p) : sn.p;
        overlay.snapMark = sn.mark;
      } else if (s.tool === 'measure' || s.tool === 'rect' || s.tool === 'coordPoint') {
        overlay.snapMark = snap(w).mark;
      } else if (s.tool === 'walk' && walk) {
        if (!walk.frozen) walkSet(projectOnPath(walk.A, w, walk.maxS));
      } else if (s.tool === 'parallel') {
        const par = parallelAt(w);
        overlay.preview = par ? flattenPath(par.path) : null;
      } else if ((s.tool === 'notch' || s.tool === 'addPoint') && s.opts.measureMode !== 'clique') {
        const h = hitOutline(w, undefined, 3);
        if (h) {
          overlay.hoverEdge = { pieceId: h.piece.id, edge: h.edge };
          const L = edgeLength(h.piece.outline, h.edge);
          const marks: number[] = s.opts.measureMode === 'dividir' ? Array.from({ length: Math.max(0, s.opts.divideN - 1) }, (_, k) => (L * (k + 1)) / s.opts.divideN) : [h.t > 0.5 ? L - s.opts.measureDistMm : s.opts.measureDistMm];
          const pts = marks.filter((m) => m >= 0 && m <= L).map((m) => pointOnEdge(h.piece.outline, h.edge, paramAtDistance(h.piece.outline, h.edge, m)));
          overlay.preview = null;
          overlay.marks = pts;
          overlay.snapKind = s.opts.measureMode === 'dividir' ? `${s.opts.divideN} partes de ${fmtLenU(L / s.opts.divideN)}` : `a ${fmtLenU(s.opts.measureDistMm)} do canto (borda de ${fmtLenU(L)})`;
          overlay.snapMark = pts[0] ?? null;
        }
      } else if (s.tool === 'print' && !spaceDown) {
        const hh = printHandleAt(w);
        canvas.style.cursor = !hh ? 'crosshair' : hh.handle === 'rot' ? 'grab' : resizeCursor(toScreen(view, frameCenter(hh.f)), toScreen(view, hh.p));
      } else if (EDGE_TOOLS.has(s.tool)) {
        // Cursor e realce da borda que será usada
        if (s.tool === 'dart' && pick) overlay.cursor = snap(w).p;
        else if (s.tool === 'fold' && pick?.hits.length === 2) overlay.cursor = null;
        else {
          const edgeTool = s.tool === 'join' || s.tool === 'unfold' || s.tool === 'seam';
          const h = edgeTool ? hitOutline(w, undefined, s.tool === 'seam' ? 3 : 0) : pickOnOutline(w, pick?.pieceId);
          overlay.cursor = h ? h.point : pick ? w : null;
          if (h && edgeTool) overlay.hoverEdge = { pieceId: h.piece.id, edge: h.edge };
          if (h && h.t === 0) overlay.snapMark = h.point;
        }
      }
      syncPickOverlay();
      invalidate();
    };

    const onUp = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      const d = drag;
      drag = null;
      updateCursor();
      if (!d) return;
      if (d.kind === 'guide') {
        const gd = overlay.guideDrag;
        overlay.guideDrag = null;
        const doc = editor.get().doc;
        const guides = { x: [...(doc.guides?.x ?? [])], y: [...(doc.guides?.y ?? [])] };
        const list = guides[d.axis];
        if (d.from !== null) list.splice(list.indexOf(d.from), 1);
        if (gd && !gd.remove) list.push(gd.value);
        if (gd || d.from !== null) {
          commit({ ...doc, guides });
          notify(gd && !gd.remove ? `Guia ${d.axis === 'x' ? 'vertical' : 'horizontal'} em ${fmtLenU(gd.value)}` : 'Guia removida');
        }
        invalidate();
        return;
      }
      switch (d.kind) {
        case 'marquee': {
          const m = overlay.marquee;
          overlay.marquee = null;
          const s = editor.get();
          // arraste muito curto = clique no vazio
          if (!m || dist(toScreen(view, m.a), toScreen(view, m.b)) < 4) {
            if (!d.add) select(null);
            break;
          }
          const box = { minX: Math.min(m.a.x, m.b.x), maxX: Math.max(m.a.x, m.b.x), minY: Math.min(m.a.y, m.b.y), maxY: Math.max(m.a.y, m.b.y) };
          const hits = s.doc.pieces.filter((p) => !s.hidden[p.id] && !s.locked[p.id] && polyTouchesBox(pieceGeom(p).cut, box)).map((p) => p.id);
          selectMany(d.add ? [...selectedIds(s), ...hits] : hits);
          if (hits.length > 1 || d.add) notify(`${selectedIds().length} molde(s) selecionado(s)`);
          break;
        }
        case 'group':
        case 'print':
        case 'printFrame':
          endLive(d.base);
          break;
        case 'piece':
        case 'vertex':
        case 'handle':
        case 'grain':
          endLive(d.base);
          break;
        case 'convert':
          if (d.moved) endLive(d.base);
          else commitPiece(d.id, (p) => ({ ...p, outline: convertVertex(p.outline, d.index, 'toggle') }));
          break;
        case 'rect': {
          const r = overlay.rect;
          overlay.rect = null;
          if (r) {
            const w = Math.abs(r.b.x - r.a.x);
            const h = Math.abs(r.b.y - r.a.y);
            if (w >= 1 && h >= 1) {
              addPieceFromOutline(rect(Math.min(r.a.x, r.b.x), Math.min(r.a.y, r.b.y), w, h));
              setTool('select');
            }
          }
          break;
        }
        case 'measure':
          break;
      }
      invalidate();
    };

    const onDblClick = (e: MouseEvent) => {
      const s = editor.get();
      const sp = local(e);
      const w = toWorld(view, sp.x, sp.y);
      if (PEN_TOOLS.has(s.tool)) {
        finishPen();
        return;
      }
      const sel = selectedPiece(s);
      if (s.tool === 'select' && sel) {
        const hit = closestOnPath(sel.outline, w);
        if (hit.distance <= HIT_PX / view.z) {
          const vi = vertices(sel.outline).findIndex((q) => dist(q, w) <= HIT_PX / view.z);
          // Duplo clique no ponto = converter (canto ⇄ curva); na borda = reta ⇄ curva
          if (vi >= 0) commitPiece(sel.id, (p) => ({ ...p, outline: convertVertex(p.outline, vi, 'toggle') }), { pieceId: sel.id, vertex: vi, edge: null });
          else commitPiece(sel.id, (p) => ({ ...p, outline: toggleCurve(p.outline, hit.edge) }), { pieceId: sel.id, edge: hit.edge, vertex: null });
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const sp = local(e);
      const before = toWorld(view, sp.x, sp.y);
      setZoom(view.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      const after = toWorld(view, sp.x, sp.y);
      view.cx += before.x - after.x;
      view.cy += before.y - after.y;
      invalidate();
    };

    const onLeave = () => {
      viewInfo.set({ cursor: null });
      overlay.cursor = null;
      overlay.snapMark = null;
      overlay.hoverEdge = null;
      invalidate();
    };

    /* ---------------- teclado ---------------- */
    const updateCursor = () => {
      const tool = editor.get().tool;
      canvas.style.cursor = spaceDown || tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
    };

    const MOD_COMMANDS: Record<string, string> = { a: 'selectAll', s: 'save', o: 'open', n: 'new', d: 'duplicate', e: 'exportPlt', '0': 'fit', '1': 'realSize', y: 'redo' };
    const KEY_TOOLS = new Map(TOOLS.map((t) => [t.key.toLowerCase(), t.id]));
    KEY_TOOLS.set('=', 'addPoint');
    KEY_TOOLS.set('_', 'removePoint');

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector('.modal-bg')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === 'Space') {
        spaceDown = true;
        updateCursor();
        e.preventDefault();
        return;
      }
      if (mod) {
        // No desktop os atalhos com Cmd/Ctrl vêm do menu nativo (evita disparo duplo).
        if (platform.isDesktop) return;
        const k = e.key.toLowerCase();
        let cmd = k === 'z' ? (e.shiftKey ? 'redo' : 'undo') : MOD_COMMANDS[k];
        if (cmd === 'save' && e.shiftKey) cmd = 'saveAs';
        if (cmd === 'exportPlt' && e.shiftKey) cmd = 'exportPdf';
        if (cmd) {
          e.preventDefault();
          void runCommand(cmd);
        }
        return;
      }
      const s = editor.get();
      const step = e.shiftKey ? 10 : 1;
      if (walk) {
        const marks = [...walk.A.notches, ...walk.A.corners].sort((x, y) => x - y);
        switch (e.key) {
          case 'ArrowRight': case 'ArrowUp': walk.frozen = true; walkSet(walk.s + step); e.preventDefault(); return;
          case 'ArrowLeft': case 'ArrowDown': walk.frozen = true; walkSet(walk.s - step); e.preventDefault(); return;
          case 'n': case 'N': walk.frozen = true; walkSet(marks.find((m) => m > walk!.s + 0.5) ?? walk.maxS); return;
          case 'Enter': canvasApi.walkFix(); return;
          case 'Escape': walkExit(); return;
        }
      }
      switch (e.key) {
        case 'g':
        case 'G':
          editor.set({ snapMm: s.snapMm > 0 ? 0 : 1 });
          notify(s.snapMm > 0 ? 'Ímã da grade desligado' : `Ímã da grade: ${fmtLenU(1)}`);
          break;
        case 'Enter':
          if (overlay.penPoints.length) finishPen();
          break;
        case 'Escape':
          if (coordStore.get().pick) coordStore.set({ pick: null });
          else if (pick) resetPick();
          else if (overlay.penPoints.length) {
            overlay.penPoints = [];
            overlay.penCorners = [];
          } else if (overlay.measure) {
            overlay.measure = null;
            viewInfo.set({ measure: null });
          } else {
            select(null);
            setTool('select');
          }
          break;
        case 'Backspace':
        case 'Delete':
          if (overlay.penPoints.length) {
            overlay.penPoints.pop();
            overlay.penCorners.pop();
          } else deleteSelection();
          e.preventDefault();
          break;
        case 'ArrowLeft': nudge(-step, 0); e.preventDefault(); break;
        case 'ArrowRight': nudge(step, 0); e.preventDefault(); break;
        case 'ArrowUp': nudge(0, step); e.preventDefault(); break;
        case 'ArrowDown': nudge(0, -step); e.preventDefault(); break;
        default: {
          const t = KEY_TOOLS.get(e.key.toLowerCase());
          if (!t) return;
          setTool(t);
        }
      }
      syncPickOverlay();
      invalidate();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown = false;
        updateCursor();
      }
    };

    // Troca de ferramenta descarta o desenho em andamento; troca de tema recolore.
    let lastTool = editor.get().tool;
    let lastTheme = editor.get().theme;
    const unsubArt = onArtLoaded(() => invalidate());
    const unsubCoord = coordStore.subscribe(() => {
      const c = coordStore.get().pick;
      overlay.coord = c ? { ref: c.ref, dx: c.dx, dy: c.dy } : null;
      invalidate();
    });
    const unsub = editor.subscribe(() => {
      const st = editor.get();
      if (st.tool !== lastTool) {
        lastTool = st.tool;
        overlay.penPoints = [];
        overlay.penCorners = [];
        overlay.rect = null;
        overlay.cursor = null;
        resetPick();
        walkExit();
        updateCursor();
        coordStore.set({ pick: null });
      }
      if (st.theme !== lastTheme) {
        lastTheme = st.theme;
        setCanvasTheme(st.theme);
      }
      invalidate();
    });

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    updateCursor();

    return () => {
      ro.disconnect();
      unsub();
      unsubArt();
      unsubCoord();
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return (
    <>
      <canvas ref={ref} className="canvas" tabIndex={0} />
      <CoordPopup />
    </>
  );
}
