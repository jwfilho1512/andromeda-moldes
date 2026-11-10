import { useEffect } from 'react';
import { exportFicha, exportPng, exportSvg, newDocument, openDocument, openDocumentFile, saveDocument } from './commands';
import { importDialog } from './importers';
import { platform } from './platform';
import {
  type Tool,
  deleteSelected,
  duplicateSelected,
  editor,
  groupSelected,
  redo,
  setTool,
  transformSelected,
  undo,
  ungroupSelected,
  useEditor,
} from './state';
import { translateM } from './model/geom';
import { Canvas, canvasApi } from './ui/Canvas';
import { StatusBar, TOOLS, Toolbar, TopBar } from './ui/Chrome';
import { FichaView } from './ui/Ficha';
import { Library } from './ui/Library';
import { Props } from './ui/Props';

const isTyping = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

function runCommand(cmd: string) {
  switch (cmd) {
    case 'new':
      return void newDocument();
    case 'open':
      return void openDocument();
    case 'save':
      return void saveDocument();
    case 'saveAs':
      return void saveDocument(true);
    case 'import':
      return void importDialog();
    case 'exportSvg':
      return void exportSvg();
    case 'exportPng':
      return void exportPng();
    case 'exportFicha':
      return void exportFicha();
    case 'undo':
      return undo();
    case 'redo':
      return redo();
    case 'duplicate':
      return duplicateSelected();
    case 'selectAll': {
      const s = editor.get();
      return editor.set({ selection: s.doc.layers.filter((l) => l.visible && !l.locked).flatMap((l) => l.shapes.map((x) => x.id)) });
    }
    case 'fit':
      return canvasApi.fit();
    case 'requestClose':
      return void platform.confirmClose(editor.get().dirty);
  }
}

export function App() {
  const s = useEditor();

  useEffect(() => {
    document.documentElement.dataset.theme = s.theme;
  }, [s.theme]);

  useEffect(() => {
    document.title = `${s.dirty ? '● ' : ''}${s.file.name} — Andromeda Draw`;
  }, [s.dirty, s.file.name]);

  useEffect(() => platform.onMenu(runCommand), []);
  useEffect(() => platform.onOpenPath((f) => void openDocumentFile(f)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod) {
        const map: Record<string, string> = { s: e.shiftKey ? 'saveAs' : 'save', o: 'open', n: 'new', d: 'duplicate', a: 'selectAll', '0': 'fit', p: 'exportFicha', e: 'exportSvg', i: 'import' };
        if (k === 'z') {
          e.preventDefault();
          return e.shiftKey ? redo() : undo();
        }
        if (k === '=' || k === '+' || k === '-') {
          e.preventDefault();
          return canvasApi.zoom(k === '-' ? 1 / 1.4 : 1.4);
        }
        if (k === 'g') {
          e.preventDefault();
          return e.shiftKey ? ungroupSelected() : groupSelected();
        }
        // no app instalado o menu nativo já trata os atalhos
        if (map[k] && !platform.isDesktop) {
          e.preventDefault();
          runCommand(map[k]!);
        }
        return;
      }
      if (editor.get().view !== 'desenho') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        return deleteSelected();
      }
      if (e.key.startsWith('Arrow') && editor.get().selection.length) {
        e.preventDefault();
        const d = e.shiftKey ? 5 : 0.5;
        const [dx, dy] = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key] as [number, number];
        return transformSelected(translateM(dx, dy));
      }
      if (e.shiftKey && k === 'm') return editor.set((st) => ({ symmetry: !st.symmetry }));
      const tool = TOOLS.find((t) => t.key.toLowerCase() === k);
      if (tool) setTool(tool.id as Tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app view-${s.view}`}>
      <TopBar />
      {s.view === 'desenho' ? (
        <>
          <Toolbar />
          <Library />
          <Canvas />
          <Props />
        </>
      ) : (
        <FichaView />
      )}
      <StatusBar />
    </div>
  );
}
