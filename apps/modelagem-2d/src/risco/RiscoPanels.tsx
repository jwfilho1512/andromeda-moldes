import type { ReactNode } from 'react';
import { IconArrowsMinimize, IconFileExport, IconPlayerPlay, IconPlayerStop, IconRotateClockwise2, IconSparkles, IconTrash, IconPuzzle } from '@tabler/icons-react';
import { spreadResult } from '@cad-textil/core';
import { NumberField } from '../editor/Panels';
import { fmtMm, useEditor } from '../editor/store';
import {
  clearMarker,
  compact,
  docSizes,
  effectiveOrder,
  exportMarker,
  fillRemaining,
  garmentsPerMarker,
  riscoStats,
  rotateSelected,
  runNest,
  setRisco,
  stopNest,
  unplaceSelected,
  useRisco,
  setSublim,
  exportForPrintShop,
} from './state';
import { riscoView } from './RiscoCanvas';

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="row">
    <span>{label}</span>
    {children}
  </label>
);
const Info = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className={`row info ${strong ? 'strong' : ''}`}>
    <span>{label}</span>
    <b>{value}</b>
  </div>
);
/** Larguras comuns de tecido (mm). */
const FABRIC_WIDTHS = [800, 1000, 1200, 1400, 1500, 1600, 1800];

const m = (mm: number, d = 2) => (mm / 1000).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

/* ------------------------------------------------------------------ */
/* Barra de ações (topo)                                               */
/* ------------------------------------------------------------------ */

export function RiscoControlBar() {
  const st = useRisco();
  useEditor();
  const { stats, overlaps } = riscoStats();
  const hasPrints = useEditor().doc.pieces.some((p) => p.prints?.length && !st.excluded[p.id]);
  return (
    <div className="controlbar" data-help="ctrl">
      <span className="cb-tool"><IconPuzzle size={17} stroke={1.6} /> Risco e Encaixe</span>
      <div className="fabric-box" title="Medidas do tecido: digite e tecle Enter">
        <label>
          Largura
          <NumberField value={st.fabric.widthMm} min={300} max={4000} digits={0} width={70} onCommit={(v) => setRisco({ fabric: { ...st.fabric, widthMm: v } }, true)} />
        </label>
        <label title="Comprimento máximo do risco (mesa de corte). 0 = sem limite">
          Comprimento máx.
          <NumberField value={st.fabric.maxLengthMm ?? 0} min={0} digits={0} width={70} onCommit={(v) => setRisco({ fabric: { ...st.fabric, maxLengthMm: v } }, true)} />
        </label>
      </div>
      <div className="cb-options">
        {st.running ? (
          <>
            <span className="walk-stat">{st.progress}</span>
            <button className="danger" onClick={stopNest}><IconPlayerStop size={16} /> Parar</button>
          </>
        ) : (
          <>
            <button className="primary" data-help="risco:nest" onClick={() => runNest(2)} title="Encaixe automático (cerca de 2 s)"><IconPlayerPlay size={16} /> Encaixe automático</button>
            <button onClick={() => runNest(15)} title="Tenta várias ordens por 15 s e fica com o risco mais curto"><IconSparkles size={16} /> Otimizar 15 s</button>
            <button className="ghost" onClick={() => runNest(60)}>60 s</button>
            <span className="tsep" />
            <button className="ghost" onClick={fillRemaining} title="Encaixa os moldes fora do risco sem mexer nos outros">Encaixar restantes</button>
            <button className="ghost" onClick={compact} title="Reencaixa da esquerda para a direita, puxando os moldes para o início"><IconArrowsMinimize size={16} /> Compactar</button>
            <button className="ghost" disabled={!st.selected} onClick={rotateSelected} title="Girar o molde selecionado (R)"><IconRotateClockwise2 size={16} /></button>
            <button className="ghost" disabled={!st.selected} onClick={unplaceSelected} title="Tirar do risco (Delete)">Tirar</button>
            <button className="ghost" onClick={clearMarker} title="Esvaziar o risco"><IconTrash size={16} /></button>
          </>
        )}
      </div>
      <div className="spacer" />
      <span className={`walk-stat ${st.fabric.maxLengthMm && stats.lengthMm > st.fabric.maxLengthMm ? 'bad' : ''}`}>
        Risco <b>{m(stats.lengthMm, 3)} m</b>
        {st.fabric.maxLengthMm ? ` de ${m(st.fabric.maxLengthMm, 2)} m` : ''}
      </span>
      <span className={`walk-stat ${stats.efficiency >= 0.8 ? 'good' : stats.placed ? '' : ''}`}>Aproveitamento <b>{(stats.efficiency * 100).toFixed(1)}%</b></span>
      {overlaps.size > 0 && <span className="walk-stat bad"><b>{overlaps.size}</b> sobrepostos</span>}
      <button className="ghost" onClick={() => riscoView.fit()}>Ajustar</button>
      {hasPrints ? (
        <button className="primary" data-help="risco:grafica" onClick={exportForPrintShop} disabled={st.progress.startsWith('Gerando')} title="Risco estampado em tamanho real para a gráfica de sublimação (TIFF ou PDF)">
          <IconFileExport size={16} /> {st.progress.startsWith('Gerando') ? st.progress : 'Arquivo para gráfica'}
        </button>
      ) : (
        <>
          <button className="primary" onClick={() => exportMarker('plt')}><IconFileExport size={16} /> PLT do risco</button>
          <button onClick={() => exportMarker('pdf')}>PDF</button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pedido, tecido e enfesto (esquerda)                                 */
/* ------------------------------------------------------------------ */

/** Tamanho final do arquivo da gráfica (metros e pixels). */
function FileSizeInfo() {
  const st = useRisco();
  useEditor();
  if (!st.placements.length) return null;
  const { stats } = riscoStats();
  const sb = st.sublim;
  const k = (p: number) => 1 / (1 - p / 100);
  const w = st.fabric.widthMm * k(sb.shrinkYPct) + 20, h = stats.lengthMm * k(sb.shrinkXPct) + 20;
  const dpi = sb.dpi ?? 150;
  const px = (mm: number) => Math.round((mm / 25.4) * dpi);
  const m = (mm: number) => (mm / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return (
    <div className="row info">
      <span>Arquivo</span>
      <b>{m(w)} × {m(h)} m{(sb.format ?? 'tiff') === 'tiff' ? ` · ${px(w)} × ${px(h)} px` : ''}</b>
    </div>
  );
}

/** Sublimação: encolhimento do tecido, artes na tela e o arquivo para a gráfica. */
function SublimationSection() {
  const st = useRisco();
  const ed = useEditor();
  const printed = ed.doc.pieces.filter((p) => p.prints?.length && !st.excluded[p.id]).length;
  const sb = st.sublim;
  return (
    <section className="dock-section">
      <header>Estampa / sublimação</header>
      <div className="dock-body">
        {printed ? (
          <>
            <p className="muted small">{printed} molde(s) com estampa. A sangria das artes já entra no espaço entre os moldes.</p>
            <label className="row check">
              <span>Mostrar as artes no risco</span>
              <input type="checkbox" checked={sb.showArt} onChange={(e) => setSublim({ showArt: e.target.checked })} />
            </label>
            <Row label="Encolhimento no comprimento (%)"><NumberField value={sb.shrinkXPct} min={-20} digits={2} suffix="%" onCommit={(v) => setSublim({ shrinkXPct: v })} width={60} /></Row>
            <Row label="Encolhimento na largura (%)"><NumberField value={sb.shrinkYPct} min={-20} digits={2} suffix="%" onCommit={(v) => setSublim({ shrinkYPct: v })} width={60} /></Row>
            <h5>Arquivo para a gráfica</h5>
            <Row label="Formato">
              <select value={sb.format ?? 'tiff'} onChange={(e) => setSublim({ format: e.target.value as 'tiff' | 'pdf' })}>
                <option value="tiff">TIFF (imagem, o que os RIPs mais aceitam)</option>
                <option value="pdf">PDF (artes originais, sem perder resolução)</option>
              </select>
            </Row>
            {(sb.format ?? 'tiff') === 'tiff' && (
              <Row label="Resolução">
                <select value={sb.dpi ?? 150} onChange={(e) => setSublim({ dpi: Number(e.target.value) })}>
                  <option value={72}>72 dpi (prova rápida)</option>
                  <option value={100}>100 dpi</option>
                  <option value={150}>150 dpi (padrão sublimação)</option>
                  <option value={200}>200 dpi</option>
                  <option value={300}>300 dpi (detalhe fino)</option>
                </select>
              </Row>
            )}
            <label className="row check">
              <span>Espelhar (papel transfer)</span>
              <input type="checkbox" checked={!!sb.mirror} onChange={(e) => setSublim({ mirror: e.target.checked })} />
            </label>
            <label className="row check">
              <span>Contornos finos de corte</span>
              <input type="checkbox" checked={sb.outlines} onChange={(e) => setSublim({ outlines: e.target.checked })} />
            </label>
            <FileSizeInfo />
            <button className="primary wide" onClick={exportForPrintShop} disabled={st.running || st.progress.startsWith('Gerando')}>
              {st.progress.startsWith('Gerando') ? st.progress : 'Gerar arquivo para gráfica'}
            </button>
            <p className="muted small">A largura do arquivo é a do tecido e o comprimento do risco desce na página, em tamanho real. O arquivo sai ampliado pela compensação para que, depois da prensa, as peças fiquem na medida — meça o encolhimento do seu tecido prensando uma amostra de 50 × 50 cm.</p>
          </>
        ) : (
          <p className="muted small">Nenhum molde com estampa. Coloque a arte na aba Modelagem (ferramenta Estampa, tecla A, ou painel Estampas).</p>
        )}
      </div>
    </section>
  );
}

export function RiscoSetup() {
  const st = useRisco();
  const ed = useEditor();
  const pieces = ed.doc.pieces;
  const sizes = docSizes(pieces);
  const order = effectiveOrder(pieces, st.order);
  const groups = [...new Set(pieces.map((p) => p.group ?? 'Moldes desenhados'))];
  const f = st.fabric;
  const setFab = (patch: Partial<typeof f>) => setRisco({ fabric: { ...f, ...patch } }, true);

  return (
    <aside className="dock left-dock">
      <section className="dock-section">
        <header>Tecido</header>
        <div className="dock-body">
          <Row label="Largura do tecido"><NumberField value={f.widthMm} min={300} max={4000} digits={0} onCommit={(v) => setFab({ widthMm: v })} width={70} /></Row>
          <div className="wchips" title="Larguras comuns de tecido (de ourela a ourela)">
            {FABRIC_WIDTHS.map((w) => (
              <button key={w} className={`wchip ${Math.abs(f.widthMm - w) < 0.5 ? 'on' : ''}`} onClick={() => setFab({ widthMm: w })}>
                {(w / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} m
              </button>
            ))}
          </div>
          {(f.widthMm < 300 || f.widthMm > 4000) && <p className="warn small">Largura de {(f.widthMm / 1000).toLocaleString('pt-BR')} m não parece de tecido — escolha uma largura acima.</p>}
          <p className="muted small">A largura é a medida de ourela a ourela (vertical na tela). O comprimento do risco é contínuo (horizontal) e cresce conforme o encaixe.</p>
          <Row label="Comprimento máximo (0 = livre)"><NumberField value={f.maxLengthMm ?? 0} min={0} digits={0} onCommit={(v) => setFab({ maxLengthMm: v })} width={70} /></Row>
          <Row label="Margem da ourela"><NumberField value={f.edgeMarginMm} min={0} digits={0} onCommit={(v) => setFab({ edgeMarginMm: v })} width={70} /></Row>
          <Row label="Distância entre moldes"><NumberField value={f.gapMm} min={0} digits={1} onCommit={(v) => setFab({ gapMm: v })} width={70} /></Row>
          <Row label="Rotação permitida">
            <select value={f.rotation} onChange={(e) => setFab({ rotation: e.target.value as typeof f.rotation })}>
              <option value="fixo">Fixa (tecido com sentido)</option>
              <option value="180">180° (sem sentido)</option>
              <option value="90">90° (qualquer)</option>
            </select>
          </Row>
          <label className="row check">
            <span>Enfesto face com face (pares saem juntos)</span>
            <input type="checkbox" checked={f.faceToFace} onChange={(e) => setFab({ faceToFace: e.target.checked })} />
          </label>
          <Row label="Precisão do encaixe">
            <select value={f.resolutionMm} onChange={(e) => setFab({ resolutionMm: Number(e.target.value) })}>
              <option value={2}>2 mm (justo, mais lento)</option>
              <option value={3}>3 mm</option>
              <option value={5}>5 mm (rápido)</option>
            </select>
          </Row>
        </div>
      </section>
      <SublimationSection />
      <section className="dock-section">
        <header>Pedido (peças por tamanho)</header>
        <div className="dock-body">
          {sizes.length ? (
            <div className="order-grid">
              {sizes.map((s) => (
                <label key={s}>
                  <span>{s}</span>
                  <NumberField value={order[s] ?? 0} min={0} digits={0} suffix="" width={48} onCommit={(v) => setRisco({ order: { ...st.order, [s]: Math.round(v) } }, true)} />
                </label>
              ))}
            </div>
          ) : (
            <>
              <p className="muted small">Moldes sem grade: informe quantas peças de roupa.</p>
              <Row label="Peças"><NumberField value={order[''] ?? 1} min={0} digits={0} suffix="" width={56} onCommit={(v) => setRisco({ order: { ...st.order, '': Math.round(v) } }, true)} /></Row>
            </>
          )}
          <Info label="Peças de roupa no risco" value={String(garmentsPerMarker())} />
        </div>
      </section>

      <section className="dock-section">
        <header>Moldes</header>
        <div className="dock-body">
          {pieces.length === 0 && <p className="muted small">O documento não tem moldes. Volte à Modelagem e insira uma base.</p>}
          {groups.map((g) => (
            <div key={g} className="mgroup">
              <div className="mgroup-name">{g}</div>
              {pieces
                .filter((p) => (p.group ?? 'Moldes desenhados') === g)
                .map((p) => (
                  <label key={p.id} className="row check">
                    <span>
                      {p.name} <small className="muted">{p.quantity}x{p.cutInPairs ? ' par' : ''}{p.grading ? '' : ' · sem grade'}</small>
                    </span>
                    <input type="checkbox" checked={!st.excluded[p.id]} onChange={(e) => setRisco({ excluded: { ...st.excluded, [p.id]: !e.target.checked } }, true)} />
                  </label>
                ))}
            </div>
          ))}
        </div>
      </section>

    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Resultado e enfesto (direita)                                       */
/* ------------------------------------------------------------------ */

export function RiscoSummary() {
  const st = useRisco();
  useEditor();
  const { items, stats, overlaps } = riscoStats();
  const g = garmentsPerMarker();
  const sp = spreadResult(stats.lengthMm, g, st.spread);
  const bySize = new Map<string, { placed: number; total: number }>();
  const placed = new Set(st.placements.map((p) => p.key));
  for (const it of items) {
    const e = bySize.get(it.size) ?? { placed: 0, total: 0 };
    e.total++;
    if (placed.has(it.key)) e.placed++;
    bySize.set(it.size, e);
  }
  const sel = items.find((i) => i.key === st.selected);
  return (
    <aside className="dock">
      <section className="dock-section">
        <header>Risco</header>
        <div className="dock-body">
          <Info label="Comprimento" value={`${m(stats.lengthMm, 3)} m`} strong />
          <Info label="Largura útil" value={`${m(st.fabric.widthMm - 2 * st.fabric.edgeMarginMm, 3)} m`} />
          <Info label="Aproveitamento" value={`${(stats.efficiency * 100).toFixed(1)}%`} strong />
          <Info label="Moldes no risco" value={`${stats.placed} de ${items.length}`} />
          {overlaps.size > 0 && <p className="bad-note">{overlaps.size} molde(s) sobrepostos ou fora da largura (em vermelho).</p>}
          <h4>Por tamanho</h4>
          {[...bySize.entries()].map(([s, e]) => (
            <Info key={s || '—'} label={s || 'sem grade'} value={`${e.placed}/${e.total} moldes`} />
          ))}
        </div>
      </section>
      <section className="dock-section">
        <header>Enfesto e consumo</header>
        <div className="dock-body">
          <Row label="Folhas (camadas)"><NumberField value={st.spread.plies} min={1} digits={0} suffix="" onCommit={(v) => setRisco({ spread: { ...st.spread, plies: Math.round(v) } })} width={64} /></Row>
          <Row label="Folga em cada ponta"><NumberField value={st.spread.endAllowanceMm} min={0} digits={0} onCommit={(v) => setRisco({ spread: { ...st.spread, endAllowanceMm: v } })} width={64} /></Row>
          <Info label="Comprimento da folha" value={`${sp.plyLengthM.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} m`} />
          <Info label="Tecido do enfesto" value={`${sp.fabricTotalM.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m`} strong />
          <Info label="Peças cortadas" value={String(sp.garments)} />
          <Info label="Consumo por peça" value={`${sp.perGarmentM.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} m`} strong />
        </div>
      </section>
      <section className="dock-section">
        <header>Molde selecionado</header>
        <div className="dock-body">
          {sel ? (
            <>
              <Info label="Molde" value={sel.name} />
              <Info label="Tamanho" value={sel.size || '—'} />
              <Info label="Espelhado (par)" value={sel.mirror ? 'sim' : 'não'} />
              <Info label="Área" value={`${fmtMm(sel.area / 1e6, 4)} m²`} />
              <p className="muted small">Arraste para mover · R gira · setas movem 1 mm (Shift 10) · Delete tira do risco.</p>
            </>
          ) : (
            <p className="muted small">Clique num molde do risco para ver os dados. Arraste moldes da faixa "Fora do risco" para o tecido.</p>
          )}
        </div>
      </section>
    </aside>
  );
}
