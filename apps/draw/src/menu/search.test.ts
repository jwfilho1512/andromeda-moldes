import { describe, expect, it, vi } from 'vitest';

// a busca roda sem janela: troca as partes que falam com o sistema
vi.mock('../platform', () => ({ platform: { isDesktop: false, open: async () => null, importFile: async () => null, save: async () => null, exportFile: async () => null, printPdf: async () => null, pickLink: async () => null, openLinked: async () => null, confirmClose: async () => true, onMenu: () => () => {}, onOpenPath: () => () => {} } }));

const { CATALOG, MENUS, guideSteps } = await import('./catalog');
const { searchEntries } = await import('./search');

const top = (q: string, n = 3) => searchEntries(CATALOG, q, n).map((e) => e.id);

describe('Ajuda do Draw: busca em linguagem do dia a dia', () => {
  it.each([
    ['quero desenhar uma camiseta', 'how:pecaBase'],
    ['como faço o pesponto da barra', 'how:pespontoBarra'],
    ['pintar a calça de jeans', 'how:tecido'],
    ['colocar botões na camisa', 'how:botoes'],
    ['desenhar só metade da peça', 'how:simetria'],
    ['fazer um croqui', 'how:croqui'],
    ['colocar a medida no desenho', 'how:cota'],
    ['abrir arquivo do illustrator', 'how:illustrator'],
    ['imprimir a ficha técnica', 'how:ficha'],
    ['pincel', 'tool:brush'],
    ['tesoura para cortar a linha', 'tool:scissors'],
    ['atalhos do teclado', 'shortcuts'],
  ])('"%s" encontra %s', (q, id) => {
    expect(top(q)).toContain(id);
  });

  it('todo item de menu está num menu conhecido e tem passo a passo', () => {
    for (const e of CATALOG) {
      if (e.menu) expect(MENUS).toContain(e.menu);
      expect(guideSteps(e).length, e.id).toBeGreaterThan(0);
    }
    expect(new Set(CATALOG.map((e) => e.id)).size).toBe(CATALOG.length);
  });
});
