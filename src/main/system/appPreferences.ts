import { app, Notification, shell } from 'electron';
import type {
  AppPreferences,
  NotificationPreviewPayload
} from '../../shared/types';

let currentPreferences: AppPreferences = {
  launchOnStartup: false,
  enableNotifications: true,
  enableSounds: true,
  alwaysOnTop: true,
  pinWidget: false,
  autoRefreshTasks: false,
  expandMode: 'hover',
  autoCollapse: true,
  preventMinimalDuringSession: true
};

export function applyAppPreferences(preferences: AppPreferences) {
  currentPreferences = preferences;
  try {
    app.setLoginItemSettings({
      openAtLogin: preferences.launchOnStartup,
      enabled: preferences.launchOnStartup
    });
  } catch (error) {
    console.error('Unable to apply startup preference', error);
  }
}

export function previewDesktopNotification(
  payload: NotificationPreviewPayload
) {
  if (!currentPreferences.enableNotifications) {
    playSoundCue();
    return false;
  }
  if (!Notification.isSupported()) {
    playSoundCue();
    return false;
  }
  const notification = new Notification({
    title: payload.title,
    body: payload.body,
    silent: !currentPreferences.enableSounds
  });
  notification.show();
  return true;
}

export function notifyWritingEntryCaptured() {
  const handled = previewDesktopNotification({
    title: 'Writing entry sent',
    body: 'Your log entry is now in Notion.'
  });
  if (!handled) {
    playSoundCue();
  }
}

export function playSoundCue() {
  if (!currentPreferences.enableSounds) return;
  shell.beep();
}

