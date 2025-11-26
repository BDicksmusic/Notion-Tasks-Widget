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
  dock: 'mobile.dock.state',
  devDefaultsApplied: 'mobile.dev.defaultsApplied'
} as const;

// Type declaration for dev defaults injected at build time
declare const __MOBILE_DEV_DEFAULTS__: {
  apiKey: string;
  databaseId: string;
  dataSourceId: string;
  titleProperty: string;
  statusProperty: string;
  dateProperty: string;
  deadlineProperty: string;
  deadlineHardValue: string;
  deadlineSoftValue: string;
  urgentProperty: string;
  urgentStatusActive: string;
  urgentStatusInactive: string;
  importantProperty: string;
  importantStatusActive: string;
  importantStatusInactive: string;
  completedStatus: string;
  mainEntryProperty: string;
} | undefined;

declare const __DEV_MODE__: boolean | undefined;

// Get dev defaults if available (injected at build time from .env)
function getDevDefaults(): Partial<NotionSettings> | null {
  try {
    if (typeof __MOBILE_DEV_DEFAULTS__ !== 'undefined' && __MOBILE_DEV_DEFAULTS__) {
      return __MOBILE_DEV_DEFAULTS__;
    }
  } catch {
    // Not available
  }
  return null;
}

function isDevMode(): boolean {
  try {
    return typeof __DEV_MODE__ !== 'undefined' && __DEV_MODE__ === true;
  } catch {
    return false;
  }
}

// Build default settings, using dev defaults if available
const devDefaults = getDevDefaults();

const DEFAULT_NOTION_SETTINGS: NotionSettings = {
  apiKey: devDefaults?.apiKey || '',
  databaseId: devDefaults?.databaseId || '',
  dataSourceId: devDefaults?.dataSourceId || '',
  titleProperty: devDefaults?.titleProperty || 'Name',
  statusProperty: devDefaults?.statusProperty || 'Status',
  dateProperty: devDefaults?.dateProperty || 'Date',
  deadlineProperty: devDefaults?.deadlineProperty || 'Hard Deadline?',
  deadlineHardValue: devDefaults?.deadlineHardValue || '⭕Hard',
  deadlineSoftValue: devDefaults?.deadlineSoftValue || '🔵Soft',
  statusPresets: [],
  urgentProperty: devDefaults?.urgentProperty || 'Urgent',
  urgentStatusActive: devDefaults?.urgentStatusActive || '‼',
  urgentStatusInactive: devDefaults?.urgentStatusInactive || '○',
  importantProperty: devDefaults?.importantProperty || 'Important',
  importantStatusActive: devDefaults?.importantStatusActive || '◉',
  importantStatusInactive: devDefaults?.importantStatusInactive || '○',
  completedStatus: devDefaults?.completedStatus || '✅',
  mainEntryProperty: devDefaults?.mainEntryProperty || 'Main Entry'
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
    // Check if we should auto-apply dev defaults on first run
    const devDefaults = getDevDefaults();
    if (devDefaults?.apiKey) {
      const { value: applied } = await Preferences.get({ key: STORAGE_KEYS.devDefaultsApplied });
      if (!applied) {
        // Check if there are existing settings with an API key
        const existing = await readJson(STORAGE_KEYS.tasks, DEFAULT_NOTION_SETTINGS);
        if (!existing.apiKey) {
          console.log('[mobileStore] Auto-applying dev defaults from .env');
          const withDefaults = normalizeNotionSettings({ ...existing, ...devDefaults });
          await writeJson(STORAGE_KEYS.tasks, withDefaults);
          await Preferences.set({ key: STORAGE_KEYS.devDefaultsApplied, value: 'true' });
          return withDefaults;
        }
      }
    }
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


