import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import './styles/global.css';
import { bootStore } from './lib/store';

async function start() {
  await bootStore();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start();
