// ** import lib
import React from 'react';
import ReactDOM from 'react-dom/client';

import Settings from './Settings';
import { bootStore } from './lib/store';

// ** import styles
import './styles/global.css';

void bootStore();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Settings />
  </React.StrictMode>,
);
