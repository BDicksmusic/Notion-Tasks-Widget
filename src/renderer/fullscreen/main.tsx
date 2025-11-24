import React from 'react';
import ReactDOM from 'react-dom/client';
import FullScreenApp from './FullScreenApp';
import '../styles.css';
import { ensureMobileBridge } from '@shared/platform';

ensureMobileBridge();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <FullScreenApp />
  </React.StrictMode>
);

