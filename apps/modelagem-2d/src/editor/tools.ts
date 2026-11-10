import type { Icon } from '@tabler/icons-react';
import {
  IconArrowsHorizontal,
  IconArrowsJoin,
  IconLineDotted,
  IconBorderStyle2,
  IconChartArcs,
  IconCircleMinus,
  IconCirclePlus,
  IconFlipHorizontal,
  IconFold,
  IconHandStop,
  IconLayoutDistributeVertical,
  IconLineDashed,
  IconPointer,
  IconPolygon,
  IconRotateClockwise2,
  IconRulerMeasure,
  IconScissors,
  IconSeparatorVertical,
  IconSquare,
  IconTriangleInverted,
  IconVectorBezier2,
  IconVectorSpline,
  IconWalk,
  IconPhoto,
  IconCrosshair,
} from '@tabler/icons-react';
import type { Tool } from './store';

export interface ToolDef {
  id: Tool;
  label: string;
  /** Tecla de atalho (sem modificador). */
  key: string;
  group: 'Seleção' | 'Desenho' | 'Pontos e curvas' | 'Moldes' | 'Marcações e medidas';
  icon: Icon;
  /** Passos mostrados na barra de status. */
  hint: string;
}

export const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Seleção', key: 'V', group: 'Seleção', icon: IconPointer, hint: 'Clique num molde para selecionar e arrastar · arraste pontos e alças (Alt: alça independente) · setas movem 1 mm' },
  { id: 'pan', label: 'Mão (mover vista)', key: 'H', group: 'Seleção', icon: IconHandStop, hint: 'Arraste para mover a vista · roda do mouse: zoom' },

  { id: 'pen', label: 'Reta / polígono', key: 'P', group: 'Desenho', icon: IconPolygon, hint: 'Clique os cantos · Shift: 45° · digite distância e ângulo embaixo · clique no 1º ponto ou Enter fecha' },
  { id: 'curve', label: 'Curvatura', key: 'C', group: 'Desenho', icon: IconVectorSpline, hint: 'Clique os pontos: a curva passa por eles · Alt+clique = ponto de canto · clique no 1º ponto ou Enter fecha o molde' },
  { id: 'rect', label: 'Retângulo', key: 'R', group: 'Desenho', icon: IconSquare, hint: 'Arraste para desenhar · ou "Novo retângulo exato" no painel' },
  { id: 'internal', label: 'Linha interna', key: 'I', group: 'Desenho', icon: IconLineDashed, hint: 'Com um molde selecionado, clique os pontos da linha interna · Enter conclui' },

  { id: 'convert', label: 'Converter ponto (canto ⇄ curva)', key: 'K', group: 'Pontos e curvas', icon: IconVectorBezier2, hint: 'Clique num ponto: canto ⇄ curva · arraste a partir do ponto para puxar alças simétricas' },
  { id: 'addPoint', label: 'Adicionar ponto', key: '+', group: 'Pontos e curvas', icon: IconCirclePlus, hint: 'Clique sobre a borda: insere ponto no clique, a uma distância exata do canto mais próximo ou dividindo a borda em N partes (barra de controle)' },
  { id: 'coordPoint', label: 'Ponto por coordenada', key: 'B', group: 'Pontos e curvas', icon: IconCrosshair, hint: 'Clique no ponto de referência (canto, meio da borda, outro ponto) · digite X e Y em mm a partir dele · Enter cria o ponto interno (furo/marcação) · Esc cancela' },
  { id: 'removePoint', label: 'Remover ponto', key: '-', group: 'Pontos e curvas', icon: IconCircleMinus, hint: 'Clique num ponto para removê-lo' },

  { id: 'parallel', label: 'Paralelo', key: 'E', group: 'Desenho', icon: IconLineDotted, hint: 'Clique numa borda ou linha interna: cria a paralela na distância da barra de controle, do lado do mouse · Alt+clique: contorno paralelo do molde inteiro (vista, forro)' },
  { id: 'seam', label: 'Margem de costura', key: 'S', group: 'Moldes', icon: IconBorderStyle2, hint: 'Clique numa borda para aplicar a margem (valor na barra de controle) · Alt+clique remove a margem da borda' },
  { id: 'dart', label: 'Criar pence', key: 'D', group: 'Moldes', icon: IconTriangleInverted, hint: '1) clique na borda onde fica a boca da pence · 2) clique o ápice · largura na barra de controle' },
  { id: 'dartTransfer', label: 'Transferir pence', key: 'T', group: 'Moldes', icon: IconRotateClockwise2, hint: '1) clique na pence · 2) clique o novo ponto da borda — a pence gira pelo ápice' },
  { id: 'cut', label: 'Cortar molde', key: 'X', group: 'Moldes', icon: IconScissors, hint: '1) clique um ponto da borda · 2) clique outro ponto — o molde vira dois (com margem no corte)' },
  { id: 'join', label: 'Unir moldes', key: 'J', group: 'Moldes', icon: IconArrowsJoin, hint: '1) clique a borda do molde A · 2) clique a borda do molde B que costura nela' },
  { id: 'fold', label: 'Dobrar molde', key: 'F', group: 'Moldes', icon: IconFold, hint: '1) e 2) clique os dois pontos da linha de dobra · 3) clique a metade que fica' },
  { id: 'unfold', label: 'Desdobrar molde', key: 'U', group: 'Moldes', icon: IconFlipHorizontal, hint: 'Clique na borda reta que está na dobra (ex.: centro frente)' },
  { id: 'pleat', label: 'Prega', key: 'Q', group: 'Moldes', icon: IconLayoutDistributeVertical, hint: '1) e 2) clique as duas pontas da linha da prega · tipo (faca, macho, fêmea), sentido, leque e bico na barra de controle' },
  { id: 'spread', label: 'Abrir folga paralela', key: 'O', group: 'Moldes', icon: IconArrowsHorizontal, hint: '1) e 2) clique as pontas da linha de abertura · valor na barra de controle' },
  { id: 'walk', label: 'Andar molde', key: 'W', group: 'Moldes', icon: IconWalk, hint: '1) clique a costura do molde A perto do início · 2) clique a costura do molde B perto do mesmo início · mova o mouse ao longo da costura · clique pausa · setas ±1 mm (Shift 10) · N = próximo pique/canto · Esc sai' },
  { id: 'spreadRadial', label: 'Abrir folga em leque', key: 'L', group: 'Moldes', icon: IconChartArcs, hint: '1) clique onde abre (ex.: barra) · 2) clique o pivô (ex.: cintura) · valor na barra de controle' },

  { id: 'notch', label: 'Pique', key: 'N', group: 'Marcações e medidas', icon: IconSeparatorVertical, hint: 'Clique na borda: pique no clique, a uma distância exata do canto mais próximo ou dividindo a borda em N partes (barra de controle)' },
  { id: 'print', label: 'Estampa', key: 'A', group: 'Marcações e medidas', icon: IconPhoto, hint: 'Clique num molde sem estampa para importar a arte (localizada no ponto do clique) · arraste a arte para posicionar · tipo, arte por tamanho, largura, giro e sangria no painel Estampas' },
  { id: 'measure', label: 'Medir', key: 'M', group: 'Marcações e medidas', icon: IconRulerMeasure, hint: 'Arraste entre dois pontos para medir (atrai para os vértices) · Esc limpa' },
];

export const toolById = (id: Tool) => TOOLS.find((t) => t.id === id)!;
export const GROUPS = [...new Set(TOOLS.map((t) => t.group))];
