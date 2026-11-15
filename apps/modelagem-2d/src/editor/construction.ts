/**
 * CONSTRUÇÃO (fluxo linear, como no papel e no Audaces): retângulo base → pontos por coordenada
 * → retas e curvas entre os pontos → extrair molde clicando dentro da área fechada.
 *
 * O estado da operação em andamento (referência, alvo, valores travados da caixa de coordenadas)
 * fica aqui; o desenho e os cliques ficam no Canvas.
 */
import { useSyncExternalStore } from 'react';
import { type CLine, type CPoint, type Construction, type Path, type Vec2, emptyConstruction, pathThroughPoints, polyline } from '@cad-textil/core';
import { Store, commit, editor, newId, notify } from './store';

export type CTool = 'cPoint' | 'cLine' | 'cCurve' | 'cRect' | 'extract';
export const CONS_TOOLS = new Set<string>(['cPoint', 'cLine', 'cCurve', 'cRect', 'extract']);

/** Valores travados na caixa de coordenadas (mm e graus). */
export interface Locks {
  dx?: number;
  dy?: number;
  a?: number;
  d?: number;
}

/** Linhas e pontos da construção selecionados. */
export interface ConsSel {
  lines: string[];
  points: string[];
}
export const NO_SEL: ConsSel = { lines: [], points: [] };
export const hasSel = (s: ConsSel) => s.lines.length + s.points.length > 0;

export interface ConsState {
  /** Ponto de referência (1º clique) ou último ponto da reta/curva. */
  anchor: Vec2 | null;
  /** O que o 1º clique atraiu (canto, meio, ponto…). */
  refLabel: string;
  /** Onde o próximo ponto cai (cursor + valores travados). */
  target: Vec2 | null;
  /** Posição do mouse (com ímã), para refazer o alvo quando um valor é digitado. */
  cursor: Vec2 | null;
  locks: Locks;
  /** Curva em andamento: pontos por onde ela passa. */
  pts: Vec2[];
  /** Extrair molde: cliques dentro das áreas e o contorno resultante. */
  insides: Vec2[];
  region: Path | null;
  /** Elementos de construção selecionados (Seleção). */
  sel: ConsSel;
}

export const consStore = new Store<ConsState>({ anchor: null, refLabel: '', target: null, cursor: null, locks: {}, pts: [], insides: [], region: null, sel: NO_SEL });
export const useCons = () => useSyncExternalStore(consStore.subscribe, consStore.get);

export function resetOp(keepLocks = false) {
  consStore.set((s) => ({ anchor: null, refLabel: '', target: null, pts: [], insides: [], region: null, locks: keepLocks ? s.locks : {} }));
}

/** Trava/destrava valores da caixa e refaz o alvo na hora (Dx/Dy e distância/ângulo não se misturam). */
export function setLocks(patch: Locks, clear: (keyof Locks)[] = []) {
  consStore.set((s) => {
    const polar = 'a' in patch || 'd' in patch;
    const cart = 'dx' in patch || 'dy' in patch;
    const base: Locks = polar ? { a: s.locks.a, d: s.locks.d } : cart ? { dx: s.locks.dx, dy: s.locks.dy } : { ...s.locks };
    const locks: Locks = { ...base, ...patch };
    for (const k of clear) delete locks[k];
    for (const k of Object.keys(locks) as (keyof Locks)[]) if (locks[k] === undefined) delete locks[k];
    const target = s.anchor && s.cursor ? (Object.keys(locks).length ? solveTarget(s.anchor, s.cursor, locks) : s.cursor) : s.target;
    return { locks, target };
  });
}

/** Onde o ponto cai: a partir da referência, com os valores travados; o sinal segue o lado do mouse. */
export function solveTarget(anchor: Vec2, cursor: Vec2, L: Locks): Vec2 {
  if (L.d !== undefined || L.a !== undefined) {
    const v = { x: cursor.x - anchor.x, y: cursor.y - anchor.y };
    const ang = L.a !== undefined ? (L.a * Math.PI) / 180 : Math.atan2(v.y, v.x);
    const d = L.d !== undefined ? Math.abs(L.d) : Math.hypot(v.x, v.y);
    return { x: anchor.x + Math.cos(ang) * d, y: anchor.y + Math.sin(ang) * d };
  }
  const sx = Math.sign(cursor.x - anchor.x) || 1, sy = Math.sign(cursor.y - anchor.y) || 1;
  return { x: L.dx !== undefined ? anchor.x + sx * Math.abs(L.dx) : cursor.x, y: L.dy !== undefined ? anchor.y + sy * Math.abs(L.dy) : cursor.y };
}

/** Sem valores travados, a reta gruda em 0°, 45°, 90°… quando o mouse passa perto (tolerância em graus). */
export function snapAngle(anchor: Vec2, p: Vec2, tolDeg = 2.5): Vec2 {
  const v = { x: p.x - anchor.x, y: p.y - anchor.y };
  const d = Math.hypot(v.x, v.y);
  if (d < 1e-6) return p;
  const a = (Math.atan2(v.y, v.x) * 180) / Math.PI;
  const r = Math.round(a / 45) * 45;
  if (Math.abs(a - r) > tolDeg) return p;
  const rr = (r * Math.PI) / 180;
  return { x: anchor.x + Math.cos(rr) * d, y: anchor.y + Math.sin(rr) * d };
}

/* ---------------- alterações no documento ---------------- */

const consOf = (): Construction => editor.get().doc.construction ?? emptyConstruction();

function commitCons(f: (c: Construction) => Construction) {
  const s = editor.get();
  commit({ ...s.doc, construction: f(consOf()) });
}

export function addPoint(p: Vec2) {
  const pt: CPoint = { id: newId(), p };
  commitCons((c) => ({ ...c, points: [...c.points, pt] }));
}

/** Pontos novos nas pontas (sem repetir um ponto que já esteja ali). */
function endPoints(c: Construction, ps: Vec2[]): CPoint[] {
  const out: CPoint[] = [];
  for (const p of ps) {
    const taken = [...c.points.map((q) => q.p), ...out.map((q) => q.p)].some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.05);
    if (!taken) out.push({ id: newId(), p });
  }
  return out;
}

/** Reta com um ponto no começo e outro no fim. */
export function addLine(a: Vec2, b: Vec2) {
  const l: CLine = { id: newId(), path: polyline([a, b], false) };
  commitCons((c) => ({ ...c, lines: [...c.lines, l], points: [...c.points, ...endPoints(c, [a, b])] }));
}

const curvePath = (pts: Vec2[]): Path => pathThroughPoints(pts.map((p, i) => ({ p, corner: i === 0 || i === pts.length - 1 })), false);
const endsOf = (l: CLine): [Vec2, Vec2] => [l.path.start, l.path.segments[l.path.segments.length - 1]?.to ?? l.path.start];

/** Transforma a reta em curva: ganha um ponto no meio, que dá para arrastar. */
export function lineToCurve(id: string) {
  commitCons((c) => ({
    ...c,
    lines: c.lines.map((l) => {
      if (l.id !== id || l.through) return l;
      const [a, b] = endsOf(l);
      const through = [a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, b];
      return { ...l, through, path: curvePath(through) };
    }),
  }));
}

/** Volta a curva para reta (das pontas). */
export function curveToLine(id: string) {
  commitCons((c) => ({ ...c, lines: c.lines.map((l) => (l.id === id && l.through ? { id: l.id, path: polyline(endsOf(l), false) } : l)) }));
}

/** Pontos de passagem novos (arrastar um ponto da curva). Sem histórico: o arraste fecha com endLive. */
export function withThrough(c: Construction, id: string, through: Vec2[]): Construction {
  return { ...c, lines: c.lines.map((l) => (l.id === id ? { ...l, through, path: curvePath(through) } : l)) };
}

/** Acrescenta um ponto de passagem na curva, perto de `at` (entre os dois pontos de passagem certos). */
export function addThroughPoint(id: string, at: Vec2) {
  commitCons((c) => {
    const l = c.lines.find((x) => x.id === id);
    if (!l?.through) return c;
    // posição ao longo da curva: entre quais pontos de passagem o clique cai
    const t = l.through;
    let best = 0, bd = Infinity;
    for (let i = 0; i + 1 < t.length; i++) {
      const a = t[i]!, b = t[i + 1]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const u = Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(at.x - (a.x + dx * u), at.y - (a.y + dy * u));
      if (d < bd) [bd, best] = [d, i];
    }
    const through = [...t.slice(0, best + 1), at, ...t.slice(best + 1)];
    return withThrough(c, id, through);
  });
}

export function addCurve(pts: Vec2[]) {
  const l: CLine = { id: newId(), path: curvePath(pts), through: pts };
  commitCons((c) => ({ ...c, lines: [...c.lines, l], points: [...c.points, ...endPoints(c, [pts[0]!, pts[pts.length - 1]!])] }));
}

export function addRect(a: Vec2, b: Vec2) {
  const c4 = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  const lines: CLine[] = c4.map((p, i) => ({ id: newId(), path: polyline([p, c4[(i + 1) % 4]!], false) }));
  const points: CPoint[] = c4.map((p) => ({ id: newId(), p }));
  commitCons((c) => ({ ...c, lines: [...c.lines, ...lines], points: [...c.points, ...points] }));
}

export function deleteSelected(): boolean {
  const sel = consStore.get().sel;
  if (!hasSel(sel)) return false;
  const n = sel.lines.length + sel.points.length;
  commitCons((c) => ({ lines: c.lines.filter((l) => !sel.lines.includes(l.id)), points: c.points.filter((p) => !sel.points.includes(p.id)) }));
  consStore.set({ sel: NO_SEL });
  notify(`${n} ${n === 1 ? 'elemento apagado' : 'elementos apagados'} da construção`);
  return true;
}

/** Seleciona (ou soma/tira com `toggle`) linhas e pontos. */
export function selectCons(add: Partial<ConsSel>, toggle = false) {
  consStore.set((s) => {
    if (!toggle) return { sel: { lines: add.lines ?? [], points: add.points ?? [] } };
    const flip = (cur: string[], xs: string[] = []) => xs.reduce((acc, id) => (acc.includes(id) ? acc.filter((x) => x !== id) : [...acc, id]), cur);
    return { sel: { lines: flip(s.sel.lines, add.lines), points: flip(s.sel.points, add.points) } };
  });
}

/** Tudo o que está ligado a uma linha (pontas encostadas): o retângulo inteiro, por exemplo, e os pontos nele. */
export function connectedTo(lineId: string): ConsSel {
  const c = consOf();
  const ends = (l: CLine) => [l.path.start, l.path.segments[l.path.segments.length - 1]?.to ?? l.path.start];
  const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) < 0.05;
  const picked = new Set([lineId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const l of c.lines) {
      if (picked.has(l.id)) continue;
      const touches = c.lines.some((m) => picked.has(m.id) && ends(l).some((p) => ends(m).some((q) => near(p, q))));
      if (touches) {
        picked.add(l.id);
        grew = true;
      }
    }
  }
  const lineEnds = c.lines.filter((l) => picked.has(l.id)).flatMap(ends);
  return { lines: [...picked], points: c.points.filter((p) => lineEnds.some((q) => near(p.p, q))).map((p) => p.id) };
}

export function clearConstruction() {
  commitCons(() => emptyConstruction());
  resetOp();
}

/** Pontos de passagem de uma curva da construção (para editar arrastando). */
export const curveThrough = (l: CLine) => l.through ?? [];
