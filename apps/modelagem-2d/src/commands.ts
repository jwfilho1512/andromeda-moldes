import {
  allSizes,
  addPiece,
  emptyJob,
  exportHpgl,
  exportPdf,
  exportPdfTiled,
  jobBBox,
  newDocument,
  parseDocument,
  serializeDocument,
  bboxOfPoints,
  cutLine,
  decodeDxf,
  encodeDxf,
  exportDxfAama,
  importDxf,
  translatePiece,
  unionBBox,
} from '@cad-textil/core';
import { platform } from './platform';
import { commit, editor, fmtLen, fmtMm, loadDocument, unitLabel, newId, notify, redo, undo } from './editor/store';
import { duplicateSelection, selectAll } from './editor/actions';
import { canvasApi } from './editor/Canvas';
import { loadRiscoFrom } from './risco/state';

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

const isTextFocused = () => {
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement;
};

function confirmDiscard(): boolean {
  return !editor.get().dirty || window.confirm('Há alterações não salvas. Descartar e continuar?');
}

function buildJob() {
  const job = emptyJob();
  for (const p of editor.get().doc.pieces) addPiece(job, p);
  return job;
}

/** Carrega um .ctx (do diálogo Abrir ou do duplo clique no arquivo). */
export function openDocumentFile(f: { path: string | null; name: string; content: string }, confirmed = false): void {
  if (!confirmed && !confirmDiscard()) return;
  try {
    loadDocument(parseDocument(f.content), { path: f.path, name: f.name });
    loadRiscoFrom(editor.get().doc);
    canvasApi.fit();
    notify(`Aberto: ${f.name}`);
  } catch (err) {
    notify(err instanceof Error ? err.message : String(err), 'error');
  }
}

export async function runCommand(cmd: string): Promise<void> {
  const s = editor.get();
  try {
    switch (cmd) {
      case 'new':
        if (!confirmDiscard()) return;
        loadDocument(newDocument('Sem título'), { path: null, name: 'Sem título.ctx' });
        loadRiscoFrom(editor.get().doc);
        canvasApi.fit();
        return;

      case 'open': {
        if (!confirmDiscard()) return;
        const f = await platform.open();
        if (!f) return;
        openDocumentFile(f, true);
        return;
      }

      case 'save':
      case 'saveAs': {
        const name = s.file.name.endsWith('.ctx') ? s.file.name : `${s.file.name}.ctx`;
        const doc = { ...s.doc, name: baseName(name) };
        const r = await platform.save(serializeDocument(doc), cmd === 'save' ? s.file.path : null, name);
        if (!r) return;
        editor.set({ file: r, dirty: false, doc });
        notify(`Salvo: ${r.name}`);
        return;
      }

      case 'exportPlt':
      case 'exportPdf': {
        if (s.doc.pieces.length === 0) {
          notify('Nada para exportar — crie ou abra um molde', 'error');
          return;
        }
        const job = buildJob();
        const bb = jobBBox(job);
        const size = `${fmtLen(bb.maxX - bb.minX, 0)} × ${fmtLen(bb.maxY - bb.minY, 0)} ${unitLabel()}`;
        const base = baseName(s.file.name);
        const r =
          cmd === 'exportPlt'
            ? await platform.exportFile(exportHpgl(job), `${base}.plt`, 'Plotter HPGL (.plt)', 'plt')
            : await platform.exportFile(exportPdf(job, { title: base }), `${base}.pdf`, 'PDF em escala 1:1', 'pdf');
        if (r) notify(`${cmd === 'exportPlt' ? 'PLT' : 'PDF'} exportado: ${r.name} (${size}, escala 1:1)`);
        return;
      }

      case 'exportPdfA4':
      case 'exportPdfA4L':
      case 'exportPdfA3': {
        if (s.doc.pieces.length === 0) return notify('Nada para exportar — crie ou abra um molde', 'error');
        const job = buildJob();
        const base = baseName(s.file.name);
        const paper = cmd === 'exportPdfA3' ? 'A3' : 'A4';
        const orientation = cmd === 'exportPdfA4L' ? 'paisagem' : 'retrato';
        const r = await platform.exportFile(exportPdfTiled(job, { paper, orientation, title: base }), `${base}-${paper}${orientation === 'paisagem' ? '-paisagem' : ''}.pdf`, 'PDF em folhas (escala 1:1)', 'pdf');
        if (r) notify(`PDF em folhas ${paper} exportado: ${r.name} — imprima em 100% e confira o quadrado de 10 cm na 1ª folha`);
        return;
      }

      case 'exportPltGraded': {
        // Ninho: todos os tamanhos sobrepostos (conferência da gradação na plotter)
        const job = emptyJob();
        for (const p of s.doc.pieces) for (const { piece } of allSizes(p)) addPiece(job, piece, { showSewLine: false });
        if (!job.strokes.length) return notify('Nada para exportar', 'error');
        const r = await platform.exportFile(exportHpgl(job, { labels: false }), `${baseName(s.file.name)}-graduado.plt`, 'Plotter HPGL (.plt)', 'plt');
        if (r) notify(`PLT com todos os tamanhos exportado: ${r.name}`);
        return;
      }

      case 'undo':
        if (isTextFocused()) document.execCommand('undo');
        else undo();
        return;
      case 'redo':
        if (isTextFocused()) document.execCommand('redo');
        else redo();
        return;
      case 'duplicate':
        duplicateSelection();
        return;
      case 'selectAll':
        if (isTextFocused()) document.execCommand('selectAll');
        else selectAll();
        return;

      case 'importDxf': {
        const f = await platform.importFile('DXF / DXF-AAMA', ['dxf']);
        if (!f) return;
        const r = importDxf(decodeDxf(f.data));
        if (!r.pieces.length) return notify(`Nada importado de ${f.name}: ${r.warnings.join(' · ') || 'nenhum contorno fechado'}`, 'error');
        // entra à direita do que já existe, mantendo a posição relativa entre os moldes do arquivo
        const cur = editor.get().doc;
        const existing = cur.pieces.map((p) => bboxOfPoints(cutLine(p)));
        const incoming = r.pieces.map((p) => bboxOfPoints(cutLine(p))).reduce(unionBBox);
        const all = existing.length ? existing.reduce(unionBBox) : null;
        const dx = all ? all.maxX + 100 - incoming.minX : -incoming.minX;
        const dy = all ? all.maxY - incoming.maxY : -incoming.minY;
        const placed = r.pieces.map((p) => ({ ...translatePiece(p, dx, dy), id: newId() }));
        commit({ ...cur, pieces: [...cur.pieces, ...placed] }, { pieceId: placed[placed.length - 1]!.id, vertex: null, edge: null }, placed.map((p) => p.id));
        canvasApi.fit();
        const unit = { mm: 'mm', cm: 'cm', in: 'polegadas' }[r.unit];
        const unitNote = r.unitSource === 'tamanho do desenho' ? ` (unidade deduzida: ${unit} — confira as medidas)` : ` · unidade ${unit}`;
        const sizes = r.sizes.length > 1 ? ` · tamanhos ${r.sizes.join(', ')}` : '';
        notify(`${f.name}: ${placed.length} molde(s) importado(s)${sizes}${unitNote}${r.warnings.length ? ' · ' + r.warnings.join(' · ') : ''}`, r.warnings.length ? 'error' : 'info');
        return;
      }

      case 'exportDxf':
      case 'exportDxfBase': {
        if (!s.doc.pieces.length) return notify('Nada para exportar', 'error');
        const text = exportDxfAama(s.doc, s.doc.pieces, { styleName: baseName(s.file.name), sizes: cmd === 'exportDxfBase' ? 'base' : 'all' });
        const r = await platform.exportFile(encodeDxf(text), `${baseName(s.file.name)}.dxf`, 'DXF-AAMA (.dxf)', 'dxf');
        if (r) notify(`DXF-AAMA exportado (${s.doc.pieces.length} moldes${cmd === 'exportDxfBase' ? ', só tamanho base' : ''}): ${r.name}`);
        return;
      }
      case 'fit':
        canvasApi.fit();
        return;
      case 'realSize':
        canvasApi.realSize();
        return;
      case 'requestClose':
        await platform.confirmClose(s.dirty);
        return;
    }
  } catch (err) {
    notify(err instanceof Error ? err.message : String(err), 'error');
  }
}
