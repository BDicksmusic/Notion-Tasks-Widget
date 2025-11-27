import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { setPlatformApis } from '@shared/platform';
import type { SettingsAPI, WidgetAPI } from '@shared/ipc';

const globalWithBridge = window as typeof window & {
  widgetAPI?: WidgetAPI;
  settingsAPI?: SettingsAPI;
};

const isElectronRuntime =
  typeof navigator !== 'undefined' &&
  navigator.userAgent.toLowerCase().includes('electron');

// Add error handler for uncaught errors
window.addEventListener('error', (event) => {
  console.error('[Mobile] Uncaught error:', event.error);
  const root = document.getElementById('root');
  if (root && !root.querySelector('.error-display')) {
    root.innerHTML = `
      <div class="error-display" style="padding: 20px; color: white; background: #1a1a1a; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <h1 style="color: #ff4444; margin-bottom: 20px;">App Error</h1>
        <p style="margin-bottom: 10px;">${event.error?.message || 'Unknown error'}</p>
        <pre style="background: #2a2a2a; padding: 10px; border-radius: 4px; overflow: auto; max-width: 90%;">${event.error?.stack || 'No stack trace'}</pre>
      </div>
    `;
  }
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Mobile] Unhandled promise rejection:', event.reason);
});

// Initialize the platform bridge BEFORE importing the app component
async function bootstrap() {
  try {
    // Check if we're in Electron (desktop) or mobile
    if (globalWithBridge.widgetAPI && globalWithBridge.settingsAPI) {
      setPlatformApis(
        globalWithBridge.widgetAPI,
        globalWithBridge.settingsAPI,
        isElectronRuntime ? 'desktop' : 'mobile'
      );
      console.log('[Platform] Desktop bridge detected and configured');
    } else if (!isElectronRuntime) {
      console.log('[Platform] Initializing mobile bridge...');
      // Dynamic import to reduce initial bundle size
      const { ensureMobileBridge } = await import('@shared/platform/mobileBridge');
      ensureMobileBridge();
      
      if (globalWithBridge.widgetAPI && globalWithBridge.settingsAPI) {
        console.log('[Platform] Mobile bridge initialized successfully');
      } else {
        console.error('[Platform] Mobile bridge initialization failed - APIs not set');
      }
    }
  } catch (error) {
    console.error('[Platform] Failed to initialize bridge:', error);
  }

  // Import the appropriate app based on platform
  // Desktop (Electron): Load the widget App (collapsible, dockable)
  // Mobile: Load MobileApp (hamburger menu, mobile-optimized views)
  const isMobile = !isElectronRuntime && !globalWithBridge.widgetAPI;
  
  let AppComponent: React.ComponentType;
  
  if (isMobile || !isElectronRuntime) {
    // Mobile: Use MobileApp with hamburger menu and mobile-optimized views
    console.log('[Platform] Loading MobileApp for mobile');
    const module = await import('./mobile/MobileApp');
    AppComponent = module.default;
  } else {
    // Desktop: Use the widget App
    console.log('[Platform] Loading Widget App for desktop');
    const module = await import('./App');
    AppComponent = module.default;
  }

  try {
    const rootElement = document.getElementById('root');
    if (!rootElement) {
      throw new Error('Root element not found');
    }
    
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <AppComponent />
      </React.StrictMode>
    );
    console.log('[Platform] React app mounted successfully');
  } catch (error) {
    console.error('[Platform] Failed to mount React app:', error);
    const root = document.getElementById('root');
    if (root) {
      root.innerHTML = `
        <div class="error-display" style="padding: 20px; color: white; background: #1a1a1a; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <h1 style="color: #ff4444; margin-bottom: 20px;">Failed to Load App</h1>
          <p style="margin-bottom: 10px;">${error instanceof Error ? error.message : 'Unknown error'}</p>
          <pre style="background: #2a2a2a; padding: 10px; border-radius: 4px; overflow: auto; max-width: 90%;">${error instanceof Error ? error.stack : String(error)}</pre>
        </div>
      `;
    }
  }
}

// Start the app
bootstrap();
