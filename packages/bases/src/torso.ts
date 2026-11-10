/**
 * Armação do torso (meio corpo: costas à esquerda, frente à direita, lado a lado) e manga.
 * Coordenadas de traçado em cm, Y para baixo; nuca no ponto (0,0); centro frente em x = meiaLargura.
 */
import type { Medidas } from './medidas.js';
import { type P, curveLength, pt, smoothSegments } from './draft.js';
import { flattenWithEdges } from '@cad-textil/core';

const rad = (d: number) => (d * Math.PI) / 180;

export interface TorsoOpts {
  /** Folga total no busto/tórax (cm). */
  folga: number;
  baixarCava?: number;
  prolongarOmbro?: number;
  alargarDecote?: number;
  aprofundarDecote?: number;
  /** Reduz a inclinação do ombro em graus (malha, ombro caído). */
  suavizarOmbro?: number;
}

export interface Armhole {
  /** Pontos de passagem a partir da axila (U) até a ponta do ombro (inclusive). */
  pts: P[];
  /** Índices nomeados em `pts` (para dividir a cava em recortes). */
  named: Record<string, number>;
  startDir: P;
  endDir: P;
}

export interface Torso {
  m: Medidas;
  fem: boolean;
  halfW: number;
  sideX: number;
  AD: number;
  nape: P;
  bHNP: P;
  bSP: P;
  fHNP: P;
  fSP: P;
  cfNeck: P;
  U: P;
  backArm: Armhole;
  frontArm: Armhole;
  backNeck: { pts: P[]; startDir: P; endDir: P };
  frontNeck: { pts: P[]; startDir: P; endDir: P };
  thB: number;
  thF: number;
}

export function torso(m: Medidas, o: TorsoOpts, extraArmPoints: { back?: Record<string, P>; front?: Record<string, P> } = {}): Torso {
  const fem = m.genero === 'feminino';
  const halfW = (m.busto + o.folga) / 2;
  const sideX = halfW / 2;
  const AD = m.profundidadeCava + (o.baixarCava ?? 0);
  const ext = o.prolongarOmbro ?? 0;
  const rise = fem ? 2.0 : 2.2;
  const thB = (fem ? 18 : 17) - (o.suavizarOmbro ?? 0);
  const thF = (fem ? 22 : 20) - (o.suavizarOmbro ?? 0);

  const nape = pt(0, 0);
  const bHNP = pt(m.pescoco / 5 - 0.2 + (o.alargarDecote ?? 0), -rise);
  const bShoulder = m.ombro + 0.5 + ext; // 0,5 cm de embebimento no ombro das costas
  const fShoulder = m.ombro + ext;
  const bSP = pt(bHNP.x + bShoulder * Math.cos(rad(thB)), bHNP.y + bShoulder * Math.sin(rad(thB)));
  const fHNP = pt(halfW - (m.pescoco / 5 - 0.7 + (o.alargarDecote ?? 0)), -rise);
  const fSP = pt(fHNP.x - fShoulder * Math.cos(rad(thF)), fHNP.y + fShoulder * Math.sin(rad(thF)));
  const cfNeck = pt(halfW, -rise + m.pescoco / 5 + (fem ? 1 : 0.5) + (o.aprofundarDecote ?? 0));

  // Com ombro prolongado (malha, ombreira), a largura de costas/frente acompanha o prolongamento.
  const extW = ext >= 1.5 ? ext : ext * 0.7;
  const axb = m.larguraCostas / 2 + 0.5 + extW;
  const fcx = halfW - m.larguraFrente / 2 - 0.5 - extW;
  const U = pt(sideX, AD);
  const kb = fem ? 2.5 : 3.0;
  const kf = fem ? 2.0 : 2.5;
  const Kb = pt(axb + kb * Math.SQRT1_2, AD - kb * Math.SQRT1_2);
  const Kf = pt(fcx - kf * Math.SQRT1_2, AD - kf * Math.SQRT1_2);
  const AXB = pt(axb, AD * 0.5);
  const FC = pt(fcx, AD * 0.45);

  // Cava das costas: U → Kb → [extras] → AXB → [extras acima] → ombro
  const backList: [string, P][] = [['Kb', Kb], ['AXB', AXB], ...Object.entries(extraArmPoints.back ?? {})];
  backList.sort((a, b) => b[1].y - a[1].y); // de baixo para cima
  const frontList: [string, P][] = [['Kf', Kf], ['FC', FC], ...Object.entries(extraArmPoints.front ?? {})];
  frontList.sort((a, b) => b[1].y - a[1].y);

  const backArm: Armhole = {
    pts: [...backList.map((e) => e[1]), bSP],
    named: Object.fromEntries(backList.map((e, i) => [e[0], i])),
    startDir: pt(-1, 0),
    endDir: pt(Math.sin(rad(thB)), -Math.cos(rad(thB))),
  };
  const frontArm: Armhole = {
    pts: [...frontList.map((e) => e[1]), fSP],
    named: Object.fromEntries(frontList.map((e, i) => [e[0], i])),
    startDir: pt(1, 0),
    endDir: pt(-Math.sin(rad(thF)), -Math.cos(rad(thF))),
  };

  return {
    m, fem, halfW, sideX, AD, nape, bHNP, bSP, fHNP, fSP, cfNeck, U, backArm, frontArm, thB, thF,
    backNeck: { pts: [nape], startDir: pt(-Math.sin(rad(thB)), Math.cos(rad(thB))), endDir: pt(-1, 0) },
    frontNeck: { pts: [cfNeck], startDir: pt(Math.sin(rad(thF)), Math.cos(rad(thF))), endDir: pt(1, 0) },
  };
}

/** Tangente de passagem num ponto interno da cava (para dividir sem quebrar a curva). */
export function armTangent(U: P, arm: Armhole, idx: number): P {
  const all = [U, ...arm.pts];
  const i = idx + 1;
  return pt(all[i + 1]!.x - all[i - 1]!.x, all[i + 1]!.y - all[i - 1]!.y);
}

export function armholeLength(U: P, arm: Armhole): number {
  return curveLength([U, ...arm.pts], arm.startDir, arm.endDir);
}

/** Divide a cava no ponto nomeado: parte de baixo (U → ponto) e de cima (ponto → ombro). */
export function splitArm(U: P, arm: Armhole, name: string) {
  const idx = arm.named[name];
  if (idx === undefined) throw new Error(`Ponto de cava "${name}" não existe`);
  const tan = armTangent(U, arm, idx);
  return {
    point: arm.pts[idx]!,
    lower: { through: arm.pts.slice(0, idx + 1), startDir: arm.startDir, endDir: tan },
    upper: { through: arm.pts.slice(idx + 1), startDir: tan, endDir: arm.endDir },
  };
}

export function neckLengths(t: Torso) {
  const back = curveLength([t.bHNP, ...t.backNeck.pts], t.backNeck.startDir, t.backNeck.endDir);
  const front = curveLength([t.fHNP, ...t.frontNeck.pts], t.frontNeck.startDir, t.frontNeck.endDir);
  return { back, front, total: 2 * (back + front) };
}

/* ------------------------------------------------------------------ */
/* Manga                                                               */
/* ------------------------------------------------------------------ */

// Forma da cabeça da manga em frações (x/largura, y/altura a partir do topo), costas à esquerda.
const CAP_SHAPE: [number, number][] = [
  [0.08, 0.86], [0.2, 0.55], [0.33, 0.2], [0.5, 0], [0.67, 0.21], [0.8, 0.6], [0.93, 0.9],
];
// Na axila a cabeça chega quase horizontal (como a cava encontra a lateral).
const CAP_START = pt(1, -0.12);
const CAP_END = pt(1, 0.12);

export function capPoints(W: number, CH: number): P[] {
  return [pt(0, CH), ...CAP_SHAPE.map(([fx, fy]) => pt(fx * W, fy * CH)), pt(W, CH)];
}

export function capLength(W: number, CH: number): number {
  return curveLength(capPoints(W, CH), CAP_START, CAP_END);
}

export const capDirs = { start: CAP_START, end: CAP_END };

/** Encontra a largura da manga para que a cabeça meça exatamente `target` cm. */
export function solveSleeveWidth(target: number, CH: number): number {
  let lo = 5, hi = 120;
  for (let i = 0; i < 60; i++) {
    const midW = (lo + hi) / 2;
    if (capLength(midW, CH) < target) lo = midW;
    else hi = midW;
  }
  return (lo + hi) / 2;
}

/** Amostra a cabeça da manga (polilinha densa) para recortes de manga 2 partes. */
export function capPolyline(W: number, CH: number): P[] {
  const pts = capPoints(W, CH);
  return flattenWithEdges({ start: pts[0]!, segments: smoothSegments(pts, CAP_START, CAP_END), closed: false }, 0.001).points;
}
