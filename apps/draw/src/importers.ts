/**
 * Importar para o Draw: SVG (vetores do Illustrator, Corel, Inkscape…), imagens (PNG/JPG/WebP)
 * e moldes do Andromeda Moldes (.ctx) ou DXF-AAMA, que viram desenho vetorial.
 */
import { type Piece, type Vec2, decodeDxf, importDxf, parseDocument } from '@cad-textil/core';
import { bboxOfShapes, scaleAbout, transformShape, translateM } from './model/geom';
import { piecesToShapes } from './model/pieces';
import { importSvg } from './model/importSvg';
import type { ImageShape, Shape } from './model/types';
import { platform } from './platform';
import { addShapes, editor, newId, notify, setFicha, setTool } from './state';
import { canvasApi } from './ui/Canvas';
import { type LineMode, type PendingSvg, svgImportStore } from './ui/ImportSvgDialog';

export const IMPORT_EXTS = ['svg', 'png', 'jpg', 'jpeg', 'webp', 'ctx', 'dxf'];

const ext = (name: string) => name.toLowerCase().split('.').pop() ?? '';
const base = (name: string) => name.replace(/\.[^.]+$/, '');

/** Agrupa, encaixa na prancha se for maior e centraliza em `at`. */
function placeShapes(name: string, shapes: Shape[], at: Vec2, fitFrac = 0.9): Shape | null {
  if (!shapes.length) return null;
  let g: Shape = shapes.length === 1 ? { ...shapes[0]!, name: shapes[0]!.name ?? name } : { kind: 'group', id: newId(), name, children: shapes };
  const b = bboxOfShapes([g]);
  if (!b) return null;
  const { w, h } = editor.get().doc.artboard;
  const k = Math.min(1, (w * fitFrac) / (b.maxX - b.minX || 1), (h * fitFrac) / (b.maxY - b.minY || 1));
  if (k < 1) g = transformShape(g, scaleAbout({ x: b.minX, y: b.minY }, k, k));
  const b2 = bboxOfShapes([g])!;
  g = transformShape(g, translateM(at.x - (b2.minX + b2.maxX) / 2, at.y - (b2.minY + b2.maxY) / 2));
  addShapes([g]);
  setTool('select');
  return g;
}

function bytesToBase64(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}

/* ---------------- SVG ---------------- */

export function importSvgText(name: string, text: string, at: Vec2) {
  const r = importSvg(text);
  if (!r.shapes.length) {
    notify(`Nada para importar em ${name}`, 'erro');
    return;
  }
  // abre a janela de opções (tamanho e espessura das linhas)
  svgImportStore.set({ pending: { name: base(name), shapes: r.shapes, widthMm: r.widthMm, heightMm: r.heightMm, warnings: r.warnings, at } });
}

/** Espessura dos traços de caminhos: multiplica (k) ou fixa (fixed mm). Pesponto e texto já escalam juntos. */
function setStrokes(s: Shape, k: number, fixed: number | null): Shape {
  if (s.kind === 'group') return { ...s, children: s.children.map((c) => setStrokes(c, k, fixed)) };
  if (s.kind !== 'path' || !s.style.stroke) return s;
  const width = fixed ?? s.style.width * k;
  const dash = s.style.dash ? s.style.dash.map((d) => (fixed ? d * (fixed / (s.style.width || fixed)) : d * k)) : undefined;
  return { ...s, style: { ...s.style, width, ...(dash ? { dash } : {}) } };
}

/** Coloca o SVG escolhido na escala `k`, com a regra de espessura das linhas. */
export function placeSvg(p: PendingSvg, k: number, lines: LineMode, lineMm: number) {
  let g: Shape = p.shapes.length === 1 ? { ...p.shapes[0]!, name: p.shapes[0]!.name ?? p.name } : { kind: 'group', id: newId(), name: p.name, children: p.shapes };
  const b = bboxOfShapes([g]);
  if (!b) return;
  if (Math.abs(k - 1) > 1e-9) g = transformShape(g, scaleAbout({ x: b.minX, y: b.minY }, k, k));
  if (lines === 'acompanhar' && Math.abs(k - 1) > 1e-9) g = setStrokes(g, k, null);
  if (lines === 'padronizar') g = setStrokes(g, 1, Math.max(0.01, lineMm));
  const b2 = bboxOfShapes([g])!;
  g = transformShape(g, translateM(p.at.x - (b2.minX + b2.maxX) / 2, p.at.y - (b2.minY + b2.maxY) / 2));
  addShapes([g]);
  setTool('select');
  notify(`${p.name} importado: ${countPaths(p.shapes)} traço(s) · ${Math.round(k * 100)}% do tamanho do arquivo. Os traços são editáveis.`);
}

function countPaths(shapes: Shape[]): number {
  return shapes.reduce((n, s) => n + (s.kind === 'group' ? countPaths(s.children) : 1), 0);
}

/* ---------------- Imagem ---------------- */

export async function importImage(name: string, data: Uint8Array, at: Vec2) {
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext(name)] ?? 'image/png';
  const href = `data:${mime};base64,${bytesToBase64(data)}`;
  const img = new Image();
  img.src = href;
  await img.decode();
  const { w, h } = editor.get().doc.artboard;
  // entra com até 60% da prancha (o tamanho real de foto não é conhecido)
  const k = Math.min((w * 0.6) / img.naturalWidth, (h * 0.6) / img.naturalHeight);
  const iw = img.naturalWidth * k, ih = img.naturalHeight * k;
  const shape: ImageShape = { kind: 'image', id: newId(), name: base(name), at: { x: at.x - iw / 2, y: at.y - ih / 2 }, w: iw, h: ih, href, opacity: 1 };
  addShapes([shape]);
  setTool('select');
  notify(`${name} importada. Para redesenhar por cima, diminua a opacidade no painel e trave a camada.`);
}

/* ---------------- Moldes (.ctx / DXF) ---------------- */

export { piecesToShapes };

export function importPieces(name: string, pieces: Piece[], at: Vec2, path: string | null) {
  if (!pieces.length) {
    notify(`Nenhum molde em ${name}`, 'erro');
    return;
  }
  const s = editor.get();
  const shapes = piecesToShapes(pieces, s.doc.scale);
  placeShapes(`Moldes — ${base(name)}`, shapes, at);
  const linked = path && ext(name) === 'ctx' && !s.doc.ficha.moldes;
  if (linked) setFicha({ moldes: { path, name } });
  notify(`${pieces.length} molde(s) de ${name} na escala 1:${s.doc.scale}${linked ? ' · arquivo vinculado à ficha técnica' : ''}`);
}

/* ---------------- entrada única ---------------- */

export async function importData(f: { name: string; data: Uint8Array; path?: string | null }, at: Vec2 = canvasApi.center()) {
  try {
    const e = ext(f.name);
    if (e === 'svg') return importSvgText(f.name, new TextDecoder().decode(f.data), at);
    if (['png', 'jpg', 'jpeg', 'webp'].includes(e)) return await importImage(f.name, f.data, at);
    if (e === 'ctx') return importPieces(f.name, parseDocument(new TextDecoder().decode(f.data)).pieces, at, f.path ?? null);
    if (e === 'dxf') return importPieces(f.name, importDxf(decodeDxf(f.data)).pieces, at, null);
    notify(`Formato não suportado: .${e} (use SVG, PNG, JPG, CTX ou DXF)`, 'erro');
  } catch (err) {
    notify(`Não foi possível importar ${f.name}: ${(err as Error).message ?? err}`, 'erro');
  }
}

export async function importDialog() {
  const f = await platform.importFile('Vetores, imagens e moldes', IMPORT_EXTS);
  if (!f) return;
  if (editor.get().view !== 'desenho') editor.set({ view: 'desenho' });
  await importData(f as { name: string; data: Uint8Array; path?: string | null });
}
