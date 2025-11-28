import type {
  ActiveTimeLogEntry,
  AppPreferences,
  ChatbotExecutionResult,
  ChatbotResponse,
  ChatbotSettings,
  ChatSummary,
  Contact,
  ContactsSettings,
  CrossWindowDragState,
  CrossWindowDropPayload,
  DatabaseVerificationResult,
  DockEdge,
  DockState,
  FeatureToggles,
  FullVerificationResult,
  ImportJobStatus,
  ImportProgress,
  ImportQueueStatus,
  ImportType,
  NotionCreatePayload,
  NotionSettings,
  NotificationPreviewPayload,
  Project,
  ProjectsSettings,
  ResizeDirection,
  SavedView,
  SpeechTranscriptionRequest,
  SpeechTranscriptionResult,
  StatusDiagnostics,
  SyncStateSummary,
  Task,
  TaskAction,
  TaskOrderOption,
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
} from './types';

// Re-export for consumers
export type { ImportProgress };

export interface WidgetAPI {
  getTasks(): Promise<Task[]>;
  addTask(payload: NotionCreatePayload): Promise<Task>;
  updateTask(taskId: string, updates: TaskUpdatePayload): Promise<Task>;
  getStatusOptions(): Promise<TaskStatusOption[]>;
  getOrderOptions(): Promise<TaskOrderOption[]>;
  getSubtasks(parentTaskId: string): Promise<Task[]>;
  
  // Trash Management
  listTrashedTasks(): Promise<Task[]>;
  countTrashedTasks(): Promise<number>;
  restoreTaskFromTrash(taskId: string): Promise<Task | null>;
  permanentlyDeleteTask(taskId: string): Promise<boolean>;
  emptyTrash(): Promise<number>;
  cleanupOldTrashedTasks(daysOld?: number): Promise<number>;
  onTrashChanged(callback: () => void): () => void;
  
  openTaskWindow(taskId: string): Promise<void>;
  resizeWindow(
    direction: ResizeDirection,
    deltaX: number,
    deltaY: number
  ): Promise<void>;
  getSettings(): Promise<NotionSettings>;
  updateSettings(settings: NotionSettings): Promise<NotionSettings>;
  setAlwaysOnTop(flag: boolean): Promise<boolean>;
  getAlwaysOnTop(): Promise<boolean>;
  getWritingSettings(): Promise<WritingSettings>;
  createWritingEntry(payload: WritingEntryPayload): Promise<void>;
  getTimeLogSettings(): Promise<TimeLogSettings>;
  createTimeLogEntry(payload: TimeLogEntryPayload): Promise<TimeLogEntry>;
  getActiveTimeLogEntry(taskId: string): Promise<ActiveTimeLogEntry | null>;
  getTotalLoggedTime(taskId: string): Promise<number>;
  getTodayLoggedTime(taskId: string): Promise<number>;
  getAggregatedTimeData(taskId: string, subtaskIds?: string[]): Promise<{
    totalMinutes: number;
    todayMinutes: number;
    sessionCount: number;
    subtaskTotalMinutes: number;
  }>;
  getChatbotSettings(): Promise<ChatbotSettings>;
  updateChatbotSettings(settings: ChatbotSettings): Promise<ChatbotSettings>;
  transcribeSpeech(
    payload: SpeechTranscriptionRequest
  ): Promise<SpeechTranscriptionResult>;
  getAllTimeLogEntries(taskId: string): Promise<TimeLogEntry[]>;
  getAllTimeLogs(): Promise<TimeLogEntry[]>;
  updateTimeLogEntry(entryId: string, updates: TimeLogUpdatePayload): Promise<TimeLogEntry>;
  deleteTimeLogEntry(entryId: string): Promise<void>;
  getProjectsSettings(): Promise<ProjectsSettings>;
  getProjects(): Promise<Project[]>;
  refreshProjects(): Promise<Project[]>;
  getProjectStatusOptions(): Promise<TaskStatusOption[]>;
  fetchAndSaveProjectStatusOptions(): Promise<TaskStatusOption[]>;
  getContacts(): Promise<Contact[]>;
  refreshContacts(): Promise<Contact[]>;
  getAppPreferences(): Promise<AppPreferences>;
  updateAppPreferences(preferences: AppPreferences): Promise<AppPreferences>;
  setLaunchOnStartup(enabled: boolean): Promise<AppPreferences>;
  setDockEdge(edge: DockEdge): Promise<DockState | undefined>;
  requestExpand(): Promise<DockState | undefined>;
  requestCollapse(): Promise<DockState | undefined>;
  forceCollapse(): Promise<DockState | undefined>;
  setThinState(thin: boolean): Promise<void>;
  setCaptureState(capture: boolean): Promise<void>;
  onDockStateChange(callback: (state: DockState) => void): () => void;
  onTaskUpdated(callback: (task: Task) => void): () => void;
  onProjectsUpdated(callback: (projects: Project[]) => void): () => void;
  openWidgetSettingsWindow(): Promise<void>;
  openSettingsWindow(): Promise<void>;
  getDockState(): Promise<DockState | undefined>;
  closeWindow(): Promise<void>;
  openFullScreenWindow(): Promise<void>;
  closeFullScreenWindow(): Promise<void>;
  checkForUpdates(): Promise<{ status: UpdateStatus; info: UpdateInfo | null }>;
  downloadUpdate(): Promise<{ status: UpdateStatus; info: UpdateInfo | null }>;
  installUpdate(): Promise<void>;
  getUpdateStatus(): Promise<{ status: UpdateStatus; info: UpdateInfo | null }>;
  getStatusDiagnostics(): Promise<StatusDiagnostics>;
  getDetailedStatusDiagnostics(): Promise<{
    tasks: StatusDiagnostics['tasks'];
    projects: StatusDiagnostics['projects'];
    nullStatusSamples: Array<{
      id: string;
      title: string;
      status: string | undefined;
      normalizedStatus: string | undefined;
      url?: string;
    }>;
    validStatusSamples: Array<{
      id: string;
      title: string;
      status: string | undefined;
      normalizedStatus: string | undefined;
    }>;
  }>;
  
  // Database Verification API
  verifyTasksDatabase(): Promise<DatabaseVerificationResult>;
  verifyProjectsDatabase(): Promise<DatabaseVerificationResult>;
  verifyContactsDatabase(): Promise<DatabaseVerificationResult>;
  verifyTimeLogsDatabase(): Promise<DatabaseVerificationResult>;
  verifyWritingDatabase(): Promise<DatabaseVerificationResult>;
  verifyAllDatabases(): Promise<FullVerificationResult>;
  
  // Local Status Management
  getLocalTaskStatuses(): Promise<TaskStatusOption[]>;
  getLocalProjectStatuses(): Promise<TaskStatusOption[]>;
  createLocalTaskStatus(options: { 
    name: string; 
    color?: string; 
    sortOrder?: number; 
    isCompleted?: boolean 
  }): Promise<TaskStatusOption>;
  createLocalProjectStatus(options: { 
    name: string; 
    color?: string; 
    sortOrder?: number; 
    isCompleted?: boolean 
  }): Promise<TaskStatusOption>;
  updateLocalTaskStatus(id: string, updates: { 
    name?: string; 
    color?: string | null; 
    sortOrder?: number; 
    isCompleted?: boolean 
  }): Promise<void>;
  deleteLocalTaskStatus(id: string): Promise<void>;
  getCombinedStatuses(): Promise<TaskStatusOption[]>;
  mergeNotionStatuses(): Promise<{ 
    success: boolean; 
    taskStatuses?: TaskStatusOption[];
    projectStatuses?: TaskStatusOption[];
    error?: string;
  }>;
  
  // Local Project Management
  createLocalProject(payload: { 
    title: string; 
    status?: string | null; 
    description?: string | null; 
    startDate?: string | null; 
    endDate?: string | null; 
    tags?: string[] | null 
  }): Promise<Project & { syncStatus?: string; localOnly?: boolean }>;
  updateLocalProject(projectId: string, updates: Partial<{ 
    title: string; 
    status?: string | null; 
    description?: string | null; 
    startDate?: string | null; 
    endDate?: string | null; 
    tags?: string[] | null 
  }>): Promise<(Project & { syncStatus?: string; localOnly?: boolean }) | null>;
  deleteLocalProject(projectId: string): Promise<boolean>;
  getLocalProject(projectId: string): Promise<(Project & { syncStatus?: string; localOnly?: boolean }) | null>;
  
  onUpdateStatusChange(
    callback: (data: { status: UpdateStatus; info: UpdateInfo | null }) => void
  ): () => void;
  getAppVersion(): Promise<string>;
  getSyncStatus(): Promise<SyncStateSummary>;
  forceSync(): Promise<SyncStateSummary>;
  getSyncTimestamps(): Promise<{ tasks: string | null; projects: string | null; timeLogs: string | null }>;
  importTasks(): Promise<void>;
  importProjects(): Promise<{ success: boolean; count: number; error?: string }>;
  importTimeLogs(): Promise<{ success: boolean; count: number; error?: string }>;
  importContacts(): Promise<{ success: boolean; count: number; error?: string }>;
  importActiveTasksOnly(): Promise<{ success: boolean; count: number; error?: string }>;
  importActiveProjectsOnly(): Promise<{ success: boolean; count: number; error?: string }>;
  syncActiveTasksOnly(): Promise<{ success: boolean; count: number; links?: number; error?: string }>;
  syncActiveProjectsOnly(): Promise<{ success: boolean; count: number; links?: number; error?: string }>;
  testConnection(): Promise<{ success: boolean; message: string; latencyMs?: number }>;
  isInitialImportDone(): Promise<boolean>;
  
  // Fast Import API
  importAll(): Promise<{ 
    success: boolean; 
    projects?: number; 
    tasks?: number; 
    links?: number; 
    timeMs?: number;
    error?: string;
  }>;
  importSinceClose(): Promise<{ 
    success: boolean; 
    projects?: number; 
    tasks?: number; 
    links?: number; 
    timeMs?: number;
    error?: string;
  }>;
  
  // Setup API
  isFirstTimeSetup(): Promise<boolean>;
  markSetupComplete(mode: 'notion' | 'local'): Promise<{ success: boolean }>;
  getSetupMode(): Promise<'notion' | 'local' | null>;
  getDatabaseCounts(): Promise<{ projects: number; tasks: number; links: number }>;
  isDatabaseEmpty(): Promise<boolean>;
  
  // Import Queue Management
  getImportQueueStatus(): Promise<ImportQueueStatus>;
  cancelImport(type: ImportType): Promise<boolean>;
  cancelAllImports(): Promise<void>;
  getCurrentImport(): Promise<ImportType | null>;
  onImportQueueStatusChange(callback: (statuses: ImportJobStatus[]) => void): () => void;
  
  // Notion connection status
  isNotionConnected(): Promise<boolean>;
  getNotionConnectionStatus(): Promise<{
    connected: boolean;
    hasApiKey: boolean;
    hasDatabaseId: boolean;
    mode: 'synced' | 'local-only';
  }>;
  performInitialImport(): Promise<SyncStateSummary>;
  getImportProgress(): Promise<ImportProgress>;
  resetImport(): Promise<void>;
  onSyncStatusChange(callback: (status: SyncStateSummary) => void): () => void;
  onImportProgress(callback: (progress: ImportProgress) => void): () => void;
  
  // Cross-window drag-and-drop APIs
  startCrossWindowDrag(task: Task, sourceWindow: 'widget' | 'fullscreen'): Promise<void>;
  endCrossWindowDrag(): Promise<void>;
  getCrossWindowDragState(): Promise<CrossWindowDragState>;
  handleCrossWindowDrop(payload: CrossWindowDropPayload): Promise<Task | null>;
  onCrossWindowDragChange(callback: (state: CrossWindowDragState) => void): () => void;
  
  // Focus stack APIs
  getFocusStack(): Promise<string[]>;
  addToFocusStack(taskId: string): Promise<string[]>;
  removeFromFocusStack(taskId: string): Promise<string[]>;
  clearFocusStack(): Promise<void>;
  onFocusStackChange(callback: (taskIds: string[]) => void): () => void;
  
  // Saved views APIs
  getSavedViews(): Promise<SavedView[]>;
  saveView(view: Omit<SavedView, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<SavedView>;
  deleteView(viewId: string): Promise<void>;
  openViewWindow(view: SavedView): Promise<void>;
  
  // Calendar widget APIs
  openCalendarWindow(): Promise<void>;
  closeCalendarWindow(): Promise<void>;
  calendarExpand(): Promise<DockState | undefined>;
  calendarCollapse(): Promise<DockState | undefined>;
  calendarSetEdge(edge: DockEdge): Promise<DockState | undefined>;
  getCalendarDockState(): Promise<DockState | undefined>;
  
  // Chatbot AI Assistant APIs
  sendChatbotMessage(payload: {
    message: string;
    tasks: Task[];
    projects: Project[];
  }): Promise<ChatbotResponse>;
  executeChatbotActions(payload: {
    actions: TaskAction[];
  }): Promise<ChatbotExecutionResult>;
  getChatSummaries(limit?: number, offset?: number): Promise<ChatSummary[]>;
  getChatSummary(summaryId: string): Promise<ChatSummary | null>;
  deleteChatSummary(summaryId: string): Promise<boolean>;
  
  // Data Management APIs
  getDataCounts(): Promise<DataCounts>;
  performFullReset(): Promise<ResetResult>;
  performSoftReset(): Promise<ResetResult>;
  resetTasksOnly(): Promise<{ success: boolean; cleared: number; error?: string }>;
  resetProjectsOnly(): Promise<{ success: boolean; cleared: number; error?: string }>;
  resetTimeLogsOnly(): Promise<{ success: boolean; cleared: number; error?: string }>;
  performFullResetAndImport(): Promise<{
    resetSuccess: boolean;
    importSuccess: boolean;
    resetResult: ResetResult;
    syncStatus?: SyncStateSummary;
    error?: string;
  }>;
  onDataResetComplete(callback: (result: ResetResult) => void): () => void;
}

/** Data counts for display in Control Center */
export interface DataCounts {
  tasks: number;
  projects: number;
  timeLogs: number;
  writingEntries: number;
  chatSummaries: number;
  pendingSyncItems: number;
}

/** Result of a reset operation */
export interface ResetResult {
  success: boolean;
  clearedCounts: DataCounts;
  error?: string;
}

export interface SettingsAPI {
  getTaskSettings(): Promise<NotionSettings>;
  updateTaskSettings(settings: NotionSettings): Promise<NotionSettings>;
  getWritingSettings(): Promise<WritingSettings>;
  updateWritingSettings(settings: WritingSettings): Promise<WritingSettings>;
  getTimeLogSettings(): Promise<TimeLogSettings>;
  updateTimeLogSettings(settings: TimeLogSettings): Promise<TimeLogSettings>;
  getProjectsSettings(): Promise<ProjectsSettings>;
  updateProjectsSettings(settings: ProjectsSettings): Promise<ProjectsSettings>;
  getContactsSettings(): Promise<ContactsSettings>;
  updateContactsSettings(settings: ContactsSettings): Promise<ContactsSettings>;
  getAppPreferences(): Promise<AppPreferences>;
  updateAppPreferences(preferences: AppPreferences): Promise<AppPreferences>;
  setLaunchOnStartup(enabled: boolean): Promise<AppPreferences>;
  previewNotification(payload: NotificationPreviewPayload): Promise<void>;
  createWritingEntry(payload: WritingEntryPayload): Promise<void>;
  createTimeLogEntry(payload: TimeLogEntryPayload): Promise<TimeLogEntry>;
  
  // Feature toggles
  getFeatureToggles(): Promise<FeatureToggles>;
  updateFeatureToggles(toggles: FeatureToggles): Promise<FeatureToggles>;
}
