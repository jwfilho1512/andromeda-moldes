/** Estado da interface ligado ao menu superior e à Ajuda (não vai para o arquivo). */
import { useSyncExternalStore } from 'react';
import { Store } from '../state';

export interface GuideState {
  /** Id da entrada do catálogo cujo passo a passo está rodando. */
  id: string;
  step: number;
}

export type LibCat = 'minha' | 'bases' | 'detalhes' | 'pespontos' | 'aviamentos' | 'tecidos' | 'croquis';

export interface UiState {
  /** Janela de atalhos do teclado aberta. */
  shortcuts: boolean;
  /** Janela "Sobre" aberta. */
  about: boolean;
  /** Campo da Ajuda ("O que você quer fazer?") aberto. */
  help: boolean;
  guide: GuideState | null;
  /** Menu superior aberto. */
  menu: string | null;
  /** Última função executada pelo menu/Ajuda (para o passo a passo saber que foi feita). */
  lastRun: string | null;
  /** Categoria aberta na biblioteca. */
  libCat: LibCat;
}

export const ui = new Store<UiState>({ shortcuts: false, about: false, help: false, guide: null, menu: null, lastRun: null, libCat: 'bases' });

export function useUi(): UiState {
  return useSyncExternalStore(ui.subscribe, ui.get);
}
