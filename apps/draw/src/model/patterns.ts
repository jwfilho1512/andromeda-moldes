/**
 * Tecidos como preenchimento: padrões SVG gerados por parâmetros (cores, escala, ângulo).
 * Cada padrão é um ladrilho de `size` mm que se repete.
 */
import type { Fill, PatternKind } from './types';

export const PATTERN_LABEL: Record<PatternKind, string> = {
  'listra-h': 'Listra horizontal',
  'listra-v': 'Listra vertical',
  xadrez: 'Xadrez',
  vichy: 'Vichy',
  poa: 'Poá',
  sarja: 'Jeans / sarja',
  canelado: 'Canelado (ribana)',
  tricot: 'Tricô',
  'pied-poule': 'Pied-de-poule',
  espinha: 'Espinha de peixe',
  matelasse: 'Matelassê',
  onca: 'Onça',
};

export interface Tile {
  size: number;
  /** Elementos SVG do ladrilho (como string), em coordenadas 0..size. */
  body: string;
}

/** Ladrilho base (escala 1) de cada padrão; c1 = fundo, c2 = desenho. */
export function tile(kind: PatternKind, c1: string, c2: string): Tile {
  const bg = (s: number) => `<rect width="${s}" height="${s}" fill="${c1}"/>`;
  switch (kind) {
    case 'listra-h':
      return { size: 4, body: bg(4) + `<rect y="0" width="4" height="2" fill="${c2}"/>` };
    case 'listra-v':
      return { size: 4, body: bg(4) + `<rect x="0" width="2" height="4" fill="${c2}"/>` };
    case 'xadrez':
      return {
        size: 8,
        body:
          bg(8) +
          `<rect width="8" height="2.4" fill="${c2}" opacity=".55"/><rect width="2.4" height="8" fill="${c2}" opacity=".55"/>` +
          `<path d="M0 5.2h8M5.2 0v8" stroke="${c2}" stroke-width=".3"/>`,
      };
    case 'vichy':
      return { size: 4, body: bg(4) + `<rect width="4" height="2" fill="${c2}" opacity=".5"/><rect width="2" height="4" fill="${c2}" opacity=".5"/>` };
    case 'poa':
      return { size: 4, body: bg(4) + `<circle cx="1" cy="1" r=".55" fill="${c2}"/><circle cx="3" cy="3" r=".55" fill="${c2}"/>` };
    case 'sarja':
      return { size: 2, body: bg(2) + `<path d="M-.5 .5l1-1M0 2l2-2M1.5 2.5l1-1" stroke="${c2}" stroke-width=".35"/>` };
    case 'canelado':
      return { size: 1.6, body: bg(1.6) + `<path d="M.4 0v1.6M1.2 0v1.6" stroke="${c2}" stroke-width=".3"/>` };
    case 'tricot':
      return {
        size: 3,
        body: bg(3) + `<path d="M0 0l.75 1.5L1.5 0M1.5 0l.75 1.5L3 0M0 1.5l.75 1.5L1.5 1.5M1.5 1.5l.75 1.5L3 1.5" fill="none" stroke="${c2}" stroke-width=".3"/>`,
      };
    case 'pied-poule':
      return {
        size: 4,
        body: bg(4) + `<path d="M0 0h2v1l1 1h1v2h-1l-1-1H0z" fill="${c2}"/>`,
      };
    case 'espinha':
      return {
        size: 4,
        body: bg(4) + `<path d="M0 0l2 2-2 2M2 0l2 2-2 2" fill="none" stroke="${c2}" stroke-width=".4"/>`,
      };
    case 'matelasse':
      return { size: 6, body: bg(6) + `<path d="M0 0l6 6M6 0L0 6" stroke="${c2}" stroke-width=".25" stroke-dasharray=".6 .4"/>` };
    case 'onca':
      return {
        size: 8,
        body:
          bg(8) +
          `<g fill="none" stroke="${c2}" stroke-width=".55" stroke-linecap="round"><path d="M1 1.2c.8-.6 1.8-.2 1.9.6M2.4 3c-.6.6-1.4.4-1.6-.3"/><path d="M5 1.8c.9-.3 1.6.4 1.4 1.2M6.8 4.1c-.8.4-1.5 0-1.6-.7"/><path d="M2 5.5c.9-.4 1.8.2 1.6 1.1M3.6 7.6c-.9.3-1.6-.3-1.6-1"/><path d="M5.6 5.8c.6.6.3 1.6-.5 1.7"/></g>` +
          `<g fill="${c2}"><circle cx="1.8" cy="2.2" r=".35"/><circle cx="5.9" cy="3" r=".35"/><circle cx="2.8" cy="6.6" r=".35"/></g>`,
      };
  }
}

/** Id estável do <pattern> SVG para um preenchimento. */
export function patternId(f: Extract<Fill, { kind: 'pattern' }>): string {
  const h = `${f.pattern}|${f.c1}|${f.c2}|${f.scale}|${f.angle}`;
  let x = 0;
  for (let i = 0; i < h.length; i++) x = (x * 31 + h.charCodeAt(i)) | 0;
  return `pt${(x >>> 0).toString(36)}`;
}

/** Elemento <pattern> completo (string SVG). */
export function patternDef(f: Extract<Fill, { kind: 'pattern' }>): string {
  const t = tile(f.pattern, f.c1, f.c2);
  return `<pattern id="${patternId(f)}" patternUnits="userSpaceOnUse" width="${t.size}" height="${t.size}" patternTransform="rotate(${f.angle}) scale(${f.scale})">${t.body}</pattern>`;
}

export const fillValue = (f: Fill | null): string => (!f ? 'none' : f.kind === 'solid' ? f.color : `url(#${patternId(f)})`);
