/**
 * Ícones próprios do Moldes, no mesmo formato dos Tabler (size, stroke, color),
 * para entrar na paleta junto com os outros.
 */
import { forwardRef } from 'react';
import type { Icon, IconProps } from '@tabler/icons-react';

/** Andar molde: duas cavas lado a lado (a do corpo e a da manga), com os piques no mesmo ponto. */
export const IconCavas = forwardRef<SVGSVGElement, IconProps>(function IconCavas({ size = 24, stroke = 2, color = 'currentColor', className, ...rest }, ref) {
  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} {...(rest as object)}>
      <path d="M3 3c0 7 3.5 11.5 9 12.5v5.5" />
      <path d="M9 3c0 7 3.5 11.5 9 12.5v5.5" />
      <path d="M4.2 10.6l2.2 -1.2" />
      <path d="M10.2 10.6l2.2 -1.2" />
    </svg>
  );
}) as unknown as Icon;

/** Pence interna: losango (triângulo de cima mais comprido que o de baixo) com o meio marcado. */
export const IconPenceInterna = forwardRef<SVGSVGElement, IconProps>(function IconPenceInterna({ size = 24, stroke = 2, color = 'currentColor', className, ...rest }, ref) {
  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} {...(rest as object)}>
      <path d="M12 2l4.5 12l-4.5 8l-4.5 -8z" />
      <path d="M5.5 14h2M16.5 14h2" />
    </svg>
  );
}) as unknown as Icon;
