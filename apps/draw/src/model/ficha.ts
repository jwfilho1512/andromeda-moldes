/** Ficha técnica do produto (fica dentro do arquivo .adraw, junto do desenho). */

export type FichaStatus = 'rascunho' | 'desenvolvimento' | 'aprovada' | 'producao';

export interface Medida {
  /** Ponto de medida (POM), ex.: "Busto (1/2)". */
  pom: string;
  /** Tolerância ± (cm). */
  tol: number;
  /** Valor por tamanho (cm). */
  valores: Record<string, number | null>;
}

export interface Material {
  item: string;
  desc: string;
  cor: string;
  consumo: string;
  fornecedor: string;
}

export interface Aviamento {
  item: string;
  desc: string;
  cor: string;
  qtd: number;
  unidade: string;
}

export interface Operacao {
  op: string;
  maquina: string;
  /** Tempo padrão (minutos). */
  tempo: number;
}

export interface Cor {
  nome: string;
  codigo: string;
  hex: string;
}

export type Lavagem =
  | 'lavar30'
  | 'lavar40'
  | 'lavarMao'
  | 'naoLavar'
  | 'alvejante'
  | 'naoAlvejar'
  | 'secadora'
  | 'naoSecadora'
  | 'secarVaral'
  | 'secarSombra'
  | 'passarBaixa'
  | 'passarMedia'
  | 'naoPassar'
  | 'aSeco'
  | 'naoASeco';

export interface Ficha {
  ref: string;
  nome: string;
  colecao: string;
  marca: string;
  estilista: string;
  modelista: string;
  data: string;
  status: FichaStatus;
  tecido: string;
  composicao: string;
  gramatura: string;
  tamanhos: string[];
  tamanhoBase: string;
  medidas: Medida[];
  materiais: Material[];
  aviamentos: Aviamento[];
  sequencia: Operacao[];
  cores: Cor[];
  lavagem: Lavagem[];
  observacoes: string;
  /** Arquivo de moldes vinculado (Andromeda Moldes). */
  moldes: { path: string; name: string } | null;
  /** Consumo de tecido por peça (m), vindo do risco. */
  consumo: string;
}

export const STATUS_LABEL: Record<FichaStatus, string> = {
  rascunho: 'Rascunho',
  desenvolvimento: 'Em desenvolvimento',
  aprovada: 'Aprovada',
  producao: 'Em produção',
};

export function emptyFicha(): Ficha {
  const tamanhos = ['P', 'M', 'G'];
  const v = (...n: number[]) => Object.fromEntries(tamanhos.map((t, i) => [t, n[i] ?? null]));
  return {
    ref: '',
    nome: 'Novo produto',
    colecao: '',
    marca: '',
    estilista: '',
    modelista: '',
    data: new Date().toISOString().slice(0, 10),
    status: 'rascunho',
    tecido: '',
    composicao: '',
    gramatura: '',
    tamanhos,
    tamanhoBase: 'M',
    medidas: [
      { pom: 'Busto (1/2)', tol: 1, valores: v(48, 51, 54) },
      { pom: 'Comprimento total', tol: 1, valores: v(66, 68, 70) },
    ],
    materiais: [],
    aviamentos: [],
    sequencia: [],
    cores: [],
    lavagem: [],
    observacoes: '',
    moldes: null,
    consumo: '',
  };
}

/** Garante campos novos em arquivos antigos. */
export function normalizeFicha(f: Partial<Ficha> | undefined): Ficha {
  return { ...emptyFicha(), ...(f ?? {}) };
}
