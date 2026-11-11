/**
 * Busca da Ajuda: a pessoa escreve do jeito dela ("quero fazer a bainha da manga") e a busca
 * acha as funções. Sem internet: tira acentos e palavras vazias, junta sinônimos do vocabulário de
 * desenho de moda e pontua pelo nome da função, pelos termos e pelo resumo.
 */

export interface Searchable {
  id: string;
  label: string;
  words?: string;
  about?: string;
  section?: string;
  menu?: string;
}

const STOP = new Set(
  'quero queria quer como faco faz fazer fazendo o a os as um uma uns umas de do da dos das no na nos nas num numa em para pra pro pros por pelo pela eu meu minha meus minhas que e ou com sem se tem ter tenho preciso precisa gostaria posso pode consigo onde fica esta estao isso isto aquilo ao aos tipo coisa algo ai la aqui me te voce vc tudo todo toda ja so mais menos muito bem ate'.split(' '),
);

/** Sinônimos → termo canônico (vale para a pergunta e para o catálogo). */
const SYN: Record<string, string> = {
  bainha: 'barra', bainhas: 'barra', hem: 'barra', barrado: 'barra',
  imagem: 'importar', foto: 'importar', fotos: 'importar', svg: 'importar', illustrator: 'importar', corel: 'importar', inkscape: 'importar', trazer: 'importar',
  impressao: 'imprimir', impressora: 'imprimir', pdf: 'imprimir',
  apagar: 'excluir', deletar: 'excluir', remover: 'excluir', tirar: 'excluir',
  rodar: 'girar', rotacionar: 'girar', virar: 'girar', rotacao: 'girar',
  refletir: 'simetria', espelhado: 'simetria', espelhada: 'simetria', espelho: 'simetria', espelhar: 'simetria', simetrico: 'simetria', metade: 'simetria',
  gravar: 'salvar', guardar: 'salvar',
  ampliar: 'escala', redimensionar: 'escala', escalar: 'escala', aumentar: 'escala', diminuir: 'escala', reduzir: 'escala',
  peca: 'peca', pecas: 'peca', roupa: 'peca', roupas: 'peca', modelo: 'peca', base: 'peca', bases: 'peca',
  camiseta: 'camiseta', tshirt: 'camiseta', blusa: 'camiseta', camisa: 'camisa', calca: 'calca', jeans: 'calca', saia: 'saia', vestido: 'vestido', moletom: 'moletom', shorts: 'shorts', bermuda: 'shorts', regata: 'regata',
  copiar: 'duplicar', clonar: 'duplicar',
  dividir: 'cortar', separar: 'cortar', recortar: 'cortar', tesoura: 'cortar',
  zoom: 'tela', enquadrar: 'tela',
  atalho: 'atalhos', teclas: 'atalhos', tecla: 'atalhos',
  flat: 'tecnico', flats: 'tecnico', tecnica: 'tecnico',
  pespontar: 'pesponto', pespontos: 'pesponto', costura: 'pesponto', costuras: 'pesponto', costurar: 'pesponto', galoneira: 'pesponto', overloque: 'pesponto',
  botao: 'aviamento', botoes: 'aviamento', ilhos: 'aviamento', rebite: 'aviamento', ziper: 'aviamento', aviamentos: 'aviamento', colchete: 'aviamento', fivela: 'aviamento',
  tecido: 'tecidos', textura: 'tecidos', xadrez: 'tecidos', listra: 'tecidos', listras: 'tecidos', poa: 'tecidos', sarja: 'tecidos',
  pintar: 'preencher', colorir: 'preencher', balde: 'preencher',
  desenhar: 'desenho', rabiscar: 'desenho', esbocar: 'desenho', esboco: 'desenho', traco: 'desenho', tracar: 'desenho',
  brush: 'pincel', pinceis: 'pincel',
  medir: 'cota', medida: 'cota', medidas: 'cota', cotar: 'cota', cotas: 'cota', regua: 'cota',
  figurino: 'croqui', croquis: 'croqui', manequim: 'croqui', corpo: 'croqui', figura: 'croqui',
  gola: 'detalhe', golas: 'detalhe', bolso: 'detalhe', bolsos: 'detalhe', punho: 'detalhe', detalhes: 'detalhe',
  fichas: 'ficha', especificacao: 'ficha', techpack: 'ficha',
  camada: 'camadas', layer: 'camadas', layers: 'camadas',
};

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stem(w: string): string {
  if (SYN[w]) return SYN[w]!;
  let t = w;
  if (t.length > 4 && t.endsWith('coes')) t = t.slice(0, -4) + 'cao';
  else if (t.length > 4 && t.endsWith('oes')) t = t.slice(0, -3) + 'ao';
  else if (t.length > 4 && t.endsWith('es') && /[rsz]es$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith('s')) t = t.slice(0, -1);
  return SYN[t] ?? t;
}

export function tokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

interface Indexed<T> {
  item: T;
  fields: { toks: string[]; w: number }[];
}

function index<T extends Searchable>(items: T[]): Indexed<T>[] {
  return items.map((item) => ({
    item,
    fields: [
      { toks: tokens(item.label), w: 3 },
      { toks: tokens(item.words ?? ''), w: 2 },
      { toks: tokens(`${item.about ?? ''} ${item.section ?? ''} ${item.menu ?? ''}`), w: 1 },
    ],
  }));
}

function tokenScore(q: string, toks: string[]): number {
  let best = 0;
  for (const t of toks) {
    if (t === q) return 1;
    // começo de palavra (ex.: "estamp" → "estampa"; "girando" ↔ "girar")
    const n = Math.min(q.length, t.length);
    if (n >= 4) {
      let k = 0;
      while (k < n && q[k] === t[k]) k++;
      if (k >= 4 && (k === n || k >= Math.max(q.length, t.length) - 3)) best = Math.max(best, 0.6);
    }
  }
  return best;
}

/** Resultados em ordem de relevância (só os que têm alguma coisa a ver). */
export function searchEntries<T extends Searchable>(items: T[], query: string, limit = 8): T[] {
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const scored = index(items).map(({ item, fields }) => {
    let score = 0, hits = 0;
    for (const w of q) {
      let best = 0;
      for (const f of fields) best = Math.max(best, tokenScore(w, f.toks) * f.w);
      if (best > 0) hits++;
      score += best;
    }
    // quantas palavras da pergunta a função cobre pesa mais que uma palavra muito forte
    score *= 0.5 + (0.5 * hits) / q.length;
    return { item, score };
  });
  const best = Math.max(0, ...scored.map((s) => s.score));
  // corta o que ficou muito atrás do melhor (bateu só numa palavra de passagem)
  return scored
    .filter((s) => s.score > 0 && s.score >= best * 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item);
}
