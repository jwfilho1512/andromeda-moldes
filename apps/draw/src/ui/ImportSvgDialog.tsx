/**
 * IMPORTAR SVG: escolhe o tamanho (caber na prancha, tamanho real ou escala) e o que fazer com a
 * espessura das linhas — sem isso, um arquivo grande reduzido para a folha ficava com traços
 * enormes (a espessura não acompanhava a redução).
 */
import { useState, useSyncExternalStore } from 'react';
import { IconX } from '@tabler/icons-react';
import type { Vec2 } from '@cad-textil/core';
import { Store, editor } from '../state';
import type { Shape } from '../model/types';
import { placeSvg } from '../importers';

export interface PendingSvg {
  name: string;
  shapes: Shape[];
  /** Tamanho do desenho no arquivo (mm). */
  widthMm: number;
  heightMm: number;
  warnings: string[];
  at: Vec2;
}

export const svgImportStore = new Store<{ pending: PendingSvg | null }>({ pending: null });

export type SizeMode = 'caber' | 'real' | 'escala';
export type LineMode = 'acompanhar' | 'padronizar' | 'manter';

const fmt = (mm: number) => (mm >= 100 ? `${(mm / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} cm` : `${mm.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mm`);

export function ImportSvgDialog() {
  const p = useSyncExternalStore(svgImportStore.subscribe, () => svgImportStore.get().pending);
  const [size, setSize] = useState<SizeMode | null>(null);
  const [pct, setPct] = useState('100');
  const [lines, setLines] = useState<LineMode>('acompanhar');
  const [lineW, setLineW] = useState('0,35');
  if (!p) return null;
  const { w, h } = editor.get().doc.artboard;
  const big = p.widthMm > w * 0.9 || p.heightMm > h * 0.9;
  const tiny = p.widthMm < w * 0.15 && p.heightMm < h * 0.15;
  const mode: SizeMode = size ?? (big || tiny ? 'caber' : 'real');
  const fitK = Math.min((w * 0.9) / (p.widthMm || 1), (h * 0.9) / (p.heightMm || 1));
  const k = mode === 'caber' ? fitK : mode === 'real' ? 1 : Math.max(0.001, Number(pct.replace(',', '.')) / 100 || 1);
  const close = () => {
    svgImportStore.set({ pending: null });
    setSize(null);
  };
  const go = () => {
    placeSvg(p, k, lines, Number(lineW.replace(',', '.')) || 0.35);
    close();
  };
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal import-svg" onKeyDown={(e) => e.key === 'Enter' && go()}>
        <header>
          <b>Importar {p.name}</b>
          <button className="ghost icon x" onClick={close} title="Cancelar (Esc)"><IconX size={16} /></button>
        </header>
        <div className="is-body">
          <p className="muted">
            O desenho do arquivo tem {fmt(p.widthMm)} × {fmt(p.heightMm)}; a prancha tem {fmt(w)} × {fmt(h)}.
            {big ? ' Ele é maior que a prancha.' : ''}
          </p>
          <fieldset>
            <legend>Tamanho</legend>
            <label><input type="radio" checked={mode === 'caber'} onChange={() => setSize('caber')} /> Caber na prancha <em>({Math.round(fitK * 100)}% · {fmt(p.widthMm * fitK)} × {fmt(p.heightMm * fitK)})</em></label>
            <label><input type="radio" checked={mode === 'real'} onChange={() => setSize('real')} /> Tamanho real do arquivo <em>({fmt(p.widthMm)} × {fmt(p.heightMm)})</em></label>
            <label>
              <input type="radio" checked={mode === 'escala'} onChange={() => setSize('escala')} /> Escala
              <input className="pct" value={pct} onFocus={() => setSize('escala')} onChange={(e) => setPct(e.target.value)} /> %
            </label>
          </fieldset>
          <fieldset>
            <legend>Espessura das linhas</legend>
            <label><input type="radio" checked={lines === 'acompanhar'} onChange={() => setLines('acompanhar')} /> Acompanhar o tamanho <em>(recomendado: reduziu o desenho, afina o traço junto)</em></label>
            <label>
              <input type="radio" checked={lines === 'padronizar'} onChange={() => setLines('padronizar')} /> Todas com
              <input className="pct" value={lineW} onFocus={() => setLines('padronizar')} onChange={(e) => setLineW(e.target.value)} /> mm <em>(traço de ficha técnica)</em>
            </label>
            <label><input type="radio" checked={lines === 'manter'} onChange={() => setLines('manter')} /> Manter como no arquivo</label>
          </fieldset>
          {p.warnings.length > 0 && <p className="muted small">{p.warnings.join(' · ')}</p>}
        </div>
        <footer>
          <button className="ghost" onClick={close}>Cancelar</button>
          <button className="primary" onClick={go}>Importar</button>
        </footer>
      </div>
    </div>
  );
}
