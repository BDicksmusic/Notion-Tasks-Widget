import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import WidgetSettingsApp from './WidgetSettingsApp';
import '../styles.css';
import { ensureMobileBridge } from '@shared/platform';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Widget settings root element not found');
}

const root = createRoot(container);

ensureMobileBridge();

root.render(
  <StrictMode>
    <WidgetSettingsApp />
  </StrictMode>
);




