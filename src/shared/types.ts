export type DockEdge = 'left' | 'right' | 'top';

export interface DockState {
  edge: DockEdge;
  collapsed: boolean;
}

export interface Task {
  id: string;
  /** Notion's unique ID with prefix (e.g., "ACTION-123") */
  uniqueId?: string;
  title: string;
  status?: string;
  normalizedStatus?: string;
  body?: string | null;
  dueDate?: string;
  dueDateEnd?: string;
  url?: string;
  lastEdited?: string | null;
  hardDeadline?: boolean;
  urgent?: boolean;
  important?: boolean;
  mainEntry?: string;
  sessionLengthMinutes?: number | null;
  estimatedLengthMinutes?: number | null;
  orderValue?: string | null;
  orderColor?: string | null;
  projectIds?: string[] | null;
  syncStatus?: SyncStatus;
  localOnly?: boolean;
  // Recurring task fields
  recurrence?: string[];      // e.g., ['Monday', 'Wednesday', 'Friday']
  // Subtask fields
  parentTaskId?: string;      // For subtasks: ID of parent task
  subtaskIds?: string[];      // For parent tasks: IDs of child tasks
  subtaskProgress?: { completed: number; total: number };
  // Snooze fields (kept for compatibility)
  snoozedUntil?: string;      // ISO date when snooze expires
  // Reminder fields
  reminderAt?: string;        // ISO date for when to show notification
  // Time tracking enhancements
  trackingGoalMinutes?: number;
  doneTrackingAfterCycle?: boolean;
  autoFillEstimatedTime?: boolean;
  // Trash fields - for tasks deleted in Notion
  trashedAt?: string;         // ISO date when task was detected as deleted
}

export interface Contact {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  role?: string | null;
  notes?: string | null;
  projectIds?: string[] | null;
  url?: string | null;
}

export interface NotionCreatePayload {
  title: string;
  date?: string; // ISO date string
  dateEnd?: string | null;
  hardDeadline?: boolean;
  urgent?: boolean;
  important?: boolean;
  status?: string | null;
  mainEntry?: string | null;
  projectIds?: string[] | null;
  parentTaskId?: string; // For creating subtasks - ID of parent task
}

export interface TaskUpdatePayload {
  title?: string;
  status?: string | null;
  dueDate?: string | null;
  dueDateEnd?: string | null;
  hardDeadline?: boolean;
  urgent?: boolean;
  important?: boolean;
  mainEntry?: string | null;
  sessionLengthMinutes?: number | null;
  estimatedLengthMinutes?: number | null;
  orderValue?: string | null;
  projectIds?: string[] | null;
  // Recurring task fields
  recurrence?: string[] | null;
  // Snooze fields (local only, kept for compatibility)
  snoozedUntil?: string | null;
  // Reminder fields (local only)
  reminderAt?: string | null;
  // Time tracking enhancements (local only)
  trackingGoalMinutes?: number | null;
  doneTrackingAfterCycle?: boolean | null;
  autoFillEstimatedTime?: boolean | null;
}

export interface TaskStatusOption {
  id: string;
  name: string;
  color?: string;
}

export interface TaskOrderOption {
  id: string;
  name: string;
  color?: string;
}

export type ResizeDirection =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export interface NotionSettings {
  apiKey: string;
  databaseId: string;
  dataSourceId?: string;
  titleProperty: string;
  statusProperty: string;
  dateProperty: string;
  deadlineProperty: string;
  deadlineHardValue: string;
  deadlineSoftValue: string;
  statusPresets: string[];
  urgentProperty: string;
  urgentStatusActive: string;
  urgentStatusInactive: string;
  importantProperty: string;
  importantStatusActive: string;
  importantStatusInactive: string;
  completedStatus: string;
  mainEntryProperty?: string;
  sessionLengthProperty?: string;
  estimatedLengthProperty?: string;
  orderProperty?: string;
  projectRelationProperty?: string;
  // Recurring task property - Multi-select for weekdays
  recurrenceProperty?: string;
  // Subtask relation property - links subtasks to parent task
  parentTaskProperty?: string;
  // Sub-Actions relation property - links parent task to its subtasks (reverse of parentTaskProperty)
  subActionsProperty?: string;
  // Initial status to reset to after recurring completion
  initialStatus?: string;
  // Widget Link - Date property to track when task was last synced to widget
  // This is updated every time a task is pushed to Notion
  widgetLinkProperty?: string;
  /** Notion unique ID property (e.g., "ID" with prefix "ACTION") for deduplication */
  idProperty?: string;
}

export interface AppPreferences {
  launchOnStartup: boolean;
  enableNotifications: boolean;
  enableSounds: boolean;
  alwaysOnTop: boolean;
  pinWidget: boolean;
  autoRefreshTasks: boolean;
  expandMode: 'hover' | 'button';
  autoCollapse: boolean;
  preventMinimalDuringSession?: boolean;
  // Collapsible task columns - show on hover
  collapseTimeColumn?: boolean;    // Column 3: Estimate time, Start session
  collapseProjectColumn?: boolean; // Column 4: Add to project, Add subtasks
  autoExpandProjectRow?: boolean;  // When true, auto-expand project row if task has a project assigned
  // UI interaction sounds
  enableUISounds?: boolean;        // Enable click/hover/menu sounds
  // Webhook real-time sync
  webhookEnabled?: boolean;
  webhookUserId?: string;
  webhookUrl?: string;
}

export interface WebhookEvent {
  id: string;
  type: string;
  timestamp: string;
  data: {
    type?: string;
    entity?: {
      id: string;
      type: string;
    };
    [key: string]: unknown;
  };
}

export interface WritingSettings {
  apiKey?: string;
  databaseId: string;
  titleProperty: string;
  summaryProperty?: string;
  tagsProperty?: string;
  statusProperty?: string;
  publishedStatus?: string;
  draftStatus?: string;
  /** Notion unique ID property (e.g., "ID" with prefix "WRITE-LOG") for deduplication */
  idProperty?: string;
}

export type ChatbotProvider = 'openai' | 'anthropic';
export type SpeechInputMode = 'browser' | 'whisper' | 'transformers' | 'hybrid';
export type SummarySyncMode = 'local' | 'notion' | 'both';
export type SpeechTranscriptionProvider = 'browser' | 'openai';

export interface ChatbotSettings {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  preferredProvider: ChatbotProvider;
  speechInputMode: SpeechInputMode;
  summarySyncMode: SummarySyncMode;
  summaryDatabaseId?: string;
  summaryNotificationsEnabled: boolean;
  enableContinuousSummary: boolean;
  webSpeechLanguage?: string;
  whisperModel?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  actions?: TaskAction[];
  error?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ChatbotRequestPayload {
  prompt: string;
  speechSummary?: string;
  providerOverride?: ChatbotProvider;
  history?: ChatMessage[];
}

export type TaskAction =
  | {
      type: 'create_task';
      task: NotionCreatePayload;
      summary?: string;
    }
  | {
      type: 'update_status';
      taskId: string;
      status: string;
      summary?: string;
    }
  | {
      type: 'update_dates';
      taskId: string;
      dueDate?: string | null;
      dueDateEnd?: string | null;
      summary?: string;
    }
  | {
      type: 'add_notes';
      taskId: string;
      notes: string;
      summary?: string;
    }
  | {
      type: 'assign_projects';
      taskId: string;
      projectIds: string[];
      summary?: string;
    }
  | {
      type: 'log_time';
      taskId: string;
      minutes: number;
      note?: string;
      summary?: string;
    };

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  transcript: string;
  actions: TaskAction[];
  summaryText?: string;
  syncStatus: SyncStatus;
  notionPageId?: string;
}

export interface ChatbotResponse {
  success: boolean;
  message: string;
  actions?: TaskAction[];
  error?: string;
}

export interface TaskActionResult {
  action: TaskAction;
  success: boolean;
  message: string;
  taskId?: string;
  error?: string;
}

export interface ChatbotExecutionResult {
  success: boolean;
  results: TaskActionResult[];
  summary?: ChatSummary;
  error?: string;
}

export interface ChatbotResponsePayload {
  provider: ChatbotProvider;
  reply: string;
  actions: TaskAction[];
  notes?: string;
  raw?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface ChatbotActionExecutionResult {
  action: TaskAction;
  status: 'applied' | 'skipped' | 'failed';
  message: string;
  task?: Task;
  timeLogEntry?: TimeLogEntry;
}

export interface SpeechTranscriptSegment {
  text: string;
  start?: number;
  end?: number;
  confidence?: number;
}

export interface SpeechTranscriptionRequest {
  audioBase64: string;
  mimeType: string;
  language?: string;
  model?: string;
  prompt?: string;
  provider?: 'openai';
  apiKey?: string;
}

export interface SpeechTranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  provider: SpeechTranscriptionProvider;
  segments?: SpeechTranscriptSegment[];
}

export interface WritingEntryPayload {
  title: string;
  summary?: string;
  content: string;
  tags?: string[];
  status?: string;
  contentBlocks?: MarkdownBlock[];
}

export interface TimeLogSettings {
  apiKey?: string;
  databaseId: string;
  taskProperty?: string;
  statusProperty?: string;
  startTimeProperty?: string;
  endTimeProperty?: string;
  titleProperty?: string;
  startStatusValue?: string;  // Status option for active sessions (default: "Start")
  endStatusValue?: string;    // Status option for completed sessions (default: "End")
  /** Notion unique ID property (e.g., "ID" with prefix "TIME-LOG") for deduplication */
  idProperty?: string;
}

export interface TimeLogEntryPayload {
  taskId: string;
  taskTitle: string;
  status: string; // "Start" for active sessions, "End" for finished sessions
  startTime?: string; // ISO date string
  endTime?: string; // ISO date string (null when status is "start")
  sessionLengthMinutes?: number; // Used to calculate estimated end time
}

export interface ActiveTimeLogEntry {
  id: string;
  startTime?: string | null;
  endTime?: string | null;
  durationMinutes?: number | null;
}

export interface TimeLogEntry {
  id: string;
  /** Notion's unique ID with prefix (e.g., "TIME-LOG-123") */
  uniqueId?: string;
  startTime?: string | null;
  endTime?: string | null;
  durationMinutes?: number | null;
  title?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
  status?: string | null;
  syncStatus?: SyncStatus;
  localOnly?: boolean;
}

export interface TimeLogUpdatePayload {
  startTime?: string | null;
  endTime?: string | null;
  title?: string | null;
}

export interface NotificationPreviewPayload {
  title: string;
  body: string;
}

export interface ProjectsSettings {
  apiKey?: string;
  databaseId: string;
  titleProperty?: string;
  statusProperty?: string;
  descriptionProperty?: string;
  startDateProperty?: string;
  endDateProperty?: string;
  tagsProperty?: string;
  /** Relation property linking projects to tasks/actions */
  actionsRelationProperty?: string;
  /** Fallback status options when the database doesn't expose them */
  statusPresets?: string[];
  /** Status value that indicates a completed project */
  completedStatus?: string;
  /** Cached status options from last successful schema fetch (avoids repeated API calls) */
  cachedStatusOptions?: Array<{ id: string; name: string; color?: string }>;
  /** Notion unique ID property (e.g., "ID" with prefix "PRJ") for deduplication */
  idProperty?: string;
}

export interface ContactsSettings {
  apiKey?: string;
  databaseId: string;
  nameProperty?: string;
  emailProperty?: string;
  phoneProperty?: string;
  companyProperty?: string;
  roleProperty?: string;
  notesProperty?: string;
  projectsRelationProperty?: string;
}

export interface Project {
  id: string;
  /** Notion's unique ID with prefix (e.g., "PRJ-123") */
  uniqueId?: string;
  title?: string | null;
  status?: string | null;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  tags?: string[] | null;
  url?: string;
  emoji?: string | null;
  iconUrl?: string | null;
  lastEdited?: string | null;
}

export interface StatusCount {
  name: string;
  count: number;
}

export interface StatusBreakdown {
  total: number;
  withStatus: number;
  withoutStatus: number;
  unique: number;
  lastUpdated: string | null;
  statuses: StatusCount[];
}

export interface StatusDiagnostics {
  tasks: StatusBreakdown;
  projects: StatusBreakdown;
}

export type SyncStatus = 'pending' | 'synced' | 'conflict' | 'local' | 'trashed';

export interface SyncStateSummary {
  state: 'idle' | 'syncing' | 'error' | 'offline';
  pendingItems: number;
  lastSuccessfulSync?: string;
  message?: string;
}

/** Progress state for the initial Notion import */
export interface ImportProgress {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  tasksImported: number;
  pagesProcessed: number;
  currentPage: number;
  message?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

/** Import types that can be queued */
export type ImportType = 'tasks' | 'projects' | 'contacts' | 'timeLogs';

/** Status of an import job in the queue */
export interface ImportJobStatus {
  type: ImportType;
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'error';
  progress?: number;
  message?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/** Overall import queue status */
export interface ImportQueueStatus {
  currentImport: ImportType | null;
  allStatuses: ImportJobStatus[];
}

// ============================================================================
// DATABASE VERIFICATION TYPES
// Used to verify that configured property names exist in Notion databases
// ============================================================================

/** Result of verifying a single property */
export interface PropertyVerificationResult {
  propertyName: string;
  configuredValue: string;
  exists: boolean;
  actualType?: string;
  expectedType?: string;
  isRequired: boolean;
  suggestion?: string;
}

/** Result of verifying an entire database configuration */
export interface DatabaseVerificationResult {
  databaseId: string;
  databaseName?: string;
  connected: boolean;
  error?: string;
  properties: PropertyVerificationResult[];
  availableProperties: Array<{ name: string; type: string }>;
}

/** Overall verification result for all databases */
export interface FullVerificationResult {
  tasks?: DatabaseVerificationResult;
  projects?: DatabaseVerificationResult;
  contacts?: DatabaseVerificationResult;
  timeLogs?: DatabaseVerificationResult;
  writing?: DatabaseVerificationResult;
}

/** Database type for verification */
export type VerifiableDatabaseType = 'tasks' | 'projects' | 'contacts' | 'timeLogs' | 'writing';

/**
 * Feature toggles allow users to enable/disable specific features
 * This provides a simplified experience for users who don't need all functionality
 */
export interface FeatureToggles {
  // ═══════════════════════════════════════════════════════════════════════════
  // CORE MODULES - Enable/disable entire feature areas
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** Time tracking with session timers and time log database */
  enableTimeTracking: boolean;
  /** Eisenhower matrix (urgent/important) priority system */
  enableEisenhowerMatrix: boolean;
  /** Project management with relations and project views */
  enableProjects: boolean;
  /** Writing/journaling widget for long-form capture */
  enableWriting: boolean;
  /** Conversational chatbot assistant with AI integrations */
  enableChatbot: boolean;
  /** Recurring task support with weekday patterns */
  enableRecurrence: boolean;
  /** Task reminder notifications */
  enableReminders: boolean;
  /** Subtask/parent-child task relationships */
  enableSubtasks: boolean;
  /** Hard vs soft deadline distinction */
  enableDeadlineTypes: boolean;

  // ═══════════════════════════════════════════════════════════════════════════
  // TASK PROPERTIES - Show/hide individual task fields
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** Show notes/main entry field on tasks */
  showMainEntry: boolean;
  /** Show session length display on tasks */
  showSessionLength: boolean;
  /** Show time estimates on tasks */
  showEstimatedLength: boolean;
  /** Show priority order badges on tasks */
  showPriorityOrder: boolean;

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEWS - Enable/disable dashboard views
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** Standard task list view */
  showTaskListView: boolean;
  /** Eisenhower matrix quadrant view */
  showMatrixView: boolean;
  /** Status-based kanban board */
  showKanbanView: boolean;
  /** Calendar/scheduling view */
  showCalendarView: boolean;
  /** Gantt chart timeline view */
  showGanttView: boolean;
  /** Time log history view */
  showTimeLogView: boolean;

  // ═══════════════════════════════════════════════════════════════════════════
  // QUICK ADD - Configure task capture form
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** Show hard/soft deadline toggle in quick add */
  quickAddShowDeadlineToggle: boolean;
  /** Show Eisenhower matrix selector in quick add */
  quickAddShowMatrixPicker: boolean;
  /** Show project assignment in quick add */
  quickAddShowProjectPicker: boolean;
  /** Enable notes field expansion in quick add */
  quickAddShowNotes: boolean;
  /** Enable drag-to-place feature in quick add */
  quickAddShowDragToPlace: boolean;

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERFACE - UI preferences
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** Show status filter pills */
  showStatusFilters: boolean;
  /** Show matrix/priority filter */
  showMatrixFilters: boolean;
  /** Show today/week/all day filter */
  showDayFilters: boolean;
  /** Show task grouping controls */
  showGroupingControls: boolean;
  /** Show sorting controls */
  showSortControls: boolean;
  /** Show task search bar */
  showSearchBar: boolean;
  /** Use condensed/compact task rows */
  compactTaskRows: boolean;
}

export interface WidgetConfig {
  version: number;
  tasks: NotionSettings;
  writing: WritingSettings;
  timeLog: TimeLogSettings;
  projects: ProjectsSettings;
  contacts: ContactsSettings;
  app: AppPreferences;
  features: FeatureToggles;
  chatbot: ChatbotSettings;
  savedViews?: SavedView[];
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'ready'
  | 'error';

/**
 * Cross-window drag-and-drop types
 * Enables dragging tasks from widget to fullscreen window drop zones
 */
export type CrossWindowDropZoneType =
  | 'calendar'        // Drop on calendar day → assign due date
  | 'project'         // Drop on project → assign to project
  | 'status-filter'   // Drop on status filter → change status
  | 'focus-stack'     // Drop on focus area → add to focus stack
  | 'task-list';      // Drop on filtered list → apply list filters

export interface CrossWindowDragState {
  /** The task being dragged */
  task: Task | null;
  /** Source window identifier */
  sourceWindow: 'widget' | 'fullscreen' | null;
  /** Whether drag is currently active */
  isDragging: boolean;
}

export interface CrossWindowDropPayload {
  /** Type of drop zone */
  zoneType: CrossWindowDropZoneType;
  /** For calendar drops: the date string (YYYY-MM-DD) */
  date?: string;
  /** For project drops: the project ID */
  projectId?: string;
  /** For status drops: the target status */
  status?: string;
  /** For filter drops: multiple filters to apply */
  filters?: {
    status?: string;
    projectId?: string;
    urgent?: boolean;
    important?: boolean;
  };
}

export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
  downloadProgress?: number;
  error?: string;
}

/**
 * Saved view configuration
 * Captures filter, sort, and grouping settings that can be restored
 */
export interface SavedView {
  id: string;
  name: string;
  /** Emoji icon for the view tab */
  icon?: string;
  createdAt: string;
  updatedAt: string;
  /** Day filter setting */
  dayFilter: 'all' | 'today' | 'week';
  /** Matrix/priority filter */
  matrixFilter: 'all' | 'do-now' | 'deep-work' | 'delegate' | 'trash';
  /** Deadline type filter */
  deadlineFilter: 'all' | 'hard';
  /** Status filter */
  statusFilter: string;
  /** Sort rules */
  sortRules: Array<{
    id: string;
    property: 'dueDate' | 'priority' | 'status';
    direction: 'asc' | 'desc';
  }>;
  /** Grouping option */
  grouping: 'none' | 'dueDate' | 'priority' | 'status' | 'project';
  /** Active widget tab */
  activeWidget?: 'tasks' | 'writing' | 'timelog' | 'projects';
}

export interface MarkdownAnnotations {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
}

export interface MarkdownRichText {
  text: string;
  annotations?: MarkdownAnnotations;
  href?: string;
}

export type MarkdownBlock =
  | {
      type: 'paragraph';
      richText: MarkdownRichText[];
    }
  | {
      type: 'heading_1' | 'heading_2' | 'heading_3';
      richText: MarkdownRichText[];
    }
  | {
      type: 'bulleted_list_item' | 'numbered_list_item';
      richText: MarkdownRichText[];
    }
  | {
      type: 'to_do';
      richText: MarkdownRichText[];
      checked: boolean;
    }
  | {
      type: 'quote';
      richText: MarkdownRichText[];
    }
  | {
      type: 'code';
      richText: MarkdownRichText[];
      language?: string;
    }
  | {
      type: 'divider';
    }
  | {
      type: 'toggle';
      richText: MarkdownRichText[];
      children?: MarkdownBlock[];
    };
