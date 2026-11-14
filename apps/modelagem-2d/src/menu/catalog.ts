/**
 * CATÁLOGO DE FUNÇÕES: tudo o que o app faz, num lugar só. Alimenta o menu superior e a Ajuda.
 *
 * Cada entrada pode ter:
 *  - menu/section: onde aparece no menu superior (sem menu = só aparece na Ajuda, ex.: "como fazer barra de manga");
 *  - run/enabled: a ação e quando ela está disponível;
 *  - words: sinônimos e termos do dia a dia de modelagem para a busca da Ajuda;
 *  - steps: o passo a passo visual. Se não tiver, a Ajuda monta um (ferramenta → "clique aqui"; item de menu → abre o menu e aponta o item).
 *
 * Os alvos dos passos são elementos marcados com `data-help="…"` na interface.
 */
import type { Icon } from '@tabler/icons-react';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowsMinimize,
  IconBooks,
  IconCopy,
  IconDeviceFloppy,
  IconFileExport,
  IconFileImport,
  IconFilePlus,
  IconFlipHorizontal,
  IconFlipVertical,
  IconFolderOpen,
  IconHelp,
  IconInfoCircle,
  IconKeyboard,
  IconLayoutAlignBottom,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignMiddle,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLayoutDistributeHorizontal,
  IconLayoutDistributeVertical,
  IconLayoutGrid,
  IconMaximize,
  IconPhotoPlus,
  IconPlayerPlay,
  IconPrinter,
  IconRotate2,
  IconRotateClockwise2,
  IconSelectAll,
  IconSparkles,
  IconTrash,
  IconZoomScan,
  IconStack2,
  IconArrowsExchange,
} from '@tabler/icons-react';
import type { PrintMode } from '@cad-textil/core';
import { runCommand } from '../commands';
import { TOOLS } from '../editor/tools';
import { editor, notify, selectedIds, selectedPiece, setTheme, setUnit } from '../editor/store';
import {
  alignSelection,
  arrangeAll,
  deleteSelection,
  distributeSelection,
  invertSelection,
  mirrorSelection,
  rotateSelection,
  setTool,
} from '../editor/actions';
import { addPrint, importArtwork, purgeUnusedArtworks } from '../estampa/actions';
import { clearMarker, compact, exportForPrintShop, exportMarker, fillRemaining, risco, runNest } from '../risco/state';
import { ui } from './ui';

export type MenuName = 'Arquivo' | 'Editar' | 'Molde' | 'Ferramentas' | 'Estampa' | 'Exibir' | 'Risco' | 'Ajuda';
export const MENUS: MenuName[] = ['Arquivo', 'Editar', 'Molde', 'Ferramentas', 'Estampa', 'Exibir', 'Risco', 'Ajuda'];

export interface GuideStep {
  /** Elemento a destacar (`data-help`). Sem alvo: balão no centro da tela. */
  target?: string;
  text: string;
  /** Passo concluído (a Ajuda avança sozinha; se já estiver feito ao chegar, pula). */
  done?: () => boolean;
  /** Preparar a tela ao chegar no passo (ex.: abrir o menu). */
  enter?: () => void;
}

export interface Entry {
  id: string;
  label: string;
  menu?: MenuName;
  /** Título de grupo dentro do menu (aparece antes do primeiro item do grupo). */
  section?: string;
  /** Linha separadora antes do item. */
  sep?: boolean;
  /** Atalho mostrado no menu (o atalho em si é tratado pelo teclado/menu nativo). */
  key?: string;
  icon?: Icon;
  run?: () => void;
  enabled?: () => boolean;
  /** Opção marcada (✓) no menu, ex.: unidade e tema atuais. */
  checked?: () => boolean;
  /** Área de trabalho em que a função vive. */
  space?: 'modelagem' | 'risco';
  /** Precisa de molde selecionado. */
  needsPiece?: boolean;
  /** Termos para a busca da Ajuda. */
  words?: string;
  /** Resumo mostrado nos resultados da Ajuda. */
  about?: string;
  steps?: GuideStep[];
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';
const SHIFT = isMac ? '⇧' : 'Shift+';

const hasSel = () => selectedIds().length > 0;
const hasMany = () => selectedIds().length > 1;
const hasPieces = () => editor.get().doc.pieces.length > 0;
const cmd = (id: string) => () => void runCommand(id);
const inSpace = (w: 'modelagem' | 'risco') => () => editor.get().workspace === w;

async function newPrint(mode: PrintMode) {
  const p = selectedPiece();
  if (!p) return notify('Selecione um molde primeiro', 'error');
  const arts = editor.get().doc.artworks ?? [];
  const art = arts.length ? null : await importArtwork();
  addPrint(p.id, mode, art?.id ?? arts[arts.length - 1]?.id ?? null);
}

/* ------------------------------------------------------------------ */
/* Itens de menu                                                       */
/* ------------------------------------------------------------------ */

const menuEntries: Entry[] = [
  // Arquivo
  { id: 'new', label: 'Novo', menu: 'Arquivo', key: `${MOD}N`, icon: IconFilePlus, run: cmd('new'), words: 'arquivo novo comecar zero limpar' },
  { id: 'open', label: 'Abrir…', menu: 'Arquivo', key: `${MOD}O`, icon: IconFolderOpen, run: cmd('open'), words: 'abrir arquivo ctx carregar' },
  { id: 'save', label: 'Salvar', menu: 'Arquivo', key: `${MOD}S`, icon: IconDeviceFloppy, run: cmd('save'), sep: true, words: 'salvar gravar guardar arquivo' },
  { id: 'saveAs', label: 'Salvar como…', menu: 'Arquivo', key: `${SHIFT}${MOD}S`, run: cmd('saveAs'), words: 'salvar copia outro nome' },
  { id: 'library', label: 'Inserir base pronta…', menu: 'Arquivo', icon: IconBooks, sep: true, run: () => ui.set({ library: true }), space: 'modelagem', words: 'base pronta biblioteca camisa camiseta tshirt saia calca terno vestido molde base tabela medidas minhas bases', about: 'Bases do Andromeda e as Minhas bases da equipe', steps: [{ target: 'top:bases', text: 'Clique em Bases para abrir a biblioteca de bases prontas.', done: () => ui.get().library }, { text: 'Escolha a base, o tamanho e as medidas, e clique em Inserir.' }] },
  { id: 'saveBase', label: 'Salvar moldes como base…', menu: 'Arquivo', run: () => ui.set({ library: true }), enabled: hasPieces, space: 'modelagem', words: 'salvar base minha base biblioteca guardar molde reutilizar casa equipe adicionar nova base', about: 'Guarda os moldes selecionados (ou todos) em Minhas bases', steps: [{ target: 'stage', text: 'Selecione os moldes que vão virar a base (sem seleção, vão todos).' }, { target: 'top:bases', text: 'Clique em Bases.', done: () => ui.get().library }, { text: 'Em Minhas bases, clique em "+ Salvar moldes como base", dê nome, categoria e gênero e salve.' }] },
  { id: 'how:editarBase', label: 'Editar uma das Minhas bases', space: 'modelagem', words: 'editar base alterar mudar minha base atualizar moldes base da casa', steps: [{ target: 'top:bases', text: 'Clique em Bases e escolha a base em Minhas bases.', done: () => ui.get().library }, { text: 'Clique em Inserir, ajuste os moldes no documento, abra a biblioteca de novo e clique em "Atualizar com os moldes". Nome, categoria e observações dá para mudar direto lá.' }] },
  { id: 'importDxf', label: 'Importar DXF / DXF-AAMA…', menu: 'Arquivo', key: `${MOD}I`, icon: IconFileImport, run: cmd('importDxf'), words: 'importar dxf aama audaces gerber lectra optitex abrir molde outro programa' },
  { id: 'exportPlt', label: 'Exportar PLT (plotter)…', menu: 'Arquivo', key: `${MOD}E`, icon: IconPrinter, sep: true, run: cmd('exportPlt'), enabled: hasPieces, words: 'plotar plotter plt hpgl imprimir riscar papel' },
  { id: 'exportPltGraded', label: 'Exportar PLT com todos os tamanhos…', menu: 'Arquivo', run: cmd('exportPltGraded'), enabled: hasPieces, words: 'plotar tamanhos graduacao ninho plt' },
  { id: 'exportPdf', label: 'Exportar PDF 1:1…', menu: 'Arquivo', key: `${SHIFT}${MOD}E`, icon: IconFileExport, run: cmd('exportPdf'), enabled: hasPieces, words: 'pdf imprimir tamanho real escala' },
  { id: 'exportPdfA4', label: 'Exportar PDF em folhas A4…', menu: 'Arquivo', run: cmd('exportPdfA4'), enabled: hasPieces, words: 'pdf a4 imprimir impressora caseira folhas emendar colar' },
  { id: 'exportPdfA3', label: 'Exportar PDF em folhas A3…', menu: 'Arquivo', run: cmd('exportPdfA3'), enabled: hasPieces, words: 'pdf a3 imprimir folhas' },
  { id: 'exportDxf', label: 'Exportar DXF-AAMA (todos os tamanhos)…', menu: 'Arquivo', sep: true, run: cmd('exportDxf'), enabled: hasPieces, words: 'exportar dxf aama audaces enviar outro programa graduacao' },
  { id: 'exportDxfBase', label: 'Exportar DXF-AAMA (só tamanho base)…', menu: 'Arquivo', run: cmd('exportDxfBase'), enabled: hasPieces, words: 'exportar dxf base' },

  // Editar
  { id: 'undo', label: 'Desfazer', menu: 'Editar', key: `${MOD}Z`, icon: IconArrowBackUp, run: cmd('undo'), enabled: () => editor.get().past.length > 0, words: 'desfazer voltar errei ctrl z' },
  { id: 'redo', label: 'Refazer', menu: 'Editar', key: `${SHIFT}${MOD}Z`, icon: IconArrowForwardUp, run: cmd('redo'), enabled: () => editor.get().future.length > 0, words: 'refazer' },
  { id: 'selectAll', label: 'Selecionar todos os moldes', menu: 'Editar', key: `${MOD}A`, icon: IconSelectAll, sep: true, run: cmd('selectAll'), enabled: hasPieces, space: 'modelagem', words: 'selecionar tudo todos' },
  { id: 'invertSel', label: 'Inverter seleção', menu: 'Editar', run: invertSelection, enabled: hasPieces, space: 'modelagem', words: 'inverter selecao' },
  { id: 'duplicate', label: 'Duplicar', menu: 'Editar', key: `${MOD}D`, icon: IconCopy, run: cmd('duplicate'), enabled: hasSel, space: 'modelagem', needsPiece: true, words: 'duplicar copiar clonar repetir molde' },
  { id: 'delete', label: 'Excluir', menu: 'Editar', key: '⌫', icon: IconTrash, run: deleteSelection, enabled: hasSel, space: 'modelagem', needsPiece: true, words: 'excluir apagar deletar remover molde' },

  // Molde
  { id: 'rotCW', label: 'Girar 90° horário', menu: 'Molde', section: 'Transformar', icon: IconRotateClockwise2, run: () => rotateSelection(-90), enabled: hasSel, space: 'modelagem', needsPiece: true, words: 'girar rodar virar rotacionar 90 graus' },
  { id: 'rotCCW', label: 'Girar 90° anti-horário', menu: 'Molde', icon: IconRotate2, run: () => rotateSelection(90), enabled: hasSel, space: 'modelagem', needsPiece: true, words: 'girar rodar rotacionar anti horario' },
  { id: 'mirrorH', label: 'Espelhar na horizontal', menu: 'Molde', icon: IconFlipHorizontal, run: () => mirrorSelection('h'), enabled: hasSel, space: 'modelagem', needsPiece: true, words: 'espelhar inverter lado esquerdo direito refletir' },
  { id: 'mirrorV', label: 'Espelhar na vertical', menu: 'Molde', icon: IconFlipVertical, run: () => mirrorSelection('v'), enabled: hasSel, space: 'modelagem', needsPiece: true, words: 'espelhar cima baixo refletir' },
  { id: 'alignLeft', label: 'Alinhar à esquerda', menu: 'Molde', section: 'Alinhar (2 ou mais moldes)', sep: true, icon: IconLayoutAlignLeft, run: () => alignSelection('left'), enabled: hasMany, space: 'modelagem', words: 'alinhar esquerda' },
  { id: 'alignCX', label: 'Alinhar ao centro (horizontal)', menu: 'Molde', icon: IconLayoutAlignCenter, run: () => alignSelection('centerX'), enabled: hasMany, space: 'modelagem', words: 'alinhar centro meio' },
  { id: 'alignRight', label: 'Alinhar à direita', menu: 'Molde', icon: IconLayoutAlignRight, run: () => alignSelection('right'), enabled: hasMany, space: 'modelagem', words: 'alinhar direita' },
  { id: 'alignTop', label: 'Alinhar em cima', menu: 'Molde', icon: IconLayoutAlignTop, run: () => alignSelection('top'), enabled: hasMany, space: 'modelagem', words: 'alinhar topo cima' },
  { id: 'alignCY', label: 'Alinhar ao meio (vertical)', menu: 'Molde', icon: IconLayoutAlignMiddle, run: () => alignSelection('centerY'), enabled: hasMany, space: 'modelagem', words: 'alinhar meio' },
  { id: 'alignBottom', label: 'Alinhar embaixo', menu: 'Molde', icon: IconLayoutAlignBottom, run: () => alignSelection('bottom'), enabled: hasMany, space: 'modelagem', words: 'alinhar baixo' },
  { id: 'distX', label: 'Distribuir na horizontal', menu: 'Molde', icon: IconLayoutDistributeHorizontal, run: () => distributeSelection('x'), enabled: () => selectedIds().length > 2, space: 'modelagem', words: 'distribuir espacar igual' },
  { id: 'distY', label: 'Distribuir na vertical', menu: 'Molde', icon: IconLayoutDistributeVertical, run: () => distributeSelection('y'), enabled: () => selectedIds().length > 2, space: 'modelagem', words: 'distribuir espacar igual' },
  { id: 'arrange', label: 'Organizar todos os moldes lado a lado', menu: 'Molde', sep: true, icon: IconLayoutGrid, run: arrangeAll, enabled: hasPieces, space: 'modelagem', words: 'organizar arrumar espalhar lado a lado bagunca' },

  // Estampa
  { id: 'printLoc', label: 'Nova estampa localizada…', menu: 'Estampa', section: 'No molde selecionado', icon: IconPhotoPlus, run: () => void newPrint('localizada'), enabled: () => !!selectedPiece(), space: 'modelagem', needsPiece: true, words: 'estampa localizada logo silk arte numero aplicar imagem peito', steps: [{ target: 'panel:estampas', text: 'No painel Estampas, clique em Localizada e escolha a imagem (PNG ou JPEG).', done: () => (selectedPiece()?.prints?.length ?? 0) > 0 }, { target: 'tool:print', text: 'Com a ferramenta Estampa (A), arraste a arte para posicionar e puxe as alças para mudar o tamanho ou girar.' }] },
  { id: 'printTotal', label: 'Nova estampa total (molde inteiro)…', menu: 'Estampa', run: () => void newPrint('total'), enabled: () => !!selectedPiece(), space: 'modelagem', needsPiece: true, words: 'estampa total full print molde inteiro engenheirada sublimacao arte por tamanho' },
  { id: 'printRun', label: 'Nova estampa corrida…', menu: 'Estampa', run: () => void newPrint('corrida'), enabled: () => !!selectedPiece(), space: 'modelagem', needsPiece: true, words: 'estampa corrida rapport repeticao padrao modulo pattern' },
  { id: 'printTex', label: 'Nova textura (contínua no tecido)…', menu: 'Estampa', run: () => void newPrint('textura'), enabled: () => !!selectedPiece(), space: 'modelagem', needsPiece: true, words: 'textura estampa corrida continua tecido enfesto rapport' },
  { id: 'purgeArts', label: 'Limpar imagens não usadas', menu: 'Estampa', sep: true, run: () => notify(`${purgeUnusedArtworks()} imagem(ns) removida(s)`), enabled: () => (editor.get().doc.artworks?.length ?? 0) > 0, words: 'limpar imagens arquivo pesado tamanho' },

  // Exibir
  { id: 'fit', label: 'Ajustar à tela', menu: 'Exibir', key: `${MOD}0`, icon: IconZoomScan, run: cmd('fit'), words: 'zoom ajustar tela ver tudo enquadrar' },
  { id: 'realSize', label: 'Tamanho real (1:1 na tela)', menu: 'Exibir', key: `${MOD}1`, icon: IconMaximize, run: cmd('realSize'), words: 'tamanho real escala 1 1 regua tela' },
  { id: 'showGrade', label: 'Mostrar/ocultar ninho de tamanhos', menu: 'Exibir', sep: true, icon: IconStack2, run: () => editor.set({ showGrade: !editor.get().showGrade }), words: 'ninho graduacao tamanhos ver mostrar esconder' },
  { id: 'unitMm', label: 'Milímetros (mm)', menu: 'Exibir', section: 'Unidade de medida', sep: true, checked: () => editor.get().unit === 'mm', run: () => setUnit('mm'), words: 'unidade medida milimetro mm trocar' },
  { id: 'unitCm', label: 'Centímetros (cm)', menu: 'Exibir', checked: () => editor.get().unit === 'cm', run: () => setUnit('cm'), words: 'unidade medida centimetro cm trocar mudar', steps: [{ target: 'top:unit', text: 'Escolha a unidade aqui (mm, cm ou polegada). Vale para os campos, as cotas e as medidas na tela; o arquivo e o plotter continuam exatos.' }] },
  { id: 'unitIn', label: 'Polegadas (pol)', menu: 'Exibir', checked: () => editor.get().unit === 'pol', run: () => setUnit('pol'), words: 'unidade medida polegada inch trocar' },
  { id: 'themeDark', label: 'Tema escuro · papel claro', menu: 'Exibir', section: 'Tema', sep: true, checked: () => editor.get().theme === 'escuro', run: () => setTheme('escuro'), words: 'tema escuro cor interface' },
  { id: 'themeLight', label: 'Tema claro', menu: 'Exibir', checked: () => editor.get().theme === 'claro', run: () => setTheme('claro'), words: 'tema claro branco' },
  { id: 'themeBlack', label: 'Tema escuro total', menu: 'Exibir', checked: () => editor.get().theme === 'escuro-total', run: () => setTheme('escuro-total'), words: 'tema escuro total preto' },

  // Risco
  { id: 'goRisco', label: 'Ir para Risco e Encaixe', menu: 'Risco', icon: IconArrowsExchange, run: () => editor.set({ workspace: 'risco' }), enabled: () => editor.get().workspace !== 'risco', words: 'risco encaixe enfesto marker abrir aba', steps: [{ target: 'tab:risco', text: 'Clique na aba Risco e Encaixe.', done: inSpace('risco') }] },
  { id: 'goModelagem', label: 'Voltar para Modelagem', menu: 'Risco', run: () => editor.set({ workspace: 'modelagem' }), enabled: () => editor.get().workspace !== 'modelagem', words: 'voltar modelagem moldes' },
  { id: 'nest', label: 'Encaixe automático', menu: 'Risco', sep: true, icon: IconPlayerPlay, run: () => runNest(2), space: 'risco', words: 'encaixe automatico encaixar moldes tecido risco enfesto aproveitamento nesting', steps: [{ target: 'risco:nest', text: 'Clique em Encaixe automático. Antes, confira à esquerda a largura do tecido e a grade (tamanhos e quantidades).', done: () => risco.get().placements.length > 0 }] },
  { id: 'nest15', label: 'Otimizar por 15 s', menu: 'Risco', icon: IconSparkles, run: () => runNest(15), space: 'risco', words: 'otimizar encaixe melhor aproveitamento mais curto' },
  { id: 'fillRest', label: 'Encaixar restantes', menu: 'Risco', run: fillRemaining, space: 'risco', words: 'encaixar restantes faltando sobrando' },
  { id: 'compact', label: 'Compactar', menu: 'Risco', icon: IconArrowsMinimize, run: compact, space: 'risco', words: 'compactar apertar encurtar risco' },
  { id: 'clearMarker', label: 'Esvaziar o risco', menu: 'Risco', run: clearMarker, space: 'risco', words: 'limpar esvaziar risco recomecar' },
  { id: 'printShop', label: 'Arquivo para gráfica (sublimação)…', menu: 'Risco', sep: true, icon: IconPrinter, run: () => void exportForPrintShop(), space: 'risco', words: 'grafica sublimacao tiff pdf enfesto estampado imprimir papel transfer rip', about: 'Risco estampado em tamanho real (TIFF ou PDF)', steps: [{ target: 'risco:nest', text: 'Faça o encaixe primeiro (Encaixe automático).', done: () => risco.get().placements.length > 0 }, { target: 'risco:grafica', text: 'Clique em Arquivo para gráfica. Formato, resolução (dpi), encolhimento e espelho ficam no painel Sublimação.' }] },
  { id: 'markerPlt', label: 'Exportar PLT do risco…', menu: 'Risco', run: () => void exportMarker('plt'), space: 'risco', words: 'plotar risco plt plotter enfesto' },
  { id: 'markerPdf', label: 'Exportar PDF do risco…', menu: 'Risco', run: () => void exportMarker('pdf'), space: 'risco', words: 'pdf risco' },

  // Ajuda
  { id: 'help', label: 'O que você quer fazer?', menu: 'Ajuda', key: 'F1', icon: IconHelp, run: () => ui.set({ help: true }), words: 'ajuda duvida como' },
  { id: 'shortcuts', label: 'Atalhos do teclado', menu: 'Ajuda', icon: IconKeyboard, run: () => ui.set({ shortcuts: true }), words: 'atalhos teclas teclado' },
  { id: 'about', label: 'Sobre o Andromeda Moldes', menu: 'Ajuda', sep: true, icon: IconInfoCircle, run: () => notify('Andromeda Moldes · modelagem 2D, graduação, risco e encaixe'), words: 'sobre versao' },
];

/* ------------------------------------------------------------------ */
/* Ferramentas (da paleta)                                             */
/* ------------------------------------------------------------------ */

const TOOL_WORDS: Record<string, string> = {
  select: 'selecionar mover arrastar escolher molde ponto',
  pan: 'mao mover vista arrastar tela',
  pen: 'reta poligono linha desenhar molde novo cantos',
  curve: 'curva curvatura desenhar cava decote gancho',
  rect: 'retangulo quadrado desenhar molde novo',
  internal: 'linha interna marcacao bolso vista dentro',
  convert: 'converter ponto canto curva suavizar',
  addPoint: 'adicionar ponto inserir dividir borda',
  removePoint: 'remover ponto apagar ponto',
  coordPoint: 'ponto coordenada medida x y furo botao bolso marcacao posicao distancia',
  parallel: 'paralela paralelo vista forro contorno distancia',
  seam: 'margem costura bainha barra acabamento',
  dart: 'pence pinca criar bico recortar recortada acertar bico abrir pence pivo perpendicular profundidade contorno',
  innerDart: 'pence interna losango cintura vestido acinturar marcar furos',
  dartTransfer: 'transferir pence mover pence girar',
  cut: 'cortar dividir separar recortar molde recorte',
  join: 'unir juntar colar moldes',
  fold: 'dobrar meio dobra',
  unfold: 'desdobrar abrir dobra molde inteiro espelhar centro',
  pleat: 'prega pregas macho femea faca leque evase bico pregueado plissado',
  spread: 'folga abrir paralela aumentar largura',
  spreadRadial: 'folga leque evase godê rodado abrir',
  walk: 'andar molde conferir costura bater medida piques cava manga rolar',
  notch: 'pique piquete marcar encaixe costura',
  print: 'estampa arte imagem posicionar escala tamanho girar alcas',
  measure: 'medir medida regua distancia',
};

const RISCO_TOOLS = new Set<string>();

const toolEntries: Entry[] = TOOLS.map((t, i) => ({
  id: `tool:${t.id}`,
  label: t.label,
  menu: 'Ferramentas' as const,
  section: i === 0 || TOOLS[i - 1]!.group !== t.group ? t.group : undefined,
  sep: i > 0 && TOOLS[i - 1]!.group !== t.group,
  key: t.key,
  icon: t.icon,
  run: () => {
    editor.set({ workspace: 'modelagem' });
    setTool(t.id);
  },
  space: RISCO_TOOLS.has(t.id) ? ('risco' as const) : ('modelagem' as const),
  words: TOOL_WORDS[t.id] ?? '',
  about: t.hint.split(' · ')[0],
  steps: [
    { target: `tool:${t.id}`, text: `Clique aqui: ${t.label} (tecla ${t.key}).`, done: () => editor.get().tool === t.id },
    { target: 'stage', text: t.hint.replace(/ · /g, '\n') },
  ],
}));

/* ------------------------------------------------------------------ */
/* "Como fazer…" (só na Ajuda)                                         */
/* ------------------------------------------------------------------ */

const howTo: Entry[] = [
  {
    id: 'how:barra',
    label: 'Barra de manga / calça com cantos espelhados',
    space: 'modelagem',
    needsPiece: true,
    words: 'barra bainha manga calca saia cantos espelhados invertida margem diferente dobra hem',
    about: 'Margem de barra que encaixa nas laterais quando dobrada',
    steps: [
      { target: 'tool:seam', text: 'Escolha a ferramenta Margem de costura (S).', done: () => editor.get().tool === 'seam' },
      { target: 'ctrl', text: 'Na barra de controle, clique em Barra espelhada e digite a profundidade da barra no campo Margem (ex.: 30 mm).', done: () => editor.get().opts.seamHem },
      { target: 'stage', text: 'Clique na borda da barra do molde. Os cantos das laterais são rebatidos sobre a dobra.' },
    ],
  },
  {
    id: 'how:margem',
    label: 'Margem de costura numa borda',
    space: 'modelagem',
    words: 'margem costura borda valor diferente lateral ombro',
    steps: [
      { target: 'tool:seam', text: 'Escolha a ferramenta Margem de costura (S).', done: () => editor.get().tool === 'seam' },
      { target: 'ctrl', text: 'Digite o valor da margem na barra de controle (ex.: 10 mm).' },
      { target: 'stage', text: 'Clique em cada borda que leva essa margem. Alt+clique remove.' },
    ],
  },
  {
    id: 'how:estampaTamanho',
    label: 'Uma arte diferente para cada tamanho (P, M, G…)',
    space: 'modelagem',
    needsPiece: true,
    words: 'estampa arte por tamanho cada tamanho p m g sublimacao total graduacao diferente',
    steps: [
      { target: 'panel:estampas', text: 'No painel Estampas, crie a estampa (Total ou Localizada) se ainda não tiver.', done: () => (selectedPiece()?.prints?.length ?? 0) > 0 },
      { target: 'panel:estampas', text: 'Em Arte, troque "Todos os tamanhos" por cada tamanho e escolha a imagem de cada um. No risco, cada tamanho já sai com a sua arte.' },
    ],
  },
  {
    id: 'how:escalaEstampa',
    label: 'Mudar o tamanho da estampa com o mouse',
    space: 'modelagem',
    needsPiece: true,
    words: 'escala estampa tamanho aumentar diminuir arte mouse alcas girar redimensionar',
    steps: [
      { target: 'tool:print', text: 'Escolha a ferramenta Estampa (A).', done: () => editor.get().tool === 'print' },
      { target: 'stage', text: 'Puxe os cantos para escalar (Shift = livre, Alt = do centro), as laterais para só largura/altura, e a bolinha de cima para girar.' },
    ],
  },
  {
    id: 'how:graduar',
    label: 'Graduar o molde (tamanhos)',
    space: 'modelagem',
    needsPiece: true,
    words: 'graduar graduacao grade tamanhos regras ampliar reduzir p m g gg aumentar tamanho',
    steps: [
      { target: 'panel:graduacao', text: 'No painel Graduação, crie a grade do molde (tamanhos e tamanho base).' },
      { target: 'stage', text: 'Selecione um ponto do molde e digite o deslocamento dele por tamanho no painel. O ninho de tamanhos aparece na tela.' },
    ],
  },
  {
    id: 'how:conferir',
    label: 'Conferir se duas costuras batem',
    space: 'modelagem',
    words: 'conferir costura medida bater comparar andar molde diferenca piques',
    steps: [
      { target: 'panel:conferir', text: 'No painel Conferir costuras, escolha as bordas do lado A e do lado B: ele soma e mostra a diferença.' },
      { target: 'tool:walk', text: 'Ou use Andar molde (W) para andar um molde sobre o outro e conferir piques e cantos.' },
    ],
  },
  {
    id: 'how:sublimacao',
    label: 'Enfesto estampado para gráfica de sublimação',
    words: 'sublimacao grafica enfesto estampado papel tiff pdf rip imprimir risco estampado',
    steps: [
      { target: 'tab:risco', text: 'Vá para a aba Risco e Encaixe.', done: inSpace('risco') },
      { target: 'risco:nest', text: 'Confira a largura do tecido e a grade à esquerda e clique em Encaixe automático.', done: () => risco.get().placements.length > 0 },
      { target: 'risco:grafica', text: 'Clique em Arquivo para gráfica: sai em tamanho real (TIFF ou PDF) com as artes de cada tamanho.' },
    ],
  },
];

export const CATALOG: Entry[] = [...menuEntries, ...toolEntries, ...howTo];

export function entryById(id: string): Entry | undefined {
  return CATALOG.find((e) => e.id === id);
}

/** Executa uma entrada (e registra, para a Ajuda saber que o passo foi feito). */
export function runEntry(e: Entry): void {
  if (e.enabled && !e.enabled()) return;
  ui.set({ lastRun: e.id });
  e.run?.();
}

/** Passo a passo completo: área de trabalho e molde selecionado entram antes, quando precisam. */
export function guideSteps(e: Entry): GuideStep[] {
  const pre: GuideStep[] = [];
  if (e.space === 'risco') pre.push({ target: 'tab:risco', text: 'Vá para a aba Risco e Encaixe.', done: inSpace('risco') });
  if (e.space === 'modelagem') pre.push({ target: 'tab:modelagem', text: 'Vá para a aba Modelagem.', done: inSpace('modelagem') });
  if (e.needsPiece) pre.push({ target: 'stage', text: 'Clique num molde para selecioná-lo (ferramenta Seleção, tecla V).', done: () => !!selectedPiece() || selectedIds().length > 0 });
  if (e.steps) return [...pre, ...e.steps];
  if (e.menu) {
    const menu = e.menu;
    return [
      ...pre,
      {
        target: `menuitem:${e.id}`,
        text: `No menu ${menu}, clique em "${e.label.replace(/…$/, '')}"${e.key ? ` (atalho ${e.key})` : ''}.`,
        enter: () => ui.set({ menu }),
        done: () => ui.get().lastRun === e.id,
      },
    ];
  }
  return pre;
}
