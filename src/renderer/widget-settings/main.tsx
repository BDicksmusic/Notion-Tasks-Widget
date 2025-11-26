import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import { ensureMobileBridge } from '@shared/platform/mobileBridge';

// Initialize mobile bridge BEFORE importing components
ensureMobileBridge();

// Dynamic import to ensure bridge is ready
async function bootstrap() {
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
