import { useMemo, useState } from 'react';
import { type Base, CATALOGO, ROTULOS, type CatalogEntry } from '@cad-textil/bases';
import { bboxOfPoints, cutLine, flattenPath, type Piece } from '@cad-textil/core';
import { insertBase } from './actions';
import { fmtMm, selectedPieces, useEditor } from './store';
import { CATEGORIAS, GENEROS, type Genero, type MyBase, copyBuiltIn, deleteBase, exportBases, importBases, myBases, replaceBasePieces, saveAsBase, updateBaseInfo, useMyBases } from './mybases';

/** Pré-visualização em SVG: moldes lado a lado (linha de corte + costura). */
function Preview({ pieces }: { pieces: Piece[] }) {
  const layout = useMemo(() => {
    let x = 0;
    let maxH = 0;
    const items = pieces.map((p) => {
      const cut = cutLine(p);
      const sew = flattenPath(p.outline);
      const bb = bboxOfPoints(cut);
      const ox = x - bb.minX;
      const oy = bb.maxY; // inverte Y (SVG cresce para baixo)
      x += bb.maxX - bb.minX + 40;
      maxH = Math.max(maxH, bb.maxY - bb.minY);
      const toD = (pts: { x: number; y: number }[]) => 'M' + pts.map((q) => `${(q.x + ox).toFixed(1)},${(oy - q.y).toFixed(1)}`).join('L') + 'Z';
      return { id: p.id, name: p.name, cut: toD(cut), sew: toD(sew), cx: x - (bb.maxX - bb.minX) / 2 - 40, h: bb.maxY - bb.minY };
    });
    return { items, w: Math.max(x - 40, 1), h: Math.max(maxH, 1) };
  }, [pieces]);
  return (
    <svg className="preview" viewBox={`-20 -20 ${layout.w + 40} ${layout.h + 40}`} preserveAspectRatio="xMidYMid meet">
      {layout.items.map((it) => (
        <g key={it.id}>
          <path d={it.cut} className="pv-cut" />
          <path d={it.sew} className="pv-sew" />
        </g>
      ))}
    </svg>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <>
      <h4>{title}</h4>
      <ul>
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </>
  );
}

type Sel = { kind: 'builtin'; e: CatalogEntry } | { kind: 'mine'; id: string } | { kind: 'new' };

export function LibraryDialog({ onClose }: { onClose: () => void }) {
  const mb = useMyBases();
  const [sel, setSel] = useState<Sel>({ kind: 'builtin', e: CATALOGO[0]! });
  const groups = (['feminino', 'masculino'] as const).map((g) => ({ g, items: CATALOGO.filter((e) => e.genero === g) }));
  const mine = mb.file.bases;
  const cur = sel.kind === 'mine' ? mine.find((b) => b.id === sel.id) : undefined;

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal library">
        <header>
          <b>Biblioteca de bases</b>
          <span className="muted">Bases do Andromeda (tamanho M, paramétricas) e as bases da sua equipe</span>
          <button className="x" onClick={onClose} title="Fechar (Esc)">✕</button>
        </header>
        <div className="lib-body">
          <nav>
            <h3>Minhas bases</h3>
            <button className={`newbase ${sel.kind === 'new' ? 'active' : ''}`} onClick={() => setSel({ kind: 'new' })}>
              + Salvar moldes como base
            </button>
            {mine.map((b) => (
              <button key={b.id} className={sel.kind === 'mine' && sel.id === b.id ? 'active' : ''} onClick={() => setSel({ kind: 'mine', id: b.id })}>
                {b.nome}
                <small>{b.categoria}</small>
              </button>
            ))}
            {!mine.length && <p className="muted small nav-note">Salve aqui as bases da casa e use em qualquer arquivo.</p>}
            <div className="nav-actions">
              <button
                className="ghost"
                title="Pacote .moldesbases de um colega, ou um arquivo .ctx (vira uma base)"
                onClick={async () => {
                  const b = await importBases();
                  if (b) setSel({ kind: 'mine', id: b.id });
                }}
              >
                Importar
              </button>
              <button className="ghost" title="Pacote .moldesbases com todas as Minhas bases, para passar aos colegas" onClick={() => void exportBases()}>
                Exportar
              </button>
            </div>
            {groups.map(({ g, items }) => (
              <div key={g}>
                <h3>Andromeda · {g === 'feminino' ? 'Feminino' : 'Masculino'}</h3>
                {items.map((e) => (
                  <button key={e.id} className={sel.kind === 'builtin' && e === sel.e ? 'active' : ''} onClick={() => setSel({ kind: 'builtin', e })}>
                    {e.nome}
                    <small>{e.categoria}</small>
                  </button>
                ))}
              </div>
            ))}
          </nav>
          {sel.kind === 'builtin' && <BuiltInDetail entry={sel.e} onClose={onClose} onCopied={(id) => setSel({ kind: 'mine', id })} />}
          {sel.kind === 'mine' && cur && <MyBaseDetail key={cur.id} b={cur} onClose={onClose} onDeleted={() => setSel({ kind: 'builtin', e: CATALOGO[0]! })} />}
          {sel.kind === 'mine' && !cur && <section className="ficha muted">Base não encontrada.</section>}
          {sel.kind === 'new' && <NewBaseForm onSaved={(id) => setSel({ kind: 'mine', id })} />}
        </div>
      </div>
    </div>
  );
}

function BuiltInDetail({ entry, onClose, onCopied }: { entry: CatalogEntry; onClose: () => void; onCopied: (id: string) => void }) {
  const [graded, setGraded] = useState(true);
  const base: Base = useMemo(() => (graded ? entry.gerarGraduada() : entry.gerar()), [entry, graded]);
  const medidas = Object.entries(ROTULOS)
    .map(([k, label]) => [label, base.medidas[k as keyof typeof ROTULOS]] as const)
    .filter(([, v]) => v > 0);
  return (
    <section className="ficha">
      <div className="ficha-head">
        <div>
          <h2>{base.nome}</h2>
          <p className="muted">
            {base.categoria} · {base.genero} · tamanho {base.tamanho} · {base.pecas.length} moldes
          </p>
        </div>
        <label className="row check" title="Insere todos os tamanhos da grade (regras calculadas pela tabela de medidas)">
          <span>Graduada</span>
          <input type="checkbox" checked={graded} onChange={(e) => setGraded(e.target.checked)} />
        </label>
        <button
          title="Copia esta base para Minhas bases, para você ajustar do jeito da casa"
          onClick={async () => {
            const b = await copyBuiltIn(base.nome, base.categoria, base.genero, base.descricao, base.pecas);
            onCopied(b.id);
          }}
        >
          Copiar para Minhas bases
        </button>
        <button
          className="primary"
          onClick={() => {
            insertBase(base);
            onClose();
          }}
        >
          Inserir no documento
        </button>
      </div>
      <Preview pieces={base.pecas} />
      <p>{base.descricao}</p>
      <div className="cols">
        <div>
          <PiecesTable pieces={base.pecas} />
          <Section title="Tecido" items={[base.tecido]} />
          <Section title="Aviamentos" items={base.aviamentos} />
        </div>
        <div>
          <Section title="Folgas" items={base.folgas} />
          <Section title="Margens de costura" items={base.margens} />
          <Section title="Conferências (calculadas)" items={base.conferencias} />
          <h4>Medidas usadas (cm)</h4>
          <table className="medidas">
            <tbody>
              {medidas.map(([label, v]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{fmtMm(v, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function PiecesTable({ pieces }: { pieces: Piece[] }) {
  return (
    <>
      <h4>Moldes</h4>
      <table>
        <tbody>
          {pieces.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>
                {p.quantity}x{p.cutInPairs ? ' (par)' : ''}
              </td>
              <td className="muted">{p.grading ? `graduado · ${p.grading.sizes.length} tamanhos` : ''}</td>
              <td className="muted">{p.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function InfoFields({ v, set }: { v: Pick<MyBase, 'nome' | 'categoria' | 'genero' | 'descricao'>; set: (p: Partial<Pick<MyBase, 'nome' | 'categoria' | 'genero' | 'descricao'>>) => void }) {
  return (
    <div className="base-fields">
      <label>
        Nome
        <input value={v.nome} placeholder="Camisa social da casa" onChange={(e) => set({ nome: e.target.value })} />
      </label>
      <label>
        Categoria
        <select value={v.categoria} onChange={(e) => set({ categoria: e.target.value })}>
          {[...new Set([...CATEGORIAS, v.categoria])].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        Gênero
        <select value={v.genero} onChange={(e) => set({ genero: e.target.value as Genero })}>
          {GENEROS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      <label className="wide">
        Observações
        <textarea rows={2} value={v.descricao} placeholder="Tecido, folgas, tabela de medidas usada…" onChange={(e) => set({ descricao: e.target.value })} />
      </label>
    </div>
  );
}

/** Quantos moldes vão para a base agora (selecionados ou todos). */
function useSource() {
  const s = useEditor();
  const sel = selectedPieces(s);
  return { n: sel.length || s.doc.pieces.length, which: sel.length ? 'selecionados' : 'do documento' };
}

function NewBaseForm({ onSaved }: { onSaved: (id: string) => void }) {
  const src = useSource();
  const [v, setV] = useState({ nome: '', categoria: 'Outras', genero: 'feminino' as Genero, descricao: '' });
  return (
    <section className="ficha">
      <h2>Salvar moldes como base</h2>
      <p className="muted">
        Vão para a base os <b>{src.n} moldes {src.which}</b>, com graduação, margens, piques e estampas. Para escolher só alguns, feche a biblioteca, selecione os moldes e volte.
      </p>
      <InfoFields v={v} set={(p) => setV({ ...v, ...p })} />
      <button
        className="primary"
        disabled={!src.n}
        onClick={async () => {
          const b = await saveAsBase(v);
          if (b) onSaved(b.id);
        }}
      >
        Salvar em Minhas bases
      </button>
    </section>
  );
}

function MyBaseDetail({ b, onClose, onDeleted }: { b: MyBase; onClose: () => void; onDeleted: () => void }) {
  const src = useSource();
  const [v, setV] = useState({ nome: b.nome, categoria: b.categoria, genero: b.genero, descricao: b.descricao });
  const dirty = v.nome !== b.nome || v.categoria !== b.categoria || v.genero !== b.genero || v.descricao !== b.descricao;
  return (
    <section className="ficha">
      <div className="ficha-head">
        <div>
          <h2>{b.nome}</h2>
          <p className="muted">
            {b.categoria} · {GENEROS.find((g) => g.id === b.genero)?.label} · {b.pecas.length} moldes · atualizada em {new Date(b.atualizadaEm).toLocaleDateString('pt-BR')}
          </p>
        </div>
        <button
          className="primary"
          onClick={() => {
            insertBase({ nome: b.nome, pecas: b.pecas });
            myBases.set({ lastInserted: b.id });
            onClose();
          }}
        >
          Inserir no documento
        </button>
      </div>
      <InfoFields v={v} set={(p) => setV({ ...v, ...p })} />
      <div className="row base-actions">
        <button disabled={!dirty} onClick={() => void updateBaseInfo(b.id, v)}>
          Salvar dados
        </button>
        <button
          title="Para editar: insira a base, ajuste os moldes, selecione e clique aqui"
          disabled={!src.n}
          onClick={() => {
            if (window.confirm(`Trocar os moldes de "${b.nome}" pelos ${src.n} moldes ${src.which}?`)) void replaceBasePieces(b.id);
          }}
        >
          Atualizar com os {src.n} moldes {src.which}
        </button>
        <button className="ghost" onClick={() => void exportBases([b.id])}>
          Exportar esta
        </button>
        <span className="spacer" />
        <button
          className="ghost danger"
          onClick={() => {
            if (window.confirm(`Excluir a base "${b.nome}"? Os documentos que já usam esses moldes não mudam.`)) {
              void deleteBase(b.id);
              onDeleted();
            }
          }}
        >
          Excluir
        </button>
      </div>
      <p className="muted small">Para editar os moldes: clique em Inserir, ajuste no documento, abra a biblioteca de novo e use “Atualizar com os moldes”.</p>
      <Preview pieces={b.pecas} />
      <PiecesTable pieces={b.pecas} />
    </section>
  );
}
