/** Marca do Andromeda Moldes (mesmo desenho de build/icon.svg): frente do Corpo base feminino + estrela no ponto do busto. */
export const FRENTE =
  'M245.0,82.0L245.0,454.9L30.0,444.9L3.5,305.0L1.5,280.0L0.0,230.0L16.7,230.2L25.4,230.1L34.0,229.5L42.1,228.0L49.5,225.4L55.8,221.5L60.9,215.9L66.8,204.7L70.8,192.7L73.3,180.2L74.7,167.2L75.1,154.0L75.1,140.7L75.0,114.5L74.7,97.3L72.9,80.0L69.5,63.1L64.1,46.8L180.0,0.0L190.8,26.5L197.1,40.2L204.3,53.1L212.6,64.6L217.1,69.5L222.0,73.7L227.2,77.2L232.7,79.8L238.7,81.4Z';
const PENCES = 'M137.5,449.9L155.0,275.0L172.5,451.5M1.5,280.0L130.9,256.7L3.5,305.0';
const ESTRELA = 'M0,-1L0.22,-0.22L1,0L0.22,0.22L0,1L-0.22,0.22L-1,0L-0.22,-0.22Z';

export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="22" fill="#141a33" />
      <g transform="translate(31.6 15.9) scale(0.15)" fill="none" strokeLinejoin="round" strokeLinecap="round">
        <path stroke="#e9ecff" strokeWidth={17} d={FRENTE} />
        <path stroke="#8d9bff" strokeWidth={9} d={PENCES} />
      </g>
      <path fill="#ffd27a" transform="translate(54.9 53.4) scale(6.5)" d={ESTRELA} />
    </svg>
  );
}
