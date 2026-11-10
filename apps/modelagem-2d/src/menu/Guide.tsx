/**
 * PASSO A PASSO VISUAL da Ajuda: acende o elemento da tela onde a pessoa deve clicar e mostra um
 * balão "Passo 1 de 3 — clique aqui…". Avança sozinho quando o passo é feito (ferramenta escolhida,
 * molde selecionado, aba trocada…) e pula passos que já estão feitos.
 */
import { useEffect, useMemo, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { editor, notify } from '../editor/store';
import { risco } from '../risco/state';
import { type Entry, type GuideStep, entryById, guideSteps } from './catalog';
import { ui, useUi } from './ui';

function firstPending(steps: GuideStep[], from: number): number {
  let i = from;
  while (i < steps.length && steps[i]!.done?.()) i++;
  return i;
}

function finish(e: Entry) {
  ui.set({ guide: null });
  notify(`Pronto: ${e.label}`);
}

export function GuideOverlay() {
  const u = useUi();
  const entry = u.guide ? entryById(u.guide.id) : undefined;
  const steps = useMemo(() => (entry ? guideSteps(entry) : []), [entry]);
  const [, tick] = useState(0);

  // começa no primeiro passo ainda não feito
  useEffect(() => {
    if (!u.guide || !entry) return;
    ui.set({ lastRun: null });
    const i = firstPending(steps, 0);
    if (i >= steps.length) finish(entry);
    else ui.set({ guide: { id: entry.id, step: i } });
  }, [u.guide?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const idx = u.guide?.step ?? 0;
  const step = steps[idx];

  // ao chegar num passo: prepara a tela (ex.: abre o menu)
  useEffect(() => {
    step?.enter?.();
  }, [u.guide?.id, idx]); // eslint-disable-line react-hooks/exhaustive-deps

  // acompanha a tela (posição do alvo) e avança quando o passo é feito
  useEffect(() => {
    if (!u.guide || !entry) return;
    const check = () => {
      tick((n) => n + 1);
      const g = ui.get().guide;
      if (!g) return;
      const cur = steps[g.step];
      if (cur?.done?.()) {
        const next = firstPending(steps, g.step + 1);
        if (next >= steps.length) finish(entry);
        else ui.set({ guide: { id: g.id, step: next } });
      }
    };
    const offs = [editor.subscribe(check), risco.subscribe(check)];
    const timer = window.setInterval(check, 250);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !ui.get().menu && ui.set({ guide: null });
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', check);
    return () => {
      offs.forEach((f) => f());
      window.clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', check);
    };
  }, [u.guide?.id, steps]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!u.guide || !entry || !step) return null;

  const el = step.target ? (document.querySelector(`[data-help="${step.target}"]`) as HTMLElement | null) : null;
  const r = el?.getBoundingClientRect();
  const visible = r && r.width > 0 && r.height > 0;
  const W = 290;
  let bubble: React.CSSProperties;
  if (visible) {
    const vw = window.innerWidth, vh = window.innerHeight;
    // área grande (desenho): balão dentro dela, no canto de cima; alvo pequeno: ao lado
    if (r.width > vw * 0.4 && r.height > vh * 0.4) bubble = { left: r.left + 16, top: r.top + 16 };
    else if (r.right + 14 + W < vw) bubble = { left: r.right + 14, top: Math.max(8, Math.min(r.top - 6, vh - 200)) };
    else if (r.left - 14 - W > 0) bubble = { left: r.left - 14 - W, top: Math.max(8, Math.min(r.top - 6, vh - 200)) };
    else bubble = { left: Math.max(8, Math.min(r.left, vw - W - 8)), top: Math.min(r.bottom + 12, vh - 200) };
  } else bubble = { left: '50%', top: '30%', transform: 'translateX(-50%)' };

  const last = idx === steps.length - 1;
  const total = steps.length;
  const ring = visible && !(r.width > window.innerWidth * 0.4 && r.height > window.innerHeight * 0.4);

  return (
    <>
      {visible && (
        <div
          className={`guide-ring ${ring ? '' : 'area'}`}
          style={{ left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 }}
        />
      )}
      <div className="guide-bubble" style={{ ...bubble, width: W }} role="dialog" aria-label="Passo a passo">
        <div className="guide-top">
          <span>Passo {idx + 1} de {total}</span>
          <button className="ghost icon xs" title="Fechar (Esc)" onClick={() => ui.set({ guide: null })}>
            <IconX size={12} />
          </button>
        </div>
        <b className="guide-title">{entry.label}</b>
        <p className="guide-text">{step.text}</p>
        {step.target && !visible && <p className="guide-note">Essa parte da tela não está visível agora — abra a área indicada.</p>}
        <div className="guide-btns">
          {idx > 0 && (
            <button className="ghost xs" onClick={() => ui.set({ guide: { id: entry.id, step: idx - 1 } })}>
              Voltar
            </button>
          )}
          <span className="spacer" />
          {step.done && !last ? (
            <span className="muted small">avança sozinho quando você fizer</span>
          ) : (
            <button className="primary xs" onClick={() => (last ? finish(entry) : ui.set({ guide: { id: entry.id, step: idx + 1 } }))}>
              {last ? 'Concluir' : 'Próximo'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
