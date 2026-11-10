/**
 * PONTO POR COORDENADA: janela que abre ao lado do ponto de referência clicado.
 * X e Y em mm a partir da referência (X para a direita, Y para cima); Enter cria o ponto interno.
 * "Próximo a partir deste" encadeia: o ponto criado vira a nova referência e os valores ficam —
 * Enter de novo repete o mesmo passo (ex.: botões a cada 8 cm).
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { bboxOfPoints } from '@cad-textil/core';
import { coordStore, editor, fmtInput, fmtLen, notify, parseLen, parseNum, unitLabel, useCoordPick, useViewInfo } from './store';
import { pieceGeom } from './render';
import { canvasApi } from './Canvas';
import { addDrillAt } from './actions';

let chainPref = false;

export function CoordPopup() {
  const pick = useCoordPick();
  useViewInfo(); // redesenha junto com zoom/rolagem/cursor para acompanhar a referência
  const [xTxt, setX] = useState('0');
  const [yTxt, setY] = useState('0');
  const [chain, setChain] = useState(chainPref);
  const xRef = useRef<HTMLInputElement>(null);
  const refKey = pick ? `${pick.ref.x},${pick.ref.y}` : '';
  const lastKey = useRef('');
  /** Lado onde a janela abre (longe do molde, para não tapar o ponto), fixo enquanto ela está aberta. */
  const place = useRef<{ key: string; left: boolean; up: boolean }>({ key: '', left: false, up: false });

  // referência nova clicada: zera os campos já nesta renderização (nada digitado se perde)
  if (pick && refKey !== lastKey.current) {
    lastKey.current = refKey;
    if (!pick.chained && (xTxt !== '0' || yTxt !== '0')) {
      setX('0');
      setY('0');
    }
  }
  if (!pick) lastKey.current = '';

  // foco no X assim que a janela aparece (antes de qualquer tecla chegar ao desenho)
  useLayoutEffect(() => {
    if (!pick || pick.chained) return;
    xRef.current?.focus();
    xRef.current?.select();
  }, [refKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pick) return null;

  const update = (xs: string, ys: string) => {
    setX(xs);
    setY(ys);
    coordStore.set({ pick: { ...pick, dx: parseLen(xs) ?? 0, dy: parseLen(ys) ?? 0 } });
  };
  const valid = parseNum(xTxt || '0') !== null && parseNum(yTxt || '0') !== null;

  const create = () => {
    if (!valid) return;
    const p = { x: pick.ref.x + pick.dx, y: pick.ref.y + pick.dy };
    const piece = addDrillAt(p);
    if (!piece) return;
    notify(`Ponto criado em "${piece.name}" (X ${fmtLen(pick.dx)} · Y ${fmtLen(pick.dy)} da referência)`);
    if (chain) {
      coordStore.set({ pick: { ...pick, ref: p, label: 'último ponto criado', chained: true } });
    } else coordStore.set({ pick: null });
  };
  const close = () => coordStore.set({ pick: null });

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      create();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  // ao lado da referência, do lado de fora do molde, sem sair da área do desenho
  const s = canvasApi.toLocal(pick.ref);
  const vs = canvasApi.viewSize();
  const W = 232, H = 150, GAP = 22;
  if (place.current.key !== refKey && !pick.chained) {
    const st = editor.get();
    const piece = st.doc.pieces.find((q) => q.id === st.selection.pieceId) ?? st.doc.pieces.find((q) => !st.hidden[q.id]);
    let toward = { x: 1, y: -1 };
    if (piece) {
      const bb = bboxOfPoints(pieceGeom(piece).cut);
      toward = { x: (bb.minX + bb.maxX) / 2 - pick.ref.x, y: (bb.minY + bb.maxY) / 2 - pick.ref.y };
    }
    place.current = { key: refKey, left: toward.x >= 0, up: toward.y < 0 };
  }
  place.current.key = refKey;
  let left = place.current.left ? s.x - W - GAP : s.x + GAP;
  let top = place.current.up ? s.y - H - GAP : s.y + GAP;
  // sem espaço do lado de fora (molde encostado na borda da tela): vai para o canto mais longe da referência
  if (left < 28 || left + W > vs.w - 8 || top < 28 || top + H > vs.h - 8) {
    left = s.x > vs.w / 2 ? 36 : vs.w - W - 12;
    top = s.y > vs.h / 2 ? 36 : vs.h - H - 12;
  }

  return (
    <div className="coord-pop" style={{ left, top }} onKeyDown={onKey} onPointerDown={(e) => e.stopPropagation()}>
      <div className="coord-pop-title">
        Ponto por coordenada
        <button className="ghost icon xs" title="Cancelar (Esc)" onClick={close}>×</button>
      </div>
      <div className="coord-pop-ref">A partir de: {pick.label} ({fmtLen(pick.ref.x)}; {fmtLen(pick.ref.y)} {unitLabel()})</div>
      <div className="coord-pop-row">
        <label>
          X <input ref={xRef} value={xTxt} onChange={(e) => update(e.target.value, yTxt)} onFocus={(e) => e.target.select()} /> {unitLabel()}
        </label>
        <label>
          Y <input value={yTxt} onChange={(e) => update(xTxt, e.target.value)} onFocus={(e) => e.target.select()} /> {unitLabel()}
        </label>
      </div>
      <label className="coord-pop-chain">
        <input
          type="checkbox"
          checked={chain}
          onChange={(e) => {
            chainPref = e.target.checked;
            setChain(e.target.checked);
          }}
        />
        Próximo a partir deste ponto
      </label>
      <div className="coord-pop-actions">
        <span className="muted small">X → direita · Y ↑ cima</span>
        <button className="primary" disabled={!valid} onClick={create}>Criar (Enter)</button>
      </div>
    </div>
  );
}
