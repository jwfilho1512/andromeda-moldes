import { useEffect } from 'react';
import { Canvas } from './editor/Canvas';
import { ControlBar, CoordBar, Dock, ToolPalette, TopBar } from './editor/Panels';
import { editor, useEditor } from './editor/store';
import { platform } from './platform';
import { openDocumentFile, runCommand } from './commands';
import { RiscoCanvas } from './risco/RiscoCanvas';
import { RiscoControlBar, RiscoSetup, RiscoSummary } from './risco/RiscoPanels';
import { MenuBar } from './menu/MenuBar';
import { GuideOverlay } from './menu/Guide';
import { ShortcutsDialog } from './menu/Shortcuts';
import { loadMyBases } from './editor/mybases';

export function App() {
  const s = useEditor();

  useEffect(() => {
    document.title = `${s.dirty ? '● ' : ''}${s.file.name} — Andromeda Moldes`;
  }, [s.dirty, s.file.name]);

  useEffect(() => {
    document.documentElement.dataset.theme = s.theme;
  }, [s.theme]);

  useEffect(() => void loadMyBases(), []);

  useEffect(() => {
    const off = platform.onMenu((cmd) => void runCommand(cmd));
    const offOpen = platform.onOpenPath((f) => openDocumentFile(f));
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!platform.isDesktop && editor.get().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      off();
      offOpen();
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  if (s.workspace === 'risco') {
    return (
      <div className="app risco">
        <MenuBar />
        <TopBar />
        <RiscoControlBar />
        <RiscoSetup />
        <main className="stage" data-help="stage">
          <RiscoCanvas />
        </main>
        <RiscoSummary />
        <CoordBar />
        <GuideOverlay />
        <ShortcutsDialog />
      </div>
    );
  }

  return (
    <div className="app">
      <MenuBar />
      <TopBar />
      <ControlBar />
      <ToolPalette />
      <main className="stage" data-help="stage">
        <Canvas />
      </main>
      <Dock />
      <CoordBar />
      <GuideOverlay />
      <ShortcutsDialog />
    </div>
  );
}
