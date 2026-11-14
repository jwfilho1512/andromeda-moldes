/**
 * ANDAR MOLDE: janela perto dos moldes com o resultado grande (sobra/falta até o canto,
 * piques, junção) e os controles: barra para rolar, pular de pique em pique, inverter o início,
 * marcar pique, fixar e sair.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { IconArrowsExchange, IconChevronLeft, IconChevronRight, IconPlayerSkipBack, IconX } from '@tabler/icons-react';
import { fmtLen, fmtMm, unitLabel, useViewInfo, useWalk } from './store';
import { canvasApi } from './Canvas';

const W = 300;
const TOL = 1;

export function WalkPanel() {
  const info = useWalk();
  useViewInfo(); // acompanha zoom e rolagem
  const pos = useRef<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [, bump] = useState(0);
  // depois de medir a altura de verdade, puxa a janela para dentro da área do desenho
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !pos.current) return;
    const vs = canvasApi.viewSize();
    const y = Math.max(36, Math.min(pos.current.y, vs.h - el.offsetHeight - 12));
    if (Math.abs(y - pos.current.y) > 0.5) {
      pos.current = { ...pos.current, y };
      bump((n) => n + 1);
    }
  });
  if (!info) {
    pos.current = null;
    return null;
  }

  // abre ao lado do ponto de contato, do lado de fora do molde A, e fica parada durante o arraste
  const vs = canvasApi.viewSize();
  if (!pos.current) {
    const c = canvasApi.toLocal(info.contact);
    const ac = canvasApi.toLocal(info.aCenter);
    const H = 330, GAP = 40;
    let x = ac.x < c.x ? c.x + GAP : c.x - GAP - W;
    let y = ac.y < c.y ? c.y + GAP : c.y - GAP - H;
    x = Math.max(36, Math.min(vs.w - W - 12, x));
    y = Math.max(36, Math.min(vs.h - H - 12, y));
    pos.current = { x, y };
  }

  const diff = info.cornerDiff;
  const ok = diff !== null && Math.abs(diff) <= TOL;
  const worst = info.notchPairs.reduce((m, p) => Math.max(m, Math.abs(p.diff)), 0);
  const smooth = Math.abs(180 - info.startAngleDeg) <= 3;
  const u = unitLabel();
  const verdict =
    diff === null
      ? 'Sem canto à frente'
      : ok
        ? 'As costuras batem no canto'
        : diff > 0
          ? `${info.bName} sobra ${fmtLen(diff)} ${u}`
          : `${info.bName} falta ${fmtLen(-diff)} ${u}`;

  return (
    <div ref={box} className="walk-pop" style={{ left: pos.current.x, top: pos.current.y, width: W }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="walk-pop-title">
        <span>
          <b>{info.aName}</b> × <b>{info.bName}</b>
          {info.mirrored && <em> (virado)</em>}
        </span>
        <button className="ghost icon xs" title="Sair (Esc)" onClick={() => canvasApi.walkExit()}><IconX size={13} /></button>
      </div>
      <div className={`walk-verdict ${diff === null ? '' : ok ? 'good' : 'bad'}`}>{verdict}</div>
      <div className="walk-sub">
        Próximo canto: {info.aName} {info.nextCornerA !== null ? fmtLen(info.nextCornerA) : '—'} · {info.bName} {info.nextCornerB !== null ? fmtLen(info.nextCornerB) : '—'} {u}
      </div>
      <div className="walk-track">
        <input
          type="range"
          min={0}
          max={info.maxS}
          step={0.5}
          value={info.s}
          onChange={(e) => canvasApi.walkTo(Number(e.target.value))}
          aria-label="Quanto andou na costura"
        />
        <div className="walk-ticks">
          {info.marks.map((m) => (
            <i key={m} style={{ left: `${(m / info.maxS) * 100}%` }} />
          ))}
        </div>
      </div>
      <div className="walk-sub">
        Andado <b>{fmtLen(info.s)}</b> de {fmtLen(info.maxS)} {u}
      </div>
      <div className="walk-stats">
        <span className={info.notchPairs.length ? (worst <= TOL ? 'good' : 'bad') : ''}>
          Piques {info.notchPairs.length ? `${info.notchPairs.length} par(es) · maior desvio ${fmtLen(worst)} ${u}` : 'nenhum no trecho'}
        </span>
        <span className={smooth ? 'good' : 'bad'} title="Ângulo na junção do início (180° = curva contínua)">
          Junção {fmtMm(info.startAngleDeg, 1)}° {smooth ? 'contínua' : 'com bico'}
        </span>
      </div>
      <div className="walk-buttons">
        <button className="ghost icon" title="Voltar ao início" onClick={() => canvasApi.walkTo(0)}><IconPlayerSkipBack size={15} /></button>
        <button className="ghost icon" title="Pique ou canto anterior (Shift+N)" onClick={() => canvasApi.walkNext(-1)}><IconChevronLeft size={15} /></button>
        <button className="ghost icon" title="Próximo pique ou canto (N)" onClick={() => canvasApi.walkNext(1)}><IconChevronRight size={15} /></button>
        <button className="ghost" title="Começar pela outra ponta da costura (I)" onClick={() => canvasApi.walkInvert()}><IconArrowsExchange size={14} /> Inverter</button>
      </div>
      <div className="walk-buttons">
        <button className="ghost" onClick={() => canvasApi.walkMarkNotch()}>Marcar pique aqui</button>
        <button className="primary" onClick={() => canvasApi.walkFix()}>Fixar aqui</button>
      </div>
      <div className="walk-hint">Arraste no desenho para andar · gruda nos piques e cantos · setas ±1 mm</div>
    </div>
  );
}
