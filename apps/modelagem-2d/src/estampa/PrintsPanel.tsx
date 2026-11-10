/**
 * Painel "Estampas" do molde selecionado: tipo, arte por tamanho, posição, largura, giro e sangria.
 */
import { IconPhotoPlus, IconTrash, IconFocusCentered } from '@tabler/icons-react';
import { type Artwork, type FitMode, type Piece, type PiecePrint, type PrintMode, type RepeatLayout, bboxOfPoints, cutLine, effectiveDpi, heightFor, widthFor } from '@cad-textil/core';
import { editor, fmtLen, fmtMm, notify, useEditor } from '../editor/store';
import { NumberField, Row } from '../editor/Panels';
import { MODE_LABEL, addPrint, centerPrint, importArtwork, purgeUnusedArtworks, removePrint, updatePrint } from './actions';

const IMPORT = '__importar__';

function ArtSelect({ value, arts, onPick, allowEmpty }: { value: string | undefined; arts: Artwork[]; onPick: (id: string | null) => void; allowEmpty: string }) {
  return (
    <select
      value={value ?? ''}
      onChange={async (e) => {
        const v = e.target.value;
        if (v === IMPORT) {
          const art = await importArtwork();
          if (art) onPick(art.id);
          return;
        }
        onPick(v || null);
      }}
    >
      <option value="">{allowEmpty}</option>
      {arts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name} ({a.widthPx}×{a.heightPx})
        </option>
      ))}
      <option value={IMPORT}>Importar imagem…</option>
    </select>
  );
}

function DpiNote({ art, widthMm, heightMm }: { art: Artwork | undefined; widthMm: number; heightMm: number }) {
  if (!art || !(widthMm > 0) || !(heightMm > 0)) return null;
  const dpi = Math.min(effectiveDpi(art, widthMm), art.heightPx / (heightMm / 25.4));
  const low = dpi < 150;
  return (
    <div className={`row info ${low ? 'warn' : ''}`} title="Sublimação: o ideal é 150–300 dpi no tamanho real">
      <span>Resolução no tamanho real</span>
      <b>{Math.round(dpi)} dpi{low ? ' · baixa' : ''}</b>
    </div>
  );
}

const REPEAT_LABEL: Record<RepeatLayout, string> = { grade: 'Grade (alinhada)', 'meio-salto': 'Meio-salto (desce meia altura)', tijolo: 'Tijolo (anda meia largura)', espelhada: 'Espelhada (alterna espelho)' };
const FIT_LABEL: Record<FitMode, string> = { cobrir: 'Cobrir o molde (corta sobras)', conter: 'Caber inteira (pode sobrar fundo)', esticar: 'Esticar (deforma a arte)' };

function PrintCard({ piece, pr, active }: { piece: Piece; pr: PiecePrint; active: boolean }) {
  const s = useEditor();
  const arts = s.doc.artworks ?? [];
  const byId = new Map(arts.map((a) => [a.id, a]));
  const set = (f: (x: PiecePrint) => PiecePrint) => updatePrint(piece.id, pr.id, f);
  const sizes = piece.grading?.sizes ?? [];
  const setArt = (size: string, id: string | null) =>
    set((x) => {
      const art = { ...x.art };
      if (id) art[size] = id;
      else delete art[size];
      return { ...x, art };
    });
  const baseSize = piece.grading ? piece.grading.sizes[piece.grading.base]! : '';
  const mainArt = byId.get(pr.art[baseSize] || pr.art[''] || '');
  const ratio = mainArt ? mainArt.heightPx / mainArt.widthPx : 1;
  const locked = pr.heightMm === undefined && !pr.heightBySize;
  const W = widthFor(pr, baseSize);
  const H = mainArt ? heightFor(pr, baseSize, mainArt) : W;
  const tiled = pr.mode === 'corrida' || pr.mode === 'textura';
  const cutW = (() => {
    const b = bboxOfPoints(cutLine(piece));
    return { w: b.maxX - b.minX, h: b.maxY - b.minY };
  })();
  /** Largura nova: com proporção travada a altura acompanha; destravada, só a largura muda. */
  const setW = (v: number) => set((x) => ({ ...x, widthMm: v, widthBySize: undefined }));
  const setH = (v: number) => set((x) => (locked ? { ...x, widthMm: v / ratio, widthBySize: undefined } : { ...x, heightMm: v, heightBySize: undefined }));
  const toggleLock = (lock: boolean) =>
    set((x) => (lock ? { ...x, heightMm: undefined, heightBySize: undefined } : { ...x, heightMm: Math.round(H * 10) / 10 }));

  return (
    <div className={`print-card ${active ? 'on' : ''}`} onClick={() => editor.set({ activePrint: pr.id })}>
      <div className="row">
        <select value={pr.mode} onChange={(e) => set((x) => ({ ...x, mode: e.target.value as PrintMode }))}>
          {(Object.keys(MODE_LABEL) as PrintMode[]).map((m) => (
            <option key={m} value={m}>{MODE_LABEL[m]}</option>
          ))}
        </select>
        <button className="ghost icon xs" title="Centralizar no molde" onClick={() => centerPrint(piece.id, pr.id)}><IconFocusCentered size={15} /></button>
        <button className="ghost icon xs" title="Remover estampa" onClick={() => removePrint(piece.id, pr.id)}><IconTrash size={15} /></button>
      </div>
      {pr.mode === 'textura' && <p className="muted small">Contínua no tecido inteiro: no risco, o desenho passa de um molde para o outro, como se todos fossem cortados de um tecido já estampado.</p>}
      {pr.mode === 'corrida' && <p className="muted small">Repetição que começa no próprio molde (cada molde tem a sua).</p>}

      <h5>Arte</h5>
      <Row label={sizes.length ? 'Todos os tamanhos' : 'Imagem'}>
        <ArtSelect value={pr.art['']} arts={arts} onPick={(id) => setArt('', id)} allowEmpty="— nenhuma —" />
      </Row>
      {sizes.map((sz) => (
        <Row key={sz} label={`Tamanho ${sz}`}>
          <ArtSelect value={pr.art[sz]} arts={arts} onPick={(id) => setArt(sz, id)} allowEmpty="(usa a de todos)" />
        </Row>
      ))}

      {pr.mode === 'total' ? (
        <>
          <h5>Ajuste</h5>
          <Row label="Arte no molde">
            <select value={pr.fit ?? 'cobrir'} onChange={(e) => set((x) => ({ ...x, fit: e.target.value as FitMode }))}>
              {(Object.keys(FIT_LABEL) as FitMode[]).map((f) => (
                <option key={f} value={f}>{FIT_LABEL[f]}</option>
              ))}
            </select>
          </Row>
        </>
      ) : (
        <>
          <h5>{tiled ? 'Módulo' : 'Tamanho da arte'}</h5>
          <Row label="Largura"><NumberField value={W} min={1} digits={1} onCommit={setW} /></Row>
          <Row label="Altura"><NumberField value={H} min={1} digits={1} onCommit={setH} /></Row>
          <label className="row check">
            <input type="checkbox" checked={locked} onChange={(e) => toggleLock(e.target.checked)} />
            Travar proporção da imagem
          </label>
          <div className="btn-row">
            {mainArt && (
              <button className="ghost" title="Largura em que a imagem fica com 150 dpi" onClick={() => set((x) => ({ ...x, widthMm: Math.round((mainArt.widthPx / 150) * 25.4 * 10) / 10, widthBySize: undefined, heightMm: locked ? undefined : Math.round((mainArt.heightPx / 150) * 25.4 * 10) / 10 }))}>
                Tamanho a 150 dpi
              </button>
            )}
            {!tiled && <button className="ghost" onClick={() => setW(Math.round(cutW.w * 0.9))}>90% da largura do molde</button>}
            {!locked && <button className="ghost" onClick={() => set((x) => ({ ...x, heightMm: Math.round(W * ratio * 10) / 10, heightBySize: undefined }))}>Voltar à proporção</button>}
          </div>
          {pr.mode === 'localizada' && sizes.length > 0 && (
            <details>
              <summary className="muted small">Medidas por tamanho</summary>
              {sizes.map((sz) => (
                <div key={sz} className="size-wh">
                  <span>{sz}</span>
                  <NumberField value={widthFor(pr, sz)} min={1} digits={1} width={58} onCommit={(v) => set((x) => ({ ...x, widthBySize: { ...(x.widthBySize ?? {}), [sz]: v } }))} />
                  <em>×</em>
                  {(() => {
                    const art = byId.get(pr.art[sz] || pr.art[''] || '');
                    const h = art ? heightFor(pr, sz, art) : widthFor(pr, sz);
                    return locked ? <b>{fmtLen(h, 1)}</b> : <NumberField value={h} min={1} digits={1} width={58} onCommit={(v) => set((x) => ({ ...x, heightBySize: { ...(x.heightBySize ?? {}), [sz]: v } }))} />;
                  })()}
                </div>
              ))}
            </details>
          )}
        </>
      )}

      {tiled && (
        <>
          <h5>Repetição</h5>
          <Row label="Tipo">
            <select value={pr.repeat ?? 'grade'} onChange={(e) => set((x) => ({ ...x, repeat: e.target.value as RepeatLayout }))}>
              {(Object.keys(REPEAT_LABEL) as RepeatLayout[]).map((r) => (
                <option key={r} value={r}>{REPEAT_LABEL[r]}</option>
              ))}
            </select>
          </Row>
          <Row label="Espaço na horizontal"><NumberField value={pr.gapXMm ?? 0} min={0} digits={1} onCommit={(v) => set((x) => ({ ...x, gapXMm: v }))} /></Row>
          <Row label="Espaço na vertical"><NumberField value={pr.gapYMm ?? 0} min={0} digits={1} onCommit={(v) => set((x) => ({ ...x, gapYMm: v }))} /></Row>
        </>
      )}

      <h5>Posição</h5>
      {pr.mode === 'textura' ? (
        <>
          <Row label="Deslocamento na largura"><NumberField value={pr.offsetMm?.x ?? 0} digits={1} onCommit={(v) => set((x) => ({ ...x, offsetMm: { x: v, y: x.offsetMm?.y ?? 0 } }))} /></Row>
          <Row label="Deslocamento no comprimento"><NumberField value={pr.offsetMm?.y ?? 0} digits={1} onCommit={(v) => set((x) => ({ ...x, offsetMm: { x: x.offsetMm?.x ?? 0, y: v } }))} /></Row>
        </>
      ) : (
        <>
          <Row label="Centro X"><NumberField value={pr.center.x} digits={1} onCommit={(v) => set((x) => ({ ...x, center: { ...x.center, x: v } }))} /></Row>
          <Row label="Centro Y"><NumberField value={pr.center.y} digits={1} onCommit={(v) => set((x) => ({ ...x, center: { ...x.center, y: v } }))} /></Row>
        </>
      )}
      <Row label="Giro">
        <NumberField value={pr.rotationDeg} digits={1} suffix="°" onCommit={(v) => set((x) => ({ ...x, rotationDeg: ((v % 360) + 360) % 360 }))} />
      </Row>
      <div className="btn-row">
        <button className="ghost" onClick={() => set((x) => ({ ...x, rotationDeg: (x.rotationDeg + 90) % 360 }))}>Girar 90° ↺</button>
        <button className="ghost" onClick={() => set((x) => ({ ...x, rotationDeg: (x.rotationDeg + 270) % 360 }))}>↻</button>
        <button className={`ghost ${pr.mirrored ? 'on' : ''}`} title="Espelhar na horizontal" onClick={() => set((x) => ({ ...x, mirrored: !x.mirrored }))}>Espelhar ↔</button>
        <button className={`ghost ${pr.flipV ? 'on' : ''}`} title="Espelhar na vertical" onClick={() => set((x) => ({ ...x, flipV: !x.flipV }))}>Espelhar ↕</button>
      </div>

      <h5>Acabamento</h5>
      <Row label="Sangria">
        <NumberField value={pr.bleedMm} min={0} digits={1} onCommit={(v) => set((x) => ({ ...x, bleedMm: v }))} />
      </Row>
      {piece.cutInPairs && pr.mode !== 'textura' && (
        <label className="row check" title="Localizada: o padrão é NÃO espelhar (texto e logo continuam legíveis no outro lado). Total/corrida: o padrão é espelhar junto com o molde.">
          <input type="checkbox" checked={pr.mirrorInPair ?? pr.mode !== 'localizada'} onChange={(e) => set((x) => ({ ...x, mirrorInPair: e.target.checked }))} />
          Espelhar a arte no par
        </label>
      )}
      {pr.mode !== 'total' && <DpiNote art={mainArt} widthMm={W} heightMm={H} />}
    </div>
  );
}

export function PrintsPanel() {
  const s = useEditor();
  const piece = s.multi.length > 1 ? undefined : s.doc.pieces.find((p) => p.id === s.selection.pieceId);
  const arts = s.doc.artworks ?? [];
  if (!piece) {
    return (
      <div className="stack">
        <p className="muted small">Selecione um molde para colocar estampa. Use a ferramenta Estampa (A) para posicionar a arte arrastando.</p>
        {arts.length > 0 && (
          <button className="ghost" onClick={() => {
            const n = purgeUnusedArtworks();
            notify(n ? `${n} imagem(ns) sem uso removida(s) do arquivo` : 'Todas as imagens estão em uso');
          }}>
            Limpar imagens não usadas ({arts.length} no arquivo)
          </button>
        )}
      </div>
    );
  }
  const prints = piece.prints ?? [];
  const add = async (mode: PrintMode) => {
    const art = arts.length ? null : await importArtwork();
    addPrint(piece.id, mode, art?.id ?? arts[arts.length - 1]?.id ?? null);
  };
  return (
    <div className="stack">
      {prints.map((pr) => (
        <PrintCard key={pr.id} piece={piece} pr={pr} active={pr.id === s.activePrint} />
      ))}
      <div className="btn-row">
        <button className="ghost" onClick={() => add('localizada')}><IconPhotoPlus size={15} /> Localizada</button>
        <button className="ghost" onClick={() => add('total')}><IconPhotoPlus size={15} /> Total</button>
        <button className="ghost" onClick={() => add('corrida')}><IconPhotoPlus size={15} /> Corrida</button>
        <button className="ghost" onClick={() => add('textura')}><IconPhotoPlus size={15} /> Textura</button>
      </div>
      <p className="muted small">
        Localizada: arte num ponto (logo, número). Total: a arte cobre o molde inteiro — use uma arte por tamanho. Corrida: módulo repetido a partir do molde. Textura: contínua no tecido, passa de um molde para o outro no risco. A sangria passa a arte além da linha de corte.
      </p>
    </div>
  );
}
