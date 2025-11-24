import type {
  ActiveTimeLogEntry,
  TimeLogEntry,
  AppPreferences,
  DockEdge,
  DockState,
  NotionCreatePayload,
  NotionSettings,
  NotificationPreviewPayload,
  ResizeDirection,
  Task,
  TaskStatusOption,
  TaskUpdatePayload,
  TimeLogEntryPayload,
  TimeLogSettings,
  TimeLogUpdatePayload,
  UpdateInfo,
  UpdateStatus,
  WritingEntryPayload,
  WritingSettings
} from './types';

export interface WidgetAPI {
  getTasks(): Promise<Task[]>;
  addTask(payload: NotionCreatePayload): Promise<Task>;
  updateTask(taskId: string, updates: TaskUpdatePayload): Promise<Task>;
  getStatusOptions(): Promise<TaskStatusOption[]>;
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
  createTimeLogEntry(payload: TimeLogEntryPayload): Promise<void>;
  getActiveTimeLogEntry(taskId: string): Promise<ActiveTimeLogEntry | null>;
  getTotalLoggedTime(taskId: string): Promise<number>;
  getAllTimeLogEntries(taskId: string): Promise<TimeLogEntry[]>;
  getAllTimeLogs(): Promise<TimeLogEntry[]>;
  updateTimeLogEntry(entryId: string, updates: TimeLogUpdatePayload): Promise<TimeLogEntry>;
  deleteTimeLogEntry(entryId: string): Promise<void>;
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
  onUpdateStatusChange(
    callback: (data: { status: UpdateStatus; info: UpdateInfo | null }) => void
  ): () => void;
  getAppVersion(): Promise<string>;
}

export interface SettingsAPI {
  getTaskSettings(): Promise<NotionSettings>;
  updateTaskSettings(settings: NotionSettings): Promise<NotionSettings>;
  getWritingSettings(): Promise<WritingSettings>;
  updateWritingSettings(settings: WritingSettings): Promise<WritingSettings>;
  getTimeLogSettings(): Promise<TimeLogSettings>;
  updateTimeLogSettings(settings: TimeLogSettings): Promise<TimeLogSettings>;
  getAppPreferences(): Promise<AppPreferences>;
  updateAppPreferences(preferences: AppPreferences): Promise<AppPreferences>;
  setLaunchOnStartup(enabled: boolean): Promise<AppPreferences>;
  previewNotification(payload: NotificationPreviewPayload): Promise<void>;
  createWritingEntry(payload: WritingEntryPayload): Promise<void>;
  createTimeLogEntry(payload: TimeLogEntryPayload): Promise<void>;
}



