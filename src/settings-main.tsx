// ** import lib
import React from 'react';
import ReactDOM from 'react-dom/client';

import Settings from './Settings';
import { bootStore } from './lib/store';

// ** import styles
import './styles/global.css';
import './styles/sync-preferences.css';

void bootStore();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Settings />
  </React.StrictMode>,
);
