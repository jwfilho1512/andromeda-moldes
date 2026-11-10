/**
 * Tabelas de medidas do corpo (em CENTÍMETROS) — tamanho M.
 *
 * Valores de referência típicos da indústria de confecção brasileira para o tamanho M
 * (feminino 40, masculino 40/42). NÃO são uma norma: cada empresa deve substituir pela
 * própria tabela. Todas as bases são recalculadas a partir destes números.
 */
export type Genero = 'feminino' | 'masculino';

export interface Medidas {
  genero: Genero;
  tamanho: string;
  /** Circunferências */
  busto: number; // busto (fem) / tórax (masc)
  cintura: number;
  quadril: number;
  pescoco: number;
  braco: number; // bíceps
  punho: number;
  coxa: number;
  joelho: number;
  tornozelo: number;
  /** Larguras */
  ombro: number; // comprimento do ombro (pescoço → ponta do ombro)
  larguraCostas: number; // de cava a cava, nas costas
  larguraFrente: number; // de cava a cava, na frente
  separacaoBusto: number; // distância entre os ápices (fem)
  /** Alturas / comprimentos */
  alturaCostas: number; // nuca → cintura
  alturaFrente: number; // ombro (junto ao pescoço) → cintura, passando pelo busto
  alturaBusto: number; // ombro (junto ao pescoço) → ápice do busto
  profundidadeCava: number; // nuca → linha da cava
  comprimentoBraco: number; // ponta do ombro → punho
  alturaQuadril: number; // cintura → quadril
  alturaGancho: number; // cintura → assento (sentado)
  alturaJoelho: number; // cintura → joelho
  comprimentoCalca: number; // cintura → chão
  alturaTotal: number;
}

export const FEMININO_M: Medidas = {
  genero: 'feminino',
  tamanho: 'M (40)',
  busto: 88,
  cintura: 70,
  quadril: 96,
  pescoco: 36,
  braco: 28,
  punho: 16,
  coxa: 56,
  joelho: 37,
  tornozelo: 22,
  ombro: 12.5,
  larguraCostas: 35,
  larguraFrente: 33,
  separacaoBusto: 18,
  alturaCostas: 40,
  alturaFrente: 43,
  alturaBusto: 25,
  profundidadeCava: 21,
  comprimentoBraco: 59,
  alturaQuadril: 20,
  alturaGancho: 27,
  alturaJoelho: 58,
  comprimentoCalca: 102,
  alturaTotal: 164,
};

export const MASCULINO_M: Medidas = {
  genero: 'masculino',
  tamanho: 'M (40/42)',
  busto: 100,
  cintura: 88,
  quadril: 100,
  pescoco: 40,
  braco: 32,
  punho: 18,
  coxa: 58,
  joelho: 40,
  tornozelo: 24,
  ombro: 15,
  larguraCostas: 42,
  larguraFrente: 39,
  separacaoBusto: 20,
  alturaCostas: 45,
  alturaFrente: 46,
  alturaBusto: 0,
  profundidadeCava: 23.5,
  comprimentoBraco: 64,
  alturaQuadril: 20,
  alturaGancho: 27,
  alturaJoelho: 60,
  comprimentoCalca: 106,
  alturaTotal: 176,
};

export const ROTULOS: Record<keyof Omit<Medidas, 'genero' | 'tamanho'>, string> = {
  busto: 'Busto / tórax',
  cintura: 'Cintura',
  quadril: 'Quadril',
  pescoco: 'Pescoço',
  braco: 'Braço (bíceps)',
  punho: 'Punho',
  coxa: 'Coxa',
  joelho: 'Joelho',
  tornozelo: 'Tornozelo',
  ombro: 'Ombro',
  larguraCostas: 'Largura das costas',
  larguraFrente: 'Largura da frente',
  separacaoBusto: 'Separação do busto',
  alturaCostas: 'Altura das costas (nuca–cintura)',
  alturaFrente: 'Altura da frente',
  alturaBusto: 'Altura do busto',
  profundidadeCava: 'Profundidade da cava',
  comprimentoBraco: 'Comprimento do braço',
  alturaQuadril: 'Altura do quadril',
  alturaGancho: 'Altura do gancho',
  alturaJoelho: 'Altura do joelho',
  comprimentoCalca: 'Comprimento da calça',
  alturaTotal: 'Altura total',
};

/* ------------------------------------------------------------------ */
/* Grade de tamanhos                                                   */
/* ------------------------------------------------------------------ */

type Chave = keyof Omit<Medidas, 'genero' | 'tamanho'>;

/**
 * Diferença entre tamanhos vizinhos (cm) — valores típicos de mercado (grade de 4 cm no busto).
 * Também editáveis: a empresa substitui pela própria grade.
 */
export const PASSOS: Record<Genero, Record<Chave, number>> = {
  feminino: {
    busto: 4, cintura: 4, quadril: 4, pescoco: 1, braco: 1.5, punho: 0.5, coxa: 2, joelho: 1, tornozelo: 0.5,
    ombro: 0.4, larguraCostas: 1, larguraFrente: 1, separacaoBusto: 0.5,
    alturaCostas: 0.5, alturaFrente: 0.75, alturaBusto: 0.5, profundidadeCava: 0.5, comprimentoBraco: 0.5,
    alturaQuadril: 0.3, alturaGancho: 0.5, alturaJoelho: 0.5, comprimentoCalca: 0.5, alturaTotal: 1,
  },
  masculino: {
    busto: 4, cintura: 4, quadril: 4, pescoco: 1, braco: 1.5, punho: 0.5, coxa: 2, joelho: 1, tornozelo: 0.5,
    ombro: 0.5, larguraCostas: 1.5, larguraFrente: 1.5, separacaoBusto: 0.5,
    alturaCostas: 0.75, alturaFrente: 0.75, alturaBusto: 0, profundidadeCava: 0.75, comprimentoBraco: 1,
    alturaQuadril: 0.3, alturaGancho: 0.75, alturaJoelho: 0.75, comprimentoCalca: 1, alturaTotal: 2,
  },
};

export const GRADE: Record<Genero, { nomes: string[]; base: number; numeracao: string[] }> = {
  feminino: { nomes: ['PP', 'P', 'M', 'G', 'GG'], base: 2, numeracao: ['36', '38', '40', '42', '44'] },
  masculino: { nomes: ['P', 'M', 'G', 'GG', 'XGG'], base: 1, numeracao: ['38/40', '40/42', '44', '46', '48'] },
};

/** Tabela de medidas de um tamanho da grade (a partir do M + passos). */
export function medidasDoTamanho(genero: Genero, indice: number): Medidas {
  const g = GRADE[genero];
  const m = genero === 'feminino' ? FEMININO_M : MASCULINO_M;
  const k = indice - g.base;
  const out = { ...m, tamanho: `${g.nomes[indice]} (${g.numeracao[indice]})` } as Medidas;
  for (const [chave, passo] of Object.entries(PASSOS[genero]) as [Chave, number][]) out[chave] = Math.round((m[chave] + passo * k) * 100) / 100;
  return out;
}
