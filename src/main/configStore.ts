import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AppPreferences,
  NotionSettings,
  TimeLogSettings,
  WidgetConfig,
  WritingSettings
} from '../shared/types';

const CONFIG_FILENAME = 'notion-widget.config.json';
const CONFIG_VERSION = 2;

let configPath = '';
let config: WidgetConfig = createDefaultConfig();
let needsWritingConfigPersist = false;

export function initConfigStore(userDataPath: string) {
  configPath = path.join(userDataPath, CONFIG_FILENAME);
  config = createDefaultConfig();
  return loadFromDisk();
}

export function getConfig(): WidgetConfig {
  return config;
}

export function getSettings() {
  return config.tasks;
}

export function getTaskSettings() {
  return config.tasks;
}

export function getWritingSettings() {
  return config.writing;
}

export function getTimeLogSettings() {
  return config.timeLog;
}

export function getAppPreferences() {
  return config.app;
}

export async function updateSettings(
  next: NotionSettings
): Promise<NotionSettings> {
  return updateTaskSettings(next);
}

export async function updateTaskSettings(
  next: NotionSettings
): Promise<NotionSettings> {
  config = {
    ...config,
    tasks: normalizeTaskSettings(next)
  };
  await persistConfig();
  return config.tasks;
}

export async function updateWritingSettings(
  next: WritingSettings
): Promise<WritingSettings> {
  config = {
    ...config,
    writing: normalizeWritingSettings(next)
  };
  await persistConfig();
  return config.writing;
}

export async function updateTimeLogSettings(
  next: TimeLogSettings
): Promise<TimeLogSettings> {
  config = {
    ...config,
    timeLog: normalizeTimeLogSettings(next)
  };
  await persistConfig();
  return config.timeLog;
}

export async function updateAppPreferences(
  next: AppPreferences
): Promise<AppPreferences> {
  config = {
    ...config,
    app: normalizeAppPreferences(next)
  };
  await persistConfig();
  return config.app;
}

function createDefaultConfig(): WidgetConfig {
  return {
    version: CONFIG_VERSION,
    tasks: normalizeTaskSettings(loadTaskDefaults()),
    writing: normalizeWritingSettings(loadWritingDefaults()),
    timeLog: normalizeTimeLogSettings(loadTimeLogDefaults()),
    app: normalizeAppPreferences(loadAppDefaults())
  };
}

async function loadFromDisk() {
  let shouldWrite = false;
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const migrated = migrateConfig(parsed);
    shouldWrite =
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed.version ?? 0) !== CONFIG_VERSION ||
      isLegacyTaskConfig(parsed);
    config = migrated;
  } catch {
    config = createDefaultConfig();
    shouldWrite = true;
  }

  if (shouldWrite || needsWritingConfigPersist) {
    needsWritingConfigPersist = false;
    await persistConfig();
  }

  return config;
}

function migrateConfig(raw: unknown): WidgetConfig {
  const defaults = createDefaultConfig();
  if (isWidgetConfig(raw)) {
    const next = raw as Partial<WidgetConfig>;
    return {
      version: CONFIG_VERSION,
      tasks: normalizeTaskSettings({
        ...defaults.tasks,
        ...(next.tasks ?? {})
      }),
      writing: normalizeWritingSettings({
        ...defaults.writing,
        ...(next.writing ?? {})
      }),
      timeLog: normalizeTimeLogSettings({
        ...defaults.timeLog,
        ...(next.timeLog ?? {})
      }),
      app: normalizeAppPreferences({
        ...defaults.app,
        ...(next.app ?? {})
      })
    };
  }

  if (isLegacyTaskConfig(raw)) {
    return {
      version: CONFIG_VERSION,
      tasks: normalizeTaskSettings({
        ...defaults.tasks,
        ...(raw as Partial<NotionSettings>)
      }),
      writing: defaults.writing,
      timeLog: defaults.timeLog,
      app: defaults.app
    };
  }

  return defaults;
}

async function persistConfig() {
  if (!configPath) {
    throw new Error('Config path has not been initialized');
  }
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

function normalizeTaskSettings(next: NotionSettings): NotionSettings {
  const normalized: NotionSettings = {
    ...next,
    statusPresets: Array.isArray(next.statusPresets)
      ? next.statusPresets.map((entry) => entry.trim()).filter(Boolean)
      : []
  };

  const equals = (value: string | undefined, target: string) =>
    value?.trim().toLowerCase() === target.toLowerCase();

  const deadlineProp = normalized.deadlineProperty?.trim();
  if (deadlineProp && deadlineProp.toLowerCase() === 'hard deadline?') {
    normalized.deadlineProperty = 'Hard Deadline?';
  }

  if (normalized.deadlineHardValue?.trim() === 'Hard deadline') {
    normalized.deadlineHardValue = '⭕Hard';
  }

  if (normalized.deadlineSoftValue?.trim() === 'Soft deadline') {
    normalized.deadlineSoftValue = '🔵Soft';
  }

  if (
    equals(normalized.urgentStatusActive, 'urgent') ||
    normalized.urgentStatusActive === '!!'
  ) {
    normalized.urgentStatusActive = '‼';
  }

  if (
    equals(normalized.urgentStatusInactive, 'not urgent') ||
    normalized.urgentStatusInactive === 'Not urgent'
  ) {
    normalized.urgentStatusInactive = '○';
  }

  if (equals(normalized.importantStatusActive, 'important')) {
    normalized.importantStatusActive = '◉';
  }

  if (equals(normalized.importantStatusInactive, 'not important')) {
    normalized.importantStatusInactive = '○';
  }

  if (normalized.mainEntryProperty) {
    normalized.mainEntryProperty = normalized.mainEntryProperty.trim();
  }

  if (normalized.sessionLengthProperty) {
    normalized.sessionLengthProperty = normalized.sessionLengthProperty.trim();
    if (normalized.sessionLengthProperty === 'Session Length') {
      normalized.sessionLengthProperty = 'Sess. Length';
    }
  }

  if (normalized.estimatedLengthProperty) {
    normalized.estimatedLengthProperty =
      normalized.estimatedLengthProperty.trim();
  }

  if (!normalized.sessionLengthProperty) {
    normalized.sessionLengthProperty = 'Sess. Length';
  }

  if (!normalized.estimatedLengthProperty) {
    normalized.estimatedLengthProperty = 'Est. Length';
  }

  return normalized;
}

function normalizeWritingSettings(next: WritingSettings): WritingSettings {
  const {
    // Legacy field removed in favor of page body content.
    contentProperty: _deprecatedContentProperty,
    ...rest
  } = next as WritingSettings & { contentProperty?: string };

  if (_deprecatedContentProperty !== undefined) {
    needsWritingConfigPersist = true;
  }

  return {
    ...rest,
    apiKey: rest.apiKey?.trim() || undefined,
    databaseId: rest.databaseId?.trim() ?? '',
    titleProperty: rest.titleProperty?.trim() || 'Name',
    summaryProperty: rest.summaryProperty?.trim() || undefined,
    tagsProperty: rest.tagsProperty?.trim() || undefined,
    statusProperty: rest.statusProperty?.trim() || undefined,
    publishedStatus: rest.publishedStatus?.trim() || undefined,
    draftStatus: rest.draftStatus?.trim() || undefined
  };
}

function normalizeTimeLogSettings(next: TimeLogSettings): TimeLogSettings {
  return {
    ...next,
    apiKey: next.apiKey?.trim() || undefined,
    databaseId: next.databaseId?.trim() ?? '',
    taskProperty: next.taskProperty?.trim() || undefined,
    statusProperty: next.statusProperty?.trim() || undefined,
    startTimeProperty: next.startTimeProperty?.trim() || undefined,
    endTimeProperty: next.endTimeProperty?.trim() || undefined,
    titleProperty: next.titleProperty?.trim() || 'Name'
  };
}

function normalizeAppPreferences(next: AppPreferences): AppPreferences {
  return {
    launchOnStartup: Boolean(next.launchOnStartup),
    enableNotifications:
      next.enableNotifications === undefined
        ? true
        : Boolean(next.enableNotifications),
    enableSounds:
      next.enableSounds === undefined ? true : Boolean(next.enableSounds),
    alwaysOnTop:
      next.alwaysOnTop === undefined ? true : Boolean(next.alwaysOnTop),
    pinWidget: Boolean(next.pinWidget),
    autoRefreshTasks: Boolean(next.autoRefreshTasks),
    expandMode: next.expandMode === 'button' ? 'button' : 'hover',
    autoCollapse: next.autoCollapse === undefined ? true : Boolean(next.autoCollapse),
    preventMinimalDuringSession: next.preventMinimalDuringSession === undefined ? true : Boolean(next.preventMinimalDuringSession)
  };
}

function envDefault(name: string, fallback: string) {
  return process.env[name] ?? fallback;
}

function envFlag(name: string, fallback: boolean) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

function parseList(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function loadTaskDefaults(): NotionSettings {
  return {
    apiKey: envDefault('NOTION_API_KEY', ''),
    databaseId: envDefault('NOTION_DATABASE_ID', ''),
    dataSourceId: process.env.NOTION_DATA_SOURCE_ID,
    titleProperty: envDefault('NOTION_TASK_TITLE_PROP', 'Name'),
    statusProperty: envDefault('NOTION_TASK_STATUS_PROP', 'Status'),
    dateProperty: envDefault('NOTION_TASK_DATE_PROP', 'Date'),
    deadlineProperty: envDefault('NOTION_TASK_DEADLINE_PROP', 'Hard Deadline?'),
    deadlineHardValue: envDefault('NOTION_TASK_DEADLINE_HARD', '⭕Hard'),
    deadlineSoftValue: envDefault('NOTION_TASK_DEADLINE_SOFT', '🔵Soft'),
    statusPresets: parseList(envDefault('NOTION_TASK_STATUS_PRESETS', '')),
    urgentProperty: envDefault('NOTION_TASK_URGENT_PROP', 'Urgent'),
    urgentStatusActive: envDefault('NOTION_TASK_URGENT_ACTIVE', '‼'),
    urgentStatusInactive: envDefault('NOTION_TASK_URGENT_INACTIVE', '○'),
    importantProperty: envDefault('NOTION_TASK_IMPORTANT_PROP', 'Important'),
    importantStatusActive: envDefault('NOTION_TASK_IMPORTANT_ACTIVE', '◉'),
    importantStatusInactive: envDefault(
      'NOTION_TASK_IMPORTANT_INACTIVE',
      '○'
    ),
    completedStatus: envDefault('NOTION_COMPLETED_STATUS', '✅'),
    sessionLengthProperty: envDefault(
      'NOTION_TASK_SESSION_LENGTH_PROP',
      'Sess. Length'
    ),
    estimatedLengthProperty: envDefault(
      'NOTION_TASK_ESTIMATE_PROP',
      'Est. Length'
    )
  };
}

function loadWritingDefaults(): WritingSettings {
  return {
    apiKey: process.env.NOTION_WRITING_API_KEY ?? process.env.NOTION_API_KEY,
    databaseId: envDefault('NOTION_WRITING_DATABASE_ID', ''),
    titleProperty: envDefault('NOTION_WRITING_TITLE_PROP', 'Name'),
    summaryProperty: process.env.NOTION_WRITING_SUMMARY_PROP ?? 'Summary',
    tagsProperty: process.env.NOTION_WRITING_TAGS_PROP,
    statusProperty: process.env.NOTION_WRITING_STATUS_PROP,
    publishedStatus: process.env.NOTION_WRITING_PUBLISHED_STATUS,
    draftStatus: process.env.NOTION_WRITING_DRAFT_STATUS
  };
}

function loadTimeLogDefaults(): TimeLogSettings {
  return {
    apiKey: process.env.NOTION_TIME_LOG_API_KEY ?? process.env.NOTION_API_KEY,
    databaseId: envDefault('NOTION_TIME_LOG_DATABASE_ID', '12d8cc9f36f180849cc6d39db3826ac6'),
    taskProperty: process.env.NOTION_TIME_LOG_TASK_PROP,
    statusProperty: process.env.NOTION_TIME_LOG_STATUS_PROP,
    startTimeProperty: process.env.NOTION_TIME_LOG_START_TIME_PROP,
    endTimeProperty: process.env.NOTION_TIME_LOG_END_TIME_PROP,
    titleProperty: envDefault('NOTION_TIME_LOG_TITLE_PROP', 'Name')
  };
}

function loadAppDefaults(): AppPreferences {
  return {
    launchOnStartup: envFlag('WIDGET_LAUNCH_ON_STARTUP', false),
    enableNotifications: envFlag('WIDGET_NOTIFICATIONS_ENABLED', true),
    enableSounds: envFlag('WIDGET_SOUNDS_ENABLED', true),
    alwaysOnTop: envFlag('WIDGET_ALWAYS_ON_TOP', true),
    pinWidget: envFlag('WIDGET_PINNED', false),
    autoRefreshTasks: envFlag('WIDGET_AUTO_REFRESH_TASKS', false),
    expandMode: 'hover',
    autoCollapse: true
  };
}

function isWidgetConfig(value: unknown): value is Partial<WidgetConfig> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    'tasks' in candidate ||
    'writing' in candidate ||
    'timeLog' in candidate ||
    'app' in candidate ||
    'version' in candidate
  );
}

function isLegacyTaskConfig(value: unknown): value is Partial<NotionSettings> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const keys = [
    'apiKey',
    'databaseId',
    'titleProperty',
    'statusProperty',
    'dateProperty'
  ];
  return keys.some((key) => key in candidate);
}

