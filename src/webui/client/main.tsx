/**
 * webui/client/main — SPA 挂载入口（批 18a-2；vite 根 = 本目录）。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './app.css';

import { App } from './App.js';

const root = document.getElementById('root');
if (root === null) throw new Error('SPA 挂载位缺席（index.html 缺 #root）');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
