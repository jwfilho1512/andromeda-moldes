/**
 * CAIXA DE COORDENADAS (fixa na barra, nas ferramentas de construção): mostra ao vivo Dx, Dy,
 * ângulo e distância do ponto de referência até o mouse (e o perímetro da curva). Digitar num
 * campo trava o valor (cadeado); o lado segue o mouse. Enter coloca o ponto.
 * Diferente do Audaces: não abre janela, aceita vírgula ou ponto e já mostra o resultado na tela.
 */
import { useState } from 'react';
import { IconLock, IconLockOpen } from '@tabler/icons-react';
import { flattenPath, pathThroughPoints } from '@cad-textil/core';
import { fmtLen, fmtMm, parseLen, parseNum, unitLabel, useEditor } from './store';
import { type Locks, consStore, resetOp, setLocks, useCons } from './construction';
import { canvasApi } from './Canvas';

type K = keyof Locks;

function Field({ k, label, live, deg }: { k: K; label: string; live: number | null; deg?: boolean }) {
  const cs = useCons();
  const locked = cs.locks[k];
  const [text, setText] = useState<string | null>(null);
  const show = (v: number | null) => (v === null ? '' : deg ? fmtMm(v, 1) : fmtLen(v));
  const value = text ?? show(locked ?? live);
  const parse = (t: string) => (deg ? parseNum(t) : parseLen(t));
  return (
    <span className={`cb-field ${locked !== undefined ? 'on' : ''}`}>
      <span className="cb-k">{label}</span>
      <input
        value={value}
        placeholder="—"
        onFocus={(e) => {
          setText(show(locked ?? live));
          e.target.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          const v = parse(e.target.value);
          if (e.target.value.trim() === '') setLocks({}, [k]);
          else if (v !== null) setLocks({ [k]: v });
        }}
        onBlur={() => setText(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            setText(null);
            (e.target as HTMLInputElement).blur();
            canvasApi.consEnter();
            canvasApi.focus();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setLocks({}, [k]);
            setText(null);
            (e.target as HTMLInputElement).blur();
            canvasApi.focus();
          }
        }}
      />
      <em>{deg ? '°' : unitLabel()}</em>
      <button className="ghost icon xs" title={locked !== undefined ? 'Destravar' : 'Travar este valor'} onClick={() => (locked !== undefined ? setLocks({}, [k]) : live !== null && setLocks({ [k]: live }))}>
        {locked !== undefined ? <IconLock size={12} /> : <IconLockOpen size={12} />}
      </button>
    </span>
  );
}

export function CoordBox({ tool }: { tool: string }) {
  useEditor(); // unidade
  const cs = useCons();
  const a = cs.anchor, t = cs.target;
  const dx = a && t ? Math.abs(t.x - a.x) : null;
  const dy = a && t ? Math.abs(t.y - a.y) : null;
  const d = a && t ? Math.hypot(t.x - a.x, t.y - a.y) : null;
  const ang = a && t && d ? (((Math.atan2(t.y - a.y, t.x - a.x) * 180) / Math.PI) + 360) % 360 : null;
  let per: number | null = null;
  if (tool === 'cCurve' && cs.pts.length) {
    const pts = t ? [...cs.pts, t] : cs.pts;
    if (pts.length >= 2) {
      const fp = flattenPath(pathThroughPoints(pts.map((p, i) => ({ p, corner: i === 0 || i === pts.length - 1 })), false), 0.05);
      per = fp.reduce((s, p, i) => (i ? s + Math.hypot(p.x - fp[i - 1]!.x, p.y - fp[i - 1]!.y) : 0), 0);
    }
  }
  return (
    <span className="coordbox" data-help="ctrl:coord">
      <span className="cb-ref" title="Ponto de referência">{a ? `De: ${cs.refLabel}` : tool === 'cCurve' ? 'Clique o 1º ponto' : 'Clique a referência'}</span>
      <Field k="dx" label="Dx" live={dx} />
      <Field k="dy" label="Dy" live={dy} />
      <Field k="a" label="Ângulo" live={ang} deg />
      <Field k="d" label="Dist." live={d} />
      {tool === 'cCurve' && (
        <span className="cb-field ro">
          <span className="cb-k">Perímetro</span>
          <b>{per === null ? '—' : fmtLen(per)}</b>
          <em>{unitLabel()}</em>
        </span>
      )}
      <button className="ghost" title="Destrava todos os valores e cancela a operação" onClick={() => (Object.keys(consStore.get().locks).length ? setLocks({}, ['dx', 'dy', 'a', 'd']) : resetOp())}>
        Limpar
      </button>
    </span>
  );
}
