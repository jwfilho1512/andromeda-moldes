import { describe, expect, it, vi } from 'vitest';

vi.mock('../risco/state', () => ({ risco: { get: () => ({ placements: [] }) }, runNest: () => {}, fillRemaining: () => {}, compact: () => {}, clearMarker: () => {}, exportForPrintShop: async () => {}, exportMarker: async () => {} }));
vi.mock('../commands', () => ({ runCommand: async () => {} }));
vi.mock('../estampa/actions', () => ({ addPrint: () => null, importArtwork: async () => null, purgeUnusedArtworks: () => 0 }));
vi.mock('../editor/actions', () => ({ alignSelection: () => {}, arrangeAll: () => {}, deleteSelection: () => {}, distributeSelection: () => {}, invertSelection: () => {}, mirrorSelection: () => {}, rotateSelection: () => {}, setTool: () => {} }));

const { CATALOG } = await import('./catalog');
const { searchEntries } = await import('./search');

const top = (q: string, n = 3) => searchEntries(CATALOG, q, n).map((e) => e.id);

describe('Ajuda: busca em linguagem do dia a dia', () => {
  it.each([
    ['quero fazer a bainha da manga', 'how:barra'],
    ['como coloco uma estampa no molde', 'printLoc'],
    ['arte diferente pra cada tamanho', 'how:estampaTamanho'],
    ['aumentar a estampa com o mouse', 'how:escalaEstampa'],
    ['encaixar os moldes no tecido', 'nest'],
    ['arquivo pra gráfica de sublimação', 'printShop'],
    ['plotar', 'exportPlt'],
    ['pinça', 'tool:dart'],
    ['ponto por coordenada', 'tool:coordPoint'],
    ['marcar o botão a 5 cm do canto', 'tool:coordPoint'],
    ['girar o molde', 'rotCW'],
    ['abrir arquivo do audaces', 'importDxf'],
    ['base de camisa pronta', 'library'],
    ['graduar', 'how:graduar'],
    ['desfazer', 'undo'],
    ['piquete', 'tool:notch'],
  ])('"%s" → %s entre os primeiros', (q, id) => {
    expect(top(q)).toContain(id);
  });

  it('nada a ver não traz resultado', () => {
    expect(searchEntries(CATALOG, 'de para com')).toEqual([]);
  });

  it('toda função do catálogo tem id único', () => {
    const ids = CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
