import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { newDocument, serializeDocument } from '@cad-textil/core';
import { APPS, type AppId, HUB, RELEASES_URL, compareVersions, groupProducts, newDrawDoc, pickAsset, productFolderName, selfUpdateBlocker } from './catalog';
import { detect, downloadAndInstall, latestRelease, openApp, scanWorkspace, updateSelf } from './system';

const isMac = process.platform === 'darwin';
const APP_NAME = 'Andromeda Fashion Studio';
app.setName(APP_NAME);
let win: BrowserWindow | null = null;

/* ---------------- ajustes ---------------- */

interface Settings {
  workspace: string;
}

const settingsFile = () => join(app.getPath('userData'), 'hub.json');
async function loadSettings(): Promise<Settings> {
  const def: Settings = { workspace: join(app.getPath('documents'), 'Andromeda') };
  try {
    return { ...def, ...(JSON.parse(await readFile(settingsFile(), 'utf8')) as Partial<Settings>) };
  } catch {
    return def;
  }
}
async function saveSettings(s: Settings) {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(settingsFile(), JSON.stringify(s, null, 2));
}

const appDef = (id: AppId) => {
  const a = APPS.find((x) => x.id === id);
  if (!a) throw new Error('App desconhecido');
  return a;
};

/* ---------------- IPC ---------------- */

ipcMain.handle('apps', async () => {
  const out = [];
  for (const a of APPS) out.push({ ...a, ...(a.soon ? { installed: false } : await detect(a)) });
  return out;
});

ipcMain.handle('release', async (_e, force: boolean) => {
  try {
    const r = await latestRelease(force);
    const assets = Object.fromEntries(APPS.map((a) => [a.id, pickAsset(r.assets, a, process.platform, process.arch)]));
    return { ok: true, version: r.version, page: r.page, assets };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

const busy = new Set<AppId>();
ipcMain.handle('install', async (_e, id: AppId) => {
  const a = appDef(id);
  if (busy.has(id)) return { ok: false, error: 'Já está instalando' };
  busy.add(id);
  try {
    const r = await latestRelease();
    const asset = pickAsset(r.assets, a, process.platform, process.arch);
    if (!asset) throw new Error(`${a.name} ainda não tem instalador para este computador na versão ${r.version}`);
    const path = await downloadAndInstall(a, asset, (phase, f) => win?.webContents.send('installProgress', { id, phase, f }));
    return { ok: true, path };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    busy.delete(id);
  }
});

ipcMain.handle('openApp', async (_e, id: AppId, file?: string) => {
  const a = appDef(id);
  const d = await detect(a);
  if (!d.installed || !d.path) return `${a.name} não está instalado`;
  try {
    await openApp(a, d.path, file);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
});

ipcMain.handle('settings', () => loadSettings());

ipcMain.handle('pickWorkspace', async () => {
  const s = await loadSettings();
  const r = await dialog.showOpenDialog(win!, { defaultPath: s.workspace, properties: ['openDirectory', 'createDirectory'] });
  const p = r.filePaths[0];
  if (r.canceled || !p) return null;
  await saveSettings({ ...s, workspace: p });
  return p;
});

ipcMain.handle('products', async () => {
  const s = await loadSettings();
  if (!existsSync(s.workspace)) return { workspace: s.workspace, exists: false, products: [] };
  return { workspace: s.workspace, exists: true, products: groupProducts(await scanWorkspace(s.workspace)) };
});

/** Nova referência: pasta do produto + desenho (.adraw) e, se pedido, moldes (.ctx) já vinculados. */
ipcMain.handle('createProduct', async (_e, p: { ref: string; nome: string; colecao: string; moldes: boolean }) => {
  try {
    const s = await loadSettings();
    const dir = join(s.workspace, productFolderName(p.ref, p.nome));
    if (existsSync(dir)) throw new Error('Já existe uma pasta com essa referência');
    await mkdir(dir, { recursive: true });
    const fileBase = productFolderName(p.ref, '') || productFolderName('', p.nome);
    let link: { path: string; name: string } | null = null;
    if (p.moldes) {
      const ctx = join(dir, `${fileBase}.ctx`);
      await writeFile(ctx, serializeDocument(newDocument(p.ref || p.nome)));
      link = { path: ctx, name: `${fileBase}.ctx` };
    }
    const adraw = join(dir, `${fileBase}.adraw`);
    await writeFile(adraw, JSON.stringify(newDrawDoc(p.ref, p.nome, p.colecao, link)));
    return { ok: true, adraw, dir };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle('reveal', (_e, path: string) => shell.showItemInFolder(path));

/** Só abre páginas do próprio projeto. */
ipcMain.handle('openExternal', (_e, url: string) => {
  if (url.startsWith(`https://github.com/`) && url.includes('andromeda-moldes')) void shell.openExternal(url);
  else if (url === RELEASES_URL) void shell.openExternal(url);
});

/** Há versão nova do próprio hub? */
ipcMain.handle('hubUpdate', async (_e, force: boolean) => {
  try {
    const r = await latestRelease(force);
    const asset = pickAsset(r.assets, HUB, process.platform, process.arch);
    const newer = compareVersions(r.version, app.getVersion()) > 0;
    return { ok: true, current: app.getVersion(), latest: r.version, available: newer && !!asset, blocker: newer ? selfUpdateBlocker(process.platform, process.execPath, app.isPackaged) : null };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

let selfUpdating = false;
ipcMain.handle('updateHub', async () => {
  if (selfUpdating) return { ok: false, error: 'Já está atualizando' };
  const blocker = selfUpdateBlocker(process.platform, process.execPath, app.isPackaged);
  if (blocker) return { ok: false, error: blocker };
  selfUpdating = true;
  try {
    const r = await latestRelease(true);
    const asset = pickAsset(r.assets, HUB, process.platform, process.arch);
    if (!asset) throw new Error('Sem instalador do hub para este computador');
    const next = await updateSelf(asset, process.execPath, (phase, f) => win?.webContents.send('installProgress', { id: 'hub', phase, f }));
    // dá tempo da interface mostrar "reabrindo…"
    setTimeout(() => {
      if (next === 'relaunch') app.relaunch();
      app.exit(0);
    }, 600);
    return { ok: true };
  } catch (err) {
    selfUpdating = false;
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle('info', () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch }));

/* ---------------- janela ---------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#14161a',
    ...(isMac || app.isPackaged ? {} : { icon: join(__dirname, '..', 'build', 'icon.png') }),
    autoHideMenuBar: true,
    title: APP_NAME,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const devUrl = process.env.VITE_DEV_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, 'renderer', 'index.html'));

  const smoke = process.env.CAD_SMOKE;
  if (smoke) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win!.webContents.capturePage();
        await writeFile(smoke, img.toPNG());
        app.quit();
      }, 3000);
    });
  }
}

if (!process.env.CAD_SMOKE && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  if (isMac && !app.isPackaged) app.dock?.setIcon(join(__dirname, '..', 'build', 'icon-mac.png'));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac || process.env.CAD_SMOKE) app.quit();
});
