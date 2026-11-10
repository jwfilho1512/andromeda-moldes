import type { Base } from './base.js';
import { FEMININO_M, GRADE, MASCULINO_M, type Genero, type Medidas, medidasDoTamanho } from './medidas.js';
import { gradingFromVariants, type Piece, type Vec2 } from '@cad-textil/core';
import { camisa, corpoBase, mangaBase, tshirt } from './superiores.js';
import { calca, saiaReta } from './inferiores.js';
import { paleto, terno } from './alfaiataria.js';

export * from './medidas.js';
export * from './base.js';
export { Outline, makePiece, smoothSegments, curveLength, pt } from './draft.js';
export { corpoBase, mangaBase, tshirt, camisa } from './superiores.js';
export { saiaReta, calca } from './inferiores.js';
export { paleto, terno } from './alfaiataria.js';

export interface CatalogEntry {
  id: string;
  nome: string;
  genero: Genero;
  categoria: Base['categoria'];
  gerar: (m?: Medidas) => Base;
  /** Base já graduada (todos os tamanhos da grade, base M). */
  gerarGraduada: () => Base;
}

/** Ponto fixo da gradação: início da linha do fio (vinco da calça, centro da manga…). */
const refPoint = (p: Piece): Vec2 => p.grainline?.[0] ?? p.outline.start;

/** Gera a base em todos os tamanhos e calcula as regras de cada ponto. */
export function graduar(f: (m: Medidas) => Base, genero: Genero): Base {
  const g = GRADE[genero];
  const variants = g.nomes.map((_, i) => f(medidasDoTamanho(genero, i)));
  const base = variants[g.base]!;
  const pecas = base.pecas.map((p) => {
    const vs = variants.map((b) => b.pecas.find((q) => q.id === p.id)!);
    const grading = gradingFromVariants(p, vs, g.nomes, g.base, refPoint);
    const group = `${base.nome} ${g.nomes[0]}–${g.nomes[g.nomes.length - 1]}`;
    return grading ? { ...p, grading, group } : { ...p, group };
  });
  return {
    ...base,
    tamanho: `${g.nomes[0]}–${g.nomes[g.nomes.length - 1]} (base ${g.nomes[g.base]})`,
    conferencias: [...base.conferencias, `Graduada em ${g.nomes.join(', ')} a partir das tabelas de medidas (passo de ${4} cm no busto/tórax)`],
    pecas,
  };
}

const tabela = (g: Genero) => (g === 'feminino' ? FEMININO_M : MASCULINO_M);
const entry = (genero: Genero, nome: string, categoria: Base['categoria'], f: (m: Medidas) => Base): CatalogEntry => ({
  id: `${f.name}-${genero}-${nome}`.toLowerCase().replace(/\s+/g, '-'),
  nome,
  genero,
  categoria,
  gerar: (m) => f(m ?? tabela(genero)),
  gerarGraduada: () => graduar(f, genero),
});

/** Catálogo de bases prontas (tamanho M). */
export const CATALOGO: CatalogEntry[] = [
  entry('feminino', 'Corpo base', 'Blocos', corpoBase),
  entry('feminino', 'Manga base', 'Blocos', mangaBase),
  entry('feminino', 'T-shirt', 'Malharia', tshirt),
  entry('feminino', 'Camisa', 'Camisaria', camisa),
  entry('feminino', 'Saia reta', 'Saias', saiaReta),
  entry('feminino', 'Calça', 'Calças', (m) => calca(m)),
  entry('feminino', 'Bermuda', 'Calças', (m) => calca(m, { bermuda: true })),
  entry('feminino', 'Blazer', 'Alfaiataria', paleto),
  entry('feminino', 'Terninho (blazer + calça)', 'Alfaiataria', terno),
  entry('masculino', 'Corpo base', 'Blocos', corpoBase),
  entry('masculino', 'Manga base', 'Blocos', mangaBase),
  entry('masculino', 'T-shirt', 'Malharia', tshirt),
  entry('masculino', 'Camisa social', 'Camisaria', camisa),
  entry('masculino', 'Calça social', 'Calças', (m) => calca(m)),
  entry('masculino', 'Bermuda', 'Calças', (m) => calca(m, { bermuda: true })),
  entry('masculino', 'Paletó', 'Alfaiataria', paleto),
  entry('masculino', 'Terno (paletó + calça)', 'Alfaiataria', terno),
];
