// Build de produção: renderer (Vite) em dist/renderer + main/preload em dist/*.cjs.
import { join } from 'node:path';
import { build } from 'vite';
import { appDir, buildElectron } from './build-electron.mjs';

await build({ configFile: join(appDir, 'vite.config.ts') });
await buildElectron();
console.log('Build pronto em apps/hub/dist');
