import type { Piece } from '@cad-textil/core';
import type { Genero, Medidas } from './medidas.js';

/** Uma base pronta: conjunto de moldes + ficha com todas as informações técnicas. */
export interface Base {
  id: string;
  nome: string;
  genero: Genero;
  tamanho: string;
  categoria: 'Blocos' | 'Malharia' | 'Camisaria' | 'Saias' | 'Calças' | 'Alfaiataria';
  descricao: string;
  tecido: string;
  aviamentos: string[];
  folgas: string[];
  margens: string[];
  /** Conferências calculadas (ex.: cava × cabeça da manga). */
  conferencias: string[];
  medidas: Medidas;
  pecas: Piece[];
}

/** Número em cm com vírgula. */
export const f1 = (v: number, d = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Bisseção genérica: acha x em [lo, hi] com f(x) = alvo (f monotônica). */
export function solve(f: (x: number) => number, target: number, lo: number, hi: number): number {
  const inc = f(hi) > f(lo);
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < target === inc) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
