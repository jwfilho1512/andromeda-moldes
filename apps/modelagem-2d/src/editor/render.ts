import {
  type Piece,
  type Vec2,
  cutLine,
  edgeControls,
  edgeCount,
  flattenPath,
  notchGeometry,
  edgeSeam,
  vertices,
  bboxOfPoints,
  unionBBox,
  dist,
  dartGeometry,
  isSmoothVertex,
  pathThroughPoints,
  pieceForSize,
  vertexOffset,
  printInstances,
  printFrame,
  type Artwork,
  type PrintInstance,
} from '@cad-textil/core';
import type { EditorState, Theme } from './store';
import { drawPrints } from '../estampa/images';
import { at, frameHandles } from '../estampa/handles';
import { fmtLen, fmtMm, unitLabel } from './store';

/* ------------------------------------------------------------------ */
/* Vista                                                               */
/* ------------------------------------------------------------------ */

export interface View {
  /** Centro da vista no mundo (mm). */
  cx: number;
  cy: number;
  /** Zoom: pixels (CSS) por mm. */
  z: number;
  w: number;
  h: number;
}

export const toScreen = (v: View, p: Vec2): Vec2 => ({ x: v.w / 2 + (p.x - v.cx) * v.z, y: v.h / 2 - (p.y - v.cy) * v.z });
export const toWorld = (v: View, sx: number, sy: number): Vec2 => ({ x: v.cx + (sx - v.w / 2) / v.z, y: v.cy - (sy - v.h / 2) / v.z });

/* ------------------------------------------------------------------ */
/* Cache de geometria por molde (moldes são imutáveis)                 */
/* ------------------------------------------------------------------ */

interface PieceGeom {
  cut: Vec2[];
  sew: Vec2[];
}
const geomCache = new WeakMap<Piece, PieceGeom>();

export function pieceGeom(p: Piece): PieceGeom {
  let g = geomCache.get(p);
  if (!g) {
    const sew = flattenPath(p.outline);
    let cut = sew;
    try {
      cut = cutLine(p);
    } catch {
      /* polígono degenerado durante edição */
    }
    g = { cut, sew };
    geomCache.set(p, g);
  }
  return g;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/* ------------------------------------------------------------------ */
/* Sobreposição (estado transitório das ferramentas)                   */
/* ------------------------------------------------------------------ */

export interface Overlay {
  penPoints: Vec2[];
  /** Pontos de canto (ferramenta Curvatura). */
  penCorners: boolean[];
  penMode: 'pen' | 'curve' | 'internal';
  penClosed: boolean; // true = fecha molde, false = linha interna
  /** Ferramentas de vários cliques (pence, cortar, dobrar…): pontos já escolhidos. */
  pick: { points: Vec2[]; kind: 'dart' | 'line' | 'dart-pick' | 'fold-side'; dartWidth?: number } | null;
  /** Ímã inteligente: o que atraiu e linhas de alinhamento. */
  snapKind: string | null;
  snapLines: [Vec2, Vec2][];
  /** Guia sendo puxada da régua. */
  guideDrag: { axis: 'x' | 'y'; value: number; remove: boolean } | null;
  /** Pré-visualização (paralelo). */
  preview: Vec2[] | null;
  /** Marcas de posição (piques/pontos por medida). */
  marks: Vec2[];
  /** Andar molde: molde B na posição encostada. */
  walk: { piece: Piece; hideId: string; traveled: Vec2[]; contact: Vec2 } | null;
  /** Borda sob o cursor (ferramentas que escolhem borda). */
  hoverEdge: { pieceId: string; edge: number } | null;
  cursor: Vec2 | null;
  snapMark: Vec2 | null;
  rect: { a: Vec2; b: Vec2 } | null;
  measure: { a: Vec2; b: Vec2 } | null;
  /** Caixa de seleção (arrastar no vazio). */
  marquee: { a: Vec2; b: Vec2 } | null;
  /** Ponto por coordenada em andamento. */
  coord?: { ref: Vec2; dx: number; dy: number } | null;
}

/* ------------------------------------------------------------------ */
/* Cores                                                               */
/* ------------------------------------------------------------------ */

const PAPER = {
  paper: '#f7f6f2',
  gridMinor: '#e6e4dd',
  gridMajor: '#cfccc2',
  axis: '#b3ad9d',
  rulerBg: 'rgba(29,31,35,0.92)',
  rulerText: '#a9adb6',
  cut: '#1f2328',
  sew: '#6b7280',
  fill: 'rgba(214, 205, 182, 0.30)',
  fillSel: 'rgba(59, 130, 246, 0.12)',
  sel: '#2563eb',
  handle: '#db2777',
  notch: '#1f2328',
  internal: '#7c3aed',
  grain: '#0f766e',
  tool: '#ea580c',
  dart: '#b45309',
  label: '#3f4450',
  marker: '#ffffff',
};
const DARK: typeof PAPER = {
  paper: '#1b1d21',
  gridMinor: '#25282d',
  gridMajor: '#30343b',
  axis: '#4b515a',
  rulerBg: 'rgba(17,18,21,0.95)',
  rulerText: '#8b919c',
  cut: '#e6e8eb',
  sew: '#8b919c',
  fill: 'rgba(148, 163, 184, 0.10)',
  fillSel: 'rgba(59, 130, 246, 0.18)',
  sel: '#60a5fa',
  handle: '#f472b6',
  notch: '#e6e8eb',
  internal: '#a78bfa',
  grain: '#2dd4bf',
  tool: '#fb923c',
  dart: '#fbbf24',
  label: '#c4c9d1',
  marker: '#1b1d21',
};
let C = PAPER;
const RULER_LIGHT = { rulerBg: 'rgba(240,240,236,0.96)', rulerText: '#6b7280' };

/** Cores da área de desenho conforme o tema escolhido. */
export function setCanvasTheme(theme: Theme) {
  C = theme === 'escuro-total' ? DARK : theme === 'claro' ? { ...PAPER, ...RULER_LIGHT } : PAPER;
}

/* ------------------------------------------------------------------ */
/* Desenho                                                             */
/* ------------------------------------------------------------------ */

const GRID_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

function polyPath(ctx: CanvasRenderingContext2D, v: View, pts: Vec2[], closed: boolean) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = toScreen(v, p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  if (closed) ctx.closePath();
}

function gridSteps(v: View): { minor: number; major: number } {
  const minor = GRID_STEPS.find((s) => s * v.z >= 10) ?? 5000;
  const lead = String(minor)[0];
  // A linha principal sempre cai numa potência de 10 mm.
  const major = lead === '5' ? minor * 2 : lead === '2' ? minor * 5 : minor * 10;
  return { minor, major };
}

function drawGrid(ctx: CanvasRenderingContext2D, v: View) {
  const { minor, major } = gridSteps(v);
  const tl = toWorld(v, 0, 0);
  const br = toWorld(v, v.w, v.h);

  const line = (step: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) {
      const sx = Math.round(toScreen(v, { x, y: 0 }).x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, v.h);
    }
    for (let y = Math.ceil(br.y / step) * step; y <= tl.y; y += step) {
      const sy = Math.round(toScreen(v, { x: 0, y }).y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(v.w, sy);
    }
    ctx.stroke();
  };
  line(minor, C.gridMinor);
  line(major, C.gridMajor);

  // Eixos da origem
  const o = toScreen(v, { x: 0, y: 0 });
  ctx.strokeStyle = C.axis;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(o.x, 0);
  ctx.lineTo(o.x, v.h);
  ctx.moveTo(0, o.y);
  ctx.lineTo(v.w, o.y);
  ctx.stroke();
}

export const RULER = 18;

function drawGuides(ctx: CanvasRenderingContext2D, v: View, g: { x: number[]; y: number[] } | undefined, drag: Overlay['guideDrag']) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#06b6d4';
  ctx.beginPath();
  for (const x of g?.x ?? []) {
    const sx = Math.round(toScreen(v, { x, y: 0 }).x) + 0.5;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, v.h);
  }
  for (const y of g?.y ?? []) {
    const sy = Math.round(toScreen(v, { x: 0, y }).y) + 0.5;
    ctx.moveTo(0, sy);
    ctx.lineTo(v.w, sy);
  }
  ctx.stroke();
  if (drag) {
    ctx.strokeStyle = drag.remove ? '#ef4444' : '#06b6d4';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    if (drag.axis === 'x') {
      const sx = toScreen(v, { x: drag.value, y: 0 }).x;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, v.h);
    } else {
      const sy = toScreen(v, { x: 0, y: drag.value }).y;
      ctx.moveTo(0, sy);
      ctx.lineTo(v.w, sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

const INCH_STEPS = [1, 2, 6, 12, 24, 60, 120, 240].map((n) => n * 25.4);

function drawRulers(ctx: CanvasRenderingContext2D, v: View, inches = false) {
  // Números da régua com pelo menos 50 px entre si (independe da grade); em polegadas quando escolhido.
  const major = inches ? INCH_STEPS.find((s) => s * v.z >= 50) ?? 6096 : GRID_STEPS.find((s) => s >= 10 && s * v.z >= 50) ?? 5000;
  const tl = toWorld(v, 0, 0);
  const br = toWorld(v, v.w, v.h);
  const R = RULER;
  ctx.fillStyle = C.rulerBg;
  ctx.fillRect(0, 0, v.w, R);
  ctx.fillRect(0, 0, R, v.h);
  ctx.fillStyle = C.rulerText;
  ctx.strokeStyle = C.rulerText;
  ctx.font = '10px -apple-system, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const label = (mm: number) => (inches ? `${Math.round(mm / 25.4)}` : major >= 10 ? `${mm / 10}` : fmtMm(mm / 10));
  ctx.beginPath();
  for (let x = Math.ceil(tl.x / major) * major; x <= br.x; x += major) {
    const sx = toScreen(v, { x, y: 0 }).x;
    if (sx < R + 4) continue;
    ctx.moveTo(sx + 0.5, R - 6);
    ctx.lineTo(sx + 0.5, R);
    ctx.fillText(label(x), sx + 3, R / 2 - 1);
  }
  for (let y = Math.ceil(br.y / major) * major; y <= tl.y; y += major) {
    const sy = toScreen(v, { x: 0, y }).y;
    if (sy < R + 4) continue;
    ctx.moveTo(R - 6, sy + 0.5);
    ctx.lineTo(R, sy + 0.5);
    ctx.save();
    ctx.translate(R / 2, sy - 3);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(label(y), 0, 0);
    ctx.restore();
  }
  ctx.stroke();
  ctx.fillStyle = C.rulerBg;
  ctx.fillRect(0, 0, R, R);
  ctx.fillStyle = C.rulerText;
  ctx.fillText(inches ? 'pol' : 'cm', 2, R / 2);
}

function arrowHead(ctx: CanvasRenderingContext2D, tip: Vec2, from: Vec2, size: number) {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  ctx.moveTo(tip.x - size * Math.cos(a - 0.4), tip.y - size * Math.sin(a - 0.4));
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(tip.x - size * Math.cos(a + 0.4), tip.y - size * Math.sin(a + 0.4));
}

function drawPiece(ctx: CanvasRenderingContext2D, v: View, p: Piece, selected: boolean, arts?: Map<string, Artwork>) {
  const g = pieceGeom(p);

  polyPath(ctx, v, g.cut, true);
  ctx.fillStyle = selected ? C.fillSel : C.fill;
  ctx.fill();
  if (arts && p.prints?.length) {
    drawPrints(ctx, printsOf(p, arts), arts, (q) => toScreen(v, q), v);
    polyPath(ctx, v, g.cut, true);
  }
  ctx.strokeStyle = selected ? C.sel : C.cut;
  ctx.lineWidth = selected ? 2 : 1.5;
  ctx.setLineDash([]);
  ctx.stroke();

  if (g.cut !== g.sew) {
    polyPath(ctx, v, g.sew, true);
    ctx.strokeStyle = C.sew;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = C.internal;
  ctx.lineWidth = 1.2;
  for (const path of p.internals) {
    polyPath(ctx, v, flattenPath(path), path.closed);
    ctx.stroke();
  }
  // pontos internos (furo/marcação): círculo de 2 mm com cruz (mínimo legível na tela)
  for (const q of p.drills ?? []) drillMark(ctx, toScreen(v, q), Math.max(3, 2 * v.z));

  if (p.grainline) {
    const a = toScreen(v, p.grainline[0]);
    const b = toScreen(v, p.grainline[1]);
    ctx.strokeStyle = C.grain;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    arrowHead(ctx, a, b, 10);
    arrowHead(ctx, b, a, 10);
    ctx.stroke();
  }

  ctx.strokeStyle = C.notch;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const n of p.notches) {
    const ng = notchGeometry(p, n);
    const sa = edgeSeam(p, n.edge);
    const outer = toScreen(v, { x: ng.at.x - ng.inward.x * sa, y: ng.at.y - ng.inward.y * sa });
    const inner = toScreen(v, { x: ng.at.x + ng.inward.x * n.depthMm, y: ng.at.y + ng.inward.y * n.depthMm });
    ctx.moveTo(outer.x, outer.y);
    ctx.lineTo(inner.x, inner.y);
  }
  ctx.stroke();

  // Pences: pernas + furo
  for (const d of p.darts ?? []) {
    const dg = dartGeometry(p, d);
    const [a, ap, b] = [dg.legA, dg.apex, dg.legB].map((q) => toScreen(v, q)) as [Vec2, Vec2, Vec2];
    ctx.strokeStyle = C.dart;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(ap.x, ap.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(ap.x, ap.y, 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Nome
  const bb = bboxOfPoints(g.cut);
  const c = toScreen(v, { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 });
  const size = Math.max(10, Math.min(22, (bb.maxX - bb.minX) * v.z * 0.07));
  ctx.fillStyle = selected ? C.sel : C.label;
  ctx.font = `600 ${size}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(p.name, c.x, c.y);
  ctx.font = `${size * 0.7}px -apple-system, system-ui, sans-serif`;
  ctx.fillText(`${p.quantity}x${p.cutInPairs ? ' par' : ''}`, c.x, c.y + size);
  ctx.textAlign = 'start';
}

function drawSelectionDetails(ctx: CanvasRenderingContext2D, v: View, p: Piece, s: EditorState) {
  const verts = vertices(p.outline);
  const n = edgeCount(p.outline);

  // Aresta selecionada
  if (s.selection.edge !== null) {
    const c = edgeControls(p.outline, s.selection.edge);
    const pts = flattenPath({ start: c.p0, segments: [c.kind === 'line' ? { kind: 'line', to: c.p3 } : { kind: 'cubic', c1: c.c1, c2: c.c2, to: c.p3 }], closed: false });
    polyPath(ctx, v, pts, false);
    ctx.strokeStyle = C.sel;
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  // Alças das curvas
  for (let i = 0; i < n; i++) {
    const c = edgeControls(p.outline, i);
    if (c.kind !== 'cubic') continue;
    const [p0, c1, c2, p3] = [c.p0, c.c1, c.c2, c.p3].map((q) => toScreen(v, q)) as [Vec2, Vec2, Vec2, Vec2];
    ctx.strokeStyle = C.handle;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(c1.x, c1.y);
    ctx.moveTo(p3.x, p3.y);
    ctx.lineTo(c2.x, c2.y);
    ctx.stroke();
    for (const h of [c1, c2]) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = C.marker;
      ctx.fill();
      ctx.stroke();
    }
  }

  // Vértices: quadrado = canto, círculo = ponto de curva (como no Illustrator)
  verts.forEach((q, i) => vertexMarker(ctx, toScreen(v, q), isSmoothVertex(p.outline, i), s.selection.vertex === i));

  // Pontas do fio (arrastáveis)
  if (p.grainline) {
    for (const q of p.grainline) {
      const sp = toScreen(v, q);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = C.grain;
      ctx.fill();
    }
  }
}

function vertexMarker(ctx: CanvasRenderingContext2D, sp: Vec2, smooth: boolean, selected: boolean, color = C.sel) {
  const r = selected ? 5 : 4;
  ctx.fillStyle = selected ? color : C.marker;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (smooth) ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
  else ctx.rect(sp.x - r, sp.y - r, r * 2, r * 2);
  ctx.fill();
  ctx.stroke();
}

function edgeStroke(ctx: CanvasRenderingContext2D, v: View, p: Piece, edge: number, color: string, width: number) {
  const c = edgeControls(p.outline, edge);
  const pts = flattenPath({ start: c.p0, segments: [c.kind === 'line' ? { kind: 'line', to: c.p3 } : { kind: 'cubic', c1: c.c1, c2: c.c2, to: c.p3 }], closed: false });
  polyPath(ctx, v, pts, false);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawWalk(ctx: CanvasRenderingContext2D, v: View, w: NonNullable<Overlay['walk']>) {
  const p = w.piece;
  const g = { cut: cutLine(p), sew: flattenPath(p.outline) };
  polyPath(ctx, v, g.cut, true);
  ctx.fillStyle = 'rgba(234, 88, 12, 0.10)';
  ctx.fill();
  ctx.strokeStyle = C.tool;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  polyPath(ctx, v, g.sew, true);
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  // piques de B
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const n of p.notches) {
    const ng = notchGeometry(p, n);
    const a = toScreen(v, { x: ng.at.x - ng.inward.x * 8, y: ng.at.y - ng.inward.y * 8 });
    const b = toScreen(v, { x: ng.at.x + ng.inward.x * 8, y: ng.at.y + ng.inward.y * 8 });
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  // trecho já andado na costura de A
  polyPath(ctx, v, w.traveled, false);
  ctx.strokeStyle = '#16a34a';
  ctx.lineWidth = 4;
  ctx.stroke();
  const c = toScreen(v, w.contact);
  ctx.beginPath();
  ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#16a34a';
  ctx.fill();
  const bb = bboxOfPoints(g.cut);
  const lc = toScreen(v, { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 });
  ctx.fillStyle = C.tool;
  ctx.font = '600 13px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(p.name, lc.x, lc.y);
  ctx.textAlign = 'start';
}

function drillMark(ctx: CanvasRenderingContext2D, s: Vec2, r: number) {
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.moveTo(s.x - r * 1.5, s.y);
  ctx.lineTo(s.x + r * 1.5, s.y);
  ctx.moveTo(s.x, s.y - r * 1.5);
  ctx.lineTo(s.x, s.y + r * 1.5);
  ctx.stroke();
}

/** Ponto por coordenada: referência, cotas X/Y em L e o ponto que será criado. */
function drawCoordPick(ctx: CanvasRenderingContext2D, v: View, c: NonNullable<Overlay['coord']>) {
  const r = toScreen(v, c.ref), k = toScreen(v, { x: c.ref.x + c.dx, y: c.ref.y }), p = toScreen(v, { x: c.ref.x + c.dx, y: c.ref.y + c.dy });
  ctx.save();
  ctx.strokeStyle = C.tool;
  ctx.fillStyle = C.tool;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(r.x, r.y);
  ctx.lineTo(k.x, k.y);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(r.x, r.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.8;
  drillMark(ctx, p, Math.max(4, 2 * v.z));
  ctx.restore();
  if (c.dx) tag(ctx, `X ${fmtLen(c.dx)}`, { x: (r.x + k.x) / 2 - 24, y: r.y + (c.dy > 0 ? 6 : -26) });
  if (c.dy) tag(ctx, `Y ${fmtLen(c.dy)}`, { x: k.x + (c.dx < 0 ? -64 : 6), y: (k.y + p.y) / 2 - 10 });
}

function tag(ctx: CanvasRenderingContext2D, text: string, at: Vec2) {
  ctx.font = '600 12px -apple-system, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = 'rgba(31,35,40,0.88)';
  ctx.fillRect(at.x, at.y, w, 20);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x + 5, at.y + 10);
}

function drawOverlay(ctx: CanvasRenderingContext2D, v: View, o: Overlay) {
  ctx.setLineDash([]);
  if (o.penPoints.length > 0) {
    const pts = o.cursor ? [...o.penPoints, o.cursor] : o.penPoints;
    if (o.penMode === 'curve' && pts.length >= 2) {
      const corners = o.cursor ? [...o.penCorners, false] : o.penCorners;
      polyPath(ctx, v, flattenPath(pathThroughPoints(pts.map((p, i) => ({ p, corner: corners[i] })), false)), false);
    } else polyPath(ctx, v, pts, false);
    ctx.strokeStyle = o.penClosed ? C.tool : C.internal;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    o.penPoints.forEach((p, i) => {
      const s = toScreen(v, p);
      if (o.penMode === 'curve' && o.penCorners[i]) {
        ctx.fillStyle = C.tool;
        ctx.fillRect(s.x - 4, s.y - 4, 8, 8);
        return;
      }
      ctx.fillStyle = i === 0 && o.penClosed ? C.tool : C.marker;
      ctx.strokeStyle = C.tool;
      ctx.beginPath();
      ctx.arc(s.x, s.y, i === 0 ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    const last = o.penPoints[o.penPoints.length - 1]!;
    if (o.cursor) {
      const s = toScreen(v, o.cursor);
      tag(ctx, `${fmtLen(dist(last, o.cursor))} ${unitLabel()}`, { x: s.x + 14, y: s.y + 10 });
    }
  }

  if (o.rect) {
    const { a, b } = o.rect;
    polyPath(ctx, v, [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], true);
    ctx.strokeStyle = C.tool;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const s = toScreen(v, b);
    tag(ctx, `${fmtLen(Math.abs(b.x - a.x))} × ${fmtLen(Math.abs(b.y - a.y))} ${unitLabel()}`, { x: s.x + 14, y: s.y + 10 });
  }

  if (o.marquee) {
    const { a, b } = o.marquee;
    polyPath(ctx, v, [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], true);
    ctx.fillStyle = 'rgba(59,130,246,0.08)';
    ctx.fill();
    ctx.strokeStyle = C.sel;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (o.measure) {
    const a = toScreen(v, o.measure.a);
    const b = toScreen(v, o.measure.b);
    ctx.strokeStyle = C.tool;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = C.tool;
      ctx.fill();
    }
    const d = dist(o.measure.a, o.measure.b);
    const dx = Math.abs(o.measure.b.x - o.measure.a.x);
    const dy = Math.abs(o.measure.b.y - o.measure.a.y);
    tag(ctx, `${fmtLen(d)} ${unitLabel()}   (Δx ${fmtLen(dx)} · Δy ${fmtLen(dy)})`, { x: (a.x + b.x) / 2 + 10, y: (a.y + b.y) / 2 + 8 });
  }

  if (o.pick && o.pick.points.length) {
    const pts = o.cursor ? [...o.pick.points, o.cursor] : o.pick.points;
    ctx.strokeStyle = C.tool;
    ctx.lineWidth = 1.5;
    if (o.pick.kind === 'dart' && o.cursor && o.pick.dartWidth) {
      // Pré-visualização da pence: boca na borda, ápice no cursor
      const m = o.pick.points[0]!;
      const ax = o.cursor;
      const dx = ax.x - m.x, dy = ax.y - m.y;
      const L = Math.hypot(dx, dy) || 1;
      const px = (-dy / L) * (o.pick.dartWidth / 2), py = (dx / L) * (o.pick.dartWidth / 2);
      polyPath(ctx, v, [{ x: m.x + px, y: m.y + py }, ax, { x: m.x - px, y: m.y - py }], false);
      ctx.stroke();
      tag(ctx, `pence ${fmtLen(o.pick.dartWidth)} × ${fmtLen(L)} ${unitLabel()}`, { x: toScreen(v, ax).x + 14, y: toScreen(v, ax).y + 10 });
    } else if (o.pick.kind === 'line' || o.pick.kind === 'fold-side') {
      ctx.setLineDash([6, 4]);
      polyPath(ctx, v, o.pick.kind === 'fold-side' ? o.pick.points : pts, false);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const p of o.pick.points) {
      const s = toScreen(v, p);
      ctx.fillStyle = C.tool;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (o.preview) {
    polyPath(ctx, v, o.preview, false);
    ctx.strokeStyle = C.tool;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const m of o.marks) {
    const s = toScreen(v, m);
    ctx.fillStyle = C.tool;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [a, b] of o.snapLines) {
    const sa = toScreen(v, a), sb = toScreen(v, b);
    ctx.strokeStyle = '#d946ef';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (o.snapMark) {
    const s = toScreen(v, o.snapMark);
    ctx.strokeStyle = C.tool;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    if (o.snapKind) {
      ctx.font = '600 11px -apple-system, system-ui, sans-serif';
      const w = ctx.measureText(o.snapKind).width + 8;
      ctx.fillStyle = '#d946ef';
      ctx.fillRect(s.x + 10, s.y - 24, w, 16);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.snapKind, s.x + 14, s.y - 16);
    }
  }
}

/** Cor de cada tamanho no ninho (menores frios, maiores quentes). */
export function sizeColor(i: number, n: number, base: number): string {
  if (i === base) return C.cut;
  const t = n > 1 ? i / (n - 1) : 0.5;
  const hue = 220 - t * 220; // azul → vermelho
  return `hsl(${hue}, 75%, ${C === DARK ? 62 : 45}%)`;
}

const nestCache = new WeakMap<Piece, Vec2[][]>();
function nestOf(p: Piece): Vec2[][] {
  let n = nestCache.get(p);
  if (!n) {
    n = p.grading!.sizes.map((_, i) => flattenPath(pieceForSize(p, i).outline));
    nestCache.set(p, n);
  }
  return n;
}

function drawNest(ctx: CanvasRenderingContext2D, v: View, p: Piece, selVertex: number | null) {
  const g = p.grading!;
  const nest = nestOf(p);
  nest.forEach((pts, i) => {
    if (i === g.base) return;
    polyPath(ctx, v, pts, true);
    ctx.strokeStyle = sizeColor(i, g.sizes.length, g.base);
    ctx.lineWidth = 1;
    ctx.stroke();
  });
  if (selVertex !== null) {
    const base = vertices(p.outline)[selVertex];
    if (!base) return;
    g.sizes.forEach((name, i) => {
      const o = vertexOffset(g, selVertex, i);
      const sp = toScreen(v, { x: base.x + o.x, y: base.y + o.y });
      ctx.fillStyle = sizeColor(i, g.sizes.length, g.base);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '600 11px -apple-system, system-ui, sans-serif';
      ctx.fillText(name, sp.x + 6, sp.y - 6);
    });
  }
}

/* ------------------------------------------------------------------ */
/* Estampas                                                            */
/* ------------------------------------------------------------------ */

let artsCache: { list: Artwork[] | undefined; map: Map<string, Artwork> } = { list: undefined, map: new Map() };
function artsOf(list: Artwork[] | undefined): Map<string, Artwork> {
  if (artsCache.list !== list) artsCache = { list, map: new Map((list ?? []).map((a) => [a.id, a])) };
  return artsCache.map;
}

const printCache = new WeakMap<Piece, { arts: Map<string, Artwork>; inst: PrintInstance[] }>();
/** Estampas do molde no tamanho base (memorizado por molde). */
export function printsOf(p: Piece, arts: Map<string, Artwork>): PrintInstance[] {
  const c = printCache.get(p);
  if (c && c.arts === arts) return c.inst;
  const size = p.grading ? p.grading.sizes[p.grading.base]! : '';
  let inst: PrintInstance[] = [];
  try {
    inst = printInstances(p, size, arts);
  } catch {
    /* molde degenerado durante edição */
  }
  printCache.set(p, { arts, inst });
  return inst;
}

/** Moldura da estampa ativa: retângulo da arte (localizada) e cruz no centro. */
function drawPrintFrame(ctx: CanvasRenderingContext2D, v: View, p: Piece, activeId: string | null, arts: Map<string, Artwork>, strong: boolean) {
  const size = p.grading ? p.grading.sizes[p.grading.base]! : '';
  const prints = p.prints ?? [];
  const activePr = prints.find((x) => x.id === activeId) ?? (strong ? prints[0] : undefined);
  for (const pr of prints) {
    const active = pr === activePr;
    if (!active && !strong) continue;
    ctx.save();
    ctx.strokeStyle = active ? C.tool : C.sew;
    ctx.lineWidth = active ? 1.5 : 1;
    ctx.setLineDash([5, 3]);
    // arte (localizada) ou módulo de referência (corrida/textura); a total só mostra o quadro quando ativa
    const fr = pr.mode !== 'total' || (active && strong) ? printFrame(p, pr, size, arts) : null;
    if (fr) {
      polyPath(ctx, v, [at(fr, 0, 0), at(fr, 1, 0), at(fr, 1, 1), at(fr, 0, 1)], true);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const sc = toScreen(v, pr.center);
    ctx.beginPath();
    ctx.moveTo(sc.x - 7, sc.y);
    ctx.lineTo(sc.x + 7, sc.y);
    ctx.moveTo(sc.x, sc.y - 7);
    ctx.lineTo(sc.x, sc.y + 7);
    ctx.stroke();
    // alças de escala e giro (só na ferramenta Estampa)
    if (active && strong && fr) {
      const hs = frameHandles(fr, pr.mode, v.z);
      const rot = hs.find((h) => h.id === 'rot');
      if (rot) {
        const a = toScreen(v, at(fr, 0.5, 1)), b = toScreen(v, rot.p);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (const h of hs) {
        const s = toScreen(v, h.p);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        if (h.id === 'rot') ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
        else ctx.rect(s.x - 4, s.y - 4, 8, 8);
        ctx.fill();
        ctx.stroke();
      }
      if (pr.mode !== 'total') {
        const W = Math.hypot(fr.U.x, fr.U.y), H = Math.hypot(fr.V.x, fr.V.y);
        const ys = [0, 1].flatMap((u) => [0, 1].map((w) => toScreen(v, at(fr, u, w))));
        const bottom = Math.max(...ys.map((q) => q.y)), left = Math.min(...ys.map((q) => q.x));
        const giro = pr.rotationDeg ? ` · ${fmtMm(pr.rotationDeg)}°` : '';
        tag(ctx, `${pr.mode === 'localizada' ? '' : 'módulo '}${fmtLen(W)} × ${fmtLen(H)} ${unitLabel()}${giro}`, { x: left, y: bottom + 8 });
      }
    }
    ctx.restore();
  }
}

/** Caixa tracejada em volta da seleção múltipla, com a contagem e o tamanho. */
function drawGroupBox(ctx: CanvasRenderingContext2D, v: View, pieces: Piece[]) {
  if (!pieces.length) return;
  const b = pieces.map((p) => bboxOfPoints(pieceGeom(p).cut)).reduce(unionBBox);
  const a = toScreen(v, { x: b.minX, y: b.maxY }), c = toScreen(v, { x: b.maxX, y: b.minY });
  ctx.save();
  ctx.strokeStyle = C.sel;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(a.x - 6, a.y - 6, c.x - a.x + 12, c.y - a.y + 12);
  ctx.setLineDash([]);
  ctx.fillStyle = C.sel;
  for (const [x, y] of [[a.x - 6, a.y - 6], [c.x + 6, a.y - 6], [a.x - 6, c.y + 6], [c.x + 6, c.y + 6]] as const) ctx.fillRect(x - 3, y - 3, 6, 6);
  ctx.restore();
  tag(ctx, `${pieces.length} moldes · ${fmtLen(b.maxX - b.minX)} × ${fmtLen(b.maxY - b.minY)} ${unitLabel()}`, { x: a.x - 6, y: a.y - 22 });
}

const VERTEX_TOOLS = new Set(['convert', 'removePoint']);

export function render(ctx: CanvasRenderingContext2D, v: View, s: EditorState, o: Overlay) {
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, v.w, v.h);
  drawGrid(ctx, v);
  drawGuides(ctx, v, s.doc.guides, o.guideDrag);
  const visible = s.doc.pieces.filter((p) => !s.hidden[p.id] && p.id !== o.walk?.hideId);
  const arts = artsOf(s.doc.artworks);
  const many = s.multi.length > 1;
  const selSet = new Set(many ? s.multi : s.selection.pieceId ? [s.selection.pieceId] : []);
  for (const p of visible) drawPiece(ctx, v, p, selSet.has(p.id), arts);
  if (s.showGrade) for (const p of visible) if (p.grading) drawNest(ctx, v, p, p.id === s.selection.pieceId && !many ? s.selection.vertex : null);
  const sel = visible.find((p) => p.id === s.selection.pieceId);
  if (sel && s.tool === 'select' && !many) drawSelectionDetails(ctx, v, sel, s);
  if (many) drawGroupBox(ctx, v, visible.filter((p) => selSet.has(p.id)));
  if (sel && !many && sel.prints?.length && (s.tool === 'print' || s.tool === 'select')) drawPrintFrame(ctx, v, sel, s.activePrint, arts, s.tool === 'print');
  if (o.hoverEdge) {
    const hp = visible.find((p) => p.id === o.hoverEdge!.pieceId);
    if (hp) edgeStroke(ctx, v, hp, o.hoverEdge.edge, C.tool, 3);
  }
  if (VERTEX_TOOLS.has(s.tool)) {
    for (const p of visible) {
      if (s.locked[p.id]) continue;
      vertices(p.outline).forEach((q, i) => vertexMarker(ctx, toScreen(v, q), isSmoothVertex(p.outline, i), false, C.tool));
    }
  }
  if (o.walk) drawWalk(ctx, v, o.walk);
  if (o.coord) drawCoordPick(ctx, v, o.coord);
  drawOverlay(ctx, v, o);
  drawRulers(ctx, v, s.unit === 'pol');
}
