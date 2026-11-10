import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { editor } from './editor/store';
import { canvasApi } from './editor/Canvas';

// Gancho de teste (somente em desenvolvimento)
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__cad = { editor, canvasApi };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
