import type { SettingsAPI, WidgetAPI } from '@shared/ipc';
import { createMobileAPIs } from './mobile/widgetApi';
import { setPlatformApis } from '.';

// Type declarations for browser globals (only used in mobile/browser context)
// These are only used at runtime in browser context, not in Node.js
declare const window: typeof globalThis & {
  widgetAPI?: WidgetAPI;
  settingsAPI?: SettingsAPI;
  location?: { href: string; pathname?: string; replace(url: string): void };
  history?: { length: number; back(): void };
};

let initialized = false;

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
  setPlatformApis(widgetAPI, settingsAPI, 'mobile');
  initialized = true;
}

