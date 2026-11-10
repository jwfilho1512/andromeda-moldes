import { type Piece, v } from '../src/index.js';

/** Molde de exemplo: frente de saia reta, cintura curva, 0–quadril com curva Bézier (mm). */
export function sampleSkirtFront(): Piece {
  return {
    id: 'saia-frente',
    name: 'Saia Frente',
    outline: {
      start: v(0, 0),
      segments: [
        { kind: 'line', to: v(260, 0) }, // barra
        { kind: 'line', to: v(260, 420) }, // lateral reta até o quadril
        { kind: 'cubic', c1: v(260, 500), c2: v(245, 560), to: v(235, 600) }, // curva do quadril
        { kind: 'cubic', c1: v(160, 590), c2: v(80, 585), to: v(0, 585) }, // cintura curva
        { kind: 'line', to: v(0, 0) }, // centro da frente (fechamento)
      ],
      closed: true,
    },
    seamAllowanceMm: 10,
    internals: [
      // Pence de cintura
      { start: v(90, 587), segments: [{ kind: 'line', to: v(100, 480) }, { kind: 'line', to: v(110, 588) }], closed: false },
    ],
    grainline: [v(130, 80), v(130, 400)],
    notches: [
      { edge: 1, t: 1, depthMm: 5 }, // linha do quadril
      { edge: 4, t: 300 / 585, depthMm: 5 }, // centro frente
    ],
    quantity: 1,
    cutInPairs: false,
  };
}
