/** Janela "Atalhos do teclado" (menu Ajuda). */
import { useEffect } from 'react';
import { IconX } from '@tabler/icons-react';
import { CATALOG, MENUS } from './catalog';
import { ui, useUi } from './ui';

const EXTRA: [string, string][] = [
  ['Espaço + arrastar', 'Mover a vista'],
  ['Ctrl/⌘ + roda do mouse', 'Zoom'],
  ['Setas (Shift = 5 mm)', 'Mover a seleção 0,5 mm'],
  ['Shift (arrastando)', 'Reta, quadrado ou ângulo de 15°'],
  ['Alt (arrastando a seleção)', 'Duplicar'],
  ['Enter / duplo clique', 'Termina a caneta e a curvatura'],
  ['Esc', 'Cancela o desenho em andamento'],
];

export function ShortcutsDialog() {
  const u = useUi();
  useEffect(() => {
    if (!u.shortcuts) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && ui.set({ shortcuts: false });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [u.shortcuts]);
  if (!u.shortcuts) return null;
  const close = () => ui.set({ shortcuts: false });
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal shortcuts">
        <header>
          <b>Atalhos do teclado</b>
          <button className="ghost icon x" onClick={close} title="Fechar (Esc)"><IconX size={16} /></button>
        </header>
        <div className="sc-body">
          <section>
            <h4>Ferramentas</h4>
            {CATALOG.filter((e) => e.id.startsWith('tool:')).map((e) => (
              <div className="sc-row" key={e.id}><span>{e.label}</span><kbd>{e.key}</kbd></div>
            ))}
          </section>
          {MENUS.filter((m) => m !== 'Ferramentas').map((m) => {
            const rows = CATALOG.filter((e) => e.menu === m && e.key);
            if (!rows.length) return null;
            return (
              <section key={m}>
                <h4>{m}</h4>
                {rows.map((e) => (
                  <div className="sc-row" key={e.id}><span>{e.label}</span><kbd>{e.key}</kbd></div>
                ))}
              </section>
            );
          })}
          <section>
            <h4>Na área de desenho</h4>
            {EXTRA.map(([k, t]) => (
              <div className="sc-row" key={k}><span>{t}</span><kbd>{k}</kbd></div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Janela "Sobre o Andromeda Draw". */
export function AboutDialog() {
  const u = useUi();
  if (!u.about) return null;
  const close = () => ui.set({ about: false });
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal about">
        <header>
          <b>Andromeda Draw</b>
          <button className="ghost icon x" onClick={close} title="Fechar (Esc)"><IconX size={16} /></button>
        </header>
        <div className="about-body">
          <p>Versão <b>{__APP_VERSION__}</b> · parte do Andromeda Fashion Studio (Draw, Moldes e 3D).</p>
          <p className="muted">Desenho de moda, croqui e ficha técnica. Código aberto, licença MIT.</p>
          <p className="muted">Para atualizar, use o hub Andromeda Fashion Studio: ele avisa quando sai versão nova.</p>
        </div>
      </div>
    </div>
  );
}
