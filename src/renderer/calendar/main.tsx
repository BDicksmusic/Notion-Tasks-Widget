import React from 'react';
import ReactDOM from 'react-dom/client';
import '../styles.css';
import './calendar.css';
import { ensureMobileBridge } from '@shared/platform/mobileBridge';

// Initialize mobile bridge BEFORE importing components
ensureMobileBridge();

// Dynamic import to ensure bridge is ready
async function bootstrap() {
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
