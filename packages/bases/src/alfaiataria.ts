/**
 * Alfaiataria: paletó masculino / blazer feminino de 3 partes (frente, lateral, costas),
 * manga de 2 partes, gola e vista. Terno = paletó + calça social.
 */
import { dist, normalize } from '@cad-textil/core';
import { type Base, f1, solve } from './base.js';
import { type P, Outline, along, curveLength, lerpP, makePiece, mid, plen, pt, yAt } from './draft.js';
import type { Medidas } from './medidas.js';
import { type TorsoOpts, armTangent, armholeLength, capPolyline, neckLengths, solveSleeveWidth, splitArm, torso } from './torso.js';
import { calca } from './inferiores.js';

const add = (a: P, b: P, k = 1): P => pt(a.x + b.x * k, a.y + b.y * k);
const neg = (p: P): P => pt(-p.x, -p.y);
const unit = (a: P, b: P) => normalize(pt(b.x - a.x, b.y - a.y));

/** Recorta uma polilinha entre dois X (x crescente), interpolando as pontas. */
function sliceByX(poly: P[], x0: number, x1: number): P[] {
  const out: P[] = [];
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!, b = poly[i + 1]!;
    if (a.x <= x0 && b.x > x0) out.push(lerpP(a, b, (x0 - a.x) / (b.x - a.x)));
    if (a.x > x0 && a.x < x1) out.push(a);
    if (a.x < x1 && b.x >= x1) out.push(lerpP(a, b, (x1 - a.x) / (b.x - a.x)));
  }
  const last = poly[poly.length - 1]!;
  if (last.x > x0 && last.x < x1) out.push(last);
  return out;
}

/** Reamostra uma polilinha em n pontos igualmente espaçados (para virar curva suave). */
function resample(poly: P[], n: number): P[] {
  const total = plen(poly);
  const out: P[] = [poly[0]!];
  let acc = 0;
  let i = 0;
  for (let k = 1; k < n - 1; k++) {
    const target = (total * k) / (n - 1);
    while (i < poly.length - 1 && acc + dist(poly[i]!, poly[i + 1]!) < target) {
      acc += dist(poly[i]!, poly[i + 1]!);
      i++;
    }
    const seg = dist(poly[i]!, poly[i + 1]!);
    out.push(lerpP(poly[i]!, poly[i + 1]!, seg ? (target - acc) / seg : 0));
  }
  out.push(poly[poly.length - 1]!);
  return out;
}

export function paleto(m: Medidas): Base {
  const fem = m.genero === 'feminino';
  const opts: TorsoOpts = fem
    ? { folga: 12, baixarCava: 2, prolongarOmbro: 1, alargarDecote: 0.5 }
    : { folga: 16, baixarCava: 2.5, prolongarOmbro: 1.5, alargarDecote: 0.5 };
  const t0 = torso(m, opts);
  const AXB = t0.backArm.pts[t0.backArm.named.AXB!]!;
  const FC = t0.frontArm.pts[t0.frontArm.named.FC!]!;
  const Sb0 = pt(AXB.x + 0.3, t0.AD * 0.78);
  const Sf0 = pt(FC.x - 0.2, t0.AD * 0.72);
  const t = torso(m, opts, { back: { Sb: Sb0 }, front: { Sf: Sf0 } });
  const nome = fem ? 'Blazer feminino' : 'Paletó masculino';
  const group = `${nome} ${m.tamanho}`;
  const L = fem ? 64 : 76; // nuca → barra
  const NW = m.alturaCostas;
  const HEM = 40;
  const s1 = fem ? 2 : 1.75; // supressão costas/lateral (cada lado)
  const s2 = fem ? 1.5 : 1; // supressão lateral/frente
  const frontDrop = 1.5; // barra da frente desce no centro

  const bs = splitArm(t.U, t.backArm, 'Sb');
  const fs = splitArm(t.U, t.frontArm, 'Sf');
  const Sb = bs.point;
  const Sf = fs.point;

  // ---------------- Costas ----------------
  const cbW = 1.5;
  const backSeam = [pt(Sb.x - s1, NW), Sb]; // da barra para cima
  const backHem = pt(Sb.x + 0.5, L);
  const back = makePiece(
    {
      id: 'costas',
      name: 'Costas',
      outline: new Outline(t.nape)
        .line(pt(0, t.AD * 0.5), 15)
        .curve([pt(cbW, NW), pt(cbW, L)], { seam: 15, startDir: pt(0, 1), endDir: pt(0, 1) })
        .line(backHem, HEM)
        .curve(backSeam, { endDir: pt(0, -1) })
        .mark('Sb')
        .curve(bs.upper.through, { startDir: bs.upper.startDir, endDir: bs.upper.endDir })
        .line(t.bHNP)
        .curve(t.backNeck.pts, { startDir: t.backNeck.startDir, endDir: t.backNeck.endDir })
        .close(15),
      seam: 10,
      grain: [pt(6, 8), pt(6, L - 8)],
      quantity: 2,
      cutInPairs: true,
      internals: [{ pts: [pt(0, NW), pt(Sb.x - s1, NW)] }],
      notches: [{ at: pt(Sb.x - s1, NW) }, { at: pt(cbW, NW) }],
      notes: 'Cortar 1 par. Centro costas com costura (margem 1,5 cm para ajuste). Opcional: abertura (fenda) de 22 cm no centro costas.',
    },
    group,
  );

  // ---------------- Lateral ----------------
  // As costuras de união são espelhos (em X) das bordas vizinhas → comprimentos idênticos.
  const sideBackSeam = [pt(Sb.x + s1, NW), pt(Sb.x - 0.5, L)];
  const sideFrontHem = pt(Sf.x + 0.5, L);
  const sideFrontSeam = [pt(Sf.x - s2, NW), Sf];
  const tanSf = armTangent(t.U, t.frontArm, t.frontArm.named.Sf!);
  const side = makePiece(
    {
      id: 'lateral',
      name: 'Lateral',
      outline: new Outline(Sb)
        .curve(sideBackSeam, { startDir: pt(0, 1) })
        .line(sideFrontHem, HEM)
        .curve(sideFrontSeam, { endDir: pt(0, -1) })
        .mark('Sf')
        .curve([...fs.lower.through.slice(0, -1).reverse(), t.U], { startDir: neg(tanSf), endDir: neg(t.frontArm.startDir) })
        .mark('axila')
        .curve(bs.lower.through, { startDir: bs.lower.startDir, endDir: bs.lower.endDir })
        .close(),
      seam: 10,
      grain: [pt((Sb.x + Sf.x) / 2, t.AD + 3), pt((Sb.x + Sf.x) / 2, L - 6)],
      quantity: 2,
      cutInPairs: true,
      internals: [{ pts: [pt(Sb.x + s1, NW), pt(Sf.x - s2, NW)] }],
      notches: [{ at: pt(Sb.x + s1, NW) }, { at: pt(Sf.x - s2, NW) }, { at: t.U }],
      notes: 'Cortar 1 par. Pique na axila = encontro com a costura da manga inferior.',
    },
    group,
  );

  // ---------------- Frente com lapela ----------------
  const halfW = t.halfW;
  const button = fem ? 1.5 : 2; // transpasse
  const edgeX = halfW + button;
  const Bk = pt(edgeX, NW - (fem ? 2 : 1)); // ponto de quebra da lapela
  const uS = unit(t.fSP, t.fHNP);
  const Rt = add(t.fHNP, uS, 2); // topo da linha de quebra
  const rollLen = dist(Bk, Rt);
  const r = unit(Bk, Rt);
  const n = pt(-r.y, r.x); // para fora (lado do centro frente)
  const lapelW = fem ? 7.5 : 8.5;
  const Lp = add(add(Bk, r, rollLen * 0.72), n, lapelW);
  const Nt = add(add(Lp, r, 3.2), n, -1.4);
  const Gn = add(add(Bk, r, rollLen * 0.87), n, 0.8);
  const hemY = (x: number) => yAt(pt(Sf.x, L), pt(edgeX, L + frontDrop), x);
  const Eh = pt(edgeX, L + frontDrop);
  const frontSeam = [pt(Sf.x + s2, NW), pt(Sf.x - 0.5, L)];
  const frontO = new Outline(Eh)
    .line(Bk)
    .mark('quebra')
    .curve([Lp], { startDir: add(r, n, 0.45), endDir: r })
    .line(Nt)
    .line(Gn)
    .line(t.fHNP)
    .line(t.fSP)
    .curve([...fs.upper.through.slice(0, -1).reverse(), Sf], { startDir: neg(t.frontArm.endDir), endDir: neg(fs.upper.startDir) })
    .mark('Sf')
    .curve(frontSeam, { startDir: pt(0, 1) })
    .close(HEM);
  // Bolsos e botões
  const pocketY = NW + 9;
  const pocketC = (Sf.x + halfW) / 2 + 1;
  const welt = (cx: number, cy: number, w: number, h: number, tilt = 0) => ({
    pts: [pt(cx - w / 2, cy + tilt), pt(cx + w / 2, cy - tilt), pt(cx + w / 2, cy + h - tilt), pt(cx - w / 2, cy + h + tilt)],
    closed: true,
  });
  const btnY = fem ? [Bk.y + 0.5] : [Bk.y + 0.5, Bk.y + 10.5];
  const cross = (c: P) => [{ pts: [pt(c.x - 0.6, c.y), pt(c.x + 0.6, c.y)] }, { pts: [pt(c.x, c.y - 0.6), pt(c.x, c.y + 0.6)] }];
  const frontInt = [
    { pts: [Bk, add(Bk, r, rollLen * 0.93)] }, // linha de quebra da lapela
    { pts: [pt(halfW, Bk.y), pt(halfW, hemY(halfW))] }, // centro frente
    welt(pocketC, pocketY, 15, 1.2), // bolso embutido inferior
    welt(Math.max(FC.x + 6, halfW - 13), t.AD + 0.5, fem ? 9 : 10.5, 2.3, 0.4), // bolso de peito
    ...btnY.flatMap((y) => cross(pt(halfW, y))),
  ];
  const front = makePiece(
    {
      id: 'frente',
      name: 'Frente',
      outline: frontO,
      seam: 10,
      grain: [pt(halfW - 7, t.AD), pt(halfW - 7, L - 6)],
      quantity: 2,
      cutInPairs: true,
      internals: frontInt,
      notches: [{ at: pt(Sf.x + s2, NW) }, { at: Bk }, { at: Nt }],
      notes: `Cortar 1 par + entretela na frente inteira. Linha de quebra da lapela marcada. ${btnY.length} botão(ões) de 20 mm, transpasse ${f1(button)} cm. Bolso embutido 15 cm e bolso de peito.`,
    },
    group,
  );

  // ---------------- Vista (forro da frente) ----------------
  const Fs = along(t.fHNP, t.fSP, 3.5);
  const facingInnerHem = pt(edgeX - 9, hemY(edgeX - 9));
  const facing = makePiece(
    {
      id: 'vista',
      name: 'Vista',
      outline: new Outline(Eh)
        .line(Bk)
        .curve([Lp], { startDir: add(r, n, 0.45), endDir: r })
        .line(Nt)
        .line(Gn)
        .line(t.fHNP)
        .line(Fs)
        .curve([pt(halfW - 5, t.AD), pt(edgeX - 9, NW), facingInnerHem], { startDir: pt(0.2, 1), endDir: pt(0, 1) })
        .close(HEM),
      seam: 10,
      grain: [pt(edgeX - 4, t.AD + 4), pt(edgeX - 4, L - 6)],
      quantity: 2,
      cutInPairs: true,
      notes: 'Cortar 1 par no tecido principal + entretela.',
    },
    group,
  );

  // ---------------- Gola ----------------
  const nk = neckLengths(t);
  const Lc = nk.back + dist(t.fHNP, Gn) + 0.6 * dist(Gn, Nt);
  const gH = fem ? 6.5 : 7.5;
  const stand = 3;
  const golaO = new Outline(pt(0, 0))
    .line(pt(0, gH), 0)
    .mark('cb')
    .curve([pt(Lc * 0.55, gH - 0.2), pt(Lc, gH - 0.9)], { startDir: pt(1, 0) })
    .line(pt(Lc + 1, 1.2))
    .curve([pt(Lc * 0.55, -0.3), pt(0, 0)], { endDir: pt(-1, 0) })
    .close();
  const gola = makePiece(
    {
      id: 'gola',
      name: 'Gola',
      outline: golaO,
      seam: 10,
      grain: [pt(1.5, 1), pt(1.5, gH - 1)],
      quantity: 2,
      cutInPairs: false,
      internals: [{ pts: [pt(0, gH - stand), pt(Lc * 0.55, gH - stand - 0.2), pt(Lc, gH - stand - 0.8)], curve: true }],
      notches: [{ from: 'cb', cm: nk.back, dir: 1 }],
      notes: 'Gola superior: 1x na dobra (tecido). Gola inferior: 1x em feltro/entretela de gola (cortada no viés, com costura no centro costas). Linha de quebra marcada; pique = ombro.',
    },
    group,
  );

  // ---------------- Manga de 2 partes ----------------
  const A = armholeLength(t.U, t.backArm) + armholeLength(t.U, t.frontArm);
  const ease = fem ? 2.5 : 3;
  const CH = A * 0.34;
  const W = solveSleeveWidth(A + ease, CH);
  const SL = m.comprimentoBraco + (fem ? 1 : 1.5);
  const wristTot = fem ? 26 : 30;
  const elbowY = CH + (SL - CH) * 0.47;
  const cap = capPolyline(W, CH);
  const xb = W * 0.22;
  const xf = W * 0.8;
  const backPart = sliceByX(cap, -1, xb); // L → Pb
  const topPart = sliceByX(cap, xb, xf); // Pb → Pf
  const frontPart = sliceByX(cap, xf, W + 1); // Pf → R
  const Pb = topPart[0]!;
  const Pf = topPart[topPart.length - 1]!;
  const tw = wristTot * 0.58;
  const tc = W * 0.53;
  const twF = pt(tc + tw / 2, SL);
  const twB = pt(tc - tw / 2, SL + 0.5);
  const elbowTF = pt(xf - 0.8, elbowY);
  const elbowTB = pt(xb - 0.6, elbowY);
  const topSleeve = makePiece(
    {
      id: 'manga-superior',
      name: 'Manga superior',
      outline: new Outline(Pb, 'Pb')
        .curve(resample(topPart, 7).slice(1))
        .mark('Pf')
        .curve([elbowTF, twF], { endDir: unit(elbowTF, twF) })
        .line(twB, HEM)
        .curve([elbowTB, Pb], { startDir: unit(twB, elbowTB) })
        .close(),
      seam: 10,
      grain: [pt(tc, CH + 2), pt(tc, SL - 5)],
      quantity: 2,
      cutInPairs: true,
      internals: [{ pts: [elbowTB, elbowTF] }],
      notches: [{ at: pt(W / 2, 0) }, { at: elbowTF }, { at: elbowTB }],
      notes: 'Cortar 1 par. Pique no topo = ombro; piques do cotovelo encontram a manga inferior.',
    },
    group,
  );
  const topFrontSeam = curveLength([Pf, elbowTF, twF], undefined, unit(elbowTF, twF));
  const topBackSeam = curveLength([twB, elbowTB, Pb], unit(twB, elbowTB));

  // Manga inferior: partes de trás e da frente da cabeça, rebatidas e unidas na axila (x = 0).
  const underBack = backPart.map((p) => pt(-p.x, p.y)).reverse(); // (-xb) → (0, CH)
  const underFront = frontPart.map((p) => pt(W - p.x, p.y)).reverse(); // (0, CH) → (W - xf)
  const Ub = underBack[0]!;
  const Uf = underFront[underFront.length - 1]!;
  const uw = wristTot - tw;
  const ufWristX = Uf.x - 1.2;
  const ubWristX = ufWristX - uw;
  const elbowUF = pt(Uf.x - 0.8, elbowY);
  const elbowUB = pt(Ub.x - 0.6 + (Pb.x - xb), elbowY);
  // Altura do punho em cada costura para igualar com a manga superior.
  const ufY = solve((y) => curveLength([Uf, elbowUF, pt(ufWristX, y)], undefined, unit(elbowUF, pt(ufWristX, y))), topFrontSeam, elbowY + 5, SL + 10);
  const ubY = solve((y) => curveLength([pt(ubWristX, y), elbowUB, Ub], unit(pt(ubWristX, y), elbowUB)), topBackSeam, elbowY + 5, SL + 10);
  const uWF = pt(ufWristX, ufY);
  const uWB = pt(ubWristX, ubY);
  const underSleeve = makePiece(
    {
      id: 'manga-inferior',
      name: 'Manga inferior',
      outline: new Outline(Ub)
        .curve([pt(0, CH)], { endDir: pt(1, 0) })
        .mark('axila')
        .curve([Uf], { startDir: pt(1, 0) })
        .curve([elbowUF, uWF], { endDir: unit(elbowUF, uWF) })
        .line(uWB, HEM)
        .curve([elbowUB, Ub], { startDir: unit(uWB, elbowUB) })
        .close(),
      seam: 10,
      grain: [pt((Ub.x + Uf.x) / 2, CH + 3), pt((Ub.x + Uf.x) / 2, SL - 5)],
      quantity: 2,
      cutInPairs: true,
      internals: [{ pts: [elbowUB, elbowUF] }],
      notches: [{ at: pt(0, CH) }, { at: elbowUF }, { at: elbowUB }],
      notes: 'Cortar 1 par. Pique na axila = costura lateral da lateral do corpo.',
    },
    group,
  );

  const capTop = curveLength(resample(topPart, 7));
  const capUnder = curveLength([Ub, pt(0, CH)], undefined, pt(1, 0)) + curveLength([pt(0, CH), Uf], pt(1, 0));
  return {
    id: `paleto-${m.genero}`,
    nome,
    genero: m.genero,
    tamanho: m.tamanho,
    categoria: 'Alfaiataria',
    descricao: `${nome} de 3 partes (frente, lateral, costas), lapela entalhada, ${fem ? '1 botão' : '2 botões'}, bolsos embutidos, manga de 2 partes. Comprimento ${L} cm (nuca à barra).`,
    tecido: fem ? 'Alfaiataria leve, crepe, lã fria; forro de acetato/viscose.' : 'Lã fria (super 100/120), tropical; forro de viscose/acetato.',
    aviamentos: [`${fem ? 1 : 2} botões de 20 mm na frente`, '8 botões de 15 mm nos punhos', 'Entretela de frente e de gola (feltro)', 'Ombreiras de 1 cm', 'Forro (moldes de forro: próxima versão)'],
    folgas: [`Busto/tórax: ${opts.folga} cm no total`, `Cava rebaixada ${opts.baixarCava} cm`, `Ombro prolongado ${opts.prolongarOmbro} cm (ombreira)`, `Embebimento da manga: ${f1(ease)} cm`],
    margens: ['Costuras: 1,0 cm', 'Centro costas: 1,5 cm', 'Barras do corpo e da manga: 4,0 cm'],
    conferencias: [
      `Cava total: ${f1(A)} cm × cabeça da manga (superior + inferior): ${f1(capTop + capUnder)} cm`,
      `Costura frontal da manga: superior ${f1(topFrontSeam)} cm = inferior ${f1(curveLength([Uf, elbowUF, uWF], undefined, unit(elbowUF, uWF)))} cm`,
      `Costura de trás da manga: superior ${f1(topBackSeam)} cm = inferior ${f1(curveLength([uWB, elbowUB, Ub], unit(uWB, elbowUB)))} cm`,
      `Gola: ${f1(Lc)} cm (metade), decote costas ${f1(nk.back)} cm`,
      `Costura costas ${f1(curveLength([backHem, ...backSeam], undefined, pt(0, -1)))} cm = lateral ${f1(curveLength([Sb, ...sideBackSeam], pt(0, 1)))} cm`,
      `Costura lateral ${f1(curveLength([sideFrontHem, ...sideFrontSeam], undefined, pt(0, -1)))} cm = frente ${f1(curveLength([Sf, ...frontSeam], pt(0, 1)))} cm`,
    ],
    medidas: m,
    pecas: [front, side, back, facing, gola, topSleeve, underSleeve],
  };
}

/** Terno = paletó + calça social do mesmo tamanho. */
export function terno(m: Medidas): Base {
  const p = paleto(m);
  const c = calca(m);
  const fem = m.genero === 'feminino';
  return {
    ...p,
    id: `terno-${m.genero}`,
    nome: fem ? 'Terninho feminino (blazer + calça)' : 'Terno masculino (paletó + calça)',
    descricao: `${p.descricao} Acompanha ${c.nome.toLowerCase()}: ${c.descricao}`,
    aviamentos: [...p.aviamentos, ...c.aviamentos],
    conferencias: [...p.conferencias, ...c.conferencias],
    pecas: [...p.pecas, ...c.pecas.map((q) => ({ ...q, id: `calca-${q.id}` }))],
  };
}

void mid;
