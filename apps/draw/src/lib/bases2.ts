/**
 * Bases novas (desenho técnico profissional). Mesma interface de `bases.ts`.
 */
import type { Shape } from '../model/types';
import type { Vec2 } from '@cad-textil/core';
import type { BaseDef, Vista } from './bases';
import { type Pt } from './kit';
import {
  type Manga,
  type Torso,
  P,
  W,
  armholeSeam,
  band,
  bandFull,
  body,
  curve,
  drape,
  fold,
  insideBack,
  line,
  neckCurve,
  parallel,
  parallelToAxis,
  part,
  seam,
  shapeList,
  sleeveGeo,
  sleeveHemIn,
  topstitch,
  trim,
  xAt,
  pb,
  cuffBand,
} from './flats';

/* ------------------------------------------------------------------ */
/* Camiseta                                                            */
/* ------------------------------------------------------------------ */

/**
 * Camiseta de ombro caído (padrão das referências de mercado). Pontos medidos de um flat
 * profissional e escalados pela largura e pelo comprimento: ombro em curva que desce para a
 * manga, ribana larga com o avesso das costas aparecendo, pespontos duplos junto às costuras.
 */
export const camiseta: BaseDef = {
  id: 'camiseta',
  label: 'Camiseta',
  cat: 'Superiores',
  options: [
    { key: 'gola', label: 'Gola', choices: [{ value: 'careca', label: 'Careca' }, { value: 'v', label: 'V' }] },
    { key: 'manga', label: 'Manga', choices: [{ value: 'curta', label: 'Curta' }, { value: 'longa', label: 'Longa' }] },
    { key: 'largura', label: 'Largura (busto 1/2)', min: 30, max: 90 },
    { key: 'comprimento', label: 'Comprimento', min: 35, max: 120 },
  ],
  defaults: { gola: 'careca', manga: 'curta', largura: 55, comprimento: 86 },
  make(o, vista: Vista) {
    const sx = Number(o.largura) / 55, sy = Number(o.comprimento) / 80;
    const X = (x: number) => x * sx;
    const Y = (y: number) => y * sy;
    const longa = o.manga === 'longa';
    const nw = X(10.9);
    const hemY = Y(80);
    const side = X(27.2);
    const sp = P(X(29.6), Y(9.6)); // onde o ombro vira manga
    const ua = P(X(26.9), Y(41)); // embaixo do braço (costura do ombro caído)
    // manga: curta abre para fora; longa cai junto ao corpo
    const sTop = longa ? P(X(41.5), Y(76)) : P(X(43.6), Y(34));
    const sBot = longa ? P(X(31.6), Y(77.2)) : P(X(28.4), Y(42.6));
    const back = Y(0.8);
    const fd = o.gola === 'v' ? Y(15) : Y(8.4);
    const rib = X(2.6);
    const outline = pb(0, back)
      .S(nw, 0, P(1, 0), P(1, -0.12), 0.42)
      // ombro em curva, descendo para a manga
      .S(sp.x, sp.y, P(1, 0.34), P(0.55, 1), 0.42)
      .S(sTop.x - X(0.4), sTop.y - Y(0.5), P(sTop.x - sp.x, sTop.y - sp.y), P(sTop.x - sp.x, sTop.y - sp.y), 0.35)
      .S(sTop.x - X(1), sTop.y + Y(0.8), P(sTop.x - sp.x, sTop.y - sp.y), P(sBot.x - sTop.x, sBot.y - sTop.y), 0.5)
      .S(sBot.x + X(0.6), sBot.y - Y(0.2), P(sBot.x - sTop.x, sBot.y - sTop.y), P(sBot.x - sTop.x, sBot.y - sTop.y), 0.35)
      .S(longa ? side + X(0.2) : ua.x, longa ? sBot.y - Y(5) : ua.y + Y(0.4), P(-0.6, -0.4), P(longa ? 0.05 : -0.45, longa ? -1 : -0.6), 0.4);
    if (longa) outline.L(side + X(0.35), hemY - Y(0.9));
    else outline.S(side + X(0.4), hemY - Y(0.9), P(0, 1), P(0.01, 1), 0.4);
    outline.S(side - X(0.3), hemY + Y(0.05), P(0, 1), P(-1, 0.02), 0.6).S(0, hemY + Y(0.5), P(-1, 0.02), P(-1, 0), 0.36);
    const out: Shape[] = [body(outline.path(), 'Camiseta')];
    // decote: avesso das costas + ribana com pesponto duplo
    const backNeck = pb(0, back).S(nw, 0, P(1, 0), P(1, -0.12), 0.42);
    if (vista === 'frente') {
      out.push(topstitch(parallelToAxis(backNeck.path(), -X(1.6)), 'duplo'));
      out.push(seam(parallelToAxis(backNeck.path(), -X(2.4))));
      const neck = o.gola === 'v' ? pb(nw, 0).S(0, fd, P(-0.5, 1), P(-0.55, 1), 0.3) : pb(nw, 0).S(0, fd, P(-0.22, 1), P(-1, 0), 0.55);
      out.push(part(bandFull(neck.path(), rib), false, undefined, W.contorno * 0.8));
      out.push(topstitch(parallelToAxis(neck.path(), rib - X(0.5)), 'duplo'));
    } else {
      out.push(part(bandFull(pb(nw, 0).S(0, back, P(-1, 0.12), P(-1, 0), 0.42).path(), rib * 0.9), false, undefined, W.contorno * 0.8));
      out.push(topstitch(parallelToAxis(pb(nw, 0).S(0, back, P(-1, 0.12), P(-1, 0), 0.42).path(), rib * 0.9 - X(0.5)), 'duplo'));
    }
    // costura do ombro caído com pesponto do lado da manga
    const shoulderSeam = pb(X(27.8), Y(10.6)).S(ua.x, ua.y, P(-0.12, 1), P(0, 1), 0.42);
    out.push(seam(shoulderSeam.path()), topstitch(parallel(shoulderSeam.path(), -X(0.55)), 'duplo'));
    // barras: manga e corpo, com pesponto duplo
    const hb = longa ? X(3.6) : X(2.2);
    const d = P(sBot.x - sTop.x, sBot.y - sTop.y);
    const l = Math.hypot(d.x, d.y);
    const inward = P(-(sTop.x - sp.x), -(sTop.y - sp.y));
    const il = Math.hypot(inward.x, inward.y);
    const off = P((inward.x / il) * hb, (inward.y / il) * hb);
    void l;
    out.push(topstitch(line([sTop.x + off.x - X(0.3), sTop.y + off.y], [sBot.x + off.x + X(0.4), sBot.y + off.y - Y(0.3)]), 'duplo'));
    out.push(topstitch(parallelToAxis(pb(side + X(0.4), hemY - Y(0.4)).S(0, hemY + Y(0.5), P(-1, 0.02), P(-1, 0), 0.36).path(), -Y(3.4)), 'duplo'));
    return out;
  },
};

/**
 * Moletom raglan (padrão das referências): recorte raglan do decote até a axila com pesponto,
 * ribana larga no decote, punho e barra com pesponto duplo, manga longa caindo junto ao corpo.
 */
export const moletomRaglan: BaseDef = {
  id: 'moletom',
  label: 'Moletom raglan',
  cat: 'Superiores',
  options: [
    { key: 'largura', label: 'Largura (busto 1/2)', min: 30, max: 90 },
    { key: 'comprimento', label: 'Comprimento', min: 40, max: 120 },
  ],
  defaults: { largura: 54, comprimento: 97 },
  make(o, vista: Vista) {
    const sx = Number(o.largura) / 54, sy = Number(o.comprimento) / 97;
    const X = (x: number) => x * sx;
    const Y = (y: number) => y * sy;
    const nw = X(13.3), back = Y(2.6), hemY = Y(97);
    const side = X(26.8);
    const wristO = P(X(43.2), Y(94.4)), wristI = P(X(30.9), Y(95.6));
    const outline = pb(0, back)
      .S(nw, 0, P(1, 0), P(1, -0.1), 0.42)
      .S(X(28.4), Y(9), P(1, 0.4), P(0.3, 1), 0.45)
      .S(wristO.x, wristO.y - Y(1), P(0.3, 1), P(0.16, 1), 0.4)
      .S(wristO.x - X(1.2), wristO.y + Y(0.6), P(0.16, 1), P(-1, 0.1), 0.6)
      .L(wristI.x + X(1), wristI.y)
      .S(wristI.x - X(0.2), wristI.y - Y(1.2), P(-1, -0.05), P(-0.2, -1), 0.6)
      .L(X(29.7), Y(89))
      .L(X(28.9), hemY - Y(0.8))
      .S(X(28.4), hemY + Y(0.05), P(0, 1), P(-1, 0.02), 0.6)
      .S(0, hemY + Y(0.5), P(-1, 0.02), P(-1, 0), 0.36);
    const out: Shape[] = [body(outline.path(), 'Moletom')];
    // lateral do corpo (a manga cai por cima, junto ao corpo)
    out.push(seam(pb(side, Y(31)).L(X(29.7), Y(89)).path()));
    const backNeck = pb(0, back).S(nw, 0, P(1, 0), P(1, -0.1), 0.42);
    const rib = X(3.2);
    if (vista === 'frente') {
      out.push(topstitch(parallelToAxis(backNeck.path(), -X(2)), 'duplo'));
      out.push(seam(parallelToAxis(backNeck.path(), -X(3))));
      const neck = pb(nw, 0).S(0, Y(7.2), P(-0.2, 1), P(-1, 0), 0.55);
      out.push(part(bandFull(neck.path(), rib), false, undefined, W.contorno * 0.8));
      out.push(topstitch(parallelToAxis(neck.path(), rib - X(0.6)), 'duplo'));
    } else {
      out.push(part(bandFull(pb(nw, 0).S(0, back, P(-1, 0.1), P(-1, 0), 0.42).path(), rib * 0.85), false, undefined, W.contorno * 0.8));
    }
    // recorte raglan do decote até a axila, pesponto do lado da manga
    const ragTop = vista === 'frente' ? P(X(14.4), Y(2.4)) : P(X(13.8), Y(1.4));
    const rag = pb(ragTop.x, ragTop.y).S(side, Y(31), P(0.42, 1), P(0.36, 1), 0.42);
    out.push(seam(rag.path()), topstitch(parallel(rag.path(), X(0.55)), 'duplo'));
    // punho e barra com pesponto duplo
    out.push(topstitch(line([wristO.x - X(0.6), wristO.y - Y(4.4)], [wristI.x - X(0.1), wristI.y - Y(4)]), 'duplo'));
    out.push(topstitch(parallelToAxis(pb(X(28.9), hemY - Y(0.4)).S(0, hemY + Y(0.5), P(-1, 0.02), P(-1, 0), 0.36).path(), -Y(4.6)), 'duplo'));
    return out;
  },
};

/* ------------------------------------------------------------------ */
/* Calça jeans 5 bolsos                                                */
/* ------------------------------------------------------------------ */

export const calca: BaseDef = {
  id: 'calca',
  label: 'Calça jeans 5 bolsos',
  cat: 'Inferiores',
  options: [
    { key: 'modelagem', label: 'Modelagem', choices: [{ value: 'reta', label: 'Reta' }, { value: 'skinny', label: 'Skinny' }, { value: 'wide', label: 'Wide leg' }, { value: 'flare', label: 'Flare' }] },
    { key: 'cintura', label: 'Cintura (1/2)', min: 25, max: 70 },
    { key: 'comprimento', label: 'Comprimento', min: 60, max: 120 },
  ],
  defaults: { modelagem: 'reta', cintura: 38, comprimento: 104 },
  make(o, vista: Vista) {
    const ww = Number(o.cintura) / 2;
    const L = Number(o.comprimento);
    const hip = ww + 4.4;
    const rise = vista === 'frente' ? 25.5 : 27.5;
    const cb = 4;
    const knee = 0.58 * L;
    // [meia boca (largura da barra), largura da perna no joelho, afastamento da barra até o centro]
    // As pernas se afastam do centro aos poucos, do gancho até a barra (como vestidas, de frente).
    const spec = ({ reta: [10, 21, 6], skinny: [7, 16, 5.2], wide: [15.5, 27, 6.4], flare: [14, 17.5, 6.6] } as const)[o.modelagem as 'reta'] ?? [10, 21, 6];
    const inX = spec[2];
    const outX = inX + 2 * spec[0];
    const kIn = 0.3 + (inX - 0.3) * ((knee - rise) / (L - rise));
    const kOut = kIn + spec[1];
    const dirK = P(-(inX - 0.3) / (L - rise), -1);
    const side = pb(0, 0)
      .L(ww, 0)
      .S(hip, 19, P(0.22, 1), P(0, 1), 0.48)
      .S(kOut, knee, P(0, 1), P((kOut - hip) / (knee - 19), 1), 0.42)
      .S(outX, L, P((kOut - hip) / (knee - 19), 1), P((outX - kOut) / (L - knee), 1), 0.4)
      .L(inX, L + 0.15)
      .S(kIn, knee, dirK, dirK, 0.4)
      .S(0, rise, dirK, P(dirK.x - 0.28, -1), 0.4);
    const outline = side.path();
    const out: Shape[] = [body(outline, 'Calça')];
    // cós (faixa inteira) com pespontos
    out.push(part(pb(-ww, 0).L(ww, 0).L(xAt(outline, cb), cb).L(-xAt(outline, cb), cb).path(true), false));
    out.push(topstitch(line([0, 0.5], [ww + 0.05, 0.5]), 'simples'), topstitch(line([0, cb - 0.5], [xAt(outline, cb - 0.5) - 0.05, cb - 0.5]), 'simples'));
    // barra dobrada com pesponto
    out.push(topstitch(line([inX + 0.15, L - 1.9], [outX - 0.05, L - 1.9]), 'simples'));
    const loop = (x: number, m = true) => part(pb(x - 0.55, -0.45).L(x + 0.55, -0.45).L(x + 0.55, cb + 0.9).L(x - 0.55, cb + 0.9).path(true), m);
    if (vista === 'frente') {
      out.push(loop(ww * 0.55), loop(ww - 0.7));
      // bolso faca curvo, pesponto duplo e rebite
      const py = 13.2;
      const pocket = pb(ww * 0.5, cb).S(xAt(outline, py), py, P(0.25, 1), P(1, 0.15), 0.45);
      out.push(seam(pocket.path()), topstitch(parallel(pocket.path(), 0.65), 'duplo'));
      out.push(trim('rebite', ww * 0.5 + 0.25, cb + 0.6, true, 0.7));
      // relojinho (só de um lado)
      out.push(part(pb(-ww * 0.5 - 0.4, cb).L(-ww * 0.5 - 0.4 - 6.2, cb).L(-ww * 0.5 - 0.4 - 6, cb + 5).S(-ww * 0.5 - 0.6, cb + 5.4, P(1, 0.02), P(1, -0.05), 0.4).path(true), false));
      out.push(topstitch(line([-ww * 0.5 - 0.6, cb + 0.6], [-ww * 0.5 - 6.4, cb + 0.6]), 'simples', false));
      // centro da frente, braguilha em J e botão
      out.push(seam(line([0, cb], [0, rise - 1]), false));
      out.push(topstitch(pb(3.4, cb).L(3.4, 15.4).S(0.15, 19.6, P(0, 1), P(-1, 0.35), 0.5).path(), 'duplo', false));
      out.push(trim('botaoJeans', 0, cb / 2, false, 1.6));
    } else {
      out.push(loop(0, false), loop(ww * 0.62), loop(ww - 0.7));
      // pala com pesponto duplo, centro das costas
      const yoke = pb(0, 11).S(xAt(outline, 6.4), 6.4, P(1, 0), P(1, -0.3), 0.42);
      out.push(seam(yoke.path()), topstitch(parallelToAxis(yoke.path(), -0.75), 'duplo'));
      out.push(seam(line([0, cb], [0, rise]), false), topstitch(line([0.65, 11.6], [0.65, rise - 0.6]), 'duplo', false));
      // bolso chapado (pentágono suave) com pesponto e bordado
      const bpk = pb(5.6, 13.6).L(17.4, 12.7).L(17.6, 24.2).L(11.6, 27).L(5.8, 24.6).path(true);
      out.push(part(bpk), topstitch(pb(5.85, 15).L(17.25, 14.1).path(), 'duplo'));
      out.push(topstitch(parallel(pb(17.4, 12.7).L(17.6, 24.2).L(11.6, 27).L(5.8, 24.6).L(5.6, 13.6).path(), -0.45), 'simples'));
      out.push(topstitch(pb(7.4, 18.8).S(11.6, 21.4, P(0.6, 1), P(1, 0), 0.5).S(15.6, 18, P(1, 0), P(0.6, -1), 0.5).path(), 'duplo'));
      // etiqueta no cós
      out.push(part(pb(-12.8, 0.8).L(-7.6, 0.8).L(-7.6, 3.3).L(-12.8, 3.3).path(true), false));
    }
    return shapeList(out);
  },
};

/* ------------------------------------------------------------------ */
/* Bloco base das blusas (mesma proporção em todas as peças de cima)    */
/* ------------------------------------------------------------------ */

/** Hem curvo que chega ao centro em 90°, a partir da lateral (x, y). */
const hemTo = (b: ReturnType<typeof pb>, x: number, y: number, drop = 0.5) => b.S(x - 0.5, y + 0.05, P(0, 1), P(-1, 0.02), 0.6).S(0, y + drop, P(-1, 0.02), P(-1, 0), 0.36);
/** Linha da barra (para pesponto/costura) paralela à curva da barra. */
const hemLine = (x: number, y: number, d: number, drop = 0.5) => parallelToAxis(pb(x, y + 0.05).S(0, y + drop, P(-1, 0.02), P(-1, 0), 0.36).path(), -d);

/* ------------------------------------------------------------------ */
/* Regata                                                              */
/* ------------------------------------------------------------------ */

export const regata: BaseDef = {
  id: 'regata',
  label: 'Regata',
  cat: 'Superiores',
  options: [
    { key: 'alca', label: 'Alça', choices: [{ value: 'larga', label: 'Larga' }, { value: 'nadador', label: 'Nadador' }] },
    { key: 'largura', label: 'Largura (busto 1/2)', min: 30, max: 80 },
    { key: 'comprimento', label: 'Comprimento', min: 35, max: 110 },
  ],
  defaults: { alca: 'larga', largura: 48, comprimento: 70 },
  make(o, vista: Vista) {
    const hw = Number(o.largura) / 2;
    const L = Number(o.comprimento);
    const nad = o.alca === 'nadador';
    const nw = nad ? 9 : 9.8;
    const strap = nad ? 3.4 : 5.4; // largura da alça no ombro
    const so = P(nw + strap, 1.4); // ponta de fora da alça
    const ua = P(hw, 24);
    const back = vista === 'costas' ? (nad ? 18 : 7) : 1.2;
    const front = vista === 'frente' ? 14 : back;
    const hemX = hw + 1.2;
    // cava cavada: desce da alça e abre até a lateral
    const cava = (b: ReturnType<typeof pb>) => b.S(ua.x, ua.y, P(nad ? -0.05 : 0.12, 1), P(1, 0.25), 0.5);
    const outline = cava(pb(0, front).S(nw, 0, P(1, 0), P(0.4, -1), 0.5).L(so.x, so.y))
      .S(hemX, L - 0.6, P(0.02, 1), P(0.04, 1), 0.42);
    hemTo(outline, hemX, L);
    const out: Shape[] = [body(outline.path(), 'Regata')];
    // viés/ribana no decote e na cava, com pesponto duplo
    const neck = pb(nw, 0).S(0, front, P(-0.4, 1), P(-1, 0), 0.5);
    out.push(part(bandFull(neck.path(), 1.6), false, undefined, W.contorno * 0.8), topstitch(parallelToAxis(neck.path(), 1.2), 'duplo'));
    const arm = cava(pb(so.x, so.y));
    out.push(part(band(arm.path(), -1.6, false)), topstitch(parallel(arm.path(), -1.2), 'duplo'));
    out.push(topstitch(hemLine(hemX, L, 2.6), 'duplo'));
    return out;
  },
};

/* ------------------------------------------------------------------ */
/* Camisa social                                                       */
/* ------------------------------------------------------------------ */

export const camisa: BaseDef = {
  id: 'camisa',
  label: 'Camisa social',
  cat: 'Superiores',
  options: [
    { key: 'manga', label: 'Manga', choices: [{ value: 'longa', label: 'Longa' }, { value: 'curta', label: 'Curta' }] },
    { key: 'bolso', label: 'Bolso', choices: [{ value: 'sim', label: 'Com bolso' }, { value: 'nao', label: 'Sem bolso' }] },
    { key: 'largura', label: 'Largura (busto 1/2)', min: 30, max: 90 },
    { key: 'comprimento', label: 'Comprimento', min: 40, max: 120 },
  ],
  defaults: { manga: 'longa', bolso: 'sim', largura: 56, comprimento: 80 },
  make(o, vista: Vista) {
    const hw = Number(o.largura) / 2;
    const L = Number(o.comprimento);
    const longa = o.manga === 'longa';
    const nw = 8.2;
    const sp = P(hw - 3.4, 5.6);
    const ua = P(hw, 25.5);
    // manga montada seguindo o braço
    const ang = ((longa ? 70 : 34) * Math.PI) / 180;
    const ad = P(Math.cos(ang), Math.sin(ang));
    const len = longa ? 60 : 22;
    const open = longa ? 13 : 18;
    const top = P(sp.x + ad.x * len, sp.y + ad.y * len);
    const bot = P(top.x - ad.y * open, top.y + ad.x * open);
    const sideHem = L - 6; // barra curva (fralda): mais alta na lateral
    const outline = pb(0, -2.2)
      .S(nw, -1.4, P(1, 0), P(1, 0.1), 0.4) // pé de gola atrás
      .L(nw, 0)
      .S(sp.x, sp.y, P(1, 0.36), P(1, 0.5), 0.4)
      .S(top.x, top.y, P(0.5, 1), ad, 0.32)
      .L(bot.x, bot.y)
      .S(ua.x, ua.y, P(ua.x - bot.x, ua.y - bot.y), P(-0.3, -1), 0.3)
      .S(hw + 0.6, sideHem - 2, P(0.01, 1), P(0.02, 1), 0.42)
      .S(hw - 4, sideHem + 4.4, P(0, 1), P(-0.7, 0.5), 0.5)
      .S(0, L, P(-0.7, 0.5), P(-1, 0), 0.45);
    const out: Shape[] = [body(outline.path(), 'Camisa')];
    out.push(seam(pb(sp.x, sp.y).S(ua.x, ua.y, P(-0.15, 1), P(0.55, 1), 0.42).path()), topstitch(parallel(pb(sp.x, sp.y).S(ua.x, ua.y, P(-0.15, 1), P(0.55, 1), 0.42).path(), -0.45), 'simples'));
    if (longa) {
      // punho
      const c = 6;
      const a0 = P(top.x - ad.x * c, top.y - ad.y * c), b0 = P(bot.x - ad.x * c, bot.y - ad.y * c);
      out.push(part(pb(top.x, top.y).L(bot.x, bot.y).L(b0.x, b0.y).L(a0.x, a0.y).path(true)), topstitch(line([a0.x + ad.x * 0.5, a0.y + ad.y * 0.5], [b0.x + ad.x * 0.5, b0.y + ad.y * 0.5]), 'simples'));
      out.push(trim('botao2', (top.x + a0.x) / 2 - ad.y * 2, (top.y + a0.y) / 2 + ad.x * 2, true, 1));
    } else {
      out.push(topstitch(line([top.x - ad.x * 2.4, top.y - ad.y * 2.4], [bot.x - ad.x * 2.4, bot.y - ad.y * 2.4]), 'simples'));
    }
    out.push(topstitch(parallelToAxis(pb(hw - 4, sideHem + 4.4).S(0, L, P(-0.7, 0.5), P(-1, 0), 0.45).path(), -1), 'simples'));
    if (vista === 'frente') {
      // gola: pé (faixa) e as duas pontas
      out.push(part(pb(0, 4.5).S(nw - 0.3, -1.6, P(1, 0), P(0.3, -1), 0.5).L(nw + 0.9, -1.2).S(0, 6.6, P(-0.3, 1), P(-1, 0), 0.5).path(true)));
      const leaf = pb(nw + 0.6, -1.4).S(6.2, 12, P(0.15, 1), P(-0.5, 1), 0.45).L(0.6, 7.6).S(nw - 0.2, -0.8, P(0.5, -1), P(0.4, -1), 0.45).path(true);
      out.push(part(leaf), topstitch(parallel(pb(nw + 0.6, -1.4).S(6.2, 12, P(0.15, 1), P(-0.5, 1), 0.45).L(0.6, 7.6).path(), 0.45), 'simples'));
      // carcela com botões
      out.push(seam(line([1.8, 6.6], [1.8, L - 0.1])), topstitch(line([1.45, 6.8], [1.45, L - 0.4]), 'simples'));
      for (let y = 10; y < L - 6; y += 9) out.push(trim('botao4', 0, y, false, 1.1));
      if (o.bolso === 'sim') {
        const pk = pb(6.2, 21).L(17.2, 21).L(17.2, 32.6).L(11.7, 34.6).L(6.2, 32.6).path(true);
        out.push(part(pk, false), topstitch(line([6.4, 22.6], [17, 22.6]), 'simples', false), topstitch(parallel(pb(17.2, 21).L(17.2, 32.6).L(11.7, 34.6).L(6.2, 32.6).L(6.2, 21).path(), -0.45), 'simples', false));
      }
    } else {
      // pala e prega macho no centro das costas
      const yoke = pb(0, 13).S(xAt(outline.path(), 9.5), 9.5, P(1, 0), P(1, -0.3), 0.4);
      out.push(seam(yoke.path()), topstitch(parallelToAxis(yoke.path(), -0.45), 'simples'));
      out.push(seam(line([2, 13], [2.4, 22]), true));
      out.push(part(pb(0, -2.2).S(nw, -1.4, P(1, 0), P(1, 0.1), 0.4).L(nw, 0).S(0, 0.8, P(-1, 0.1), P(-1, 0), 0.4).path(true), true));
    }
    return out;
  },
};

/* ------------------------------------------------------------------ */
/* Shorts com elástico                                                 */
/* ------------------------------------------------------------------ */

export const shorts: BaseDef = {
  id: 'shorts',
  label: 'Shorts com elástico',
  cat: 'Inferiores',
  options: [
    { key: 'cintura', label: 'Cintura (1/2, relaxada)', min: 25, max: 70 },
    { key: 'comprimento', label: 'Comprimento', min: 25, max: 70 },
  ],
  defaults: { cintura: 46, comprimento: 46 },
  make(o, vista: Vista) {
    const ww = Number(o.cintura) / 2;
    const L = Number(o.comprimento);
    const cb = 4.5;
    const rise = vista === 'frente' ? 29 : 32;
    const hip = ww + 3.5;
    const outX = hip + 3.2, inX = 5.5;
    const outline = pb(0, 0)
      .L(ww, 0)
      .S(hip, 17, P(0.18, 1), P(0.05, 1), 0.45)
      .S(outX, L, P(0.05, 1), P(0.08, 1), 0.4)
      .S(outX - 0.6, L + 0.4, P(0, 1), P(-1, 0.02), 0.5)
      .L(inX + 0.6, L + 0.7)
      .S(inX - 0.1, L, P(-1, 0), P(-0.08, -1), 0.5)
      .S(0, rise, P(-0.12, -1), P(-0.7, -1), 0.4);
    const out: Shape[] = [body(outline.path(), 'Shorts')];
    // cós de elástico com pespontos
    out.push(part(pb(-ww, 0).L(ww, 0).L(xAt(outline.path(), cb), cb).L(-xAt(outline.path(), cb), cb).path(true), false));
    for (const y of [1.3, 2.25, 3.2]) out.push(topstitch(line([0, y], [xAt(outline.path(), y) - 0.1, y]), 'simples'));
    for (let x = 1.6; x < ww - 0.5; x += 2.4) out.push(fold(line([x, 0.5], [x + 0.25, cb - 0.5])));
    out.push(topstitch(line([inX + 0.3, L - 2.2], [outX - 0.2, L - 2.2]), 'duplo'));
    if (vista === 'frente') {
      out.push(trim('ilhos', -1.4, 2.3, false, 0.8), trim('ilhos', 1.4, 2.3, false, 0.8));
      out.push(seam(pb(-1.4, 2.3).S(-3.4, 13, P(-0.1, 1), P(-0.25, 1), 0.45).path(), false), seam(pb(1.4, 2.3).S(3.6, 12.2, P(0.15, 1), P(0.3, 1), 0.45).path(), false));
      out.push(trim('terminal', -3.4, 13.8, false, 1.4), trim('terminal', 3.6, 13, false, 1.4));
      // bolso faca diagonal com pesponto
      const pk = pb(ww - 3.2, cb).L(xAt(outline.path(), 18), 18);
      out.push(seam(pk.path()), topstitch(parallel(pk.path(), 0.6), 'simples'));
      out.push(seam(line([0, cb], [0, rise - 1]), false));
    } else {
      out.push(seam(line([0, cb], [0, rise]), false));
      out.push(part(pb(6, 11).L(16.5, 11).L(16.5, 22).L(6, 22).path(true)), topstitch(line([6.2, 12.8], [16.3, 12.8]), 'simples'));
    }
    return out;
  },
};

/* ------------------------------------------------------------------ */
/* Saia                                                                */
/* ------------------------------------------------------------------ */

export const saia: BaseDef = {
  id: 'saia',
  label: 'Saia',
  cat: 'Inferiores',
  options: [
    { key: 'modelo', label: 'Modelo', choices: [{ value: 'reta', label: 'Reta' }, { value: 'evase', label: 'Evasê' }, { value: 'gode', label: 'Godê' }] },
    { key: 'cintura', label: 'Cintura (1/2)', min: 25, max: 70 },
    { key: 'comprimento', label: 'Comprimento', min: 30, max: 110 },
  ],
  defaults: { modelo: 'evase', cintura: 36, comprimento: 60 },
  make(o, vista: Vista) {
    const ww = Number(o.cintura) / 2;
    const L = Number(o.comprimento);
    const hip = ww + 5.5;
    const cb = 3.5;
    const mod = o.modelo as 'reta' | 'evase' | 'gode';
    const hx = mod === 'reta' ? hip - 0.6 : mod === 'evase' ? hip + L * 0.16 : hip + L * 0.42;
    const drop = mod === 'gode' ? 4.5 : mod === 'evase' ? 1.6 : 0.4; // barra curva (perspectiva do volume)
    const outline = pb(0, 0)
      .L(ww, 0)
      .S(hip, 19, P(0.25, 1), P(mod === 'reta' ? 0 : 0.2, 1), 0.45)
      .S(hx, L - drop * 0.3, P(mod === 'reta' ? -0.01 : (hx - hip) / (L - 19), 1), P((hx - hip) / (L - 19), 1), 0.4)
      .S(hx - 1, L + 0.1, P(0, 1), P(-1, 0.1), 0.5)
      .S(0, L + drop, P(-1, 0.1), P(-1, 0), 0.4);
    const out: Shape[] = [body(outline.path(), 'Saia')];
    out.push(part(pb(-ww, 0).L(ww, 0).L(xAt(outline.path(), cb), cb).L(-xAt(outline.path(), cb), cb).path(true), false));
    out.push(topstitch(parallelToAxis(pb(hx - 1, L + 0.1).S(0, L + drop, P(-1, 0.1), P(-1, 0), 0.4).path(), -2.2), 'simples'));
    if (mod === 'reta') out.push(seam(pb(ww * 0.55, cb).L(ww * 0.55 + 0.3, cb + 11).path()));
    if (mod === 'gode') for (const f of [0.35, 0.7]) out.push(fold(pb(ww * f + 2, 14).S(hx * f + 3, L + drop * (1 - f) - 2, P(0.15, 1), P(0.3, 1), 0.4).path()));
    if (vista === 'costas') {
      out.push(seam(line([0, cb], [0, 21]), false), trim('cursor', 0, cb + 1.4, false, 1.8));
      if (mod === 'reta') out.push(seam(line([0, L - 14], [0, L + drop]), false), seam(line([0, L - 14], [1.5, L - 15.5]), false));
    }
    return out;
  },
};

/* ------------------------------------------------------------------ */
/* Vestido                                                             */
/* ------------------------------------------------------------------ */

export const vestido: BaseDef = {
  id: 'vestido',
  label: 'Vestido',
  cat: 'Inteiras',
  options: [
    { key: 'manga', label: 'Manga', choices: [{ value: 'sem', label: 'Alça' }, { value: 'curta', label: 'Curta' }] },
    { key: 'saia', label: 'Saia', choices: [{ value: 'evase', label: 'Evasê' }, { value: 'reta', label: 'Reta' }, { value: 'gode', label: 'Godê' }] },
    { key: 'comprimento', label: 'Comprimento', min: 50, max: 150 },
  ],
  defaults: { manga: 'sem', saia: 'evase', comprimento: 100 },
  make(o, vista: Vista) {
    const L = Number(o.comprimento);
    let out0: { sp: Vec2; top: Vec2; bot: Vec2; ad: Vec2 } | null = null;
    const bust = 22.5, waistY = 38, waist = 18.5, hip = 24.5;
    const sem = o.manga === 'sem';
    const nw = sem ? 9.5 : 8.2;
    const front = vista === 'frente' ? (sem ? 13 : 10) : sem ? 9 : 3;
    const ua = P(bust, 22);
    const mod = o.saia as 'reta' | 'evase' | 'gode';
    const hx = mod === 'reta' ? hip + 1 : mod === 'evase' ? hip + (L - waistY) * 0.22 : hip + (L - waistY) * 0.45;
    const drop = mod === 'gode' ? 5 : mod === 'evase' ? 2 : 0.5;
    const b = pb(0, front).S(nw, 0, P(1, 0), P(0.4, -1), 0.5);
    let sp = P(nw + 4.8, 1.2);
    if (sem) b.L(sp.x, sp.y).S(ua.x, ua.y, P(0.12, 1), P(1, 0.25), 0.5);
    else {
      sp = P(bust - 3.6, 4.8);
      const ad = P(Math.cos(0.62), Math.sin(0.62));
      const top = P(sp.x + ad.x * 16, sp.y + ad.y * 16), bot = P(top.x - ad.y * 15, top.y + ad.x * 15);
      b.S(sp.x, sp.y, P(1, 0.4), P(1, 0.5), 0.4).S(top.x, top.y, P(0.5, 1), ad, 0.32).L(bot.x, bot.y).S(ua.x, ua.y, P(ua.x - bot.x, ua.y - bot.y), P(-0.3, -1), 0.3);
      out0 = { sp, top, bot, ad };
    }
    b.S(waist, waistY, P(-0.1, 1), P(0, 1), 0.45)
      .S(hx, L - drop * 0.3, P(0.18, 1), P((hx - waist) / (L - waistY), 1), 0.42)
      .S(hx - 1, L + 0.1, P(0, 1), P(-1, 0.1), 0.5)
      .S(0, L + drop, P(-1, 0.1), P(-1, 0), 0.4);
    const out: Shape[] = [body(b.path(), 'Vestido')];
    // costura da cintura e pences/recortes princesa
    out.push(seam(line([0, waistY], [waist, waistY])));
    out.push(seam(pb(nw + 2.2, 0.6).S(10, waistY, P(0.12, 1), P(-0.05, 1), 0.45).path()));
    out.push(seam(pb(10, waistY).S(11.5, waistY + 12, P(0.05, 1), P(0.1, 1), 0.4).path()));
    const neck = pb(nw, 0).S(0, front, P(-0.4, 1), P(-1, 0), 0.5);
    out.push(topstitch(parallelToAxis(neck.path(), 0.6), 'simples'));
    if (sem) out.push(topstitch(parallel(pb(sp.x, sp.y).S(ua.x, ua.y, P(0.12, 1), P(1, 0.25), 0.5).path(), -0.6), 'simples'));
    else if (out0) {
      out.push(seam(pb(out0.sp.x, out0.sp.y).S(ua.x, ua.y, P(-0.15, 1), P(0.55, 1), 0.42).path()));
      out.push(topstitch(line([out0.top.x - out0.ad.x * 2, out0.top.y - out0.ad.y * 2], [out0.bot.x - out0.ad.x * 2, out0.bot.y - out0.ad.y * 2]), 'simples'));
    }
    out.push(topstitch(parallelToAxis(pb(hx - 1, L + 0.1).S(0, L + drop, P(-1, 0.1), P(-1, 0), 0.4).path(), -2.2), 'simples'));
    if (mod === 'gode') for (const f of [0.4, 0.75]) out.push(fold(pb(waist * f + 3, waistY + 12).S(hx * f + 3, L + drop * (1 - f) - 3, P(0.15, 1), P(0.3, 1), 0.4).path()));
    if (vista === 'costas') out.push(seam(line([0, front], [0, waistY + 16]), false), trim('cursor', 0, front + 1.6, false, 1.8));
    return out;
  },
};
export const NEW_BASES: Record<string, BaseDef> = { camiseta, regata, camisa, moletom: moletomRaglan, calca, shorts, saia, vestido };
void W;
