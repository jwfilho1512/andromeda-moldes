/**
 * Unidades do sistema.
 *
 * REGRA DE OURO: toda geometria interna é em MILÍMETROS (number = float64).
 * Conversões para outras unidades só acontecem na borda (exportadores / tela).
 * Sistema de coordenadas do modelo: origem embaixo-esquerda, X para direita, Y para cima
 * (igual a PDF e HPGL, então nenhum exportador precisa espelhar o eixo Y).
 */

export const MM_PER_INCH = 25.4;

/** PDF: 1 ponto = 1/72 polegada. */
export const PT_PER_MM = 72 / MM_PER_INCH;

/** HPGL: 1 unidade de plotter (plu) = 0,025 mm → 40 plu por mm. */
export const HPGL_UNITS_PER_MM = 40;

export const mmToPt = (mm: number): number => mm * PT_PER_MM;
export const ptToMm = (pt: number): number => pt / PT_PER_MM;
export const mmToHpgl = (mm: number): number => Math.round(mm * HPGL_UNITS_PER_MM);
export const hpglToMm = (plu: number): number => plu / HPGL_UNITS_PER_MM;
export const cmToMm = (cm: number): number => cm * 10;

/** Tolerância padrão de achatamento de curvas (distância máx. corda↔curva), em mm. */
export const DEFAULT_FLATTEN_TOLERANCE_MM = 0.01;
