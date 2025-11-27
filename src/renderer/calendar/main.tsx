import React from 'react';
import ReactDOM from 'react-dom/client';
import '../styles.css';
import './calendar.css';

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
  
  const rootElement = document.getElementById('root');
  
  if (!rootElement) {
    throw new Error('Calendar root element not found');
  }

  // Import component AFTER bridge is initialized
  const { default: CalendarWidget } = await import('./CalendarWidget');

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <CalendarWidget />
    </React.StrictMode>
  );
}

bootstrap().catch(console.error);
