import type { SettingsAPI, WidgetAPI } from '@shared/ipc';

declare global {
  interface Window {
    widgetAPI: WidgetAPI;
    settingsAPI: SettingsAPI;
    webkitSpeechRecognition?: typeof SpeechRecognition;
  }
}

export {};





