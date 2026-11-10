import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const isMac = process.platform === 'darwin';
const APP_NAME = 'Andromeda Moldes';
app.setName(APP_NAME);
let win: BrowserWindow | null = null;

const CTX_FILTER = { name: 'Andromeda Moldes (.ctx)', extensions: ['ctx'] };

/* ---------- arquivo .ctx aberto pelo sistema (duplo clique / "Abrir com") ---------- */
let pendingPath: string | null = null;
let rendererReady = false;

async function openPath(path: string) {
  if (!path.toLowerCase().endsWith('.ctx')) return;
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

// Mac: o sistema avisa pelo evento (pode chegar antes da janela existir)
app.on('open-file', (e, path) => {
  e.preventDefault();
  void openPath(path);
});
// Windows/Linux: o arquivo vem na linha de comando
const argFile = process.argv.slice(1).find((a) => a.toLowerCase().endsWith('.ctx'));
if (argFile) pendingPath = argFile;
// Uma janela só: abrir outro .ctx com o app aberto manda o arquivo para ela
// (o teste automatizado CAD_SMOKE roda ao lado do app aberto)
if (!process.env.CAD_SMOKE && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  const f = argv.slice(1).find((a) => a.toLowerCase().endsWith('.ctx'));
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
        item('Importar DXF / DXF-AAMA…', 'importDxf', 'CmdOrCtrl+I'),
        { type: 'separator' },
        item('Exportar PLT (plotter)…', 'exportPlt', 'CmdOrCtrl+E'),
        item('Exportar PDF 1:1…', 'exportPdf', 'CmdOrCtrl+Shift+E'),
        item('Exportar DXF-AAMA (todos os tamanhos)…', 'exportDxf'),
        item('Exportar DXF-AAMA (só tamanho base)…', 'exportDxfBase'),
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
        item('Selecionar todos os moldes', 'selectAll', 'CmdOrCtrl+A'),
        item('Duplicar seleção', 'duplicate', 'CmdOrCtrl+D'),
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        item('Ajustar à tela', 'fit', 'CmdOrCtrl+0'),
        item('Tamanho real (1:1 na tela)', 'realSize', 'CmdOrCtrl+1'),
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
    // Windows/Linux: o menu fica dentro do app (menu superior); o nativo só aparece com Alt
    autoHideMenuBar: true,
    title: 'Andromeda Moldes',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, 'renderer', 'index.html'));

  // Pede confirmação ao renderer antes de fechar com alterações não salvas.
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

  // Teste automatizado: captura a tela e sai (CAD_SMOKE=/caminho/arquivo.png).
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
  const r = await dialog.showOpenDialog(win!, { filters: [CTX_FILTER], properties: ['openFile'] });
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
    const r = await dialog.showSaveDialog(win!, { defaultPath: defaultName, filters: [CTX_FILTER] });
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

app.whenReady().then(() => {
  // Em desenvolvimento o Electron mostra o ícone dele; no app instalado o ícone vem do pacote.
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
