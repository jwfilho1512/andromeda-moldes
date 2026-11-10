/**
 * Documento do Andromeda Draw. Unidade: mm, eixo Y para baixo (como no SVG).
 * Desenho técnico costuma ser feito em escala (ex.: 1:10 → 1 cm da peça = 1 mm no desenho).
 */
import type { Path, Vec2 } from '@cad-textil/core';
import type { Ficha } from './ficha';

export type { Path, Vec2 };

/** Pespontos e "trilhas" que acompanham um traço. */
export type StitchType =
  | 'simples'
  | 'duplo'
  | 'triplo'
  | 'zigue'
  | 'galoneira'
  | 'overloque'
  | 'corrente'
  | 'alinhavo'
  | 'ziper'
  | 'franzido'
  | 'elastico';

export interface StitchStyle {
  type: StitchType;
  /** Distância entre agulhas / largura do efeito (mm no desenho). */
  gap: number;
  /** Comprimento do ponto (mm no desenho). */
  len: number;
  /** Espessura da linha (mm). */
  width: number;
  color: string;
}

export type PatternKind =
  | 'listra-h'
  | 'listra-v'
  | 'xadrez'
  | 'vichy'
  | 'poa'
  | 'sarja'
  | 'canelado'
  | 'tricot'
  | 'pied-poule'
  | 'espinha'
  | 'matelasse'
  | 'onca';

export type Fill =
  | { kind: 'solid'; color: string }
  | { kind: 'pattern'; pattern: PatternKind; c1: string; c2: string; scale: number; angle: number };

export interface Style {
  stroke: string | null;
  /** Espessura do traço (mm). */
  width: number;
  fill: Fill | null;
  /** Traço tracejado (mm), ex.: [2, 1]. */
  dash?: number[];
}

export type TrimKind =
  | 'botao4'
  | 'botao2'
  | 'pressao'
  | 'botaoJeans'
  | 'ilhos'
  | 'rebite'
  | 'colchete'
  | 'fivela'
  | 'etiqueta'
  | 'cursor'
  | 'terminal'
  | 'velcro';

interface ShapeBase {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  /** Simetria: o desenho é espelhado em torno da vertical x = mirror (mm). */
  mirror?: number;
}

export interface PathShape extends ShapeBase {
  kind: 'path';
  path: Path;
  /** Caminho composto (ex.: forma com furo, vinda de SVG): demais subcaminhos. */
  subpaths?: Path[];
  fillRule?: 'nonzero' | 'evenodd';
  style: Style;
}

/** Imagem (foto, esboço escaneado, referência). `href` é data: URL. */
export interface ImageShape extends ShapeBase {
  kind: 'image';
  /** Canto superior esquerdo (mm). */
  at: Vec2;
  w: number;
  h: number;
  href: string;
  opacity: number;
}

export interface StitchShape extends ShapeBase {
  kind: 'stitch';
  /** Linha central do pesponto (já deslocada da borda). */
  path: Path;
  stitch: StitchStyle;
}

export interface TrimShape extends ShapeBase {
  kind: 'trim';
  trim: TrimKind;
  at: Vec2;
  /** Diâmetro / largura (mm no desenho). */
  size: number;
  rot: number;
  color: string;
}

export interface TextShape extends ShapeBase {
  kind: 'text';
  at: Vec2;
  text: string;
  size: number;
  color: string;
}

export interface GroupShape extends ShapeBase {
  kind: 'group';
  children: Shape[];
}

export type Shape = PathShape | StitchShape | TrimShape | TextShape | GroupShape | ImageShape;

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  shapes: Shape[];
}

export interface DrawDoc {
  format: 'andromeda-draw';
  version: 1;
  name: string;
  /** Prancha (mm). */
  artboard: { w: number; h: number };
  /** Escala do desenho em relação à peça real (10 = 1:10). */
  scale: number;
  layers: Layer[];
  ficha: Ficha;
}
