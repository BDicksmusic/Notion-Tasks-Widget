import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';

const isElectronRuntime =
  typeof navigator !== 'undefined' &&
  navigator.userAgent.toLowerCase().includes('electron');

// Dynamic import to ensure bridge is ready
async function bootstrap() {
  // Only initialize mobile bridge on non-Electron platforms
  if (!isElectronRuntime) {
    const { ensureMobileBridge } = await import('@shared/platform/mobileBridge');
    ensureMobileBridge();
  }
  
  const container = document.getElementById('root');

  if (!container) {
    throw new Error('Widget Settings root element not found');
  }

  // Import component AFTER bridge is initialized
  const { default: WidgetSettingsApp } = await import('./WidgetSettingsApp');

  const root = createRoot(container);
  root.render(
    <StrictMode>
      <WidgetSettingsApp />
    </StrictMode>
  );
}

bootstrap().catch(console.error);
