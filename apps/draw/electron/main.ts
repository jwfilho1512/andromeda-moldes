import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const isMac = process.platform === 'darwin';
const APP_NAME = 'Andromeda Draw';
app.setName(APP_NAME);
let win: BrowserWindow | null = null;

const DOC_FILTER = { name: 'Andromeda Draw (.adraw)', extensions: ['adraw'] };

/* ---------- arquivo .adraw aberto pelo sistema (duplo clique / "Abrir com") ---------- */
let pendingPath: string | null = null;
let rendererReady = false;
const isDoc = (p: string) => p.toLowerCase().endsWith('.adraw');

async function openPath(path: string) {
  if (!isDoc(path)) return;
  if (!win || win.isDestroyed() || !rendererReady) {
    pendingPath = path;
    return;
  }
  try {
    win.webContents.send('openPath', { path, name: basename(path), content: await readFile(path, 'utf8') });
    if (win.isMinimized()) win.restore();
    win.focus();
  } catch (err) {
    dialog.showErrorBox('Não foi possível abrir', String(err));
  }
}

app.on('open-file', (e, path) => {
  e.preventDefault();
  void openPath(path);
});
const argFile = process.argv.slice(1).find(isDoc);
if (argFile) pendingPath = argFile;
if (!process.env.CAD_SMOKE && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  const f = argv.slice(1).find(isDoc);
  if (f) void openPath(f);
  else if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
ipcMain.on('rendererReady', () => {
  rendererReady = true;
  if (pendingPath) {
    const p = pendingPath;
    pendingPath = null;
    void openPath(p);
  }
});

function send(cmd: string) {
  win?.webContents.send('menu', cmd);
}

function buildMenu() {
  const item = (label: string, cmd: string, accelerator?: string): MenuItemConstructorOptions => ({ label, accelerator, click: () => send(cmd) });
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'Arquivo',
      submenu: [
        item('Novo', 'new', 'CmdOrCtrl+N'),
        item('Abrir…', 'open', 'CmdOrCtrl+O'),
        { type: 'separator' },
        item('Salvar', 'save', 'CmdOrCtrl+S'),
        item('Salvar como…', 'saveAs', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        item('Importar SVG, imagem ou moldes…', 'import', 'CmdOrCtrl+I'),
        { type: 'separator' },
        item('Exportar SVG…', 'exportSvg', 'CmdOrCtrl+E'),
        item('Exportar PNG…', 'exportPng'),
        item('Ficha técnica em PDF…', 'exportFicha', 'CmdOrCtrl+P'),
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const, label: 'Sair' }]),
      ],
    },
    {
      label: 'Editar',
      submenu: [
        item('Desfazer', 'undo', 'CmdOrCtrl+Z'),
        item('Refazer', 'redo', 'CmdOrCtrl+Shift+Z'),
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { type: 'separator' },
        item('Selecionar tudo', 'selectAll', 'CmdOrCtrl+A'),
        item('Duplicar', 'duplicate', 'CmdOrCtrl+D'),
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        item('Ajustar à tela', 'fit', 'CmdOrCtrl+0'),
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  rendererReady = false;
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1d1f23',
    ...(isMac || app.isPackaged ? {} : { icon: join(__dirname, '..', 'build', 'icon.png') }),
    autoHideMenuBar: true,
    title: APP_NAME,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });

  const devUrl = process.env.VITE_DEV_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, 'renderer', 'index.html'));

  let allowClose = false;
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    send('requestClose');
  });
  ipcMain.removeHandler('confirmClose');
  ipcMain.handle('confirmClose', async (_e, dirty: boolean) => {
    if (dirty) {
      const r = await dialog.showMessageBox(win!, {
        type: 'warning',
        buttons: ['Fechar sem salvar', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        message: 'Há alterações não salvas.',
        detail: 'Se fechar agora, as alterações desde o último salvamento serão perdidas.',
      });
      if (r.response !== 0) return false;
    }
    allowClose = true;
    win?.close();
    return true;
  });

  const smoke = process.env.CAD_SMOKE;
  if (smoke) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win!.webContents.capturePage();
        await writeFile(smoke, img.toPNG());
        allowClose = true;
        app.quit();
      }, 2500);
    });
  }
}

ipcMain.handle('openFile', async () => {
  const r = await dialog.showOpenDialog(win!, { filters: [DOC_FILTER], properties: ['openFile'] });
  const path = r.filePaths[0];
  if (r.canceled || !path) return null;
  return { path, name: basename(path), content: await readFile(path, 'utf8') };
});

ipcMain.handle('importFile', async (_e, filterName: string, exts: string[]) => {
  const r = await dialog.showOpenDialog(win!, { filters: [{ name: filterName, extensions: exts }, { name: 'Todos os arquivos', extensions: ['*'] }], properties: ['openFile'] });
  const path = r.filePaths[0];
  if (r.canceled || !path) return null;
  return { path, name: basename(path), data: new Uint8Array(await readFile(path)) };
});

ipcMain.handle('saveFile', async (_e, content: string, path: string | null, defaultName: string) => {
  let target = path;
  if (!target) {
    const r = await dialog.showSaveDialog(win!, { defaultPath: defaultName, filters: [DOC_FILTER] });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  await writeFile(target, content, 'utf8');
  return { path: target, name: basename(target) };
});

ipcMain.handle('exportFile', async (_e, data: Uint8Array | string, defaultName: string, filterName: string, ext: string) => {
  const r = await dialog.showSaveDialog(win!, { defaultPath: defaultName, filters: [{ name: filterName, extensions: [ext] }] });
  if (r.canceled || !r.filePath) return null;
  await writeFile(r.filePath, typeof data === 'string' ? data : Buffer.from(data));
  return { path: r.filePath, name: basename(r.filePath) };
});

/** Imprime a janela atual (já em modo de impressão da ficha) em PDF A4. */
ipcMain.handle('printPdf', async (_e, defaultName: string, landscape: boolean) => {
  const r = await dialog.showSaveDialog(win!, { defaultPath: defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return null;
  const pdf = await win!.webContents.printToPDF({ pageSize: 'A4', landscape, printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  await writeFile(r.filePath, pdf);
  return { path: r.filePath, name: basename(r.filePath) };
});

/* ---------- Minha biblioteca (assets da pessoa/equipe, fora dos desenhos) ---------- */
const libFile = () => join(app.getPath('userData'), 'minha-biblioteca.adrawlib');
ipcMain.handle('libLoad', async () => {
  try {
    return await readFile(libFile(), 'utf8');
  } catch {
    return null;
  }
});
ipcMain.handle('libSave', async (_e, text: string) => {
  await mkdir(app.getPath('userData'), { recursive: true });
  // grava ao lado e troca, para não perder a biblioteca se faltar luz no meio
  await writeFile(`${libFile()}.tmp`, text, 'utf8');
  await rename(`${libFile()}.tmp`, libFile());
  return true;
});

/** Escolhe um arquivo de moldes (.ctx) para vincular à ficha. */
ipcMain.handle('pickLink', async () => {
  const r = await dialog.showOpenDialog(win!, { filters: [{ name: 'Andromeda Moldes (.ctx)', extensions: ['ctx'] }], properties: ['openFile'] });
  const path = r.filePaths[0];
  return r.canceled || !path ? null : { path, name: basename(path) };
});

/** Abre o arquivo vinculado no programa associado (o .ctx abre no Andromeda Moldes). */
ipcMain.handle('openLinked', async (_e, path: string) => {
  const err = await shell.openPath(path);
  return err || null;
});

app.whenReady().then(() => {
  if (isMac && !app.isPackaged) app.dock?.setIcon(join(__dirname, '..', 'build', 'icon-mac.png'));
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac || process.env.CAD_SMOKE) app.quit();
});
