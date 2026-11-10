/**
 * Alças da estampa na tela (ferramenta Estampa): 8 de escala em volta da arte/módulo e uma de giro.
 * Cantos escalam proporcional (Shift = livre); laterais mudam só largura ou altura; Alt = a partir do centro.
 */
import type { PiecePrint, PrintFrame, Vec2 } from '@cad-textil/core';

export type HandleId = { u: number; v: number } | 'rot';

export interface FrameHandle {
  id: HandleId;
  p: Vec2;
}

export const at = (f: PrintFrame, u: number, v: number): Vec2 => ({ x: f.O.x + u * f.U.x + v * f.V.x, y: f.O.y + u * f.U.y + v * f.V.y });
export const frameCenter = (f: PrintFrame): Vec2 => at(f, 0.5, 0.5);

/** Distância (em px) da alça de giro acima da arte. */
const ROT_PX = 26;

/** Alças do quadro; `zoom` = px por mm. A total só gira (o tamanho segue o molde). */
export function frameHandles(f: PrintFrame, mode: PiecePrint['mode'], zoom: number): FrameHandle[] {
  const out: FrameHandle[] = [];
  if (mode !== 'total') {
    for (const u of [0, 0.5, 1]) for (const v of [0, 0.5, 1]) if (u !== 0.5 || v !== 0.5) out.push({ id: { u, v }, p: at(f, u, v) });
  }
  const top = at(f, 0.5, 1);
  const L = Math.hypot(f.V.x, f.V.y);
  if (L > 0) out.push({ id: 'rot', p: { x: top.x + (f.V.x / L) * (ROT_PX / zoom), y: top.y + (f.V.y / L) * (ROT_PX / zoom) } });
  return out;
}

/** Coordenadas (u, v) de um ponto no quadro. */
function uvOf(f: PrintFrame, p: Vec2): { u: number; v: number } {
  const det = f.U.x * f.V.y - f.U.y * f.V.x || 1e-12;
  const dx = p.x - f.O.x, dy = p.y - f.O.y;
  return { u: (dx * f.V.y - dy * f.V.x) / det, v: (f.U.x * dy - f.U.y * dx) / det };
}

/** Quadro escalado pela alça `h` até o ponto `w`. */
export function scaleFrame(f: PrintFrame, h: { u: number; v: number }, w: Vec2, opts: { fromCenter: boolean; free: boolean }): PrintFrame {
  const A = opts.fromCenter ? { u: 0.5, v: 0.5 } : { u: 1 - h.u, v: 1 - h.v };
  const PA = at(f, A.u, A.v);
  const corner = h.u !== 0.5 && h.v !== 0.5;
  let kx = 1, ky = 1;
  if (corner && !opts.free) {
    const d = { x: at(f, h.u, h.v).x - PA.x, y: at(f, h.u, h.v).y - PA.y };
    const k = ((w.x - PA.x) * d.x + (w.y - PA.y) * d.y) / (d.x * d.x + d.y * d.y || 1);
    kx = ky = k;
  } else {
    const m = uvOf(f, w);
    if (h.u !== 0.5) kx = (m.u - A.u) / (h.u - A.u);
    if (h.v !== 0.5) ky = (m.v - A.v) / (h.v - A.v);
  }
  // nunca vira do avesso nem fica menor que 2 mm
  const lu = Math.hypot(f.U.x, f.U.y), lv = Math.hypot(f.V.x, f.V.y);
  kx = Math.max(kx, 2 / (lu || 1));
  ky = Math.max(ky, 2 / (lv || 1));
  const U = { x: f.U.x * kx, y: f.U.y * kx }, V = { x: f.V.x * ky, y: f.V.y * ky };
  return { O: { x: PA.x - A.u * U.x - A.v * V.x, y: PA.y - A.u * U.y - A.v * V.y }, U, V };
}

/** Quadro girado `deg` graus (anti-horário) em volta de `c`. */
export function rotateFrame(f: PrintFrame, c: Vec2, deg: number): PrintFrame {
  const r = (deg * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
  const R = (v: Vec2) => ({ x: v.x * co - v.y * si, y: v.x * si + v.y * co });
  const o = R({ x: f.O.x - c.x, y: f.O.y - c.y });
  return { O: { x: o.x + c.x, y: o.y + c.y }, U: R(f.U), V: R(f.V) };
}

/** Cursor de redimensionar conforme a direção da alça na tela (Y da tela para baixo). */
export function resizeCursor(center: Vec2, p: Vec2): string {
  const a = ((Math.atan2(-(p.y - center.y), p.x - center.x) * 180) / Math.PI + 180) % 180; // 0..180, na tela
  if (a < 22.5 || a >= 157.5) return 'ew-resize';
  if (a < 67.5) return 'nesw-resize';
  if (a < 112.5) return 'ns-resize';
  return 'nwse-resize';
}
