import { useMemo, useState } from 'react';
import { type Base, CATALOGO, ROTULOS, type CatalogEntry } from '@cad-textil/bases';
import { bboxOfPoints, cutLine, flattenPath, type Piece } from '@cad-textil/core';
import { insertBase } from './actions';
import { fmtMm } from './store';

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

export function LibraryDialog({ onClose }: { onClose: () => void }) {
  const [sel, setSel] = useState<CatalogEntry>(CATALOGO[0]!);
  const [graded, setGraded] = useState(true);
  const base: Base = useMemo(() => (graded ? sel.gerarGraduada() : sel.gerar()), [sel, graded]);
  const groups = (['feminino', 'masculino'] as const).map((g) => ({ g, items: CATALOGO.filter((e) => e.genero === g) }));
  const medidas = Object.entries(ROTULOS)
    .map(([k, label]) => [label, base.medidas[k as keyof typeof ROTULOS]] as const)
    .filter(([, v]) => v > 0);

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal library">
        <header>
          <b>Biblioteca de bases</b>
          <span className="muted">Tamanho M · moldes paramétricos gerados da tabela de medidas</span>
          <button className="x" onClick={onClose} title="Fechar (Esc)">✕</button>
        </header>
        <div className="lib-body">
          <nav>
            {groups.map(({ g, items }) => (
              <div key={g}>
                <h3>{g === 'feminino' ? 'Feminino' : 'Masculino'}</h3>
                {items.map((e) => (
                  <button key={e.id} className={e === sel ? 'active' : ''} onClick={() => setSel(e)}>
                    {e.nome}
                    <small>{e.categoria}</small>
                  </button>
                ))}
              </div>
            ))}
          </nav>
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
                <h4>Moldes</h4>
                <table>
                  <tbody>
                    {base.pecas.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>
                          {p.quantity}x{p.cutInPairs ? ' (par)' : ''}
                        </td>
                        <td className="muted">{p.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
        </div>
      </div>
    </div>
  );
}
