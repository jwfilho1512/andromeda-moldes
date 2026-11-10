import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  server: { port: 5183, strictPort: true },
  build: { outDir: 'dist/renderer', emptyOutDir: true },
  // Worker clássico embutido (funciona também no app desktop, que abre por file://)
  worker: { format: 'iife' },
});
