/** Biblioteca: peças base paramétricas, detalhes, pespontos, aviamentos, tecidos e croquis. */
import { IconCircleDot, IconNeedleThread, IconPuzzle, IconShirt, IconTexture, IconWoman } from '@tabler/icons-react';
import { type ReactNode, useMemo, useState } from 'react';
import { type BaseDef, BASES, type Vista } from '../lib/bases';
import { CROQUIS } from '../lib/croquis';
import { DETALHES } from '../lib/detalhes';
import { group } from '../lib/kit';
import { bboxOfShapes, scaleAbout, transformShape } from '../model/geom';
import { PATTERN_LABEL, patternDef, patternId } from '../model/patterns';
import { STITCH_DEFAULT, STITCH_LABEL, stitchStrokes } from '../model/stitch';
import { defsSvg, shapeSvg } from '../model/svg';
import { TRIM_LABEL, trimParts } from '../model/trims';
import type { Fill, PatternKind, Shape, StitchType, TrimKind } from '../model/types';
import { line } from '../lib/kit';
import { addShapes, commit, editor, mapLayers, notify, selectedShapes, setStitchType, setTool, updateShapes, useEditor } from '../state';
import { canvasApi } from './Canvas';

type Cat = 'bases' | 'detalhes' | 'pespontos' | 'aviamentos' | 'tecidos' | 'croquis';

const CATS: { id: Cat; label: string; icon: typeof IconShirt }[] = [
  { id: 'bases', label: 'Peças base', icon: IconShirt },
  { id: 'detalhes', label: 'Detalhes', icon: IconPuzzle },
  { id: 'pespontos', label: 'Pespontos', icon: IconNeedleThread },
  { id: 'aviamentos', label: 'Aviamentos', icon: IconCircleDot },
  { id: 'tecidos', label: 'Tecidos', icon: IconTexture },
  { id: 'croquis', label: 'Croquis', icon: IconWoman },
];

/** Miniatura vetorial de um conjunto de formas. */
function Thumb({ shapes, size = 64 }: { shapes: Shape[]; size?: number }) {
  const html = useMemo(() => {
    const b = bboxOfShapes(shapes);
    if (!b) return '';
    const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.06;
    return `<svg viewBox="${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}" width="${size}" height="${size}"><defs>${defsSvg(shapes)}</defs>${shapes.map((s) => shapeSvg(s)).join('')}</svg>`;
  }, [shapes, size]);
  return <span className="thumb" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Coloca formas (desenhadas em cm da peça, eixo em x = 0) no desenho, na escala do documento. */
function place(name: string, shapes: Shape[], at: { x: number; y: number }, layerId?: string) {
  const k = 10 / editor.get().doc.scale;
  const scaled = k === 1 ? shapes : shapes.map((s) => transformShape(s, scaleAbout({ x: 0, y: 0 }, k, k)));
  const g = group(name, scaled, at);
  if (layerId) {
    commit((d) => mapLayers(d, (l) => (l.id === layerId ? { ...l, shapes: [...l.shapes, g] } : l)));
    editor.set({ selection: [g.id] });
  } else addShapes([g]);
  setTool('select');
  return g;
}

function insertBase(def: BaseDef, opts: Record<string, string | number>, vista: Vista | 'ambas') {
  const s = editor.get();
  const { w, h } = s.doc.artboard;
  const k = 10 / s.doc.scale;
  const views: Vista[] = vista === 'ambas' ? ['frente', 'costas'] : [vista];
  const made = views.map((v) => ({ v, shapes: def.make(opts, v) }));
  const boxes = made.map((m) => bboxOfShapes(m.shapes)!);
  const widths = boxes.map((b) => (b.maxX - b.minX) * k);
  const gap = 18;
  const total = widths.reduce((a, b) => a + b, 0) + gap * (views.length - 1);
  const c = vista === 'ambas' ? { x: w / 2, y: h / 2 } : canvasApi.center();
  let x = c.x - total / 2;
  const ids: string[] = [];
  let firstAxis = c.x;
  made.forEach((m, i) => {
    const b = boxes[i]!;
    const axisX = x - b.minX * k;
    const top = c.y - ((b.maxY + b.minY) / 2) * k;
    const g = place(`${def.label} — ${m.v}`, m.shapes, { x: axisX, y: top });
    ids.push(g.id);
    if (i === 0) firstAxis = axisX;
    x += widths[i]! + gap;
  });
  editor.set({ selection: ids, axis: firstAxis });
  notify(`${def.label} inserida. A simetria segue o centro da peça; use a seleção direta para ajustar o desenho.`);
}

function BaseCard({ def }: { def: BaseDef }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<Record<string, string | number>>(def.defaults);
  const [vista, setVista] = useState<Vista | 'ambas'>('ambas');
  const preview = useMemo(() => def.make(opts, 'frente'), [def, opts]);
  return (
    <div className={`card ${open ? 'open' : ''}`}>
      <button className="card-head" onClick={() => setOpen(!open)}>
        <Thumb shapes={preview} size={54} />
        <span>
          <b>{def.label}</b>
          <small>{def.cat}</small>
        </span>
      </button>
      {open && (
        <div className="card-body">
          {def.options.map((o) => (
            <label key={o.key} className="field">
              <span>{o.label}</span>
              {o.choices ? (
                <select value={String(opts[o.key])} onChange={(e) => setOpts({ ...opts, [o.key]: e.target.value })}>
                  {o.choices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="num">
                  <input
                    type="number"
                    value={Number(opts[o.key])}
                    min={o.min}
                    max={o.max}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v >= (o.min ?? -Infinity) && v <= (o.max ?? Infinity)) setOpts({ ...opts, [o.key]: v });
                    }}
                  />
                  cm
                </span>
              )}
            </label>
          ))}
          <label className="field">
            <span>Vista</span>
            <select value={vista} onChange={(e) => setVista(e.target.value as Vista | 'ambas')}>
              <option value="ambas">Frente e costas</option>
              <option value="frente">Só frente</option>
              <option value="costas">Só costas</option>
            </select>
          </label>
          <button className="primary" onClick={() => insertBase(def, opts, vista)}>
            Inserir no desenho
          </button>
        </div>
      )}
    </div>
  );
}

const DET_THUMBS = new Map<string, Shape[]>();
const detThumb = (id: string, make: () => Shape[]) => {
  if (!DET_THUMBS.has(id)) DET_THUMBS.set(id, make());
  return DET_THUMBS.get(id)!;
};

function Grid({ children }: { children: ReactNode }) {
  return <div className="lib-grid">{children}</div>;
}

function Tile({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`tile ${active ? 'on' : ''}`} onClick={onClick} title={label}>
      {children}
      <span>{label}</span>
    </button>
  );
}

function StitchSample({ type }: { type: StitchType }) {
  const html = useMemo(() => {
    const st = stitchStrokes(line([1, 4], [29, 4]), { type, ...STITCH_DEFAULT[type], width: STITCH_DEFAULT[type].width * 2.2, gap: STITCH_DEFAULT[type].gap * 2.4, len: STITCH_DEFAULT[type].len * 2.2, color: 'currentColor' });
    return `<svg viewBox="0 0 30 8" width="90" height="24">${st.map((s) => `<path d="${s.d}" fill="none" stroke="currentColor" stroke-width="${s.width}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`).join('')}</svg>`;
  }, [type]);
  return <span className="stitch-sample" dangerouslySetInnerHTML={{ __html: html }} />;
}

function TrimSample({ kind }: { kind: TrimKind }) {
  const html = useMemo(
    () =>
      `<svg viewBox="-0.7 -0.7 1.4 1.4" width="34" height="34">${trimParts(kind)
        .map((p, i) => (p.fill ? `<path d="${p.d}" fill="currentColor"/>` : `<path d="${p.d}" fill="${i === 0 ? 'var(--panel)' : 'none'}" stroke="currentColor" stroke-width="${p.w}"/>`))
        .join('')}</svg>`,
    [kind],
  );
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function FabricSample({ fill }: { fill: Extract<Fill, { kind: 'pattern' }> }) {
  const html = useMemo(() => `<svg viewBox="0 0 16 16" width="46" height="46"><defs>${patternDef(fill)}</defs><rect width="16" height="16" rx="2" fill="url(#${patternId(fill)})"/></svg>`, [fill]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Library() {
  const s = useEditor();
  const [cat, setCat] = useState<Cat>('bases');
  return (
    <aside className="library" data-help="library">
      <div className="lib-cats">
        {CATS.map((c) => (
          <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)} title={c.label}>
            <c.icon size={17} />
            <span>{c.label}</span>
          </button>
        ))}
      </div>
      <div className="lib-body">
        {cat === 'bases' && (
          <>
            <p className="hint">Peças paramétricas: escolha as opções e insira. O desenho sai simétrico e editável.</p>
            {BASES.map((b) => (
              <BaseCard key={b.id} def={b} />
            ))}
          </>
        )}
        {cat === 'detalhes' && (
          <>
            <p className="hint">Clique para inserir no centro da vista. Golas entram no eixo de simetria.</p>
            {(['Bolsos', 'Golas', 'Punhos e barras', 'Fechamentos'] as const).map((group) => (
              <div key={group}>
                <h4>{group}</h4>
                <Grid>
                  {DETALHES.filter((d) => d.cat === group).map((d) => (
                    <Tile
                      key={d.id}
                      label={d.label}
                      onClick={() => {
                        const shapes = d.make();
                        const symmetric = shapes.some((x) => x.mirror !== undefined);
                        const c = canvasApi.center();
                        place(d.label, shapes, symmetric ? { x: editor.get().axis, y: c.y } : c);
                      }}
                    >
                      <Thumb shapes={detThumb(d.id, d.make)} size={48} />
                    </Tile>
                  ))}
                </Grid>
              </div>
            ))}
          </>
        )}
        {cat === 'pespontos' && (
          <>
            <p className="hint">Escolha o tipo e clique em dois pontos de um traço (Alt+clique = traço inteiro).</p>
            <div className="stitch-list">
              {(Object.keys(STITCH_LABEL) as StitchType[]).map((t) => (
                <button
                  key={t}
                  className={s.stitch.type === t && s.tool === 'stitch' ? 'on' : ''}
                  onClick={() => {
                    setStitchType(t);
                    setTool('stitch');
                  }}
                >
                  <StitchSample type={t} />
                  <span>{STITCH_LABEL[t]}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {cat === 'aviamentos' && (
          <>
            <p className="hint">Escolha e clique no desenho. Com simetria, o par aparece do outro lado.</p>
            <Grid>
              {(Object.keys(TRIM_LABEL) as TrimKind[]).map((k) => (
                <Tile
                  key={k}
                  label={TRIM_LABEL[k]}
                  active={s.trim.kind === k && s.tool === 'trim'}
                  onClick={() => {
                    editor.set((st) => ({ trim: { ...st.trim, kind: k } }));
                    setTool('trim');
                  }}
                >
                  <TrimSample kind={k} />
                </Tile>
              ))}
            </Grid>
          </>
        )}
        {cat === 'tecidos' && <Fabrics />}
        {cat === 'croquis' && (
          <>
            <p className="hint">Figuras em proporção de 9 cabeças, na camada Croqui. Trave a camada e desenhe a roupa por cima.</p>
            <Grid>
              {CROQUIS.map((c) => (
                <Tile
                  key={c.id}
                  label={c.label}
                  onClick={() => {
                    const st = editor.get();
                    const layer = st.doc.layers.find((l) => l.id === 'croqui') ?? st.doc.layers[0]!;
                    const shapes = c.make().map((x) => transformShape(x, scaleAbout({ x: 0, y: 0 }, st.doc.scale / 10, st.doc.scale / 10)));
                    place(c.label, shapes, { x: st.axis, y: 25 }, layer.id);
                  }}
                >
                  <Thumb shapes={detThumb(`cq-${c.id}`, c.make)} size={56} />
                </Tile>
              ))}
            </Grid>
          </>
        )}
      </div>
    </aside>
  );
}

function Fabrics() {
  const s = useEditor();
  const f = s.fill.kind === 'pattern' ? s.fill : { kind: 'pattern' as const, pattern: 'sarja' as PatternKind, c1: '#3d5a80', c2: '#24344d', scale: 0.6, angle: 0 };
  const set = (patch: Partial<typeof f>) => editor.set({ fill: { ...f, ...patch } });
  const apply = () => {
    const ids = selectedShapes().map((x) => x.id);
    if (!ids.length) {
      notify('Selecione uma forma, ou use o balde (K) para clicar nas partes', 'erro');
      return;
    }
    const paint = (x: Shape): Shape =>
      x.kind === 'path' && (x.style.fill || x.path.closed) ? { ...x, style: { ...x.style, fill: s.fill } } : x.kind === 'group' ? { ...x, children: x.children.map(paint) } : x;
    updateShapes(ids, paint);
  };
  return (
    <>
      <p className="hint">Escolha o tecido e clique nas partes com o balde (K), ou aplique na seleção.</p>
      <Grid>
        {(Object.keys(PATTERN_LABEL) as PatternKind[]).map((k) => (
          <Tile
            key={k}
            label={PATTERN_LABEL[k]}
            active={f.pattern === k}
            onClick={() => {
              set({ pattern: k });
              setTool('fill');
            }}
          >
            <FabricSample fill={{ ...f, pattern: k, scale: 1.4 }} />
          </Tile>
        ))}
      </Grid>
      <div className="fabric-opts">
        <label className="field">
          <span>Fundo</span>
          <input type="color" value={f.c1} onChange={(e) => set({ c1: e.target.value })} />
        </label>
        <label className="field">
          <span>Desenho</span>
          <input type="color" value={f.c2} onChange={(e) => set({ c2: e.target.value })} />
        </label>
        <label className="field">
          <span>Escala</span>
          <input type="range" min={0.2} max={3} step={0.1} value={f.scale} onChange={(e) => set({ scale: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Ângulo</span>
          <input type="range" min={0} max={180} step={5} value={f.angle} onChange={(e) => set({ angle: Number(e.target.value) })} />
        </label>
        <button className="primary" onClick={apply}>
          Aplicar na seleção
        </button>
      </div>
    </>
  );
}
