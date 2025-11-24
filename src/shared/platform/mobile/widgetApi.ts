import { BrowserNotionClient } from '@common/notion/browserClient';
import type { SettingsAPI, WidgetAPI } from '@shared/ipc';
import type {
  AppPreferences,
  DockState,
  NotionCreatePayload,
  NotionSettings,
  ResizeDirection,
  Task,
  TaskStatusOption,
  TaskUpdatePayload,
  TimeLogEntry,
  TimeLogEntryPayload,
  TimeLogSettings,
  TimeLogUpdatePayload,
  UpdateInfo,
  UpdateStatus,
  WritingEntryPayload,
  WritingSettings
} from '@shared/types';
import { PREFERENCE_DEFAULTS } from '../../../renderer/constants/preferences';
import { mobileStore } from './storage';

const notionClient = new BrowserNotionClient();
const dockListeners = new Set<(state: DockState) => void>();
const taskListeners = new Set<(task: Task) => void>();

let cachedTaskSettings: NotionSettings | null = null;
let cachedWritingSettings: WritingSettings | null = null;
let cachedTimeLogSettings: TimeLogSettings | null = null;
let cachedPreferences: AppPreferences | null = null;
let cachedDockState: DockState | null = null;

const widgetAPI: WidgetAPI = {
  async getTasks() {
    await ensureTaskSettings();
    return notionClient.getTasks();
  },
  async addTask(payload: NotionCreatePayload) {
    await ensureTaskSettings();
    const task = await notionClient.addTask(payload);
    emitTaskUpdated(task);
    return task;
  },
  async updateTask(taskId: string, updates: TaskUpdatePayload) {
    await ensureTaskSettings();
    const updated = await notionClient.updateTask(taskId, updates);
    emitTaskUpdated(updated);
    return updated;
  },
  async getStatusOptions() {
    await ensureTaskSettings();
    return notionClient.getStatusOptions();
  },
  async openTaskWindow(_taskId: string) {
    // No-op on mobile; the UI hides pop-out actions.
  },
  async resizeWindow(
    _direction: ResizeDirection,
    _deltaX: number,
    _deltaY: number
  ) {
    // Not supported on mobile.
  },
  async getSettings() {
    return ensureTaskSettings();
  },
  async updateSettings(settings: NotionSettings) {
    const saved = await mobileStore.setTaskSettings(settings);
    cachedTaskSettings = saved;
    notionClient.configureTasks(saved);
    return saved;
  },
  async setAlwaysOnTop(flag: boolean) {
    const prefs = await ensureAppPreferences();
    const saved = await mobileStore.setAppPreferences({
      ...prefs,
      alwaysOnTop: flag
    });
    cachedPreferences = saved;
    return saved.alwaysOnTop;
  },
  async getAlwaysOnTop() {
    const prefs = await ensureAppPreferences();
    return prefs.alwaysOnTop;
  },
  async getWritingSettings() {
    return ensureWritingSettings();
  },
  async createWritingEntry(payload: WritingEntryPayload) {
    await ensureWritingSettings();
    await notionClient.createWritingEntry(payload);
  },
  async getTimeLogSettings() {
    return ensureTimeLogSettings();
  },
  async createTimeLogEntry(payload: TimeLogEntryPayload) {
    await ensureTimeLogSettings();
    await notionClient.createTimeLogEntry(payload);
  },
  async getActiveTimeLogEntry(taskId: string) {
    await ensureTimeLogSettings();
    return notionClient.getActiveTimeLogEntry(taskId);
  },
  async getTotalLoggedTime(taskId: string) {
    await ensureTimeLogSettings();
    return notionClient.getTotalLoggedTime(taskId);
  },
  async getAllTimeLogEntries(taskId: string) {
    await ensureTimeLogSettings();
    return notionClient.getAllTimeLogEntries(taskId);
  },
  async getAllTimeLogs(): Promise<TimeLogEntry[]> {
    await ensureTimeLogSettings();
    // For mobile, we'll need to implement this in BrowserNotionClient
    // For now, return empty array as mobile may not need this functionality
    return [];
  },
  async updateTimeLogEntry(entryId: string, updates: TimeLogUpdatePayload): Promise<TimeLogEntry> {
    await ensureTimeLogSettings();
    // For mobile, we'll need to implement this in BrowserNotionClient
    // For now, throw an error indicating it's not implemented
    throw new Error('updateTimeLogEntry not implemented for mobile');
  },
  async deleteTimeLogEntry(entryId: string): Promise<void> {
    await ensureTimeLogSettings();
    // For mobile, we'll need to implement this in BrowserNotionClient
    // For now, throw an error indicating it's not implemented
    throw new Error('deleteTimeLogEntry not implemented for mobile');
  },
  async getAppPreferences() {
    return ensureAppPreferences();
  },
  async updateAppPreferences(preferences: AppPreferences) {
    const saved = await mobileStore.setAppPreferences(preferences);
    cachedPreferences = saved;
    return saved;
  },
  async setLaunchOnStartup(enabled: boolean) {
    const prefs = await ensureAppPreferences();
    const saved = await mobileStore.setAppPreferences({
      ...prefs,
      launchOnStartup: enabled
    });
    cachedPreferences = saved;
    return saved;
  },
  async setDockEdge(edge) {
    const state = await ensureDockState();
    const next = await mobileStore.setDockState({ ...state, edge });
    cachedDockState = next;
    emitDockState(next);
    return next;
  },
  async requestExpand() {
    const state = await ensureDockState();
    if (state.collapsed) {
      const next = await mobileStore.setDockState({ ...state, collapsed: false });
      cachedDockState = next;
      emitDockState(next);
      return next;
    }
  },
  async requestCollapse() {
    const state = await ensureDockState();
    if (!state.collapsed) {
      const next = await mobileStore.setDockState({ ...state, collapsed: true });
      cachedDockState = next;
      emitDockState(next);
      return next;
    }
  },
  async forceCollapse() {
    return widgetAPI.requestCollapse();
  },
  async setThinState(_thin: boolean) {
    // No equivalent on mobile.
  },
  async setCaptureState(_capture: boolean) {
    // No equivalent on mobile.
  },
  onDockStateChange(callback: (state: DockState) => void) {
    dockListeners.add(callback);
    if (cachedDockState) {
      callback(cachedDockState);
    }
    return () => dockListeners.delete(callback);
  },
  onTaskUpdated(callback: (task: Task) => void) {
    taskListeners.add(callback);
    return () => taskListeners.delete(callback);
  },
  async openWidgetSettingsWindow() {
    navigateToPage('widget-settings.html');
  },
  async openSettingsWindow() {
    navigateToPage('settings.html');
  },
  async getDockState() {
    return ensureDockState();
  },
  async closeWindow() {
    returnToMainView();
  },
  async openFullScreenWindow() {
    // No-op on mobile
  },
  async closeFullScreenWindow() {
    // No-op on mobile
  },
  async checkForUpdates() {
    return { status: 'not-available' as UpdateStatus, info: null };
  },
  async downloadUpdate() {
    return { status: 'not-available' as UpdateStatus, info: null };
  },
  async installUpdate() {
    // No-op on mobile
  },
  async getUpdateStatus() {
    return { status: 'not-available' as UpdateStatus, info: null };
  },
  onUpdateStatusChange(_callback: (data: { status: UpdateStatus; info: UpdateInfo | null }) => void) {
    return () => {};
  },
  async getAppVersion() {
    return '1.0.0';
  }
};

const settingsAPI: SettingsAPI = {
  async getTaskSettings() {
    return ensureTaskSettings();
  },
  async updateTaskSettings(settings: NotionSettings) {
    return widgetAPI.updateSettings(settings);
  },
  async getWritingSettings() {
    return ensureWritingSettings();
  },
  async updateWritingSettings(settings: WritingSettings) {
    const saved = await mobileStore.setWritingSettings(settings);
    cachedWritingSettings = saved;
    notionClient.configureWriting(saved);
    return saved;
  },
  async getAppPreferences() {
    return ensureAppPreferences();
  },
  async updateAppPreferences(preferences: AppPreferences) {
    return widgetAPI.updateAppPreferences(preferences);
  },
  async setLaunchOnStartup(enabled: boolean) {
    return widgetAPI.setLaunchOnStartup(enabled);
  },
  async previewNotification(payload) {
    console.info(
      '[mobile] Notification preview:',
      `${payload.title} → ${payload.body}`
    );
  },
  async createWritingEntry(payload: WritingEntryPayload) {
    return widgetAPI.createWritingEntry(payload);
  },
  async getTimeLogSettings() {
    return ensureTimeLogSettings();
  },
  async updateTimeLogSettings(settings: TimeLogSettings) {
    const saved = await mobileStore.setTimeLogSettings(settings);
    cachedTimeLogSettings = saved;
    notionClient.configureTimeLog(saved);
    return saved;
  },
  async createTimeLogEntry(payload: TimeLogEntryPayload) {
    return widgetAPI.createTimeLogEntry(payload);
  }
};

export function createMobileAPIs() {
  return { widgetAPI, settingsAPI };
}

async function ensureTaskSettings() {
  if (!cachedTaskSettings) {
    const settings = await mobileStore.getTaskSettings();
    cachedTaskSettings = settings;
    notionClient.configureTasks(settings);
  }
  return cachedTaskSettings;
}

async function ensureWritingSettings() {
  if (!cachedWritingSettings) {
    const settings = await mobileStore.getWritingSettings();
    cachedWritingSettings = settings;
    notionClient.configureWriting(settings);
  }
  return cachedWritingSettings;
}

async function ensureTimeLogSettings() {
  if (!cachedTimeLogSettings) {
    const settings = await mobileStore.getTimeLogSettings();
    cachedTimeLogSettings = settings;
    notionClient.configureTimeLog(settings);
  }
  return cachedTimeLogSettings;
}

async function ensureAppPreferences() {
  if (!cachedPreferences) {
    cachedPreferences = await mobileStore.getAppPreferences();
  }
  return cachedPreferences;
}

async function ensureDockState() {
  if (!cachedDockState) {
    cachedDockState = await mobileStore.getDockState();
  }
  return cachedDockState;
}

function emitDockState(state: DockState) {
  dockListeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.error('[mobile] Dock listener failed', error);
    }
  });
}

function emitTaskUpdated(task: Task) {
  taskListeners.forEach((listener) => {
    try {
      listener(task);
    } catch (error) {
      console.error('[mobile] Task listener failed', error);
    }
  });
}

// Type declarations for browser globals (only used in mobile/browser context)
// These are only used at runtime in browser context, not in Node.js
declare const window: typeof globalThis & {
  location?: { href: string; pathname?: string; replace(url: string): void };
  history?: { length: number; back(): void };
};

function navigateToPage(page: string) {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof window === 'undefined' || !window.location) return;
  const url = new URL(page, window.location.href);
  window.location.href = url.toString();
}

function returnToMainView() {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof window === 'undefined' || !window.location) return;
  const pathname = window.location.pathname ?? '';
  if (pathname.endsWith('settings.html') || pathname.endsWith('widget-settings.html')) {
    const url = new URL('index.html', window.location.href);
    window.location.replace(url.toString());
    return;
  }
  if (window.history && window.history.length > 1) {
    window.history.back();
  } else if (window.location) {
    window.location.replace('index.html');
  }
}

