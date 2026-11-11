/**
 * Área de desenho: SVG com zoom/arrasto, seleção com alças de escala, edição de pontos,
 * caneta (com simetria), formas, pesponto ao longo do traço, aviamentos e balde de tecido.
 */
import { type BBox, type Path, type Vec2, dist, flattenPath, pathThroughPoints } from '@cad-textil/core';
import { arcPath, freehandPath, polygonPath, splitPathAt } from '../model/draw-tools';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type Affine, anchors, bboxOfShapes, cumLength, mirrored, mirrorX, pathD, polyPath, projectOn, scaleAbout, shapeBBox, translateM } from '../model/geom';
import { stitchAlong, stitchLine } from '../model/stitch';
import { defsSvg, setDimScale, shapeSvg } from '../model/svg';
import type { DimShape, PathShape, Shape, StitchShape, TextShape, TrimShape } from '../model/types';
import {
  type EditorState,
  addShapes,
  editor,
  findShape,
  newId,
  notify,
  replaceDeep,
  resolveShape,
  selectedShapes,
  transformSelected,
  trimDefaultSize,
  updateDeep,
  updateShapes,
  useEditor,
} from '../state';

interface ViewT {
  x: number;
  y: number;
  /** px por mm */
  z: number;
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
interface Target {
  sid: string;
  cid?: string;
}

type Drag =
  | { kind: 'move'; start: Vec2; cur: Vec2 }
  | { kind: 'scale'; h: Handle; box: BBox; start: Vec2; cur: Vec2; shift: boolean; alt: boolean }
  | { kind: 'marquee'; start: Vec2; cur: Vec2; add: boolean }
  | { kind: 'pan'; sx: number; sy: number; v0: ViewT }
  | { kind: 'shape'; tool: 'rect' | 'ellipse' | 'line' | 'arc' | 'polygon' | 'dim'; start: Vec2; cur: Vec2; shift?: boolean; alt?: boolean }
  | { kind: 'free'; pts: Vec2[] }
  | { kind: 'anchor'; t: Target; path0: Path; which: 'p' | 'c1' | 'c2'; idx: number; start: Vec2; cur: Vec2 }
  | { kind: 'pen'; start: Vec2; cur: Vec2 };

interface PenPt {
  p: Vec2;
  cin?: Vec2;
  cout?: Vec2;
}

interface StitchPick {
  t: Target;
  pts: Vec2[];
  s0: number;
  axis?: number;
  /** Polígono para saber qual lado é "dentro". */
  poly: Vec2[] | null;
}

let svgCache = new WeakMap<Shape, string>();
let cacheScale = 0;
const cached = (s: Shape) => {
  let v = svgCache.get(s);
  if (v === undefined) {
    v = shapeSvg(s, 3);
    svgCache.set(s, v);
  }
  return v;
};

export const canvasApi = {
  fit: () => {},
  /** Aproxima (> 1) ou afasta (< 1) mantendo `at` (mm) no lugar; sem `at`, o centro da vista. */
  zoom: (_factor: number, _at?: Vec2) => {},
  /** Centro da área visível (mm). */
  center: (): Vec2 => ({ x: 210, y: 148 }),
};

// Gancho de teste (somente em desenvolvimento), no mesmo módulo que usa o estado
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__draw = { editor, canvasApi };

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const handlePos = (b: BBox, h: Handle): Vec2 => ({
  x: h.includes('w') ? b.minX : h.includes('e') ? b.maxX : (b.minX + b.maxX) / 2,
  y: h.includes('n') ? b.minY : h.includes('s') ? b.maxY : (b.minY + b.maxY) / 2,
});
const opposite = (h: Handle): Handle => ({ nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' })[h] as Handle;
const CURSOR: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

function scaleMatrix(d: Extract<Drag, { kind: 'scale' }>): Affine {
  const { box, h } = d;
  const o = d.alt ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : handlePos(box, opposite(h));
  const p0 = handlePos(box, h);
  const fx = h === 'n' || h === 's' ? 1 : (d.cur.x - o.x) / (p0.x - o.x || 1);
  const fy = h === 'e' || h === 'w' ? 1 : (d.cur.y - o.y) / (p0.y - o.y || 1);
  const corner = h.length === 2;
  if (corner && !d.shift) {
    const k = Math.abs(fx) > Math.abs(fy) ? fx : fy;
    return scaleAbout(o, k, k);
  }
  return scaleAbout(o, fx, fy);
}

const matrixAttr = (m: Affine) => `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;

/** Caminho da caneta (pontos + alças). */
function penPath(pts: PenPt[], closed: boolean): Path | null {
  if (pts.length < 1) return null;
  const segs: Path['segments'] = [];
  const n = pts.length;
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const a = pts[i]!, b = pts[(i + 1) % n]!;
    if (a.cout || b.cin) segs.push({ kind: 'cubic', c1: a.cout ?? a.p, c2: b.cin ?? b.p, to: b.p });
    else segs.push({ kind: 'line', to: b.p });
  }
  return { start: pts[0]!.p, segments: segs, closed };
}

/** Pontos (âncoras) editáveis e alças de um caminho. */
function editPoints(path: Path) {
  const as = anchors(path);
  const count = path.closed ? as.length - 1 : as.length;
  const handles: { idx: number; which: 'c1' | 'c2'; p: Vec2; from: Vec2 }[] = [];
  path.segments.forEach((s, i) => {
    if (s.kind !== 'cubic') return;
    handles.push({ idx: i, which: 'c1', p: s.c1, from: as[i]! });
    handles.push({ idx: i, which: 'c2', p: s.c2, from: as[i + 1]! });
  });
  return { anchors: as.slice(0, Math.max(1, count)), handles };
}

/** Move um ponto (com as alças junto) ou uma alça. */
function editPath(path: Path, which: 'p' | 'c1' | 'c2', idx: number, delta: Vec2): Path {
  const mv = (p: Vec2) => ({ x: p.x + delta.x, y: p.y + delta.y });
  const segs = path.segments.map((s) => ({ ...s }));
  if (which !== 'p') {
    const s = segs[idx]!;
    if (s.kind === 'cubic') segs[idx] = { ...s, [which]: mv(s[which]) };
    return { ...path, segments: segs };
  }
  let start = path.start;
  const touch = (k: number) => {
    // âncora k: k = 0 é o início; k > 0 é o fim do segmento k-1
    if (k === 0) start = mv(start);
    else {
      const s = segs[k - 1]!;
      segs[k - 1] = s.kind === 'cubic' ? { ...s, to: mv(s.to), c2: mv(s.c2) } : { ...s, to: mv(s.to) };
    }
    const out = segs[k];
    if (out && out.kind === 'cubic') segs[k] = { ...out, c1: mv(out.c1) };
  };
  touch(idx);
  if (path.closed && idx === 0) {
    const last = segs.length;
    const s = segs[last - 1]!;
    segs[last - 1] = s.kind === 'cubic' ? { ...s, to: mv(s.to), c2: mv(s.c2) } : { ...s, to: mv(s.to) };
  }
  return { start, segments: segs, closed: path.closed };
}

/** Lê o alvo (forma de cima + filho) de um elemento clicado. */
function targetOf(el: EventTarget | null): Target | null {
  const e = el as Element | null;
  const top = e?.closest?.('[data-sid]');
  if (!top) return null;
  const child = e?.closest?.('[data-cid]');
  return { sid: top.getAttribute('data-sid')!, cid: child ? child.getAttribute('data-cid')! : undefined };
}

export function Canvas() {
  const s = useEditor();
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<ViewT>({ x: -20, y: -20, z: 2 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const [pen, setPen] = useState<PenPt[]>([]);
  const penRef = useRef(pen);
  penRef.current = pen;
  const [curve, setCurve] = useState<{ p: Vec2; corner: boolean }[]>([]);
  const curveRef = useRef(curve);
  curveRef.current = curve;
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [edit, setEdit] = useState<Target | null>(null);
  const [pick, setPick] = useState<StitchPick | null>(null);
  const [space, setSpace] = useState(false);

  /* ---------------- tamanho e enquadramento ---------------- */
  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = () => {
    const { w, h } = editor.get().doc.artboard;
    const el = wrap.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;
    const z = Math.min((W - 60) / w, (H - 60) / h);
    setView({ z, x: w / 2 - W / z / 2, y: h / 2 - H / z / 2 });
  };
  canvasApi.fit = fit;
  canvasApi.zoom = (factor, at) => {
    const v = viewRef.current;
    const p = at ?? canvasApi.center();
    const z = Math.min(200, Math.max(0.1, v.z * factor));
    setView({ z, x: p.x - (p.x - v.x) * (v.z / z), y: p.y - (p.y - v.y) * (v.z / z) });
  };
  canvasApi.center = () => {
    const v = viewRef.current;
    const el = wrap.current;
    return el ? { x: v.x + el.clientWidth / v.z / 2, y: v.y + el.clientHeight / v.z / 2 } : { x: 210, y: 148 };
  };
  useEffect(() => {
    requestAnimationFrame(fit);
  }, []);

  /* ---------------- teclado ---------------- */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        setSpace(true);
        if (e.target === document.body) e.preventDefault();
      }
      if (e.key === 'Enter' && penRef.current.length) finishPen(false);
      if (e.key === 'Enter' && curveRef.current.length) finishCurve(false);
      if (e.key === 'Escape') {
        if (penRef.current.length) finishPen(false);
        if (curveRef.current.length) finishCurve(false);
        setPick(null);
        setEdit(null);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpace(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  // trocar de ferramenta encerra a caneta / pesponto
  useEffect(() => {
    if (s.tool !== 'pen' && penRef.current.length) finishPen(false);
    if (s.tool !== 'curvature' && curveRef.current.length) finishCurve(false);
    if (s.tool !== 'stitch') setPick(null);
    if (s.tool !== 'direct') setEdit(null);
  }, [s.tool]);

  /* ---------------- coordenadas ---------------- */
  const toDoc = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: v.x + (e.clientX - r.left) / v.z, y: v.y + (e.clientY - r.top) / v.z };
  };
  const px = (n: number) => n / view.z;

  /** Encosta no eixo de simetria quando perto. */
  const snapAxis = (p: Vec2): Vec2 => {
    const st = editor.get();
    return st.symmetry && Math.abs(p.x - st.axis) < 8 / viewRef.current.z ? { x: st.axis, y: p.y } : p;
  };

  /* ---------------- caneta ---------------- */
  function finishPen(close: boolean) {
    const pts = penRef.current;
    setPen([]);
    if (pts.length < 2) return;
    const st = editor.get();
    const path = penPath(pts, close)!;
    const sym = st.symmetry;
    const shape: PathShape = { kind: 'path', id: newId(), path, style: { ...st.style }, ...(sym ? { mirror: st.axis } : {}) };
    if (!close && !(sym && mirrored(path, st.axis).length === 1)) shape.style = { ...shape.style, fill: null };
    addShapes([shape]);
  }

  /* ---------------- curvatura ---------------- */
  function finishCurve(close: boolean) {
    const pts = curveRef.current;
    setCurve([]);
    if (pts.length < 2) return;
    const st = editor.get();
    const path = pathThroughPoints(pts.map((q, i) => ({ p: q.p, corner: q.corner || (!close && (i === 0 || i === pts.length - 1)) })), close);
    const sym = st.symmetry;
    const joins = sym && mirrored(path, st.axis).length === 1;
    addShapes([{ kind: 'path', id: newId(), path, style: { ...st.style, fill: close || joins ? st.style.fill : null }, ...(sym ? { mirror: st.axis } : {}) }]);
  }

  /* ---------------- pesponto ---------------- */
  function stitchSource(t: Target, at: Vec2): StitchPick | null {
    const sh = resolveShape(editor.get().doc, t.sid, t.cid);
    if (!sh || sh.kind !== 'path') return null;
    const pts = flattenPath(sh.path, 0.05);
    const axis = sh.mirror;
    let poly: Vec2[] | null = null;
    if (axis !== undefined && mirrored(sh.path, axis).length === 1) poly = flattenPath(mirrored(sh.path, axis)[0]!, 0.2);
    else if (sh.path.closed) poly = pts;
    void at;
    return { t, pts, s0: 0, axis, poly };
  }

  /** Clique do lado espelhado conta como clique no original. */
  const unmirror = (p: Vec2, pk: StitchPick) => {
    if (pk.axis === undefined) return p;
    const a = projectOn(pk.pts, p).d, b = projectOn(pk.pts, mirrorX(pk.axis)(p)).d;
    return b < a ? mirrorX(pk.axis)(p) : p;
  };

  function makeStitch(pk: StitchPick, s1: number, whole: boolean): StitchShape {
    const st = editor.get();
    const k = 1 / st.doc.scale;
    const total = cumLength(pk.pts)[pk.pts.length - 1]!;
    const [a, b] = whole ? [0, total] : [Math.min(pk.s0, s1), Math.max(pk.s0, s1)];
    // lado de dentro: testa um ponto deslocado para a esquerda no meio do trecho
    let side: 1 | -1 = 1;
    if (pk.poly) {
      const mid = stitchLine(pk.pts, a, b, 0, 1);
      const probe = stitchLine(pk.pts, a, b, Math.max(st.stitch.dist * k, 0.3), 1);
      const m = Math.floor(mid.length / 2);
      side = pointInPoly(probe[m] ?? probe[0]!, pk.poly) ? 1 : -1;
    }
    const src = resolveShape(st.doc, pk.t.sid, pk.t.cid);
    const closed = !!src && src.kind === 'path' && src.path.closed;
    const sd = (side * st.stitch.side) as 1 | -1;
    const line = whole ? stitchLine(pk.pts, 0, total, st.stitch.dist * k, sd) : stitchAlong(pk.pts, closed, a, b, st.stitch.dist * k, sd);
    return {
      kind: 'stitch',
      id: newId(),
      path: polyPath(line, whole && closed),
      stitch: { type: st.stitch.type, gap: st.stitch.gap * k, len: st.stitch.len * k, width: 0.12 * Math.min(2, 10 * k), color: st.stitch.color },
      ...(pk.axis !== undefined ? { mirror: pk.axis } : {}),
    };
  }

  /* ---------------- ponteiro ---------------- */
  const onPointerDown = (e: React.PointerEvent) => {
    const st = editor.get();
    const p = toDoc(e);
    try {
      svgRef.current!.setPointerCapture(e.pointerId);
    } catch {
      /* ponteiro sem captura (ex.: caneta de mesa digitalizadora em alguns sistemas) */
    }
    if (e.button === 1 || space || st.tool === 'hand') {
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, v0: viewRef.current });
      return;
    }
    if (e.button !== 0) return;
    const hit = targetOf(e.target);
    const handle = (e.target as Element).getAttribute?.('data-handle') as Handle | null;
    const anchor = (e.target as Element).getAttribute?.('data-anchor');

    switch (st.tool) {
      case 'select': {
        if (handle) {
          const box = bboxOfShapes(selectedShapes(st));
          if (box) setDrag({ kind: 'scale', h: handle, box, start: p, cur: p, shift: e.shiftKey, alt: e.altKey });
          return;
        }
        if (hit) {
          const layerLocked = findShape(st.doc, hit.sid)?.layer.locked;
          if (layerLocked) {
            editor.set({ selection: e.shiftKey ? st.selection : [] });
            setDrag({ kind: 'marquee', start: p, cur: p, add: e.shiftKey });
            return;
          }
          const sel = st.selection.includes(hit.sid)
            ? e.shiftKey
              ? st.selection.filter((i) => i !== hit.sid)
              : st.selection
            : e.shiftKey
              ? [...st.selection, hit.sid]
              : [hit.sid];
          editor.set({ selection: sel });
          if (e.altKey && sel.includes(hit.sid)) {
            // Alt + arrastar = duplicar
            const copies = selectedShapes({ ...st, selection: sel }).map((x) => ({ ...JSON.parse(JSON.stringify(x)), id: newId() }) as Shape);
            addShapes(copies);
          }
          setDrag({ kind: 'move', start: p, cur: p });
        } else {
          if (!e.shiftKey) editor.set({ selection: [] });
          setDrag({ kind: 'marquee', start: p, cur: p, add: e.shiftKey });
        }
        return;
      }
      case 'direct': {
        if (anchor && edit) {
          const [which, idx] = anchor.split(':') as ['p' | 'c1' | 'c2', string];
          const sh = resolveShape(st.doc, edit.sid, edit.cid);
          if (sh && (sh.kind === 'path' || sh.kind === 'stitch')) setDrag({ kind: 'anchor', t: edit, path0: sh.path, which, idx: Number(idx), start: p, cur: p });
          return;
        }
        if (hit) {
          const sh = resolveShape(st.doc, hit.sid, hit.cid);
          if (sh && (sh.kind === 'path' || sh.kind === 'stitch')) {
            setEdit(hit);
            editor.set({ selection: [hit.sid] });
          } else notify('Use a seleção direta em linhas e contornos');
        } else {
          setEdit(null);
          editor.set({ selection: [] });
        }
        return;
      }
      case 'pen': {
        const q = snapAxis(p);
        const pts = penRef.current;
        if (pts.length >= 2 && dist(q, pts[0]!.p) < 8 / view.z) {
          finishPen(true);
          return;
        }
        setPen([...pts, { p: q }]);
        setDrag({ kind: 'pen', start: q, cur: q });
        return;
      }
      case 'curvature': {
        const q = snapAxis(p);
        const pts = curveRef.current;
        if (pts.length >= 2 && dist(q, pts[0]!.p) < 8 / view.z) {
          finishCurve(true);
          return;
        }
        setCurve([...pts, { p: q, corner: e.altKey }]);
        return;
      }
      case 'pencil':
      case 'brush':
        setDrag({ kind: 'free', pts: [snapAxis(p)] });
        return;
      case 'rect':
      case 'ellipse':
      case 'line':
      case 'arc':
      case 'polygon':
      case 'dim':
        setDrag({ kind: 'shape', tool: st.tool, start: snapAxis(p), cur: snapAxis(p), shift: e.shiftKey, alt: e.altKey });
        return;
      case 'scissors': {
        if (!hit) return;
        const sh = resolveShape(st.doc, hit.sid, hit.cid);
        if (!sh || sh.kind !== 'path') {
          notify('A tesoura corta traços e contornos', 'erro');
          return;
        }
        const target = sh.mirror !== undefined && Math.sign(p.x - sh.mirror) !== Math.sign(flattenPath(sh.path, 1)[0]!.x - sh.mirror) ? mirrorX(sh.mirror)(p) : p;
        const parts = splitPathAt(sh.path, target);
        replaceDeep(hit.sid, hit.cid, (x) =>
          x.kind === 'path' ? parts.map((path, i) => ({ ...x, id: i === 0 ? x.id : newId(), path, subpaths: undefined, style: { ...x.style, fill: path.closed ? x.style.fill : null } })) : [x],
        );
        notify(parts.length === 2 ? 'Traço cortado em dois' : sh.path.closed ? 'Contorno aberto no ponto clicado' : 'O corte caiu na ponta do traço');
        return;
      }
      case 'eyedropper': {
        if (!hit) return;
        const sh = resolveShape(st.doc, hit.sid, hit.cid);
        if (!sh) return;
        if (sh.kind === 'path') {
          editor.set({ style: { ...sh.style } });
          if (st.selection.length) {
            const map = (x: Shape): Shape => (x.kind === 'path' ? { ...x, style: { ...sh.style } } : x.kind === 'group' ? { ...x, children: x.children.map(map) } : x);
            updateShapes(st.selection, map);
            notify('Estilo copiado para a seleção');
          } else notify('Estilo copiado: os próximos desenhos usam este traço');
        } else if (sh.kind === 'stitch') {
          editor.set((s0) => ({ stitch: { ...s0.stitch, type: sh.stitch.type, color: sh.stitch.color, gap: sh.stitch.gap * s0.doc.scale, len: sh.stitch.len * s0.doc.scale } }));
          notify('Pesponto copiado para a ferramenta Pesponto');
        }
        return;
      }
      case 'text': {
        const t: TextShape = { kind: 'text', id: newId(), at: p, text: 'Texto', size: 4, color: st.style.stroke ?? '#1b1b1f' };
        addShapes([t]);
        editor.set({ tool: 'select' });
        notify('Escreva o texto no painel à direita');
        return;
      }
      case 'trim': {
        const sym = st.symmetry && Math.abs(p.x - st.axis) > 1;
        const t: TrimShape = { kind: 'trim', id: newId(), trim: st.trim.kind, at: p, size: trimDefaultSize(st.trim.kind), rot: 0, color: st.trim.color, ...(sym ? { mirror: st.axis } : {}) };
        addShapes([t], false);
        return;
      }
      case 'fill': {
        if (!hit) return;
        const sh = resolveShape(st.doc, hit.sid, hit.cid);
        if (!sh || sh.kind !== 'path') return;
        const closed = sh.path.closed || (sh.mirror !== undefined && mirrored(sh.path, sh.mirror).length === 1);
        if (!closed) {
          notify('O balde pinta formas fechadas', 'erro');
          return;
        }
        updateDeep(hit.sid, hit.cid, (x) => (x.kind === 'path' ? { ...x, style: { ...x.style, fill: st.fill } } : x));
        return;
      }
      case 'stitch': {
        if (!hit) return;
        if (pick && (pick.t.sid !== hit.sid || pick.t.cid !== hit.cid)) setPick(null);
        const base = pick && pick.t.sid === hit.sid && pick.t.cid === hit.cid ? pick : stitchSource(hit, p);
        if (!base) {
          notify('Clique numa linha ou contorno para o pesponto acompanhar', 'erro');
          return;
        }
        const q = unmirror(p, base);
        const s1 = projectOn(base.pts, q).s;
        if (e.altKey) {
          addShapes([makeStitch(base, 0, true)], false);
          setPick(null);
          return;
        }
        if (!pick) {
          setPick({ ...base, s0: s1 });
          return;
        }
        if (Math.abs(s1 - pick.s0) < 0.2) return;
        addShapes([makeStitch(pick, s1, false)], false);
        setPick(null);
        return;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toDoc(e);
    setHover(p);
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const v = d.v0;
      setView({ ...v, x: v.x - (e.clientX - d.sx) / v.z, y: v.y - (e.clientY - d.sy) / v.z });
      return;
    }
    if (d.kind === 'pen') {
      const pts = penRef.current;
      const last = pts[pts.length - 1];
      if (last && dist(p, d.start) > 3 / view.z) {
        const cin = { x: 2 * last.p.x - p.x, y: 2 * last.p.y - p.y };
        setPen([...pts.slice(0, -1), { p: last.p, cout: p, cin }]);
      }
      setDrag({ ...d, cur: p });
      return;
    }
    if (d.kind === 'free') {
      const last = d.pts[d.pts.length - 1]!;
      if (dist(last, p) > 1.2 / view.z) setDrag({ kind: 'free', pts: [...d.pts, p] });
      return;
    }
    if (d.kind === 'scale') setDrag({ ...d, cur: p, shift: e.shiftKey, alt: e.altKey });
    else if (d.kind === 'shape') {
      const mod = { shift: e.shiftKey, alt: e.altKey };
      if ((d.tool === 'line' || d.tool === 'dim') && e.shiftKey) {
        const dx = p.x - d.start.x, dy = p.y - d.start.y;
        setDrag({ ...d, ...mod, cur: Math.abs(dx) > Math.abs(dy) ? { x: p.x, y: d.start.y } : { x: d.start.x, y: p.y } });
      } else if (d.tool === 'polygon' || d.tool === 'arc') setDrag({ ...d, ...mod, cur: p });
      else setDrag({ ...d, ...mod, cur: e.shiftKey && d.tool !== 'line' ? square(d.start, p) : snapAxis(p) });
    }
    else if (d.kind === 'move' && e.shiftKey) {
      const dx = p.x - d.start.x, dy = p.y - d.start.y;
      setDrag({ ...d, cur: Math.abs(dx) > Math.abs(dy) ? { x: p.x, y: d.start.y } : { x: d.start.x, y: p.y } });
    } else setDrag({ ...d, cur: p });
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    const st = editor.get();
    switch (d.kind) {
      case 'move': {
        const dx = d.cur.x - d.start.x, dy = d.cur.y - d.start.y;
        if (Math.hypot(dx, dy) > 1e-9) transformSelected(translateM(dx, dy));
        return;
      }
      case 'scale':
        transformSelected(scaleMatrix(d));
        return;
      case 'marquee': {
        const b = { minX: Math.min(d.start.x, d.cur.x), maxX: Math.max(d.start.x, d.cur.x), minY: Math.min(d.start.y, d.cur.y), maxY: Math.max(d.start.y, d.cur.y) };
        if (b.maxX - b.minX < 1e-6 && b.maxY - b.minY < 1e-6) return;
        const ids = st.doc.layers
          .filter((l) => l.visible && !l.locked)
          .flatMap((l) => l.shapes)
          .filter((x) => {
            const sb = shapeBBox(x);
            return sb && sb.minX < b.maxX && sb.maxX > b.minX && sb.minY < b.maxY && sb.maxY > b.minY;
          })
          .map((x) => x.id);
        editor.set({ selection: d.add ? [...new Set([...st.selection, ...ids])] : ids });
        return;
      }
      case 'free': {
        if (d.pts.length < 2) return;
        const z = viewRef.current.z;
        const first = d.pts[0]!, last = snapAxis(d.pts[d.pts.length - 1]!);
        const pts = [...d.pts.slice(0, -1), last];
        const closed = pts.length > 8 && dist(first, last) < 10 / z;
        const path = freehandPath(pts, st.smooth / z, closed);
        if (!path) return;
        const sym = st.symmetry;
        const joins = sym && mirrored(path, st.axis).length === 1;
        const brush = st.tool === 'brush';
        const style = brush ? { ...st.style, fill: null, brush: { ...st.brush } } : { ...st.style, brush: undefined, fill: closed || joins ? st.style.fill : null };
        addShapes([{ kind: 'path', id: newId(), path, style, ...(sym ? { mirror: st.axis } : {}) }], false);
        return;
      }
      case 'shape': {
        const { start: a, cur: b } = d;
        if (dist(a, b) < 0.5) return;
        if (d.tool === 'dim') {
          const dim: DimShape = { kind: 'dim', id: newId(), a, b, off: 4, color: '#1b1b1f', size: 3.2 };
          addShapes([dim]);
          notify('Cota criada · o valor é a medida real da peça (escala do documento). Dá para trocar o texto no painel.');
          return;
        }
        const path = shapePath(d, st.poly);
        const ext = d.tool === 'polygon' ? { minX: a.x - dist(a, b), maxX: a.x + dist(a, b) } : { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x) };
        const crosses = ext.minX < st.axis - 0.01 && ext.maxX > st.axis + 0.01;
        const sym = st.symmetry && !crosses;
        const open = d.tool === 'line' || d.tool === 'arc';
        const shape: PathShape = { kind: 'path', id: newId(), path, style: { ...st.style, fill: open ? null : st.style.fill }, ...(sym ? { mirror: st.axis } : {}) };
        addShapes([shape]);
        return;
      }
      case 'anchor': {
        const delta = { x: d.cur.x - d.start.x, y: d.cur.y - d.start.y };
        if (Math.hypot(delta.x, delta.y) < 1e-9) return;
        const path = editPath(d.path0, d.which, d.idx, delta);
        updateDeep(d.t.sid, d.t.cid, (x) => (x.kind === 'path' || x.kind === 'stitch' ? { ...x, path } : x));
        return;
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const v = viewRef.current;
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const p = toDoc(e);
      const z = Math.min(200, Math.max(0.1, v.z * Math.exp(-e.deltaY * 0.0025)));
      setView({ z, x: p.x - (p.x - v.x) * (v.z / z), y: p.y - (p.y - v.y) * (v.z / z) });
    } else setView({ ...v, x: v.x + e.deltaX / v.z, y: v.y + e.deltaY / v.z });
  };

  const onDoubleClick = () => {
    if (editor.get().tool === 'pen' && penRef.current.length) finishPen(false);
    if (editor.get().tool === 'curvature' && curveRef.current.length) {
      // o duplo clique acrescentou um ponto repetido no último clique
      setCurve(curveRef.current.slice(0, -1));
      setTimeout(() => finishCurve(false), 0);
    }
  };

  /* ---------------- desenho ---------------- */
  if (cacheScale !== s.doc.scale) {
    cacheScale = s.doc.scale;
    setDimScale(s.doc.scale);
    svgCache = new WeakMap();
  }
  const allShapes = useMemo(() => s.doc.layers.filter((l) => l.visible).flatMap((l) => l.shapes), [s.doc.layers]);
  const defs = useMemo(() => defsSvg(allShapes), [allShapes]);
  const selSet = new Set(s.selection);
  const live: Affine | null =
    drag?.kind === 'move' ? translateM(drag.cur.x - drag.start.x, drag.cur.y - drag.start.y) : drag?.kind === 'scale' ? scaleMatrix(drag) : null;

  const selBox = s.tool === 'select' ? bboxOfShapes(selectedShapes(s)) : null;
  const shownBox = selBox && live ? transformBox(selBox, live) : selBox;
  const editShape = s.tool === 'direct' && edit ? resolveShape(s.doc, edit.sid, edit.cid) : null;
  let editPathNow = editShape && (editShape.kind === 'path' || editShape.kind === 'stitch') ? editShape.path : null;
  if (drag?.kind === 'anchor' && editPathNow) editPathNow = editPath(drag.path0, drag.which, drag.idx, { x: drag.cur.x - drag.start.x, y: drag.cur.y - drag.start.y });
  const penPrev = pen.length ? penPath(hover && drag?.kind !== 'pen' ? [...pen, { p: snapAxis(hover) }] : pen, false) : null;
  const vb = `${view.x} ${view.y} ${size.w / view.z} ${size.h / view.z}`;
  const hs = 7 / view.z;

  const cursor =
    drag?.kind === 'pan' || space || s.tool === 'hand'
      ? 'grab'
      : s.tool === 'select'
        ? 'default'
        : s.tool === 'direct'
          ? 'default'
          : s.tool === 'fill'
            ? 'cell'
            : 'crosshair';

  return (
    <div
      ref={wrap}
      className="stage"
      data-help="stage"
      style={{ cursor }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const at = toDoc(e);
        const files = [...e.dataTransfer.files];
        void (async () => {
          const { importData } = await import('../importers');
          for (const f of files) await importData({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }, at);
        })();
      }}
    >
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        viewBox={vb}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
      >
        <defs dangerouslySetInnerHTML={{ __html: defs }} />
        <rect x={0} y={0} width={s.doc.artboard.w} height={s.doc.artboard.h} className="artboard" />
        {s.doc.layers.map((l) =>
          l.visible ? (
            <g key={l.id} className={l.locked ? 'layer locked' : 'layer'}>
              {l.shapes.map((sh) => (
                <g
                  key={sh.id}
                  data-sid={sh.id}
                  transform={live && selSet.has(sh.id) ? matrixAttr(live) : undefined}
                  dangerouslySetInnerHTML={{ __html: cached(sh) }}
                />
              ))}
            </g>
          ) : null,
        )}

        {s.symmetry && (
          <line x1={s.axis} y1={-1e4} x2={s.axis} y2={1e4} className="axis" strokeWidth={px(1)} strokeDasharray={`${px(6)} ${px(4)}`} />
        )}

        {/* seleção */}
        {shownBox && !drag?.kind.match(/marquee/) && (
          <g className="selbox">
            <rect x={shownBox.minX} y={shownBox.minY} width={shownBox.maxX - shownBox.minX} height={shownBox.maxY - shownBox.minY} strokeWidth={px(1)} fill="none" />
            {!drag &&
              HANDLES.map((h) => {
                const q = handlePos(shownBox, h);
                return <rect key={h} data-handle={h} x={q.x - hs / 2} y={q.y - hs / 2} width={hs} height={hs} strokeWidth={px(1)} style={{ cursor: CURSOR[h] }} />;
              })}
          </g>
        )}

        {/* seleção direta */}
        {editPathNow && (
          <g className="direct">
            <path d={pathD(editPathNow)} fill="none" strokeWidth={px(1.2)} />
            {editPoints(editPathNow).handles.map((h) => (
              <g key={`${h.which}${h.idx}`}>
                <line x1={h.from.x} y1={h.from.y} x2={h.p.x} y2={h.p.y} strokeWidth={px(1)} />
                <circle data-anchor={`${h.which}:${h.idx}`} cx={h.p.x} cy={h.p.y} r={px(4)} strokeWidth={px(1)} />
              </g>
            ))}
            {editPoints(editPathNow).anchors.map((a, i) => (
              <rect key={i} data-anchor={`p:${i}`} x={a.x - hs / 2} y={a.y - hs / 2} width={hs} height={hs} strokeWidth={px(1)} />
            ))}
          </g>
        )}

        {/* caneta */}
        {penPrev && (
          <g className="pen">
            <path d={pathD(penPrev)} fill="none" strokeWidth={px(1.2)} />
            {s.symmetry && <path d={pathD(mirrored(penPrev, s.axis)[1] ?? mirrored(penPrev, s.axis)[0]!)} fill="none" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />}
            {pen.map((q, i) => (
              <rect key={i} x={q.p.x - hs / 2} y={q.p.y - hs / 2} width={hs} height={hs} strokeWidth={px(1)} className={i === 0 ? 'first' : ''} />
            ))}
          </g>
        )}

        {/* forma sendo desenhada */}
        {drag?.kind === 'shape' && <ShapePreview d={drag} w={px(1.2)} axis={s.symmetry ? s.axis : null} poly={s.poly} />}

        {/* lápis / pincel */}
        {drag?.kind === 'free' && (
          <g className="pen">
            <path d={pathD(polyPath(drag.pts))} fill="none" strokeWidth={s.tool === 'brush' ? s.brush.size : px(1.2)} strokeLinecap="round" strokeLinejoin="round" opacity={s.tool === 'brush' ? 0.6 : 1} />
            {s.symmetry && <path d={pathD(polyPath(drag.pts.map(mirrorX(s.axis))))} fill="none" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />}
          </g>
        )}

        {/* curvatura */}
        {curve.length > 0 && (() => {
          const pts = hover ? [...curve, { p: snapAxis(hover), corner: false }] : curve;
          const path = pts.length > 1 ? pathThroughPoints(pts.map((q, i) => ({ p: q.p, corner: q.corner || i === 0 || i === pts.length - 1 })), false) : null;
          return (
            <g className="pen">
              {path && <path d={pathD(path)} fill="none" strokeWidth={px(1.2)} />}
              {path && s.symmetry && <path d={pathD(mirrored(path, s.axis)[1] ?? mirrored(path, s.axis)[0]!)} fill="none" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />}
              {curve.map((q, i) =>
                q.corner ? (
                  <rect key={i} x={q.p.x - hs / 2} y={q.p.y - hs / 2} width={hs} height={hs} strokeWidth={px(1)} className={i === 0 ? 'first' : ''} />
                ) : (
                  <circle key={i} cx={q.p.x} cy={q.p.y} r={hs / 2} strokeWidth={px(1)} className={i === 0 ? 'first' : ''} />
                ),
              )}
            </g>
          );
        })()}

        {/* pesponto: primeiro ponto + prévia */}
        {s.tool === 'stitch' && pick && hover && <StitchPreview pick={pick} hover={unmirror(hover, pick)} st={s} make={makeStitch} r={px(4)} />}

        {drag?.kind === 'marquee' && (
          <rect
            className="marquee"
            x={Math.min(drag.start.x, drag.cur.x)}
            y={Math.min(drag.start.y, drag.cur.y)}
            width={Math.abs(drag.cur.x - drag.start.x)}
            height={Math.abs(drag.cur.y - drag.start.y)}
            strokeWidth={px(1)}
          />
        )}
      </svg>
      <div className="zoom-tag">{Math.round(view.z * 100) / 100} px/mm · {hover ? `${hover.x.toFixed(1)}, ${hover.y.toFixed(1)} mm` : ''}</div>
    </div>
  );
}

/** Caminho da forma arrastada (retângulo, elipse, linha, arco, polígono). */
function shapePath(d: Extract<Drag, { kind: 'shape' }>, poly: EditorState['poly']): Path {
  const { start: a, cur: b } = d;
  switch (d.tool) {
    case 'line':
      return polyPath([a, b]);
    case 'rect':
      return polyPath([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], true);
    case 'arc':
      return arcPath(a, b, !!d.alt);
    case 'polygon': {
      let rot = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90;
      if (d.shift) rot = Math.round(rot / 15) * 15;
      return polygonPath(a, dist(a, b), poly.sides, rot, poly.star ? poly.inner : undefined);
    }
    default:
      return ellipsePath((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2);
  }
}

function ShapePreview({ d, w, axis, poly }: { d: Extract<Drag, { kind: 'shape' }>; w: number; axis: number | null; poly: EditorState['poly'] }) {
  const { start: a, cur: b } = d;
  if (d.tool === 'dim') {
    const dim: DimShape = { kind: 'dim', id: 'prev', a, b, off: 4, color: '#6d7cff', size: 3.2 };
    return <g dangerouslySetInnerHTML={{ __html: shapeSvg(dim) }} />;
  }
  const path = shapePath(d, poly);
  const ext = d.tool === 'polygon' ? [a.x - dist(a, b), a.x + dist(a, b)] : [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const crosses = axis !== null && ext[0]! < axis - 0.01 && ext[1]! > axis + 0.01;
  return (
    <g className="pen">
      <path d={pathD(path)} fill="none" strokeWidth={w} />
      {axis !== null && !crosses && <path d={pathD(mirrored(path, axis)[1]!)} fill="none" strokeWidth={w} strokeDasharray={`${w * 4} ${w * 3}`} />}
    </g>
  );
}

function StitchPreview({ pick, hover, st, make, r }: { pick: StitchPick; hover: Vec2; st: EditorState; make: (p: StitchPick, s1: number, w: boolean) => StitchShape; r: number }) {
  const s1 = projectOn(pick.pts, hover).s;
  const a = stitchLine(pick.pts, pick.s0, pick.s0, 0, 1)[0]!;
  const sh = Math.abs(s1 - pick.s0) > 0.2 ? make(pick, s1, false) : null;
  void st;
  return (
    <g className="stitch-preview">
      {sh && <g dangerouslySetInnerHTML={{ __html: shapeSvg(sh) }} opacity={0.75} />}
      <circle cx={a.x} cy={a.y} r={r} />
    </g>
  );
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): Path {
  const k = 0.5522847498;
  const P = (x: number, y: number) => ({ x: cx + x, y: cy + y });
  return {
    start: P(rx, 0),
    closed: true,
    segments: [
      { kind: 'cubic', c1: P(rx, ry * k), c2: P(rx * k, ry), to: P(0, ry) },
      { kind: 'cubic', c1: P(-rx * k, ry), c2: P(-rx, ry * k), to: P(-rx, 0) },
      { kind: 'cubic', c1: P(-rx, -ry * k), c2: P(-rx * k, -ry), to: P(0, -ry) },
      { kind: 'cubic', c1: P(rx * k, -ry), c2: P(rx, -ry * k), to: P(rx, 0) },
    ],
  };
}

function square(a: Vec2, b: Vec2): Vec2 {
  const d = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  return { x: a.x + Math.sign(b.x - a.x || 1) * d, y: a.y + Math.sign(b.y - a.y || 1) * d };
}

function transformBox(b: BBox, m: Affine): BBox {
  const pts = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ].map((p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }));
  return { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) };
}

function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Usado pelo painel: tamanho real (cm) da seleção na escala do documento. */
export function realSize(b: BBox, scale: number) {
  return { w: ((b.maxX - b.minX) * scale) / 10, h: ((b.maxY - b.minY) * scale) / 10 };
}

