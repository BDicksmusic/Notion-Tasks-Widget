import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AppPreferences,
  ChatbotSettings,
  ContactsSettings,
  FeatureToggles,
  NotionSettings,
  ProjectsSettings,
  SavedView,
  TimeLogSettings,
  WidgetConfig,
  WritingSettings
} from '../shared/types';
import { extractDatabaseId } from '../shared/utils/notionUrl';

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

export function getProjectsSettings() {
  return config.projects;
}

export function getContactsSettings() {
  return config.contacts;
}

export function getChatbotSettings() {
  return config.chatbot;
}

export function getAppPreferences() {
  return config.app;
}

export function getFeatureToggles() {
  return config.features;
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

export async function updateProjectsSettings(
  next: ProjectsSettings
): Promise<ProjectsSettings> {
  config = {
    ...config,
    projects: normalizeProjectsSettings(next)
  };
  await persistConfig();
  return config.projects;
}

export async function updateContactsSettings(
  next: ContactsSettings
): Promise<ContactsSettings> {
  config = {
    ...config,
    contacts: normalizeContactsSettings(next)
  };
  await persistConfig();
  return config.contacts;
}

export async function updateChatbotSettings(
  next: ChatbotSettings
): Promise<ChatbotSettings> {
  config = {
    ...config,
    chatbot: normalizeChatbotSettings(next)
  };
  await persistConfig();
  return config.chatbot;
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

export async function updateFeatureToggles(
  next: FeatureToggles
): Promise<FeatureToggles> {
  config = {
    ...config,
    features: normalizeFeatureToggles(next)
  };
  await persistConfig();
  return config.features;
}

export function getSavedViews(): SavedView[] {
  return config.savedViews ?? [];
}

export async function saveView(
  view: Omit<SavedView, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<SavedView> {
  const now = new Date().toISOString();
  const existingViews = config.savedViews ?? [];
  
  let savedView: SavedView;
  if (view.id) {
    // Update existing view
    const existingIndex = existingViews.findIndex((v) => v.id === view.id);
    if (existingIndex >= 0) {
      savedView = {
        ...existingViews[existingIndex],
        ...view,
        id: view.id,
        updatedAt: now
      };
      existingViews[existingIndex] = savedView;
    } else {
      // ID provided but not found, create new
      savedView = {
        ...view,
        id: view.id,
        createdAt: now,
        updatedAt: now
      };
      existingViews.push(savedView);
    }
  } else {
    // Create new view
    savedView = {
      ...view,
      id: `view-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: now,
      updatedAt: now
    };
    existingViews.push(savedView);
  }
  
  config = {
    ...config,
    savedViews: existingViews
  };
  await persistConfig();
  return savedView;
}

export async function deleteView(viewId: string): Promise<void> {
  const existingViews = config.savedViews ?? [];
  config = {
    ...config,
    savedViews: existingViews.filter((v) => v.id !== viewId)
  };
  await persistConfig();
}

function createDefaultConfig(): WidgetConfig {
  return {
    version: CONFIG_VERSION,
    tasks: normalizeTaskSettings(loadTaskDefaults()),
    writing: normalizeWritingSettings(loadWritingDefaults()),
    timeLog: normalizeTimeLogSettings(loadTimeLogDefaults()),
    projects: normalizeProjectsSettings(loadProjectsDefaults()),
    contacts: normalizeContactsSettings(loadContactsDefaults()),
    chatbot: normalizeChatbotSettings(loadChatbotDefaults()),
    app: normalizeAppPreferences(loadAppDefaults()),
    features: normalizeFeatureToggles(loadFeatureDefaults())
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
      projects: normalizeProjectsSettings({
        ...defaults.projects,
        ...(next.projects ?? {})
      }),
      contacts: normalizeContactsSettings({
        ...defaults.contacts,
        ...(next.contacts ?? {})
      }),
      chatbot: normalizeChatbotSettings({
        ...defaults.chatbot,
        ...(next.chatbot ?? {})
      }),
      app: normalizeAppPreferences({
        ...defaults.app,
        ...(next.app ?? {})
      }),
      features: normalizeFeatureToggles({
        ...defaults.features,
        ...(next.features ?? {})
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
      writing: normalizeWritingSettings(defaults.writing),
      timeLog: normalizeTimeLogSettings(defaults.timeLog),
      projects: normalizeProjectsSettings(defaults.projects),
      contacts: normalizeContactsSettings(defaults.contacts),
      chatbot: normalizeChatbotSettings(defaults.chatbot),
      app: normalizeAppPreferences(defaults.app),
      features: normalizeFeatureToggles(defaults.features)
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
  // Extract database ID from URL if provided
  const databaseId = next.databaseId ? extractDatabaseId(next.databaseId) : '';
  
  const normalized: NotionSettings = {
    ...next,
    databaseId,
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

  if (normalized.orderProperty) {
    normalized.orderProperty = normalized.orderProperty.trim();
  }

  if (normalized.projectRelationProperty) {
    normalized.projectRelationProperty =
      normalized.projectRelationProperty.trim();
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

  // Extract database ID from URL if provided
  const databaseId = rest.databaseId ? extractDatabaseId(rest.databaseId) : '';
  
  return {
    ...rest,
    apiKey: rest.apiKey?.trim() || undefined,
    databaseId,
    titleProperty: rest.titleProperty?.trim() || 'Name',
    summaryProperty: rest.summaryProperty?.trim() || undefined,
    tagsProperty: rest.tagsProperty?.trim() || undefined,
    statusProperty: rest.statusProperty?.trim() || undefined,
    publishedStatus: rest.publishedStatus?.trim() || undefined,
    draftStatus: rest.draftStatus?.trim() || undefined
  };
}

function normalizeTimeLogSettings(next: TimeLogSettings): TimeLogSettings {
  // Extract database ID from URL if provided
  const databaseId = next.databaseId ? extractDatabaseId(next.databaseId) : '';
  
  return {
    ...next,
    apiKey: next.apiKey?.trim() || undefined,
    databaseId,
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
    ),
    orderProperty: envDefault('NOTION_TASK_ORDER_PROP', '').trim(),
    projectRelationProperty: envDefault(
      'NOTION_TASK_PROJECT_RELATION_PROP',
      ''
    ).trim()
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
    taskProperty: envDefault('NOTION_TIME_LOG_TASK_PROP', 'Task'),
    statusProperty: envDefault('NOTION_TIME_LOG_STATUS_PROP', 'Status'),
    startTimeProperty: envDefault('NOTION_TIME_LOG_START_TIME_PROP', 'Date'),
    endTimeProperty: process.env.NOTION_TIME_LOG_END_TIME_PROP,
    titleProperty: envDefault('NOTION_TIME_LOG_TITLE_PROP', 'Name'),
    startStatusValue: envDefault('NOTION_TIME_LOG_START_STATUS', 'Start'),
    endStatusValue: envDefault('NOTION_TIME_LOG_END_STATUS', 'End')
  };
}

function normalizeProjectsSettings(next: ProjectsSettings): ProjectsSettings {
  // Extract database ID from URL if provided
  const databaseId = next.databaseId ? extractDatabaseId(next.databaseId) : '';
  
  return {
    ...next,
    apiKey: next.apiKey?.trim() || undefined,
    databaseId,
    titleProperty: next.titleProperty?.trim() || 'Name',
    statusProperty: next.statusProperty?.trim() || 'Status', // Default to 'Status' if not set
    descriptionProperty: next.descriptionProperty?.trim() || undefined,
    startDateProperty: next.startDateProperty?.trim() || undefined,
    endDateProperty: next.endDateProperty?.trim() || undefined,
    tagsProperty: next.tagsProperty?.trim() || undefined,
    actionsRelationProperty: next.actionsRelationProperty?.trim() || undefined,
    statusPresets: Array.isArray(next.statusPresets)
      ? next.statusPresets.map((entry) => entry.trim()).filter(Boolean)
      : [],
    completedStatus: next.completedStatus?.trim() || 'Done',
    cachedStatusOptions: Array.isArray(next.cachedStatusOptions) 
      ? next.cachedStatusOptions 
      : undefined
  };
}

function loadProjectsDefaults(): ProjectsSettings {
  return {
    apiKey: process.env.NOTION_PROJECTS_API_KEY ?? process.env.NOTION_API_KEY,
    databaseId: envDefault('NOTION_PROJECTS_DATABASE_ID', 'e78e95ea6b7c456caa88b5b2a7cbd74f'),
    titleProperty: envDefault('NOTION_PROJECTS_TITLE_PROP', 'Name'),
    statusProperty: envDefault('NOTION_PROJECTS_STATUS_PROP', 'Status'), // Default to 'Status'
    descriptionProperty: process.env.NOTION_PROJECTS_DESCRIPTION_PROP,
    startDateProperty: process.env.NOTION_PROJECTS_START_DATE_PROP,
    endDateProperty: process.env.NOTION_PROJECTS_END_DATE_PROP,
    tagsProperty: process.env.NOTION_PROJECTS_TAGS_PROP,
    actionsRelationProperty: process.env.NOTION_PROJECTS_ACTIONS_PROP ?? 'Actions',
    statusPresets: parseList(envDefault('NOTION_PROJECTS_STATUS_PRESETS', 'Not started,In progress,Done')),
    completedStatus: envDefault('NOTION_PROJECTS_COMPLETED_STATUS', 'Done'),
    cachedStatusOptions: undefined
  };
}

function normalizeContactsSettings(next: ContactsSettings): ContactsSettings {
  const databaseId = next.databaseId ? extractDatabaseId(next.databaseId) : '';

  return {
    ...next,
    apiKey: next.apiKey?.trim() || undefined,
    databaseId,
    nameProperty: next.nameProperty?.trim() || 'Name',
    emailProperty: next.emailProperty?.trim() || 'Email',
    phoneProperty: next.phoneProperty?.trim() || 'Phone',
    companyProperty: next.companyProperty?.trim() || 'Company',
    roleProperty: next.roleProperty?.trim() || 'Role',
    notesProperty: next.notesProperty?.trim() || 'Notes',
    projectsRelationProperty:
      next.projectsRelationProperty?.trim() || 'Projects'
  };
}

function loadContactsDefaults(): ContactsSettings {
  return {
    apiKey: process.env.NOTION_CONTACTS_API_KEY ?? process.env.NOTION_API_KEY,
    databaseId: envDefault('NOTION_CONTACTS_DATABASE_ID', ''),
    nameProperty: envDefault('NOTION_CONTACTS_NAME_PROP', 'Name'),
    emailProperty: envDefault('NOTION_CONTACTS_EMAIL_PROP', 'Email'),
    phoneProperty: envDefault('NOTION_CONTACTS_PHONE_PROP', 'Phone'),
    companyProperty: envDefault('NOTION_CONTACTS_COMPANY_PROP', 'Company'),
    roleProperty: envDefault('NOTION_CONTACTS_ROLE_PROP', 'Role'),
    notesProperty: envDefault('NOTION_CONTACTS_NOTES_PROP', 'Notes'),
    projectsRelationProperty: envDefault(
      'NOTION_CONTACTS_PROJECTS_PROP',
      'Projects'
    )
  };
}

function normalizeChatbotSettings(next: ChatbotSettings): ChatbotSettings {
  const provider: ChatbotSettings['preferredProvider'] =
    next.preferredProvider === 'anthropic' ? 'anthropic' : 'openai';
  const speechInputMode: ChatbotSettings['speechInputMode'] =
    next.speechInputMode === 'whisper'
      ? 'whisper'
      : next.speechInputMode === 'hybrid'
        ? 'hybrid'
        : 'browser';
  const summarySyncMode: ChatbotSettings['summarySyncMode'] =
    next.summarySyncMode === 'notion'
      ? 'notion'
      : next.summarySyncMode === 'both'
        ? 'both'
        : 'local';

  return {
    openaiApiKey: next.openaiApiKey?.trim() || undefined,
    anthropicApiKey: next.anthropicApiKey?.trim() || undefined,
    preferredProvider: provider,
    speechInputMode,
    summarySyncMode,
    summaryDatabaseId: next.summaryDatabaseId?.trim() || undefined,
    summaryNotificationsEnabled:
      next.summaryNotificationsEnabled === undefined
        ? true
        : Boolean(next.summaryNotificationsEnabled),
    enableContinuousSummary:
      next.enableContinuousSummary === undefined
        ? true
        : Boolean(next.enableContinuousSummary),
    webSpeechLanguage: next.webSpeechLanguage?.trim() || 'en-US',
    whisperModel: next.whisperModel?.trim() || 'whisper-1'
  };
}

function loadChatbotDefaults(): ChatbotSettings {
  const preferredProvider =
    process.env.CHATBOT_PROVIDER?.toLowerCase() === 'anthropic'
      ? 'anthropic'
      : 'openai';
  const speechModeEnv = process.env.CHATBOT_SPEECH_MODE?.toLowerCase();
  const summarySyncEnv = process.env.CHATBOT_SUMMARY_SYNC_MODE?.toLowerCase();

  return {
    openaiApiKey:
      process.env.CHATBOT_OPENAI_API_KEY ??
      process.env.OPENAI_API_KEY ??
      undefined,
    anthropicApiKey:
      process.env.CHATBOT_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? undefined,
    preferredProvider,
    speechInputMode:
      speechModeEnv === 'whisper'
        ? 'whisper'
        : speechModeEnv === 'hybrid'
          ? 'hybrid'
          : 'browser',
    summarySyncMode:
      summarySyncEnv === 'both'
        ? 'both'
        : summarySyncEnv === 'notion'
          ? 'notion'
          : 'local',
    summaryDatabaseId: process.env.CHATBOT_SUMMARY_DATABASE_ID ?? undefined,
    summaryNotificationsEnabled: envFlag('CHATBOT_SUMMARY_NOTIFICATIONS', true),
    enableContinuousSummary: envFlag('CHATBOT_CONTINUOUS_SUMMARY', true),
    webSpeechLanguage: process.env.CHATBOT_SPEECH_LANGUAGE ?? 'en-US',
    whisperModel: process.env.CHATBOT_WHISPER_MODEL ?? 'whisper-1'
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

function loadFeatureDefaults(): FeatureToggles {
  return {
    // Core modules - all enabled by default for full experience
    enableTimeTracking: true,
    enableEisenhowerMatrix: true,
    enableProjects: true,
    enableWriting: true,
    enableChatbot: true,
    enableRecurrence: true,
    enableReminders: true,
    enableSubtasks: true,
    enableDeadlineTypes: true,

    // Task properties - all shown by default
    showMainEntry: true,
    showSessionLength: true,
    showEstimatedLength: true,
    showPriorityOrder: true,

    // Views - all enabled by default
    showTaskListView: true,
    showMatrixView: true,
    showKanbanView: true,
    showCalendarView: true,
    showGanttView: true,
    showTimeLogView: true,

    // Quick add options - all shown by default
    quickAddShowDeadlineToggle: true,
    quickAddShowMatrixPicker: true,
    quickAddShowProjectPicker: true,
    quickAddShowNotes: true,
    quickAddShowDragToPlace: true,

    // Interface options - all shown by default
    showStatusFilters: true,
    showMatrixFilters: true,
    showDayFilters: true,
    showGroupingControls: true,
    showSortControls: true,
    showSearchBar: true,
    compactTaskRows: false
  };
}

function normalizeFeatureToggles(next: Partial<FeatureToggles>): FeatureToggles {
  const defaults = loadFeatureDefaults();
  return {
    // Core modules
    enableTimeTracking: next.enableTimeTracking ?? defaults.enableTimeTracking,
    enableEisenhowerMatrix: next.enableEisenhowerMatrix ?? defaults.enableEisenhowerMatrix,
    enableProjects: next.enableProjects ?? defaults.enableProjects,
    enableWriting: next.enableWriting ?? defaults.enableWriting,
    enableChatbot: next.enableChatbot ?? defaults.enableChatbot,
    enableRecurrence: next.enableRecurrence ?? defaults.enableRecurrence,
    enableReminders: next.enableReminders ?? defaults.enableReminders,
    enableSubtasks: next.enableSubtasks ?? defaults.enableSubtasks,
    enableDeadlineTypes: next.enableDeadlineTypes ?? defaults.enableDeadlineTypes,

    // Task properties
    showMainEntry: next.showMainEntry ?? defaults.showMainEntry,
    showSessionLength: next.showSessionLength ?? defaults.showSessionLength,
    showEstimatedLength: next.showEstimatedLength ?? defaults.showEstimatedLength,
    showPriorityOrder: next.showPriorityOrder ?? defaults.showPriorityOrder,

    // Views
    showTaskListView: next.showTaskListView ?? defaults.showTaskListView,
    showMatrixView: next.showMatrixView ?? defaults.showMatrixView,
    showKanbanView: next.showKanbanView ?? defaults.showKanbanView,
    showCalendarView: next.showCalendarView ?? defaults.showCalendarView,
    showGanttView: next.showGanttView ?? defaults.showGanttView,
    showTimeLogView: next.showTimeLogView ?? defaults.showTimeLogView,

    // Quick add
    quickAddShowDeadlineToggle: next.quickAddShowDeadlineToggle ?? defaults.quickAddShowDeadlineToggle,
    quickAddShowMatrixPicker: next.quickAddShowMatrixPicker ?? defaults.quickAddShowMatrixPicker,
    quickAddShowProjectPicker: next.quickAddShowProjectPicker ?? defaults.quickAddShowProjectPicker,
    quickAddShowNotes: next.quickAddShowNotes ?? defaults.quickAddShowNotes,
    quickAddShowDragToPlace: next.quickAddShowDragToPlace ?? defaults.quickAddShowDragToPlace,

    // Interface
    showStatusFilters: next.showStatusFilters ?? defaults.showStatusFilters,
    showMatrixFilters: next.showMatrixFilters ?? defaults.showMatrixFilters,
    showDayFilters: next.showDayFilters ?? defaults.showDayFilters,
    showGroupingControls: next.showGroupingControls ?? defaults.showGroupingControls,
    showSortControls: next.showSortControls ?? defaults.showSortControls,
    showSearchBar: next.showSearchBar ?? defaults.showSearchBar,
    compactTaskRows: next.compactTaskRows ?? defaults.compactTaskRows
  };
}

function isWidgetConfig(value: unknown): value is Partial<WidgetConfig> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    'tasks' in candidate ||
    'writing' in candidate ||
    'timeLog' in candidate ||
    'projects' in candidate ||
    'app' in candidate ||
    'features' in candidate ||
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

