import React from 'react';
import ReactDOM from 'react-dom/client';

import Settings from './Settings';
import './styles/global.css';
import { useStore } from './lib/store';
import { api } from './lib/tauri';

async function boot() {
  await useStore.getState().loadSettings();
  try {
    const appearance = await api.appearance();
    useStore.getState().applyAppearance(appearance);
  } catch {
    // settings window can still render with no appearance
  }
}

void boot();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Settings />
  </React.StrictMode>,
);
