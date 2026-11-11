/**
 * CATÁLOGO DE FUNÇÕES do Andromeda Draw: tudo o que o app faz, num lugar só.
 * Alimenta o menu superior, a Ajuda ("O que você quer fazer?") e a janela de atalhos.
 *
 * Cada entrada pode ter:
 *  - menu/section: onde aparece no menu superior (sem menu = só na Ajuda, ex.: "como fazer pesponto na barra");
 *  - run/enabled/checked: a ação, quando está disponível e se está marcada (✓);
 *  - words: sinônimos do dia a dia para a busca da Ajuda;
 *  - steps: o passo a passo visual. Sem ele a Ajuda monta um (ferramenta → "clique aqui"; menu → abre e aponta).
 *
 * Os alvos dos passos são elementos marcados com `data-help="…"` na interface.
 */
import type { Icon } from '@tabler/icons-react';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBookmarks,
  IconBrandGithub,
  IconBug,
  IconCopy,
  IconDeviceFloppy,
  IconDownload,
  IconExternalLink,
  IconFileImport,
  IconFilePlus,
  IconFileText,
  IconFlipHorizontal,
  IconFlipVertical,
  IconFolderOpen,
  IconInfoCircle,
  IconKeyboard,
  IconLayoutAlignBottom,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignMiddle,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLink,
  IconMaximize,
  IconNeedleThread,
  IconPrinter,
  IconPuzzle,
  IconRotate2,
  IconRotateClockwise2,
  IconSearch,
  IconSelectAll,
  IconShirt,
  IconStack2,
  IconTexture,
  IconTrash,
  IconWand,
  IconCircleDot,
  IconWoman,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react';
import { exportFicha, exportPng, exportSvg, newDocument, openDocument, saveDocument } from '../commands';
import { importDialog } from '../importers';
import { rotateAbout, scaleAbout } from '../model/geom';
import {
  alignSelected,
  arrangeSelected,
  commit,
  deleteSelected,
  duplicateSelected,
  editor,
  expandMirrorSelected,
  groupSelected,
  redo,
  selectedShapes,
  setTool,
  undo,
  ungroupSelected,
  transformSelected,
} from '../state';
import { canvasApi } from '../ui/Canvas';
import { TOOLS } from '../ui/Chrome';
import { linkMoldesFile, openLinkedMoldes, pullTrimsFromDrawing } from '../ui/Ficha';
import { exportLibrary, importLibraryDialog } from '../userlib';
import { bboxOfShapes } from '../model/geom';
import { type LibCat, ui } from './ui';

export type MenuName = 'Arquivo' | 'Editar' | 'Objeto' | 'Ferramentas' | 'Biblioteca' | 'Exibir' | 'Ficha' | 'Ajuda';
export const MENUS: MenuName[] = ['Arquivo', 'Editar', 'Objeto', 'Ferramentas', 'Biblioteca', 'Exibir', 'Ficha', 'Ajuda'];

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
  section?: string;
  sep?: boolean;
  /** Atalho mostrado no menu (o atalho em si é tratado pelo teclado/menu nativo). */
  key?: string;
  icon?: Icon;
  run?: () => void;
  enabled?: () => boolean;
  checked?: () => boolean;
  /** A função vive na aba Desenho ou na Ficha técnica. */
  view?: 'desenho' | 'ficha';
  /** Precisa de algo selecionado. */
  needsSel?: boolean;
  words?: string;
  about?: string;
  steps?: GuideStep[];
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';
const SHIFT = isMac ? '⇧' : 'Shift+';
const REPO_URL = 'https://github.com/jwfilho1512/andromeda-moldes';

const hasSel = () => editor.get().selection.length > 0;
const hasMany = () => editor.get().selection.length > 1;
const inView = (v: 'desenho' | 'ficha') => () => editor.get().view === v;
const toDesenho = () => editor.set({ view: 'desenho' });
const selCenter = () => {
  const b = bboxOfShapes(selectedShapes());
  return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 };
};
const openLib = (cat: LibCat) => () => {
  toDesenho();
  ui.set({ libCat: cat });
};
const openExternal = (url: string) => () => window.open(url, '_blank', 'noopener');

const SIZES: [string, number, number][] = [
  ['A4 deitada', 297, 210],
  ['A4 em pé', 210, 297],
  ['A3 deitada', 420, 297],
  ['A3 em pé', 297, 420],
];

/* ------------------------------------------------------------------ */
/* Itens de menu                                                       */
/* ------------------------------------------------------------------ */

const menuEntries: Entry[] = [
  // Arquivo
  { id: 'new', label: 'Novo', menu: 'Arquivo', key: `${MOD}N`, icon: IconFilePlus, run: () => void newDocument(), words: 'arquivo novo comecar zero limpar' },
  { id: 'open', label: 'Abrir…', menu: 'Arquivo', key: `${MOD}O`, icon: IconFolderOpen, run: () => void openDocument(), words: 'abrir arquivo adraw carregar desenho' },
  { id: 'save', label: 'Salvar', menu: 'Arquivo', key: `${MOD}S`, icon: IconDeviceFloppy, run: () => void saveDocument(), sep: true, words: 'salvar gravar guardar arquivo' },
  { id: 'saveAs', label: 'Salvar como…', menu: 'Arquivo', key: `${SHIFT}${MOD}S`, run: () => void saveDocument(true), words: 'salvar copia outro nome' },
  { id: 'import', label: 'Importar SVG, imagem ou moldes…', menu: 'Arquivo', key: `${MOD}I`, icon: IconFileImport, sep: true, run: () => void importDialog(), words: 'importar svg illustrator corel inkscape figma imagem foto png jpg moldes ctx dxf abrir trazer vetor', about: 'SVG do Illustrator/Corel, foto ou moldes do Andromeda Moldes' },
  { id: 'exportSvg', label: 'Exportar SVG…', menu: 'Arquivo', key: `${MOD}E`, icon: IconDownload, sep: true, run: () => void exportSvg(), words: 'exportar svg vetor illustrator corel salvar desenho' },
  { id: 'exportPng', label: 'Exportar PNG…', menu: 'Arquivo', run: () => void exportPng(), words: 'exportar png imagem foto enviar whatsapp' },
  { id: 'exportFicha', label: 'Ficha técnica em PDF…', menu: 'Arquivo', key: `${MOD}P`, icon: IconPrinter, run: () => void exportFicha(), words: 'ficha tecnica pdf imprimir enviar fornecedor faccao' },

  // Editar
  { id: 'undo', label: 'Desfazer', menu: 'Editar', key: `${MOD}Z`, icon: IconArrowBackUp, run: undo, enabled: () => editor.get().past.length > 0, words: 'desfazer voltar errei' },
  { id: 'redo', label: 'Refazer', menu: 'Editar', key: `${SHIFT}${MOD}Z`, icon: IconArrowForwardUp, run: redo, enabled: () => editor.get().future.length > 0, words: 'refazer' },
  { id: 'duplicate', label: 'Duplicar', menu: 'Editar', key: `${MOD}D`, icon: IconCopy, sep: true, run: () => duplicateSelected(), enabled: hasSel, words: 'duplicar copiar clonar repetir' },
  { id: 'delete', label: 'Excluir', menu: 'Editar', key: 'Delete', icon: IconTrash, run: deleteSelected, enabled: hasSel, words: 'excluir apagar deletar remover' },
  {
    id: 'selectAll',
    label: 'Selecionar tudo',
    menu: 'Editar',
    key: `${MOD}A`,
    icon: IconSelectAll,
    sep: true,
    run: () => {
      const s = editor.get();
      editor.set({ view: 'desenho', selection: s.doc.layers.filter((l) => l.visible && !l.locked).flatMap((l) => l.shapes.map((x) => x.id)) });
    },
    words: 'selecionar tudo todos',
  },
  { id: 'deselect', label: 'Desmarcar', menu: 'Editar', key: 'Esc', run: () => editor.set({ selection: [] }), enabled: hasSel, words: 'desmarcar tirar selecao' },

  // Objeto
  { id: 'group', label: 'Agrupar', menu: 'Objeto', key: `${MOD}G`, icon: IconStack2, run: groupSelected, enabled: hasMany, words: 'agrupar juntar grupo' },
  { id: 'ungroup', label: 'Desagrupar', menu: 'Objeto', key: `${SHIFT}${MOD}G`, run: ungroupSelected, enabled: () => selectedShapes().some((x) => x.kind === 'group'), words: 'desagrupar separar grupo' },
  { id: 'expandMirror', label: 'Expandir simetria', menu: 'Objeto', run: expandMirrorSelected, enabled: () => selectedShapes().some((x) => x.mirror !== undefined || (x.kind === 'group' && x.children.some((c) => c.mirror !== undefined))), words: 'expandir simetria lado diferente assimetrico mudar so um lado', about: 'O lado espelhado vira desenho próprio, para mudar só um lado' },
  { id: 'front', label: 'Trazer para frente', menu: 'Objeto', section: 'Organizar', sep: true, run: () => arrangeSelected(1), enabled: hasSel, words: 'frente cima ordem empilhar' },
  { id: 'back', label: 'Enviar para trás', menu: 'Objeto', run: () => arrangeSelected(-1), enabled: hasSel, words: 'tras atras baixo ordem' },
  { id: 'flipH', label: 'Espelhar na horizontal', menu: 'Objeto', section: 'Transformar', sep: true, icon: IconFlipVertical, run: () => transformSelected(scaleAbout(selCenter(), -1, 1)), enabled: hasSel, words: 'espelhar inverter horizontal virar lado' },
  { id: 'flipV', label: 'Espelhar na vertical', menu: 'Objeto', icon: IconFlipHorizontal, run: () => transformSelected(scaleAbout(selCenter(), 1, -1)), enabled: hasSel, words: 'espelhar inverter vertical cabeca para baixo' },
  { id: 'rotR', label: 'Girar 15° (horário)', menu: 'Objeto', icon: IconRotateClockwise2, run: () => transformSelected(rotateAbout(selCenter(), 15)), enabled: hasSel, words: 'girar rodar rotacionar horario' },
  { id: 'rotL', label: 'Girar 15° (anti-horário)', menu: 'Objeto', icon: IconRotate2, run: () => transformSelected(rotateAbout(selCenter(), -15)), enabled: hasSel, words: 'girar rodar rotacionar anti horario' },
  { id: 'alignL', label: 'Alinhar à esquerda', menu: 'Objeto', section: 'Alinhar (vários: entre si · um: na prancha)', sep: true, icon: IconLayoutAlignLeft, run: () => alignSelected('left'), enabled: hasSel, words: 'alinhar esquerda' },
  { id: 'alignC', label: 'Centralizar na horizontal', menu: 'Objeto', icon: IconLayoutAlignCenter, run: () => alignSelected('hcenter'), enabled: hasSel, words: 'alinhar centro centralizar meio horizontal' },
  { id: 'alignR', label: 'Alinhar à direita', menu: 'Objeto', icon: IconLayoutAlignRight, run: () => alignSelected('right'), enabled: hasSel, words: 'alinhar direita' },
  { id: 'alignT', label: 'Alinhar em cima', menu: 'Objeto', icon: IconLayoutAlignTop, run: () => alignSelected('top'), enabled: hasSel, words: 'alinhar topo cima' },
  { id: 'alignM', label: 'Centralizar na vertical', menu: 'Objeto', icon: IconLayoutAlignMiddle, run: () => alignSelected('vcenter'), enabled: hasSel, words: 'alinhar meio centro vertical' },
  { id: 'alignB', label: 'Alinhar embaixo', menu: 'Objeto', icon: IconLayoutAlignBottom, run: () => alignSelected('bottom'), enabled: hasSel, words: 'alinhar base baixo' },

  // Biblioteca
  { id: 'lib:minha', label: 'Minha biblioteca', menu: 'Biblioteca', icon: IconBookmarks, run: openLib('minha'), checked: () => ui.get().libCat === 'minha', words: 'minha biblioteca meus desenhos assets salvar guardar equipe proprio personalizado', about: 'Seus desenhos e os da equipe, para usar em qualquer documento' },
  { id: 'libSave', label: 'Salvar a seleção na Minha biblioteca…', menu: 'Biblioteca', icon: IconDeviceFloppy, run: openLib('minha'), enabled: hasSel, words: 'salvar guardar desenho biblioteca asset reutilizar' },
  { id: 'libImport', label: 'Importar SVG ou pacote para a biblioteca…', menu: 'Biblioteca', icon: IconFileImport, run: () => (openLib('minha')(), void importLibraryDialog('pecas')), words: 'importar biblioteca svg pacote adrawlib colega equipe' },
  { id: 'libExport', label: 'Exportar pacote da biblioteca…', menu: 'Biblioteca', icon: IconDownload, run: () => void exportLibrary(), words: 'exportar biblioteca pacote compartilhar colega equipe enviar' },
  { id: 'lib:bases', label: 'Peças base (camiseta, calça, vestido…)', menu: 'Biblioteca', sep: true, icon: IconShirt, run: openLib('bases'), checked: () => ui.get().libCat === 'bases', words: 'peca base camiseta camisa calca saia vestido moletom regata shorts modelo pronto biblioteca desenho tecnico', about: 'Peças paramétricas: escolha gola, manga, medidas e insira' },
  { id: 'lib:detalhes', label: 'Detalhes (golas, bolsos, punhos…)', menu: 'Biblioteca', icon: IconPuzzle, run: openLib('detalhes'), checked: () => ui.get().libCat === 'detalhes', words: 'detalhe gola bolso punho passante ziper cordao' },
  { id: 'lib:pespontos', label: 'Pespontos', menu: 'Biblioteca', icon: IconNeedleThread, run: openLib('pespontos'), checked: () => ui.get().libCat === 'pespontos', words: 'pesponto costura galoneira overloque zigue zague corrente' },
  { id: 'lib:aviamentos', label: 'Aviamentos', menu: 'Biblioteca', icon: IconCircleDot, run: openLib('aviamentos'), checked: () => ui.get().libCat === 'aviamentos', words: 'aviamento botao ilhos rebite colchete fivela etiqueta' },
  { id: 'lib:tecidos', label: 'Tecidos', menu: 'Biblioteca', icon: IconTexture, run: openLib('tecidos'), checked: () => ui.get().libCat === 'tecidos', words: 'tecido jeans xadrez listra poa estampa preencher textura' },
  { id: 'lib:croquis', label: 'Croquis', menu: 'Biblioteca', icon: IconWoman, run: openLib('croquis'), checked: () => ui.get().libCat === 'croquis', words: 'croqui figura corpo manequim 9 cabecas proporcao' },

  // Exibir
  { id: 'viewDesenho', label: 'Desenho', menu: 'Exibir', checked: inView('desenho'), run: toDesenho, words: 'desenho voltar prancha' },
  { id: 'viewFicha', label: 'Ficha técnica', menu: 'Exibir', checked: inView('ficha'), run: () => editor.set({ view: 'ficha' }), words: 'ficha tecnica abrir ver' },
  { id: 'fit', label: 'Ajustar à tela', menu: 'Exibir', key: `${MOD}0`, icon: IconMaximize, sep: true, run: () => (toDesenho(), setTimeout(() => canvasApi.fit(), 0)), words: 'ajustar tela enquadrar ver tudo zoom' },
  { id: 'zoomIn', label: 'Aproximar', menu: 'Exibir', key: `${MOD}+`, icon: IconZoomIn, run: () => canvasApi.zoom(1.4), enabled: inView('desenho'), words: 'aproximar zoom aumentar ver detalhe' },
  { id: 'zoomOut', label: 'Afastar', menu: 'Exibir', key: `${MOD}−`, icon: IconZoomOut, run: () => canvasApi.zoom(1 / 1.4), enabled: inView('desenho'), words: 'afastar zoom diminuir' },
  { id: 'symmetry', label: 'Simetria ligada', menu: 'Exibir', key: `${SHIFT}M`, sep: true, checked: () => editor.get().symmetry, run: () => editor.set((s) => ({ symmetry: !s.symmetry })), words: 'simetria espelho metade lado igual desenhar meia peca' },
  ...SIZES.map(([name, w, h], i): Entry => ({
    id: `size:${name}`,
    label: `Prancha ${name}`,
    menu: 'Exibir',
    section: i === 0 ? 'Documento' : undefined,
    sep: i === 0,
    checked: () => editor.get().doc.artboard.w === w && editor.get().doc.artboard.h === h,
    run: () => commit((d) => ({ ...d, artboard: { w, h } })),
    words: `prancha papel folha tamanho ${name}`,
  })),
  ...[5, 10].map((k, i): Entry => ({
    id: `scale:${k}`,
    label: `Escala 1:${k}`,
    menu: 'Exibir',
    sep: i === 0,
    checked: () => editor.get().doc.scale === k,
    run: () => commit((d) => ({ ...d, scale: k })),
    words: `escala 1:${k} tamanho real proporcao`,
  })),
  { id: 'themeDark', label: 'Tema escuro', menu: 'Exibir', sep: true, checked: () => editor.get().theme === 'escuro', run: () => setTheme('escuro'), words: 'tema escuro preto noite' },
  { id: 'themeLight', label: 'Tema claro', menu: 'Exibir', checked: () => editor.get().theme === 'claro', run: () => setTheme('claro'), words: 'tema claro branco dia' },

  // Ficha
  { id: 'fichaOpen', label: 'Abrir a ficha técnica', menu: 'Ficha', icon: IconFileText, run: () => editor.set({ view: 'ficha' }), words: 'ficha tecnica abrir preencher medidas materiais' },
  { id: 'fichaTrims', label: 'Contar aviamentos do desenho', menu: 'Ficha', icon: IconWand, run: pullTrimsFromDrawing, words: 'contar aviamentos botoes quantidade ficha automatico' },
  { id: 'fichaLink', label: 'Vincular arquivo de moldes (.ctx)…', menu: 'Ficha', icon: IconLink, sep: true, run: () => void linkMoldesFile(), words: 'vincular ligar moldes ctx modelagem referencia' },
  { id: 'fichaMoldes', label: 'Abrir no Andromeda Moldes', menu: 'Ficha', icon: IconExternalLink, run: () => void openLinkedMoldes(), enabled: () => !!editor.get().doc.ficha.moldes, words: 'abrir moldes modelagem andromeda moldes ctx' },
  { id: 'fichaPdf', label: 'Ficha técnica em PDF…', menu: 'Ficha', key: `${MOD}P`, icon: IconPrinter, sep: true, run: () => void exportFicha(), words: 'ficha pdf imprimir' },

  // Ajuda
  { id: 'helpSearch', label: 'O que você quer fazer?', menu: 'Ajuda', key: 'F1', icon: IconSearch, run: () => ui.set({ help: true }), words: 'ajuda como fazer duvida' },
  { id: 'shortcuts', label: 'Atalhos do teclado', menu: 'Ajuda', icon: IconKeyboard, run: () => ui.set({ shortcuts: true }), words: 'atalhos teclado teclas' },
  { id: 'site', label: 'Código aberto no GitHub', menu: 'Ajuda', icon: IconBrandGithub, sep: true, run: openExternal(REPO_URL), words: 'site codigo github projeto' },
  { id: 'issue', label: 'Relatar um problema', menu: 'Ajuda', icon: IconBug, run: openExternal(`${REPO_URL}/issues`), words: 'problema erro bug relatar' },
  { id: 'about', label: 'Sobre o Andromeda Draw', menu: 'Ajuda', icon: IconInfoCircle, sep: true, run: () => ui.set({ about: true }), words: 'sobre versao' },
];

function setTheme(theme: 'escuro' | 'claro') {
  editor.set({ theme });
  try {
    localStorage.setItem('draw.theme', theme);
  } catch {
    /* sem armazenamento local */
  }
}

/* ------------------------------------------------------------------ */
/* Ferramentas                                                         */
/* ------------------------------------------------------------------ */

const TOOL_WORDS: Record<string, string> = {
  select: 'selecionar mover arrastar escalar tamanho',
  direct: 'editar ponto pontos curva alca ajustar forma',
  pen: 'caneta bezier curva desenhar contorno ponto',
  curvature: 'curvatura curva suave passar pontos',
  pencil: 'lapis mao livre desenho rabisco esboco',
  brush: 'pincel caligrafico afinado marcador grafite croqui traco artistico',
  line: 'linha reta',
  arc: 'arco curva',
  rect: 'retangulo quadrado',
  ellipse: 'elipse circulo oval',
  polygon: 'poligono estrela hexagono',
  text: 'texto escrever letra',
  dim: 'cota medida medir regua tamanho real',
  stitch: 'pesponto costura galoneira overloque',
  trim: 'aviamento botao ilhos rebite',
  fill: 'balde tecido preencher pintar',
  eyedropper: 'conta gotas copiar estilo cor',
  scissors: 'tesoura cortar dividir',
  hand: 'mao mover vista',
};

const toolEntries: Entry[] = TOOLS.map((t, i) => ({
  id: `tool:${t.id}`,
  label: t.label,
  menu: 'Ferramentas' as MenuName,
  sep: ['pen', 'line', 'text', 'stitch', 'eyedropper'].includes(t.id) && i > 0,
  key: t.key,
  icon: t.icon as Icon,
  view: 'desenho' as const,
  checked: () => editor.get().tool === t.id,
  run: () => {
    toDesenho();
    setTool(t.id);
  },
  words: TOOL_WORDS[t.id] ?? '',
  about: t.hint,
  steps: [
    { target: `tool:${t.id}`, text: `Escolha a ferramenta ${t.label} (tecla ${t.key}).`, done: () => editor.get().tool === t.id },
    { target: 'stage', text: t.hint },
  ],
}));

/* ------------------------------------------------------------------ */
/* Como fazer (só na Ajuda)                                            */
/* ------------------------------------------------------------------ */

const toolStep = (id: string, label: string, key: string): GuideStep => ({ target: `tool:${id}`, text: `Escolha a ferramenta ${label} (tecla ${key}).`, done: () => editor.get().tool === id });

const howTo: Entry[] = [
  {
    id: 'how:minhaBiblioteca',
    label: 'Guardar meus desenhos na biblioteca (peças, golas, bolsos…)',
    view: 'desenho',
    words: 'guardar salvar meus desenhos biblioteca propria asset reutilizar peca base nova adicionar equipe',
    steps: [
      { target: 'stage', text: 'Desenhe (ou importe) a peça e selecione com a Seleção (V).', done: hasSel },
      { target: 'lib:minha', text: 'Na biblioteca, abra Minha biblioteca.', done: () => ui.get().libCat === 'minha' },
      { target: 'lib:salvar', text: 'Dê um nome, escolha a categoria e clique em Salvar. Para passar aos colegas, use Exportar pacote.' },
    ],
  },
  {
    id: 'how:pecaBase',
    label: 'Desenhar uma peça técnica a partir de uma base (camiseta, calça…)',
    view: 'desenho',
    words: 'desenhar peca base camiseta camisa calca saia vestido moletom desenho tecnico flat pronto comecar',
    steps: [
      { target: 'lib:bases', text: 'Na biblioteca, abra Peças base.', done: () => ui.get().libCat === 'bases' },
      { target: 'library', text: 'Clique na peça, escolha gola, manga e medidas, e clique em "Inserir no desenho". Sai frente e costas, simétrico e editável.' },
    ],
  },
  {
    id: 'how:pespontoBarra',
    label: 'Fazer o pesponto da barra',
    view: 'desenho',
    words: 'pesponto barra bainha costura galoneira duplo',
    steps: [
      toolStep('stitch', 'Pesponto', 'S'),
      { target: 'props', text: 'No painel, escolha o tipo (duplo, galoneira…) e a distância da borda em mm da peça.' },
      { target: 'stage', text: 'Clique na barra onde o pesponto começa e depois onde termina. Alt+clique faz o traço inteiro.' },
    ],
  },
  {
    id: 'how:tecido',
    label: 'Pintar a peça com tecido (jeans, xadrez, listra…)',
    view: 'desenho',
    words: 'pintar tecido jeans xadrez listra poa preencher colorir textura balde',
    steps: [
      { target: 'lib:tecidos', text: 'Na biblioteca, abra Tecidos e escolha o tecido e as cores.', done: () => ui.get().libCat === 'tecidos' },
      toolStep('fill', 'Balde de tecido', 'K'),
      { target: 'stage', text: 'Clique em cada parte da peça para aplicar o tecido.' },
    ],
  },
  {
    id: 'how:botoes',
    label: 'Colocar botões e aviamentos',
    view: 'desenho',
    words: 'botao botoes aviamento ilhos rebite colocar carcela',
    steps: [
      { target: 'lib:aviamentos', text: 'Na biblioteca, abra Aviamentos e escolha o tipo.', done: () => ui.get().libCat === 'aviamentos' },
      { target: 'stage', text: 'Clique no desenho para colocar. Com a simetria ligada, o par aparece do outro lado.' },
    ],
  },
  {
    id: 'how:simetria',
    label: 'Desenhar só metade da peça (simetria)',
    view: 'desenho',
    words: 'simetria metade espelhar lado igual meia peca',
    steps: [
      { target: 'tool:symmetry', text: 'Ligue a Simetria (Shift+M). A linha laranja é o eixo.', done: () => editor.get().symmetry },
      toolStep('pen', 'Caneta', 'P'),
      { target: 'stage', text: 'Desenhe do eixo até o eixo: a metade vira a peça inteira e o outro lado acompanha as mudanças.' },
    ],
  },
  {
    id: 'how:croqui',
    label: 'Fazer um croqui (desenhar a roupa no corpo)',
    view: 'desenho',
    words: 'croqui figura corpo desenhar roupa manequim ilustracao',
    steps: [
      { target: 'lib:croquis', text: 'Na biblioteca, abra Croquis e clique numa figura: ela entra na camada Croqui.', done: () => ui.get().libCat === 'croquis' },
      { target: 'props', text: 'No painel Camadas, trave a camada Croqui (cadeado) para não mexer nela.' },
      toolStep('brush', 'Pincel', 'B'),
      { target: 'stage', text: 'Desenhe a roupa por cima. O pincel afinado ou o caligráfico dão traço de croqui.' },
    ],
  },
  {
    id: 'how:cota',
    label: 'Colocar medidas (cotas) no desenho',
    view: 'desenho',
    words: 'cota medida medir comprimento largura colocar medida desenho',
    steps: [toolStep('dim', 'Cota', 'D'), { target: 'stage', text: 'Arraste de um ponto ao outro: aparece a medida real da peça pela escala do documento.' }],
  },
  {
    id: 'how:illustrator',
    label: 'Trazer um desenho do Illustrator ou CorelDRAW',
    words: 'importar illustrator corel svg ai cdr desenho pronto outro programa abrir arquivo',
    steps: [
      { text: 'No Illustrator ou no Corel, salve o desenho como SVG (Arquivo › Salvar como / Exportar › SVG).' },
      { target: 'menu:Arquivo', text: 'Aqui, use Arquivo › Importar (ou arraste o arquivo para a prancha). Os traços entram editáveis.', enter: () => ui.set({ menu: 'Arquivo' }), done: () => ui.get().lastRun === 'import' },
    ],
  },
  {
    id: 'how:ficha',
    label: 'Preencher e imprimir a ficha técnica',
    words: 'ficha tecnica preencher imprimir pdf medidas materiais aviamentos fornecedor',
    steps: [
      { target: 'tab:ficha', text: 'Abra a aba Ficha técnica.', done: inView('ficha') },
      { target: 'ficha', text: 'Preencha referência, medidas, materiais e sequência. "Contar do desenho" puxa os aviamentos sozinho.' },
      { target: 'top:fichapdf', text: 'Clique em Ficha PDF para salvar em A4.' },
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

/** Passo a passo completo: aba e seleção entram antes, quando precisam. */
export function guideSteps(e: Entry): GuideStep[] {
  const pre: GuideStep[] = [];
  if (e.view === 'desenho') pre.push({ target: 'tab:desenho', text: 'Vá para a aba Desenho.', done: inView('desenho') });
  if (e.view === 'ficha') pre.push({ target: 'tab:ficha', text: 'Vá para a aba Ficha técnica.', done: inView('ficha') });
  if (e.needsSel) pre.push({ target: 'stage', text: 'Selecione o desenho (ferramenta Seleção, tecla V).', done: hasSel });
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
