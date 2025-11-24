import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SettingsApp from './SettingsApp';
import '../styles.css';
import './settings.css';
import { ensureMobileBridge } from '@shared/platform';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Settings root element not found');
}

const root = createRoot(container);

ensureMobileBridge();

root.render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>
);







