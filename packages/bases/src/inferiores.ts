/**
 * Bases de parte de baixo: saia reta, calça (feminina / social masculina), bermuda.
 */
import { dist, normalize } from '@cad-textil/core';
import { type Base, f1, solve } from './base.js';
import { type P, Outline, curveLength, lerpP, makePiece, mid, pt, yAt } from './draft.js';
import type { Medidas } from './medidas.js';

const add = (a: P, b: P, k = 1): P => pt(a.x + b.x * k, a.y + b.y * k);
const dirTo = (a: P, b: P) => normalize(pt(b.x - a.x, b.y - a.y));

/** Cós retangular com piques nas laterais e centros. */
function waistband(id: string, total: number, finished: number, overlap: number, marks: number[], notes: string, group: string) {
  const h = finished * 2;
  return makePiece(
    {
      id,
      name: 'Cós',
      outline: new Outline(pt(0, 0)).line(pt(total, 0)).line(pt(total, h)).line(pt(0, h)).close(),
      seam: 10,
      grain: [pt(total * 0.3, h / 2), pt(total * 0.7, h / 2)],
      quantity: 1,
      cutInPairs: false,
      internals: [{ pts: [pt(0, finished), pt(total, finished)] }],
      notches: marks.map((x) => ({ at: pt(overlap + x, h) })),
      notes,
    },
    group,
  );
}

/* ------------------------------------------------------------------ */
/* Saia reta                                                           */
/* ------------------------------------------------------------------ */

export function saiaReta(m: Medidas): Base {
  const group = `Saia reta ${m.tamanho}`;
  const Hq = m.quadril / 4 + 1;
  const hipY = m.alturaQuadril;
  const L = 60;
  const dB = 3;
  const dF = 2;
  const sideCurve = (sw: P) => [pt(Hq - 0.5, sw.y + (hipY - sw.y) * 0.5), pt(Hq, hipY)];

  // Costas
  const CBw = pt(0, 1);
  const SWb = pt(m.cintura / 4 + 0.5 + dB, -1.2);
  const waistB = [pt(SWb.x * 0.6, 0.6), SWb];
  const cB = SWb.x * 0.45;
  const legYB = (x: number) => yAt(CBw, SWb, x);
  const back = makePiece(
    {
      id: 'costas',
      name: 'Saia costas',
      outline: new Outline(CBw)
        .curve(waistB, { startDir: pt(1, 0) })
        .curve(sideCurve(SWb), { endDir: pt(0, 1) })
        .line(pt(Hq - 1, L))
        .line(pt(0, L), 40)
        .close(15),
      seam: 10,
      grain: [pt(6, 6), pt(6, L - 6)],
      quantity: 2,
      cutInPairs: true,
      internals: [{ pts: [pt(cB - dB / 2, legYB(cB - dB / 2)), pt(cB, 14), pt(cB + dB / 2, legYB(cB + dB / 2))] }, { pts: [pt(0, hipY), pt(Hq, hipY)] }],
      notches: [{ at: pt(Hq, hipY) }, { at: pt(0, 19) }, { at: pt(cB - dB / 2, legYB(cB - dB / 2)) }, { at: pt(cB + dB / 2, legYB(cB + dB / 2)) }],
      notes: 'Cortar 1 par. Centro costas com zíper invisível de 20 cm (pique a 19 cm do cós) e margem de 1,5 cm. Opcional: fenda de 18 cm no centro costas.',
    },
    group,
  );

  // Frente
  const CFw = pt(0, 0);
  const SWf = pt(m.cintura / 4 + 0.5 + dF, -1.2);
  const waistF = [pt(SWf.x * 0.6, -0.4), SWf];
  const cF = SWf.x * 0.45;
  const legYF = (x: number) => yAt(CFw, SWf, x);
  const front = makePiece(
    {
      id: 'frente',
      name: 'Saia frente',
      outline: new Outline(CFw)
        .curve(waistF, { startDir: pt(1, 0) })
        .curve(sideCurve(SWf), { endDir: pt(0, 1) })
        .line(pt(Hq - 1, L))
        .line(pt(0, L), 40)
        .close(0),
      seam: 10,
      grain: [pt(6, 6), pt(6, L - 6)],
      quantity: 1,
      cutInPairs: false,
      internals: [{ pts: [pt(cF - dF / 2, legYF(cF - dF / 2)), pt(cF, 9), pt(cF + dF / 2, legYF(cF + dF / 2))] }, { pts: [pt(0, hipY), pt(Hq, hipY)] }],
      notches: [{ at: pt(Hq, hipY) }, { at: pt(cF - dF / 2, legYF(cF - dF / 2)) }, { at: pt(cF + dF / 2, legYF(cF + dF / 2)) }],
      notes: 'Cortar 1x na dobra do tecido (centro frente).',
    },
    group,
  );

  const bw = curveLength([CBw, ...waistB], pt(1, 0)) - dB;
  const fw = curveLength([CFw, ...waistF], pt(1, 0)) - dF;
  const total = 2 * (bw + fw) + 3;
  const cos = waistband('cos', total, 3, 3, [0, bw, bw + 2 * fw, 2 * bw + 2 * fw], `Cós ${f1(total)} × 3 cm acabado (cortar 6 cm, dobrado). Transpasse de 3 cm. Piques: centro costas, laterais, centro frente.`, group);

  return {
    id: 'saia-reta-feminino',
    nome: 'Saia reta feminina',
    genero: 'feminino',
    tamanho: m.tamanho,
    categoria: 'Saias',
    descricao: `Saia reta (lápis) até o joelho, ${L} cm de comprimento, cós de 3 cm, pences na frente e nas costas, zíper invisível no centro costas.`,
    tecido: 'Plano médio: sarja, gabardine, alfaiataria leve, linho.',
    aviamentos: ['Zíper invisível 20 cm', '1 colchete ou botão para o cós', 'Entretela para o cós'],
    folgas: ['Quadril: 4 cm no total', 'Cintura: 2 cm no total'],
    margens: ['Costuras: 1,0 cm', 'Centro costas: 1,5 cm', 'Barra: 4,0 cm', 'Centro frente: na dobra'],
    conferencias: [`Cintura acabada (sem pences): ${f1(2 * (bw + fw))} cm (medida ${f1(m.cintura)} cm)`, `Quadril acabado: ${f1(4 * Hq)} cm (medida ${f1(m.quadril)} cm)`],
    medidas: m,
    pecas: [front, back, cos],
  };
}

/* ------------------------------------------------------------------ */
/* Calça / bermuda                                                     */
/* ------------------------------------------------------------------ */

export function calca(m: Medidas, opts: { bermuda?: boolean } = {}): Base {
  const fem = m.genero === 'feminino';
  const tipo = opts.bermuda ? 'Bermuda' : fem ? 'Calça' : 'Calça social';
  const group = `${tipo} ${fem ? 'feminina' : 'masculina'} ${m.tamanho}`;
  const Q = m.quadril;
  const W = m.cintura;
  const hipY = m.alturaQuadril;
  const crotchY = m.alturaGancho + 1;
  const kneeY = m.alturaJoelho;
  const hemY = opts.bermuda ? kneeY - 5 : m.comprimentoCalca - (fem ? 2 : 3);
  const kneeTot = m.joelho + (fem ? 9 : 8);
  const hemTot = fem ? 40 : 42;
  const HEM = opts.bermuda ? 30 : 40;

  // ---------------- Frente ----------------
  const Fh = Q / 4;
  const F = pt(Fh + Q / 16, crotchY);
  const cx = F.x / 2;
  const kf = (kneeTot / 2 - 2) / 2;
  const hf = (hemTot / 2 - 2) / 2;
  const dartF = fem ? 2 : 1.5;
  const CFW = pt(Fh - 1, 0);
  const SW = pt(Math.max(0, CFW.x - (W / 4 + 0.5 + dartF)), 0);
  const H = pt(0, hipY);
  const Ks = pt(cx - kf, kneeY);
  const Ki = pt(cx + kf, kneeY);
  const Hs = pt(cx - hf, m.comprimentoCalca - (fem ? 2 : 3));
  const Hi = pt(cx + hf, Hs.y);
  const dF = fem ? 2.8 : 3;
  const Cf = pt(Fh + dF * Math.SQRT1_2, crotchY - dF * Math.SQRT1_2);
  const PhF = pt(Fh, hipY);

  // Bermuda: corta as linhas laterais/entreperna na altura da barra.
  const onLine = (a: P, b: P, y: number) => lerpP(a, b, (y - a.y) / (b.y - a.y));

  const frontSide = (sw: P) => {
    const o: { pts: P[]; startDir?: P; endDir?: P }[] = [{ pts: [H], endDir: pt(0, 1) }];
    return o;
  };
  void frontSide;

  function legGeometry(K_s: P, K_i: P, H_s: P, H_i: P, fork: P, concave: number) {
    if (opts.bermuda) {
      const s = onLine(pt(0, hipY), K_s, hemY);
      const i = onLine(fork, K_i, hemY);
      return { sidePts: [s], inPts: [i], hemS: s, hemI: i, knee: false };
    }
    const innerMid = add(mid(K_i, fork), pt(-concave, 0));
    return { sidePts: [K_s, H_s], inPts: [H_i, K_i, innerMid], hemS: H_s, hemI: H_i, knee: true, innerMid };
  }

  const legF = legGeometry(Ks, Ki, Hs, Hi, F, 0.5);
  const sideLenOf = (sw: P, hipP: P, g: ReturnType<typeof legGeometry>) => {
    let l = sw.x > 0.05 ? curveLength([sw, hipP], undefined, pt(0, 1)) : dist(sw, hipP);
    if (g.knee) l += curveLength([hipP, g.sidePts[0]!], pt(0, 1), dirTo(g.sidePts[0]!, g.sidePts[1]!)) + dist(g.sidePts[0]!, g.sidePts[1]!);
    else l += dist(hipP, g.hemS);
    return l;
  };
  const inseamLenOf = (g: ReturnType<typeof legGeometry>, fork: P) =>
    g.knee ? dist(g.inPts[0]!, g.inPts[1]!) + curveLength([g.inPts[1]!, g.innerMid!, fork], dirTo(g.inPts[0]!, g.inPts[1]!)) : dist(g.hemI, fork);

  function legOutline(start: P, waistEnd: P, hipP: P, g: ReturnType<typeof legGeometry>, fork: P, crotchThrough: P[], crotchEndDir: P) {
    const o = new Outline(start).line(waistEnd);
    if (waistEnd.x > 0.05) o.curve([hipP], { endDir: pt(0, 1) });
    else o.line(hipP);
    o.mark('quadril');
    if (g.knee) {
      o.curve([g.sidePts[0]!], { startDir: pt(0, 1), endDir: dirTo(g.sidePts[0]!, g.sidePts[1]!) }).mark('joelhoLat');
      o.line(g.sidePts[1]!);
      o.line(g.inPts[0]!, HEM);
      o.line(g.inPts[1]!).mark('joelhoInt');
      o.curve([g.innerMid!, fork], { startDir: dirTo(g.inPts[0]!, g.inPts[1]!) });
    } else {
      o.line(g.hemS);
      o.line(g.hemI, HEM);
      o.line(fork);
    }
    o.mark('gancho');
    o.curve(crotchThrough, { startDir: pt(-1, 0), endDir: crotchEndDir });
    return o.close();
  }

  const frontO = legOutline(CFW, SW, H, legF, F, [Cf, PhF], pt(0, -1));
  const frontInt: { pts: P[] }[] = [{ pts: [pt(cx - (dartF / 2), 0), pt(cx, fem ? 9 : 8), pt(cx + dartF / 2, 0)] }, { pts: [pt(0, hipY), pt(Fh, hipY)] }];
  if (legF.knee) frontInt.push({ pts: [Ks, Ki] });
  const front = makePiece(
    {
      id: 'frente',
      name: `${tipo} frente`,
      outline: frontO,
      seam: 10,
      grain: [pt(cx, hipY), pt(cx, hemY - 6)],
      quantity: 2,
      cutInPairs: true,
      internals: frontInt,
      notches: [
        { at: H },
        ...(legF.knee ? [{ at: Ks }, { at: Ki }] : []),
        { at: pt(Fh - 0.2, fem ? 18 : 20) },
        { at: pt(cx - dartF / 2, 0) },
        { at: pt(cx + dartF / 2, 0) },
      ],
      notes: `Cortar 1 par. Fio = vinco (linha central). Braguilha com zíper de ${fem ? 18 : 20} cm (pique no gancho da frente).`,
    },
    group,
  );

  // ---------------- Costas ----------------
  const Bh = Q / 4 + 2;
  const extB = Q / 10 + 1;
  const rise = fem ? 2.5 : 3;
  const CBW = pt(Bh - 4, -rise);
  const PhB = pt(Bh, hipY);
  const u = dirTo(CBW, PhB);
  const perp = pt(-u.y, u.x);
  const dartB = fem ? 3 : 2.5;
  const wlen = W / 4 + 0.5 + dartB;
  const Cb0 = pt(CBW.x + (u.x * (crotchY - CBW.y)) / u.y, crotchY);
  const dB = fem ? 3.5 : 4;
  const kb = (kneeTot / 2 + 2) / 2;
  const hb = (hemTot / 2 + 2) / 2;
  const Hb = pt(0, hipY);

  const geomBack = (drop: number) => {
    const Fb = pt(Bh + extB, crotchY + drop);
    const cxb = Fb.x / 2 - 1;
    const KsB = pt(cxb - kb, kneeY);
    const KiB = pt(cxb + kb, kneeY);
    const HsB = pt(cxb - hb, Hs.y);
    const HiB = pt(cxb + hb, Hs.y);
    return { Fb, cxb, KsB, KiB, g: legGeometry(KsB, KiB, HsB, HiB, Fb, 1) };
  };
  // Entreperna das costas 0,5 cm menor que a da frente (assenta melhor).
  const targetInseam = inseamLenOf(legF, F) - 0.5;
  const drop = solve((d) => inseamLenOf(geomBack(d).g, geomBack(d).Fb), targetInseam, -2, 6);
  const gb = geomBack(drop);
  // Lateral das costas com o mesmo comprimento da frente: ajusta a altura da cintura lateral.
  const swBase = add(CBW, perp, wlen);
  const frontSideLen = sideLenOf(SW, H, legF);
  const dy = solve((d) => sideLenOf(pt(swBase.x, swBase.y + d), Hb, gb.g), frontSideLen, -4, 4);
  const SWb = pt(swBase.x, swBase.y + dy);
  const Cb = pt(Cb0.x + dB * Math.SQRT1_2, crotchY - dB * Math.SQRT1_2);

  const backO = legOutline(CBW, SWb, Hb, gb.g, gb.Fb, [Cb, PhB], pt(-u.x, -u.y));
  const wm = mid(CBW, SWb);
  const dirW = dirTo(CBW, SWb);
  const backInt: { pts: P[] }[] = [{ pts: [add(wm, dirW, -dartB / 2), add(wm, u, fem ? 12 : 11), add(wm, dirW, dartB / 2)] }, { pts: [Hb, PhB] }];
  if (gb.g.knee) backInt.push({ pts: [gb.KsB, gb.KiB] });
  const back = makePiece(
    {
      id: 'costas',
      name: `${tipo} costas`,
      outline: backO,
      seam: 10,
      grain: [pt(gb.cxb, hipY), pt(gb.cxb, hemY - 6)],
      quantity: 2,
      cutInPairs: true,
      internals: backInt,
      notches: [
        { at: Hb },
        ...(gb.g.knee ? [{ at: gb.KsB }, { at: gb.KiB }] : []),
        { at: PhB },
        { at: pt(PhB.x + 0.3, PhB.y + 1) },
        { at: add(wm, dirW, -dartB / 2) },
        { at: add(wm, dirW, dartB / 2) },
      ],
      notes: 'Cortar 1 par. Pique duplo no gancho das costas. Margem do gancho das costas pode ser ampliada para 2,5 cm (ajustes).',
    },
    group,
  );

  const fw = dist(CFW, SW) - dartF;
  const bw = dist(CBW, SWb) - dartB;
  const overlap = fem ? 3 : 4;
  const total = 2 * (fw + bw) + overlap;
  const cos = waistband('cos', total, 4, overlap, [0, fw, fw + 2 * bw, 2 * fw + 2 * bw], `Cós ${f1(total)} × 4 cm acabado (cortar 8 cm, dobrado). Transpasse de ${overlap} cm.`, group);

  const backInseam = inseamLenOf(gb.g, gb.Fb);
  const backSide = sideLenOf(SWb, Hb, gb.g);
  const id = `${opts.bermuda ? 'bermuda' : 'calca'}-${m.genero}`;
  return {
    id,
    nome: `${tipo} ${fem ? 'feminina' : 'masculina'}`,
    genero: m.genero,
    tamanho: m.tamanho,
    categoria: 'Calças',
    descricao: opts.bermuda
      ? `Bermuda de alfaiataria acima do joelho (${f1(hemY)} cm da cintura), pences, cós de 4 cm, braguilha com zíper.`
      : `${tipo} reta com vinco, pences na frente e nas costas, cós de 4 cm, braguilha com zíper. Comprimento ${f1(hemY)} cm (cintura à barra).`,
    tecido: fem ? 'Plano: alfaiataria, gabardine, sarja, linho.' : 'Plano: lã fria, tropical, gabardine, sarja.',
    aviamentos: [`Zíper metálico ou de nylon ${fem ? 18 : 20} cm`, '1 botão ou gancho para o cós', 'Entretela para o cós', ...(fem ? [] : ['Tecido de bolso (opcional)'])],
    folgas: ['Quadril: 4 cm no total', 'Cintura: 2 cm no total', `Joelho: ${f1(kneeTot)} cm de volta`, `Barra: ${hemTot} cm de volta`],
    margens: ['Costuras: 1,0 cm', `Barra: ${HEM / 10} cm`],
    conferencias: [
      `Entreperna frente ${f1(inseamLenOf(legF, F))} cm × costas ${f1(backInseam)} cm (costas 0,5 cm menor, para esticar)`,
      `Lateral frente ${f1(frontSideLen)} cm × costas ${f1(backSide)} cm`,
      `Cintura acabada (sem pences): ${f1(2 * (fw + bw))} cm (medida ${f1(W)} cm)`,
      `Quadril acabado: ${f1(2 * (Fh + Bh))} cm (medida ${f1(Q)} cm)`,
    ],
    medidas: m,
    pecas: [front, back, cos],
  };
}
