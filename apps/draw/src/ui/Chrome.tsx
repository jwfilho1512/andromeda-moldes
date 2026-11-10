/** Barra superior, paleta de ferramentas e barra de status. */
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBucketDroplet,
  IconCircle,
  IconCircleDot,
  IconDeviceFloppy,
  IconDownload,
  IconFileImport,
  IconFilePlus,
  IconFlipVertical,
  IconFolderOpen,
  IconHandStop,
  IconLine,
  IconMoon,
  IconNeedleThread,
  IconPointer,
  IconPrinter,
  IconSquare,
  IconSun,
  IconTypography,
  IconVectorBezier,
  IconVectorSpline,
} from '@tabler/icons-react';
import type { ComponentType } from 'react';
import { exportFicha, exportPng, exportSvg, newDocument, openDocument, saveDocument } from '../commands';
import { importDialog } from '../importers';
import { type Tool, editor, redo, setTool, undo, useEditor } from '../state';

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="22" fill="#141a33" />
      <g fill="none" strokeLinejoin="round" strokeLinecap="round">
        <path stroke="#e9ecff" strokeWidth={5} d="M41 22 Q50 30 59 22 L69 26 L82 43 L74 49 L67 42 L67 80 L33 80 L33 42 L26 49 L18 43 L31 26 Z" />
      </g>
      <path fill="#ffd27a" transform="translate(50 52) scale(9)" d="M0,-1L0.22,-0.22L1,0L0.22,0.22L0,1L-0.22,0.22L-1,0L-0.22,-0.22Z" />
    </svg>
  );
}

export function TopBar() {
  const s = useEditor();
  const setTheme = (theme: 'escuro' | 'claro') => {
    editor.set({ theme });
    try {
      localStorage.setItem('draw.theme', theme);
    } catch {
      /* sem armazenamento local */
    }
  };
  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        <div>
          <b>Andromeda Draw</b>
          <small>
            {s.dirty ? '● ' : ''}
            {s.file.name}
          </small>
        </div>
      </div>
      <nav className="tabs" data-help="tabs">
        <button className={s.view === 'desenho' ? 'on' : ''} onClick={() => editor.set({ view: 'desenho' })}>
          Desenho
        </button>
        <button className={s.view === 'ficha' ? 'on' : ''} onClick={() => editor.set({ view: 'ficha' })}>
          Ficha técnica
        </button>
      </nav>
      <div className="actions">
        <button className="ghost" title="Novo (⌘N)" onClick={() => void newDocument()}>
          <IconFilePlus size={16} /> Novo
        </button>
        <button className="ghost" title="Abrir (⌘O)" onClick={() => void openDocument()}>
          <IconFolderOpen size={16} /> Abrir
        </button>
        <button className="ghost" title="Salvar (⌘S)" onClick={() => void saveDocument()}>
          <IconDeviceFloppy size={16} /> Salvar
        </button>
        <button className="ghost" title="Importar SVG (Illustrator, Corel, Inkscape), imagem PNG/JPG ou moldes .ctx/DXF (⌘I) — ou arraste o arquivo para a prancha" onClick={() => void importDialog()}>
          <IconFileImport size={16} /> Importar
        </button>
        <span className="sep" />
        <button className="ghost" title="Exportar o desenho em SVG (vetor, abre no Illustrator)" onClick={() => void exportSvg()}>
          <IconDownload size={16} /> SVG
        </button>
        <button className="ghost" title="Exportar imagem PNG (200 dpi)" onClick={() => void exportPng()}>
          PNG
        </button>
        <button className="ghost" title="Ficha técnica em PDF (⌘P)" onClick={() => void exportFicha()}>
          <IconPrinter size={16} /> Ficha PDF
        </button>
        <span className="sep" />
        <button className="ghost icon" title="Desfazer (⌘Z)" disabled={!s.past.length} onClick={undo}>
          <IconArrowBackUp size={16} />
        </button>
        <button className="ghost icon" title="Refazer (⇧⌘Z)" disabled={!s.future.length} onClick={redo}>
          <IconArrowForwardUp size={16} />
        </button>
        <button className="ghost icon" title={s.theme === 'escuro' ? 'Tema claro' : 'Tema escuro'} onClick={() => setTheme(s.theme === 'escuro' ? 'claro' : 'escuro')}>
          {s.theme === 'escuro' ? <IconSun size={16} /> : <IconMoon size={16} />}
        </button>
      </div>
    </header>
  );
}

interface ToolDef {
  id: Tool;
  label: string;
  key: string;
  icon: ComponentType<{ size?: number }>;
  hint: string;
}

export const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Seleção', key: 'V', icon: IconPointer, hint: 'Clique para selecionar · arraste para mover · alças mudam o tamanho (Shift livre, Alt pelo centro) · Alt+arrastar duplica' },
  { id: 'direct', label: 'Seleção direta', key: 'A', icon: IconVectorBezier, hint: 'Clique num traço e arraste os pontos e alças. Em peça simétrica, mexer num lado mexe no outro' },
  { id: 'pen', label: 'Caneta', key: 'P', icon: IconVectorSpline, hint: 'Clique = ponto de canto · arraste = curva · clique no 1º ponto fecha · Enter termina. Com simetria, desenhe a metade' },
  { id: 'line', label: 'Linha', key: '\\', icon: IconLine, hint: 'Arraste para traçar uma reta' },
  { id: 'rect', label: 'Retângulo', key: 'M', icon: IconSquare, hint: 'Arraste para desenhar · Shift = quadrado' },
  { id: 'ellipse', label: 'Elipse', key: 'L', icon: IconCircle, hint: 'Arraste para desenhar · Shift = círculo' },
  { id: 'text', label: 'Texto', key: 'T', icon: IconTypography, hint: 'Clique onde o texto vai ficar e escreva no painel' },
  { id: 'stitch', label: 'Pesponto', key: 'S', icon: IconNeedleThread, hint: '1) clique no traço onde o pesponto começa 2) clique onde termina · Alt+clique = o traço inteiro' },
  { id: 'trim', label: 'Aviamento', key: 'B', icon: IconCircleDot, hint: 'Clique para colocar o aviamento escolhido na biblioteca (botão, ilhós, rebite…)' },
  { id: 'fill', label: 'Balde de tecido', key: 'K', icon: IconBucketDroplet, hint: 'Clique numa forma fechada para aplicar o tecido escolhido' },
  { id: 'hand', label: 'Mão', key: 'H', icon: IconHandStop, hint: 'Arraste para mover a vista (ou segure Espaço)' },
];

export function Toolbar() {
  const s = useEditor();
  return (
    <aside className="palette" data-help="tools">
      {TOOLS.map((t) => (
        <button key={t.id} className={s.tool === t.id ? 'on' : ''} title={`${t.label} (${t.key})`} onClick={() => setTool(t.id)} data-help={`tool:${t.id}`}>
          <t.icon size={19} />
        </button>
      ))}
      <span className="pal-sep" />
      <button
        className={s.symmetry ? 'on sym' : 'sym'}
        title="Simetria: desenhe metade da peça e o outro lado acompanha (Shift+M)"
        onClick={() => editor.set({ symmetry: !s.symmetry })}
        data-help="tool:symmetry"
      >
        <IconFlipVertical size={19} />
      </button>
    </aside>
  );
}

export function StatusBar() {
  const s = useEditor();
  const t = TOOLS.find((x) => x.id === s.tool);
  return (
    <footer className="status">
      <span className="st-tool">{t?.label}</span>
      <span className={s.message ? `msg ${s.message.kind}` : 'muted'}>{s.message?.text ?? t?.hint}</span>
      <span className="muted right">
        Escala 1:{s.doc.scale} · prancha {s.doc.artboard.w}×{s.doc.artboard.h} mm{s.symmetry ? ' · simetria ligada' : ''}
      </span>
    </footer>
  );
}
