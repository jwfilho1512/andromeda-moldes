/**
 * Aviamentos (botões, ilhós, rebites…) desenhados como símbolos vetoriais.
 * Coordenadas locais num quadrado de lado 1 centrado em (0,0); o símbolo é escalado por `size`.
 */
import type { TrimKind } from './types';

export interface TrimPart {
  /** Caminho SVG local. */
  d: string;
  fill?: boolean;
  /** Espessura relativa ao tamanho. */
  w: number;
}

const circle = (r: number, cx = 0, cy = 0) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const TRIM_LABEL: Record<TrimKind, string> = {
  botao4: 'Botão 4 furos',
  botao2: 'Botão 2 furos',
  pressao: 'Botão de pressão',
  botaoJeans: 'Botão jeans',
  ilhos: 'Ilhós',
  rebite: 'Rebite',
  colchete: 'Colchete',
  fivela: 'Fivela',
  etiqueta: 'Etiqueta',
  cursor: 'Cursor de zíper',
  terminal: 'Terminal de cordão',
  velcro: 'Velcro',
};

/** Tamanho inicial (mm no desenho, escala 1:10). */
export const TRIM_SIZE: Record<TrimKind, number> = {
  botao4: 1.4,
  botao2: 1.4,
  pressao: 1.3,
  botaoJeans: 1.7,
  ilhos: 1.0,
  rebite: 0.9,
  colchete: 1.6,
  fivela: 4,
  etiqueta: 4,
  cursor: 2.2,
  terminal: 1.6,
  velcro: 3,
};

export function trimParts(kind: TrimKind): TrimPart[] {
  switch (kind) {
    case 'botao4':
      return [
        { d: circle(0.5), w: 0.07 },
        ...[[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]].map(([x, y]) => ({ d: circle(0.06, x, y), fill: true, w: 0 })),
      ];
    case 'botao2':
      return [{ d: circle(0.5), w: 0.07 }, { d: circle(0.38), w: 0.04 }, { d: circle(0.07, -0.13) + circle(0.07, 0.13), fill: true, w: 0 }];
    case 'pressao':
      return [{ d: circle(0.5), w: 0.07 }, { d: circle(0.25), w: 0.06 }, { d: circle(0.08), fill: true, w: 0 }];
    case 'botaoJeans':
      return [{ d: circle(0.5), w: 0.08 }, { d: circle(0.36), w: 0.05 }, { d: 'M-0.18 -0.05h0.36M-0.12 0.08h0.24', w: 0.05 }];
    case 'ilhos':
      return [{ d: circle(0.5), w: 0.16 }, { d: circle(0.24), w: 0.05 }];
    case 'rebite':
      return [{ d: circle(0.5), w: 0.1 }, { d: circle(0.18), fill: true, w: 0 }];
    case 'colchete':
      return [{ d: 'M-0.5 -0.15h0.6a0.15 0.15 0 0 1 0 0.3h-0.6M0.25 -0.25h0.25v0.5h-0.25', w: 0.07 }];
    case 'fivela':
      return [{ d: 'M-0.5 -0.32h1v0.64h-1z', w: 0.06 }, { d: 'M-0.38 -0.2h0.76v0.4h-0.76z', w: 0.04 }, { d: 'M-0.05 -0.32v0.64', w: 0.06 }];
    case 'etiqueta':
      return [{ d: 'M-0.5 -0.25h1v0.5h-1z', w: 0.04 }, { d: 'M-0.35 -0.08h0.7M-0.25 0.08h0.5', w: 0.03 }];
    case 'cursor':
      return [{ d: 'M-0.18 -0.5h0.36l0.06 0.35h-0.48zM-0.1 -0.15h0.2v0.6a0.1 0.1 0 0 1 -0.2 0z', w: 0.05 }, { d: circle(0.04, 0, 0.3), fill: true, w: 0 }];
    case 'terminal':
      return [{ d: 'M-0.2 -0.5h0.4l0.1 0.8a0.2 0.2 0 0 1 -0.6 0z', w: 0.06 }, { d: 'M0 -0.5v-0.2', w: 0.04 }];
    case 'velcro':
      return [{ d: 'M-0.5 -0.2h1v0.4h-1z', w: 0.04 }, { d: 'M-0.4 -0.2l0.2 0.4M-0.2 -0.2l0.2 0.4M0 -0.2l0.2 0.4M0.2 -0.2l0.2 0.4', w: 0.025 }];
  }
}
