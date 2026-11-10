import { describe, expect, it } from 'vitest';
import { fmtInput, parseNum } from './store';

describe('números nos campos', () => {
  it('lê padrão brasileiro e internacional, com e sem milhar', () => {
    expect(parseNum('1500')).toBe(1500);
    expect(parseNum('1.500')).toBe(1500);
    expect(parseNum('1.500,5')).toBe(1500.5);
    expect(parseNum('1,500.5')).toBe(1500.5);
    expect(parseNum('12,5')).toBe(12.5);
    expect(parseNum('12.5')).toBe(12.5);
    expect(parseNum(' 0,25 ')).toBe(0.25);
    expect(parseNum('-3,5')).toBe(-3.5);
    expect(parseNum('abc')).toBeNull();
  });
  it('campo mostra sem separador de milhar e volta ao mesmo valor', () => {
    expect(fmtInput(1500, 0)).toBe('1500');
    expect(fmtInput(1500.25, 2)).toBe('1500,25');
    for (const v of [1500, 2400.5, 0.5, 12345.67]) expect(parseNum(fmtInput(v, 2))).toBeCloseTo(v, 9);
  });
});
