/**
 * Kit para desenhar os assets da biblioteca: pontos-chave em cm da peça real → caminhos no desenho.
 * Convenção dos geradores: eixo de simetria em x = 0, y para baixo, unidade = 1 cm da peça
 * (com escala 1:10, 1 cm da peça = 1 mm no desenho).
 */
import { type Path, type Vec2, flattenPath, pathThroughPoints } from '@cad-textil/core';
import { newId } from '../state';
import { STITCH_DEFAULT } from '../model/stitch';
import { offsetPolyline, polyPath } from '../model/geom';
import type { PathShape, Shape, StitchShape, StitchType, Style, TrimKind, TrimShape } from '../model/types';
import { TRIM_SIZE } from '../model/trims';

export type Pt = [number, number] | [number, number, 'c'];
export const INK = '#1b1b1f';

/** Caminho que passa pelos pontos; [x, y, 'c'] é canto. Pontas de linha aberta são sempre cantos. */
export function curve(pts: Pt[], closed = false): Path {
  return pathThroughPoints(
    pts.map((p) => ({ p: { x: p[0], y: p[1] }, corner: p[2] === 'c' })),
    closed,
  );
}

export const line = (...pts: [number, number][]): Path => polyPath(pts.map(([x, y]) => ({ x, y })));

const OUTLINE: Style = { stroke: INK, width: 0.35, fill: { kind: 'solid', color: '#ffffff' } };
const DETAIL: Style = { stroke: INK, width: 0.22, fill: null };

/** Contorno (com preenchimento). `half` = meio contorno espelhado no eixo x = 0. */
export const outline = (path: Path, half = true, name?: string): PathShape => ({
  kind: 'path',
  id: newId(),
  name,
  path,
  style: { ...OUTLINE },
  ...(half ? { mirror: 0 } : {}),
});

/** Linha de detalhe (recorte, costura, dobra). */
export const detail = (path: Path, mirror = true, extra: Partial<Style> = {}): PathShape => ({
  kind: 'path',
  id: newId(),
  path,
  style: { ...DETAIL, ...extra },
  ...(mirror ? { mirror: 0 } : {}),
});

/** Forma fechada de detalhe com fundo branco (bolso, gola, lapela…). */
export const patch = (path: Path, mirror = true): PathShape => ({
  kind: 'path',
  id: newId(),
  path,
  style: { stroke: INK, width: 0.28, fill: { kind: 'solid', color: '#ffffff' } },
  ...(mirror ? { mirror: 0 } : {}),
});

export const stitch = (path: Path, type: StitchType = 'duplo', mirror = true): StitchShape => ({
  kind: 'stitch',
  id: newId(),
  path,
  stitch: { type, ...STITCH_DEFAULT[type], color: INK },
  ...(mirror ? { mirror: 0 } : {}),
});

/** Pesponto paralelo a um caminho, a `d` cm (positivo = esquerda do sentido do caminho). */
export function along(path: Path, d: number, type: StitchType = 'duplo', mirror = true): StitchShape {
  const pts = flattenPath(path, 0.05);
  return stitch(polyPath(offsetPolyline(pts, d)), type, mirror);
}

export const trim = (kind: TrimKind, x: number, y: number, mirror = false, size = TRIM_SIZE[kind]): TrimShape => ({
  kind: 'trim',
  id: newId(),
  trim: kind,
  at: { x, y },
  size,
  rot: 0,
  color: INK,
  ...(mirror ? { mirror: 0 } : {}),
});

/** Agrupa e posiciona (o eixo x = 0 vai para `at`). */
export function group(name: string, children: Shape[], at: Vec2 = { x: 0, y: 0 }): Shape {
  const move = (s: Shape): Shape => {
    const f = (p: Vec2) => ({ x: p.x + at.x, y: p.y + at.y });
    const m = s.mirror !== undefined ? { mirror: s.mirror + at.x } : {};
    switch (s.kind) {
      case 'path':
      case 'stitch':
        return { ...s, ...m, path: { start: f(s.path.start), closed: s.path.closed, segments: s.path.segments.map((g) => (g.kind === 'line' ? { kind: 'line', to: f(g.to) } : { kind: 'cubic', c1: f(g.c1), c2: f(g.c2), to: f(g.to) })) } };
      case 'trim':
      case 'text':
      case 'image':
        return { ...s, ...m, at: f(s.at) };
      case 'dim':
        return { ...s, a: f(s.a), b: f(s.b) };
      case 'group':
        return { ...s, ...m, children: s.children.map(move) };
    }
  };
  return { kind: 'group', id: newId(), name, children: children.map(move) };
}
