/**
 * MENU SUPERIOR (estilo Adobe): Arquivo · Editar · Molde · Ferramentas · Estampa · Exibir · Risco · Ajuda,
 * com ícone e atalho de cada função, mais o campo da Ajuda ("O que você quer fazer?") à direita.
 */
import { Fragment, useEffect, useRef, useState } from 'react';
import { IconArrowRight, IconCheck, IconSearch, IconX } from '@tabler/icons-react';
import { useEditor } from '../editor/store';
import { useRisco } from '../risco/state';
import { CATALOG, type Entry, MENUS, type MenuName, guideSteps, runEntry } from './catalog';
import { searchEntries } from './search';
import { ui, useUi } from './ui';

function MenuItems({ menu }: { menu: MenuName }) {
  const items = CATALOG.filter((e) => e.menu === menu);
  return (
    <div className="mb-drop" role="menu">
      {items.map((e, i) => {
        const off = !!e.enabled && !e.enabled();
        return (
          <Fragment key={e.id}>
            {e.sep && i > 0 && <div className="mb-sep" />}
            {e.section && <div className="mb-section">{e.section}</div>}
            <button
              role="menuitem"
              className="mb-row"
              data-help={`menuitem:${e.id}`}
              disabled={off}
              onClick={() => {
                ui.set({ menu: null });
                runEntry(e);
              }}
            >
              <span className="mb-ico">{e.checked ? (e.checked() ? <IconCheck size={15} stroke={2} /> : null) : e.icon && <e.icon size={15} stroke={1.6} />}</span>
              <span className="mb-label">{e.label}</span>
              {e.key && <span className="mb-key">{e.key}</span>}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Ideias quando o campo da Ajuda está vazio. */
const SUGGESTIONS = ['how:barra', 'printLoc', 'how:escalaEstampa', 'how:estampaTamanho', 'how:sublimacao', 'library', 'tool:coordPoint', 'how:graduar'];

function where(e: Entry): string {
  if (e.about) return e.about;
  if (e.menu) return e.section ? `${e.menu} › ${e.section}` : e.menu;
  return 'Passo a passo';
}

export function startGuide(id: string): void {
  ui.set({ guide: { id, step: 0 }, help: false, menu: null });
}

function HelpBox() {
  const u = useUi();
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  // F1 ou Ajuda › O que você quer fazer? → foca o campo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        ui.set({ help: true, menu: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (u.help) input.current?.focus();
  }, [u.help]);
  useEffect(() => {
    if (!u.help) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) ui.set({ help: false });
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [u.help]);

  const results = q.trim() ? searchEntries(CATALOG, q, 8) : SUGGESTIONS.map((id) => CATALOG.find((e) => e.id === id)!).filter(Boolean);
  const first = results[0];

  return (
    <div className="mb-help" ref={box} data-help="help">
      <IconSearch size={14} />
      <input
        ref={input}
        value={q}
        placeholder="O que você quer fazer?  (F1)"
        onFocus={() => ui.set({ help: true, menu: null })}
        onChange={(e) => {
          setQ(e.target.value);
          ui.set({ help: true });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            ui.set({ help: false });
            input.current?.blur();
          } else if (e.key === 'Enter' && first) startGuide(first.id);
        }}
      />
      {q && (
        <button className="ghost icon xs" title="Limpar" onClick={() => setQ('')}>
          <IconX size={12} />
        </button>
      )}
      {u.help && (
        <div className="help-drop">
          <div className="help-head">{q.trim() ? (results.length ? 'Encontrei isto:' : 'Não achei nada com essas palavras — tente de outro jeito (ex.: "bainha", "estampa", "encaixe").') : 'Escreva do seu jeito o que quer fazer. Algumas ideias:'}</div>
          {results.map((e) => {
            const can = !!e.run && (!e.enabled || e.enabled());
            const n = guideSteps(e).filter((st) => !st.done?.()).length;
            return (
              <div className="help-row" key={e.id}>
                <span className="help-ico">{e.icon ? <e.icon size={16} stroke={1.6} /> : <IconArrowRight size={16} />}</span>
                <div className="help-txt">
                  <b>{e.label}</b>
                  <small>{where(e)}</small>
                </div>
                <div className="help-btns">
                  {n > 0 && (
                    <button className="primary xs" onClick={() => startGuide(e.id)} title="Mostra na tela, passo a passo, onde clicar">
                      Mostrar{n > 1 ? ` (${n} passos)` : ''}
                    </button>
                  )}
                  {can && e.menu && (
                    <button className="ghost xs" onClick={() => {
                      ui.set({ help: false });
                      runEntry(e);
                    }}>Fazer agora</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MenuBar() {
  const u = useUi();
  useEditor(); // itens habilitados acompanham a seleção
  useRisco();
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!u.menu) return;
    const onDown = (e: MouseEvent) => {
      if (!nav.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.guide-bubble')) ui.set({ menu: null });
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && ui.set({ menu: null });
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [u.menu]);

  return (
    <nav className="menubar" ref={nav} aria-label="Menu">
      {MENUS.map((m) => (
        <div className="mb-menu" key={m}>
          <button
            className={`mb-title ${u.menu === m ? 'on' : ''}`}
            data-help={`menu:${m}`}
            onMouseDown={(e) => {
              e.preventDefault();
              ui.set({ menu: u.menu === m ? null : m, help: false });
            }}
            onMouseEnter={() => u.menu && u.menu !== m && ui.set({ menu: m })}
          >
            {m}
          </button>
          {u.menu === m && <MenuItems menu={m} />}
        </div>
      ))}
      <div className="spacer" />
      <HelpBox />
    </nav>
  );
}
