/**
 * Leitura de SVG (Illustrator, CorelDRAW, Inkscape, Figma…) para formas editáveis do Draw.
 * Sem dependências: leitor de XML mínimo, caminhos (M L H V C S Q T A Z), formas básicas,
 * transformações aninhadas, estilos (atributos, style="" e classes de <style>) e unidades.
 */
import type { Path, Vec2 } from '@cad-textil/core';
import { newId } from '../state';
import { type Affine, applyAffine, bboxOfShapes } from './geom';
import type { PathShape, Shape, TextShape } from './types';

/* ------------------------------------------------------------------ */
/* XML                                                                 */
/* ------------------------------------------------------------------ */

export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

export function parseXml(src: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1]!.text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      i = src.indexOf('-->', lt) + 3;
      if (i < 3) break;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt);
      stack[stack.length - 1]!.text += src.slice(lt + 9, end < 0 ? undefined : end);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      // <?xml …?> e <!DOCTYPE …> (pode ter [ … ] dentro)
      let j = lt + 2, depth = 0;
      while (j < src.length && (src[j] !== '>' || depth > 0)) {
        if (src[j] === '[') depth++;
        if (src[j] === ']') depth--;
        j++;
      }
      i = j + 1;
      continue;
    }
    const gt = findTagEnd(src, lt);
    const raw = src.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith('/')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const m = /^([\w:.-]+)/.exec(body);
    if (!m) continue;
    const node: XNode = { name: m[1]!.replace(/^svg:/, ''), attrs: {}, children: [], text: '' };
    const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    while ((a = re.exec(body.slice(m[1]!.length)))) node.attrs[a[1]!] = decodeEntities(a[3] ?? a[4] ?? '');
    stack[stack.length - 1]!.children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

function findTagEnd(src: string, from: number): number {
  let q: string | null = null;
  for (let j = from + 1; j < src.length; j++) {
    const c = src[j]!;
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '>') return j;
  }
  return src.length;
}

/* ------------------------------------------------------------------ */
/* Caminhos                                                            */
/* ------------------------------------------------------------------ */

const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

function tokenizePath(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push(m[1] ?? Number(m[2]));
  return out;
}

type Sub = { start: Vec2; segs: Path['segments']; closed: boolean };

/** Arco elíptico SVG → cúbicas (até 90° cada). */
function arcToCubics(p0: Vec2, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, p: Vec2): Path['segments'] {
  if (rx === 0 || ry === 0 || (p0.x === p.x && p0.y === p.y)) return [{ kind: 'line', to: p }];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0.x - p.x) / 2, dy = (p0.y - p.y) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let k = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) k = -k;
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0.x + p.x) / 2, cy = sin * cx1 + cos * cy1 + (p0.y + p.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const step = dt / n;
  const kk = (4 / 3) * Math.tan(step / 4);
  const pt = (t: number) => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  const der = (t: number) => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos });
  const out: Path['segments'] = [];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * step, b = a + step;
    const pa = pt(a), pb = i === n - 1 ? p : pt(b), da = der(a), db = der(b);
    out.push({ kind: 'cubic', c1: { x: pa.x + kk * da.x, y: pa.y + kk * da.y }, c2: { x: pb.x - kk * db.x, y: pb.y - kk * db.y }, to: pb });
  }
  return out;
}

/** `d` do SVG → subcaminhos (coordenadas do arquivo, sem transformação). */
export function parsePathData(d: string): Sub[] {
  const t = tokenizePath(d);
  const subs: Sub[] = [];
  let cur: Sub | null = null;
  let p: Vec2 = { x: 0, y: 0 };
  let start: Vec2 = { x: 0, y: 0 };
  let lastC: Vec2 | null = null; // última alça cúbica (para S)
  let lastQ: Vec2 | null = null; // último controle quadrático (para T)
  let cmd = '';
  let i = 0;
  const num = () => {
    const v = t[i++];
    if (typeof v !== 'number') throw new Error('caminho SVG inválido');
    return v;
  };
  const ensure = () => {
    if (!cur) {
      cur = { start: { ...p }, segs: [], closed: false };
      subs.push(cur);
    }
    return cur;
  };
  const quad = (q: Vec2, to: Vec2) => {
    ensure().segs.push({ kind: 'cubic', c1: { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) }, c2: { x: to.x + (2 / 3) * (q.x - to.x), y: to.y + (2 / 3) * (q.y - to.y) }, to });
  };
  while (i < t.length) {
    if (typeof t[i] === 'string') cmd = t[i++] as string;
    else if (!cmd) {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const R = (x: number, y: number): Vec2 => (rel ? { x: p.x + x, y: p.y + y } : { x, y });
    switch (cmd.toUpperCase()) {
      case 'M': {
        p = R(num(), num());
        start = { ...p };
        cur = { start: { ...p }, segs: [], closed: false };
        subs.push(cur);
        cmd = rel ? 'l' : 'L'; // pares seguintes são retas
        lastC = lastQ = null;
        continue;
      }
      case 'L': {
        const to = R(num(), num());
        ensure().segs.push({ kind: 'line', to });
        p = to;
        lastC = lastQ = null;
        break;
      }
      case 'H': {
        const x = num();
        const to = { x: rel ? p.x + x : x, y: p.y };
        ensure().segs.push({ kind: 'line', to });
        p = to;
        lastC = lastQ = null;
        break;
      }
      case 'V': {
        const y = num();
        const to = { x: p.x, y: rel ? p.y + y : y };
        ensure().segs.push({ kind: 'line', to });
        p = to;
        lastC = lastQ = null;
        break;
      }
      case 'C': {
        const c1 = R(num(), num()), c2 = R(num(), num()), to = R(num(), num());
        ensure().segs.push({ kind: 'cubic', c1, c2, to });
        p = to;
        lastC = c2;
        lastQ = null;
        break;
      }
      case 'S': {
        const c1 = lastC ? { x: 2 * p.x - lastC.x, y: 2 * p.y - lastC.y } : { ...p };
        const c2 = R(num(), num()), to = R(num(), num());
        ensure().segs.push({ kind: 'cubic', c1, c2, to });
        p = to;
        lastC = c2;
        lastQ = null;
        break;
      }
      case 'Q': {
        const q = R(num(), num()), to = R(num(), num());
        quad(q, to);
        p = to;
        lastQ = q;
        lastC = null;
        break;
      }
      case 'T': {
        const q: Vec2 = lastQ ? { x: 2 * p.x - lastQ.x, y: 2 * p.y - lastQ.y } : { ...p };
        const to = R(num(), num());
        quad(q, to);
        p = to;
        lastQ = q;
        lastC = null;
        break;
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), large = num() !== 0, sweep = num() !== 0;
        const to = R(num(), num());
        ensure().segs.push(...arcToCubics(p, rx, ry, rot, large, sweep, to));
        p = to;
        lastC = lastQ = null;
        break;
      }
      case 'Z': {
        if (cur) {
          const c: Sub = cur;
          const last = c.segs.length ? c.segs[c.segs.length - 1]!.to : c.start;
          if (Math.hypot(last.x - start.x, last.y - start.y) > 1e-9) c.segs.push({ kind: 'line', to: { ...start } });
          c.closed = true;
        }
        p = { ...start };
        cur = null;
        lastC = lastQ = null;
        break;
      }
      default:
        i++;
    }
  }
  return subs.filter((s) => s.segs.length > 0);
}

/* ------------------------------------------------------------------ */
/* Transformações e estilos                                            */
/* ------------------------------------------------------------------ */

const ID: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const mul = (m: Affine, n: Affine): Affine => ({
  a: m.a * n.a + m.c * n.b,
  b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d,
  d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e,
  f: m.b * n.e + m.d * n.f + m.f,
});

export function parseTransform(s: string | undefined): Affine {
  if (!s) return ID;
  let m = ID;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let x: RegExpExecArray | null;
  while ((x = re.exec(s))) {
    const v = (x[2]!.match(NUM) ?? []).map(Number);
    let t = ID;
    switch (x[1]) {
      case 'matrix':
        t = { a: v[0] ?? 1, b: v[1] ?? 0, c: v[2] ?? 0, d: v[3] ?? 1, e: v[4] ?? 0, f: v[5] ?? 0 };
        break;
      case 'translate':
        t = { ...ID, e: v[0] ?? 0, f: v[1] ?? 0 };
        break;
      case 'scale':
        t = { ...ID, a: v[0] ?? 1, d: v[1] ?? v[0] ?? 1 };
        break;
      case 'rotate': {
        const r = ((v[0] ?? 0) * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
        const rot = { a: co, b: si, c: -si, d: co, e: 0, f: 0 };
        t = v.length >= 3 ? mul(mul({ ...ID, e: v[1]!, f: v[2]! }, rot), { ...ID, e: -v[1]!, f: -v[2]! }) : rot;
        break;
      }
      case 'skewX':
        t = { ...ID, c: Math.tan(((v[0] ?? 0) * Math.PI) / 180) };
        break;
      case 'skewY':
        t = { ...ID, b: Math.tan(((v[0] ?? 0) * Math.PI) / 180) };
        break;
    }
    m = mul(m, t);
  }
  return m;
}

interface Paint {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  dash: number[] | null;
  fillRule: 'nonzero' | 'evenodd';
  display: boolean;
  fontSize: number;
}

const INHERIT: Paint = { fill: '#000000', stroke: null, strokeWidth: 1, dash: null, fillRule: 'nonzero', display: true, fontSize: 16 };

/** Regras de classe de <style> (.cls-1{fill:#fff} — o que Illustrator e Corel exportam). */
function parseCss(css: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const decl = parseDecl(m[2]!);
    for (const sel of m[1]!.split(',')) {
      const s = sel.trim();
      if (!s) continue;
      out.set(s, { ...(out.get(s) ?? {}), ...decl });
    }
  }
  return out;
}

function parseDecl(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(';')) {
    const k = part.indexOf(':');
    if (k > 0) out[part.slice(0, k).trim()] = part.slice(k + 1).trim();
  }
  return out;
}

const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', green: '#008000', gray: '#808080', grey: '#808080', yellow: '#ffff00', navy: '#000080', silver: '#c0c0c0' };

/** Cor SVG → '#rrggbb' (ou null para none / gradiente). */
export function normColor(v: string | undefined, current: string | null): string | null | undefined {
  if (v === undefined) return undefined;
  const s = v.trim().toLowerCase();
  if (s === 'none' || s === 'transparent') return null;
  if (s === 'currentcolor') return current;
  if (s.startsWith('url(')) return '#bfbfc6'; // gradiente/padrão: cinza neutro editável
  if (NAMED[s]) return NAMED[s]!;
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  const rgb = /^rgba?\(([^)]*)\)/.exec(s);
  if (rgb) {
    const [r, g, b] = rgb[1]!.split(/[\s,/]+/).map((x) => (x.endsWith('%') ? (parseFloat(x) * 255) / 100 : parseFloat(x)));
    const h = (n: number | undefined) => Math.max(0, Math.min(255, Math.round(n ?? 0))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Unidades                                                            */
/* ------------------------------------------------------------------ */

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 };

function lengthMm(v: string | undefined, pxMm: number): number | null {
  if (!v) return null;
  const m = /^\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  const u = (m[2] ?? '').toLowerCase();
  if (u === '%') return null;
  if (!u || u === 'px') return n * pxMm;
  return UNIT_MM[u] !== undefined ? n * UNIT_MM[u]! : null;
}

/* ------------------------------------------------------------------ */
/* SVG → formas                                                        */
/* ------------------------------------------------------------------ */

export interface SvgImport {
  shapes: Shape[];
  /** Tamanho do desenho importado (mm, em escala real do arquivo). */
  widthMm: number;
  heightMm: number;
  warnings: string[];
}

const SKIP = new Set(['defs', 'clipPath', 'mask', 'symbol', 'marker', 'pattern', 'linearGradient', 'radialGradient', 'filter', 'metadata', 'title', 'desc', 'style', 'script', 'sodipodi:namedview', 'namedview']);

export function importSvg(src: string): SvgImport {
  const root = parseXml(src);
  const svg = findFirst(root, 'svg');
  if (!svg) throw new Error('Este arquivo não é um SVG');
  const warnings = new Set<string>();
  // Illustrator grava 1 px = 1 pt (72 dpi); os demais seguem o padrão CSS (96 dpi)
  const illustrator = /Adobe Illustrator/i.test(src.slice(0, 2000));
  const pxMm = illustrator ? 25.4 / 72 : 25.4 / 96;

  const vb = (svg.attrs.viewBox ?? svg.attrs.viewbox ?? '').match(NUM)?.map(Number);
  const wMm = lengthMm(svg.attrs.width, pxMm);
  const hMm = lengthMm(svg.attrs.height, pxMm);
  let base: Affine = ID;
  let widthMm: number, heightMm: number;
  if (vb && vb.length === 4 && vb[2]! > 0 && vb[3]! > 0) {
    const sx = wMm ? wMm / vb[2]! : hMm ? hMm / vb[3]! : pxMm;
    const sy = hMm ? hMm / vb[3]! : sx;
    const s = Math.min(sx, sy);
    base = { a: s, b: 0, c: 0, d: s, e: -vb[0]! * s, f: -vb[1]! * s };
    widthMm = vb[2]! * s;
    heightMm = vb[3]! * s;
  } else {
    base = { ...ID, a: pxMm, d: pxMm };
    widthMm = wMm ?? 0;
    heightMm = hMm ?? 0;
  }

  const css = new Map<string, Record<string, string>>();
  collectStyles(root, css);
  const ids = new Map<string, XNode>();
  indexIds(root, ids);

  const styleOf = (n: XNode, parent: Paint): Paint => {
    let decl: Record<string, string> = {};
    for (const key of Object.keys(n.attrs)) decl[key] = n.attrs[key]!;
    for (const cls of (n.attrs.class ?? '').split(/\s+/).filter(Boolean)) decl = { ...decl, ...(css.get(`.${cls}`) ?? {}) };
    if (n.attrs.style) decl = { ...decl, ...parseDecl(n.attrs.style) };
    const fill = normColor(decl.fill, parent.stroke);
    const stroke = normColor(decl.stroke, parent.stroke);
    const sw = decl['stroke-width'] !== undefined ? parseFloat(decl['stroke-width']) : parent.strokeWidth;
    const dash = decl['stroke-dasharray'] ? (decl['stroke-dasharray'] === 'none' ? null : (decl['stroke-dasharray'].match(NUM) ?? []).map(Number)) : parent.dash;
    const fs = decl['font-size'] ? parseFloat(decl['font-size']) : parent.fontSize;
    return {
      fill: fill === undefined ? parent.fill : fill,
      stroke: stroke === undefined ? parent.stroke : stroke,
      strokeWidth: Number.isFinite(sw) ? sw : parent.strokeWidth,
      dash,
      fillRule: decl['fill-rule'] === 'evenodd' ? 'evenodd' : decl['fill-rule'] === 'nonzero' ? 'nonzero' : parent.fillRule,
      display: decl.display !== 'none' && decl.visibility !== 'hidden' && parent.display,
      fontSize: Number.isFinite(fs) ? fs : parent.fontSize,
    };
  };

  const walk = (n: XNode, m: Affine, paint: Paint, out: Shape[]) => {
    if (SKIP.has(n.name)) return;
    const st = styleOf(n, paint);
    if (!st.display) return;
    const mm = mul(m, parseTransform(n.attrs.transform));
    switch (n.name) {
      case 'svg':
      case 'g':
      case 'a':
      case 'switch': {
        const kids: Shape[] = [];
        for (const c of n.children) walk(c, mm, st, kids);
        if (!kids.length) return;
        const label = n.attrs['inkscape:label'] ?? n.attrs['data-name'] ?? n.attrs.id;
        if (n.name === 'g' && kids.length > 1) out.push({ kind: 'group', id: newId(), name: label, children: kids });
        else out.push(...kids);
        return;
      }
      case 'use': {
        const ref = (n.attrs.href ?? n.attrs['xlink:href'] ?? '').replace(/^#/, '');
        const target = ids.get(ref);
        if (!target) return;
        const t = mul(mm, { ...ID, e: num(n.attrs.x), f: num(n.attrs.y) });
        walk(target.name === 'symbol' ? { ...target, name: 'g' } : target, t, st, out);
        return;
      }
      case 'text': {
        const text = textOf(n).trim();
        if (!text) return;
        const f = applyAffine(mm);
        const at = f({ x: num(n.attrs.x?.split(/[\s,]+/)[0]), y: num(n.attrs.y?.split(/[\s,]+/)[0]) });
        const k = Math.sqrt(Math.abs(mm.a * mm.d - mm.b * mm.c));
        const t: TextShape = { kind: 'text', id: newId(), at, text, size: st.fontSize * k, color: st.fill ?? '#000000' };
        out.push(t);
        return;
      }
      case 'image':
        warnings.add('imagens dentro do SVG foram ignoradas (importe a imagem separada)');
        return;
    }
    const subs = shapeSubpaths(n);
    if (!subs) return;
    if (!subs.length) return;
    const f = applyAffine(mm);
    const k = Math.sqrt(Math.abs(mm.a * mm.d - mm.b * mm.c));
    const paths: Path[] = subs.map((s) => ({
      start: f(s.start),
      closed: s.closed,
      segments: s.segs.map((g) => (g.kind === 'line' ? { kind: 'line', to: f(g.to) } : { kind: 'cubic', c1: f(g.c1), c2: f(g.c2), to: f(g.to) })),
    }));
    if (!st.fill && !st.stroke) return;
    const shape: PathShape = {
      kind: 'path',
      id: newId(),
      name: n.attrs['data-name'] ?? n.attrs['inkscape:label'],
      path: paths[0]!,
      ...(paths.length > 1 ? { subpaths: paths.slice(1), fillRule: st.fillRule } : st.fillRule === 'evenodd' ? { fillRule: 'evenodd' as const } : {}),
      style: {
        stroke: st.stroke,
        width: st.stroke ? Math.max(0.01, st.strokeWidth * k) : 0,
        fill: st.fill ? { kind: 'solid', color: st.fill } : null,
        ...(st.dash && st.dash.length && st.dash.some((x) => x > 0) ? { dash: st.dash.map((x) => x * k) } : {}),
      },
    };
    out.push(shape);
  };

  const shapes: Shape[] = [];
  for (const c of svg.children) walk(c, base, styleOf(svg, INHERIT), shapes);
  if (!widthMm || !heightMm) {
    const b = bboxOfShapes(shapes);
    widthMm = b ? b.maxX - b.minX : 0;
    heightMm = b ? b.maxY - b.minY : 0;
  }
  return { shapes, widthMm, heightMm, warnings: [...warnings] };
}

const num = (v: string | undefined) => (v === undefined || v === '' ? 0 : parseFloat(v) || 0);

function textOf(n: XNode): string {
  return n.text + n.children.map(textOf).join('');
}

function findFirst(n: XNode, name: string): XNode | null {
  if (n.name === name) return n;
  for (const c of n.children) {
    const r = findFirst(c, name);
    if (r) return r;
  }
  return null;
}

function collectStyles(n: XNode, out: Map<string, Record<string, string>>) {
  if (n.name === 'style') for (const [k, v] of parseCss(n.text)) out.set(k, { ...(out.get(k) ?? {}), ...v });
  n.children.forEach((c) => collectStyles(c, out));
}

function indexIds(n: XNode, out: Map<string, XNode>) {
  if (n.attrs.id) out.set(n.attrs.id, n);
  n.children.forEach((c) => indexIds(c, out));
}

/** Formas básicas → subcaminhos. `null` = não é forma. */
function shapeSubpaths(n: XNode): Sub[] | null {
  const A = n.attrs;
  switch (n.name) {
    case 'path':
      return A.d ? parsePathData(A.d) : [];
    case 'rect': {
      const x = num(A.x), y = num(A.y), w = num(A.width), h = num(A.height);
      if (w <= 0 || h <= 0) return [];
      let rx = A.rx !== undefined ? num(A.rx) : A.ry !== undefined ? num(A.ry) : 0;
      let ry = A.ry !== undefined ? num(A.ry) : rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (!rx || !ry) return parsePathData(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
      return parsePathData(`M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`);
    }
    case 'circle':
    case 'ellipse': {
      const cx = num(A.cx), cy = num(A.cy);
      const rx = n.name === 'circle' ? num(A.r) : num(A.rx), ry = n.name === 'circle' ? num(A.r) : num(A.ry);
      if (rx <= 0 || ry <= 0) return [];
      return parsePathData(`M${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy + ry}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy - ry}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}Z`);
    }
    case 'line':
      return parsePathData(`M${num(A.x1)} ${num(A.y1)}L${num(A.x2)} ${num(A.y2)}`);
    case 'polyline':
    case 'polygon': {
      const v = (A.points ?? '').match(NUM)?.map(Number) ?? [];
      if (v.length < 4) return [];
      let d = `M${v[0]} ${v[1]}`;
      for (let i = 2; i + 1 < v.length; i += 2) d += `L${v[i]} ${v[i + 1]}`;
      return parsePathData(n.name === 'polygon' ? d + 'Z' : d);
    }
    default:
      return null;
  }
}
