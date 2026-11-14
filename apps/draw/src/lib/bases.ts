/**
 * Peças base paramétricas para desenho técnico (flat). As peças em si ficam em `bases2.ts`
 * (desenhadas no padrão de mercado: meia peça espelhada, proporções de corpo real e traço de
 * ficha técnica). Medidas em cm da peça real (desenho em 1:10 → 1 cm = 1 mm).
 */
import type { Shape } from '../model/types';
import { NEW_BASES } from './bases2';

export type Vista = 'frente' | 'costas';

export interface OptionDef {
  key: string;
  label: string;
  choices?: { value: string; label: string }[];
  /** Campo numérico (cm). */
  min?: number;
  max?: number;
}

export interface BaseDef {
  id: string;
  label: string;
  /** Categoria na biblioteca. */
  cat: 'Superiores' | 'Inferiores' | 'Inteiras';
  options: OptionDef[];
  defaults: Record<string, string | number>;
  make(o: Record<string, string | number>, vista: Vista): Shape[];
}

export const BASES: BaseDef[] = Object.values(NEW_BASES);

export const baseById = (id: string) => BASES.find((b) => b.id === id);
