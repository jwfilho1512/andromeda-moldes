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
import { type AppDef, type Copy, type FoundFile, type Release, type ReleaseAsset, REPO, installScope, macBundleOf, newestCopy, parseCommandLine, parseRegKeys, parseRegValues, parseRelease } from './catalog';

const run = promisify(execFile);
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const UA = { 'User-Agent': 'Andromeda-Fashion-Studio', Accept: 'application/vnd.github+json' };

/* ---------------- apps instalados ---------------- */

export interface Installed {
  installed: boolean;
  /** Versão da cópia mais nova (a que o hub abre). */
  version?: string;
  path?: string;
  /** Todas as cópias encontradas (mais de uma = duplicada). */
  copies: Copy[];
  /** O app está aberto agora. */
  running?: boolean;
}

async function macVersion(bundle: string): Promise<string | undefined> {
  try {
    const { stdout } = await run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', join(bundle, 'Contents', 'Info.plist')]);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

const UNINSTALL_KEYS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

/** Todas as cópias do app neste computador. */
export async function findCopies(app: AppDef): Promise<Copy[]> {
  if (isMac) {
    const out: Copy[] = [];
    for (const [p, scope] of [[join('/Applications', `${app.name}.app`), 'todos'], [join(homedir(), 'Applications', `${app.name}.app`), 'usuario']] as const)
      if (existsSync(p)) out.push({ path: p, version: await macVersion(p), scope });
    return out;
  }
  if (isWin) {
    const byPath = new Map<string, Copy>();
    // 1) registro (o instalador grava versão, pasta e desinstalador) — do usuário e da máquina
    for (const root of UNINSTALL_KEYS) {
      let keys: string[] = [];
      try {
        const { stdout } = await run('reg', ['query', root, '/s', '/f', app.name, '/d']);
        keys = parseRegKeys(stdout).filter((k) => k.toUpperCase() !== root.replace(/^HKCU/, 'HKEY_CURRENT_USER').replace(/^HKLM/, 'HKEY_LOCAL_MACHINE').toUpperCase());
      } catch {
        continue; // chave sem nada do app
      }
      for (const key of keys) {
        try {
          const v = parseRegValues((await run('reg', ['query', key])).stdout);
          if (!(v.DisplayName ?? '').startsWith(app.name)) continue;
          const dir = v.InstallLocation;
          if (!dir) continue;
          const exe = join(dir, `${app.name}.exe`);
          if (!existsSync(exe)) continue;
          byPath.set(exe.toLowerCase(), { path: exe, version: v.DisplayVersion, scope: key.startsWith('HKEY_CURRENT_USER') ? 'usuario' : 'todos', uninstall: v.QuietUninstallString ?? (v.UninstallString ? `${v.UninstallString} /S` : undefined) });
        } catch {
          /* chave ilegível */
        }
      }
    }
    // 2) pastas de sempre (caso o registro esteja faltando)
    const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    const pfs = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean) as string[];
    for (const [exe, scope] of [[join(local, 'Programs', app.name, `${app.name}.exe`), 'usuario'], ...pfs.map((pf) => [join(pf, app.name, `${app.name}.exe`), 'todos'])] as [string, Copy['scope']][]) {
      if (existsSync(exe) && !byPath.has(exe.toLowerCase())) {
        const un = join(dirname(exe), `Uninstall ${app.name}.exe`);
        byPath.set(exe.toLowerCase(), { path: exe, scope, uninstall: existsSync(un) ? `"${un}" /S` : undefined });
      }
    }
    return [...byPath.values()];
  }
  return [];
}

/** O app está aberto? */
export async function isRunning(app: AppDef, copy?: Copy): Promise<boolean> {
  try {
    if (isMac) {
      const { stdout } = await run('pgrep', ['-f', copy ? `${copy.path}/Contents/MacOS/` : `${app.name}.app/Contents/MacOS/`]);
      return stdout.trim().length > 0;
    }
    if (isWin) {
      const { stdout } = await run('tasklist', ['/FI', `IMAGENAME eq ${app.name}.exe`, '/NH']);
      return stdout.toLowerCase().includes(`${app.name.toLowerCase()}.exe`);
    }
  } catch {
    /* pgrep sai com erro quando não acha nada */
  }
  return false;
}

export async function detect(app: AppDef): Promise<Installed> {
  const copies = await findCopies(app);
  const newest = newestCopy(copies);
  if (!newest) return { installed: false, copies };
  return { installed: true, version: newest.version, path: newest.path, copies, running: await isRunning(app) };
}

/** Fecha o app (Mac: pede para sair, como Cmd+Q; Windows: encerra). */
export async function quitApp(app: AppDef): Promise<void> {
  if (isMac) await run('osascript', ['-e', `quit app "${app.name}"`]).catch(() => undefined);
  else if (isWin) await run('taskkill', ['/IM', `${app.name}.exe`]).catch(() => undefined);
  for (let i = 0; i < 40 && (await isRunning(app)); i++) await new Promise((r) => setTimeout(r, 250));
}

/** Desinstala uma cópia. Mac: a pasta do app vai para a Lixeira (feito no processo principal). Windows: desinstalador silencioso. */
export async function uninstallWindows(app: AppDef, copy: Copy): Promise<void> {
  const cmd = copy.uninstall ?? `"${join(dirname(copy.path), `Uninstall ${app.name}.exe`)}" /S`;
  const { exe, args } = parseCommandLine(cmd);
  if (!existsSync(exe)) throw new Error('Não achei o desinstalador desta cópia');
  if (!args.some((a) => a.toUpperCase() === '/S')) args.push('/S');
  await new Promise<void>((resolve, reject) => {
    const p = spawn(exe, args, { windowsHide: true });
    p.on('error', reject);
    p.on('exit', () => resolve());
  });
  // o desinstalador do NSIS continua de uma cópia temporária: espera o app sumir
  for (let i = 0; i < 240 && existsSync(copy.path); i++) await new Promise((r) => setTimeout(r, 500));
  if (existsSync(copy.path)) throw new Error('O desinstalador não terminou (pode ter pedido permissão de administrador)');
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
      // atualiza no lugar da cópia que já existe (senão o Dock e o Launchpad continuariam abrindo a antiga)
      const existing = newestCopy(await findCopies(app));
      const dests = existing ? [dirname(existing.path)] : ['/Applications', join(homedir(), 'Applications')];
      for (const dest of dests) {
        try {
          await mkdir(dest, { recursive: true });
          const target = join(dest, `${app.name}.app`);
          const fresh = `${target}.novo`;
          await rm(fresh, { recursive: true, force: true });
          await run('ditto', [join(mount, appDir), fresh]);
          await rm(target, { recursive: true, force: true });
          await rename(fresh, target);
          return target;
        } catch (err) {
          if (dest === dests[dests.length - 1]) throw new Error(`Não foi possível copiar o app para ${dest}: ${(err as Error).message}`);
          // sem permissão em /Applications: tenta ~/Applications (só quando ainda não havia cópia)
        }
      }
      throw new Error('Não foi possível copiar o app');
    } finally {
      await run('hdiutil', ['detach', mount, '-quiet']).catch(() => run('hdiutil', ['detach', mount, '-force', '-quiet']).catch(() => undefined));
    }
  }
  if (isWin) {
    // instalador NSIS do electron-builder, silencioso (/S), por cima da cópia que já existe:
    // "para todos os usuários" (/allusers, pede administrador) ou só este usuário (/currentuser)
    const scope = installScope(await findCopies(app));
    await new Promise<void>((resolve, reject) => {
      const p = spawn(file, ['/S', scope === 'todos' ? '/allusers' : '/currentuser'], { windowsHide: true });
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
    // o instalador continua sozinho depois que o hub fecha; a pasta temporária fica para o Windows limpar.
    // Por cima da cópia que está rodando: em Arquivos de Programas = "para todos" (pede administrador).
    const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map((p) => p!.toLowerCase());
    const allUsers = pf.some((p) => exePath.toLowerCase().startsWith(p));
    const p = spawn(file, ['/S', allUsers ? '/allusers' : '/currentuser', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true });
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
