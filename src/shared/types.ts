export type DockEdge = 'left' | 'right' | 'top';

export interface DockState {
  edge: DockEdge;
  collapsed: boolean;
}

export interface Task {
  id: string;
  title: string;
  status?: string;
  normalizedStatus?: string;
  dueDate?: string;
  dueDateEnd?: string;
  url?: string;
  hardDeadline?: boolean;
  urgent?: boolean;
  important?: boolean;
  mainEntry?: string;
  sessionLengthMinutes?: number | null;
  estimatedLengthMinutes?: number | null;
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
}

export interface TaskStatusOption {
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
}

export interface TimeLogEntryPayload {
  taskId: string;
  taskTitle: string;
  status: string; // "start" for active sessions, "completed" (or similar) for finished sessions
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
  startTime?: string | null;
  endTime?: string | null;
  durationMinutes?: number | null;
  title?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
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

export interface WidgetConfig {
  version: number;
  tasks: NotionSettings;
  writing: WritingSettings;
  timeLog: TimeLogSettings;
  app: AppPreferences;
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'ready'
  | 'error';

export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
  downloadProgress?: number;
  error?: string;
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
