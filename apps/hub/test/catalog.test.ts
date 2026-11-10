import { describe, expect, it } from 'vitest';
import { APPS, type FoundFile, compareVersions, groupProducts, newDrawDoc, parseRelease, pickAsset, productFolderName } from '../electron/catalog';
import { normalizeFicha } from '../../draw/src/model/ficha';

const draw = APPS.find((a) => a.id === 'draw')!;
const moldes = APPS.find((a) => a.id === 'moldes')!;
const assets = [
  { name: 'Andromeda-Moldes-0.2.0-mac-arm64.dmg', url: 'u1', size: 1 },
  { name: 'Andromeda-Moldes-0.2.0-mac-x64.dmg', url: 'u2', size: 1 },
  { name: 'Andromeda-Moldes-0.2.0-windows-instalador.exe', url: 'u3', size: 1 },
  { name: 'Andromeda-Draw-0.2.0-mac-arm64.dmg', url: 'u4', size: 1 },
];

describe('instalador certo para cada computador', () => {
  it('Mac com chip Apple, Mac Intel e Windows', () => {
    expect(pickAsset(assets, moldes, 'darwin', 'arm64')?.url).toBe('u1');
    expect(pickAsset(assets, moldes, 'darwin', 'x64')?.url).toBe('u2');
    expect(pickAsset(assets, moldes, 'win32', 'x64')?.url).toBe('u3');
  });
  it('sem instalador publicado → null (não confunde Draw com Moldes)', () => {
    expect(pickAsset(assets, draw, 'win32', 'x64')).toBeNull();
    expect(pickAsset(assets, draw, 'darwin', 'x64')).toBeNull();
    expect(pickAsset(assets, draw, 'darwin', 'arm64')?.url).toBe('u4');
    expect(pickAsset(assets, draw, 'linux', 'x64')).toBeNull();
    // chip Apple sem versão própria usa a Intel (Rosetta)
    expect(pickAsset(assets.filter((a) => !a.name.includes('arm64')), moldes, 'darwin', 'arm64')?.url).toBe('u2');
  });
  it('lê a resposta do GitHub', () => {
    const r = parseRelease({ tag_name: 'v0.2.0', html_url: 'h', assets: [{ name: 'a', browser_download_url: 'b', size: 3 }] });
    expect(r).toEqual({ tag: 'v0.2.0', version: '0.2.0', page: 'h', assets: [{ name: 'a', url: 'b', size: 3 }] });
    expect(() => parseRelease({ message: 'Not Found' })).toThrow();
  });
});

describe('versões', () => {
  it('compara por partes numéricas', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0);
    expect(compareVersions('0.1.0', '0.1.1')).toBe(-1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });
});

describe('produtos', () => {
  const f = (path: string, kind: 'adraw' | 'ctx', mtime: number, ficha?: FoundFile['ficha']): FoundFile => ({ path, name: path.split('/').pop()!, dir: path.split('/').slice(0, -1).join('/'), mtime, kind, ficha });
  it('junta desenho e moldes pelo vínculo da ficha ou pela mesma pasta', () => {
    const ps = groupProducts([
      f('/w/0137/0137.adraw', 'adraw', 10, { ref: '0137', nome: 'Camiseta', status: 'aprovada', moldes: { path: '/w/outros/cam.ctx', name: 'cam.ctx' } }),
      f('/w/outros/cam.ctx', 'ctx', 5),
      f('/w/0142/0142.adraw', 'adraw', 20, { ref: '0142', nome: 'Calça' }),
      f('/w/0142/calca.ctx', 'ctx', 30),
      f('/w/solto.ctx', 'ctx', 1),
    ]);
    expect(ps.map((p) => p.ref)).toEqual(['0142', '0137', 'solto']);
    expect(ps[0]!.moldes).toEqual(['/w/0142/calca.ctx']);
    expect(ps[0]!.mtime).toBe(30);
    expect(ps[1]!.moldes).toEqual(['/w/outros/cam.ctx']);
    expect(ps[2]!.desenho).toBeNull();
  });
  it('dois desenhos na mesma pasta: moldes sem vínculo não são adivinhados', () => {
    const ps = groupProducts([f('/w/a.adraw', 'adraw', 1, {}), f('/w/b.adraw', 'adraw', 2, {}), f('/w/x.ctx', 'ctx', 3)]);
    expect(ps.find((p) => p.ref === 'x')?.desenho).toBeNull();
  });
  it('nome de pasta seguro', () => {
    expect(productFolderName('0201', 'Moletom: canguru/azul')).toBe('0201 - Moletom- canguru-azul');
    expect(productFolderName('', '')).toBe('Novo produto');
  });
  it('documento novo do Draw abre com a ficha completa', () => {
    const d = newDrawDoc('0201', 'Moletom', 'Inverno 27', { path: '/w/0201.ctx', name: '0201.ctx' });
    expect(d.format).toBe('andromeda-draw');
    const ficha = normalizeFicha(d.ficha as never);
    expect(ficha.ref).toBe('0201');
    expect(ficha.moldes?.name).toBe('0201.ctx');
    expect(ficha.medidas.length).toBeGreaterThan(0);
  });
});
