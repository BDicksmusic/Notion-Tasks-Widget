import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './control-center.css';

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
    throw new Error('Settings root element not found');
  }

  // Import ControlCenter AFTER bridge is initialized
  const { default: ControlCenter } = await import('./ControlCenter');

  // Check URL params for initial section
  const params = new URLSearchParams(window.location.search);
  const initialSection = params.get('section') as 'general' | 'api' | 'tasks' | 'writing' | 'timelog' | 'projects' | 'widget' | 'import' | 'shortcuts' | 'about' | undefined;

  const root = createRoot(container);
  root.render(
    <StrictMode>
      <ControlCenter initialSection={initialSection} />
    </StrictMode>
  );
}

bootstrap().catch(console.error);
