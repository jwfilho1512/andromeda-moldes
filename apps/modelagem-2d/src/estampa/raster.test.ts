import { describe, expect, it } from 'vitest';
import { deflateSync, inflateSync } from 'node:zlib';
import { tiffFile } from './raster';

describe('TIFF para gráfica', () => {
  it('cabeçalho, tags, resolução e faixas legíveis', () => {
    const w = 3, h = 5, rows = 2;
    const strips: Uint8Array[] = [];
    for (let r = 0; r < h; r += rows) {
      const n = Math.min(rows, h - r);
      strips.push(deflateSync(new Uint8Array(w * n * 3).fill(r + 1)));
    }
    const f = tiffFile(w, h, rows, strips, 150);
    const dv = new DataView(f.buffer);
    expect(String.fromCharCode(f[0]!, f[1]!)).toBe('II');
    expect(dv.getUint16(2, true)).toBe(42);
    const ifd = dv.getUint32(4, true);
    const n = dv.getUint16(ifd, true);
    const tags = new Map<number, { type: number; count: number; val: number }>();
    for (let i = 0; i < n; i++) {
      const p = ifd + 2 + i * 12;
      const type = dv.getUint16(p + 2, true), count = dv.getUint32(p + 4, true);
      tags.set(dv.getUint16(p, true), { type, count, val: type === 3 && count === 1 ? dv.getUint16(p + 8, true) : dv.getUint32(p + 8, true) });
    }
    expect([...tags.keys()]).toEqual([...tags.keys()].sort((a, b) => a - b)); // tags em ordem crescente
    expect(tags.get(256)!.val).toBe(3);
    expect(tags.get(257)!.val).toBe(5);
    expect(tags.get(259)!.val).toBe(8); // Deflate
    expect(tags.get(296)!.val).toBe(2); // polegada
    const xr = tags.get(282)!.val;
    expect(dv.getUint32(xr, true) / dv.getUint32(xr + 4, true)).toBe(150);
    const offs = tags.get(273)!.val, cnts = tags.get(279)!.val;
    for (let k = 0; k < strips.length; k++) {
      const o = dv.getUint32(offs + 4 * k, true), c = dv.getUint32(cnts + 4 * k, true);
      const px = inflateSync(f.subarray(o, o + c));
      expect(px[0]).toBe(k * rows + 1);
    }
  });
});
