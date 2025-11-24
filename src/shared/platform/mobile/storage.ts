import { Preferences } from '@capacitor/preferences';
import type {
  AppPreferences,
  DockEdge,
  DockState,
  NotionSettings,
  TimeLogSettings,
  WritingSettings
} from '@shared/types';
import { PREFERENCE_DEFAULTS } from '../../../renderer/constants/preferences';

const STORAGE_KEYS = {
  tasks: 'mobile.settings.tasks',
  writing: 'mobile.settings.writing',
  timeLog: 'mobile.settings.timeLog',
  app: 'mobile.preferences.app',
  dock: 'mobile.dock.state'
} as const;

const DEFAULT_NOTION_SETTINGS: NotionSettings = {
  apiKey: '',
  databaseId: '',
  dataSourceId: '',
  titleProperty: '',
  statusProperty: '',
  dateProperty: '',
  deadlineProperty: '',
  deadlineHardValue: '',
  deadlineSoftValue: '',
  statusPresets: [],
  urgentProperty: '',
  urgentStatusActive: '',
  urgentStatusInactive: '',
  importantProperty: '',
  importantStatusActive: '',
  importantStatusInactive: '',
  completedStatus: '',
  mainEntryProperty: 'Main Entry'
};

const DEFAULT_WRITING_SETTINGS: WritingSettings = {
  apiKey: '',
  databaseId: '',
  titleProperty: '',
  summaryProperty: '',
  tagsProperty: '',
  statusProperty: '',
  publishedStatus: '',
  draftStatus: ''
};

const DEFAULT_TIME_LOG_SETTINGS: TimeLogSettings = {
  apiKey: '',
  databaseId: '12d8cc9f36f180849cc6d39db3826ac6',
  taskProperty: '',
  statusProperty: '',
  startTimeProperty: '',
  endTimeProperty: '',
  titleProperty: 'Name'
};

const DEFAULT_DOCK_STATE: DockState = { edge: 'top', collapsed: false };

export const mobileStore = {
  async getTaskSettings(): Promise<NotionSettings> {
    return normalizeNotionSettings(
      await readJson(STORAGE_KEYS.tasks, DEFAULT_NOTION_SETTINGS)
    );
  },
  async setTaskSettings(settings: NotionSettings) {
    const normalized = normalizeNotionSettings(settings);
    await writeJson(STORAGE_KEYS.tasks, normalized);
    return normalized;
  },
  async getWritingSettings(): Promise<WritingSettings> {
    return normalizeWritingSettings(
      await readJson(STORAGE_KEYS.writing, DEFAULT_WRITING_SETTINGS)
    );
  },
  async setWritingSettings(settings: WritingSettings) {
    const normalized = normalizeWritingSettings(settings);
    await writeJson(STORAGE_KEYS.writing, normalized);
    return normalized;
  },
  async getTimeLogSettings(): Promise<TimeLogSettings> {
    return normalizeTimeLogSettings(
      await readJson(STORAGE_KEYS.timeLog, DEFAULT_TIME_LOG_SETTINGS)
    );
  },
  async setTimeLogSettings(settings: TimeLogSettings) {
    const normalized = normalizeTimeLogSettings(settings);
    await writeJson(STORAGE_KEYS.timeLog, normalized);
    return normalized;
  },
  async getAppPreferences(): Promise<AppPreferences> {
    return normalizeAppPreferences(
      await readJson(STORAGE_KEYS.app, PREFERENCE_DEFAULTS)
    );
  },
  async setAppPreferences(preferences: AppPreferences) {
    const normalized = normalizeAppPreferences(preferences);
    await writeJson(STORAGE_KEYS.app, normalized);
    return normalized;
  },
  async getDockState(): Promise<DockState> {
    return normalizeDockState(
      await readJson(STORAGE_KEYS.dock, DEFAULT_DOCK_STATE)
    );
  },
  async setDockState(state: DockState) {
    const normalized = normalizeDockState(state);
    await writeJson(STORAGE_KEYS.dock, normalized);
    return normalized;
  }
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const { value } = await Preferences.get({ key });
    if (!value) return clone(fallback);
    return { ...fallback, ...JSON.parse(value) };
  } catch (error) {
    console.error(`[mobileStore] Failed to read ${key}`, error);
    return clone(fallback);
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  await Preferences.set({
    key,
    value: JSON.stringify(value)
  });
}

function normalizeNotionSettings(settings: NotionSettings): NotionSettings {
  return {
    ...DEFAULT_NOTION_SETTINGS,
    ...settings,
    statusPresets: Array.isArray(settings.statusPresets)
      ? settings.statusPresets
      : []
  };
}

function normalizeWritingSettings(settings: WritingSettings): WritingSettings {
  return {
    ...DEFAULT_WRITING_SETTINGS,
    ...settings
  };
}

function normalizeTimeLogSettings(settings: TimeLogSettings): TimeLogSettings {
  return {
    ...DEFAULT_TIME_LOG_SETTINGS,
    ...settings
  };
}

function normalizeAppPreferences(preferences: AppPreferences): AppPreferences {
  return {
    ...PREFERENCE_DEFAULTS,
    ...preferences
  };
}

function normalizeDockState(state: DockState): DockState {
  const edge: DockEdge =
    state.edge === 'left' || state.edge === 'right' ? state.edge : 'top';
  return {
    edge,
    collapsed: Boolean(state.collapsed)
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

