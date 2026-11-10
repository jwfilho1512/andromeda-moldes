import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  server: { port: 5185, strictPort: true },
  build: { outDir: 'dist/renderer', emptyOutDir: true },
});
