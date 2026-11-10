import { HPGL_UNITS_PER_MM } from '../units.js';
import { type PlotJob, jobBBox } from '../plot.js';

/**
 * Exportador HPGL / PLT.
 *
 * Unidade nativa: 1 plu = 0,025 mm (40 por mm). Coordenadas são inteiras, então o
 * erro máximo por ponto é ±0,0125 mm — abaixo da resolução mecânica de qualquer plotter.
 * O erro NÃO acumula: cada ponto é arredondado a partir da coordenada absoluta em mm.
 */
export interface HpglOptions {
  /** Margem a partir da origem do plotter, em mm. Padrão 10. */
  marginMm?: number;
  /** Incluir textos (comando LB). Alguns plotters de corte ignoram. Padrão true. */
  labels?: boolean;
  /** Número de caneta para cada camada. Padrão 1:1, 2:2, 3:3. */
  penMap?: Record<1 | 2 | 3, number>;
}

const ETX = '\x03';

/** Texto HPGL só aceita ASCII seguro; remove acentos e o terminador. */
function asciiSafe(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?').replace(/;/g, ',');
}

export function exportHpgl(job: PlotJob, opts: HpglOptions = {}): string {
  const margin = opts.marginMm ?? 10;
  const penMap = opts.penMap ?? { 1: 1, 2: 2, 3: 3 };
  const bb = jobBBox(job);
  // Desloca tudo para que o canto inferior-esquerdo fique em (margem, margem).
  const ox = margin - bb.minX;
  const oy = margin - bb.minY;
  const X = (mm: number) => Math.round((mm + ox) * HPGL_UNITS_PER_MM);
  const Y = (mm: number) => Math.round((mm + oy) * HPGL_UNITS_PER_MM);

  const out: string[] = ['IN;', 'PA;'];
  let currentPen = -1;
  const select = (pen: number) => {
    if (pen !== currentPen) {
      out.push(`SP${pen};`);
      currentPen = pen;
    }
  };

  // Agrupa por caneta para minimizar trocas.
  for (const layer of [1, 2] as const) {
    for (const s of job.strokes.filter((st) => st.pen === layer)) {
      if (s.points.length < 2) continue;
      select(penMap[layer]);
      const pts = s.closed ? [...s.points, s.points[0]!] : s.points;
      const [first, ...rest] = pts as [typeof pts[0], ...typeof pts];
      out.push(`PU${X(first.x)},${Y(first.y)};`);
      out.push(`PD${rest.map((p) => `${X(p.x)},${Y(p.y)}`).join(',')};`);
    }
  }

  if (opts.labels !== false && job.labels.length > 0) {
    select(penMap[3]);
    out.push('DT' + ETX + ';'); // terminador de rótulo
    for (const l of job.labels) {
      // SI: largura e altura do caractere em CENTÍMETROS.
      const hCm = l.heightMm / 10;
      out.push(`SI${(hCm * 0.7).toFixed(3)},${hCm.toFixed(3)};`);
      out.push('LO5;'); // centralizado
      out.push(`PU${X(l.at.x)},${Y(l.at.y)};`);
      out.push(`LB${asciiSafe(l.text)}${ETX}`);
    }
  }

  out.push('PU;', 'SP0;');
  return out.join('\n') + '\n';
}
