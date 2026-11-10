// Gera os ícones do app a partir de build/icon.svg, usando o próprio Electron para desenhar o SVG.
//   npm run icons -w @cad-textil/draw
// Saída: build/icon.png (1024), build/icon.icns (Mac, via iconutil) e build/icon.ico (Windows).
// No Mac o ícone segue a grade da Apple: quadrado arredondado de 824 px centrado em 1024.
import { app, BrowserWindow } from 'electron';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(appDir, 'build');
const svg = readFileSync(join(buildDir, 'icon.svg'), 'utf8');

/** Desenha o SVG num quadrado de `size` px (com `inset` px de margem transparente) e devolve o PNG. */
async function render(win, size, inset = 0) {
  const inner = size - 2 * inset;
  const html = `<!doctype html><html><body style="margin:0;background:transparent">
    <canvas id="c" width="${size}" height="${size}"></canvas>
    <script>
      const img = new Image();
      img.onload = () => {
        const g = document.getElementById('c').getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, ${inset}, ${inset}, ${inner}, ${inner});
        window.done = document.getElementById('c').toDataURL('image/png');
      };
      img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
    </script></body></html>`;
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  for (let i = 0; i < 100; i++) {
    const url = await win.webContents.executeJavaScript('window.done || null');
    if (url) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('não foi possível desenhar o ícone');
}

/** ICO com as imagens em PNG (aceito pelo Windows Vista em diante). */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2);
    head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(off, e + 12);
    off += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

app.dock?.hide();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 1100, webPreferences: { offscreen: true } });
  try {
    // PNG cheio (Windows, Linux, site) e PNG na grade da Apple
    writeFileSync(join(buildDir, 'icon.png'), await render(win, 1024));
    writeFileSync(join(buildDir, 'icon-mac.png'), await render(win, 1024, 100));

    // Windows: .ico com vários tamanhos
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const pngs = [];
    for (const size of sizes) pngs.push({ size, data: await render(win, size) });
    writeFileSync(join(buildDir, 'icon.ico'), ico(pngs));

    // Mac: .iconset → .icns (iconutil já vem no macOS)
    if (process.platform === 'darwin') {
      const set = join(buildDir, 'icon.iconset');
      rmSync(set, { recursive: true, force: true });
      mkdirSync(set);
      for (const s of [16, 32, 128, 256, 512]) {
        writeFileSync(join(set, `icon_${s}x${s}.png`), await render(win, s, Math.round((s * 100) / 1024)));
        writeFileSync(join(set, `icon_${s}x${s}@2x.png`), await render(win, s * 2, Math.round((s * 2 * 100) / 1024)));
      }
      execFileSync('iconutil', ['-c', 'icns', set, '-o', join(buildDir, 'icon.icns')]);
      rmSync(set, { recursive: true, force: true });
    }
    console.log('Ícones gerados em apps/draw/build');
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
