/// <reference lib="webworker" />
/**
 * Encaixe automático em processo separado (Web Worker): a tela nunca trava,
 * o progresso é enviado a cada ~250 ms e "Parar" responde na hora.
 */
import { type FabricSpec, type MarkerItem, type NestState, nestCandidates, optimizeStep, rng, tryCandidate } from '@cad-textil/core';

export type NestRequest = { type: 'start'; items: MarkerItem[]; fabric: FabricSpec; seconds: number; seed: number } | { type: 'stop' };
export type NestReply =
  | { type: 'progress'; iter: number; best: NestState['best'] }
  | { type: 'done'; iter: number; best: NestState['best'] }
  | { type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let stop = false;

ctx.onmessage = async (e: MessageEvent<NestRequest>) => {
  const msg = e.data;
  if (msg.type === 'stop') {
    stop = true;
    return;
  }
  stop = false;
  const { items, fabric, seconds, seed } = msg;
  try {
    const candidates = nestCandidates(items);
    const rand = rng(seed);
    const t0 = performance.now();
    let state: NestState | null = null;
    let iter = 0;
    let lastPost = 0;
    for (;;) {
      if (state && (stop || performance.now() - t0 > seconds * 1000)) break;
      if (iter < candidates.length) state = tryCandidate(items, fabric, state, candidates[iter]!);
      else optimizeStep(items, fabric, state!, rand, 1);
      iter++;
      if (performance.now() - lastPost > 250) {
        lastPost = performance.now();
        ctx.postMessage({ type: 'progress', iter, best: state!.best } satisfies NestReply);
      }
      // devolve a vez para receber "Parar"
      await new Promise((r) => setTimeout(r, 0));
    }
    ctx.postMessage({ type: 'done', iter, best: state!.best } satisfies NestReply);
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies NestReply);
  }
};
