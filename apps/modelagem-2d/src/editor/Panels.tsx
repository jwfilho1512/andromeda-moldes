import { useEffect, useState, type ReactNode } from 'react';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBooks,
  IconChevronDown,
  IconChevronRight,
  IconDeviceFloppy,
  IconEye,
  IconEyeOff,
  IconFileExport,
  IconFilePlus,
  IconFolderOpen,
  IconLock,
  IconLockOpen,
  IconX,
  IconFileImport,
  IconLayoutAlignLeft,
  IconLayoutAlignCenter,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLayoutAlignMiddle,
  IconLayoutAlignBottom,
  IconLayoutDistributeHorizontal,
  IconLayoutDistributeVertical,
  IconFlipVertical,
  IconFlipHorizontal,
  IconRotate,
  IconRotateClockwise,
  IconCopy,
  IconTrash,
} from '@tabler/icons-react';
import {
  type Piece,
  bboxOfPoints,
  cutLine,
  unionBBox,
  edgeControls,
  edgeCount,
  edgeLength,
  edgeSeam,
  insertPieceVertex,
  moveVertex,
  pathLength,
  polylineLength,
  rect,
  setEdgeLength,
  setEdgeLengthExact,
  signedArea,
  toggleCurve,
  vertices,
  emptyGrading,
  linearOffsets,
  setVertexRule,
  vertexOffset,
} from '@cad-textil/core';
import { type EdgeRef, type LenUnit, type Theme, type WalkInfo, UNIT_LABEL, UNIT_MM, fmtLen, fmtLenU, fromUnit, notify, parseLen, setUnit, toUnit, unitDigits, unitLabel, commit, commitPiece, editor, toggleSelected, withHem, fmtInput, fmtMm, parseNum, select, setOpt, setTheme, useEditor, useViewInfo, useWalk } from './store';
import { type AlignMode, addPieceFromOutline, alignSelection, arrangeAll, deletePiece, deleteSelection, distributeSelection, duplicateSelection, invertSelection, mirrorPiece, mirrorPieceH, mirrorSelection, rotatePiece, rotateSelection, selectAll, setTool, toggleGrainline } from './actions';
import { pieceGeom, sizeColor } from './render';
import { canvasApi } from './Canvas';
import { DEFAULT_PX_PER_MM, getPxPerMm, setPxPerMm } from './calibration';
import { LibraryDialog } from './Library';
import { GROUPS, TOOLS, toolById } from './tools';
import { runCommand } from '../commands';
import { PrintsPanel } from '../estampa/PrintsPanel';
import { ui, useUi } from '../menu/ui';
import { BrandMark } from './Brand';

/* ------------------------------------------------------------------ */
/* Componentes básicos                                                 */
/* ------------------------------------------------------------------ */

/** Campo numérico: confirma com Enter ou ao sair, Esc desfaz. */
export function NumberField({ value, onCommit, suffix = 'mm', digits = 2, min, max, width, placeholder, len }: { value: number; onCommit: (v: number) => void; suffix?: string; digits?: number; min?: number; max?: number; width?: number; placeholder?: string; len?: boolean }) {
  // medidas (sufixo mm ou len) aparecem e são digitadas na unidade escolhida; o valor guardado continua em mm
  const unit = useEditor().unit;
  const isLen = len ?? suffix === 'mm';
  const k = isLen ? UNIT_MM[unit] : 1;
  const dg = isLen ? unitDigits(digits) : digits;
  const label = isLen && suffix ? UNIT_LABEL[unit] : suffix;
  // placeholder = valores diferentes (ex.: vários moldes): campo vazio até digitar
  const shown = placeholder ? '' : fmtInput(value / k, dg);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commitText = () => {
    const n0 = parseNum(text);
    const n = n0 === null ? null : n0 * k;
    if (n === null || (min !== undefined && n < min - 1e-9) || (max !== undefined && n > max + 1e-9)) {
      if (n !== null && isLen) notify(`${max !== undefined && n > max ? `Máximo ${fmtLenU(max, 0)}` : `Mínimo ${fmtLenU(min ?? 0, 0)}`} — confira a unidade (${UNIT_LABEL[unit]})`, 'error');
      setText(shown);
      return;
    }
    if (fmtInput(n / k, dg) !== shown) onCommit(n);
    else if (placeholder) setText('');
  };
  const suffixLabel = label;
  return (
    <span className="num">
      <input
        value={text}
        placeholder={placeholder}
        style={width ? { width } : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(shown);
            setTimeout(() => (e.target as HTMLInputElement).blur());
          }
        }}
      />
      {suffixLabel && <em>{suffixLabel}</em>}
    </span>
  );
}

export const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="row">
    <span>{label}</span>
    {children}
  </label>
);

const Info = ({ label, value }: { label: string; value: string }) => (
  <div className="row info">
    <span>{label}</span>
    <b>{value}</b>
  </div>
);

/** "Moldes (3)" → "moldes"; "Graduação" → "graduacao" (alvos da Ajuda). */
function helpSlug(title: string): string {
  return title.split(/[\s(]/)[0]!.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function Section({ title, children, defaultOpen = true, extra }: { title: string; children: ReactNode; defaultOpen?: boolean; extra?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="dock-section" data-help={`panel:${helpSlug(title)}`}>
      <header onClick={() => setOpen(!open)}>
        {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        <span>{title}</span>
        <span className="extra" onClick={(e) => e.stopPropagation()}>
          {extra}
        </span>
      </header>
      {open && <div className="dock-body">{children}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Barra superior                                                      */
/* ------------------------------------------------------------------ */

export function TopBar() {
  const s = useEditor();
  const lib = useUi().library;
  const setLib = (v: boolean) => ui.set({ library: v });
  useEffect(() => {
    if (!lib) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLib(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lib]);
  return (
    <header className="topbar">
      {lib && <LibraryDialog onClose={() => setLib(false)} />}
      <div className="brand" title="Andromeda Moldes">
        <BrandMark size={26} />
        <div className="brand-txt">
          <b>Andromeda Moldes</b>
          <small>
            {s.dirty ? '● ' : ''}
            {s.file.name}
          </small>
        </div>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" data-help="tab:modelagem" className={s.workspace === 'modelagem' ? 'on' : ''} onClick={() => editor.set({ workspace: 'modelagem' })}>Modelagem</button>
        <button role="tab" data-help="tab:risco" className={s.workspace === 'risco' ? 'on' : ''} onClick={() => editor.set({ workspace: 'risco' })}>Risco e Encaixe</button>
      </div>
      <div className="tgroup">
        <button className="ghost" onClick={() => runCommand('new')} title="Novo (Cmd/Ctrl+N)"><IconFilePlus size={17} /> Novo</button>
        <button className="ghost" onClick={() => runCommand('open')} title="Abrir .ctx (Cmd/Ctrl+O)"><IconFolderOpen size={17} /> Abrir</button>
        <button className="ghost" onClick={() => runCommand('save')} title="Salvar (Cmd/Ctrl+S)"><IconDeviceFloppy size={17} /> Salvar</button>
        <button className="ghost" data-help="top:dxf" onClick={() => runCommand('importDxf')} title="Importar moldes de DXF / DXF-AAMA (Audaces, Gerber, Lectra, Optitex…) — Cmd/Ctrl+I"><IconFileImport size={17} /> DXF</button>
      </div>
      <div className="tgroup">
        <button className="ghost icon" onClick={() => runCommand('undo')} disabled={!s.past.length} title="Desfazer (Cmd/Ctrl+Z)"><IconArrowBackUp size={18} /></button>
        <button className="ghost icon" onClick={() => runCommand('redo')} disabled={!s.future.length} title="Refazer (Cmd/Ctrl+Shift+Z)"><IconArrowForwardUp size={18} /></button>
      </div>
      <div className="tgroup">
        <button className="accent" data-help="top:bases" onClick={() => setLib(true)} title="Biblioteca de bases prontas (camisa, t-shirt, saia, calça, terno…)"><IconBooks size={17} /> Bases</button>
      </div>
      <div className="spacer" />
      <label className="theme" data-help="top:unit" title="Unidade das medidas na tela e nos campos (o arquivo e as saídas continuam exatos)">
        Unidade
        <select value={s.unit} onChange={(e) => setUnit(e.target.value as LenUnit)}>
          <option value="mm">mm</option>
          <option value="cm">cm</option>
          <option value="pol">polegada</option>
        </select>
      </label>
      <label className="theme" data-help="top:theme" title="Tema da interface">
        Tema
        <select value={s.theme} onChange={(e) => setTheme(e.target.value as Theme)}>
          <option value="escuro">Escuro · papel claro</option>
          <option value="escuro-total">Escuro total</option>
          <option value="claro">Claro</option>
        </select>
      </label>
      <div className="tgroup">
        <button className="primary" onClick={() => runCommand('exportPlt')} title="Exportar para plotter (Cmd/Ctrl+E)"><IconFileExport size={17} /> PLT</button>
        <select
          className="pdf-select"
          value=""
          title="PDF em escala 1:1: folha inteira (plotter) ou dividido em folhas A4/A3 para impressora comum"
          onChange={(e) => {
            const v = e.target.value;
            e.target.value = '';
            if (v) void runCommand(v);
          }}
        >
          <option value="">PDF 1:1…</option>
          <option value="exportPdf">Folha inteira (plotter)</option>
          <option value="exportPdfA4">Folhas A4 (retrato)</option>
          <option value="exportPdfA4L">Folhas A4 (paisagem)</option>
          <option value="exportPdfA3">Folhas A3</option>
        </select>
        <select
          className="pdf-select"
          value=""
          title="DXF-AAMA: formato de troca com outros CADs de modelagem (Audaces, Gerber, Lectra, Optitex, CLO)"
          onChange={(e) => {
            const v = e.target.value;
            e.target.value = '';
            if (v) void runCommand(v);
          }}
        >
          <option value="">DXF-AAMA…</option>
          <option value="exportDxf">Todos os tamanhos</option>
          <option value="exportDxfBase">Só o tamanho base</option>
        </select>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Paleta de ferramentas (esquerda)                                    */
/* ------------------------------------------------------------------ */

const GROUP_SHORT: Record<string, string> = { 'Pontos e curvas': 'Pontos', 'Marcações e medidas': 'Marcar' };

export function ToolPalette() {
  const s = useEditor();
  return (
    <nav className="palette" aria-label="Ferramentas">
      {GROUPS.map((g) => (
        <div className="pgroup" key={g}>
          <div className="pgroup-label" title={g}>{GROUP_SHORT[g] ?? g}</div>
          <div className="pgrid">
            {TOOLS.filter((t) => t.group === g).map((t) => (
              <button key={t.id} data-help={`tool:${t.id}`} className={`tool ${s.tool === t.id ? 'active' : ''}`} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`} aria-label={t.label}>
                <t.icon size={20} stroke={1.6} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Barra de controle (contextual)                                      */
/* ------------------------------------------------------------------ */

function WalkControls({ info }: { info: WalkInfo | null }) {
  if (!info) return <span className="muted">Clique a costura do molde A perto do início da costura</span>;
  const tol = 1;
  const diff = info.cornerDiff;
  const ok = diff !== null && Math.abs(diff) <= tol;
  const smooth = Math.abs(180 - info.startAngleDeg) <= 3;
  const worst = info.notchPairs.reduce((m, p) => Math.max(m, Math.abs(p.diff)), 0);
  return (
    <>
      <span className="walk-pair">
        <b>{info.aName}</b> × <b>{info.bName}</b>
        {info.mirrored && <em> (espelhado)</em>}
      </span>
      <span className="walk-stat">
        Andado <b>{fmtLen(info.s)}</b> {unitLabel()}{info.frozen ? ' · pausado' : ''}
      </span>
      <span className={`walk-stat ${diff === null ? '' : ok ? 'good' : 'bad'}`} title="Distância até o próximo canto em cada molde">
        Próximo canto A {info.nextCornerA !== null ? fmtLen(info.nextCornerA) : '—'} · B {info.nextCornerB !== null ? fmtLen(info.nextCornerB) : '—'} →{' '}
        <b>{diff === null ? '—' : `${diff >= 0 ? '+' : ''}${fmtLen(diff)} ${unitLabel()}`}</b>
      </span>
      <span className={`walk-stat ${info.notchPairs.length ? (worst <= tol ? 'good' : 'bad') : ''}`} title="Piques de A × piques de B">
        Piques {info.notchPairs.length ? `${info.notchPairs.length} par(es), maior desvio ${fmtLen(worst)} ${unitLabel()}` : '—'}
      </span>
      <span className={`walk-stat ${smooth ? 'good' : 'bad'}`} title="Ângulo na junção do início (180° = curva contínua)">
        Junção {fmtMm(info.startAngleDeg, 1)}° {smooth ? 'contínua' : 'com bico'}
      </span>
      <button className="ghost" onClick={() => canvasApi.walkMarkNotch()}>Marcar pique aqui</button>
      <button className="ghost" onClick={() => canvasApi.walkFix()}>Fixar molde aqui</button>
      <button className="ghost" onClick={() => canvasApi.walkExit()}>Sair</button>
    </>
  );
}

export function ControlBar() {
  const s = useEditor();
  const walkInfo = useWalk();
  const t = toolById(s.tool);
  const sel = s.doc.pieces.find((p) => p.id === s.selection.pieceId);
  const o = s.opts;
  let options: ReactNode = null;
  switch (s.tool) {
    case 'dart':
      options = <Row label="Largura da boca"><NumberField value={o.dartWidth} min={1} digits={1} onCommit={(v) => setOpt('dartWidth', v)} width={64} /></Row>;
      break;
    case 'cut':
      options = <Row label="Margem na borda do corte"><NumberField value={o.cutSeam} min={0} digits={1} onCommit={(v) => setOpt('cutSeam', v)} width={64} /></Row>;
      break;
    case 'pleat':
      options = <Row label="Profundidade da prega"><NumberField value={o.pleatDepth} min={1} digits={1} onCommit={(v) => setOpt('pleatDepth', v)} width={64} /></Row>;
      break;
    case 'spread':
    case 'spreadRadial':
      options = <Row label="Abertura"><NumberField value={o.spreadMm} min={1} digits={1} onCommit={(v) => setOpt('spreadMm', v)} width={64} /></Row>;
      break;
    case 'walk':
      options = <WalkControls info={walkInfo} />;
      break;
    case 'parallel':
      options = (
        <>
          <Row label="Distância"><NumberField value={o.parallelMm} min={0.1} digits={1} onCommit={(v) => setOpt('parallelMm', v)} width={64} /></Row>
          <span className="muted">clique = paralela à borda/linha · Alt+clique = contorno inteiro</span>
        </>
      );
      break;
    case 'addPoint':
      options = <MeasureModes withDepth={false} />;
      break;
    case 'seam':
      options = (
        <>
          <Row label={o.seamHem ? 'Barra' : 'Margem'}><NumberField value={o.seamMm} min={0} digits={1} onCommit={(v) => setOpt('seamMm', v)} width={64} /></Row>
          <span className="seg" role="radiogroup" title="Barra espelhada: os cantos da margem são rebatidos sobre a linha de dobra, para a barra dobrada encaixar nas laterais (manga, calça, saia)">
            <button className={!o.seamHem ? 'on' : ''} onClick={() => setOpt('seamHem', false)}>Margem comum</button>
            <button className={o.seamHem ? 'on' : ''} onClick={() => setOpt('seamHem', true)}>Barra espelhada</button>
          </span>
          {sel && (
            <>
              <button className="ghost" onClick={() => commitPiece(sel.id, (p) => ({ ...p, seamAllowanceMm: o.seamMm, seamByEdge: undefined }))}>Aplicar em todo o molde</button>
              <button className="ghost" onClick={() => commitPiece(sel.id, (p) => ({ ...p, seamAllowanceMm: 0, seamByEdge: undefined }))}>Zerar margens do molde</button>
            </>
          )}
        </>
      );
      break;
    case 'notch':
      options = <MeasureModes withDepth />;
      break;
    case 'select':
      options = s.multi.length > 1 ? (
        <GroupBar count={s.multi.length} rotateDeg={o.rotateDeg} />
      ) : sel ? (
        <>
          <span className="cb-name">{sel.name}</span>
          <button className="ghost" onClick={() => mirrorPiece(sel.id)} title="Espelhar da esquerda para a direita">Espelhar ↔</button>
          <button className="ghost" onClick={() => mirrorPieceH(sel.id)} title="Espelhar de cima para baixo">Espelhar ↕</button>
          <NumberField value={o.rotateDeg} digits={1} suffix="°" width={52} onCommit={(v) => setOpt('rotateDeg', v)} />
          <button className="ghost" onClick={() => rotatePiece(sel.id, o.rotateDeg)} title="Girar no sentido anti-horário">Girar ↺</button>
          <button className="ghost" onClick={() => rotatePiece(sel.id, -o.rotateDeg)} title="Girar no sentido horário">↻</button>
          <button className="ghost" onClick={duplicateSelection}>Duplicar</button>
          <button className="ghost" onClick={() => toggleGrainline(sel.id)}>{sel.grainline ? 'Remover fio' : 'Fio'}</button>
        </>
      ) : (
        <span className="muted">Nenhum molde selecionado</span>
      );
      break;
  }
  return (
    <div className="controlbar" data-help="ctrl">
      <span className="cb-tool">
        <t.icon size={17} stroke={1.6} />
        {t.label}
      </span>
      <div className="cb-options">{options}</div>
      <div className="spacer" />
      <SnapChips />
      <label className="snap" title="Ímã da grade (G liga/desliga)">
        Grade
        <select value={s.snapMm} onChange={(e) => editor.set({ snapMm: Number(e.target.value) })}>
          <option value={0}>desligado</option>
          <option value={0.5}>{fmtLenU(0.5)}</option>
          <option value={1}>{fmtLenU(1)}</option>
          <option value={5}>{fmtLenU(5)}</option>
          <option value={10}>1 cm</option>
        </select>
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Painéis à direita                                                   */
/* ------------------------------------------------------------------ */

export function Dock() {
  const s = useEditor();
  const piece = s.doc.pieces.find((p) => p.id === s.selection.pieceId);
  return (
    <aside className="dock">
      <Section title="Propriedades">{s.multi.length > 1 ? <GroupProps /> : piece ? <PieceProps piece={piece} /> : <DocProps />}</Section>
      <Section title={`Moldes (${s.doc.pieces.length})`}>
        <PieceList />
      </Section>
      <Section title="Estampas">
        <PrintsPanel />
      </Section>
      <Section title="Graduação">
        <GradingPanel />
      </Section>
      <Section title="Conferir costuras" defaultOpen={false}>
        <Compare />
      </Section>
      <Section title="Vista" defaultOpen={false}>
        <div className="stack">
          <button onClick={() => canvasApi.fit()}>Ajustar à tela</button>
          <button onClick={() => canvasApi.realSize()}>Tamanho real 1:1</button>
          <button onClick={arrangeAll}>Organizar todos os moldes</button>
          <p className="muted small">Guias: arraste a partir da régua (de cima = horizontal, da esquerda = vertical). Para apagar, arraste a guia de volta para a régua.</p>
          <Calibration />
        </div>
      </Section>
    </aside>
  );
}

function PieceList() {
  const s = useEditor();
  if (s.doc.pieces.length === 0) return <p className="muted small">Nenhum molde. Desenhe com Reta (P) ou Curvatura (C), ou insira uma base.</p>;
  const selSet = new Set(s.multi.length ? s.multi : s.selection.pieceId ? [s.selection.pieceId] : []);
  return (
    <ul className="pieces" title="Shift ou Cmd/Ctrl+clique: seleciona vários">
      {s.doc.pieces.map((p) => {
        const hidden = !!s.hidden[p.id];
        const locked = !!s.locked[p.id];
        return (
          <li
            key={p.id}
            className={`${selSet.has(p.id) ? 'sel' : ''} ${hidden ? 'dim' : ''}`}
            onClick={(e) => (e.shiftKey || e.metaKey || e.ctrlKey ? toggleSelected(p.id) : select({ pieceId: p.id }))}
          >
            <button className="ghost icon xs" title={hidden ? 'Mostrar' : 'Ocultar'} onClick={(e) => { e.stopPropagation(); editor.set({ hidden: { ...s.hidden, [p.id]: !hidden } }); }}>
              {hidden ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            </button>
            <button className="ghost icon xs" title={locked ? 'Desbloquear' : 'Bloquear'} onClick={(e) => { e.stopPropagation(); editor.set({ locked: { ...s.locked, [p.id]: !locked } }); }}>
              {locked ? <IconLock size={14} /> : <IconLockOpen size={14} className="faint" />}
            </button>
            <span className="pname">{p.name}</span>
            <small>
              {p.quantity}x{p.cutInPairs ? ' par' : ''}
            </small>
          </li>
        );
      })}
    </ul>
  );
}

function Compare() {
  const s = useEditor();
  const lenOf = (r: EdgeRef) => {
    const p = s.doc.pieces.find((q) => q.id === r.pieceId);
    if (!p || r.edge >= edgeCount(p.outline)) return null;
    return { name: p.name, len: edgeLength(p.outline, r.edge) };
  };
  const add = (side: 'a' | 'b') => {
    if (!s.selection.pieceId || s.selection.edge === null) return;
    editor.set({ compare: { ...s.compare, [side]: [...s.compare[side], { pieceId: s.selection.pieceId, edge: s.selection.edge }] } });
  };
  const remove = (side: 'a' | 'b', i: number) => editor.set({ compare: { ...s.compare, [side]: s.compare[side].filter((_, k) => k !== i) } });
  const sum = (side: 'a' | 'b') => s.compare[side].reduce((acc, r) => acc + (lenOf(r)?.len ?? 0), 0);
  const canAdd = s.selection.edge !== null;
  const diff = sum('b') - sum('a');
  return (
    <div className="compare">
      <p className="muted small">Selecione uma borda (Seleção → clique na borda) e adicione ao grupo A ou B. Ex.: A = cava frente + costas, B = cabeça da manga.</p>
      {(['a', 'b'] as const).map((side) => (
        <div key={side} className="cmp-side">
          <div className="row">
            <b>Grupo {side.toUpperCase()}</b>
            <button className="ghost xs" disabled={!canAdd} onClick={() => add(side)}>+ borda selecionada</button>
          </div>
          {s.compare[side].map((r, i) => {
            const l = lenOf(r);
            return (
              <div className="row info" key={i}>
                <span>{l ? `${l.name} · borda ${r.edge + 1}` : 'borda removida'}</span>
                <b>{l ? fmtLen(l.len) : '—'}</b>
                <button className="ghost icon xs" onClick={() => remove(side, i)}><IconX size={12} /></button>
              </div>
            );
          })}
          <Info label="Soma" value={`${fmtLen(sum(side))} ${unitLabel()}`} />
        </div>
      ))}
      <div className={`cmp-diff ${Math.abs(diff) < 0.05 ? 'ok' : ''}`}>
        Diferença (B − A): <b>{diff >= 0 ? '+' : ''}{fmtLen(diff)} {unitLabel()}</b>
      </div>
    </div>
  );
}

function Calibration() {
  const [open, setOpen] = useState(false);
  const [factor, setFactor] = useState(getPxPerMm());
  if (!open) return <button onClick={() => setOpen(true)}>Calibrar tela…</button>;
  return (
    <div className="calib">
      <p>Meça a barra abaixo com uma régua e digite o comprimento real:</p>
      <div className="bar" style={{ width: Math.min(100 * factor, 240) }} />
      <Row label="Mediu">
        <NumberField
          value={Math.min(100, 240 / factor)}
          digits={1}
          min={1}
          onCommit={(mm) => {
            const f = (factor * Math.min(100, 240 / factor)) / mm;
            setFactor(f);
            setPxPerMm(f);
          }}
        />
      </Row>
      <div className="stack">
        <button onClick={() => { setPxPerMm(DEFAULT_PX_PER_MM); setFactor(DEFAULT_PX_PER_MM); }}>Restaurar padrão</button>
        <button onClick={() => setOpen(false)}>Fechar</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Propriedades                                                        */
/* ------------------------------------------------------------------ */

const ALIGN: { mode: AlignMode; icon: typeof IconLayoutAlignLeft; label: string }[] = [
  { mode: 'left', icon: IconLayoutAlignLeft, label: 'Alinhar à esquerda' },
  { mode: 'centerX', icon: IconLayoutAlignCenter, label: 'Alinhar ao centro (horizontal)' },
  { mode: 'right', icon: IconLayoutAlignRight, label: 'Alinhar à direita' },
  { mode: 'top', icon: IconLayoutAlignTop, label: 'Alinhar em cima' },
  { mode: 'centerY', icon: IconLayoutAlignMiddle, label: 'Alinhar ao meio (vertical)' },
  { mode: 'bottom', icon: IconLayoutAlignBottom, label: 'Alinhar embaixo' },
];

/** Barra de controle com vários moldes selecionados. */
function GroupBar({ count, rotateDeg }: { count: number; rotateDeg: number }) {
  return (
    <>
      <span className="cb-name">{count} moldes</span>
      <span className="cb-group">
        {ALIGN.map((a) => (
          <button key={a.mode} className="ghost icon" title={a.label} onClick={() => alignSelection(a.mode)}><a.icon size={17} stroke={1.6} /></button>
        ))}
      </span>
      <span className="cb-group">
        <button className="ghost icon" title="Distribuir na horizontal (vãos iguais)" onClick={() => distributeSelection('x')}><IconLayoutDistributeVertical size={17} stroke={1.6} /></button>
        <button className="ghost icon" title="Distribuir na vertical (vãos iguais)" onClick={() => distributeSelection('y')}><IconLayoutDistributeHorizontal size={17} stroke={1.6} /></button>
      </span>
      <span className="cb-group">
        <button className="ghost icon" title="Espelhar o grupo ↔" onClick={() => mirrorSelection('h')}><IconFlipVertical size={17} stroke={1.6} /></button>
        <button className="ghost icon" title="Espelhar o grupo ↕" onClick={() => mirrorSelection('v')}><IconFlipHorizontal size={17} stroke={1.6} /></button>
        <NumberField value={rotateDeg} digits={1} suffix="°" width={52} onCommit={(v) => setOpt('rotateDeg', v)} />
        <button className="ghost icon" title="Girar o grupo ↺" onClick={() => rotateSelection(rotateDeg)}><IconRotate size={17} stroke={1.6} /></button>
        <button className="ghost icon" title="Girar o grupo ↻" onClick={() => rotateSelection(-rotateDeg)}><IconRotateClockwise size={17} stroke={1.6} /></button>
        <button className="ghost icon" title="Duplicar (Cmd/Ctrl+D)" onClick={duplicateSelection}><IconCopy size={17} stroke={1.6} /></button>
      </span>
    </>
  );
}

/** Painel de propriedades com vários moldes selecionados. */
function GroupProps() {
  const s = useEditor();
  const ids = new Set(s.multi);
  const list = s.doc.pieces.filter((p) => ids.has(p.id));
  const [gap, setGap] = useState(20);
  if (!list.length) return null;
  const bb = list.map((p) => bboxOfPoints(cutLine(p))).reduce(unionBBox);
  const area = list.reduce((acc, p) => acc + Math.abs(signedArea(cutLine(p))), 0);
  const total = list.reduce((acc, p) => acc + p.quantity, 0);
  const same = <K extends 'quantity' | 'group' | 'cutInPairs'>(k: K) => (list.every((p) => p[k] === list[0]![k]) ? list[0]![k] : undefined);
  const setAll = (f: (p: Piece) => Piece) => commit({ ...s.doc, pieces: s.doc.pieces.map((p) => (ids.has(p.id) && !s.locked[p.id] ? f(p) : p)) });
  const qty = same('quantity');
  const group = same('group');
  const pairs = same('cutInPairs');
  return (
    <>
      <h4>{list.length} moldes selecionados</h4>
      <div className="row info"><span>Caixa do grupo</span><b>{fmtLen(bb.maxX - bb.minX)} × {fmtLen(bb.maxY - bb.minY)} {unitLabel()}</b></div>
      <div className="row info"><span>Área somada (corte)</span><b>{(area / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} m²</b></div>
      <div className="row info"><span>Peças a cortar</span><b>{total}</b></div>

      <h4>Aplicar em todos</h4>
      <Row label="Quantidade">
        <NumberField value={qty ?? 0} min={1} digits={0} placeholder={qty === undefined ? 'vários' : undefined} onCommit={(v) => setAll((p) => ({ ...p, quantity: Math.max(1, Math.round(v)) }))} width={64} />
      </Row>
      <Row label="Peça de roupa">
        <input
          key={group ?? '—'}
          defaultValue={group ?? ''}
          placeholder={group === undefined && list.some((p) => p.group) ? 'vários' : 'ex.: Camisa M'}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (group ?? '')) setAll((p) => ({ ...p, group: v || undefined }));
          }}
        />
      </Row>
      <label className="row check">
        <input type="checkbox" checked={pairs === true} ref={(el) => { if (el) el.indeterminate = pairs === undefined; }} onChange={(e) => setAll((p) => ({ ...p, cutInPairs: e.target.checked }))} />
        Cortar em par espelhado
      </label>

      <h4>Alinhar</h4>
      <div className="btn-row">
        {ALIGN.map((a) => (
          <button key={a.mode} className="ghost icon" title={a.label} onClick={() => alignSelection(a.mode)}><a.icon size={17} stroke={1.6} /></button>
        ))}
      </div>
      <h4>Distribuir</h4>
      <div className="btn-row">
        <button className="ghost" onClick={() => distributeSelection('x')} title="Mantém o primeiro e o último; iguala os vãos"><IconLayoutDistributeVertical size={16} /> Horizontal</button>
        <button className="ghost" onClick={() => distributeSelection('y')} title="Mantém o primeiro e o último; iguala os vãos"><IconLayoutDistributeHorizontal size={16} /> Vertical</button>
      </div>
      <Row label="Espaço fixo">
        <NumberField value={gap} min={0} digits={1} onCommit={setGap} width={64} />
      </Row>
      <div className="btn-row">
        <button className="ghost" onClick={() => distributeSelection('x', gap)}>Lado a lado ↔</button>
        <button className="ghost" onClick={() => distributeSelection('y', gap)}>Empilhar ↕</button>
      </div>

      <h4>Seleção</h4>
      <div className="btn-row">
        <button className="ghost" onClick={selectAll}>Todos (Cmd/Ctrl+A)</button>
        <button className="ghost" onClick={invertSelection}>Inverter</button>
      </div>
      <button className="danger wide" onClick={deleteSelection}><IconTrash size={15} /> Excluir {list.length} moldes</button>
      <p className="muted small">Arraste qualquer molde selecionado para mover o grupo. Shift+clique põe/tira um molde; arraste no vazio para selecionar com a caixa.</p>
    </>
  );
}

function DocProps() {
  const [w, setW] = useState(500);
  const [h, setH] = useState(300);
  return (
    <>
      <h4>Novo retângulo exato</h4>
      <Row label="Largura"><NumberField value={w} onCommit={setW} min={1} /></Row>
      <Row label="Altura"><NumberField value={h} onCommit={setH} min={1} /></Row>
      <button
        className="primary wide"
        onClick={() => {
          const c = canvasApi.center();
          addPieceFromOutline(rect(Math.round(c.x - w / 2), Math.round(c.y - h / 2), w, h));
        }}
      >
        Criar molde {fmtLen(w, 0)} × {fmtLen(h, 0)} {unitLabel()}
      </button>
      <h4>Atalhos</h4>
      <ul className="help">
        <li><kbd>Espaço</kbd>+arrastar ou botão do meio: mover vista · roda: zoom</li>
        <li>Duplo clique no ponto: canto ⇄ curva · na borda: reta ⇄ curva</li>
        <li><kbd>Alt</kbd>+clique na borda: inserir ponto · <kbd>Alt</kbd> ao arrastar alça: independente</li>
        <li>Setas: mover 1 mm (<kbd>Shift</kbd>: 10 mm) · <kbd>G</kbd>: ímã da grade</li>
        <li>Teclas das ferramentas: veja a dica ao passar o mouse na paleta</li>
      </ul>
    </>
  );
}

function PieceProps({ piece }: { piece: Piece }) {
  const s = useEditor();
  const g = pieceGeom(piece);
  const bb = bboxOfPoints(g.cut);
  const verts = vertices(piece.outline);
  const update = (f: (p: Piece) => Piece) => commitPiece(piece.id, f);
  const area = Math.abs(signedArea(g.cut)) / 1e6;

  return (
    <>
      {piece.group && <div className="group-tag">{piece.group}</div>}
      <Row label="Nome">
        <input
          className="text"
          defaultValue={piece.name}
          key={piece.id + piece.name}
          onBlur={(e) => e.target.value.trim() && e.target.value !== piece.name && update((p) => ({ ...p, name: e.target.value.trim() }))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </Row>
      <Row label="Margem padrão">
        <NumberField value={piece.seamAllowanceMm} min={0} digits={1} onCommit={(v) => update((p) => ({ ...p, seamAllowanceMm: v }))} />
      </Row>
      <Row label="Quantidade">
        <NumberField value={piece.quantity} min={1} digits={0} suffix="" onCommit={(v) => update((p) => ({ ...p, quantity: Math.round(v) }))} />
      </Row>
      <label className="row check">
        <span>Cortar em par (espelhado)</span>
        <input type="checkbox" checked={piece.cutInPairs} onChange={(e) => update((p) => ({ ...p, cutInPairs: e.target.checked }))} />
      </label>

      {s.selection.vertex !== null && verts[s.selection.vertex] && <VertexProps piece={piece} index={s.selection.vertex} />}
      {s.selection.edge !== null && <EdgeProps piece={piece} index={s.selection.edge} />}

      <h4>Medidas</h4>
      <Info label="Perímetro costura" value={`${fmtLen(pathLength(piece.outline))} ${unitLabel()}`} />
      <Info label="Perímetro corte" value={`${fmtLen(polylineLength(g.cut, true))} ${unitLabel()}`} />
      <Info label="Largura × altura" value={`${fmtLen(bb.maxX - bb.minX)} × ${fmtLen(bb.maxY - bb.minY)} ${unitLabel()}`} />
      <Info label="Área de corte" value={`${area.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} m²`} />

      {piece.notes !== undefined && (
        <>
          <h4>Observações</h4>
          <textarea
            className="notes"
            defaultValue={piece.notes}
            key={piece.id + (piece.notes ?? '')}
            rows={3}
            onBlur={(e) => e.target.value !== piece.notes && update((p) => ({ ...p, notes: e.target.value }))}
          />
        </>
      )}

      {(piece.internals.length > 0 || piece.notches.length > 0 || (piece.darts?.length ?? 0) > 0 || (piece.drills?.length ?? 0) > 0) && <h4>Marcações</h4>}
      {(piece.drills ?? []).map((q, i) => (
        <div className="row info" key={`f${i}`}>
          <span>Ponto {i + 1} · X {fmtLen(q.x)} · Y {fmtLen(q.y)}</span>
          <button className="ghost icon xs" title="Remover ponto" onClick={() => update((p) => ({ ...p, drills: p.drills?.filter((_, k) => k !== i).length ? p.drills.filter((_, k) => k !== i) : undefined }))}><IconX size={12} /></button>
        </div>
      ))}
      {(piece.darts ?? []).map((_, i) => (
        <div className="row info" key={`d${i}`}>
          <span>Pence {i + 1}</span>
          <button className="ghost icon xs" title="Remover pence" onClick={() => update((p) => ({ ...p, darts: p.darts?.filter((__, k) => k !== i) }))}><IconX size={12} /></button>
        </div>
      ))}
      {piece.internals.map((path, i) => (
        <div className="row info" key={`i${i}`}>
          <span>Linha interna {i + 1} · {fmtLen(pathLength(path))} {unitLabel()}</span>
          <button className="ghost icon xs" title="Remover" onClick={() => update((p) => ({ ...p, internals: p.internals.filter((_, k) => k !== i) }))}><IconX size={12} /></button>
        </div>
      ))}
      {piece.notches.length > 0 && (
        <div className="row info">
          <span>{piece.notches.length} pique(s)</span>
          <button className="ghost icon xs" title="Remover o último pique" onClick={() => update((p) => ({ ...p, notches: p.notches.slice(0, -1) }))}><IconX size={12} /></button>
        </div>
      )}

      <button className="danger wide" onClick={() => deletePiece(piece.id)}>Excluir molde</button>
    </>
  );
}

function VertexProps({ piece, index }: { piece: Piece; index: number }) {
  const p = vertices(piece.outline)[index]!;
  const move = (x: number, y: number) => commitPiece(piece.id, (q) => ({ ...q, outline: moveVertex(q.outline, index, { x, y }) }));
  return (
    <>
      <h4>Ponto {index + 1}</h4>
      <Row label="X"><NumberField value={p.x} onCommit={(x) => move(x, p.y)} /></Row>
      <Row label="Y"><NumberField value={p.y} onCommit={(y) => move(p.x, y)} /></Row>
      <button className="wide" onClick={deleteSelection}>Remover ponto</button>
    </>
  );
}

function EdgeProps({ piece, index }: { piece: Piece; index: number }) {
  const c = edgeControls(piece.outline, index);
  const length = edgeLength(piece.outline, index);
  return (
    <>
      <h4>Borda {index + 1} · {c.kind === 'line' ? 'reta' : 'curva'}</h4>
      <Row label="Margem desta borda">
        <NumberField
          value={edgeSeam(piece, index)}
          min={0}
          digits={1}
          onCommit={(v) => commitPiece(piece.id, (q) => ({ ...q, seamByEdge: { ...(q.seamByEdge ?? {}), [String(index)]: v } }))}
        />
      </Row>
      <label className="row check" title="Os cantos da margem desta borda são rebatidos sobre a linha de dobra: a barra dobrada encaixa nas laterais (bainha de manga, calça, saia)">
        <input type="checkbox" checked={!!piece.hemByEdge?.[String(index)]} onChange={(e) => commitPiece(piece.id, (q) => withHem(q, index, e.target.checked))} />
        Barra com cantos espelhados
      </label>
      {piece.seamByEdge?.[String(index)] !== undefined && (
        <button
          className="link"
          onClick={() =>
            commitPiece(piece.id, (q) => {
              const { [String(index)]: _, ...rest } = q.seamByEdge ?? {};
              return { ...q, seamByEdge: rest };
            })
          }
        >
          usar margem padrão ({fmtLen(piece.seamAllowanceMm, 1)} {unitLabel()})
        </button>
      )}
      {c.kind === 'line' ? (
        <Row label="Comprimento">
          <NumberField value={length} min={0.1} onCommit={(v) => commitPiece(piece.id, (q) => ({ ...q, outline: setEdgeLength(q.outline, index, v) }))} />
        </Row>
      ) : (
        <Row label="Comprimento da curva">
          <NumberField value={length} min={0.1} onCommit={(v) => commitPiece(piece.id, (q) => ({ ...q, outline: setEdgeLengthExact(q.outline, index, v) }))} />
        </Row>
      )}
      <div className="grid2">
        <button onClick={() => commitPiece(piece.id, (q) => ({ ...q, outline: toggleCurve(q.outline, index) }))}>
          {c.kind === 'line' ? 'Transformar em curva' : 'Transformar em reta'}
        </button>
        <button onClick={() => commitPiece(piece.id, (q) => insertPieceVertex(q, index, 0.5), { pieceId: piece.id, vertex: index + 1, edge: null })}>
          Inserir ponto no meio
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Janela de coordenadas + status (embaixo)                            */
/* ------------------------------------------------------------------ */

const PEN = new Set(['pen', 'curve', 'internal']);

export function CoordBar() {
  const s = useEditor();
  const v = useViewInfo();
  const zoomPct = (v.pxPerMm / getPxPerMm()) * 100;
  const [distTxt, setDist] = useState('');
  const [angTxt, setAng] = useState('0');
  const [dxTxt, setDx] = useState('');
  const [dyTxt, setDy] = useState('');
  const penTool = PEN.has(s.tool);

  const addPolar = () => {
    const d = parseLen(distTxt);
    const a = parseNum(angTxt) ?? 0;
    const last = canvasApi.lastPenPoint();
    if (d === null || !last) return;
    const r = (a * Math.PI) / 180;
    canvasApi.addPenPoint({ x: last.x + d * Math.cos(r), y: last.y + d * Math.sin(r) });
    setDist('');
  };
  const addDelta = () => {
    const dx = parseLen(dxTxt || '0');
    const dy = parseLen(dyTxt || '0');
    const last = canvasApi.lastPenPoint();
    if (dx === null || dy === null || !last) return;
    canvasApi.addPenPoint({ x: last.x + dx, y: last.y + dy });
    setDx('');
    setDy('');
  };
  const onEnter = (f: () => void) => (e: React.KeyboardEvent) => e.key === 'Enter' && f();

  return (
    <footer className="coordbar">
      <span className="coord">{v.cursor ? `X ${fmtLen(v.cursor.x)}   Y ${fmtLen(v.cursor.y)} ${unitLabel()}` : 'X —   Y —'}</span>
      {penTool && (
        <span className="coord-entry" title="Depois do 1º clique, digite e tecle Enter para colocar o próximo ponto com medida exata">
          <label>Dist.<input value={distTxt} onChange={(e) => setDist(e.target.value)} onKeyDown={onEnter(addPolar)} placeholder={unitLabel()} /></label>
          <label>Ângulo<input value={angTxt} onChange={(e) => setAng(e.target.value)} onKeyDown={onEnter(addPolar)} />°</label>
          <span className="sep" />
          <label>ΔX<input value={dxTxt} onChange={(e) => setDx(e.target.value)} onKeyDown={onEnter(addDelta)} placeholder={unitLabel()} /></label>
          <label>ΔY<input value={dyTxt} onChange={(e) => setDy(e.target.value)} onKeyDown={onEnter(addDelta)} placeholder={unitLabel()} /></label>
        </span>
      )}
      <span className="zoom">Zoom {zoomPct.toLocaleString('pt-BR', { maximumFractionDigits: zoomPct < 10 ? 1 : 0 })}%</span>
      {s.message ? <span className={`msg ${s.message.kind}`}>{s.message.text}</span> : <span className="hint">{toolById(s.tool).hint}</span>}
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* Graduação                                                           */
/* ------------------------------------------------------------------ */

function GradeDefaults() {
  const s = useEditor();
  const [txt, setTxt] = useState(s.gradeDefault.sizes.join(', '));
  const apply = (text: string, base: number) => {
    const sizes = text.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    if (sizes.length < 2) return;
    editor.set({ gradeDefault: { sizes, base: Math.min(base, sizes.length - 1) } });
  };
  return (
    <>
      <Row label="Tamanhos">
        <input className="text" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={() => apply(txt, s.gradeDefault.base)} />
      </Row>
      <Row label="Tamanho base">
        <select value={s.gradeDefault.base} onChange={(e) => apply(txt, Number(e.target.value))}>
          {s.gradeDefault.sizes.map((n, i) => (
            <option key={n} value={i}>{n}</option>
          ))}
        </select>
      </Row>
    </>
  );
}

function GradingPanel() {
  const s = useEditor();
  const piece = s.doc.pieces.find((p) => p.id === s.selection.pieceId);
  const [step, setStep] = useState({ x: 0, y: 0 });
  if (!piece) {
    return (
      <>
        <p className="muted small">Grade usada ao criar a graduação de um molde desenhado à mão. As bases da biblioteca já entram graduadas.</p>
        <GradeDefaults />
      </>
    );
  }
  const g = piece.grading;
  if (!g) {
    return (
      <>
        <p className="muted small">Este molde não tem grade. Crie a grade e depois selecione cada ponto para dar a regra (ΔX/ΔY por tamanho).</p>
        <GradeDefaults />
        <button className="primary wide" onClick={() => commitPiece(piece.id, (p) => ({ ...p, grading: emptyGrading(s.gradeDefault.sizes, s.gradeDefault.base) }))}>
          Criar grade neste molde
        </button>
      </>
    );
  }
  const vi = s.selection.vertex;
  const ruled = Object.keys(g.rules).length;
  const setRule = (offs: { x: number; y: number }[]) => commitPiece(piece.id, (p) => setVertexRule(p, vi!, offs));
  const offs = vi !== null ? g.sizes.map((_, i) => vertexOffset(g, vi, i)) : [];
  return (
    <>
      <div className="size-legend">
        {g.sizes.map((n, i) => (
          <span key={n} style={{ color: i === g.base ? 'var(--text)' : sizeColor(i, g.sizes.length, g.base) }} className={i === g.base ? 'base' : ''}>
            ● {n}
          </span>
        ))}
      </div>
      <label className="row check">
        <span>Mostrar todos os tamanhos</span>
        <input type="checkbox" checked={s.showGrade} onChange={(e) => editor.set({ showGrade: e.target.checked })} />
      </label>
      <Info label="Pontos graduados" value={`${ruled} de ${vertices(piece.outline).length}`} />
      {vi === null ? (
        <p className="muted small">Selecione um ponto do molde (ferramenta Seleção) para ver e editar a regra dele.</p>
      ) : (
        <>
          <h4>Regra do ponto {vi + 1}</h4>
          <table className="rule">
            <thead>
              <tr><th>Tam.</th><th>ΔX</th><th>ΔY</th></tr>
            </thead>
            <tbody>
              {g.sizes.map((n, i) => (
                <tr key={n}>
                  <td style={{ color: i === g.base ? 'var(--text)' : sizeColor(i, g.sizes.length, g.base) }}>{n}{i === g.base ? ' (base)' : ''}</td>
                  {i === g.base ? (
                    <><td className="muted">0</td><td className="muted">0</td></>
                  ) : (
                    <>
                      <td><NumberField value={offs[i]!.x} digits={1} suffix="" len width={64} onCommit={(x) => setRule(offs.map((o, k) => (k === i ? { ...o, x } : o)))} /></td>
                      <td><NumberField value={offs[i]!.y} digits={1} suffix="" len width={64} onCommit={(y) => setRule(offs.map((o, k) => (k === i ? { ...o, y } : o)))} /></td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <h4>Regra linear (por tamanho)</h4>
          <div className="row">
            <span>ΔX</span><NumberField value={step.x} digits={1} width={56} onCommit={(x) => setStep({ ...step, x })} />
            <span>ΔY</span><NumberField value={step.y} digits={1} width={56} onCommit={(y) => setStep({ ...step, y })} />
          </div>
          <button className="wide" onClick={() => setRule(linearOffsets(g, step))}>Aplicar regra linear no ponto</button>
          <div className="grid2">
            <button onClick={() => editor.set({ ruleClipboard: offs })}>Copiar regra</button>
            <button disabled={!s.ruleClipboard || s.ruleClipboard.length !== g.sizes.length} onClick={() => setRule(s.ruleClipboard!)}>Colar regra</button>
            <button disabled={!s.ruleClipboard || s.ruleClipboard.length !== g.sizes.length} onClick={() => setRule(s.ruleClipboard!.map((o) => ({ x: -o.x, y: o.y })))}>Colar espelhada ↔</button>
            <button onClick={() => setRule(g.sizes.map(() => ({ x: 0, y: 0 })))}>Zerar ponto</button>
          </div>
        </>
      )}
      <div className="grid2">
        <button onClick={() => runCommand('exportPltGraded')}>PLT com todos os tamanhos</button>
        <button className="danger" onClick={() => commitPiece(piece.id, (p) => ({ ...p, grading: undefined }))}>Remover grade</button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Ímã inteligente e medidas                                           */
/* ------------------------------------------------------------------ */

const SNAP_LABELS: [keyof import('./store').SnapOpts, string, string][] = [
  ['ponto', 'Ponto', 'Vértices e pontos das linhas'],
  ['meio', 'Meio', 'Meio da borda (pelo comprimento)'],
  ['intersecao', 'Interseção', 'Cruzamento de bordas, linhas e guias'],
  ['perpendicular', 'Perp.', 'Perpendicular a partir do último ponto'],
  ['borda', 'Borda', 'Qualquer ponto sobre a borda'],
  ['alinhamento', 'Alinh.', 'Alinhado na horizontal/vertical com outros pontos'],
  ['guias', 'Guias', 'Linhas guia puxadas da régua'],
];

function SnapChips() {
  const s = useEditor();
  return (
    <div className="snap-chips" title="Ímã inteligente: o que atrai o cursor">
      {SNAP_LABELS.map(([k, label, tip]) => (
        <button key={k} className={`chip ${s.snap[k] ? 'on' : ''}`} title={tip} onClick={() => editor.set({ snap: { ...s.snap, [k]: !s.snap[k] } })}>
          {label}
        </button>
      ))}
    </div>
  );
}

function MeasureModes({ withDepth }: { withDepth: boolean }) {
  const s = useEditor();
  const o = s.opts;
  return (
    <>
      <select value={o.measureMode} onChange={(e) => setOpt('measureMode', e.target.value as typeof o.measureMode)}>
        <option value="clique">No ponto do clique</option>
        <option value="distancia">A uma distância do canto</option>
        <option value="dividir">Dividir a borda em partes iguais</option>
      </select>
      {o.measureMode === 'distancia' && <Row label="Distância"><NumberField value={o.measureDistMm} min={0.1} digits={1} onCommit={(v) => setOpt('measureDistMm', v)} width={64} /></Row>}
      {o.measureMode === 'dividir' && <Row label="Partes"><NumberField value={o.divideN} min={2} digits={0} suffix="" onCommit={(v) => setOpt('divideN', Math.max(2, Math.round(v)))} width={48} /></Row>}
      {withDepth && <Row label="Profundidade"><NumberField value={o.notchDepth} min={1} digits={1} onCommit={(v) => setOpt('notchDepth', v)} width={56} /></Row>}
    </>
  );
}
