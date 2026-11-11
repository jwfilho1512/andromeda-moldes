import { describe, expect, it, vi } from 'vitest';
import { createPiece, rect } from '@cad-textil/core';

// as regras rodam sem janela: troca as partes que falam com o sistema
vi.mock('../platform', () => ({ platform: { basesLoad: async () => null, basesSave: async () => true, importFile: async () => null, exportFile: async () => null } }));

const { emptyBases, makeBase, mergeBases, parseBases } = await import('./mybases');

const peca = () => ({ ...createPiece('p1', 'Frente', rect(0, 0, 250, 600)), seamAllowanceMm: 10 });

describe('Minhas bases', () => {
  it('guarda uma cópia dos moldes (o documento não muda junto)', () => {
    const p = peca();
    const b = makeBase({ nome: '  Calça da casa ', categoria: 'Calças', genero: 'feminino', descricao: '' }, [p]);
    expect(b.nome).toBe('Calça da casa');
    b.pecas[0]!.name = 'Mudou';
    expect(p.name).toBe('Frente');
  });

  it('lê pacotes, descarta bases estragadas e junta sem duplicar (a mais nova vence)', () => {
    const b = makeBase({ nome: 'Camisa', categoria: 'Camisaria', genero: 'masculino', descricao: '' }, [peca()]);
    const pack = parseBases(JSON.stringify({ ...emptyBases(), bases: [b, { id: 'x', nome: 'vazia', pecas: [] }] }));
    expect(pack.bases).toHaveLength(1);
    const r1 = mergeBases(emptyBases(), pack);
    expect([r1.added, r1.updated]).toEqual([1, 0]);
    const r2 = mergeBases(r1.file, pack);
    expect([r2.added, r2.updated]).toEqual([0, 0]);
    const newer = { ...b, nome: 'Camisa v2', atualizadaEm: new Date(Date.now() + 1000).toISOString() };
    const r3 = mergeBases(r2.file, { ...emptyBases(), bases: [newer] });
    expect(r3.updated).toBe(1);
    expect(r3.file.bases[0]!.nome).toBe('Camisa v2');
    expect(() => parseBases('{"format":"outro"}')).toThrow(/pacote de bases/);
  });
});
