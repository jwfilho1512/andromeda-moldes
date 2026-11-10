/**
 * Bases de parte de cima: corpo base, manga base, t-shirt, camisa (social masc. / feminina).
 */
import { dist } from '@cad-textil/core';
import { type Base, f1, solve } from './base.js';
import { type P, Outline, along, curveLength, lerpP, makePiece, mid, pt, yAt } from './draft.js';
import type { Medidas } from './medidas.js';
import {
  type Torso,
  type TorsoOpts,
  armholeLength,
  capDirs,
  capLength,
  capPoints,
  neckLengths,
  solveSleeveWidth,
  splitArm,
  torso,
} from './torso.js';

const neg = (p: P): P => pt(-p.x, -p.y);
const genTxt = (m: Medidas) => (m.genero === 'feminino' ? 'feminina' : 'masculina');
const genTxtM = (m: Medidas) => (m.genero === 'feminino' ? 'feminino' : 'masculino');

/* ------------------------------------------------------------------ */
/* Lateral do corpo (com pence de busto marcada, se houver)            */
/* ------------------------------------------------------------------ */

interface SideResult {
  back: P[]; // pontos da lateral das costas, de baixo para cima, terminando antes de U
  front: P[]; // idem frente (ordem de baixo para cima), inclui pontos da pence
  frontDart?: { d1: P; d2: P };
  waistB: P;
  waistF: P;
  hemB?: P;
  hemF?: P;
}

/**
 * Lateral: costas e frente com o MESMO comprimento de costura (a pence de busto é descontada).
 * `waistIn` = quanto entra na cintura; `hemOut` = quanto abre na barra (em relação à linha da axila).
 */
function sides(t: Torso, waistY: number, waistIn: number, opts: { hemY?: number; hemOut?: number; bustDart?: number }): SideResult {
  const U = t.U;
  const waistB = pt(U.x - waistIn, waistY);
  const Lb = dist(U, waistB);
  let front: P[];
  let waistF: P;
  let frontDart: SideResult['frontDart'];
  if (opts.bustDart) {
    const d1 = pt(U.x + 0.15, U.y + 5);
    const d2 = pt(U.x + 0.35, d1.y + opts.bustDart);
    const wx = U.x + waistIn;
    const dy = Math.sqrt(Math.max(0, (Lb - 5) ** 2 - (wx - d2.x) ** 2));
    waistF = pt(wx, d2.y + dy);
    frontDart = { d1, d2 };
    front = [waistF, d2, d1];
  } else {
    waistF = pt(U.x + waistIn, waistY);
    front = [waistF];
  }
  const res: SideResult = { back: [waistB], front, waistB, waistF, frontDart };
  if (opts.hemY !== undefined) {
    const hemB = pt(U.x + (opts.hemOut ?? 0), opts.hemY);
    const v = pt(hemB.x - waistB.x, hemB.y - waistB.y);
    const hemF = pt(waistF.x - v.x, waistF.y + v.y); // espelho → mesmo comprimento
    res.hemB = hemB;
    res.hemF = hemF;
    res.back = [hemB, waistB];
    res.front = [hemF, ...front];
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* Manga de uma peça                                                   */
/* ------------------------------------------------------------------ */

interface SleeveOpts {
  id: string;
  name: string;
  armhole: number;
  ease: number;
  capRatio: number;
  length: number;
  wristW: number;
  seam: number;
  hem: number;
  notes: string;
  slit?: boolean; // carcela (camisa)
  pleats?: number; // nº de pregas no punho
}

function sleeve(o: SleeveOpts, group: string) {
  const CH = o.armhole * o.capRatio;
  const W = solveSleeveWidth(o.armhole + o.ease, CH);
  const cap = capPoints(W, CH);
  const L = cap[0]!;
  const R = cap[cap.length - 1]!;
  const cx = W / 2;
  const wl = pt(cx - o.wristW / 2, o.length);
  const wr = pt(cx + o.wristW / 2, o.length);
  const outline = new Outline(L, 'L')
    .curve(cap.slice(1), { startDir: capDirs.start, endDir: capDirs.end })
    .mark('R')
    .line(wr)
    .line(wl, o.hem)
    .close();
  const elbowY = CH + (o.length - CH) * 0.48;
  const internals: { pts: P[] }[] = [];
  if (o.length > 35) {
    const xl = L.x + ((wl.x - L.x) * (elbowY - L.y)) / (wl.y - L.y);
    const xr = R.x + ((wr.x - R.x) * (elbowY - R.y)) / (wr.y - R.y);
    internals.push({ pts: [pt(xl, elbowY), pt(xr, elbowY)] });
  }
  const notches: { at?: P; from?: string; cm?: number; dir?: 1 | -1; double?: boolean }[] = [
    { at: pt(cx, 0) },
    { from: 'R', cm: 7 + o.ease * 0.15, dir: -1 },
    { from: 'L', cm: 8 + o.ease * 0.15, dir: 1, double: true },
  ];
  if (o.slit) {
    // Carcela no lado das costas, a 1/4 do punho.
    const sx = wl.x + o.wristW * 0.25;
    internals.push({ pts: [pt(sx, o.length), pt(sx, o.length - 14)] });
    for (let k = 0; k < (o.pleats ?? 0); k++) {
      const a = sx + 3 + k * 4;
      notches.push({ at: pt(a, o.length) }, { at: pt(a + 2.5, o.length) });
    }
  }
  const piece = makePiece(
    {
      id: o.id,
      name: o.name,
      outline,
      seam: o.seam,
      grain: [pt(cx, CH + 3), pt(cx, o.length - 5)],
      quantity: 2,
      cutInPairs: true,
      notches,
      internals,
      notes: o.notes,
    },
    group,
  );
  return { piece, W, CH, capLen: capLength(W, CH) };
}

/* ------------------------------------------------------------------ */
/* Contornos do corpo                                                  */
/* ------------------------------------------------------------------ */

/** Costas: CB (dobra) → barra/cintura → lateral → cava → ombro → decote. */
function backOutline(t: Torso, cbBottom: P, side: SideResult, opts: { hemSeam?: number; cbSeam?: number; hemCurve?: P[] }) {
  const o = new Outline(t.nape).line(cbBottom, opts.cbSeam ?? 0);
  const [first, ...restSide] = side.back;
  if (opts.hemCurve) o.curve([...opts.hemCurve, first!], { seam: opts.hemSeam, startDir: pt(1, 0) });
  else o.line(first!, opts.hemSeam);
  for (const p of restSide) o.line(p);
  o.line(t.U).mark('axila');
  o.curve(t.backArm.pts, { startDir: t.backArm.startDir, endDir: t.backArm.endDir });
  o.line(t.bHNP);
  o.curve(t.backNeck.pts, { startDir: t.backNeck.startDir, endDir: t.backNeck.endDir });
  return o.close();
}

/** Frente: decote CF → CF (dobra) → barra/cintura → lateral → cava → ombro → decote. */
function frontOutline(t: Torso, cfBottom: P, side: SideResult, opts: { hemSeam?: number; cfSeam?: number; hemCurve?: P[]; extension?: number }) {
  const ext = opts.extension ?? 0;
  const top = ext ? pt(t.cfNeck.x + ext, t.cfNeck.y) : t.cfNeck;
  const bottom = ext ? pt(cfBottom.x + ext, cfBottom.y) : cfBottom;
  const o = new Outline(top).line(bottom, opts.cfSeam ?? 0);
  const [first, ...restSide] = side.front;
  if (opts.hemCurve) o.curve([...opts.hemCurve, first!], { seam: opts.hemSeam, startDir: pt(-1, 0) });
  else o.line(first!, opts.hemSeam);
  for (const p of restSide) o.line(p);
  o.line(t.U).mark('axila');
  o.curve(t.frontArm.pts, { startDir: t.frontArm.startDir, endDir: t.frontArm.endDir });
  o.line(t.fHNP);
  o.curve(t.frontNeck.pts, { startDir: t.frontNeck.startDir, endDir: t.frontNeck.endDir });
  return o.close();
}

/** Pence marcada (linhas internas + piques nas pernas). */
function dartMark(legA: P, apex: P, legB: P) {
  return { internal: { pts: [legA, apex, legB] }, notches: [{ at: legA }, { at: legB }] };
}

/** Marca de botão/casa: pequena cruz. */
function buttonMark(c: P, s = 0.6) {
  return [{ pts: [pt(c.x - s, c.y), pt(c.x + s, c.y)] }, { pts: [pt(c.x, c.y - s), pt(c.x, c.y + s)] }];
}

/* ------------------------------------------------------------------ */
/* 1. Corpo base (bloco ajustado até a cintura)                        */
/* ------------------------------------------------------------------ */

export function corpoBase(m: Medidas): Base {
  const fem = m.genero === 'feminino';
  const t = torso(m, { folga: fem ? 10 : 12 });
  const group = `Corpo base ${genTxtM(m)} ${m.tamanho}`;
  const NW = m.alturaCostas;
  const Wq = m.cintura / 4;
  const bDart = fem ? 3 : 0;
  const fDart = fem ? 3.5 : 0;
  // Entrada na cintura para atingir cintura/4 + 1 cm de folga (+ pences).
  const waistIn = fem ? t.sideX - (Wq + 1 + bDart) : 1.5;
  const sd = sides(t, NW, waistIn, { bustDart: fem ? 2.5 : undefined });
  const cfWaist = pt(t.halfW, sd.waistF.y + (fem ? 1 : 0.5));

  const backInt: { pts: P[] }[] = [];
  const backNotches = [{ from: 'axila', cm: 8, dir: 1 as const, double: true }];
  const frontInt: { pts: P[] }[] = [];
  const frontNotches: { at?: P; from?: string; cm?: number; dir?: 1 | -1 }[] = [{ from: 'axila', cm: 7, dir: 1 }];
  if (fem) {
    const c = sd.waistB.x / 2 - 0.5;
    const bd = dartMark(pt(c - bDart / 2, NW), pt(c, t.AD + 2), pt(c + bDart / 2, NW));
    backInt.push(bd.internal);
    const BP = pt(t.halfW - m.separacaoBusto / 2, t.bHNP.y + m.alturaBusto);
    const yw = (x: number) => yAt(sd.waistF, cfWaist, x);
    const fd = dartMark(pt(BP.x - fDart / 2, yw(BP.x - fDart / 2)), pt(BP.x, BP.y + 2.5), pt(BP.x + fDart / 2, yw(BP.x + fDart / 2)));
    const d = sd.frontDart!;
    const sideApex = along(BP, mid(d.d1, d.d2), 2.5);
    frontInt.push(fd.internal, { pts: [d.d1, sideApex, d.d2] }, ...buttonMark(BP, 0.8));
    for (const n of [...bd.notches]) backNotches.push({ ...n } as never);
    frontNotches.push(...fd.notches, { at: d.d1 }, { at: d.d2 });
  }

  const back = makePiece(
    {
      id: 'costas',
      name: 'Costas',
      outline: backOutline(t, pt(0, NW), sd, {}),
      seam: 10,
      grain: [pt(4, 6), pt(4, NW - 4)],
      quantity: 1,
      cutInPairs: false,
      internals: backInt,
      notches: backNotches,
      notes: 'Cortar 1x na dobra do tecido (centro costas).',
    },
    group,
  );
  const front = makePiece(
    {
      id: 'frente',
      name: 'Frente',
      outline: frontOutline(t, cfWaist, sd, {}),
      seam: 10,
      grain: [pt(t.halfW - 5, t.cfNeck.y + 4), pt(t.halfW - 5, cfWaist.y - 4)],
      quantity: 1,
      cutInPairs: false,
      internals: frontInt,
      notches: frontNotches,
      notes: fem
        ? 'Cortar 1x na dobra do tecido (centro frente). Pences de busto (lateral) e de cintura marcadas; ápice do busto indicado pela cruz.'
        : 'Cortar 1x na dobra do tecido (centro frente).',
    },
    group,
  );
  const nk = neckLengths(t);
  const A = armholeLength(t.U, t.backArm) + armholeLength(t.U, t.frontArm);
  return {
    id: `corpo-base-${m.genero}`,
    nome: `Corpo base ${genTxtM(m)}`,
    genero: m.genero,
    tamanho: m.tamanho,
    categoria: 'Blocos',
    descricao: fem
      ? 'Bloco base ajustado até a cintura, com pence de busto lateral e pences de cintura. Ponto de partida para blusas, vestidos e casacos.'
      : 'Bloco base masculino até a cintura, sem pences. Ponto de partida para camisas, camisetas e paletós.',
    tecido: 'Plano (tela de algodão para prova).',
    aviamentos: [],
    folgas: [`Busto/tórax: ${fem ? 10 : 12} cm no total`, `Cintura: ${fem ? '4 cm' : 'reta, 1,5 cm de ajuste por lateral'}`],
    margens: ['Costuras: 1,0 cm', 'Centro frente e centro costas: na dobra (sem margem)'],
    conferencias: [
      `Lateral costas ${f1(dist(t.U, sd.waistB))} cm = frente ${f1(sd.frontDart ? dist(t.U, sd.frontDart.d1) + dist(sd.frontDart.d2, sd.waistF) : dist(t.U, sd.waistF))} cm${fem ? ' (pence de busto de 2,5 cm descontada)' : ''}`,
      `Cava total: ${f1(A)} cm`,
      `Decote total: ${f1(nk.total)} cm`,
      `Ombro costas ${f1(dist(t.bHNP, t.bSP))} cm × frente ${f1(dist(t.fHNP, t.fSP))} cm (0,5 cm de embebimento)`,
    ],
    medidas: m,
    pecas: [back, front],
  };
}

/* ------------------------------------------------------------------ */
/* 2. Manga base                                                       */
/* ------------------------------------------------------------------ */

export function mangaBase(m: Medidas): Base {
  const fem = m.genero === 'feminino';
  const t = torso(m, { folga: fem ? 10 : 12 });
  const A = armholeLength(t.U, t.backArm) + armholeLength(t.U, t.frontArm);
  const group = `Manga base ${genTxtM(m)} ${m.tamanho}`;
  const ease = fem ? 2 : 1.5;
  const s = sleeve(
    {
      id: 'manga',
      name: 'Manga',
      armhole: A,
      ease,
      capRatio: fem ? 0.33 : 0.31,
      length: m.comprimentoBraco,
      wristW: m.punho + (fem ? 8 : 9),
      seam: 10,
      hem: 30,
      notes: 'Cortar 1 par. Pique simples = frente; pique duplo = costas; pique no topo = costura do ombro.',
    },
    group,
  );
  return {
    id: `manga-base-${m.genero}`,
    nome: `Manga base ${genTxtM(m)}`,
    genero: m.genero,
    tamanho: m.tamanho,
    categoria: 'Blocos',
    descricao: 'Manga longa de uma peça, cabeça calculada sobre a cava do corpo base (mesmo tamanho).',
    tecido: 'Plano.',
    aviamentos: [],
    folgas: [`Embebimento da cabeça: ${f1(ease)} cm`, `Largura da manga: ${f1(s.W)} cm (braço ${f1(m.braco)} cm → folga ${f1(s.W - m.braco)} cm)`],
    margens: ['Costuras: 1,0 cm', 'Barra: 3,0 cm'],
    conferencias: [`Cava do corpo base: ${f1(A)} cm`, `Cabeça da manga: ${f1(s.capLen)} cm`, `Altura da cabeça: ${f1(s.CH)} cm`],
    medidas: m,
    pecas: [s.piece],
  };
}

/* ------------------------------------------------------------------ */
/* 3. T-shirt (malha)                                                  */
/* ------------------------------------------------------------------ */

export function tshirt(m: Medidas): Base {
  const fem = m.genero === 'feminino';
  const opts: TorsoOpts = fem
    ? { folga: 6, baixarCava: 1.5, prolongarOmbro: 1.5, alargarDecote: 1.5, aprofundarDecote: 2, suavizarOmbro: 3 }
    : { folga: 10, baixarCava: 2, prolongarOmbro: 2, alargarDecote: 1.5, aprofundarDecote: 1.5, suavizarOmbro: 3 };
  const t = torso(m, opts);
  const group = `T-shirt ${genTxt(m)} ${m.tamanho}`;
  const L = fem ? 62 : 72;
  const NW = m.alturaCostas;
  const sd = sides(t, NW, fem ? 1.5 : 0, { hemY: L, hemOut: fem ? 1 : 0 });
  const SEAM = 7; // overloque
  const HEM = 25; // galoneira
  const back = makePiece(
    {
      id: 'costas',
      name: 'Costas',
      outline: backOutline(t, pt(0, L), sd, { hemSeam: HEM }),
      seam: SEAM,
      grain: [pt(5, 8), pt(5, L - 8)],
      quantity: 1,
      cutInPairs: false,
      notches: [{ at: sd.waistB }],
      notes: 'Cortar 1x na dobra (centro costas). Barra 2,5 cm em galoneira.',
    },
    group,
  );
  const front = makePiece(
    {
      id: 'frente',
      name: 'Frente',
      outline: frontOutline(t, pt(t.halfW, L), sd, { hemSeam: HEM }),
      seam: SEAM,
      grain: [pt(t.halfW - 5, t.cfNeck.y + 4), pt(t.halfW - 5, L - 8)],
      quantity: 1,
      cutInPairs: false,
      notches: [{ at: sd.waistF }],
      notes: 'Cortar 1x na dobra (centro frente). Barra 2,5 cm em galoneira.',
    },
    group,
  );
  const A = armholeLength(t.U, t.backArm) + armholeLength(t.U, t.frontArm);
  const capRatio = fem ? 0.24 : 0.22;
  const sleeveW = solveSleeveWidth(A, A * capRatio);
  const sl2 = sleeve(
    { id: 'manga', name: 'Manga curta', armhole: A, ease: 0, capRatio, length: fem ? 16 : 22, wristW: sleeveW - 3, seam: SEAM, hem: HEM, notes: 'Cortar 1 par. Malha: cabeça sem embebimento. Barra 2,5 cm.' },
    group,
  );
  const nk = neckLengths(t);
  const ribLen = nk.total * 0.85;
  const rib = makePiece(
    {
      id: 'ribana',
      name: 'Ribana da gola',
      outline: new Outline(pt(0, 0)).line(pt(ribLen, 0)).line(pt(ribLen, 4)).line(pt(0, 4)).close(),
      seam: SEAM,
      grain: [pt(ribLen / 2, 0.8), pt(ribLen / 2, 3.2)],
      quantity: 1,
      cutInPairs: false,
      internals: [{ pts: [pt(0, 2), pt(ribLen, 2)] }],
      notes: `Ribana 1x1, fio no sentido da altura. Dobrar ao meio (2 cm acabado). Comprimento = 85% do decote (${f1(nk.total)} cm).`,
    },
    group,
  );
  return {
    id: `tshirt-${m.genero}`,
    nome: `T-shirt ${genTxt(m)}`,
    genero: m.genero,
    tamanho: m.tamanho,
    categoria: 'Malharia',
    descricao: `Camiseta básica de malha, gola careca com ribana, manga curta. Comprimento ${L} cm (nuca à barra).`,
    tecido: 'Malha meia-malha 100% algodão (30/1) ou PV; ribana 1x1 para a gola.',
    aviamentos: ['Linha para overloque e galoneira'],
    folgas: [`Tórax/busto: ${opts.folga} cm no total`, `Cava rebaixada ${opts.baixarCava} cm`, `Ombro prolongado ${opts.prolongarOmbro} cm`],
    margens: ['Costuras: 0,7 cm (overloque)', 'Barras: 2,5 cm (galoneira)', 'Centro frente/costas: na dobra'],
    conferencias: [`Cava: ${f1(A)} cm × cabeça da manga: ${f1(sl2.capLen)} cm`, `Decote total: ${f1(nk.total)} cm → ribana ${f1(ribLen)} cm`],
    medidas: m,
    pecas: [back, front, sl2.piece, rib],
  };
}

/* ------------------------------------------------------------------ */
/* 4. Camisa (social masculina / feminina)                             */
/* ------------------------------------------------------------------ */

/** Pé de colarinho/gola (metade, na dobra do centro costas). */
function collarStand(halfNeck: number, backNeck: number, h: number, ext: number, group: string) {
  const rise = 1.2;
  // Ajusta o comprimento horizontal para que a borda de baixo meça exatamente metade do decote.
  const bottomPts = (x: number) => [pt(x * 0.5, h - 0.15), pt(x, h - rise)];
  const span = solve((x) => curveLength([pt(0, h), ...bottomPts(x)], pt(1, 0)), halfNeck, halfNeck * 0.7, halfNeck * 1.2);
  const cf = pt(span, h - rise);
  const endBottom = pt(span + ext, h - rise - 0.5);
  const endTop = pt(span + ext - 0.8, -0.9);
  const o = new Outline(pt(0, 0))
    .line(pt(0, h), 0)
    .mark('cbBaixo')
    .curve(bottomPts(span), { startDir: pt(1, 0) })
    .curve([endBottom])
    .curve([pt(span + ext + 0.1, h * 0.35), endTop], { endDir: pt(-1, -0.3) })
    .curve([pt(span * 0.5, -0.25), pt(0, 0)], { endDir: pt(-1, 0) })
    .close();
  return makePiece(
    {
      id: 'pe-colarinho',
      name: 'Pé de colarinho',
      outline: o,
      seam: 10,
      grain: [pt(span * 0.3, h * 0.5), pt(span * 0.7, h * 0.5)],
      quantity: 2,
      cutInPairs: false,
      notches: [{ at: cf }, { from: 'cbBaixo', cm: backNeck, dir: 1 }],
      notes: 'Cortar 2x na dobra (externo e interno) + 1x entretela. Piques: ombro e centro frente.',
    },
    group,
  );
}

function collar(halfNeck: number, h: number, group: string) {
  const len = halfNeck + 0.3;
  const o = new Outline(pt(0, 0))
    .line(pt(0, h), 0)
    .curve([pt(len * 0.6, h - 0.2), pt(len, h - 0.9)], { startDir: pt(1, 0) })
    .line(pt(len + 1.6, -2.4))
    .curve([pt(len * 0.6, -0.5), pt(0, 0)], { endDir: pt(-1, 0) })
    .close();
  return makePiece(
    {
      id: 'colarinho',
      name: 'Colarinho / gola',
      outline: o,
      seam: 10,
      grain: [pt(len * 0.3, h * 0.5), pt(len * 0.7, h * 0.5)],
      quantity: 2,
      cutInPairs: false,
      notes: 'Cortar 2x na dobra (externo e interno) + 1x entretela.',
    },
    group,
  );
}

export function camisa(m: Medidas): Base {
  const fem = m.genero === 'feminino';
  const opts: TorsoOpts = fem
    ? { folga: 10, baixarCava: 1.5, prolongarOmbro: 0.5, alargarDecote: 0.5 }
    : { folga: 18, baixarCava: 2, prolongarOmbro: 1.5, alargarDecote: 0.5, suavizarOmbro: 2 };
  const YOKE = 8;
  // Ponto da pala sobre a cava (só masculina).
  const t0 = torso(m, opts);
  const axb = t0.backArm.pts[t0.backArm.named.AXB!]!;
  const yaX = axb.x + ((t0.bSP.x - axb.x) * (axb.y - YOKE)) / (axb.y - t0.bSP.y) + 0.25;
  const t = fem ? t0 : torso(m, opts, { back: { Ya: pt(yaX, YOKE) } });
  const group = `Camisa ${fem ? 'feminina' : 'social masculina'} ${m.tamanho}`;
  const L = fem ? 64 : 80;
  const NW = m.alturaCostas;
  const HEM = 10;
  const pecas = [];
  const conf: string[] = [];

  let sd: SideResult;
  if (fem) {
    sd = sides(t, NW, 2, { hemY: L, hemOut: 1, bustDart: 2.5 });
  } else {
    sd = sides(t, NW, 0, { hemY: L - 7, hemOut: 0 });
  }
  const ext = fem ? 1.5 : 1.75; // transpasse
  const facing = fem ? 3 : 3.5; // vista dobrada
  const frontEdgeX = t.halfW + ext + facing;

  // ---------- Costas (+ pala na masculina) ----------
  if (fem) {
    const c = sd.waistB.x / 2;
    pecas.push(
      makePiece(
        {
          id: 'costas',
          name: 'Costas',
          outline: backOutline(t, pt(0, L), sd, { hemSeam: HEM }),
          seam: 10,
          grain: [pt(5, 8), pt(5, L - 8)],
          quantity: 1,
          cutInPairs: false,
          internals: [{ pts: [pt(c, t.AD + 3), pt(c - 1.25, NW), pt(c, NW + 10), pt(c + 1.25, NW)], closed: true }],
          notches: [{ from: 'axila', cm: 8, dir: 1, double: true }, { at: sd.waistB }],
          notes: 'Cortar 1x na dobra (centro costas). Pence de cintura (losango) marcada.',
        },
        group,
      ),
    );
  } else {
    const sp = splitArm(t.U, t.backArm, 'Ya');
    const Y0 = pt(0, YOKE);
    const hemCurveB = [pt(9, L - 0.3), pt(t.sideX - 6, L - 4.6)];
    const backO = new Outline(Y0)
      .line(pt(0, L), 0)
      .curve([...hemCurveB, sd.hemB!], { seam: HEM, startDir: pt(1, 0), endDir: pt(1, -0.55) })
      .line(t.U)
      .mark('axila')
      .curve(sp.lower.through, { startDir: sp.lower.startDir, endDir: sp.lower.endDir })
      .close();
    pecas.push(
      makePiece(
        {
          id: 'costas',
          name: 'Costas',
          outline: backO,
          seam: 10,
          grain: [pt(5, YOKE + 5), pt(5, L - 8)],
          quantity: 1,
          cutInPairs: false,
          notches: [{ from: 'axila', cm: 8, dir: 1, double: true }, { at: pt(0, YOKE + 0.01) }],
          notes: 'Cortar 1x na dobra (centro costas). Opcional: prega macho de 2 × 1,5 cm no centro costas (acrescentar 3 cm na dobra).',
        },
        group,
      ),
    );
    const yokeO = new Outline(Y0)
      .line(sp.point)
      .curve(sp.upper.through, { startDir: sp.upper.startDir, endDir: sp.upper.endDir })
      .line(t.bHNP)
      .curve(t.backNeck.pts, { startDir: t.backNeck.startDir, endDir: t.backNeck.endDir })
      .close(0);
    pecas.push(
      makePiece(
        {
          id: 'pala',
          name: 'Pala',
          outline: yokeO,
          seam: 10,
          grain: [pt(3, 1), pt(3, YOKE - 1.5)],
          quantity: 2,
          cutInPairs: false,
          notes: 'Cortar 2x na dobra (pala externa e interna). Fio no sentido do comprimento do corpo.',
        },
        group,
      ),
    );
  }

  // ---------- Frente ----------
  const cfBottom = fem ? pt(t.halfW, sd.hemF!.y + 1) : pt(t.halfW, L - 2);
  const hemCurveF = fem ? undefined : [pt(t.halfW - 6, L - 2.5), pt(t.sideX + 6, L - 4.6)];
  const frontO = (() => {
    const top = pt(frontEdgeX, t.cfNeck.y);
    const bottom = pt(frontEdgeX, cfBottom.y);
    const o = new Outline(top).line(bottom);
    const [first, ...rest] = sd.front;
    if (hemCurveF) o.curve([...hemCurveF, first!], { seam: HEM, startDir: pt(-1, 0), endDir: pt(-1, -0.55) });
    else o.line(first!, HEM);
    for (const p of rest) o.line(p);
    o.line(t.U).mark('axila');
    o.curve(t.frontArm.pts, { startDir: t.frontArm.startDir, endDir: t.frontArm.endDir });
    o.line(t.fHNP);
    o.curve(t.frontNeck.pts, { startDir: t.frontNeck.startDir, endDir: t.frontNeck.endDir });
    return o.close();
  })();
  const nButtons = fem ? 6 : 6;
  const firstBtn = t.cfNeck.y + (fem ? 7 : 7.5);
  const spacing = fem ? 8.5 : 9.5;
  const frontInt: { pts: P[] }[] = [
    { pts: [pt(t.halfW, t.cfNeck.y), pt(t.halfW, cfBottom.y)] }, // centro frente
    { pts: [pt(t.halfW + ext, t.cfNeck.y), pt(t.halfW + ext, cfBottom.y)] }, // dobra da vista
  ];
  for (let k = 0; k < nButtons; k++) frontInt.push(...buttonMark(pt(t.halfW, firstBtn + k * spacing)));
  const frontNotches: { at?: P; from?: string; cm?: number; dir?: 1 | -1 }[] = [{ from: 'axila', cm: 7, dir: 1 }];
  if (fem) {
    const BP = pt(t.halfW - m.separacaoBusto / 2, t.bHNP.y + m.alturaBusto);
    const d = sd.frontDart!;
    frontInt.push({ pts: [d.d1, along(BP, mid(d.d1, d.d2), 3), d.d2] });
    frontNotches.push({ at: d.d1 }, { at: d.d2 }, { at: sd.waistF });
  }
  pecas.push(
    makePiece(
      {
        id: 'frente',
        name: 'Frente',
        outline: frontO,
        seam: 10,
        grain: [pt(t.halfW - 8, t.cfNeck.y + 5), pt(t.halfW - 8, cfBottom.y - 8)],
        quantity: 2,
        cutInPairs: true,
        internals: frontInt,
        notches: frontNotches,
        notes: `Cortar 1 par. Transpasse ${f1(ext)} cm + vista dobrada ${f1(facing)} cm (linhas internas: centro frente e dobra). ${nButtons} botões no corpo + 1 no pé de colarinho, espaçamento ${f1(spacing)} cm.`,
      },
      group,
    ),
  );

  // ---------- Manga ----------
  const A = armholeLength(t.U, t.backArm) + armholeLength(t.U, t.frontArm);
  const cuffH = fem ? 5 : 6.5;
  const cuffLen = m.punho + (fem ? 5 : 6) + 2;
  const pleats = 2;
  const sl = sleeve(
    {
      id: 'manga',
      name: 'Manga',
      armhole: A,
      ease: fem ? 1 : 0.5,
      capRatio: fem ? 0.28 : 0.26,
      length: m.comprimentoBraco + (fem ? 2 : 3) - cuffH,
      wristW: cuffLen - 2 + pleats * 2.5 + 1,
      seam: 10,
      hem: 10,
      slit: true,
      pleats,
      notes: `Cortar 1 par. Carcela de 14 cm no lado das costas; ${pleats} pregas de 2,5 cm no punho.`,
    },
    group,
  );
  pecas.push(sl.piece);
  conf.push(`Cava: ${f1(A)} cm × cabeça da manga: ${f1(sl.capLen)} cm`);

  // ---------- Punho ----------
  pecas.push(
    makePiece(
      {
        id: 'punho',
        name: 'Punho',
        outline: new Outline(pt(0, 0)).line(pt(cuffLen, 0)).line(pt(cuffLen, cuffH)).line(pt(0, cuffH)).close(),
        seam: 10,
        grain: [pt(cuffLen * 0.25, cuffH / 2), pt(cuffLen * 0.75, cuffH / 2)],
        quantity: 4,
        cutInPairs: false,
        internals: buttonMark(pt(1.5, cuffH / 2), 0.5),
        notes: `Cortar 4x (2 externos + 2 internos) + 2x entretela. ${f1(cuffLen)} × ${f1(cuffH)} cm acabado (punho ${f1(m.punho)} cm + folga + transpasse 2 cm).`,
      },
      group,
    ),
  );

  // ---------- Colarinho ----------
  const nk = neckLengths(t);
  const halfNeck = nk.back + nk.front;
  pecas.push(collarStand(halfNeck, nk.back, fem ? 3 : 3.2, ext, group));
  pecas.push(collar(halfNeck, fem ? 4 : 4.5, group));
  conf.push(`Decote total: ${f1(nk.total)} cm (metade ${f1(halfNeck)} cm = base do pé de colarinho)`);

  return {
    id: `camisa-${m.genero}`,
    nome: fem ? 'Camisa feminina' : 'Camisa social masculina',
    genero: m.genero,
    tamanho: m.tamanho,
    categoria: 'Camisaria',
    descricao: fem
      ? `Camisa feminina com pence de busto e pences de cintura, vista dobrada, gola com pé, manga longa com punho. Comprimento ${L} cm.`
      : `Camisa social com pala, frente com vista dobrada, colarinho com pé, manga longa com carcela e punho. Comprimento ${L} cm (centro costas), fralda arredondada.`,
    tecido: 'Tricoline 100% algodão ou misto (plano).',
    aviamentos: [`${nButtons + 1 + 2} botões de 10–11 mm`, 'Entretela termocolante para colarinho, pé e punhos', 'Linha 120'],
    folgas: [`Busto/tórax: ${opts.folga} cm no total`, `Cava rebaixada ${opts.baixarCava} cm`, `Embebimento da manga: ${fem ? '1,0' : '0,5'} cm`],
    margens: ['Costuras: 1,0 cm', 'Barra: 1,0 cm (bainha de 2 × 0,5 cm)', 'Centro costas e pala: na dobra'],
    conferencias: conf,
    medidas: m,
    pecas,
  };
}

void lerpP;
