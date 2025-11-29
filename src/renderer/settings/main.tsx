import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './control-center.css';

const isElectronRuntime =
  typeof navigator !== 'undefined' &&
  navigator.userAgent.toLowerCase().includes('electron');

// Show error message in the UI
function showError(error: unknown) {
  const container = document.getElementById('root');
  if (container) {
    container.innerHTML = `
      <div class="control-center">
        <div class="control-center-error">
          <p>Failed to load Control Center</p>
          <p style="font-size: 12px; opacity: 0.7;">${error instanceof Error ? error.message : 'Unknown error'}</p>
          <button type="button" onclick="window.location.reload()">Retry</button>
        </div>
      </div>
    `;
  }
  console.error('[ControlCenter] Bootstrap error:', error);
}

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
  const initialSection = params.get('section') as 'setup' | 'general' | 'api' | 'features' | 'databases' | 'widget' | 'voice' | 'import' | 'reset' | 'mcp' | 'shortcuts' | 'about' | undefined;

  const root = createRoot(container);
  root.render(
    <StrictMode>
      <ControlCenter initialSection={initialSection} />
    </StrictMode>
  );
}

bootstrap().catch(showError);
