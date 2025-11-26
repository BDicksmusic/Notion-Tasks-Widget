import { BrowserNotionClient } from '@common/notion/browserClient';
import type { SettingsAPI, WidgetAPI } from '@shared/ipc';
import type {
  AppPreferences,
  ChatbotSettings,
  Contact,
  ContactsSettings,
  CrossWindowDragState,
  CrossWindowDropPayload,
  DockState,
  NotionCreatePayload,
  NotionSettings,
  Project,
  ProjectsSettings,
  ResizeDirection,
  SavedView,
  StatusDiagnostics,
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
import { localTaskStorage } from './localTaskStorage';

const notionClient = new BrowserNotionClient();
const DEFAULT_CHATBOT_SETTINGS: ChatbotSettings = {
  openaiApiKey: undefined,
  anthropicApiKey: undefined,
  preferredProvider: 'openai',
  speechInputMode: 'browser',
  summarySyncMode: 'local',
  summaryNotificationsEnabled: true,
  enableContinuousSummary: true,
  webSpeechLanguage: 'en-US',
  whisperModel: 'whisper-1'
};
const dockListeners = new Set<(state: DockState) => void>();
const taskListeners = new Set<(task: Task) => void>();

let cachedTaskSettings: NotionSettings | null = null;
let cachedWritingSettings: WritingSettings | null = null;
let cachedTimeLogSettings: TimeLogSettings | null = null;
let cachedPreferences: AppPreferences | null = null;
let cachedDockState: DockState | null = null;

// Helper to check if Notion is properly configured
function isNotionConfigured(settings: NotionSettings | null): boolean {
  return Boolean(settings?.apiKey?.trim() && settings?.databaseId?.trim());
}

const widgetAPI: WidgetAPI = {
  async getTasks() {
    // LOCAL-FIRST: Always return local tasks
    const localTasks = await localTaskStorage.getTasks();
    
    // If Notion is configured, try to merge in Notion tasks
    const settings = await ensureTaskSettings();
    if (isNotionConfigured(settings)) {
      try {
        const notionTasks = await notionClient.getTasks();
        // Merge Notion tasks with local tasks
        await localTaskStorage.mergeNotionTasks(notionTasks);
        // Return the merged set
        return localTaskStorage.getTasks();
      } catch (err) {
        console.warn('[Mobile] Notion fetch failed, using local tasks only:', err);
      }
    }
    
    return localTasks;
  },
  async addTask(payload: NotionCreatePayload) {
    // LOCAL-FIRST: Always create locally first
    const task = await localTaskStorage.createTask(payload);
    emitTaskUpdated(task);
    
    // If Notion is configured, try to sync in background
    const settings = await ensureTaskSettings();
    if (isNotionConfigured(settings)) {
      // Fire-and-forget sync to Notion
      notionClient.addTask(payload).then((notionTask) => {
        // Update local task with Notion ID
        localTaskStorage.markTaskSynced(task.id, notionTask.id).catch(console.error);
        emitTaskUpdated(notionTask);
      }).catch((err) => {
        console.warn('[Mobile] Notion sync failed for new task:', err);
        // Task remains local-only, which is fine
      });
    }
    
    return task;
  },
  async updateTask(taskId: string, updates: TaskUpdatePayload) {
    // LOCAL-FIRST: Always update locally first
    const updated = await localTaskStorage.updateTask(taskId, updates);
    emitTaskUpdated(updated);
    
    // If Notion is configured and task is synced, update in Notion too
    const settings = await ensureTaskSettings();
    if (isNotionConfigured(settings) && !taskId.startsWith('local-')) {
      // Fire-and-forget sync to Notion
      notionClient.updateTask(taskId, updates).then((notionTask) => {
        emitTaskUpdated(notionTask);
      }).catch((err) => {
        console.warn('[Mobile] Notion sync failed for task update:', err);
        // Local update already happened, so user data is safe
      });
    }
    
    return updated;
  },
  async getStatusOptions() {
    // LOCAL-FIRST: Return local status options
    const localStatuses = await localTaskStorage.getStatusOptions();
    
    // If Notion is configured, try to get Notion statuses
    const settings = await ensureTaskSettings();
    if (isNotionConfigured(settings)) {
      try {
        const notionStatuses = await notionClient.getStatusOptions();
        if (notionStatuses.length > 0) {
          return notionStatuses;
        }
      } catch (err) {
        console.warn('[Mobile] Failed to get Notion status options:', err);
      }
    }
    
    return localStatuses;
  },
  async getOrderOptions() {
    const settings = await ensureTaskSettings();
    // Return empty options if not configured
    if (!isNotionConfigured(settings)) {
      return [];
    }
    return notionClient.getOrderOptions();
  },
  async getSubtasks(_parentTaskId: string): Promise<Task[]> {
    // For mobile, subtasks not yet implemented
    return [];
  },
  
  // Trash Management - mobile stubs
  async listTrashedTasks(): Promise<Task[]> {
    // No trash management on mobile yet
    return [];
  },
  async countTrashedTasks(): Promise<number> {
    return 0;
  },
  async restoreTaskFromTrash(_taskId: string): Promise<Task | null> {
    return null;
  },
  async permanentlyDeleteTask(_taskId: string): Promise<boolean> {
    return false;
  },
  async emptyTrash(): Promise<number> {
    return 0;
  },
  async cleanupOldTrashedTasks(_daysOld?: number): Promise<number> {
    return 0;
  },
  onTrashChanged(_callback: () => void): () => void {
    return () => {};
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
    return notionClient.createTimeLogEntry(payload);
  },
  async getActiveTimeLogEntry(taskId: string) {
    await ensureTimeLogSettings();
    return notionClient.getActiveTimeLogEntry(taskId);
  },
  async getTotalLoggedTime(taskId: string) {
    await ensureTimeLogSettings();
    return notionClient.getTotalLoggedTime(taskId);
  },
  async getTodayLoggedTime(taskId: string): Promise<number> {
    await ensureTimeLogSettings();
    // For mobile, today's logged time not yet implemented
    return 0;
  },
  async getAggregatedTimeData(_taskId: string, _subtaskIds?: string[]): Promise<{
    totalMinutes: number;
    todayMinutes: number;
    sessionCount: number;
    subtaskTotalMinutes: number;
  }> {
    await ensureTimeLogSettings();
    // For mobile, aggregated time data not yet implemented
    return {
      totalMinutes: 0,
      todayMinutes: 0,
      sessionCount: 0,
      subtaskTotalMinutes: 0
    };
  },
  async transcribeSpeech() {
    throw new Error('Speech transcription is not available on mobile yet.');
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
    // For mobile, time log entry updates not yet implemented
    console.info('[mobile] updateTimeLogEntry not supported on mobile yet');
    // Return a placeholder
    return {
      id: entryId,
      startTime: updates.startTime || null,
      endTime: updates.endTime || null,
      durationMinutes: null,
      title: null
    };
  },
  async deleteTimeLogEntry(entryId: string): Promise<void> {
    await ensureTimeLogSettings();
    // For mobile, time log entry deletion not yet implemented
    console.info('[mobile] deleteTimeLogEntry not supported on mobile yet');
    // No-op
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
  onProjectsUpdated(_callback: (projects: Project[]) => void) {
    // Projects syncing is not implemented on mobile yet
    return () => {};
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
  },
  async getProjectsSettings(): Promise<ProjectsSettings> {
    // For mobile, return default projects settings
    return {
      databaseId: '',
      titleProperty: 'Name',
      statusProperty: 'Status',
      actionsRelationProperty: ''
    };
  },
  async getProjects() {
    // For mobile, projects not yet implemented
    return [];
  },
  async refreshProjects() {
    // For mobile, projects not yet implemented
    return [];
  },
  async getProjectStatusOptions(): Promise<TaskStatusOption[]> {
    // For mobile, project status options not yet implemented
    return [];
  },
  async fetchAndSaveProjectStatusOptions(): Promise<TaskStatusOption[]> {
    // For mobile, project status options not yet implemented
    return [];
  },
  async getContacts(): Promise<Contact[]> {
    console.info('[mobile] getContacts not implemented for mobile');
    return [];
  },
  async refreshContacts(): Promise<Contact[]> {
    return widgetAPI.getContacts();
  },
  async getSyncStatus() {
    return { state: 'idle' as const, pendingItems: 0 };
  },
  async forceSync() {
    return { state: 'idle' as const, pendingItems: 0 };
  },
  async getSyncTimestamps() {
    return { tasks: null, projects: null, timeLogs: null };
  },
  async getStatusDiagnostics(): Promise<StatusDiagnostics> {
    const empty = {
      total: 0,
      withStatus: 0,
      withoutStatus: 0,
      unique: 0,
      lastUpdated: null,
      statuses: []
    };
    return { tasks: empty, projects: empty };
  },
  async getDetailedStatusDiagnostics() {
    const empty = {
      total: 0,
      withStatus: 0,
      withoutStatus: 0,
      unique: 0,
      lastUpdated: null,
      statuses: []
    };
    return { 
      tasks: empty, 
      projects: empty,
      nullStatusSamples: [],
      validStatusSamples: []
    };
  },
  
  // LOCAL STATUS MANAGEMENT (mobile stubs)
  async getLocalTaskStatuses(): Promise<TaskStatusOption[]> {
    // Mobile doesn't have local storage for statuses, return empty
    return [];
  },
  async getLocalProjectStatuses(): Promise<TaskStatusOption[]> {
    return [];
  },
  async createLocalTaskStatus(options: { name: string; color?: string; sortOrder?: number; isCompleted?: boolean }): Promise<TaskStatusOption> {
    // Mobile doesn't support local status management yet - return a placeholder
    console.info('[mobile] createLocalTaskStatus not supported on mobile');
    return { id: `local-${Date.now()}`, name: options.name, color: options.color || 'default' };
  },
  async createLocalProjectStatus(options: { name: string; color?: string; sortOrder?: number; isCompleted?: boolean }): Promise<TaskStatusOption> {
    console.info('[mobile] createLocalProjectStatus not supported on mobile');
    return { id: `local-${Date.now()}`, name: options.name, color: options.color || 'default' };
  },
  async updateLocalTaskStatus(id: string, updates: { name?: string; color?: string | null; sortOrder?: number; isCompleted?: boolean }): Promise<void> {
    console.info('[mobile] updateLocalTaskStatus not supported on mobile');
    // No-op on mobile
  },
  async deleteLocalTaskStatus(id: string): Promise<void> {
    console.info('[mobile] deleteLocalTaskStatus not supported on mobile');
    // No-op on mobile
  },
  async getCombinedStatuses(): Promise<TaskStatusOption[]> {
    // On mobile, just get from Notion directly if configured
    const settings = await ensureTaskSettings();
    if (!isNotionConfigured(settings)) {
      return [];
    }
    return notionClient.getStatusOptions();
  },
  async mergeNotionStatuses() {
    return { success: false, error: 'Not implemented for mobile' };
  },
  
  // LOCAL PROJECT MANAGEMENT (mobile stubs)
  async createLocalProject(payload: { title: string; status?: string | null; description?: string | null; startDate?: string | null; endDate?: string | null; tags?: string[] | null }) {
    console.info('[mobile] createLocalProject not supported on mobile');
    // Return a placeholder project
    return {
      id: `local-${Date.now()}`,
      title: payload.title,
      status: payload.status || null,
      description: payload.description || null,
      startDate: payload.startDate || null,
      endDate: payload.endDate || null,
      tags: payload.tags || [],
      taskCount: 0,
      taskIds: []
    };
  },
  async updateLocalProject(projectId: string, updates: Partial<{ title: string; status?: string | null; description?: string | null; startDate?: string | null; endDate?: string | null; tags?: string[] | null }>) {
    console.info('[mobile] updateLocalProject not supported on mobile');
    return null; // Return null to indicate no update (mobile doesn't support this)
  },
  async deleteLocalProject(projectId: string) {
    console.info('[mobile] deleteLocalProject not supported on mobile');
    return false; // Return false to indicate deletion not supported
  },
  async getLocalProject(projectId: string) {
    return null; // Mobile doesn't have local project storage
  },
  
  async importProjects() {
    return { success: false, count: 0, error: 'Not implemented for mobile' };
  },
  async importTimeLogs() {
    return { success: false, count: 0, error: 'Not implemented for mobile' };
  },
  async testConnection() {
    // Mobile uses direct API calls, no separate connection test needed
    return { success: true, message: 'Mobile mode - direct API', latencyMs: 0 };
  },
  async isInitialImportDone() {
    // Mobile doesn't have a local database, always "done"
    return true;
  },
  async isNotionConnected() {
    // Mobile always has Notion configured (it's required for mobile)
    return true;
  },
  async getNotionConnectionStatus() {
    return {
      connected: true,
      hasApiKey: true,
      hasDatabaseId: true,
      mode: 'synced' as const
    };
  },
  async performInitialImport() {
    // Mobile doesn't need initial import
    return { state: 'idle' as const, pendingItems: 0 };
  },
  async getImportProgress() {
    // Mobile doesn't have import progress
    return {
      status: 'completed' as const,
      tasksImported: 0,
      pagesProcessed: 0,
      currentPage: 0
    };
  },
  async resetImport() {
    // No-op on mobile
  },
  onSyncStatusChange() {
    return () => {};
  },
  onImportProgress() {
    return () => {};
  },
  
  // Cross-window drag-and-drop APIs (no-op on mobile)
  async startCrossWindowDrag(_task: Task, _sourceWindow: 'widget' | 'fullscreen') {
    // No-op on mobile - no multi-window support
  },
  async endCrossWindowDrag() {
    // No-op on mobile
  },
  async getCrossWindowDragState(): Promise<CrossWindowDragState> {
    return { isDragging: false, task: null, sourceWindow: null };
  },
  async handleCrossWindowDrop(_payload: CrossWindowDropPayload): Promise<Task | null> {
    // No-op on mobile
    return null;
  },
  onCrossWindowDragChange(_callback: (state: CrossWindowDragState) => void) {
    // No-op on mobile
    return () => {};
  },
  
  // Focus stack APIs (no-op on mobile for now)
  async getFocusStack(): Promise<string[]> {
    return [];
  },
  async addToFocusStack(_taskId: string): Promise<string[]> {
    return [];
  },
  async removeFromFocusStack(_taskId: string): Promise<string[]> {
    return [];
  },
  async clearFocusStack(): Promise<void> {
    // No-op on mobile
  },
  onFocusStackChange(_callback: (taskIds: string[]) => void) {
    return () => {};
  },
  
  // Saved views APIs (basic mobile implementation using localStorage)
  async getSavedViews(): Promise<SavedView[]> {
    try {
      const stored = localStorage.getItem('widget.savedViews');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  },
  async saveView(view: Omit<SavedView, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<SavedView> {
    const views = await widgetAPI.getSavedViews();
    const now = new Date().toISOString();
    
    let savedView: SavedView;
    if (view.id) {
      const existingIndex = views.findIndex((v) => v.id === view.id);
      if (existingIndex >= 0) {
        savedView = { ...views[existingIndex], ...view, id: view.id, updatedAt: now };
        views[existingIndex] = savedView;
      } else {
        savedView = { ...view, id: view.id, createdAt: now, updatedAt: now } as SavedView;
        views.push(savedView);
      }
    } else {
      savedView = {
        ...view,
        id: `view-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        createdAt: now,
        updatedAt: now
      } as SavedView;
      views.push(savedView);
    }
    
    localStorage.setItem('widget.savedViews', JSON.stringify(views));
    return savedView;
  },
  async deleteView(viewId: string): Promise<void> {
    const views = await widgetAPI.getSavedViews();
    const filtered = views.filter((v) => v.id !== viewId);
    localStorage.setItem('widget.savedViews', JSON.stringify(filtered));
  },
  async openViewWindow(_view: SavedView): Promise<void> {
    // No multi-window support on mobile
    console.info('[mobile] openViewWindow not supported on mobile');
  },
  
  // Calendar widget APIs (no-op on mobile - no multi-window support)
  async openCalendarWindow(): Promise<void> {
    console.info('[mobile] openCalendarWindow not supported on mobile');
  },
  async closeCalendarWindow(): Promise<void> {
    // No-op on mobile
  },
  async calendarExpand(): Promise<DockState | undefined> {
    // No-op on mobile
    return undefined;
  },
  async calendarCollapse(): Promise<DockState | undefined> {
    // No-op on mobile
    return undefined;
  },
  async calendarSetEdge(_edge: import('@shared/types').DockEdge): Promise<DockState | undefined> {
    // No-op on mobile
    return undefined;
  },
  async getCalendarDockState(): Promise<DockState | undefined> {
    // No-op on mobile
    return undefined;
  },
  
  // Chatbot AI assistant APIs - not available on mobile yet
  async getChatbotSettings(): Promise<import('@shared/types').ChatbotSettings> {
    return {
      preferredProvider: 'openai',
      speechInputMode: 'browser',
      summarySyncMode: 'local',
      summaryNotificationsEnabled: false,
      enableContinuousSummary: false
    };
  },
  async updateChatbotSettings(settings: import('@shared/types').ChatbotSettings): Promise<import('@shared/types').ChatbotSettings> {
    console.info('[mobile] updateChatbotSettings - not supported on mobile');
    return settings;
  },
  async sendChatbotMessage(_payload: {
    message: string;
    tasks: import('@shared/types').Task[];
    projects: import('@shared/types').Project[];
  }): Promise<import('@shared/types').ChatbotResponse> {
    console.info('[mobile] sendChatbotMessage - not supported on mobile');
    return {
      success: false,
      message: 'Chatbot not available on mobile',
      error: 'Chatbot feature is not yet supported on mobile devices'
    };
  },
  async executeChatbotActions(_payload: {
    actions: import('@shared/types').TaskAction[];
  }): Promise<import('@shared/types').ChatbotExecutionResult> {
    console.info('[mobile] executeChatbotActions - not supported on mobile');
    return {
      success: false,
      results: [],
      error: 'Chatbot feature is not yet supported on mobile devices'
    };
  },
  async getChatSummaries(_limit?: number, _offset?: number): Promise<import('@shared/types').ChatSummary[]> {
    console.info('[mobile] getChatSummaries - not supported on mobile');
    return [];
  },
  async getChatSummary(_summaryId: string): Promise<import('@shared/types').ChatSummary | null> {
    console.info('[mobile] getChatSummary - not supported on mobile');
    return null;
  },
  async deleteChatSummary(_summaryId: string): Promise<boolean> {
    console.info('[mobile] deleteChatSummary - not supported on mobile');
    return false;
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
  },
  async getProjectsSettings(): Promise<ProjectsSettings> {
    // For mobile, return default projects settings
    return {
      databaseId: '',
      titleProperty: 'Name',
      statusProperty: 'Status',
      actionsRelationProperty: ''
    };
  },
  async updateProjectsSettings(settings: ProjectsSettings): Promise<ProjectsSettings> {
    // For mobile, projects settings not yet persisted
    console.info('[mobile] updateProjectsSettings - not persisted on mobile');
    return settings;
  },
  async getContactsSettings(): Promise<ContactsSettings> {
    // For mobile, return default contacts settings
    return {
      databaseId: '',
      nameProperty: 'Name'
    };
  },
  async updateContactsSettings(settings: ContactsSettings): Promise<ContactsSettings> {
    // For mobile, contacts settings not yet persisted
    console.info('[mobile] updateContactsSettings - not persisted on mobile');
    return settings;
  },
  async getFeatureToggles(): Promise<import('@shared/types').FeatureToggles> {
    // Return all features enabled on mobile for now
    return {
      enableTimeTracking: true,
      enableEisenhowerMatrix: true,
      enableProjects: true,
      enableWriting: true,
      enableChatbot: true,
      enableRecurrence: true,
      enableReminders: true,
      enableSubtasks: true,
      enableDeadlineTypes: true,
      showMainEntry: true,
      showSessionLength: true,
      showEstimatedLength: true,
      showPriorityOrder: true,
      showTaskListView: true,
      showMatrixView: true,
      showKanbanView: true,
      showCalendarView: true,
      showGanttView: true,
      showTimeLogView: true,
      quickAddShowDeadlineToggle: true,
      quickAddShowMatrixPicker: true,
      quickAddShowProjectPicker: true,
      quickAddShowNotes: true,
      quickAddShowDragToPlace: true,
      showStatusFilters: true,
      showMatrixFilters: true,
      showDayFilters: true,
      showGroupingControls: true,
      showSortControls: true,
      showSearchBar: true,
      compactTaskRows: false
    };
  },
  async updateFeatureToggles(toggles: import('@shared/types').FeatureToggles): Promise<import('@shared/types').FeatureToggles> {
    // For mobile, feature toggles not yet persisted - just return what was passed
    console.info('[mobile] updateFeatureToggles - not persisted on mobile');
    return toggles;
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

