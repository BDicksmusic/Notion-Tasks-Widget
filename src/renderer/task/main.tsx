import React from 'react';
import ReactDOM from 'react-dom/client';
import TaskWindowApp from './TaskWindowApp';
import '../styles.css';
import { ensureMobileBridge } from '@shared/platform';

ensureMobileBridge();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <TaskWindowApp />
  </React.StrictMode>
);







