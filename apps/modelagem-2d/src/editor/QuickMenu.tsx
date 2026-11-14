/**
 * AJUSTES RÁPIDOS (botão direito): abre parado onde se clicou, com os ajustes da ferramenta.
 * O mouse fica livre para digitar. Em Ponto e Pique, Enter cria no ponto da borda clicado.
 * Na Pence, Enter começa a pence ali (depois é só clicar o ápice).
 * Nas outras ferramentas mostra os mesmos ajustes da barra de controle.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Vec2 } from '@cad-textil/core';
import { IconX } from '@tabler/icons-react';
import { Store, editor, fmtLen, fmtMm, parseLen, parseNum, setOpt, unitLabel, useEditor, useViewInfo } from './store';
import { canvasApi } from './Canvas';
import { toolById } from './tools';
import type { SeamAction } from './Canvas';
import { ToolOptions } from './Panels';

export interface QuickOpen {
  /** Ponto clicado (mm). */
  w: Vec2;
  /** O clique foi sobre a borda de um molde (dá para aplicar ali). */
  onEdge: boolean;
  /** O clique foi dentro de um molde (pence interna). */
  inside: boolean;
  tool: string;
}
export const quickStore = new Store<{ open: QuickOpen | null }>({ open: null });
export const closeQuick = () => quickStore.get().open && quickStore.set({ open: null });

type Mode = 'clique' | 'distancia' | 'dividir';
const W = 250;

/**
 * Campo que vale na hora: cada número digitado já vai para a ferramenta (e aparece igual na barra
 * de cima). Fora de foco mostra o valor atual, então as duas medidas nunca ficam diferentes.
 */
function LiveField({ label, value, onLive, kind = 'len', inputRef, min = 0 }: { label: string; value: number; onLive: (v: number) => void; kind?: 'len' | 'int' | 'deg'; inputRef?: React.Ref<HTMLInputElement>; min?: number }) {
  const show = (v: number) => (kind === 'len' ? fmtLen(v) : kind === 'int' ? String(Math.round(v)) : fmtMm(v, 1));
  const [text, setText] = useState<string | null>(null);
  const parse = (t: string): number | null => {
    if (kind === 'len') return parseLen(t);
    const n = parseNum(t);
    return n === null ? null : kind === 'int' ? Math.round(n) : n;
  };
  const bad = text !== null && (parse(text) === null || parse(text)! < min);
  return (
    <label className="qm-row">
      <span>{label}</span>
      <input
        ref={inputRef}
        className={bad ? 'bad' : ''}
        value={text ?? show(value)}
        onFocus={(e) => {
          setText(show(value));
          e.target.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          const v = parse(e.target.value);
          if (v !== null && v >= min) onLive(v);
        }}
        onBlur={() => setText(null)}
      />
      <em>{kind === 'len' ? unitLabel() : kind === 'deg' ? '°' : ''}</em>
    </label>
  );
}

export function QuickMenu() {
  const q = useSyncExternalStore(quickStore.subscribe, () => quickStore.get().open);
  const s = useEditor();
  useViewInfo(); // acompanha zoom e rolagem
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>('distancia');
  const [distText, setDistText] = useState('');
  const [place, setPlace] = useState<{ x: number; y: number } | null>(null);
  const key = q ? `${q.w.x},${q.w.y},${q.tool}` : '';

  // abriu: modo de medida (no clique vira distância, só para este Enter) e foco no 1º campo
  useLayoutEffect(() => {
    if (!q) return;
    const o = editor.get().opts;
    setMode(o.measureMode === 'clique' ? 'distancia' : o.measureMode);
    setDistText('');
    setPlace(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // trocou de ferramenta: fecha
  useEffect(() => {
    if (q && s.tool !== q.tool) closeQuick();
  }, [s.tool, q]);

  // depois de medir, mantém a janela dentro da área do desenho
  useLayoutEffect(() => {
    if (!q || !box.current) return;
    const c = canvasApi.toLocal(q.w);
    const vs = canvasApi.viewSize();
    const h = box.current.offsetHeight;
    let x = c.x + 10, y = c.y + 10;
    if (x + W > vs.w - 8) x = c.x - W - 10;
    if (y + h > vs.h - 8) y = Math.max(30, c.y - h - 10);
    x = Math.max(28, Math.min(x, vs.w - W - 8));
    y = Math.max(28, Math.min(y, vs.h - h - 8));
    if (!place || Math.abs(place.x - x) > 0.5 || Math.abs(place.y - y) > 0.5) setPlace({ x, y });
  });

  if (!q) return null;
  const tool = q.tool;
  const t = toolById(tool as Parameters<typeof toolById>[0]);
  const o = s.opts;
  const measure = tool === 'addPoint' || tool === 'notch';
  const isDart = tool === 'dart';
  const isInner = tool === 'innerDart';

  const apply = () => {
    closeQuick();
    canvasApi.focus();
    if (q.onEdge && measure) canvasApi.applyAt(q.w, mode);
    else if (q.onEdge && isDart) {
      const d = distText.trim() ? parseLen(distText) : null;
      canvasApi.applyAt(q.w, undefined, d ?? undefined);
    } else if (q.inside && isInner) canvasApi.applyAt(q.w);
    else if (q.onEdge && tool === 'seam') canvasApi.seamAction(q.w, 'borda');
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLSelectElement)) {
      e.preventDefault();
      apply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeQuick();
      canvasApi.focus();
    }
  };
  const pickMode = (m: Mode) => {
    setMode(m);
    setOpt('measureMode', m);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  };

  let body;
  if (measure) {
    body = (
      <>
        <div className="seg qm-seg">
          {([['clique', 'No clique'], ['distancia', 'Distância'], ['dividir', 'Dividir']] as const).map(([k, l]) => (
            <button key={k} className={mode === k ? 'on' : ''} onClick={() => pickMode(k)}>{l}</button>
          ))}
        </div>
        {mode === 'distancia' && <LiveField label="Distância do canto mais perto" value={o.measureDistMm} min={0.1} onLive={(v) => setOpt('measureDistMm', v)} inputRef={input} />}
        {mode === 'dividir' && <LiveField label="Partes iguais" kind="int" min={2} value={o.divideN} onLive={(v) => setOpt('divideN', v)} inputRef={input} />}
        {mode === 'clique' && <div className="qm-hint">Cria exatamente onde você clicou com o direito.</div>}
        {tool === 'notch' && <LiveField label="Profundidade do pique" value={o.notchDepth} min={1} onLive={(v) => setOpt('notchDepth', v)} />}
        <button className="primary" onClick={apply} disabled={!q.onEdge}>
          {q.onEdge ? `${tool === 'notch' ? 'Marcar pique' : 'Criar ponto'} aqui (Enter)` : 'Clique com o direito sobre uma borda'}
        </button>
      </>
    );
  } else if (isDart) {
    body = (
      <>
        <div className="seg qm-seg" title="Marcar: tira da borda · Abrir: gira o molde pelo pivô e acrescenta a folga">
          {([['marcar', 'Marcar'], ['abrir', 'Abrir (folga)']] as const).map(([k, l]) => (
            <button key={k} className={o.dartMode === k ? 'on' : ''} onClick={() => setOpt('dartMode', k)}>{l}</button>
          ))}
        </div>
        <div className="seg qm-seg">
          {([['marcada', 'Só marcar'], ['bico', 'Com bico'], ['recortada', 'Recortada']] as const).map(([k, l]) => (
            <button key={k} className={o.dartKind === k ? 'on' : ''} onClick={() => setOpt('dartKind', k)}>{l}</button>
          ))}
        </div>
        <LiveField label="Largura da boca" value={o.dartWidth} min={0.1} onLive={(v) => setOpt('dartWidth', v)} inputRef={input} />
        <LiveField label="Profundidade" value={o.dartDepth} onLive={(v) => setOpt('dartDepth', v)} />
        {q.onEdge && (
          <label className="qm-row">
            <span>Distância do canto (vazio = onde clicou)</span>
            <input value={distText} placeholder="—" onChange={(e) => setDistText(e.target.value)} />
            <em>{unitLabel()}</em>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={o.dartPerp} onChange={(e) => setOpt('dartPerp', e.target.checked)} /> Ápice perpendicular (cria na hora)
        </label>
        <div className="seg qm-seg" title="Olhando do ápice para a borda: o ponto clicado vira uma perna e a boca abre para esse lado (em Abrir, é o lado que gira)">
          {([['esquerda', '← Esquerda'], ['centro', 'Centro'], ['direita', 'Direita →']] as const).map(([k, l]) => (
            <button key={k} className={o.dartAlign === k ? 'on' : ''} disabled={k === 'centro' && o.dartMode === 'abrir'} onClick={() => setOpt('dartAlign', k)}>{l}</button>
          ))}
        </div>
        {o.dartKind === 'bico' && (
          <button className="ghost" onClick={() => setOpt('dartSide', o.dartSide === 1 ? -1 : 1)}>Bico deita para a {o.dartSide === 1 ? '2ª' : '1ª'} perna (trocar)</button>
        )}
        <button className="primary" onClick={apply}>
          {q.onEdge ? (o.dartPerp ? 'Criar a pence aqui (Enter)' : 'Começar a pence aqui (Enter)') : 'Pronto (Enter)'}
        </button>
        {q.onEdge && !o.dartPerp && <div className="qm-hint">Depois clique para onde a pence aponta{o.dartMode === 'abrir' ? ' (o pivô)' : ''}.</div>}
      </>
    );
  } else if (tool === 'seam') {
    const run = (a: SeamAction) => {
      closeQuick();
      canvasApi.focus();
      canvasApi.seamAction(q.w, a);
    };
    body = q.onEdge ? (
      <>
        <LiveField label={o.seamHem ? 'Barra' : 'Margem'} value={o.seamMm} onLive={(v) => setOpt('seamMm', v)} inputRef={input} />
        <div className="seg qm-seg" title="Para fora: a linha desenhada é a costura · Para dentro: a linha desenhada é o corte">
          {([['fora', 'Para fora'], ['dentro', 'Para dentro']] as const).map(([k, l]) => (
            <button key={k} className={o.seamDir === k ? 'on' : ''} onClick={() => setOpt('seamDir', k)}>{l}</button>
          ))}
        </div>
        <label className="check" title="Os cantos da margem são rebatidos sobre a dobra, para a barra dobrada encaixar nas laterais">
          <input type="checkbox" checked={o.seamHem} onChange={(e) => setOpt('seamHem', e.target.checked)} /> Barra espelhada
        </label>
        <div className="qm-group">Nesta borda</div>
        <button className="primary" onClick={() => run('borda')}>Aplicar {o.seamDir === 'dentro' ? 'para dentro' : 'para fora'} (Enter)</button>
        <div className="qm-buttons">
          <button className="ghost" onClick={() => run('remover')} title="Tira a margem; o contorno fica onde está">Remover margem</button>
          <button className="ghost" onClick={() => run('removerCorte')} title="Tira a margem e leva o contorno até a linha de corte (o molde não encolhe)">Remover e manter o corte</button>
        </div>
        <div className="qm-group">No molde inteiro</div>
        <div className="qm-buttons">
          <button className="ghost" onClick={() => run('todo')}>Aplicar em todas as bordas</button>
          <button className="ghost" onClick={() => run('zerar')}>Remover todas</button>
          <button className="ghost" onClick={() => run('zerarCorte')} title="Tira todas as margens e o contorno vai para a linha de corte">Remover todas e manter o corte</button>
        </div>
      </>
    ) : (
      <>
        <div className="qm-options">
          <ToolOptions />
        </div>
        <div className="qm-hint">Clique com o direito sobre uma borda para ver as ações dela.</div>
      </>
    );
  } else if (isInner) {
    body = (
      <>
        <LiveField label="Altura de cima" value={o.innerTop} min={0.1} onLive={(v) => setOpt('innerTop', v)} inputRef={input} />
        <LiveField label="Altura de baixo" value={o.innerBottom} min={0.1} onLive={(v) => setOpt('innerBottom', v)} />
        <LiveField label="Largura no meio" value={o.innerWidth} min={0.1} onLive={(v) => setOpt('innerWidth', v)} />
        <LiveField label="Giro" kind="deg" min={-360} value={o.innerAngle} onLive={(v) => setOpt('innerAngle', v)} />
        <label className="qm-row">
          <span>Marcação</span>
          <select value={o.innerMarks} onChange={(e) => setOpt('innerMarks', e.target.value as typeof o.innerMarks)}>
            <option value="ambos">Linhas e furos</option>
            <option value="linhas">Só linhas</option>
            <option value="piques">Só furos</option>
          </select>
        </label>
        <button className="primary" onClick={apply} disabled={!q.inside}>
          {q.inside ? 'Marcar a pence aqui (Enter)' : 'Clique com o direito dentro do molde'}
        </button>
      </>
    );
  } else {
    body = (
      <>
        <div className="qm-options">
          <ToolOptions />
        </div>
        <div className="qm-hint">Enter ou Esc fecha</div>
      </>
    );
  }

  return (
    <div
      ref={box}
      className="quick-menu"
      style={{ left: place?.x ?? -9999, top: place?.y ?? -9999, width: W }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={onKey}
    >
      <div className="qm-title">
        <span>
          <t.icon size={14} stroke={1.7} /> {t.label}
        </span>
        <button className="ghost icon xs" title="Fechar (Esc)" onClick={() => closeQuick()}><IconX size={13} /></button>
      </div>
      {body}
    </div>
  );
}
