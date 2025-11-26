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
    throw new Error('Task window root element not found');
  }

  // Import component AFTER bridge is initialized
  const { default: TaskWindowApp } = await import('./TaskWindowApp');

  const root = createRoot(container);
  root.render(
    <StrictMode>
      <TaskWindowApp />
    </StrictMode>
  );
}

bootstrap().catch(console.error);
