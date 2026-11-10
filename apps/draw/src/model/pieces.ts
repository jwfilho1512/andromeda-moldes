/** Moldes do Andromeda Moldes (.ctx / DXF) como desenho vetorial no Draw. */
import { type Piece, type Vec2, cutLine, flattenPath } from '@cad-textil/core';
import { newId } from '../state';
import { polyPath } from './geom';
import type { PathShape, Shape, TextShape } from './types';

const INK = '#1b1b1f';

/** Moldes viram desenho: linha de corte, linha de costura tracejada, linhas internas, fio e nome. */
export function piecesToShapes(pieces: Piece[], scale: number): Shape[] {
  const k = 1 / scale;
  const f = (p: Vec2): Vec2 => ({ x: p.x * k, y: -p.y * k });
  const out: Shape[] = [];
  let x = 0;
  for (const piece of pieces) {
    const cut = cutLine(piece).map(f);
    const xs = cut.map((p) => p.x), ys = cut.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const dx = x - minX, dy = -minY;
    const g = (p: Vec2): Vec2 => ({ x: p.x + dx, y: p.y + dy });
    const kids: Shape[] = [];
    const line = (pts: Vec2[], closed: boolean, extra: Partial<PathShape['style']> = {}): PathShape => ({
      kind: 'path',
      id: newId(),
      path: polyPath(pts.map(g), closed),
      style: { stroke: INK, width: 0.3, fill: null, ...extra },
    });
    kids.push({ ...line(cut, true, { fill: { kind: 'solid', color: '#ffffff' } }), name: 'Linha de corte' });
    const sew = flattenPath(piece.outline, 0.1).map(f);
    if (piece.seamAllowanceMm > 0 || Object.keys(piece.seamByEdge ?? {}).length) kids.push({ ...line(sew, true, { width: 0.2, dash: [1.2, 0.8] }), name: 'Linha de costura' });
    for (const p of piece.internals) kids.push(line(flattenPath(p, 0.1).map(f), p.closed, { width: 0.2 }));
    if (piece.grainline) {
      const [a, b] = piece.grainline.map(f) as [Vec2, Vec2];
      kids.push({ ...line([a, b], false, { width: 0.25 }), name: 'Fio' });
    }
    const label: TextShape = {
      kind: 'text',
      id: newId(),
      at: g({ x: (minX + maxX) / 2 - piece.name.length * 1.1, y: (minY + maxY) / 2 }),
      text: piece.name,
      size: 4,
      color: INK,
    };
    kids.push(label);
    out.push({ kind: 'group', id: newId(), name: piece.name, children: kids });
    x += maxX - minX + 8;
  }
  return out;
}

