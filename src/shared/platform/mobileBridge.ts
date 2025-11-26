import type { SettingsAPI, WidgetAPI } from '@shared/ipc';
import { createMobileAPIs } from './mobile/widgetApi';

// Type declarations for browser globals (only used in mobile/browser context)
declare const window: typeof globalThis & {
  widgetAPI?: WidgetAPI;
  settingsAPI?: SettingsAPI;
  location?: { href: string; pathname?: string; replace(url: string): void };
  history?: { length: number; back(): void };
};

let initialized = false;

// Store the APIs so they can be accessed by index.ts
let _mobileWidgetAPI: WidgetAPI | null = null;
let _mobileSettingsAPI: SettingsAPI | null = null;

export function getMobileAPIs() {
  return { widgetAPI: _mobileWidgetAPI, settingsAPI: _mobileSettingsAPI };
}

export function ensureMobileBridge() {
  if (initialized) return;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof window === 'undefined') return;
  if (window.widgetAPI && window.settingsAPI) {
    initialized = true;
    return;
  }

  const { widgetAPI, settingsAPI } = createMobileAPIs();
  window.widgetAPI = widgetAPI;
  window.settingsAPI = settingsAPI;
  _mobileWidgetAPI = widgetAPI;
  _mobileSettingsAPI = settingsAPI;
  
  initialized = true;
}
