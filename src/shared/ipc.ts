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
  DockEdge,
  DockState,
  FeatureToggles,
  ImportProgress,
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
  
  // ============================================================================
  // LOCAL STATUS MANAGEMENT (LOCAL-FIRST)
  // These allow managing statuses independently of Notion
  // ============================================================================
  /** Get locally-defined task statuses */
  getLocalTaskStatuses(): Promise<TaskStatusOption[]>;
  /** Get locally-defined project statuses */
  getLocalProjectStatuses(): Promise<TaskStatusOption[]>;
  /** Create a new local task status */
  createLocalTaskStatus(options: { 
    name: string; 
    color?: string; 
    sortOrder?: number; 
    isCompleted?: boolean 
  }): Promise<TaskStatusOption>;
  /** Create a new local project status */
  createLocalProjectStatus(options: { 
    name: string; 
    color?: string; 
    sortOrder?: number; 
    isCompleted?: boolean 
  }): Promise<TaskStatusOption>;
  /** Update a local task status */
  updateLocalTaskStatus(id: string, updates: { 
    name?: string; 
    color?: string | null; 
    sortOrder?: number; 
    isCompleted?: boolean 
  }): Promise<void>;
  /** Delete a local task status */
  deleteLocalTaskStatus(id: string): Promise<void>;
  /** Get combined statuses (local + Notion merged) */
  getCombinedStatuses(): Promise<TaskStatusOption[]>;
  /** Merge Notion statuses into local statuses */
  mergeNotionStatuses(): Promise<{ 
    success: boolean; 
    taskStatuses?: TaskStatusOption[];
    projectStatuses?: TaskStatusOption[];
    error?: string;
  }>;
  
  // ============================================================================
  // LOCAL PROJECT MANAGEMENT (LOCAL-FIRST)
  // Create and manage projects locally, sync to Notion later
  // ============================================================================
  /** Create a new local project */
  createLocalProject(payload: { 
    title: string; 
    status?: string | null; 
    description?: string | null; 
    startDate?: string | null; 
    endDate?: string | null; 
    tags?: string[] | null 
  }): Promise<Project & { syncStatus?: string; localOnly?: boolean }>;
  /** Update a local project */
  updateLocalProject(projectId: string, updates: Partial<{ 
    title: string; 
    status?: string | null; 
    description?: string | null; 
    startDate?: string | null; 
    endDate?: string | null; 
    tags?: string[] | null 
  }>): Promise<(Project & { syncStatus?: string; localOnly?: boolean }) | null>;
  /** Delete a local project */
  deleteLocalProject(projectId: string): Promise<boolean>;
  /** Get a single local project by ID */
  getLocalProject(projectId: string): Promise<(Project & { syncStatus?: string; localOnly?: boolean }) | null>;
  
  onUpdateStatusChange(
    callback: (data: { status: UpdateStatus; info: UpdateInfo | null }) => void
  ): () => void;
  getAppVersion(): Promise<string>;
  getSyncStatus(): Promise<SyncStateSummary>;
  forceSync(): Promise<SyncStateSummary>;
  getSyncTimestamps(): Promise<{ tasks: string | null; projects: string | null; timeLogs: string | null }>;
  importProjects(): Promise<{ success: boolean; count: number; error?: string }>;
  importTimeLogs(): Promise<{ success: boolean; count: number; error?: string }>;
  testConnection(): Promise<{ success: boolean; message: string; latencyMs?: number }>;
  isInitialImportDone(): Promise<boolean>;
  
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
  /** Start a cross-window drag operation with the given task */
  startCrossWindowDrag(task: Task, sourceWindow: 'widget' | 'fullscreen'): Promise<void>;
  /** End the current cross-window drag operation */
  endCrossWindowDrag(): Promise<void>;
  /** Get the current cross-window drag state */
  getCrossWindowDragState(): Promise<CrossWindowDragState>;
  /** Handle a drop on a target zone */
  handleCrossWindowDrop(payload: CrossWindowDropPayload): Promise<Task | null>;
  /** Listen for cross-window drag state changes */
  onCrossWindowDragChange(callback: (state: CrossWindowDragState) => void): () => void;
  
  // Focus stack APIs (allows multiple tasks in focus mode)
  /** Get the current focus stack task IDs */
  getFocusStack(): Promise<string[]>;
  /** Add a task to the focus stack */
  addToFocusStack(taskId: string): Promise<string[]>;
  /** Remove a task from the focus stack */
  removeFromFocusStack(taskId: string): Promise<string[]>;
  /** Clear the entire focus stack */
  clearFocusStack(): Promise<void>;
  /** Listen for focus stack changes */
  onFocusStackChange(callback: (taskIds: string[]) => void): () => void;
  
  // Saved views APIs
  /** Get all saved views */
  getSavedViews(): Promise<SavedView[]>;
  /** Save a new view or update existing */
  saveView(view: Omit<SavedView, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<SavedView>;
  /** Delete a saved view */
  deleteView(viewId: string): Promise<void>;
  /** Open a new widget window with a specific view */
  openViewWindow(view: SavedView): Promise<void>;
  
  // Calendar widget APIs
  /** Open the calendar widget window */
  openCalendarWindow(): Promise<void>;
  /** Close the calendar widget window */
  closeCalendarWindow(): Promise<void>;
  /** Expand the calendar widget from collapsed state */
  calendarExpand(): Promise<DockState | undefined>;
  /** Collapse the calendar widget */
  calendarCollapse(): Promise<DockState | undefined>;
  /** Set the calendar widget dock edge */
  calendarSetEdge(edge: DockEdge): Promise<DockState | undefined>;
  /** Get the calendar widget dock state */
  getCalendarDockState(): Promise<DockState | undefined>;
  
  // ============================================================================
  // CHATBOT AI ASSISTANT APIs
  // Voice/text based task management assistant
  // ============================================================================
  /** Get chatbot settings */
  getChatbotSettings(): Promise<ChatbotSettings>;
  /** Update chatbot settings */
  updateChatbotSettings(settings: ChatbotSettings): Promise<ChatbotSettings>;
  /** Send a message to the chatbot and get task actions */
  sendChatbotMessage(payload: {
    message: string;
    tasks: Task[];
    projects: Project[];
  }): Promise<ChatbotResponse>;
  /** Execute the proposed task actions */
  executeChatbotActions(payload: {
    actions: TaskAction[];
  }): Promise<ChatbotExecutionResult>;
  /** Get chat summary history */
  getChatSummaries(limit?: number, offset?: number): Promise<ChatSummary[]>;
  /** Get a specific chat summary */
  getChatSummary(summaryId: string): Promise<ChatSummary | null>;
  /** Delete a chat summary */
  deleteChatSummary(summaryId: string): Promise<boolean>;
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



