import type { SettingsAPI, WidgetAPI } from '@shared/ipc';

export type RuntimePlatform = 'desktop' | 'mobile';

export interface PlatformBridge {
  target: RuntimePlatform;
  widgetAPI: WidgetAPI;
  settingsAPI: SettingsAPI;
  hasWindowControls: boolean;
}

type GlobalWithBridge = typeof globalThis & {
  widgetAPI?: WidgetAPI;
  settingsAPI?: SettingsAPI;
};

const globalCandidate: GlobalWithBridge =
  typeof globalThis === 'object' ? (globalThis as GlobalWithBridge) : ({} as any);

function getWidgetAPI(): WidgetAPI {
  // Check window first (set by ensureMobileBridge or Electron preload)
  if (globalCandidate.widgetAPI) {
    return globalCandidate.widgetAPI;
  }
  // Return proxy that throws helpful error
  return createUnavailableProxy<WidgetAPI>('widgetAPI');
}

function getSettingsAPI(): SettingsAPI {
  // Check window first (set by ensureMobileBridge or Electron preload)
  if (globalCandidate.settingsAPI) {
    return globalCandidate.settingsAPI;
  }
  // Return proxy that throws helpful error
  return createUnavailableProxy<SettingsAPI>('settingsAPI');
}

let runtimeTarget: RuntimePlatform = globalCandidate.widgetAPI ? 'desktop' : 'mobile';

// Use getters so we always get the current API (after bridge initialization)
export const platformBridge: PlatformBridge = {
  get target() { return runtimeTarget; },
  set target(value) { runtimeTarget = value; },
  get widgetAPI() { return getWidgetAPI(); },
  set widgetAPI(value) { /* no-op, use window.widgetAPI */ },
  get settingsAPI() { return getSettingsAPI(); },
  set settingsAPI(value) { /* no-op, use window.settingsAPI */ },
  get hasWindowControls() { return runtimeTarget === 'desktop'; },
  set hasWindowControls(value) { /* derived from target */ }
};

// These also use getters now
export const widgetBridge = new Proxy({} as WidgetAPI, {
  get(_target, prop) {
    return getWidgetAPI()[prop as keyof WidgetAPI];
  }
});

export const settingsBridge = new Proxy({} as SettingsAPI, {
  get(_target, prop) {
    return getSettingsAPI()[prop as keyof SettingsAPI];
  }
});

export const isDesktopRuntime = globalCandidate.widgetAPI !== undefined;

export { ensureMobileBridge } from './mobileBridge';

export function setPlatformApis(
  widgetApi: WidgetAPI,
  settingsApi: SettingsAPI,
  target: RuntimePlatform
) {
  // Set on window so getWidgetAPI/getSettingsAPI can find them
  // Only set if not already defined (contextBridge creates read-only properties)
  if (!globalCandidate.widgetAPI) {
    try {
      globalCandidate.widgetAPI = widgetApi;
    } catch {
      // Property is read-only (set by Electron contextBridge), which is fine
    }
  }
  if (!globalCandidate.settingsAPI) {
    try {
      globalCandidate.settingsAPI = settingsApi;
    } catch {
      // Property is read-only (set by Electron contextBridge), which is fine
    }
  }
  runtimeTarget = target;
}

function createUnavailableProxy<T extends object>(label: string): T {
  return new Proxy(
    {},
    {
      get(_target, propKey: PropertyKey) {
        const prop = String(propKey);
        throw new Error(
          `[platform] ${label}.${prop} is not available on the ${runtimeTarget} runtime`
        );
      }
    }
  ) as T;
}
