/**
 * DXF-AAMA (ASTM D6673): troca de moldes com outros CADs de confecção
 * (Audaces, Gerber, Lectra, Optitex, CLO…).
 *
 * Cada molde é um BLOCK (um por tamanho, quando graduado) com as camadas:
 *   1  linha de corte (contorno)        2  pontos de canto (turn points)
 *   3  pontos de curva                  4  piques
 *   7  fio do tecido                    8  linhas internas (pences, marcações)
 *   13 furos                            14 linha de costura
 * e textos "Piece Name:", "Quantity:", "Size:", "Category:", "Annotation:".
 * Geometria em milímetros ("Units: METRIC"), Y para cima — igual ao núcleo.
 */
import { type Path, type Vec2, add, bboxOfPoints, cross, dist, flattenPath, flattenWithEdges, lerp, normalize, polyline, scale, signedArea, sub } from './geometry.js';
import { type Decomposed, closestOnPath, compose, edgeCount, normalizeClosed, notchGeometry, pointOnEdge, vertices } from './edit.js';
import { type Grading, allSizes } from './grading.js';
import { type Piece, type PatternDocument, cutLine, edgeSeam, sewLine } from './pattern.js';
import { dartGeometry, isSmoothVertex } from './modelagem.js';
import { simplifyPolyline } from './precisao.js';
import { fitCubics } from './fit.js';

/* ================================================================== */
/* ESCRITA                                                             */
/* ================================================================== */

export interface DxfExportOptions {
  /** Nome do modelo/coleção (texto "Style Name"). */
  styleName?: string;
  /** Graduados: exportar todos os tamanhos (padrão) ou só o base. */
  sizes?: 'all' | 'base';
  /** Data de criação (padrão: hoje). */
  date?: Date;
  /** Tolerância de achatamento das curvas (mm). */
  toleranceMm?: number;
}

const LAYERS = ['1', '2', '3', '4', '7', '8', '13', '14'] as const;

const num = (n: number) => {
  const s = (Math.round(n * 1e4) / 1e4).toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

class DxfWriter {
  out: string[] = [];
  g(code: number, value: string | number) {
    this.out.push(String(code), typeof value === 'number' ? num(value) : value);
  }
  point(layer: string, p: Vec2, angleDeg?: number) {
    this.g(0, 'POINT');
    this.g(8, layer);
    this.g(10, p.x);
    this.g(20, p.y);
    this.g(30, 0);
    if (angleDeg !== undefined) this.g(50, angleDeg);
  }
  line(layer: string, a: Vec2, b: Vec2) {
    this.g(0, 'LINE');
    this.g(8, layer);
    this.g(10, a.x);
    this.g(20, a.y);
    this.g(30, 0);
    this.g(11, b.x);
    this.g(21, b.y);
    this.g(31, 0);
  }
  polyline(layer: string, pts: Vec2[], closed: boolean) {
    this.g(0, 'POLYLINE');
    this.g(8, layer);
    this.g(66, 1);
    this.g(10, 0);
    this.g(20, 0);
    this.g(30, 0);
    this.g(70, closed ? 1 : 0);
    for (const p of pts) {
      this.g(0, 'VERTEX');
      this.g(8, layer);
      this.g(10, p.x);
      this.g(20, p.y);
      this.g(30, 0);
    }
    this.g(0, 'SEQEND');
    this.g(8, layer);
  }
  text(layer: string, at: Vec2, text: string, h = 5) {
    this.g(0, 'TEXT');
    this.g(8, layer);
    this.g(10, at.x);
    this.g(20, at.y);
    this.g(30, 0);
    this.g(40, h);
    this.g(1, text);
  }
}

/** Ângulo (graus) do pique: direção para dentro do molde. */
function notchAngle(inward: Vec2) {
  return ((Math.atan2(inward.y, inward.x) * 180) / Math.PI + 360) % 360;
}

/** Vértices do contorno marcados: canto (camada 2) ou ponto de curva (camada 3). */
function knotMarks(piece: Piece, line: Vec2[]): { corners: Vec2[]; smooth: Vec2[] } {
  const corners: Vec2[] = [], smooth: Vec2[] = [];
  vertices(piece.outline).forEach((p, i) => {
    if (!line.some((q) => dist(q, p) < 1e-6)) return;
    (isSmoothVertex(piece.outline, i) ? smooth : corners).push(p);
  });
  return { corners, smooth };
}

function hasSeam(piece: Piece) {
  return piece.seamAllowanceMm > 0 || Object.values(piece.seamByEdge ?? {}).some((d) => d > 0);
}

function blockName(name: string, size: string, used: Set<string>) {
  const base = `${name}${size ? '_' + size : ''}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 28) || 'PECA';
  let n = base, k = 2;
  while (used.has(n)) n = `${base}_${k++}`;
  used.add(n);
  return n;
}

function writePieceBlock(w: DxfWriter, piece: Piece, name: string, size: string, tol: number) {
  w.g(0, 'BLOCK');
  w.g(8, '1');
  w.g(2, name);
  w.g(70, 0);
  w.g(10, 0);
  w.g(20, 0);
  w.g(30, 0);
  w.g(3, name);

  const cut = cutLine(piece, tol);
  const seam = hasSeam(piece);
  const sew = seam ? sewLine(piece, tol) : null;
  w.polyline('1', cut, true);
  if (sew) w.polyline('14', sew, true);
  // pontos de canto/curva (no contorno base — linha de corte quando não há margem, senão costura)
  const marks = knotMarks(piece, sew ?? cut);
  for (const p of marks.corners) w.point('2', p);
  for (const p of marks.smooth) w.point('3', p);
  // piques: na linha de corte, com ângulo apontando para dentro
  for (const n of piece.notches) {
    const g = notchGeometry(piece, n);
    const inward = normalize(g.inward);
    w.point('4', add(g.at, scale(inward, -edgeSeam(piece, n.edge))), notchAngle(inward));
  }
  if (piece.grainline) w.line('7', piece.grainline[0], piece.grainline[1]);
  for (const path of piece.internals) w.polyline('8', flattenPath(path, tol), path.closed);
  for (const d of piece.darts ?? []) {
    if (d.kind === 'recortada') continue; // as pernas já são a linha de corte
    const g = dartGeometry(piece, d);
    w.polyline('8', [g.legA, g.apex, g.legB], false);
    const mouth = lerp(g.legA, g.legB, 0.5);
    w.point('13', add(g.apex, scale(normalize(sub(mouth, g.apex)), 10)));
  }
  for (const q of piece.drills ?? []) w.point('13', q);
  const bb = bboxOfPoints(cut);
  const c = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
  const texts = [
    `Piece Name: ${piece.name}`,
    `Quantity: ${piece.quantity}`,
    ...(size ? [`Size: ${size}`] : []),
    ...(piece.group ? [`Category: ${piece.group}`] : []),
    ...(piece.cutInPairs ? ['Annotation: par espelhado'] : []),
    ...(piece.notes ? piece.notes.split(/\r?\n/).filter(Boolean).map((l) => `Annotation: ${l}`) : []),
  ];
  texts.forEach((t, i) => w.text('1', { x: c.x, y: c.y - i * 8 }, t, 5));
  w.g(0, 'ENDBLK');
  w.g(8, '1');
}

/** Gera o DXF-AAMA (texto). Para gravar, use `encodeDxf` (Windows-1252, padrão do R12). */
export function exportDxfAama(doc: PatternDocument, pieces: Piece[] = doc.pieces, opts: DxfExportOptions = {}): string {
  const tol = opts.toleranceMm ?? 0.05;
  const used = new Set<string>();
  const blocks: { name: string; piece: Piece; size: string }[] = [];
  let sample = '';
  for (const p of pieces) {
    const sized = p.grading && opts.sizes !== 'base' ? allSizes(p) : [{ size: p.grading ? p.grading.sizes[p.grading.base]! : '', piece: p }];
    if (p.grading && !sample) sample = p.grading.sizes[p.grading.base]!;
    for (const s of sized) blocks.push({ name: blockName(p.name, s.size, used), piece: { ...s.piece, name: p.name }, size: s.size });
  }
  const all = blocks.flatMap((b) => cutLine(b.piece, 0.5));
  const bb = all.length ? bboxOfPoints(all) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  const w = new DxfWriter();
  w.g(0, 'SECTION');
  w.g(2, 'HEADER');
  w.g(9, '$ACADVER');
  w.g(1, 'AC1009');
  w.g(9, '$DWGCODEPAGE');
  w.g(3, 'ANSI_1252');
  w.g(9, '$INSBASE');
  w.g(10, 0);
  w.g(20, 0);
  w.g(30, 0);
  w.g(9, '$EXTMIN');
  w.g(10, bb.minX);
  w.g(20, bb.minY);
  w.g(30, 0);
  w.g(9, '$EXTMAX');
  w.g(10, bb.maxX);
  w.g(20, bb.maxY);
  w.g(30, 0);
  w.g(0, 'ENDSEC');

  w.g(0, 'SECTION');
  w.g(2, 'TABLES');
  w.g(0, 'TABLE');
  w.g(2, 'LTYPE');
  w.g(70, 1);
  w.g(0, 'LTYPE');
  w.g(2, 'CONTINUOUS');
  w.g(70, 0);
  w.g(3, 'Solid line');
  w.g(72, 65);
  w.g(73, 0);
  w.g(40, 0);
  w.g(0, 'ENDTAB');
  w.g(0, 'TABLE');
  w.g(2, 'LAYER');
  w.g(70, LAYERS.length);
  for (const l of LAYERS) {
    w.g(0, 'LAYER');
    w.g(2, l);
    w.g(70, 0);
    w.g(62, 7);
    w.g(6, 'CONTINUOUS');
  }
  w.g(0, 'ENDTAB');
  w.g(0, 'ENDSEC');

  w.g(0, 'SECTION');
  w.g(2, 'BLOCKS');
  for (const b of blocks) writePieceBlock(w, b.piece, b.name, b.size, tol);
  w.g(0, 'ENDSEC');

  w.g(0, 'SECTION');
  w.g(2, 'ENTITIES');
  for (const b of blocks) {
    w.g(0, 'INSERT');
    w.g(8, '1');
    w.g(2, b.name);
    w.g(10, 0);
    w.g(20, 0);
    w.g(30, 0);
  }
  const d = opts.date ?? new Date();
  const date = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  const head = [
    'ASTM/D13Proposal 1 Version: D 6673-04',
    `Product: Andromeda Moldes`,
    `Style Name: ${opts.styleName ?? doc.name}`,
    `Creation Date: ${date}`,
    ...(sample ? [`Sample Size: ${sample}`] : []),
    'Grading Rule Table:',
    'Units: METRIC',
  ];
  head.forEach((t, i) => w.text('1', { x: bb.minX, y: bb.minY - 20 - i * 8 }, t, 5));
  w.g(0, 'ENDSEC');
  w.g(0, 'EOF');
  return w.out.join('\r\n') + '\r\n';
}

/* ------------------------------------------------------------------ */
/* Codificação (DXF R12 = Windows-1252; acentos do português cabem)    */
/* ------------------------------------------------------------------ */

const CP1252_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89,
  0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Texto → bytes Windows-1252; caracteres fora da tabela viram \U+XXXX (padrão AutoCAD). */
export function encodeDxf(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) bytes.push(c);
    else if (CP1252_EXTRA[c] !== undefined) bytes.push(CP1252_EXTRA[c]!);
    else for (const b of `\\U+${c.toString(16).toUpperCase().padStart(4, '0')}`) bytes.push(b.charCodeAt(0));
  }
  return new Uint8Array(bytes);
}

/** Bytes → texto: UTF-8 se for válido, senão Windows-1252. */
export function decodeDxf(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/* ================================================================== */
/* LEITURA                                                             */
/* ================================================================== */

interface Ent {
  type: string;
  layer: string;
  /** Pontos (já em coordenadas do desenho). */
  pts: Vec2[];
  closed: boolean;
  text?: string;
  angle?: number;
}

interface Rec {
  type: string;
  codes: [number, string][];
}

function tokenize(text: string): [number, string][] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i]!.trim(), 10);
    if (Number.isNaN(code)) throw new Error(`DXF inválido perto da linha ${i + 1}`);
    out.push([code, lines[i + 1]!.replace(/^\s+|\s+$/g, '')]);
  }
  return out;
}

/** Agrupa em registros (cada código 0 começa um). */
function records(pairs: [number, string][]): Rec[] {
  const out: Rec[] = [];
  let cur: Rec | null = null;
  for (const [c, v] of pairs) {
    if (c === 0) {
      cur = { type: v.toUpperCase(), codes: [] };
      out.push(cur);
    } else cur?.codes.push([c, v]);
  }
  return out;
}

const get = (r: Rec, code: number, def = '') => r.codes.find((c) => c[0] === code)?.[1] ?? def;
const getN = (r: Rec, code: number, def = 0) => {
  const v = r.codes.find((c) => c[0] === code)?.[1];
  const n = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : def;
};

function unescapeText(s: string) {
  return s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/%%[dD]/g, '°');
}

/** Pontos de um arco definido por "bulge" entre a e b. */
function bulgeArc(a: Vec2, b: Vec2, bulge: number): Vec2[] {
  const theta = 4 * Math.atan(bulge);
  const chord = dist(a, b);
  if (chord < 1e-12 || Math.abs(theta) < 1e-9) return [];
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mid = lerp(a, b, 0.5);
  const n = normalize({ x: -(b.y - a.y), y: b.x - a.x });
  const h = r * Math.cos(Math.abs(theta) / 2) * Math.sign(bulge);
  const c = add(mid, scale(n, h));
  const a0 = Math.atan2(a.y - c.y, a.x - c.x);
  const steps = Math.max(4, Math.ceil(Math.abs(theta) / (Math.PI / 36)));
  const out: Vec2[] = [];
  for (let k = 1; k < steps; k++) {
    const t = a0 + (theta * k) / steps;
    out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
  }
  return out;
}

function withBulges(vs: { p: Vec2; bulge: number }[], closed: boolean): Vec2[] {
  const out: Vec2[] = [];
  vs.forEach((v, i) => {
    out.push(v.p);
    const next = vs[i + 1] ?? (closed ? vs[0] : undefined);
    if (next && v.bulge) out.push(...bulgeArc(v.p, next.p, v.bulge));
  });
  return out;
}

/** Converte registros de uma seção/bloco em entidades simples. */
function entitiesOf(recs: Rec[]): { ents: Ent[]; inserts: { name: string; at: Vec2; sx: number; sy: number; rot: number }[] } {
  const ents: Ent[] = [];
  const inserts: { name: string; at: Vec2; sx: number; sy: number; rot: number }[] = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i]!;
    const layer = get(r, 8, '0');
    switch (r.type) {
      case 'POLYLINE': {
        const closed = (getN(r, 70) & 1) === 1;
        const vs: { p: Vec2; bulge: number }[] = [];
        while (recs[i + 1]?.type === 'VERTEX') {
          const v = recs[++i]!;
          vs.push({ p: { x: getN(v, 10), y: getN(v, 20) }, bulge: getN(v, 42) });
        }
        if (recs[i + 1]?.type === 'SEQEND') i++;
        ents.push({ type: 'POLY', layer, pts: withBulges(vs, closed), closed });
        break;
      }
      case 'LWPOLYLINE': {
        const closed = (getN(r, 70) & 1) === 1;
        const vs: { p: Vec2; bulge: number }[] = [];
        let x: number | null = null;
        for (const [c, v] of r.codes) {
          if (c === 10) x = parseFloat(v);
          else if (c === 20 && x !== null) {
            vs.push({ p: { x, y: parseFloat(v) }, bulge: 0 });
            x = null;
          } else if (c === 42 && vs.length) vs[vs.length - 1]!.bulge = parseFloat(v);
        }
        ents.push({ type: 'POLY', layer, pts: withBulges(vs, closed), closed });
        break;
      }
      case 'LINE':
        ents.push({ type: 'LINE', layer, pts: [{ x: getN(r, 10), y: getN(r, 20) }, { x: getN(r, 11), y: getN(r, 21) }], closed: false });
        break;
      case 'POINT':
        ents.push({ type: 'POINT', layer, pts: [{ x: getN(r, 10), y: getN(r, 20) }], closed: false, angle: r.codes.some((c) => c[0] === 50) ? getN(r, 50) : undefined });
        break;
      case 'CIRCLE':
        ents.push({ type: 'CIRCLE', layer, pts: [{ x: getN(r, 10), y: getN(r, 20) }], closed: false, angle: getN(r, 40) });
        break;
      case 'TEXT':
      case 'MTEXT':
        ents.push({ type: 'TEXT', layer, pts: [{ x: getN(r, 10), y: getN(r, 20) }], closed: false, text: unescapeText(r.codes.filter((c) => c[0] === 1 || c[0] === 3).map((c) => c[1]).join('')) });
        break;
      case 'INSERT':
        inserts.push({ name: get(r, 2), at: { x: getN(r, 10), y: getN(r, 20) }, sx: getN(r, 41, 1), sy: getN(r, 42, 1), rot: getN(r, 50) });
        break;
    }
  }
  return { ents, inserts };
}

export interface DxfImportOptions {
  /** Força a unidade do arquivo (senão: texto "Units:", $INSUNITS ou tamanho do desenho). */
  unit?: 'mm' | 'cm' | 'in';
  /** Tolerância do ajuste de curvas (mm). */
  fitToleranceMm?: number;
}

export interface DxfImportResult {
  pieces: Piece[];
  styleName: string | null;
  unit: 'mm' | 'cm' | 'in';
  /** De onde veio a unidade. */
  unitSource: 'opção' | 'Units' | '$INSUNITS' | 'tamanho do desenho';
  /** Tamanhos encontrados (moldes graduados). */
  sizes: string[];
  warnings: string[];
}

const UNIT_MM = { mm: 1, cm: 10, in: 25.4 } as const;

interface RawPiece {
  name: string;
  size: string;
  quantity: number | null;
  category: string | null;
  annotations: string[];
  ents: Ent[];
}

function textField(t: string): [string, string] | null {
  const m = /^\s*([A-Za-z ]+?)\s*:\s*(.*)$/.exec(t);
  return m ? [m[1]!.toLowerCase(), m[2]!.trim()] : null;
}

function rawFromEnts(ents: Ent[], fallbackName: string): RawPiece {
  const raw: RawPiece = { name: fallbackName, size: '', quantity: null, category: null, annotations: [], ents: [] };
  for (const e of ents) {
    if (e.type === 'TEXT') {
      const f = textField(e.text ?? '');
      if (f) {
        const [k, v] = f;
        if (k === 'piece name' || k === 'piece') raw.name = v || raw.name;
        else if (k === 'size') raw.size = v;
        else if (k === 'quantity') raw.quantity = parseInt(v, 10) || null;
        else if (k === 'category') raw.category = v;
        else if (k === 'annotation') raw.annotations.push(v);
        continue;
      }
    }
    raw.ents.push(e);
  }
  return raw;
}

/** Junta LINEs/polilinhas abertas encadeadas em polígonos fechados. */
function chainClosed(ents: Ent[], tol: number): Vec2[][] {
  const segs = ents.filter((e) => (e.type === 'LINE' || (e.type === 'POLY' && !e.closed)) && e.pts.length >= 2).map((e) => [...e.pts]);
  const out: Vec2[][] = [];
  while (segs.length) {
    let chain = segs.pop()!;
    let grew = true;
    while (grew && dist(chain[0]!, chain[chain.length - 1]!) > tol) {
      grew = false;
      for (let k = 0; k < segs.length; k++) {
        const s = segs[k]!;
        const end = chain[chain.length - 1]!;
        if (dist(s[0]!, end) <= tol) chain = [...chain, ...s.slice(1)];
        else if (dist(s[s.length - 1]!, end) <= tol) chain = [...chain, ...[...s].reverse().slice(1)];
        else if (dist(s[s.length - 1]!, chain[0]!) <= tol) chain = [...s, ...chain.slice(1)];
        else if (dist(s[0]!, chain[0]!) <= tol) chain = [...[...s].reverse(), ...chain.slice(1)];
        else continue;
        segs.splice(k, 1);
        grew = true;
        break;
      }
    }
    if (chain.length >= 4 && dist(chain[0]!, chain[chain.length - 1]!) <= tol) out.push(chain.slice(0, -1));
  }
  return out;
}

function dedupe(pts: Vec2[], closed: boolean, eps: number): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) if (!out.length || dist(out[out.length - 1]!, p) > eps) out.push(p);
  if (closed) while (out.length > 2 && dist(out[0]!, out[out.length - 1]!) <= eps) out.pop();
  return out;
}

function closedPolys(ents: Ent[], layer: string | null, tol: number): Vec2[][] {
  const sel = ents.filter((e) => layer === null || e.layer === layer);
  const polys = sel.filter((e) => e.type === 'POLY' && (e.closed || (e.pts.length > 3 && dist(e.pts[0]!, e.pts[e.pts.length - 1]!) <= tol))).map((e) => e.pts);
  return [...polys, ...chainClosed(sel, tol)].map((p) => dedupe(p, true, 1e-9)).filter((p) => p.length >= 3);
}

const largest = (polys: Vec2[][]) => polys.reduce<Vec2[] | null>((b, p) => (!b || Math.abs(signedArea(p)) > Math.abs(signedArea(b)) ? p : b), null);

function pointSegDist(p: Vec2, a: Vec2, b: Vec2) {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2));
  return dist(p, add(a, scale(ab, t)));
}
function distToPoly(p: Vec2, poly: Vec2[]) {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, pointSegDist(p, poly[i]!, poly[(i + 1) % poly.length]!));
  return d;
}
function pointInPoly(p: Vec2, poly: Vec2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Contorno principal (costura se houver, senão corte) com os "nós" (cantos e pontos de curva). */
interface Shape {
  pts: Vec2[];
  /** Índices dos nós em pts, em ordem. */
  knots: number[];
  /** Nó suave (curva continua) ou canto. */
  smooth: boolean[];
  boundary: Vec2[];
  hasSew: boolean;
}

function shapeOf(ents: Ent[], tol: number): Shape | null {
  const boundary = largest(closedPolys(ents, '1', tol)) ?? largest(closedPolys(ents, null, tol));
  if (!boundary) return null;
  const sewPoly = largest(closedPolys(ents, '14', tol));
  let pts = sewPoly ?? boundary;
  if (signedArea(pts) < 0) pts = [...pts].reverse();
  const bnd = signedArea(boundary) < 0 ? [...boundary].reverse() : boundary;
  const n = pts.length;
  const p2 = ents.filter((e) => e.type === 'POINT' && e.layer === '2').map((e) => e.pts[0]!);
  const p3 = ents.filter((e) => e.type === 'POINT' && e.layer === '3').map((e) => e.pts[0]!);
  const near = (list: Vec2[], p: Vec2) => list.some((q) => dist(q, p) <= tol);
  const isCorner = pts.map((p) => near(p2, p));
  const useMarks = isCorner.some(Boolean);
  const smoothMark = pts.map((p) => near(p3, p));
  const useSmooth = useMarks && smoothMark.filter(Boolean).length <= n * 0.5;
  const knots: number[] = [], smooth: boolean[] = [];
  for (let i = 0; i < n; i++) {
    let corner = false, sm = false;
    if (useMarks) {
      corner = isCorner[i]!;
      sm = !corner && useSmooth && smoothMark[i]!;
    } else {
      const a = normalize(sub(pts[i]!, pts[(i - 1 + n) % n]!)), b = normalize(sub(pts[(i + 1) % n]!, pts[i]!));
      const turn = Math.atan2(cross(a, b), a.x * b.x + a.y * b.y);
      corner = Math.abs(turn) > (28 * Math.PI) / 180;
    }
    if (corner || sm) {
      knots.push(i);
      smooth.push(sm);
    }
  }
  if (!knots.length) {
    knots.push(0);
    smooth.push(true);
  }
  return { pts, knots, smooth, boundary: bnd, hasSew: !!sewPoly };
}

/** Constrói o contorno editável: retas onde é reto, Béziers ajustadas onde é curva. */
function outlineFromShape(s: Shape, fitTol: number): Path {
  const { pts, knots, smooth } = s;
  const n = pts.length;
  const d: Decomposed = { verts: [], edges: [], closed: true };
  for (let k = 0; k < knots.length; k++) {
    const i0 = knots[k]!, i1 = knots[(k + 1) % knots.length]!;
    const run: Vec2[] = [];
    for (let i = i0; ; i = (i + 1) % n) {
      run.push(pts[i]!);
      if (i === i1 && run.length > 1) break;
      if (run.length > n + 1) break;
    }
    const a = run[0]!, b = run[run.length - 1]!;
    const straight = run.length === 2 || run.every((p) => pointSegDist(p, a, b) <= Math.min(fitTol, 0.02));
    d.verts.push(a);
    if (straight) {
      d.edges.push({ kind: 'line' });
      continue;
    }
    // pontas livres: a direção das alças sai do próprio ajuste (mais exato); nós suaves são alinhados depois
    const cubics = fitCubics(run, fitTol);
    cubics.forEach((c, j) => {
      if (j > 0) d.verts.push(c[0]);
      d.edges.push({ kind: 'cubic', c1: c[1], c2: c[2] });
    });
  }
  // nós suaves: alinha as duas alças na direção média (continuidade da curva)
  const nv = d.verts.length;
  knots.forEach((pi, k) => {
    if (!smooth[k]) return;
    const vi = d.verts.findIndex((q) => q === pts[pi]);
    if (vi < 0) return;
    const ein = d.edges[(vi - 1 + nv) % nv]!, eout = d.edges[vi]!;
    if (ein.kind !== 'cubic' || eout.kind !== 'cubic') return;
    const v = d.verts[vi]!;
    const hin = sub(v, ein.c2), hout = sub(eout.c1, v);
    const dir = normalize(add(normalize(hin), normalize(hout)));
    if (dir.x === 0 && dir.y === 0) return;
    ein.c2 = sub(v, scale(dir, Math.hypot(hin.x, hin.y)));
    eout.c1 = add(v, scale(dir, Math.hypot(hout.x, hout.y)));
  });
  return compose(d);
}

/** Posição (aresta, fração do comprimento) de cada vértice do contorno ajustado dentro do seu trecho entre nós. */
function runPositions(outline: Path, s: Shape): { run: number; f: number }[] {
  const knotPts = s.knots.map((i) => s.pts[i]!);
  const verts = vertices(outline);
  // comprimento acumulado de cada trecho
  const res: { run: number; f: number }[] = [];
  let run = -1;
  const runVerts: number[][] = [];
  verts.forEach((v, i) => {
    const k = knotPts.findIndex((q) => dist(q, v) < 1e-9);
    if (k >= 0) {
      run = k;
      runVerts[k] = [i];
    } else runVerts[run]!.push(i);
    res.push({ run, f: 0 });
  });
  const lens = flattenWithEdges(outline, 0.02);
  const edgeLen = new Array<number>(edgeCount(outline)).fill(0);
  lens.points.forEach((p, k) => {
    const q = lens.points[(k + 1) % lens.points.length]!;
    edgeLen[lens.edgeOf[k]!]! += dist(p, q);
  });
  for (const vs of runVerts) {
    if (!vs) continue;
    const total = vs.reduce((acc, vi) => acc + edgeLen[vi]!, 0) || 1;
    let acc = 0;
    for (const vi of vs) {
      res[vi]!.f = acc / total;
      acc += edgeLen[vi]!;
    }
  }
  return res;
}

/** Ponto a uma fração do comprimento do trecho k (entre nós) de uma forma. */
function pointOnRun(s: Shape, k: number, f: number): Vec2 {
  const n = s.pts.length;
  const i0 = s.knots[k]!, i1 = s.knots[(k + 1) % s.knots.length]!;
  const run: Vec2[] = [];
  for (let i = i0; ; i = (i + 1) % n) {
    run.push(s.pts[i]!);
    if (i === i1 && run.length > 1) break;
    if (run.length > n + 1) break;
  }
  let total = 0;
  for (let i = 1; i < run.length; i++) total += dist(run[i - 1]!, run[i]!);
  let target = f * total;
  for (let i = 1; i < run.length; i++) {
    const l = dist(run[i - 1]!, run[i]!);
    if (target <= l || i === run.length - 1) return lerp(run[i - 1]!, run[i]!, l ? Math.min(1, target / l) : 0);
    target -= l;
  }
  return run[0]!;
}

/** Alinha a forma de outro tamanho com a do tamanho base (mesmo nº de nós, começando no nó correspondente). */
function alignKnots(base: Shape, s: Shape): Shape | null {
  const m = base.knots.length;
  if (s.knots.length !== m) return null;
  let bestShift = 0, bestD = Infinity;
  for (let sh = 0; sh < m; sh++) {
    let d = 0;
    for (let k = 0; k < m; k++) d += dist(base.pts[base.knots[k]!]!, s.pts[s.knots[(k + sh) % m]!]!);
    if (d < bestD) {
      bestD = d;
      bestShift = sh;
    }
  }
  return { ...s, knots: s.knots.map((_, k) => s.knots[(k + bestShift) % m]!), smooth: s.smooth.map((_, k) => s.smooth[(k + bestShift) % m]!) };
}

function buildPiece(raw: RawPiece, others: RawPiece[], sizes: string[], baseIndex: number, fitTol: number, tol: number, warnings: string[], id: string): Piece | null {
  const shape = shapeOf(raw.ents, tol);
  if (!shape) {
    warnings.push(`"${raw.name}": sem contorno fechado — ignorado`);
    return null;
  }
  const outline = normalizeClosed(outlineFromShape(shape, fitTol));
  const piece: Piece = {
    id,
    name: raw.name,
    outline,
    seamAllowanceMm: 0,
    internals: [],
    notches: [],
    quantity: raw.quantity ?? 1,
    cutInPairs: raw.annotations.some((a) => /par espelhado|mirror|pair/i.test(a)),
  };
  if (raw.category) piece.group = raw.category;
  const notes = raw.annotations.filter((a) => !/par espelhado/i.test(a));
  if (notes.length) piece.notes = notes.join('\n');

  // Margem por borda: distância da costura até a linha de corte, no meio de cada borda.
  if (shape.hasSew) {
    const byEdge: Record<string, number> = {};
    for (let e = 0; e < edgeCount(outline); e++) {
      const d = Math.round(distToPoly(pointOnEdge(outline, e, 0.5), shape.boundary) * 2) / 2;
      if (d > 0) byEdge[String(e)] = d;
    }
    if (Object.keys(byEdge).length) piece.seamByEdge = byEdge;
    // Barras com cantos espelhados (de qualquer CAD): liga onde deixa a linha de corte mais fiel.
    let dev = polygonDeviation(cutLine(piece, 0.2), shape.boundary);
    for (const e of Object.keys(byEdge).filter((k) => byEdge[k]! >= 10)) {
      const trial: Piece = { ...piece, hemByEdge: { ...(piece.hemByEdge ?? {}), [e]: true } };
      let d2 = Infinity;
      try {
        d2 = polygonDeviation(cutLine(trial, 0.2), shape.boundary);
      } catch {
        /* geometria que não admite espelhar */
      }
      if (d2 < dev - 0.05) {
        piece.hemByEdge = trial.hemByEdge;
        dev = d2;
      }
    }
  }

  for (const e of raw.ents) {
    if (e.layer === '4' && (e.type === 'POINT' || e.type === 'LINE')) {
      const h = closestOnPath(outline, e.pts[0]!);
      const depth = e.type === 'LINE' ? Math.max(1, Math.round(dist(e.pts[0]!, e.pts[1]!) - edgeSeam(piece, h.edge))) : 5;
      if (h.edge >= 0) piece.notches.push({ edge: h.edge, t: h.t, depthMm: depth });
    } else if (e.layer === '7' && (e.type === 'LINE' || e.type === 'POLY') && e.pts.length >= 2 && !piece.grainline) {
      piece.grainline = [e.pts[0]!, e.pts[e.pts.length - 1]!];
    } else if ((e.layer === '8' || e.layer === '11') && (e.type === 'LINE' || e.type === 'POLY') && e.pts.length >= 2) {
      const pts = dedupe(e.pts, e.closed, 1e-9);
      const simple = simplifyPolyline(e.closed ? [...pts, pts[0]!] : pts, 0.02);
      const clean = e.closed ? simple.slice(0, -1) : simple;
      if (clean.length >= 2) piece.internals.push(polyline(clean, e.closed && clean.length >= 3));
    } else if (e.layer === '13' && e.type === 'POINT') {
      (piece.drills ??= []).push(e.pts[0]!);
    }
  }

  // Gradação a partir dos outros tamanhos (mesmo número de cantos/nós).
  if (others.length) {
    const pos = runPositions(outline, shape);
    const rules: Record<string, Vec2[]> = {};
    const verts = vertices(outline);
    const shapes = others.map((o) => (o === raw ? shape : shapeOf(o.ents, tol)));
    const aligned = shapes.map((s) => (s && s !== shape ? alignKnots(shape, s) : s));
    if (aligned.some((s) => !s)) {
      warnings.push(`"${raw.name}": tamanhos com número de cantos diferente — importado só o tamanho ${sizes[baseIndex]}`);
    } else {
      verts.forEach((v, i) => {
        const offs = aligned.map((s, j) => (j === baseIndex ? { x: 0, y: 0 } : sub(pointOnRun(s!, pos[i]!.run, pos[i]!.f), v)));
        if (offs.some((o) => Math.abs(o.x) > 1e-6 || Math.abs(o.y) > 1e-6)) rules[String(i)] = offs.map((o) => ({ x: Math.round(o.x * 1e4) / 1e4, y: Math.round(o.y * 1e4) / 1e4 }));
      });
      piece.grading = { sizes: [...sizes], base: baseIndex, rules } satisfies Grading;
    }
  }
  return piece;
}

/** Lê um DXF (AAMA ou DXF comum com contornos fechados) e devolve os moldes em mm. */
export function importDxf(text: string, opts: DxfImportOptions = {}): DxfImportResult {
  const recs = records(tokenize(text));
  const warnings: string[] = [];
  // seções
  const sections = new Map<string, Rec[]>();
  let headerCodes: [number, string][] = [];
  for (let i = 0; i < recs.length; i++) {
    if (recs[i]!.type !== 'SECTION') continue;
    const name = get(recs[i]!, 2).toUpperCase();
    if (name === 'HEADER') headerCodes = recs[i]!.codes; // variáveis do cabeçalho usam código 9, não 0
    const body: Rec[] = [];
    while (++i < recs.length && recs[i]!.type !== 'ENDSEC') body.push(recs[i]!);
    sections.set(name, body);
  }
  // blocos
  const blocks = new Map<string, { base: Vec2; ents: Ent[]; inserts: ReturnType<typeof entitiesOf>['inserts'] }>();
  const bsec = sections.get('BLOCKS') ?? [];
  for (let i = 0; i < bsec.length; i++) {
    if (bsec[i]!.type !== 'BLOCK') continue;
    const b = bsec[i]!;
    const body: Rec[] = [];
    while (++i < bsec.length && bsec[i]!.type !== 'ENDBLK') body.push(bsec[i]!);
    const { ents, inserts } = entitiesOf(body);
    blocks.set(get(b, 2), { base: { x: getN(b, 10), y: getN(b, 20) }, ents, inserts });
  }
  const top = entitiesOf(sections.get('ENTITIES') ?? []);

  // textos gerais
  let styleName: string | null = null, sample: string | null = null, unitsText: string | null = null;
  for (const e of top.ents) {
    const f = e.type === 'TEXT' ? textField(e.text ?? '') : null;
    if (!f) continue;
    if (f[0] === 'style name') styleName = f[1] || null;
    else if (f[0] === 'sample size') sample = f[1] || null;
    else if (f[0] === 'units') unitsText = f[1].toUpperCase();
  }

  // moldes: um por INSERT de bloco com contorno; senão, cada contorno fechado solto vira molde
  const placeEnts = (ents: Ent[], ins: { at: Vec2; sx: number; sy: number; rot: number }, base: Vec2): Ent[] => {
    const r = (ins.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const f = (p: Vec2) => {
      const x = (p.x - base.x) * ins.sx, y = (p.y - base.y) * ins.sy;
      return { x: ins.at.x + x * c - y * s, y: ins.at.y + x * s + y * c };
    };
    return ents.map((e) => ({ ...e, pts: e.pts.map(f), angle: e.type === 'POINT' && e.angle !== undefined ? e.angle + ins.rot : e.angle }));
  };
  const raws: RawPiece[] = [];
  const expand = (name: string, ins: { at: Vec2; sx: number; sy: number; rot: number }, depth: number): Ent[] => {
    const b = blocks.get(name);
    if (!b || depth > 8) return [];
    const own = placeEnts(b.ents, ins, b.base);
    const nested = b.inserts.flatMap((n) => placeEnts(expand(n.name, n, depth + 1), ins, b.base));
    return [...own, ...nested];
  };
  for (const ins of top.inserts) {
    const ents = expand(ins.name, ins, 0);
    if (ents.some((e) => e.type === 'POLY' || e.type === 'LINE')) raws.push(rawFromEnts(ents, ins.name));
  }
  const loose = top.ents.filter((e) => e.type !== 'TEXT' || !textField(e.text ?? '') || !['style name', 'sample size', 'units', 'creation date', 'author', 'product', 'grading rule table', 'version'].includes(textField(e.text ?? '')![0]));
  if (!raws.length) {
    // DXF comum: cada contorno fechado (camada 1, ou qualquer camada) é um molde; o resto vai para quem o contém
    let outlines = closedPolys(loose, '1', 1e-3);
    if (!outlines.length) outlines = closedPolys(loose, null, 1e-3);
    // tira contornos internos (furos/recortes dentro de outro contorno)
    outlines = outlines.filter((p) => !outlines.some((q) => q !== p && Math.abs(signedArea(q)) > Math.abs(signedArea(p)) && pointInPoly(p[0]!, q)));
    outlines.forEach((poly, k) => {
      const mine = loose.filter((e) => e.pts.length && pointInPoly(e.pts[0]!, poly) && !(e.type === 'POLY' && e.pts === poly));
      const bound: Ent = { type: 'POLY', layer: '1', pts: poly, closed: true };
      raws.push(rawFromEnts([bound, ...mine.filter((e) => !(e.layer === '1' && e.type === 'POLY' && e.closed))], `Molde ${k + 1}`));
    });
  }

  // unidade
  let unit: DxfImportResult['unit'] = 'mm';
  let unitSource: DxfImportResult['unitSource'] = 'tamanho do desenho';
  const insUnits = (() => {
    const pairs = headerCodes;
    const k = pairs.findIndex((c) => c[0] === 9 && c[1].toUpperCase() === '$INSUNITS');
    return k >= 0 ? parseInt(pairs[k + 1]?.[1] ?? '', 10) : NaN;
  })();
  if (opts.unit) {
    unit = opts.unit;
    unitSource = 'opção';
  } else if (unitsText) {
    unit = /ENGLISH|INCH/.test(unitsText) ? 'in' : /CM|CENTI/.test(unitsText) ? 'cm' : 'mm';
    unitSource = 'Units';
  } else if (Number.isFinite(insUnits) && insUnits > 0) {
    if (insUnits === 1) unit = 'in';
    else if (insUnits === 5) unit = 'cm';
    else unit = 'mm';
    unitSource = '$INSUNITS';
  } else {
    const pts = raws.flatMap((r) => r.ents.flatMap((e) => e.pts));
    if (pts.length) {
      const bb = bboxOfPoints(pts);
      const ext = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
      unit = ext < 100 ? 'in' : 'mm';
    }
  }
  const k = UNIT_MM[unit];
  if (k !== 1) for (const r of raws) r.ents = r.ents.map((e) => ({ ...e, pts: e.pts.map((p) => ({ x: p.x * k, y: p.y * k })) }));

  // agrupa tamanhos do mesmo molde
  const groups = new Map<string, RawPiece[]>();
  for (const r of raws) {
    const key = r.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const fitTol = opts.fitToleranceMm ?? 0.05;
  const tol = 0.05;
  const pieces: Piece[] = [];
  const allSizesFound = new Set<string>();
  let nId = 0;
  for (const [name, list] of groups) {
    const sized = list.filter((r) => r.size);
    const distinct = [...new Set(sized.map((r) => r.size))];
    distinct.forEach((s) => allSizesFound.add(s));
    if (distinct.length >= 2 && distinct.length === list.length) {
      const sizes = distinct;
      const baseIndex = sample && sizes.includes(sample) ? sizes.indexOf(sample) : Math.floor((sizes.length - 1) / 2);
      const ordered = sizes.map((s) => list.find((r) => r.size === s)!);
      const p = buildPiece(ordered[baseIndex]!, ordered, sizes, baseIndex, fitTol, tol, warnings, `dxf${Date.now().toString(36)}${nId++}`);
      if (p) pieces.push(p);
    } else {
      list.forEach((r, j) => {
        const p = buildPiece(r, [], [], 0, fitTol, tol, warnings, `dxf${Date.now().toString(36)}${nId++}`);
        if (p) pieces.push({ ...p, name: list.length > 1 ? `${name}${r.size ? ' ' + r.size : ` (${j + 1})`}` : name });
      });
    }
  }
  if (!pieces.length) warnings.push('Nenhum contorno fechado encontrado no arquivo');
  return { pieces, styleName, unit, unitSource, sizes: [...allSizesFound], warnings };
}

/** Utilitário para testes/relatórios: distância máxima entre duas polilinhas fechadas (Hausdorff aproximado). */
export function polygonDeviation(a: Vec2[], b: Vec2[]): number {
  let m = 0;
  for (const p of a) m = Math.max(m, distToPoly(p, b));
  for (const p of b) m = Math.max(m, distToPoly(p, a));
  return m;
}
