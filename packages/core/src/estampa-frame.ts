/**
 * Referencial (posição, giro, espelho) de uma estampa no molde. Fica separado de `estampa.ts`
 * para que as transformações de molde (mover, girar, espelhar, gradação) possam usá-lo sem
 * dependência circular.
 */
import { type Vec2, sub } from './geometry.js';

export type PrintMode = 'localizada' | 'total' | 'corrida' | 'textura';

/** Como os módulos se repetem (corrida e textura). */
export type RepeatLayout = 'grade' | 'meio-salto' | 'tijolo' | 'espelhada';

/** Como a arte total se ajusta ao molde. */
export type FitMode = 'cobrir' | 'conter' | 'esticar';

export interface PiecePrint {
  id: string;
  mode: PrintMode;
  /** Arte por tamanho (nome do tamanho → id da arte em doc.artworks); chave '' = todos os tamanhos. */
  art: Record<string, string>;
  /**
   * Centro da arte (localizada), origem dos módulos (corrida) ou referência do giro (total), em mm.
   * Textura: só serve para a prévia no molde — no risco ela começa na origem do tecido (+ deslocamento).
   */
  center: Vec2;
  /** Giro da arte (graus, anti-horário). */
  rotationDeg: number;
  /** Arte espelhada (acompanha o molde quando ele é espelhado). */
  mirrored: boolean;
  /** Largura da arte (localizada) ou do módulo (corrida), em mm; a altura segue a proporção da imagem. */
  widthMm: number;
  /** Largura por tamanho (localizada), quando muda na gradação. */
  widthBySize?: Record<string, number>;
  /** Altura da arte/módulo (mm). Ausente = proporcional à largura (proporção da imagem travada). */
  heightMm?: number;
  /** Altura por tamanho (localizada), com a proporção destravada. */
  heightBySize?: Record<string, number>;
  /** Arte de cabeça para baixo (espelho vertical). `mirrored` é o espelho horizontal. */
  flipV?: boolean;
  /** Corrida/textura: tipo de repetição e espaço entre módulos (mm). */
  repeat?: RepeatLayout;
  gapXMm?: number;
  gapYMm?: number;
  /** Textura: deslocamento do desenho no tecido (mm), para acertar onde o módulo começa. */
  offsetMm?: Vec2;
  /** Total: cobrir o molde (corta sobras), caber inteira (pode sobrar fundo) ou esticar. */
  fit?: FitMode;
  /** Sangria: quanto a arte passa da linha de corte (mm). */
  bleedMm: number;
  /**
   * No molde cortado em par, o par espelhado também leva a arte espelhada?
   * Padrão: localizada NÃO (texto/logo continua legível); total e corrida SIM (a arte acompanha a forma).
   */
  mirrorInPair?: boolean;
}

/** Leva a estampa junto com uma transformação do molde (mover, girar, espelhar). */
export function mapPrint(pr: PiecePrint, f: (p: Vec2) => Vec2): PiecePrint {
  const c = f(pr.center);
  const a = (pr.rotationDeg * Math.PI) / 180;
  const ex = sub(f({ x: pr.center.x + Math.cos(a), y: pr.center.y + Math.sin(a) }), c);
  const ey = sub(f({ x: pr.center.x - Math.sin(a), y: pr.center.y + Math.cos(a) }), c);
  const flips = ex.x * ey.y - ex.y * ey.x < 0;
  // com espelho, o eixo X da arte troca de sentido: o novo giro segue o eixo Y (que não inverte)
  const rot = (Math.atan2(ey.y, ey.x) * 180) / Math.PI - 90;
  return { ...pr, center: c, rotationDeg: Math.round(((rot % 360) + 360) % 360 * 1e9) / 1e9, mirrored: flips ? !pr.mirrored : pr.mirrored };
}
