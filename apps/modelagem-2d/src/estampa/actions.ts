/**
 * Ações das estampas: importar imagem, criar/alterar/remover estampa do molde.
 */
import { type Artwork, type Piece, type PiecePrint, type PrintMode, type Vec2, bboxOfPoints, cutLine } from '@cad-textil/core';
import { commit, commitPiece, editor, newId, notify } from '../editor/store';
import { platform } from '../platform';
import { readArtwork } from './images';

/** Abre o seletor de arquivo e guarda a imagem no documento. */
export async function importArtwork(): Promise<Artwork | null> {
  const f = await platform.importFile('Imagens (PNG, JPEG)', ['png', 'jpg', 'jpeg']);
  if (!f) return null;
  try {
    const art = await readArtwork(newId(), f.name, f.data);
    const doc = editor.get().doc;
    commit({ ...doc, artworks: [...(doc.artworks ?? []), art] });
    notify(`Imagem importada: ${f.name} (${art.widthPx} × ${art.heightPx} px)`);
    return art;
  } catch (err) {
    notify(err instanceof Error ? err.message : String(err), 'error');
    return null;
  }
}

/** Giro que deixa o "para cima" da arte no sentido do fio do molde (se houver). */
function grainRotation(p: Piece): number {
  if (!p.grainline) return 0;
  let [a, b] = p.grainline;
  if (b.y < a.y) [a, b] = [b, a];
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI - 90;
  return Math.abs(deg) < 1e-9 ? 0 : Math.round(deg * 1e6) / 1e6;
}

export const MODE_LABEL: Record<PrintMode, string> = { localizada: 'Localizada', total: 'Total (molde inteiro)', corrida: 'Corrida (repete no molde)', textura: 'Textura (contínua no tecido)' };

/** Cria uma estampa no molde. */
export function addPrint(pieceId: string, mode: PrintMode, artId: string | null, at?: Vec2): string | null {
  const p = editor.get().doc.pieces.find((q) => q.id === pieceId);
  if (!p) return null;
  const bb = bboxOfPoints(cutLine(p));
  const center = at ?? { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
  const w = bb.maxX - bb.minX;
  const pr: PiecePrint = {
    id: newId(),
    mode,
    art: artId ? { '': artId } : {},
    center,
    rotationDeg: grainRotation(p),
    mirrored: false,
    widthMm: Math.round(mode === 'corrida' || mode === 'textura' ? Math.min(100, w / 3) : w * 0.4),
    bleedMm: 5,
  };
  commitPiece(pieceId, (q) => ({ ...q, prints: [...(q.prints ?? []), pr] }));
  editor.set({ activePrint: pr.id });
  return pr.id;
}

export function updatePrint(pieceId: string, printId: string, f: (pr: PiecePrint) => PiecePrint): void {
  commitPiece(pieceId, (q) => ({ ...q, prints: q.prints?.map((pr) => (pr.id === printId ? f(pr) : pr)) }));
}

export function removePrint(pieceId: string, printId: string): void {
  commitPiece(pieceId, (q) => {
    const prints = q.prints?.filter((pr) => pr.id !== printId);
    return { ...q, prints: prints?.length ? prints : undefined };
  });
}

/** Centraliza a estampa na caixa do molde. */
export function centerPrint(pieceId: string, printId: string): void {
  const p = editor.get().doc.pieces.find((q) => q.id === pieceId);
  if (!p) return;
  const bb = bboxOfPoints(cutLine(p));
  updatePrint(pieceId, printId, (pr) => ({ ...pr, center: { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 } }));
}

/** Remove do documento as imagens que nenhum molde usa. */
export function purgeUnusedArtworks(): number {
  const doc = editor.get().doc;
  const used = new Set(doc.pieces.flatMap((p) => (p.prints ?? []).flatMap((pr) => Object.values(pr.art))));
  const keep = (doc.artworks ?? []).filter((a) => used.has(a.id));
  const n = (doc.artworks?.length ?? 0) - keep.length;
  if (n) commit({ ...doc, artworks: keep.length ? keep : undefined });
  return n;
}
