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

const resolvedWidgetAPI = globalCandidate.widgetAPI;
const resolvedSettingsAPI = globalCandidate.settingsAPI;

let runtimeTarget: RuntimePlatform = resolvedWidgetAPI ? 'desktop' : 'mobile';
const fallbackWidget = createUnavailableProxy<WidgetAPI>('widgetAPI');
const fallbackSettings = createUnavailableProxy<SettingsAPI>('settingsAPI');

export const platformBridge: PlatformBridge = {
  target: runtimeTarget,
  widgetAPI: resolvedWidgetAPI ?? fallbackWidget,
  settingsAPI: resolvedSettingsAPI ?? fallbackSettings,
  hasWindowControls: runtimeTarget === 'desktop'
};

export let widgetBridge = platformBridge.widgetAPI;
export let settingsBridge = platformBridge.settingsAPI;
export const isDesktopRuntime = runtimeTarget === 'desktop';
export { ensureMobileBridge } from './mobileBridge';

export function setPlatformApis(
  widgetApi: WidgetAPI,
  settingsApi: SettingsAPI,
  target: RuntimePlatform
) {
  platformBridge.widgetAPI = widgetApi;
  platformBridge.settingsAPI = settingsApi;
  platformBridge.target = target;
  platformBridge.hasWindowControls = target === 'desktop';
  widgetBridge = widgetApi;
  settingsBridge = settingsApi;
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

