/** Comandos de arquivo e exportação do Andromeda Draw. */
import { docToSvg } from './model/svg';
import type { DrawDoc } from './model/types';
import { platform } from './platform';
import { editor, loadDoc, newDoc, notify } from './state';

const base = (name: string) => name.replace(/\.[^.]+$/, '');

export async function confirmDiscard(): Promise<boolean> {
  if (!editor.get().dirty) return true;
  return window.confirm('Há alterações não salvas. Descartar?');
}

export async function newDocument() {
  if (!(await confirmDiscard())) return;
  loadDoc(newDoc(), { path: null, name: 'Sem título.adraw' });
}

export function parseDoc(content: string): DrawDoc {
  const d = JSON.parse(content) as DrawDoc;
  if (d.format !== 'andromeda-draw') throw new Error('Este arquivo não é do Andromeda Draw');
  return d;
}

export async function openDocumentFile(f: { path: string | null; name: string; content: string }, confirmed = false) {
  if (!confirmed && !(await confirmDiscard())) return;
  try {
    loadDoc(parseDoc(f.content), { path: f.path, name: f.name });
    notify(`${f.name} aberto`);
  } catch (err) {
    notify(String((err as Error).message ?? err), 'erro');
  }
}

export async function openDocument() {
  if (!(await confirmDiscard())) return;
  const f = await platform.open();
  if (f) await openDocumentFile(f, true);
}

export async function saveDocument(as = false) {
  const s = editor.get();
  const name = s.file.name.endsWith('.adraw') ? s.file.name : `${base(s.file.name)}.adraw`;
  const ref = await platform.save(JSON.stringify(s.doc), as ? null : s.file.path, name);
  if (!ref) return;
  editor.set({ file: ref, dirty: false, doc: { ...s.doc, name: base(ref.name) } });
  notify(`Salvo: ${ref.name}`);
}

export async function exportSvg() {
  const s = editor.get();
  const ref = await platform.exportFile(docToSvg(s.doc), `${base(s.file.name)}.svg`, 'SVG', 'svg');
  if (ref) notify(`SVG exportado: ${ref.name}`);
}

/** Desenha o SVG num canvas e devolve PNG (dpi = pontos por polegada). */
export async function svgToPng(svg: string, wMm: number, hMm: number, dpi = 200): Promise<Uint8Array> {
  const w = Math.round((wMm / 25.4) * dpi), h = Math.round((hMm / 25.4) * dpi);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function exportPng() {
  const s = editor.get();
  const png = await svgToPng(docToSvg(s.doc), s.doc.artboard.w, s.doc.artboard.h);
  const ref = await platform.exportFile(png, `${base(s.file.name)}.png`, 'PNG', 'png');
  if (ref) notify(`PNG exportado: ${ref.name}`);
}

/** Ficha técnica em PDF: mostra a ficha em modo impressão e imprime em A4 deitado. */
export async function exportFicha() {
  const s = editor.get();
  editor.set({ view: 'ficha' });
  document.body.classList.add('printing');
  await new Promise((r) => setTimeout(r, 120));
  try {
    const name = `${s.doc.ficha.ref ? `Ficha ${s.doc.ficha.ref}` : `Ficha ${base(s.file.name)}`}.pdf`;
    const ref = await platform.printPdf(name, true);
    if (ref) notify(`Ficha técnica salva: ${ref.name}`);
  } finally {
    document.body.classList.remove('printing');
  }
}
