/** Painel direito: propriedades da seleção, documento e camadas. */
import { IconCopy, IconEye, IconEyeOff, IconFlipHorizontal, IconFlipVertical, IconLock, IconLockOpen, IconPlus, IconRotateClockwise, IconTrash } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { flattenPath } from '@cad-textil/core';
import { BRUSH_LABEL } from '../model/brush';
import { dimValueCm, fmtCm } from '../model/draw-tools';
import { bboxOfShapes, offsetPolyline, polyPath, scaleAbout, rotateAbout } from '../model/geom';
import { PATTERN_LABEL } from '../model/patterns';
import { STITCH_LABEL } from '../model/stitch';
import { TRIM_LABEL } from '../model/trims';
import type { Brush, BrushKind, Fill, PatternKind, Shape, StitchType, Style, TrimKind } from '../model/types';
import {
  arrangeSelected,
  commit,
  deleteSelected,
  duplicateSelected,
  editor,
  expandMirrorSelected,
  groupSelected,
  mapLayers,
  addShapes,
  newId,
  selectedShapes,
  setStitchType,
  transformSelected,
  ungroupSelected,
  updateShapes,
  useEditor,
} from '../state';
import { realSize } from './Canvas';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="psec">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="prow">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Num({ value, onChange, step = 0.05, min, max, suffix = 'mm' }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  return (
    <span className="num">
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={Math.round(value * 1000) / 1000}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max)) onChange(v);
        }}
      />
      {suffix}
    </span>
  );
}

/** Primeira forma de caminho (para mostrar o estilo atual de um grupo). */
function firstPath(s: Shape): Extract<Shape, { kind: 'path' }> | null {
  if (s.kind === 'path') return s;
  if (s.kind === 'group') for (const c of s.children) {
    const r = firstPath(c);
    if (r) return r;
  }
  return null;
}

/** Aplica um ajuste de estilo em todos os caminhos (inclusive dentro de grupos). */
function styleAll(ids: string[], fn: (st: Style) => Style) {
  const map = (s: Shape): Shape => (s.kind === 'path' ? { ...s, style: fn(s.style) } : s.kind === 'group' ? { ...s, children: s.children.map(map) } : s);
  updateShapes(ids, map);
}

function FillEditor({ fill, onChange }: { fill: Fill | null; onChange: (f: Fill | null) => void }) {
  const kind = !fill ? 'none' : fill.kind;
  return (
    <>
      <Row label="Preenchimento">
        <select
          value={kind}
          onChange={(e) => {
            const k = e.target.value;
            onChange(k === 'none' ? null : k === 'solid' ? { kind: 'solid', color: '#ffffff' } : (editor.get().fill.kind === 'pattern' ? editor.get().fill : { kind: 'pattern', pattern: 'sarja', c1: '#3d5a80', c2: '#24344d', scale: 0.6, angle: 0 }));
          }}
        >
          <option value="none">Nenhum</option>
          <option value="solid">Cor</option>
          <option value="pattern">Tecido</option>
        </select>
      </Row>
      {fill?.kind === 'solid' && (
        <Row label="Cor">
          <input type="color" value={fill.color} onChange={(e) => onChange({ kind: 'solid', color: e.target.value })} />
        </Row>
      )}
      {fill?.kind === 'pattern' && (
        <>
          <Row label="Tecido">
            <select value={fill.pattern} onChange={(e) => onChange({ ...fill, pattern: e.target.value as PatternKind })}>
              {(Object.keys(PATTERN_LABEL) as PatternKind[]).map((k) => (
                <option key={k} value={k}>
                  {PATTERN_LABEL[k]}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Cores">
            <span className="colors">
              <input type="color" value={fill.c1} onChange={(e) => onChange({ ...fill, c1: e.target.value })} />
              <input type="color" value={fill.c2} onChange={(e) => onChange({ ...fill, c2: e.target.value })} />
            </span>
          </Row>
          <Row label="Escala">
            <Num value={fill.scale} step={0.1} min={0.1} max={10} suffix="×" onChange={(v) => onChange({ ...fill, scale: v })} />
          </Row>
          <Row label="Ângulo">
            <Num value={fill.angle} step={5} suffix="°" onChange={(v) => onChange({ ...fill, angle: v })} />
          </Row>
        </>
      )}
    </>
  );
}

function SelectionProps({ sel }: { sel: Shape[] }) {
  const s = useEditor();
  const ids = sel.map((x) => x.id);
  const one = sel.length === 1 ? sel[0]! : null;
  const box = bboxOfShapes(sel);
  const real = box ? realSize(box, s.doc.scale) : null;
  const center = box ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : { x: 0, y: 0 };
  const fp = sel.map(firstPath).find(Boolean) ?? null;
  const hasMirror = sel.some((x) => x.mirror !== undefined || (x.kind === 'group' && x.children.some((c) => c.mirror !== undefined)));
  return (
    <>
      <Section title={one ? (one.name ?? KIND_LABEL[one.kind]) : `${sel.length} itens`}>
        {box && real && (
          <>
            <Row label="Largura">
              <Num
                value={box.maxX - box.minX}
                min={0.1}
                onChange={(v) => {
                  const k = v / (box.maxX - box.minX || 1);
                  transformSelected(scaleAbout({ x: box.minX, y: box.minY }, k, k));
                }}
              />
            </Row>
            <p className="muted small">
              Na peça real: {real.w.toFixed(1).replace('.', ',')} × {real.h.toFixed(1).replace('.', ',')} cm (escala 1:{s.doc.scale})
            </p>
          </>
        )}
        <div className="btnrow">
          <button className="ghost icon" title="Espelhar na horizontal" onClick={() => transformSelected(scaleAbout(center, -1, 1))}>
            <IconFlipVertical size={16} />
          </button>
          <button className="ghost icon" title="Espelhar na vertical" onClick={() => transformSelected(scaleAbout(center, 1, -1))}>
            <IconFlipHorizontal size={16} />
          </button>
          <button className="ghost icon" title="Girar 15°" onClick={() => transformSelected(rotateAbout(center, 15))}>
            <IconRotateClockwise size={16} />
          </button>
          <button className="ghost icon" title="Duplicar (⌘D)" onClick={() => duplicateSelected()}>
            <IconCopy size={16} />
          </button>
          <button className="ghost icon danger" title="Excluir (Delete)" onClick={deleteSelected}>
            <IconTrash size={16} />
          </button>
        </div>
        <div className="btnrow">
          <button className="ghost" onClick={() => arrangeSelected(1)}>Para frente</button>
          <button className="ghost" onClick={() => arrangeSelected(-1)}>Para trás</button>
        </div>
        <div className="btnrow">
          {sel.length > 1 && <button className="ghost" onClick={groupSelected}>Agrupar (⌘G)</button>}
          {sel.some((x) => x.kind === 'group') && <button className="ghost" onClick={ungroupSelected}>Desagrupar</button>}
          {hasMirror && (
            <button className="ghost" title="O lado espelhado vira desenho próprio, para mudar só um lado" onClick={expandMirrorSelected}>
              Expandir simetria
            </button>
          )}
        </div>
      </Section>

      {one?.kind === 'text' && (
        <Section title="Texto">
          <textarea value={one.text} rows={2} onChange={(e) => updateShapes(ids, (x) => (x.kind === 'text' ? { ...x, text: e.target.value } : x))} />
          <Row label="Tamanho">
            <Num value={one.size} step={0.5} min={0.5} onChange={(v) => updateShapes(ids, (x) => (x.kind === 'text' ? { ...x, size: v } : x))} />
          </Row>
          <Row label="Cor">
            <input type="color" value={one.color} onChange={(e) => updateShapes(ids, (x) => (x.kind === 'text' ? { ...x, color: e.target.value } : x))} />
          </Row>
        </Section>
      )}

      {one?.kind === 'image' && (
        <Section title="Imagem">
          <Row label="Opacidade">
            <input type="range" min={0.05} max={1} step={0.05} value={one.opacity} onChange={(e) => updateShapes(ids, (x) => (x.kind === 'image' ? { ...x, opacity: Number(e.target.value) } : x))} />
          </Row>
          <p className="muted small">Para redesenhar por cima: opacidade baixa, mova para a camada Croqui e trave a camada.</p>
          <div className="btnrow">
            <button
              className="ghost"
              onClick={() => {
                const st = editor.get();
                const target = st.doc.layers.find((l) => l.id === 'croqui');
                if (!target) return;
                commit((d) => ({
                  ...d,
                  layers: d.layers.map((l) => (l.id === target.id ? { ...l, shapes: [one, ...l.shapes] } : { ...l, shapes: l.shapes.filter((x) => x.id !== one.id) })),
                }));
              }}
            >
              Mover para Croqui
            </button>
          </div>
        </Section>
      )}

      {one?.kind === 'stitch' && (
        <Section title="Pesponto">
          <Row label="Tipo">
            <select value={one.stitch.type} onChange={(e) => updateShapes(ids, (x) => (x.kind === 'stitch' ? { ...x, stitch: { ...x.stitch, type: e.target.value as StitchType } } : x))}>
              {(Object.keys(STITCH_LABEL) as StitchType[]).map((k) => (
                <option key={k} value={k}>
                  {STITCH_LABEL[k]}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Entre agulhas">
            <Num value={one.stitch.gap * s.doc.scale} step={0.5} min={0} onChange={(v) => updateShapes(ids, (x) => (x.kind === 'stitch' ? { ...x, stitch: { ...x.stitch, gap: v / s.doc.scale } } : x))} />
          </Row>
          <Row label="Ponto">
            <Num value={one.stitch.len * s.doc.scale} step={0.5} min={0.5} onChange={(v) => updateShapes(ids, (x) => (x.kind === 'stitch' ? { ...x, stitch: { ...x.stitch, len: v / s.doc.scale } } : x))} />
          </Row>
          <p className="muted small">Medidas na peça real.</p>
          <Row label="Linha">
            <input type="color" value={one.stitch.color} onChange={(e) => updateShapes(ids, (x) => (x.kind === 'stitch' ? { ...x, stitch: { ...x.stitch, color: e.target.value } } : x))} />
          </Row>
        </Section>
      )}

      {one?.kind === 'trim' && (
        <Section title="Aviamento">
          <Row label="Tipo">
            <select value={one.trim} onChange={(e) => updateShapes(ids, (x) => (x.kind === 'trim' ? { ...x, trim: e.target.value as TrimKind } : x))}>
              {(Object.keys(TRIM_LABEL) as TrimKind[]).map((k) => (
                <option key={k} value={k}>
                  {TRIM_LABEL[k]}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Tamanho">
            <Num value={one.size} min={0.1} onChange={(v) => updateShapes(ids, (x) => (x.kind === 'trim' ? { ...x, size: v } : x))} />
          </Row>
          <Row label="Cor">
            <input type="color" value={one.color} onChange={(e) => updateShapes(ids, (x) => (x.kind === 'trim' ? { ...x, color: e.target.value } : x))} />
          </Row>
        </Section>
      )}

      {fp && (
        <Section title="Traço e preenchimento">
          <Row label="Traço">
            <input type="color" value={fp.style.stroke ?? '#000000'} onChange={(e) => styleAll(ids, (st) => ({ ...st, stroke: e.target.value }))} />
          </Row>
          <Row label="Espessura">
            <Num value={fp.style.width} min={0} step={0.05} onChange={(v) => styleAll(ids, (st) => ({ ...st, width: v }))} />
          </Row>
          <Row label="Linha">
            <select value={dashKey(fp.style.dash)} onChange={(e) => styleAll(ids, (st) => ({ ...st, dash: DASHES[e.target.value as keyof typeof DASHES]?.v }))}>
              {Object.entries(DASHES).map(([k, d]) => (
                <option key={k} value={k}>
                  {d.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Pontas">
            <select value={fp.style.cap ?? 'round'} onChange={(e) => styleAll(ids, (st) => ({ ...st, cap: e.target.value as Style['cap'] }))}>
              <option value="round">Redondas</option>
              <option value="butt">Retas</option>
              <option value="square">Quadradas</option>
            </select>
          </Row>
          <BrushEditor brush={fp.style.brush} onChange={(brush) => styleAll(ids, (st) => ({ ...st, brush }))} />
          {one && <FillEditor fill={fp.style.fill} onChange={(fill) => styleAll(ids, (st) => ({ ...st, fill }))} />}
        </Section>
      )}

      {one?.kind === 'path' && <ParallelTool shape={one} />}

      {one?.kind === 'dim' && (
        <Section title="Cota">
          <p className="muted small">
            Medida real: <b>{fmtCm(dimValueCm(one, s.doc.scale))}</b> (escala 1:{s.doc.scale})
          </p>
          <Row label="Texto">
            <input
              value={one.text ?? ''}
              placeholder={fmtCm(dimValueCm(one, s.doc.scale))}
              onChange={(e) => updateShapes(ids, (x) => (x.kind === 'dim' ? { ...x, text: e.target.value || undefined } : x))}
            />
          </Row>
          <Row label="Afastamento">
            <Num value={one.off} step={0.5} onChange={(v) => updateShapes(ids, (x) => (x.kind === 'dim' ? { ...x, off: v } : x))} />
          </Row>
          <Row label="Tamanho do texto">
            <Num value={one.size} step={0.2} min={0.5} onChange={(v) => updateShapes(ids, (x) => (x.kind === 'dim' ? { ...x, size: v } : x))} />
          </Row>
          <Row label="Cor">
            <input type="color" value={one.color} onChange={(e) => updateShapes(ids, (x) => (x.kind === 'dim' ? { ...x, color: e.target.value } : x))} />
          </Row>
        </Section>
      )}
    </>
  );
}

const DASHES = {
  continua: { label: 'Contínua', v: undefined as number[] | undefined },
  tracejada: { label: 'Tracejada (dobra, forro)', v: [1, 0.6] },
  longa: { label: 'Tracejado longo', v: [2.4, 0.8] },
  pontilhada: { label: 'Pontilhada', v: [0.05, 0.5] },
  tracoPonto: { label: 'Traço e ponto (centro, eixo)', v: [2, 0.5, 0.05, 0.5] },
};
const dashKey = (d?: number[]) => (Object.entries(DASHES).find(([, x]) => JSON.stringify(x.v ?? null) === JSON.stringify(d?.length ? d : null))?.[0] ?? 'tracejada') as keyof typeof DASHES;

function BrushEditor({ brush, onChange }: { brush: Brush | undefined; onChange: (b: Brush | undefined) => void }) {
  return (
    <>
      <Row label="Pincel">
        <select
          value={brush?.kind ?? 'nenhum'}
          onChange={(e) => {
            const k = e.target.value;
            onChange(k === 'nenhum' ? undefined : { size: brush?.size ?? 1.2, angle: brush?.angle ?? 35, kind: k as BrushKind });
          }}
        >
          <option value="nenhum">Nenhum (traço comum)</option>
          {(Object.keys(BRUSH_LABEL) as BrushKind[]).map((k) => (
            <option key={k} value={k}>
              {BRUSH_LABEL[k]}
            </option>
          ))}
        </select>
      </Row>
      {brush && (
        <Row label="Espessura do pincel">
          <Num value={brush.size} step={0.1} min={0.05} onChange={(size) => onChange({ ...brush, size })} />
        </Row>
      )}
      {brush?.kind === 'caligrafico' && (
        <Row label="Ângulo da ponta">
          <Num value={brush.angle ?? 35} step={5} suffix="°" onChange={(angle) => onChange({ ...brush, angle })} />
        </Row>
      )}
    </>
  );
}

/** Cria uma cópia paralela do traço (barra, recorte, viés, vista). */
function ParallelTool({ shape }: { shape: Extract<Shape, { kind: 'path' }> }) {
  const s = useEditor();
  const k = s.doc.scale;
  const make = (side: 1 | -1) => {
    const real = Number((document.getElementById('par-dist') as HTMLInputElement | null)?.value ?? '10');
    const d = (Number.isFinite(real) ? real : 10) / k;
    let pts = flattenPath(shape.path, 0.05);
    // contorno fechado: o último ponto repete o primeiro
    if (shape.path.closed && pts.length > 2) pts = pts.slice(0, -1);
    const path = polyPath(offsetPolyline(pts, d * side, shape.path.closed), shape.path.closed);
    addShapes([{ ...shape, id: newId(), path, subpaths: undefined, style: { ...shape.style, fill: null } }]);
  };
  return (
    <Section title="Linha paralela">
      <Row label="Distância na peça">
        <span className="num">
          <input id="par-dist" type="number" defaultValue={10} step={1} min={0.5} />
          mm
        </span>
      </Row>
      <div className="btnrow">
        <button className="ghost" onClick={() => make(1)}>De um lado</button>
        <button className="ghost" onClick={() => make(-1)}>Do outro</button>
      </div>
    </Section>
  );
}

function DrawToolProps() {
  const s = useEditor();
  if (s.tool === 'brush' || s.tool === 'pencil')
    return (
      <Section title={s.tool === 'brush' ? 'Pincel (ferramenta)' : 'Lápis (ferramenta)'}>
        {s.tool === 'brush' && <BrushEditor brush={s.brush} onChange={(b) => b && editor.set({ brush: b })} />}
        <Row label="Suavização">
          <input type="range" min={0.5} max={8} step={0.5} value={s.smooth} onChange={(e) => editor.set({ smooth: Number(e.target.value) })} />
        </Row>
        <Row label="Cor">
          <input type="color" value={s.style.stroke ?? '#000000'} onChange={(e) => editor.set({ style: { ...s.style, stroke: e.target.value } })} />
        </Row>
        {s.tool === 'pencil' && (
          <Row label="Espessura">
            <Num value={s.style.width} min={0.05} step={0.05} onChange={(v) => editor.set({ style: { ...s.style, width: v } })} />
          </Row>
        )}
      </Section>
    );
  if (s.tool === 'polygon')
    return (
      <Section title="Polígono e estrela">
        <Row label="Lados / pontas">
          <Num value={s.poly.sides} step={1} min={3} max={40} suffix="" onChange={(v) => editor.set({ poly: { ...s.poly, sides: Math.round(v) } })} />
        </Row>
        <Row label="Estrela">
          <input type="checkbox" checked={s.poly.star} onChange={(e) => editor.set({ poly: { ...s.poly, star: e.target.checked } })} />
        </Row>
        {s.poly.star && (
          <Row label="Raio interno">
            <input type="range" min={0.15} max={0.9} step={0.05} value={s.poly.inner} onChange={(e) => editor.set({ poly: { ...s.poly, inner: Number(e.target.value) } })} />
          </Row>
        )}
      </Section>
    );
  return null;
}

const KIND_LABEL: Record<Shape['kind'], string> = { path: 'Traço', stitch: 'Pesponto', trim: 'Aviamento', text: 'Texto', group: 'Grupo', image: 'Imagem', dim: 'Cota' };

function DocProps() {
  const s = useEditor();
  const d = s.doc;
  const sizes: [string, number, number][] = [
    ['A4 deitada', 297, 210],
    ['A4 em pé', 210, 297],
    ['A3 deitada', 420, 297],
    ['A3 em pé', 297, 420],
  ];
  const cur = sizes.find((x) => x[1] === d.artboard.w && x[2] === d.artboard.h)?.[0] ?? 'outro';
  return (
    <>
      <Section title="Documento">
        <Row label="Prancha">
          <select
            value={cur}
            onChange={(e) => {
              const z = sizes.find((x) => x[0] === e.target.value);
              if (z) commit((doc) => ({ ...doc, artboard: { w: z[1], h: z[2] } }));
            }}
          >
            {sizes.map((x) => (
              <option key={x[0]}>{x[0]}</option>
            ))}
            {cur === 'outro' && <option>outro</option>}
          </select>
        </Row>
        <Row label="Escala 1:">
          <select value={d.scale} onChange={(e) => commit((doc) => ({ ...doc, scale: Number(e.target.value) }))}>
            {[1, 2, 5, 8, 10, 15, 20].map((k) => (
              <option key={k} value={k}>
                1:{k}
              </option>
            ))}
          </select>
        </Row>
        <p className="muted small">Em 1:5, 5 cm da peça = 1 cm no desenho. As peças base entram na escala do documento.</p>
      </Section>
      <Section title="Simetria">
        <Row label="Ligada">
          <input type="checkbox" checked={s.symmetry} onChange={(e) => editor.set({ symmetry: e.target.checked })} />
        </Row>
        <Row label="Eixo (x)">
          <Num value={s.axis} step={1} onChange={(v) => editor.set({ axis: v })} />
        </Row>
        <div className="btnrow">
          <button className="ghost" onClick={() => editor.set({ axis: d.artboard.w / 2 })}>Centro da prancha</button>
        </div>
      </Section>
      <Section title="Estilo de desenho">
        <Row label="Traço">
          <input type="color" value={s.style.stroke ?? '#000000'} onChange={(e) => editor.set({ style: { ...s.style, stroke: e.target.value } })} />
        </Row>
        <Row label="Espessura">
          <Num value={s.style.width} min={0} onChange={(v) => editor.set({ style: { ...s.style, width: v } })} />
        </Row>
        <FillEditor fill={s.style.fill} onChange={(fill) => editor.set({ style: { ...s.style, fill } })} />
      </Section>
    </>
  );
}

function StitchToolProps() {
  const s = useEditor();
  const st = s.stitch;
  const set = (p: Partial<typeof st>) => editor.set({ stitch: { ...st, ...p } });
  return (
    <Section title="Pesponto (ferramenta)">
      <Row label="Tipo">
        <select
          value={st.type}
          onChange={(e) => {
            const t = e.target.value as StitchType;
            setStitchType(t);
          }}
        >
          {(Object.keys(STITCH_LABEL) as StitchType[]).map((k) => (
            <option key={k} value={k}>
              {STITCH_LABEL[k]}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Da borda">
        <Num value={st.dist} step={0.5} min={0} onChange={(v) => set({ dist: v })} />
      </Row>
      <Row label="Entre agulhas">
        <Num value={st.gap} step={0.5} min={0} onChange={(v) => set({ gap: v })} />
      </Row>
      <Row label="Ponto">
        <Num value={st.len} step={0.5} min={0.5} onChange={(v) => set({ len: v })} />
      </Row>
      <Row label="Lado">
        <select value={st.side} onChange={(e) => set({ side: Number(e.target.value) as 1 | -1 })}>
          <option value={1}>Para dentro da peça</option>
          <option value={-1}>Para fora</option>
        </select>
      </Row>
      <Row label="Linha">
        <input type="color" value={st.color} onChange={(e) => set({ color: e.target.value })} />
      </Row>
      <p className="muted small">Medidas na peça real; o desenho em 1:{s.doc.scale} acompanha.</p>
    </Section>
  );
}

function Layers() {
  const s = useEditor();
  const upd = (id: string, patch: Partial<{ visible: boolean; locked: boolean; name: string }>) => commit((d) => mapLayers(d, (l) => (l.id === id ? { ...l, ...patch } : l)));
  return (
    <Section title="Camadas">
      <div className="layers">
        {[...s.doc.layers].reverse().map((l) => (
          <div key={l.id} className={`layer-row ${s.activeLayer === l.id ? 'on' : ''}`} onClick={() => editor.set({ activeLayer: l.id })}>
            <button className="ghost icon" title={l.visible ? 'Ocultar' : 'Mostrar'} onClick={(e) => (e.stopPropagation(), upd(l.id, { visible: !l.visible }))}>
              {l.visible ? <IconEye size={15} /> : <IconEyeOff size={15} />}
            </button>
            <button className="ghost icon" title={l.locked ? 'Destravar' : 'Travar'} onClick={(e) => (e.stopPropagation(), upd(l.id, { locked: !l.locked }))}>
              {l.locked ? <IconLock size={15} /> : <IconLockOpen size={15} />}
            </button>
            <span className="lname">{l.name}</span>
            <span className="muted">{l.shapes.length}</span>
          </div>
        ))}
      </div>
      <button
        className="ghost"
        onClick={() => {
          const id = newId();
          commit((d) => ({ ...d, layers: [...d.layers, { id, name: `Camada ${d.layers.length + 1}`, visible: true, locked: false, shapes: [] }] }));
          editor.set({ activeLayer: id });
        }}
      >
        <IconPlus size={14} /> Nova camada
      </button>
    </Section>
  );
}

export function Props() {
  const s = useEditor();
  const sel = selectedShapes(s);
  return (
    <aside className="dock" data-help="props">
      {s.tool === 'stitch' && <StitchToolProps />}
      <DrawToolProps />
      {sel.length ? <SelectionProps sel={sel} /> : <DocProps />}
      <Layers />
    </aside>
  );
}
