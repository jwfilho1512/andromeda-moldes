// Modo desenvolvimento: servidor Vite (recarrega ao salvar) + janela Electron.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import electronPath from 'electron';
import { createServer } from 'vite';
import { appDir, buildElectron } from './build-electron.mjs';

const server = await createServer({ configFile: join(appDir, 'vite.config.ts') });
await server.listen();
const url = server.resolvedUrls.local[0];
await buildElectron();

const child = spawn(electronPath, [appDir], { stdio: 'inherit', env: { ...process.env, VITE_DEV_URL: url } });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
