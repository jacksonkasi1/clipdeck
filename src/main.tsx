import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import './styles/global.css';
import { bootStore } from './lib/store';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Mount the failure-safe shell before touching the native API. A hidden WebView2
// can be slow to service IPC during startup, but search, chrome, and a loading
// state must already exist before Rust is ever allowed to reveal it.
window.setTimeout(() => {
  void bootStore().catch((error: unknown) => {
    console.error('Clipdeck startup failed', error);
  });
}, 0);
