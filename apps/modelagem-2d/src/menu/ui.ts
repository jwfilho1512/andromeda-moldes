/** Estado da interface ligado ao menu superior e à Ajuda (não vai para o arquivo). */
import { useSyncExternalStore } from 'react';
import { Store } from '../editor/store';

export interface GuideState {
  /** Id da entrada do catálogo cujo passo a passo está rodando. */
  id: string;
  step: number;
}

export interface UiState {
  /** Biblioteca de bases aberta. */
  library: boolean;
  /** Janela de atalhos do teclado aberta. */
  shortcuts: boolean;
  /** Painel da Ajuda ("O que você quer fazer?") aberto. */
  help: boolean;
  /** Passo a passo visual em andamento. */
  guide: GuideState | null;
  /** Menu superior aberto. */
  menu: string | null;
  /** Última função executada pelo menu/Ajuda (para o passo a passo saber que foi feita). */
  lastRun: string | null;
}

export const ui = new Store<UiState>({ library: false, shortcuts: false, help: false, guide: null, menu: null, lastRun: null });

export function useUi(): UiState {
  return useSyncExternalStore(ui.subscribe, ui.get);
}
