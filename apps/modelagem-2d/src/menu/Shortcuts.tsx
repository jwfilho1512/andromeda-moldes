/** Janela "Atalhos do teclado" (menu Ajuda). */
import { useEffect } from 'react';
import { IconX } from '@tabler/icons-react';
import { CATALOG, MENUS } from './catalog';
import { ui, useUi } from './ui';

const EXTRA: [string, string][] = [
  ['Espaço + arrastar', 'Mover a vista'],
  ['Roda do mouse', 'Zoom'],
  ['Setas (Shift = 10 mm)', 'Mover o molde 1 mm'],
  ['G', 'Liga/desliga o ímã da grade'],
  ['Enter', 'Conclui o desenho / confirma'],
  ['Esc', 'Cancela / volta para Seleção'],
  ['Alt (arrastando)', 'Movimento livre, sem ímã'],
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
          {MENUS.map((m) => {
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
