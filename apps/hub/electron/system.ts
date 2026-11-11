/**
 * Ações no sistema: descobrir apps instalados, baixar e instalar instaladores das Releases,
 * abrir apps (com arquivo) e varrer a pasta de trabalho.
 */
import { execFile, spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { type AppDef, type FoundFile, type Release, type ReleaseAsset, REPO, macBundleOf, parseRelease } from './catalog';

const run = promisify(execFile);
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const UA = { 'User-Agent': 'Andromeda-Fashion-Studio', Accept: 'application/vnd.github+json' };

/* ---------------- apps instalados ---------------- */

export interface Installed {
  installed: boolean;
  version?: string;
  path?: string;
}

function macCandidates(app: AppDef) {
  return [join('/Applications', `${app.name}.app`), join(homedir(), 'Applications', `${app.name}.app`)];
}

function winCandidates(app: AppDef) {
  const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
  return [join(local, 'Programs', app.name, `${app.name}.exe`), join(pf, app.name, `${app.name}.exe`)];
}

export async function detect(app: AppDef): Promise<Installed> {
  if (isMac) {
    for (const p of macCandidates(app)) {
      if (!existsSync(p)) continue;
      try {
        const { stdout } = await run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', join(p, 'Contents', 'Info.plist')]);
        return { installed: true, version: stdout.trim(), path: p };
      } catch {
        return { installed: true, path: p };
      }
    }
    return { installed: false };
  }
  if (isWin) {
    const exe = winCandidates(app).find((p) => existsSync(p));
    let version: string | undefined;
    try {
      // o instalador grava a versão no registro (Desinstalar programas)
      const { stdout } = await run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s', '/f', app.name, '/d']);
      const block = stdout.split(/\r?\n\r?\n/).find((b) => b.includes(app.name)) ?? '';
      version = /DisplayVersion\s+REG_SZ\s+(\S+)/.exec(block)?.[1];
    } catch {
      /* sem registro */
    }
    return exe ? { installed: true, version, path: exe } : { installed: false };
  }
  return { installed: false };
}

/* ---------------- Releases ---------------- */

let cache: { at: number; release: Release } | null = null;

export async function latestRelease(force = false): Promise<Release> {
  if (!force && cache && Date.now() - cache.at < 10 * 60_000) return cache.release;
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: UA });
  if (res.status === 404) throw new Error('Ainda não há versão publicada');
  if (res.status === 403) throw new Error('O GitHub limitou as consultas; tente de novo em alguns minutos');
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
  const release = parseRelease(await res.json());
  cache = { at: Date.now(), release };
  return release;
}

/** Baixa um arquivo com progresso (0..1). */
export async function download(asset: ReleaseAsset, to: string, progress: (f: number) => void): Promise<void> {
  const res = await fetch(asset.url, { headers: { 'User-Agent': UA['User-Agent'] } });
  if (!res.ok || !res.body) throw new Error(`Falha ao baixar (${res.status})`);
  const total = Number(res.headers.get('content-length')) || asset.size || 0;
  const out = createWriteStream(to);
  let got = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      if (total) progress(Math.min(1, got / total));
    }
  } finally {
    await new Promise<void>((r) => out.end(r));
  }
  if (asset.size && got !== asset.size) throw new Error('Download incompleto; tente de novo');
}

/** Instala: no Mac copia o app do .dmg para Aplicativos; no Windows roda o instalador em modo silencioso. */
export async function install(app: AppDef, file: string): Promise<string> {
  if (isMac) {
    const mount = await mkdtemp(join(tmpdir(), 'andromeda-dmg-'));
    await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, file]);
    try {
      const appDir = (await readdir(mount)).find((n) => n.endsWith('.app'));
      if (!appDir) throw new Error('O instalador não tem o app dentro');
      for (const dest of ['/Applications', join(homedir(), 'Applications')]) {
        try {
          await mkdir(dest, { recursive: true });
          const target = join(dest, `${app.name}.app`);
          await rm(target, { recursive: true, force: true });
          await run('ditto', [join(mount, appDir), target]);
          return target;
        } catch (err) {
          if (dest !== '/Applications') throw err;
          // sem permissão em /Applications: tenta ~/Applications
        }
      }
      throw new Error('Não foi possível copiar o app');
    } finally {
      await run('hdiutil', ['detach', mount, '-quiet']).catch(() => run('hdiutil', ['detach', mount, '-force', '-quiet']).catch(() => undefined));
    }
  }
  if (isWin) {
    // instalador NSIS do electron-builder: /S = silencioso, /currentuser = sem pedir administrador
    await new Promise<void>((resolve, reject) => {
      const p = spawn(file, ['/S', '/currentuser'], { windowsHide: true });
      p.on('error', reject);
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`O instalador terminou com código ${code}`))));
    });
    const found = (await detect(app)).path;
    if (!found) throw new Error('Instalado, mas o app não foi encontrado');
    return found;
  }
  throw new Error('Sistema não suportado');
}

export async function downloadAndInstall(app: AppDef, asset: ReleaseAsset, progress: (phase: 'baixando' | 'instalando', f: number) => void): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'andromeda-'));
  const file = join(dir, asset.name);
  try {
    await download(asset, file, (f) => progress('baixando', f));
    progress('instalando', 1);
    return await install(app, file);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Atualiza o próprio hub.
 * Mac: copia o app novo do .dmg por cima do atual (o macOS deixa trocar o app aberto) e devolve true para reabrir.
 * Windows: roda o instalador novo em modo silencioso, que fecha o hub, instala e abre de novo (--force-run).
 */
export async function updateSelf(asset: ReleaseAsset, exePath: string, progress: (phase: 'baixando' | 'instalando', f: number) => void): Promise<'relaunch' | 'quit'> {
  const dir = await mkdtemp(join(tmpdir(), 'andromeda-hub-'));
  const file = join(dir, asset.name);
  await download(asset, file, (f) => progress('baixando', f));
  progress('instalando', 1);
  if (isMac) {
    const bundle = macBundleOf(exePath);
    if (!bundle) throw new Error('Não achei o app do hub para trocar');
    try {
      await replaceMacBundle(file, bundle);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    return 'relaunch';
  }
  if (isWin) {
    // o instalador continua sozinho depois que o hub fecha; a pasta temporária fica para o Windows limpar
    const p = spawn(file, ['/S', '/currentuser', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true });
    p.unref();
    return 'quit';
  }
  throw new Error('Sistema não suportado');
}

/** Troca a pasta .app pelo app que está dentro do .dmg (cópia ao lado e troca, para não deixar o app pela metade). */
export async function replaceMacBundle(dmg: string, bundle: string): Promise<void> {
  const mount = await mkdtemp(join(tmpdir(), 'andromeda-dmg-'));
  await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, dmg]);
  try {
    const appDir = (await readdir(mount)).find((n) => n.endsWith('.app'));
    if (!appDir) throw new Error('O instalador não tem o app dentro');
    const fresh = `${bundle}.novo`;
    const old = `${bundle}.antigo`;
    await rm(fresh, { recursive: true, force: true });
    await run('ditto', [join(mount, appDir), fresh]);
    await rm(old, { recursive: true, force: true });
    await rename(bundle, old);
    try {
      await rename(fresh, bundle);
    } catch (err) {
      await rename(old, bundle).catch(() => undefined);
      throw err;
    }
    await rm(old, { recursive: true, force: true }).catch(() => undefined);
  } finally {
    await run('hdiutil', ['detach', mount, '-quiet']).catch(() => run('hdiutil', ['detach', mount, '-force', '-quiet']).catch(() => undefined));
  }
}

/** Abre o app (opcionalmente com um arquivo). */
export async function openApp(app: AppDef, path: string, file?: string): Promise<void> {
  if (isMac) {
    await run('open', file ? ['-a', path, file] : ['-a', path]);
    return;
  }
  const p = spawn(path, file ? [file] : [], { detached: true, stdio: 'ignore' });
  p.unref();
}

/* ---------------- pasta de trabalho ---------------- */

export async function scanWorkspace(root: string, depth = 3): Promise<FoundFile[]> {
  const out: FoundFile[] = [];
  const walk = async (dir: string, d: number) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (d > 0 && e.name !== 'node_modules') await walk(p, d - 1);
        continue;
      }
      const ext = e.name.toLowerCase().split('.').pop();
      if (ext !== 'adraw' && ext !== 'ctx') continue;
      const st = await stat(p);
      const f: FoundFile = { path: p, name: e.name, dir: dirname(p), mtime: st.mtimeMs, kind: ext };
      if (ext === 'adraw') {
        try {
          const doc = JSON.parse(await readFile(p, 'utf8')) as { ficha?: FoundFile['ficha'] };
          f.ficha = doc.ficha ?? {};
        } catch {
          f.ficha = {};
        }
      }
      out.push(f);
    }
  };
  await walk(root, depth);
  return out;
}

export const fileName = basename;
