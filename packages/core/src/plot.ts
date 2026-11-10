import { type BBox, type Placement, type Vec2, IDENTITY, add, applyPlacement, bboxOfPoints, flattenPath, normalize, scale, unionBBox } from './geometry.js';
import { type Piece, cutLine, edgeSeam } from './pattern.js';
import { notchGeometry } from './edit.js';
import { dartGeometry } from './modelagem.js';

/**
 * Camada intermediária de plotagem: tudo que vai para papel/plotter vira uma lista
 * de traços (polilinhas em mm, já posicionadas) + textos. PDF e HPGL consomem a
 * mesma lista, então a saída é idêntica nos dois formatos.
 */

/** Canetas: 1 = corte, 2 = costura/internas/marcações, 3 = textos. */
export type Pen = 1 | 2 | 3;

export interface Stroke {
  points: Vec2[];
  closed: boolean;
  pen: Pen;
}

export interface Label {
  at: Vec2;
  text: string;
  /** Altura do caractere em mm. */
  heightMm: number;
}

export interface PlotJob {
  strokes: Stroke[];
  labels: Label[];
}

export function emptyJob(): PlotJob {
  return { strokes: [], labels: [] };
}

export interface PlotPieceOptions {
  placement?: Placement;
  /** Desenhar também a linha de costura (contorno base) quando há margem. Padrão: true. */
  showSewLine?: boolean;
}

/** Adiciona um molde ao trabalho de plotagem. */
export function addPiece(job: PlotJob, piece: Piece, opts: PlotPieceOptions = {}): PlotJob {
  const t = opts.placement ?? IDENTITY;
  const place = (pts: Vec2[]) => pts.map((p) => applyPlacement(p, t));

  const cut = place(cutLine(piece));
  job.strokes.push({ points: cut, closed: true, pen: 1 });

  if ((piece.seamAllowanceMm > 0 || Object.values(piece.seamByEdge ?? {}).some((d) => d > 0)) && opts.showSewLine !== false) {
    job.strokes.push({ points: place(flattenPath(piece.outline)), closed: true, pen: 2 });
  }
  for (const path of piece.internals) {
    job.strokes.push({ points: place(flattenPath(path)), closed: path.closed, pen: 2 });
  }
  if (piece.grainline) {
    const [a, b] = piece.grainline;
    job.strokes.push({ points: place([a, b]), closed: false, pen: 2 });
    // Setas nas duas pontas do fio
    for (const [tip, from] of [[a, b], [b, a]] as const) {
      const dir = normalize({ x: tip.x - from.x, y: tip.y - from.y });
      const back = scale(dir, -8);
      const side = scale({ x: -dir.y, y: dir.x }, 3);
      job.strokes.push({ points: place([add(add(tip, back), side), tip, add(add(tip, back), scale(side, -1))]), closed: false, pen: 2 });
    }
  }
  // Piques: traço da linha de corte para dentro, atravessando a margem.
  for (const n of piece.notches) {
    const g = notchGeometry(piece, n);
    const dir = normalize(g.inward);
    const outer = add(g.at, scale(dir, -edgeSeam(piece, n.edge)));
    const inner = add(g.at, scale(dir, n.depthMm));
    job.strokes.push({ points: place([outer, inner]), closed: false, pen: 1 });
  }

  // Pences: pernas, piques nas pernas e furo 1 cm antes do ápice.
  for (const d of piece.darts ?? []) {
    const g = dartGeometry(piece, d);
    job.strokes.push({ points: place([g.legA, g.apex, g.legB]), closed: false, pen: 2 });
    for (const leg of [g.legA, g.legB]) {
      const dir = normalize({ x: g.apex.x - leg.x, y: g.apex.y - leg.y });
      job.strokes.push({ points: place([add(leg, scale(dir, -edgeSeam(piece, d.edge))), add(leg, scale(dir, 5))]), closed: false, pen: 1 });
    }
    const mouth = { x: (g.legA.x + g.legB.x) / 2, y: (g.legA.y + g.legB.y) / 2 };
    const hole = add(g.apex, scale(normalize({ x: mouth.x - g.apex.x, y: mouth.y - g.apex.y }), 10));
    const ring = Array.from({ length: 8 }, (_, k) => ({ x: hole.x + 1.5 * Math.cos((k * Math.PI) / 4), y: hole.y + 1.5 * Math.sin((k * Math.PI) / 4) }));
    job.strokes.push({ points: place(ring), closed: true, pen: 1 });
  }

  // Pontos internos (furo/marcação): círculo de 2 mm com cruz.
  for (const q of piece.drills ?? []) {
    const ring = Array.from({ length: 12 }, (_, k) => ({ x: q.x + 2 * Math.cos((k * Math.PI) / 6), y: q.y + 2 * Math.sin((k * Math.PI) / 6) }));
    job.strokes.push({ points: place(ring), closed: true, pen: 2 });
    job.strokes.push({ points: place([{ x: q.x - 3, y: q.y }, { x: q.x + 3, y: q.y }]), closed: false, pen: 2 });
    job.strokes.push({ points: place([{ x: q.x, y: q.y - 3 }, { x: q.x, y: q.y + 3 }]), closed: false, pen: 2 });
  }

  // Etiqueta: nome + quantidade, no centro da caixa do molde.
  const bb = bboxOfPoints(cut);
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  const qty = `${piece.quantity}x${piece.cutInPairs ? ' (par)' : ''}`;
  job.labels.push({ at: { x: cx, y: cy + 4 }, text: piece.name, heightMm: 6 });
  job.labels.push({ at: { x: cx, y: cy - 6 }, text: qty, heightMm: 4 });
  return job;
}

/**
 * Quadrado de verificação de escala: o operador mede com régua após imprimir.
 * Se não medir exatamente `sizeMm`, a impressora/driver está escalando.
 */
export function addScaleCheck(job: PlotJob, origin: Vec2, sizeMm = 100): PlotJob {
  const { x, y } = origin;
  job.strokes.push({
    points: [origin, { x: x + sizeMm, y }, { x: x + sizeMm, y: y + sizeMm }, { x, y: y + sizeMm }],
    closed: true,
    pen: 1,
  });
  job.labels.push({ at: { x: x + sizeMm / 2, y: y + sizeMm / 2 }, text: `${sizeMm} x ${sizeMm} mm`, heightMm: 5 });
  return job;
}

export function jobBBox(job: PlotJob): BBox {
  const boxes = job.strokes.map((s) => bboxOfPoints(s.points));
  if (boxes.length === 0) throw new Error('Trabalho de plotagem vazio');
  return boxes.reduce(unionBBox);
}
