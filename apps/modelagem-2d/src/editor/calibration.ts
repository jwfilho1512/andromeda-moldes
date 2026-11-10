/**
 * Calibração da tela para "tamanho real": quantos pixels CSS equivalem a 1 mm físico
 * NESTE monitor. O padrão CSS (96 px/pol) raramente bate com a tela real, então o
 * usuário mede uma barra com régua e o fator é corrigido.
 * (Isto afeta só a visualização — PDF/PLT já são exatos por construção.)
 */
const KEY = 'cad.pxPerMm';
export const DEFAULT_PX_PER_MM = 96 / 25.4;

export function getPxPerMm(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (v > 0) return v;
  } catch {
    /* armazenamento indisponível */
  }
  return DEFAULT_PX_PER_MM;
}

export function setPxPerMm(v: number): void {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* armazenamento indisponível */
  }
}
