import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Compila main + preload do Electron para dist/*.cjs. */
export async function buildElectron() {
  const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: true, logLevel: 'warning' };
  await build({ ...common, entryPoints: [join(appDir, 'electron/main.ts')], outfile: join(appDir, 'dist/main.cjs') });
  await build({ ...common, entryPoints: [join(appDir, 'electron/preload.ts')], outfile: join(appDir, 'dist/preload.cjs') });
}
