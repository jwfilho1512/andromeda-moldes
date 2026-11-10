/**
 * Ficha técnica: página A4 deitada, editável na tela e impressa em PDF.
 * O desenho vem direto do documento; aviamentos podem ser contados do desenho.
 */
import { IconExternalLink, IconLink, IconPlus, IconTrash, IconWand } from '@tabler/icons-react';
import { type ReactNode, useMemo } from 'react';
import { type Aviamento, type Cor, type Ficha, type FichaStatus, type Lavagem, type Material, type Medida, type Operacao, STATUS_LABEL } from '../model/ficha';
import { bboxOfShapes } from '../model/geom';
import { defsSvg, shapeSvg } from '../model/svg';
import { STITCH_LABEL } from '../model/stitch';
import { TRIM_LABEL } from '../model/trims';
import type { Shape } from '../model/types';
import { platform } from '../platform';
import { editor, notify, setFicha, useEditor } from '../state';

function Field({ label, value, onChange, wide }: { label: string; value: string; onChange: (v: string) => void; wide?: boolean }) {
  return (
    <label className={`ff ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Block({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="fblock">
      <header>
        <h4>{title}</h4>
        <span className="no-print">{actions}</span>
      </header>
      {children}
    </section>
  );
}

/** Tabela editável genérica. */
function Table<T>({ rows, cols, onChange, make }: { rows: T[]; cols: { key: keyof T; label: string; w?: string; num?: boolean }[]; onChange: (r: T[]) => void; make: () => T }) {
  return (
    <table className="ftable">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={String(c.key)} style={{ width: c.w }}>
              {c.label}
            </th>
          ))}
          <th className="no-print" style={{ width: 24 }} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td key={String(c.key)}>
                <input
                  className={c.num ? 'n' : ''}
                  value={String(r[c.key] ?? '')}
                  onChange={(e) => {
                    const v = c.num ? Number(e.target.value.replace(',', '.')) || 0 : e.target.value;
                    onChange(rows.map((x, j) => (j === i ? { ...x, [c.key]: v } : x)));
                  }}
                />
              </td>
            ))}
            <td className="no-print">
              <button className="ghost icon" title="Remover linha" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                <IconTrash size={13} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot className="no-print">
        <tr>
          <td colSpan={cols.length + 1}>
            <button className="ghost" onClick={() => onChange([...rows, make()])}>
              <IconPlus size={13} /> Linha
            </button>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function Medidas({ f }: { f: Ficha }) {
  const set = (medidas: Medida[]) => setFicha({ medidas });
  const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
  return (
    <table className="ftable">
      <thead>
        <tr>
          <th style={{ width: '34%' }}>Ponto de medida (cm)</th>
          {f.tamanhos.map((t) => (
            <th key={t} className={t === f.tamanhoBase ? 'base' : ''}>
              {t}
            </th>
          ))}
          <th>Tol. ±</th>
          <th className="no-print" style={{ width: 24 }} />
        </tr>
      </thead>
      <tbody>
        {f.medidas.map((m, i) => (
          <tr key={i}>
            <td>
              <input value={m.pom} onChange={(e) => set(f.medidas.map((x, j) => (j === i ? { ...x, pom: e.target.value } : x)))} />
            </td>
            {f.tamanhos.map((t) => (
              <td key={t} className={t === f.tamanhoBase ? 'base' : ''}>
                <input
                  className="n"
                  value={fmt(m.valores[t])}
                  onChange={(e) => {
                    const raw = e.target.value.trim().replace(',', '.');
                    const v = raw === '' ? null : Number(raw);
                    if (v !== null && !Number.isFinite(v)) return;
                    set(f.medidas.map((x, j) => (j === i ? { ...x, valores: { ...x.valores, [t]: v } } : x)));
                  }}
                />
              </td>
            ))}
            <td>
              <input className="n" value={fmt(m.tol)} onChange={(e) => set(f.medidas.map((x, j) => (j === i ? { ...x, tol: Number(e.target.value.replace(',', '.')) || 0 } : x)))} />
            </td>
            <td className="no-print">
              <button className="ghost icon" title="Remover" onClick={() => set(f.medidas.filter((_, j) => j !== i))}>
                <IconTrash size={13} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot className="no-print">
        <tr>
          <td colSpan={f.tamanhos.length + 3}>
            <button className="ghost" onClick={() => set([...f.medidas, { pom: '', tol: 1, valores: {} }])}>
              <IconPlus size={13} /> Medida
            </button>
            <label className="inline">
              Tamanhos
              <input
                value={f.tamanhos.join(' ')}
                onChange={(e) => {
                  const t = e.target.value.split(/[\s,;]+/).filter(Boolean);
                  if (t.length) setFicha({ tamanhos: t, tamanhoBase: t.includes(f.tamanhoBase) ? f.tamanhoBase : t[Math.floor(t.length / 2)]! });
                }}
              />
            </label>
            <label className="inline">
              Base
              <select value={f.tamanhoBase} onChange={(e) => setFicha({ tamanhoBase: e.target.value })}>
                {f.tamanhos.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

/* ---------------- símbolos de cuidado (desenho próprio, traço simples) ---------------- */
const CARE: { id: Lavagem; label: string; d: string; text?: string; x?: boolean }[] = [
  { id: 'lavar30', label: 'Lavar a 30 °C', d: 'M3 7h18l-2 12H5zM3 7c2 2 4 2 6 0s4-2 6 0 4 2 6 0', text: '30' },
  { id: 'lavar40', label: 'Lavar a 40 °C', d: 'M3 7h18l-2 12H5zM3 7c2 2 4 2 6 0s4-2 6 0 4 2 6 0', text: '40' },
  { id: 'lavarMao', label: 'Lavar à mão', d: 'M3 7h18l-2 12H5zM3 7c2 2 4 2 6 0s4-2 6 0 4 2 6 0M9 15v-5m2 5v-6m2 6v-5m2 5v-3' },
  { id: 'naoLavar', label: 'Não lavar', d: 'M3 7h18l-2 12H5zM3 7c2 2 4 2 6 0s4-2 6 0 4 2 6 0', x: true },
  { id: 'alvejante', label: 'Pode alvejar', d: 'M12 4L22 20H2z' },
  { id: 'naoAlvejar', label: 'Não alvejar', d: 'M12 4L22 20H2z', x: true },
  { id: 'secadora', label: 'Secadora', d: 'M3 3h18v18H3zM12 7a5 5 0 1 0 0.01 0' },
  { id: 'naoSecadora', label: 'Não usar secadora', d: 'M3 3h18v18H3zM12 7a5 5 0 1 0 0.01 0', x: true },
  { id: 'secarVaral', label: 'Secar no varal', d: 'M3 3h18v18H3zM5 5c4 4 10 4 14 0' },
  { id: 'secarSombra', label: 'Secar à sombra', d: 'M3 3h18v18H3zM3 9l6-6M3 15L15 3' },
  { id: 'passarBaixa', label: 'Passar em temperatura baixa', d: 'M4 18h17l-1-6c-.5-3-3-4-6-4H8M4 18l2-6h14' + 'M12 15h0.01' },
  { id: 'passarMedia', label: 'Passar em temperatura média', d: 'M4 18h17l-1-6c-.5-3-3-4-6-4H8M4 18l2-6h14M10 15h0.01M14 15h0.01' },
  { id: 'naoPassar', label: 'Não passar', d: 'M4 18h17l-1-6c-.5-3-3-4-6-4H8M4 18l2-6h14', x: true },
  { id: 'aSeco', label: 'Limpeza a seco', d: 'M12 3a9 9 0 1 0 0.01 0', text: 'P' },
  { id: 'naoASeco', label: 'Não lavar a seco', d: 'M12 3a9 9 0 1 0 0.01 0', x: true },
];

function CareIcon({ c, size = 26 }: { c: (typeof CARE)[number]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round">
      <path d={c.d} />
      {c.text && (
        <text x="12" y={c.id.startsWith('lavar') ? 16.5 : 15.5} textAnchor="middle" fontSize="7" fill="currentColor" stroke="none" fontFamily="Helvetica, Arial, sans-serif">
          {c.text}
        </text>
      )}
      {c.x && <path d="M3 3l18 18M21 3L3 21" />}
    </svg>
  );
}

/** Conta aviamentos e zíperes desenhados (com a simetria, conta o par). */
function countTrims(shapes: Shape[]): Aviamento[] {
  const count = new Map<string, number>();
  const walk = (s: Shape, mirror: boolean) => {
    const m = mirror || s.mirror !== undefined;
    if (s.kind === 'trim') count.set(TRIM_LABEL[s.trim], (count.get(TRIM_LABEL[s.trim]) ?? 0) + (m ? 2 : 1));
    if (s.kind === 'stitch' && s.stitch.type === 'ziper') count.set(STITCH_LABEL.ziper, (count.get(STITCH_LABEL.ziper) ?? 0) + (m ? 2 : 1));
    if (s.kind === 'group') s.children.forEach((c) => walk(c, m));
  };
  shapes.forEach((s) => walk(s, false));
  return [...count.entries()].map(([item, qtd]) => ({ item, desc: '', cor: '', qtd, unidade: 'un' }));
}

export function FichaView() {
  const s = useEditor();
  const f = s.doc.ficha;
  const drawing = useMemo(() => {
    // enquadra só o desenho (sem a camada de croqui), com uma folga
    const shapes = s.doc.layers.filter((l) => l.visible && l.id !== 'croqui').flatMap((l) => l.shapes);
    const b = bboxOfShapes(shapes);
    const pad = b ? Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.04 : 0;
    const vb = b ? `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}` : `0 0 ${s.doc.artboard.w} ${s.doc.artboard.h}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"><defs>${defsSvg(shapes)}</defs>${shapes.map((x) => shapeSvg(x)).join('')}</svg>`;
  }, [s.doc]);
  const totalTempo = f.sequencia.reduce((a, o) => a + (o.tempo || 0), 0);

  const pullTrims = () => {
    const found = countTrims(s.doc.layers.filter((l) => l.id !== 'croqui').flatMap((l) => l.shapes));
    if (!found.length) {
      notify('Nenhum aviamento desenhado ainda', 'erro');
      return;
    }
    const keep = f.aviamentos.filter((a) => !found.some((x) => x.item === a.item));
    const merged = found.map((x) => ({ ...(f.aviamentos.find((a) => a.item === x.item) ?? x), qtd: x.qtd }));
    setFicha({ aviamentos: [...merged, ...keep] });
    notify(`${found.length} tipo(s) de aviamento contados no desenho`);
  };

  const linkMoldes = async () => {
    const r = await platform.pickLink();
    if (r) setFicha({ moldes: r });
    else if (!platform.isDesktop) notify('Vincular arquivos funciona no app instalado', 'erro');
  };

  return (
    <div className="ficha-wrap">
      <div className="ficha-page">
        <header className="fhead">
          <div className="fbrand">
            <b>Ficha técnica</b>
            <small>Andromeda Fashion Studio</small>
          </div>
          <div className="fgrid">
            <Field label="Referência" value={f.ref} onChange={(ref) => setFicha({ ref })} />
            <Field label="Produto" value={f.nome} onChange={(nome) => setFicha({ nome })} wide />
            <Field label="Coleção" value={f.colecao} onChange={(colecao) => setFicha({ colecao })} />
            <Field label="Marca" value={f.marca} onChange={(marca) => setFicha({ marca })} />
            <Field label="Estilista" value={f.estilista} onChange={(estilista) => setFicha({ estilista })} />
            <Field label="Modelista" value={f.modelista} onChange={(modelista) => setFicha({ modelista })} />
            <Field label="Data" value={f.data} onChange={(data) => setFicha({ data })} />
            <label className="ff">
              <span>Status</span>
              <select value={f.status} onChange={(e) => setFicha({ status: e.target.value as FichaStatus })} className={`status-${f.status}`}>
                {(Object.keys(STATUS_LABEL) as FichaStatus[]).map((k) => (
                  <option key={k} value={k}>
                    {STATUS_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className="fbody">
          <div className="fcol">
            <Block title="Desenho técnico">
              <div className="fdrawing" dangerouslySetInnerHTML={{ __html: drawing }} />
            </Block>
            <Block title="Tecido">
              <div className="fgrid three">
                <Field label="Tecido principal" value={f.tecido} onChange={(tecido) => setFicha({ tecido })} />
                <Field label="Composição" value={f.composicao} onChange={(composicao) => setFicha({ composicao })} />
                <Field label="Gramatura" value={f.gramatura} onChange={(gramatura) => setFicha({ gramatura })} />
                <Field label="Consumo por peça (do risco)" value={f.consumo} onChange={(consumo) => setFicha({ consumo })} />
              </div>
            </Block>
            <Block title="Cuidados (etiqueta)">
              <div className="care">
                {CARE.map((c) => {
                  const on = f.lavagem.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      className={`care-btn ${on ? 'on' : 'off'}`}
                      title={c.label}
                      onClick={() => setFicha({ lavagem: on ? f.lavagem.filter((x) => x !== c.id) : [...f.lavagem, c.id] })}
                    >
                      <CareIcon c={c} />
                    </button>
                  );
                })}
              </div>
            </Block>
          </div>

          <div className="fcol">
            <Block title="Tabela de medidas">
              <Medidas f={f} />
            </Block>
            <Block title="Materiais">
              <Table<Material>
                rows={f.materiais}
                onChange={(materiais) => setFicha({ materiais })}
                make={() => ({ item: '', desc: '', cor: '', consumo: '', fornecedor: '' })}
                cols={[
                  { key: 'item', label: 'Item', w: '22%' },
                  { key: 'desc', label: 'Descrição' },
                  { key: 'cor', label: 'Cor', w: '14%' },
                  { key: 'consumo', label: 'Consumo', w: '14%' },
                  { key: 'fornecedor', label: 'Fornecedor', w: '18%' },
                ]}
              />
            </Block>
            <Block
              title="Aviamentos"
              actions={
                <button className="ghost" onClick={pullTrims} title="Conta botões, ilhoses, rebites, zíperes… desenhados">
                  <IconWand size={13} /> Contar do desenho
                </button>
              }
            >
              <Table<Aviamento>
                rows={f.aviamentos}
                onChange={(aviamentos) => setFicha({ aviamentos })}
                make={() => ({ item: '', desc: '', cor: '', qtd: 1, unidade: 'un' })}
                cols={[
                  { key: 'item', label: 'Item', w: '28%' },
                  { key: 'desc', label: 'Descrição' },
                  { key: 'cor', label: 'Cor', w: '16%' },
                  { key: 'qtd', label: 'Qtd.', w: '10%', num: true },
                  { key: 'unidade', label: 'Un.', w: '10%' },
                ]}
              />
            </Block>
            <Block title={`Sequência operacional${totalTempo ? ` · ${totalTempo.toFixed(2).replace('.', ',')} min` : ''}`}>
              <Table<Operacao>
                rows={f.sequencia}
                onChange={(sequencia) => setFicha({ sequencia })}
                make={() => ({ op: '', maquina: '', tempo: 0 })}
                cols={[
                  { key: 'op', label: 'Operação' },
                  { key: 'maquina', label: 'Máquina', w: '30%' },
                  { key: 'tempo', label: 'Min.', w: '14%', num: true },
                ]}
              />
            </Block>
            <Block title="Cores">
              <Table<Cor>
                rows={f.cores}
                onChange={(cores) => setFicha({ cores })}
                make={() => ({ nome: '', codigo: '', hex: '#ffffff' })}
                cols={[
                  { key: 'nome', label: 'Cor' },
                  { key: 'codigo', label: 'Código', w: '30%' },
                  { key: 'hex', label: 'Amostra (hex)', w: '26%' },
                ]}
              />
              {f.cores.length > 0 && (
                <div className="swatches">
                  {f.cores.map((c, i) => (
                    <span key={i} title={c.nome} style={{ background: /^#[0-9a-f]{3,8}$/i.test(c.hex) ? c.hex : '#fff' }} />
                  ))}
                </div>
              )}
            </Block>
            <Block title="Observações">
              <textarea value={f.observacoes} rows={3} onChange={(e) => setFicha({ observacoes: e.target.value })} />
            </Block>
            <Block title="Vínculos">
              <div className="links">
                <IconLink size={14} />
                {f.moldes ? (
                  <>
                    <span>
                      Moldes: <b>{f.moldes.name}</b>
                    </span>
                    <button
                      className="ghost no-print"
                      onClick={async () => {
                        const err = await platform.openLinked(f.moldes!.path);
                        if (err) notify(err, 'erro');
                      }}
                    >
                      <IconExternalLink size={13} /> Abrir no Andromeda Moldes
                    </button>
                    <button className="ghost no-print" onClick={() => setFicha({ moldes: null })}>
                      Remover
                    </button>
                  </>
                ) : (
                  <>
                    <span className="muted">Nenhum arquivo de moldes vinculado.</span>
                    <button className="ghost no-print" onClick={() => void linkMoldes()}>
                      Vincular arquivo .ctx
                    </button>
                  </>
                )}
              </div>
            </Block>
          </div>
        </div>
        <footer className="ffoot">
          <span>{f.ref ? `Ref. ${f.ref}` : 'Sem referência'} · {f.nome}</span>
          <span>{editor.get().file.name}</span>
        </footer>
      </div>
    </div>
  );
}
