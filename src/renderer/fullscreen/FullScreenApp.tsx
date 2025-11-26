import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type {
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent
} from 'react';
import type {
  AppPreferences,
  Contact,
  CrossWindowDragState,
  CrossWindowDropPayload,
  Task,
  TaskStatusOption,
  TaskUpdatePayload,
  NotionCreatePayload,
  NotionSettings,
  TimeLogEntryPayload,
  TimeLogSettings,
  WritingEntryPayload,
  WritingSettings,
  Project
} from '@shared/types';
import TaskList from '../components/TaskList';
import QuickAdd from '../components/QuickAdd';
import WritingWidget from '../components/WritingWidget';
import SearchInput from '../components/SearchInput';
import ImportQueueMenu from '../components/ImportQueueMenu';
import EisenhowerMatrix from './views/EisenhowerMatrix';
import KanbanBoard from './views/KanbanBoard';
import TaskTimeLogView from './views/TaskTimeLogView';
import WritingLogView from './views/WritingLogView';
import ProjectList from './views/ProjectList';
import ProjectKanban from './views/ProjectKanban';
import ProjectTimeline from './views/ProjectTimeline';
import ProjectHealth from './views/ProjectHealth';
import {
  FilterIcon,
  SortIcon,
  GroupButton,
  GroupPanel,
  OrganizerIconButton,
  SortButton,
  SortPanel
} from '../components/TaskOrganizerControls';
import { matrixOptions } from '../constants/matrix';
import {
  STATUS_FILTERS,
  type StatusFilterValue,
  mapStatusToFilterValue
} from '@shared/statusFilters';
import { platformBridge } from '@shared/platform';
import {
  type SortRule,
  type GroupingOption,
  sortTasks,
  groupTasks,
  serializeSortRules,
  deserializeSortRules,
  isGroupingOption
} from '../utils/sorting';
import { useCountdownTimer } from '../utils/useCountdownTimer';

const SORT_HOLD_DURATION = 7000;
const SORT_RULES_STORAGE_KEY = 'widget.sort.rules';
const GROUPING_STORAGE_KEY = 'widget.group.option';
const FILTER_PANEL_STORAGE_KEY = 'widget.filters.visible';
const SEARCH_QUERY_STORAGE_KEY = 'widget.search.query';
const FULLSCREEN_VIEW_MODE_KEY = 'fullscreen.viewMode';

// Helper function to search task text
const taskMatchesSearch = (task: Task, query: string): boolean => {
  if (!query.trim()) return true;
  const lowerQuery = query.toLowerCase().trim();
  const searchFields = [
    task.title,
    task.status,
    task.mainEntry,
    task.normalizedStatus
  ].filter(Boolean);
  return searchFields.some((field) =>
    field!.toLowerCase().includes(lowerQuery)
  );
};
const SPLIT_SIDEBAR_WIDTH_STORAGE_KEY = 'fullscreen.split.sidebarWidth';
const CALENDAR_SIDEBAR_WIDTH_STORAGE_KEY = 'fullscreen.calendar.sidebarWidth';
const CALENDAR_LAYOUT_STORAGE_KEY = 'fullscreen.calendar.layout';
const CALENDAR_SIDEBAR_POSITION_STORAGE_KEY =
  'fullscreen.calendar.sidebarPosition';
const DEFAULT_SPLIT_SIDEBAR_WIDTH = 280;
const DEFAULT_CALENDAR_SIDEBAR_WIDTH = 320;
const SPLIT_SIDEBAR_MIN = 200;
const SPLIT_SIDEBAR_MAX = 900;
const CALENDAR_SIDEBAR_MIN = 200;
const CALENDAR_SIDEBAR_MAX = 800;
type OrganizerPanel = 'filters' | 'sort' | 'group' | null;
type FullscreenViewMode = 'tasks' | 'projects' | 'calendar' | 'writing';
type TaskPanel = 'list' | 'matrix' | 'kanban' | 'calendar';
type ProjectSubView = 'list' | 'matrix' | 'kanban' | 'calendar' | 'gantt';

// Navigation sidebar configuration
const NAV_ITEMS: { id: FullscreenViewMode; icon: string; label: string; description: string }[] = [
  { id: 'tasks', icon: '☰', label: 'Tasks', description: 'Task dashboard with multiple views' },
  { id: 'projects', icon: '📁', label: 'Projects', description: 'Project management and planning' },
  { id: 'calendar', icon: '📅', label: 'Calendar', description: 'Calendar view with scheduling' },
  { id: 'writing', icon: '✏️', label: 'Writing', description: 'Writing logs and entries' }
];
const NAV_SIDEBAR_STORAGE_KEY = 'fullscreen.navSidebar.collapsed';
const HEADER_COLLAPSED_STORAGE_KEY = 'fullscreen.header.collapsed';
type CalendarSidebarPosition = 'left' | 'right';
type CalendarLayoutMode = 'tasks-main' | 'calendar-main';
type CalendarViewRange = 'day' | 'week' | 'list' | 'custom' | 'month';
type CalendarContentType = 'tasks' | 'timelogs' | 'both';
const CALENDAR_CUSTOM_DAYS_KEY = 'fullscreen.calendar.customDays';
const CALENDAR_LIST_DAYS_KEY = 'fullscreen.calendar.listDays';
const CALENDAR_LIST_COLUMNS_KEY = 'fullscreen.calendar.listColumns';
const PANEL_CALENDAR_VIEW_KEY = 'fullscreen.panelCalendar.view';
const PANEL_CALENDAR_DAYS_KEY = 'fullscreen.panelCalendar.days';
type PanelCalendarView = 'month' | 'week' | 'custom';
const TASK_PANELS_KEY = 'fullscreen.tasks.panels.v2';
const TASK_PANEL_ORDER_KEY = 'fullscreen.tasks.panelOrder.v2';
const ALL_TASK_PANELS: TaskPanel[] = ['list', 'matrix', 'kanban', 'calendar'];
const DEFAULT_PANEL_WIDTHS: Record<TaskPanel, number> = {
  list: 25,
  matrix: 25,
  kanban: 25,
  calendar: 25
};
const isTaskPanel = (value: unknown): value is TaskPanel =>
  typeof value === 'string' && ALL_TASK_PANELS.includes(value as TaskPanel);
const PANEL_CONFIG: Record<TaskPanel, { icon: string; label: string; description: string; color: string }> = {
  list: { icon: '☰', label: 'List', description: 'Task list with filters and sorting', color: '#3b82f6' },
  matrix: { icon: '⊞', label: 'Matrix', description: 'Eisenhower priority matrix', color: '#8b5cf6' },
  kanban: { icon: '▥', label: 'Kanban', description: 'Status-based workflow board', color: '#22c55e' },
  calendar: { icon: '📅', label: 'Calendar', description: 'Simple calendar view', color: '#f59e0b' }
};

// Project Panel Configuration
type ProjectPanel = 'list' | 'health' | 'kanban' | 'timeline';
const PROJECT_PANELS_KEY = 'fullscreen.projects.panels.v1';
const PROJECT_PANEL_ORDER_KEY = 'fullscreen.projects.panelOrder.v1';
const WORKSPACE_PANELS_KEY = 'fullscreen.project.workspace.panels.v1';
const WORKSPACE_PANEL_ORDER_KEY = 'fullscreen.project.workspace.panelOrder.v1';
const WORKSPACE_PANEL_WIDTHS_KEY = 'fullscreen.project.workspace.panelWidths.v1';
const ALL_PROJECT_PANELS: ProjectPanel[] = ['list', 'health', 'kanban', 'timeline'];
const PROJECT_PANEL_CONFIG: Record<ProjectPanel, { icon: string; label: string; description: string; color: string }> = {
  list: { icon: '☰', label: 'List', description: 'Projects with expandable task details', color: '#3b82f6' },
  health: { icon: '📊', label: 'Health', description: 'Project health and risk matrix', color: '#8b5cf6' },
  kanban: { icon: '▥', label: 'Kanban', description: 'Projects by status on board', color: '#22c55e' },
  timeline: { icon: '📅', label: 'Timeline', description: 'Project timeline and Gantt view', color: '#f59e0b' }
};
const PROJECT_SUB_VIEW_KEY = 'fullscreen.project.subView';
const CALENDAR_VIEW_RANGE_KEY = 'fullscreen.calendar.viewRange';
const CALENDAR_CONTENT_TYPE_KEY = 'fullscreen.calendar.contentType';
const WORKSPACE_CONTACTS_VISIBLE_KEY = 'fullscreen.workspace.contacts.visible';
type ResizeTarget =
  | {
      type: 'split' | 'calendar';
      startX: number;
      startWidth: number;
      orientation: CalendarSidebarPosition;
    }
  | null;

type MatrixFilterValue = 'all' | 'do-now' | 'deep-work' | 'delegate' | 'trash';
const describeMatrixFilters = (urgent?: boolean, important?: boolean) => {
  if (urgent === undefined && important === undefined) {
    return 'Show all priorities';
  }
  const urgentText = urgent ? 'Urgent ✓' : 'Urgent ✗';
  const importantText = important ? 'Important ✓' : 'Important ✗';
  return `${urgentText} • ${importantText}`;
};

const MATRIX_FILTER_BUTTONS = [
  ...matrixOptions.map((option) => ({
    id: option.id as MatrixFilterValue,
    label: option.label,
    description: describeMatrixFilters(option.urgent, option.important)
  })),
  { id: 'all' as MatrixFilterValue, label: 'All', description: describeMatrixFilters() }
];

const statusFilterShowAll = STATUS_FILTERS.find(
  (option) => option.value === 'all'
);
const STATUS_FILTER_BUTTONS = [
  ...STATUS_FILTERS.filter(
    (option) => option.value !== 'all' && option.value !== 'done'
  ),
  ...(statusFilterShowAll ? [statusFilterShowAll] : [])
];

// Access widgetAPI through platformBridge to get dynamically updated value after ensureMobileBridge()
const getWidgetAPI = () => platformBridge.widgetAPI;
const canUseWindowControls = platformBridge.hasWindowControls;

const toFilterSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const mergeTasksWithHold = (
  previous: Task[],
  next: Task[],
  holdMap: Record<string, number>
) => {
  if (!previous.length) return next;
  const now = Date.now();
  const activeIds = new Set(
    Object.entries(holdMap)
      .filter(([, expiry]) => expiry > now)
      .map(([id]) => id)
  );
  if (!activeIds.size) return next;
  const nextLookup = new Map(next.map((task) => [task.id, task]));
  const final: Task[] = [];
  previous.forEach((task) => {
    if (activeIds.has(task.id) && nextLookup.has(task.id)) {
      final.push(nextLookup.get(task.id)!);
      nextLookup.delete(task.id);
      activeIds.delete(task.id);
    }
  });
  next.forEach((task) => {
    if (!final.some((entry) => entry.id === task.id)) {
      final.push(task);
    }
  });
  return final;
};

const pruneHoldMap = (
  holdMap: Record<string, number>,
  tasks: Task[]
): Record<string, number> => {
  const now = Date.now();
  const validIds = new Set(tasks.map((task) => task.id));
  let changed = false;
  const next = { ...holdMap };
  Object.entries(next).forEach(([id, expiry]) => {
    if (expiry <= now || !validIds.has(id)) {
      delete next[id];
      changed = true;
    }
  });
  return changed ? next : holdMap;
};

const getTodayKey = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

const extractDateKey = (value?: string | null) => {
  if (!value) return null;
  return value.slice(0, 10);
};

const toMidnightTimestamp = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const clampWidth = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const readStoredWidth = (
  key: string,
  fallback: number,
  min: number,
  max: number
) => {
  if (typeof window === 'undefined') return fallback;
  const stored = window.localStorage?.getItem(key);
  if (!stored) return fallback;
  const parsed = Number.parseFloat(stored);
  return Number.isFinite(parsed)
    ? clampWidth(parsed, min, max)
    : fallback;
};

const toLocalMiddayIso = (dateStr: string) => {
  const parts = dateStr.split('-').map((segment) => Number(segment));
  if (parts.length !== 3 || parts.some((segment) => Number.isNaN(segment))) {
    return null;
  }
  const [year, month, day] = parts;
  const result = new Date(year, month - 1, day, 12, 0, 0, 0);
  return result.toISOString();
};

const FullScreenApp = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appPreferences, setAppPreferences] = useState<AppPreferences | null>(
    null
  );
  const [notionSettings, setNotionSettings] = useState<NotionSettings | null>(
    null
  );
  const [writingSettings, setWritingSettings] = useState<WritingSettings | null>(
    null
  );
  const [timeLogSettings, setTimeLogSettings] = useState<TimeLogSettings | null>(
    null
  );
  const [dayFilter, setDayFilter] = useState<'all' | 'today' | 'week'>(() => {
    if (typeof window === 'undefined') return 'today';
    const stored =
      window.localStorage?.getItem('widget.dayFilter') ??
      window.localStorage?.getItem('widget.taskFilter');
    if (stored === 'all' || stored === 'today' || stored === 'week') {
      return stored;
    }
    return 'today';
  });
  const [matrixFilter, setMatrixFilter] = useState<MatrixFilterValue>(() => {
    if (typeof window === 'undefined') return 'all';
    const stored = window.localStorage?.getItem('widget.filter.matrix');
    return ['all', 'do-now', 'deep-work', 'delegate', 'trash'].includes(
      stored ?? ''
    )
      ? (stored as MatrixFilterValue)
      : 'all';
  });
  const [deadlineFilter, setDeadlineFilter] = useState<'all' | 'hard'>(() => {
    if (typeof window === 'undefined') return 'all';
    const stored = window.localStorage?.getItem('widget.filter.deadline');
    return stored === 'hard' ? 'hard' : 'all';
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>(() => {
    if (typeof window === 'undefined') return 'all';
    const stored = window.localStorage?.getItem('widget.filter.status');
    return STATUS_FILTERS.some((option) => option.value === stored)
      ? (stored as StatusFilterValue)
      : 'all';
  });
  const [sortRules, setSortRules] = useState<SortRule[]>(() => {
    if (typeof window === 'undefined') return deserializeSortRules();
    const stored = window.localStorage?.getItem(SORT_RULES_STORAGE_KEY);
    if (!stored) return deserializeSortRules();
    try {
      const parsed = JSON.parse(stored);
      return deserializeSortRules(parsed);
    } catch {
      return deserializeSortRules();
    }
  });
  const [grouping, setGrouping] = useState<GroupingOption>(() => {
    if (typeof window === 'undefined') return 'none';
    const stored = window.localStorage?.getItem(GROUPING_STORAGE_KEY);
    return isGroupingOption(stored) ? stored : 'none';
  });
  const [statusOptions, setStatusOptions] = useState<TaskStatusOption[]>([]);
  const [projectStatusOptions, setProjectStatusOptions] = useState<TaskStatusOption[]>([]);
  const [activeWidget, setActiveWidget] = useState<'tasks' | 'writing'>(() => {
    if (typeof window === 'undefined') return 'tasks';
    const stored = window.localStorage?.getItem('widget.activeView');
    return stored === 'writing' ? 'writing' : 'tasks';
  });
  const [activeOrganizerPanel, setActiveOrganizerPanel] =
    useState<OrganizerPanel>(() => {
      if (typeof window === 'undefined') return 'filters';
      const stored = window.localStorage?.getItem(FILTER_PANEL_STORAGE_KEY);
      if (stored === 'filters' || stored === 'sort' || stored === 'group') {
        return stored as OrganizerPanel;
      }
      if (stored === 'none' || stored === 'false') {
        return null;
      }
      if (stored === 'true') {
        return 'filters';
      }
      return 'filters';
    });
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage?.getItem(SEARCH_QUERY_STORAGE_KEY) ?? '';
    });
  const [sortHold, setSortHold] = useState<Record<string, number>>({});
  const [displayTasks, setDisplayTasks] = useState<Task[]>([]);
  const [quickAddCollapsed, setQuickAddCollapsed] = useState(false);
  const [workspaceQuickAddCollapsed, setWorkspaceQuickAddCollapsed] =
    useState(false);
  const [notesPanelOpen, setNotesPanelOpen] = useState(false);
  const [workspaceNotesCollapsed, setWorkspaceNotesCollapsed] = useState(true);
  const [workspaceLinksCollapsed, setWorkspaceLinksCollapsed] = useState(true);
  const [workspaceShowCompleted, setWorkspaceShowCompleted] = useState(false);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsRefreshing, setContactsRefreshing] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [contactsPanelVisible, setContactsPanelVisible] = useState<boolean>(
    () => {
      if (typeof window === 'undefined') return true;
      return (
        window.localStorage?.getItem(WORKSPACE_CONTACTS_VISIBLE_KEY) !== 'false'
      );
    }
  );
  const isFocusMode = Boolean(focusTaskId);
  const manualStatuses = notionSettings?.statusPresets ?? [];
  const completedStatus = notionSettings?.completedStatus;
  const taskListScrollRef = useRef<HTMLDivElement>(null);
  const dragTaskRef = useRef<Task | null>(null);
  
  // Fullscreen-specific state
  const [viewMode, setViewMode] = useState<FullscreenViewMode>(() => {
    if (typeof window === 'undefined') return 'tasks';
    const stored = window.localStorage?.getItem(FULLSCREEN_VIEW_MODE_KEY);
    // Map old view modes to new structure
    if (stored === 'split' || stored === 'matrix' || stored === 'timelogs') {
      return 'tasks';
    }
    const validModes: FullscreenViewMode[] = ['tasks', 'projects', 'calendar', 'writing'];
    if (validModes.includes(stored as FullscreenViewMode)) {
      return stored as FullscreenViewMode;
    }
    return 'tasks';
  });
  const [projectSidebarOpen, setProjectSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage?.getItem('fullscreen.projectSidebar.open');
    return stored !== 'false';
  });
  const [navSidebarCollapsed, setNavSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage?.getItem(NAV_SIDEBAR_STORAGE_KEY);
    return stored === 'true';
  });
  const [headerCollapsed, setHeaderCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage?.getItem(HEADER_COLLAPSED_STORAGE_KEY);
    return stored === 'true';
  });
  const [draggedPanel, setDraggedPanel] = useState<TaskPanel | null>(null);
  const [projectSidebarWidth, setProjectSidebarWidth] = useState(() =>
    readStoredWidth(
      'fullscreen.projectSidebar.width',
      240,
      160,
      400
    )
  );
  // Multi-panel dashboard state - which panels are visible
  const [activePanels, setActivePanels] = useState<TaskPanel[]>(() => {
    if (typeof window === 'undefined') return ['list'];
    const stored = window.localStorage?.getItem(TASK_PANELS_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.every(p => ALL_TASK_PANELS.includes(p))) {
          return parsed.length > 0 ? parsed : ['list'];
        }
      } catch {}
    }
    // Migrate from old single sub-view
    const oldSubView = window.localStorage?.getItem('fullscreen.tasks.subView');
    if (oldSubView && ALL_TASK_PANELS.includes(oldSubView as TaskPanel)) {
      return [oldSubView as TaskPanel];
    }
    return ['list'];
  });
  
  // Project panels state - which project panels are visible
  const [activeProjectPanels, setActiveProjectPanels] = useState<ProjectPanel[]>(() => {
    if (typeof window === 'undefined') return ['list'];
    const stored = window.localStorage?.getItem(PROJECT_PANELS_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.every(p => ALL_PROJECT_PANELS.includes(p))) {
          return parsed.length > 0 ? parsed : ['list'];
        }
      } catch {}
    }
    return ['list'];
  });
  
  const [projectPanelOrder, setProjectPanelOrder] = useState<ProjectPanel[]>(() => {
    if (typeof window === 'undefined') return ALL_PROJECT_PANELS;
    const stored = window.localStorage?.getItem(PROJECT_PANEL_ORDER_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length === ALL_PROJECT_PANELS.length) {
          return parsed;
        }
      } catch {}
    }
    return ALL_PROJECT_PANELS;
  });
  
  // Project panel resize state
  const [projectPanelWidths, setProjectPanelWidths] = useState<Record<ProjectPanel, number>>(() => {
    if (typeof window === 'undefined') return { list: 25, health: 25, kanban: 25, timeline: 25 };
    const stored = window.localStorage?.getItem('fullscreen.project.panel.widths.v1');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {}
    }
    return { list: 25, health: 25, kanban: 25, timeline: 25 };
  });
  const [projectPanelResizing, setProjectPanelResizing] = useState<{ 
    leftPanel: ProjectPanel; 
    rightPanel: ProjectPanel;
    startX: number; 
    containerWidth: number;
    startLeftWidth: number;
    startRightWidth: number;
  } | null>(null);
  
  // Panel order for reordering
  const [panelOrder, setPanelOrder] = useState<TaskPanel[]>(() => {
    if (typeof window === 'undefined') return ['list', 'matrix', 'kanban'];
    const stored = window.localStorage?.getItem(TASK_PANEL_ORDER_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length === ALL_TASK_PANELS.length) {
          return parsed;
        }
      } catch {}
    }
    return ['list', 'matrix', 'kanban', 'calendar'];
  });
  
  // Panel resize state - stores percentage widths (should sum to 100 for active panels)
  const [panelWidths, setPanelWidths] = useState<Record<TaskPanel, number>>(() => {
    if (typeof window === 'undefined') return { ...DEFAULT_PANEL_WIDTHS };
    const stored = window.localStorage?.getItem('fullscreen.panel.widths.v3');
    if (stored) {
      try {
        return { ...DEFAULT_PANEL_WIDTHS, ...JSON.parse(stored) };
      } catch {}
    }
    return { ...DEFAULT_PANEL_WIDTHS };
  });
  const [panelResizing, setPanelResizing] = useState<{ 
    leftPanel: TaskPanel; 
    rightPanel: TaskPanel;
    startX: number; 
    containerWidth: number;
    startLeftWidth: number;
    startRightWidth: number;
  } | null>(null);
  const [activeWorkspacePanels, setActiveWorkspacePanels] = useState<TaskPanel[]>(() => {
    if (typeof window === 'undefined') return [...ALL_TASK_PANELS];
    const stored = window.localStorage?.getItem(WORKSPACE_PANELS_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const panels = parsed.filter(isTaskPanel);
          if (panels.length) {
            return panels as TaskPanel[];
          }
        }
      } catch {}
    }
    return [...ALL_TASK_PANELS];
  });
  const [workspacePanelOrder, setWorkspacePanelOrder] = useState<TaskPanel[]>(() => {
    if (typeof window === 'undefined') return [...ALL_TASK_PANELS];
    const stored = window.localStorage?.getItem(WORKSPACE_PANEL_ORDER_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const panels = parsed.filter(isTaskPanel);
          if (panels.length === ALL_TASK_PANELS.length) {
            return panels as TaskPanel[];
          }
        }
      } catch {}
    }
    return [...ALL_TASK_PANELS];
  });
  const [workspacePanelWidths, setWorkspacePanelWidths] = useState<Record<TaskPanel, number>>(() => {
    if (typeof window === 'undefined') return { ...DEFAULT_PANEL_WIDTHS };
    const stored = window.localStorage?.getItem(WORKSPACE_PANEL_WIDTHS_KEY);
    if (stored) {
      try {
        return { ...DEFAULT_PANEL_WIDTHS, ...JSON.parse(stored) };
      } catch {}
    }
    return { ...DEFAULT_PANEL_WIDTHS };
  });
  const [workspacePanelResizing, setWorkspacePanelResizing] = useState<{
    leftPanel: TaskPanel;
    rightPanel: TaskPanel;
    startX: number;
    containerWidth: number;
    startLeftWidth: number;
    startRightWidth: number;
  } | null>(null);
  
  const [projectSubView, setProjectSubView] = useState<ProjectSubView>(() => {
    if (typeof window === 'undefined') return 'list';
    const stored = window.localStorage?.getItem(PROJECT_SUB_VIEW_KEY);
    const validViews: ProjectSubView[] = ['list', 'matrix', 'kanban', 'calendar', 'gantt'];
    if (stored && validViews.includes(stored as ProjectSubView)) {
      return stored as ProjectSubView;
    }
    return 'list';
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectWorkspaceMode, setProjectWorkspaceMode] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(false);
  
  // Project filter/sort/search state
  const [projectSearch, setProjectSearch] = useState('');
  const [projectStatusFilter, setProjectStatusFilter] = useState<string>('all');
  const [projectSortBy, setProjectSortBy] = useState<'name' | 'deadline' | 'progress' | 'status'>('deadline');
  const [projectSortDir, setProjectSortDir] = useState<'asc' | 'desc'>('asc');
  const [showCompletedProjects, setShowCompletedProjects] = useState(false);
  const [projectOrganizerPanel, setProjectOrganizerPanel] = useState<'filters' | 'sort' | null>(null);
  const [showCompletedWorkspaceTasks, setShowCompletedWorkspaceTasks] = useState(false);
  const [workspaceSearch, setWorkspaceSearch] = useState('');
  const [workspaceOrganizerPanel, setWorkspaceOrganizerPanel] = useState<'filters' | 'sort' | 'group' | null>(null);
  const [workspaceMatrixFilter, setWorkspaceMatrixFilter] = useState<'all' | 'do-now' | 'deep-work' | 'delegate' | 'defer'>('all');
  const [workspaceSortBy, setWorkspaceSortBy] = useState<'date' | 'priority' | 'name'>('date');
  const [workspaceSortDir, setWorkspaceSortDir] = useState<'asc' | 'desc'>('asc');
  const [workspaceGroupBy, setWorkspaceGroupBy] = useState<'none' | 'priority' | 'status'>('none');
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [calendarOverdueOpen, setCalendarOverdueOpen] = useState(false);
  const [calendarUnscheduledOpen, setCalendarUnscheduledOpen] = useState(false);
  const [calendarQuickAddCollapsed, setCalendarQuickAddCollapsed] = useState(false);
  const [calendarPickerOpen, setCalendarPickerOpen] = useState(false);
  const [calendarNotesPanelOpen, setCalendarNotesPanelOpen] = useState(false);
  const [scrollHintDismissed, setScrollHintDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage?.getItem('calendar.scrollHintDismissed') === 'true';
  });
  const [splitSidebarWidth, setSplitSidebarWidth] = useState(() =>
    readStoredWidth(
      SPLIT_SIDEBAR_WIDTH_STORAGE_KEY,
      DEFAULT_SPLIT_SIDEBAR_WIDTH,
      SPLIT_SIDEBAR_MIN,
      SPLIT_SIDEBAR_MAX
    )
  );
  const [calendarSidebarWidth, setCalendarSidebarWidth] = useState(() =>
    readStoredWidth(
      CALENDAR_SIDEBAR_WIDTH_STORAGE_KEY,
      DEFAULT_CALENDAR_SIDEBAR_WIDTH,
      CALENDAR_SIDEBAR_MIN,
      CALENDAR_SIDEBAR_MAX
    )
  );
  const [calendarSidebarPosition, setCalendarSidebarPosition] =
    useState<CalendarSidebarPosition>(() => {
      if (typeof window === 'undefined') return 'left';
      const stored = window.localStorage?.getItem(
        CALENDAR_SIDEBAR_POSITION_STORAGE_KEY
      );
      return stored === 'right' ? 'right' : 'left';
    });
  const [calendarLayout, setCalendarLayout] = useState<CalendarLayoutMode>(() => {
    if (typeof window === 'undefined') return 'tasks-main';
    const stored = window.localStorage?.getItem(CALENDAR_LAYOUT_STORAGE_KEY);
    return stored === 'calendar-main' ? 'calendar-main' : 'tasks-main';
  });
  const [calendarViewRange, setCalendarViewRange] = useState<CalendarViewRange>(() => {
    if (typeof window === 'undefined') return 'month';
    const stored = window.localStorage?.getItem(CALENDAR_VIEW_RANGE_KEY);
    if (stored === 'day' || stored === 'week' || stored === 'list' || stored === 'custom' || stored === 'month') {
      return stored;
    }
    return 'month';
  });
  const [calendarCustomDays, setCalendarCustomDays] = useState<number>(() => {
    if (typeof window === 'undefined') return 7;
    const stored = window.localStorage?.getItem(CALENDAR_CUSTOM_DAYS_KEY);
    const num = stored ? parseInt(stored, 10) : 7;
    return num >= 1 && num <= 15 ? num : 7;
  });
  const [calendarListDays, setCalendarListDays] = useState<number>(() => {
    if (typeof window === 'undefined') return 7;
    const stored = window.localStorage?.getItem(CALENDAR_LIST_DAYS_KEY);
    const num = stored ? parseInt(stored, 10) : 7;
    return num >= 3 && num <= 14 ? num : 7;
  });
  const [calendarListColumns, setCalendarListColumns] = useState<1 | 2>(() => {
    if (typeof window === 'undefined') return 1;
    const stored = window.localStorage?.getItem(CALENDAR_LIST_COLUMNS_KEY);
    return stored === '2' ? 2 : 1;
  });
  // Panel calendar state (for the calendar panel in Tasks/Projects dashboard)
  const [panelCalendarView, setPanelCalendarView] = useState<PanelCalendarView>(() => {
    if (typeof window === 'undefined') return 'month';
    const stored = window.localStorage?.getItem(PANEL_CALENDAR_VIEW_KEY);
    if (stored === 'month' || stored === 'week' || stored === 'custom') {
      return stored;
    }
    return 'month';
  });
  const [panelCalendarDays, setPanelCalendarDays] = useState<number>(() => {
    if (typeof window === 'undefined') return 3;
    const stored = window.localStorage?.getItem(PANEL_CALENDAR_DAYS_KEY);
    const num = stored ? parseInt(stored, 10) : 3;
    return num >= 1 && num <= 6 ? num : 3;
  });
  const [calendarContentType, setCalendarContentType] = useState<CalendarContentType>(() => {
    if (typeof window === 'undefined') return 'both';
    const stored = window.localStorage?.getItem(CALENDAR_CONTENT_TYPE_KEY);
    if (stored === 'tasks' || stored === 'timelogs' || stored === 'both') {
      return stored;
    }
    return 'both';
  });
  const [activeResize, setActiveResize] = useState<ResizeTarget>(null);
  const [projectDropTarget, setProjectDropTarget] = useState<'all' | string | null>(null);
  const [calendarDropTarget, setCalendarDropTarget] = useState<string | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  
  // Cross-window drag state (for receiving drops from widget)
  const [crossWindowDrag, setCrossWindowDrag] = useState<CrossWindowDragState>({
    task: null,
    sourceWindow: null,
    isDragging: false
  });
  
  // Focus stack - allows multiple tasks in focus mode
  const [focusStack, setFocusStack] = useState<string[]>([]);
  const [focusStackDropActive, setFocusStackDropActive] = useState(false);

  useEffect(() => {
    if (
      selectedProjectId &&
      !projects.some((project) => project.id === selectedProjectId)
    ) {
      setSelectedProjectId(null);
    }
  }, [projects, selectedProjectId]);

  // Listen for cross-window drag state changes (from widget)
  useEffect(() => {
    if (typeof getWidgetAPI().onCrossWindowDragChange !== 'function') {
      console.warn('[FullScreen] onCrossWindowDragChange not available');
      return;
    }
    // Get initial state
    getWidgetAPI().getCrossWindowDragState?.().then((state) => {
      console.log('[FullScreen] Initial cross-window drag state:', state);
      setCrossWindowDrag(state);
    }).catch(() => {
      // Ignore errors on initial fetch
    });
    
    const unsubscribe = getWidgetAPI().onCrossWindowDragChange((state) => {
      console.log('[FullScreen] Cross-window drag state changed:', state);
      setCrossWindowDrag(state);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadContacts = async () => {
      setContactsLoading(true);
      try {
        const data = await getWidgetAPI().getContacts();
        if (!cancelled) {
          setContacts(data);
          setContactsError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setContactsError(
            error instanceof Error
              ? error.message
              : 'Unable to load contacts'
          );
        }
      } finally {
        if (!cancelled) {
          setContactsLoading(false);
        }
      }
    };
    loadContacts();
    return () => {
      cancelled = true;
    };
  }, []);
  
  // Listen for focus stack changes
  useEffect(() => {
    if (typeof getWidgetAPI().onFocusStackChange !== 'function') {
      return;
    }
    // Get initial state
    getWidgetAPI().getFocusStack?.().then((stack) => {
      setFocusStack(stack);
    }).catch(() => {
      // Ignore errors
    });
    
    const unsubscribe = getWidgetAPI().onFocusStackChange((stack) => {
      setFocusStack(stack);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getWidgetAPI().getTasks();
      setTasks(data);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load Notion tasks'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStatusOptions = useCallback(async () => {
    try {
      const options = await getWidgetAPI().getStatusOptions();
      setStatusOptions(options);
    } catch (err) {
      console.error('Unable to load status options', err);
    }
  }, []);

  const loadProjectStatusOptions = useCallback(async () => {
    try {
      const options = await getWidgetAPI().getProjectStatusOptions();
      setProjectStatusOptions(options);
    } catch (err) {
      console.error('Unable to load project status options', err);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    loadStatusOptions();
    loadProjectStatusOptions();
    getWidgetAPI().getAppPreferences().then(setAppPreferences);
    getWidgetAPI().getSettings().then(setNotionSettings);
    getWidgetAPI().getWritingSettings().then(setWritingSettings);
    const unsubscribe = getWidgetAPI().onTaskUpdated((updatedTask) => {
      setTasks((prev) => {
        const index = prev.findIndex((task) => task.id === updatedTask.id);
        if (index === -1) {
          return [...prev, updatedTask];
        }
        const next = [...prev];
        next[index] = updatedTask;
        return next;
      });
      setSortHold((prev) => ({
        ...prev,
        [updatedTask.id]: Date.now() + SORT_HOLD_DURATION
      }));
    });
    return () => {
      unsubscribe?.();
    };
  }, [fetchTasks, loadStatusOptions]);

  useEffect(() => {
    const collapseHostWidget = async () => {
      try {
        if (typeof getWidgetAPI().forceCollapse === 'function') {
          await getWidgetAPI().forceCollapse();
          return;
        }
      } catch (error) {
        console.warn('forceCollapse unavailable in fullscreen context', error);
      }
      try {
        await getWidgetAPI().requestCollapse();
      } catch (error) {
        console.warn('Unable to auto-collapse widget while fullscreen is open', error);
      }
    };
    collapseHostWidget();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem('widget.activeView', activeWidget);
  }, [activeWidget]);

  // Persist view mode
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(FULLSCREEN_VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(PROJECT_SUB_VIEW_KEY, projectSubView);
  }, [projectSubView]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(
      SPLIT_SIDEBAR_WIDTH_STORAGE_KEY,
      String(Math.round(splitSidebarWidth))
    );
  }, [splitSidebarWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(
      CALENDAR_SIDEBAR_WIDTH_STORAGE_KEY,
      String(Math.round(calendarSidebarWidth))
    );
  }, [calendarSidebarWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(
      CALENDAR_SIDEBAR_POSITION_STORAGE_KEY,
      calendarSidebarPosition
    );
  }, [calendarSidebarPosition]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(CALENDAR_LAYOUT_STORAGE_KEY, calendarLayout);
  }, [calendarLayout]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(CALENDAR_VIEW_RANGE_KEY, calendarViewRange);
  }, [calendarViewRange]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(CALENDAR_CUSTOM_DAYS_KEY, String(calendarCustomDays));
  }, [calendarCustomDays]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(CALENDAR_LIST_DAYS_KEY, String(calendarListDays));
  }, [calendarListDays]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(CALENDAR_LIST_COLUMNS_KEY, String(calendarListColumns));
  }, [calendarListColumns]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(CALENDAR_CONTENT_TYPE_KEY, calendarContentType);
  }, [calendarContentType]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(PANEL_CALENDAR_VIEW_KEY, panelCalendarView);
  }, [panelCalendarView]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(PANEL_CALENDAR_DAYS_KEY, String(panelCalendarDays));
  }, [panelCalendarDays]);

  // Navigate calendar based on view range
  const navigateCalendar = useCallback((direction: -1 | 1) => {
    const newDate = new Date(calendarDate);
    if (calendarViewRange === 'day') {
      newDate.setDate(newDate.getDate() + direction);
    } else if (calendarViewRange === 'week') {
      newDate.setDate(newDate.getDate() + direction * 7);
    } else if (calendarViewRange === 'list') {
      newDate.setDate(newDate.getDate() + direction * calendarListDays);
    } else if (calendarViewRange === 'custom') {
      newDate.setDate(newDate.getDate() + direction * calendarCustomDays);
    } else {
      newDate.setMonth(newDate.getMonth() + direction);
    }
    setCalendarDate(newDate);
  }, [calendarDate, calendarViewRange, calendarListDays, calendarCustomDays]);

  // Persist active panels
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(TASK_PANELS_KEY, JSON.stringify(activePanels));
  }, [activePanels]);

  // Persist project panels
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(PROJECT_PANELS_KEY, JSON.stringify(activeProjectPanels));
  }, [activeProjectPanels]);

  // Persist project panel order
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(PROJECT_PANEL_ORDER_KEY, JSON.stringify(projectPanelOrder));
  }, [projectPanelOrder]);

  // Persist panel order
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(TASK_PANEL_ORDER_KEY, JSON.stringify(panelOrder));
  }, [panelOrder]);

  // Persist panel widths
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem('fullscreen.panel.widths.v3', JSON.stringify(panelWidths));
  }, [panelWidths]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(
      WORKSPACE_PANELS_KEY,
      JSON.stringify(activeWorkspacePanels)
    );
  }, [activeWorkspacePanels]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(
      WORKSPACE_PANEL_ORDER_KEY,
      JSON.stringify(workspacePanelOrder)
    );
  }, [workspacePanelOrder]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(
      WORKSPACE_PANEL_WIDTHS_KEY,
      JSON.stringify(workspacePanelWidths)
    );
  }, [workspacePanelWidths]);

  // Handle panel resizing - properly adjusts both adjacent panels
  useEffect(() => {
    if (!panelResizing) return;
    
    // Prevent text selection during resize
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    
    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      
      const delta = event.clientX - panelResizing.startX;
      const percentDelta = (delta / panelResizing.containerWidth) * 100;
      
      // Calculate new widths ensuring they stay within bounds
      const minWidth = 15; // Minimum 15% width
      const totalWidth = panelResizing.startLeftWidth + panelResizing.startRightWidth;
      let newLeftWidth = panelResizing.startLeftWidth + percentDelta;
      let newRightWidth = panelResizing.startRightWidth - percentDelta;
      
      // Clamp values
      if (newLeftWidth < minWidth) {
        newLeftWidth = minWidth;
        newRightWidth = totalWidth - minWidth;
      }
      if (newRightWidth < minWidth) {
        newRightWidth = minWidth;
        newLeftWidth = totalWidth - minWidth;
      }
      
      setPanelWidths(prev => ({
        ...prev,
        [panelResizing.leftPanel]: newLeftWidth,
        [panelResizing.rightPanel]: newRightWidth
      }));
    };
    
    const handlePointerUp = () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      setPanelResizing(null);
    };
    
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    
    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [panelResizing]);
  useEffect(() => {
    if (!workspacePanelResizing) return;

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const delta = event.clientX - workspacePanelResizing.startX;
      const percentDelta =
        (delta / workspacePanelResizing.containerWidth) * 100;
      const minWidth = 15;
      const totalWidth =
        workspacePanelResizing.startLeftWidth +
        workspacePanelResizing.startRightWidth;
      let newLeftWidth = workspacePanelResizing.startLeftWidth + percentDelta;
      let newRightWidth = workspacePanelResizing.startRightWidth - percentDelta;

      if (newLeftWidth < minWidth) {
        newLeftWidth = minWidth;
        newRightWidth = totalWidth - minWidth;
      }
      if (newRightWidth < minWidth) {
        newRightWidth = minWidth;
        newLeftWidth = totalWidth - minWidth;
      }

      setWorkspacePanelWidths((prev) => ({
        ...prev,
        [workspacePanelResizing.leftPanel]: newLeftWidth,
        [workspacePanelResizing.rightPanel]: newRightWidth
      }));
    };

    const handlePointerUp = () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      setWorkspacePanelResizing(null);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [workspacePanelResizing]);

  // Persist project panel widths
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem('fullscreen.project.panel.widths.v1', JSON.stringify(projectPanelWidths));
  }, [projectPanelWidths]);

  // Handle project panel resizing - properly adjusts both adjacent panels
  useEffect(() => {
    if (!projectPanelResizing) return;
    
    // Prevent text selection during resize
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    
    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      
      const delta = event.clientX - projectPanelResizing.startX;
      const percentDelta = (delta / projectPanelResizing.containerWidth) * 100;
      
      // Calculate new widths ensuring they stay within bounds
      const minWidth = 15; // Minimum 15% width
      const totalWidth = projectPanelResizing.startLeftWidth + projectPanelResizing.startRightWidth;
      let newLeftWidth = projectPanelResizing.startLeftWidth + percentDelta;
      let newRightWidth = projectPanelResizing.startRightWidth - percentDelta;
      
      // Clamp values
      if (newLeftWidth < minWidth) {
        newLeftWidth = minWidth;
        newRightWidth = totalWidth - minWidth;
      }
      if (newRightWidth < minWidth) {
        newRightWidth = minWidth;
        newLeftWidth = totalWidth - minWidth;
      }
      
      setProjectPanelWidths(prev => ({
        ...prev,
        [projectPanelResizing.leftPanel]: newLeftWidth,
        [projectPanelResizing.rightPanel]: newRightWidth
      }));
    };
    
    const handlePointerUp = () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      setProjectPanelResizing(null);
    };
    
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    
    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [projectPanelResizing]);

  useEffect(() => {
    if (!activeResize) return;
    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      const delta = event.clientX - activeResize.startX;
      const orientationMultiplier =
        activeResize.type === 'calendar' && activeResize.orientation === 'right'
          ? -1
          : 1;
      const min =
        activeResize.type === 'calendar' ? CALENDAR_SIDEBAR_MIN : 160;
      const max =
        activeResize.type === 'calendar' ? CALENDAR_SIDEBAR_MAX : 400;
      const nextWidth = clampWidth(
        activeResize.startWidth + delta * orientationMultiplier,
        min,
        max
      );
      if (activeResize.type === 'calendar') {
        setCalendarSidebarWidth(nextWidth);
      } else {
        // Resize the projects sidebar
        setProjectSidebarWidth(nextWidth);
      }
    };
    const handlePointerUp = () => {
      setActiveResize(null);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [activeResize]);

  useEffect(() => {
    if (!activeResize || typeof document === 'undefined') return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [activeResize]);

  // Close filter dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Check if click is outside any filter dropdown
      if (!target.closest('.filter-dropdown')) {
        document.querySelectorAll('.filter-dropdown-menu.is-open').forEach(menu => {
          menu.classList.remove('is-open');
        });
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    if (viewMode !== 'projects') {
      setProjectDropTarget(null);
    }
    if (viewMode !== 'calendar') {
      setCalendarDropTarget(null);
    }
  }, [viewMode]);

  // Fetch projects when in split view or matrix view or timelogs/writing views
  const loadProjectsFromCache = useCallback(async () => {
    try {
      setProjectsLoading(true);
      const cached = await getWidgetAPI().getProjects();
      setProjects(cached);
    } catch (err) {
      console.error('Failed to load cached projects', err);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  // Update project status (for drag-drop in kanban)
  const handleUpdateProjectStatus = useCallback(async (projectId: string, newStatus: string) => {
    try {
      // Update local state optimistically
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId ? { ...p, status: newStatus } : p
        )
      );
      
      // Try to update via API (will sync to Notion)
      const result = await getWidgetAPI().updateLocalProject(projectId, { status: newStatus });
      if (result) {
        console.log(`[Projects] Updated project ${projectId} status to "${newStatus}"`);
      }
    } catch (err) {
      console.error('Failed to update project status:', err);
      // Revert on error
      loadProjectsFromCache();
    }
  }, [loadProjectsFromCache]);

  useEffect(() => {
    // Always fetch projects when in tasks, projects, or writing view
    const needsProjects = viewMode === 'tasks' || viewMode === 'projects' || viewMode === 'writing';
    if (needsProjects) {
      loadProjectsFromCache();
    }
  }, [viewMode, loadProjectsFromCache]);

  useEffect(() => {
    const unsubscribe = getWidgetAPI().onProjectsUpdated((updatedProjects) => {
      setProjects(updatedProjects);
    });
    return unsubscribe;
  }, []);

  // Persist project sidebar state
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem('fullscreen.projectSidebar.open', String(projectSidebarOpen));
  }, [projectSidebarOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem('fullscreen.projectSidebar.width', String(Math.round(projectSidebarWidth)));
  }, [projectSidebarWidth]);

  // Persist nav sidebar collapsed state
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(NAV_SIDEBAR_STORAGE_KEY, String(navSidebarCollapsed));
  }, [navSidebarCollapsed]);
  
  // Persist header collapsed state
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(HEADER_COLLAPSED_STORAGE_KEY, String(headerCollapsed));
  }, [headerCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem('widget.dayFilter', dayFilter);
    window.localStorage?.setItem('widget.taskFilter', dayFilter);
  }, [dayFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem('widget.filter.matrix', matrixFilter);
  }, [matrixFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem('widget.filter.deadline', deadlineFilter);
  }, [deadlineFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem('widget.filter.status', statusFilter);
  }, [statusFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(
      FILTER_PANEL_STORAGE_KEY,
      activeOrganizerPanel ?? 'none'
    );
  }, [activeOrganizerPanel]);

  // Global keyboard shortcuts for fullscreen view
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip if user is typing in an input field
      const target = event.target as HTMLElement;
      const isInputField = target.tagName === 'INPUT' || 
                          target.tagName === 'TEXTAREA' || 
                          target.isContentEditable;
      if (isInputField) return;
      
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? event.metaKey : event.ctrlKey;
      
      // Ctrl/Cmd + \ - Toggle nav sidebar
      if (modKey && !event.shiftKey && event.key === '\\') {
        event.preventDefault();
        setNavSidebarCollapsed(prev => !prev);
        return;
      }
      
      // Ctrl/Cmd + Shift + \ (pipe character) - Toggle header
      // Note: Shift+\ produces "|" on most keyboards
      if (modKey && event.shiftKey && (event.key === '|' || event.key === '\\')) {
        event.preventDefault();
        setHeaderCollapsed(prev => !prev);
        return;
      }
      
      // Ctrl/Cmd + 1-4 - Switch main view modes
      if (modKey && !event.shiftKey && !event.altKey) {
        const viewModes: FullscreenViewMode[] = ['tasks', 'projects', 'calendar', 'writing'];
        const keyNum = parseInt(event.key, 10);
        if (keyNum >= 1 && keyNum <= 4) {
          event.preventDefault();
          setViewMode(viewModes[keyNum - 1]);
          return;
        }
      }
      
      // Alt + 1-4 - Toggle panels within current view
      if (event.altKey && !modKey && !event.shiftKey) {
        const keyNum = parseInt(event.key, 10);
        if (keyNum >= 1 && keyNum <= 4) {
          event.preventDefault();
          
          if (viewMode === 'tasks') {
            // Toggle task panels based on current panel order
            const orderedPanels = panelOrder;
            if (keyNum <= orderedPanels.length) {
              const targetPanel = orderedPanels[keyNum - 1];
              setActivePanels(prev => {
                if (prev.includes(targetPanel)) {
                  // Don't remove if it's the only panel
                  if (prev.length > 1) {
                    return prev.filter(p => p !== targetPanel);
                  }
                  return prev;
                }
                return [...prev, targetPanel];
              });
            }
          } else if (viewMode === 'projects') {
            // Toggle project panels based on current panel order
            const orderedPanels = projectPanelOrder;
            if (keyNum <= orderedPanels.length) {
              const targetPanel = orderedPanels[keyNum - 1];
              setActiveProjectPanels(prev => {
                if (prev.includes(targetPanel)) {
                  // Don't remove if it's the only panel
                  if (prev.length > 1) {
                    return prev.filter(p => p !== targetPanel);
                  }
                  return prev;
                }
                return [...prev, targetPanel];
              });
            }
          }
          return;
        }
      }
      
      // Single-key shortcuts (no modifiers required)
      if (!modKey && !event.altKey && !event.shiftKey) {
        // F - Toggle filters panel
        if (event.key === 'f' || event.key === 'F') {
          event.preventDefault();
          setActiveOrganizerPanel(prev => prev === 'filters' ? null : 'filters');
          return;
        }
        
        // S - Toggle sort panel
        if (event.key === 's' || event.key === 'S') {
          event.preventDefault();
          setActiveOrganizerPanel(prev => prev === 'sort' ? null : 'sort');
          return;
        }
        
        // G - Toggle group panel
        if (event.key === 'g' || event.key === 'G') {
          event.preventDefault();
          setActiveOrganizerPanel(prev => prev === 'group' ? null : 'group');
          return;
        }
        
        // H - Toggle header
        if (event.key === 'h' || event.key === 'H') {
          event.preventDefault();
          setHeaderCollapsed(prev => !prev);
          return;
        }
        
        // B - Toggle sidebar
        if (event.key === 'b' || event.key === 'B') {
          event.preventDefault();
          setNavSidebarCollapsed(prev => !prev);
          return;
        }
        
        // N - Toggle notes panel (in tasks or projects view)
        if (event.key === 'n' || event.key === 'N') {
          if (viewMode === 'tasks' || viewMode === 'projects') {
            event.preventDefault();
            setNotesPanelOpen(prev => !prev);
            return;
          }
        }
        
        // Q - Toggle quick add panel
        if (event.key === 'q' || event.key === 'Q') {
          if (viewMode === 'tasks' || viewMode === 'projects') {
            event.preventDefault();
            setQuickAddCollapsed(prev => !prev);
            return;
          }
        }
        
        // D - Cycle day filter (all -> today -> week -> all) in tasks view
        if (event.key === 'd' || event.key === 'D') {
          if (viewMode === 'tasks') {
            event.preventDefault();
            setDayFilter(prev => {
              if (prev === 'all') return 'today';
              if (prev === 'today') return 'week';
              return 'all';
            });
            return;
          }
        }
        
        // T - Jump to today in calendar view
        if (event.key === 't' || event.key === 'T') {
          if (viewMode === 'calendar') {
            event.preventDefault();
            setCalendarDate(new Date());
            return;
          }
        }
        
        // P - Exit project workspace mode (when in projects view with workspace open)
        if (event.key === 'p' || event.key === 'P') {
          if (viewMode === 'projects' && projectWorkspaceMode) {
            event.preventDefault();
            setProjectWorkspaceMode(false);
            return;
          }
        }
        
        // [ and ] - Navigate between main views
        if (event.key === '[') {
          event.preventDefault();
          const viewModes: FullscreenViewMode[] = ['tasks', 'projects', 'calendar', 'writing'];
          const currentIndex = viewModes.indexOf(viewMode);
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : viewModes.length - 1;
          setViewMode(viewModes[prevIndex]);
          return;
        }
        if (event.key === ']') {
          event.preventDefault();
          const viewModes: FullscreenViewMode[] = ['tasks', 'projects', 'calendar', 'writing'];
          const currentIndex = viewModes.indexOf(viewMode);
          const nextIndex = currentIndex < viewModes.length - 1 ? currentIndex + 1 : 0;
          setViewMode(viewModes[nextIndex]);
          return;
        }
        
        // Arrow keys - Calendar navigation (when in calendar view)
        if (viewMode === 'calendar') {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            navigateCalendar(-1);
            return;
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            navigateCalendar(1);
            return;
          }
        }
        
        // Escape - Close panels, exit modes
        if (event.key === 'Escape') {
          // Close notes panel first
          if (notesPanelOpen) {
            event.preventDefault();
            setNotesPanelOpen(false);
            return;
          }
          // Close organizer panels
          if (activeOrganizerPanel) {
            event.preventDefault();
            setActiveOrganizerPanel(null);
            return;
          }
          // Exit focus mode
          if (focusTaskId) {
            event.preventDefault();
            setFocusTaskId(null);
            return;
          }
          // Exit project workspace mode
          if (projectWorkspaceMode) {
            event.preventDefault();
            setProjectWorkspaceMode(false);
            return;
          }
        }
      }
      
      // Ctrl/Cmd + R - Refresh tasks
      if (modKey && !event.shiftKey && (event.key === 'r' || event.key === 'R')) {
        event.preventDefault();
        fetchTasks();
        return;
      }
      
      // Ctrl/Cmd + N - Focus quick add (if in tasks or projects view)
      if (modKey && !event.shiftKey && (event.key === 'n' || event.key === 'N')) {
        if (viewMode === 'tasks' || viewMode === 'projects') {
          event.preventDefault();
          setQuickAddCollapsed(false);
          // Focus the quick add input after a short delay
          setTimeout(() => {
            const quickAddInput = document.querySelector('.quick-add-input') as HTMLInputElement;
            quickAddInput?.focus();
          }, 50);
          return;
        }
      }
      
      // Ctrl/Cmd + , (comma) - Open settings
      if (modKey && !event.shiftKey && event.key === ',') {
        event.preventDefault();
        getWidgetAPI()
          .openSettingsWindow()
          .catch((err) => {
            console.error('Unable to open Control Center window', err);
          });
        return;
      }
      
      // Ctrl/Cmd + F - Focus search
      if (modKey && !event.shiftKey && (event.key === 'f' || event.key === 'F')) {
        if (viewMode === 'tasks' || viewMode === 'projects') {
          event.preventDefault();
          const searchInput = document.querySelector('.search-input') as HTMLInputElement;
          searchInput?.focus();
          return;
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode, panelOrder, projectPanelOrder, activeOrganizerPanel, focusTaskId, notesPanelOpen, projectWorkspaceMode, navigateCalendar, fetchTasks]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const serialized = JSON.stringify(serializeSortRules(sortRules));
    window.localStorage?.setItem(SORT_RULES_STORAGE_KEY, serialized);
  }, [sortRules]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(GROUPING_STORAGE_KEY, grouping);
  }, [grouping]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(SEARCH_QUERY_STORAGE_KEY, searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (activeWidget !== 'writing') return;
    getWidgetAPI().getWritingSettings().then(setWritingSettings);
  }, [activeWidget]);

  useEffect(() => {
    getWidgetAPI().getTimeLogSettings().then(setTimeLogSettings).catch(() => {
      // Time log settings may not be configured yet
    });
  }, []);

  useEffect(() => {
    if (!appPreferences?.autoRefreshTasks) return;
    const interval = window.setInterval(() => {
      fetchTasks();
    }, 5 * 60 * 1000);
    return () => {
      clearInterval(interval);
    };
  }, [appPreferences?.autoRefreshTasks, fetchTasks]);

  // Focus-based sync: trigger sync when window gains focus
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const handleWindowFocus = () => {
      const api = getWidgetAPI();
      if (typeof api.forceSync === 'function') {
        api.forceSync().catch((error: Error) => {
          console.error('Focus-triggered sync failed', error);
        });
      }
      fetchTasks();
    };
    
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [fetchTasks]);

  const handleAddTask = useCallback(
    async (payload: NotionCreatePayload) => {
      try {
        const newTask = await getWidgetAPI().addTask(payload);
        setTasks((prev) => [newTask, ...prev]);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Unable to add Notion task'
        );
        throw err;
      }
    },
    []
  );

  const handleCreateWritingEntry = useCallback(
    async (payload: WritingEntryPayload) => {
      await getWidgetAPI().createWritingEntry(payload);
    },
    []
  );

  const handleCreateTimeLogEntry = useCallback(
    async (payload: TimeLogEntryPayload) => {
      await getWidgetAPI().createTimeLogEntry(payload);
    },
    []
  );

  const handleOpenSettings = useCallback(() => {
    // Always open Control Center - it's the primary settings interface
    const api = getWidgetAPI();
    api
      .openSettingsWindow()
      .catch((err) => console.error('Unable to open Control Center window', err));
  }, []);

  const handlePopOutTask = useCallback(
    async (taskId: string) => {
      if (!canUseWindowControls) {
        return;
      }
      const openTaskWindow = getWidgetAPI().openTaskWindow;
      if (typeof openTaskWindow !== 'function') {
        console.error('getWidgetAPI().openTaskWindow is not available');
        setError('Pop-out window API unavailable. Please restart the app.');
        return;
      }
      try {
        await openTaskWindow(taskId);
      } catch (error) {
        console.error('Unable to open floating task window', error);
        setError(
          error instanceof Error
            ? error.message
            : 'Unable to open floating task window'
        );
      }
    },
    [canUseWindowControls]
  );

  const scrollToCenterTaskElement = useCallback((element: HTMLElement) => {
    if (!element) return;
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest'
    });
  }, []);

  const handleStartSplitResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setActiveResize({
        type: 'split',
        startX: event.clientX,
        startWidth: splitSidebarWidth,
        orientation: 'left'
      });
    },
    [splitSidebarWidth]
  );

  const handleStartCalendarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setActiveResize({
        type: 'calendar',
        startX: event.clientX,
        startWidth: calendarSidebarWidth,
        orientation: calendarSidebarPosition
      });
    },
    [calendarSidebarWidth, calendarSidebarPosition]
  );

  const handleExternalTaskDragStart = useCallback((task: Task) => {
    dragTaskRef.current = task;
    setDraggedTaskId(task.id);
    // Also start cross-window drag so widget and other windows know
    console.log('[FullScreen] Starting cross-window drag:', task.title);
    getWidgetAPI().startCrossWindowDrag?.(task, 'fullscreen');
  }, []);

  const handleExternalTaskDragEnd = useCallback(() => {
    dragTaskRef.current = null;
    setDraggedTaskId(null);
    setProjectDropTarget(null);
    setCalendarDropTarget(null);
    // Note: Don't end cross-window drag here - let the drop handler or cancel do it
  }, []);


  const projectTaskCounts = useMemo(() => {
    const counts = new Map<string, number>();
    tasks.forEach((task) => {
      if (completedStatus && task.status === completedStatus) {
        return;
      }
      (task.projectIds ?? []).forEach((projectId) => {
        counts.set(projectId, (counts.get(projectId) ?? 0) + 1);
      });
    });
    return counts;
  }, [tasks, completedStatus]);
  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null;
    return projects.find((project) => project.id === selectedProjectId) ?? null;
  }, [projects, selectedProjectId]);
  const workspaceProject = projectWorkspaceMode ? selectedProject : null;
  const workspaceContacts = useMemo(() => {
    if (!workspaceProject) {
      return { list: [] as Contact[], hasLinked: false };
    }
    if (!contacts.length) {
      return { list: [] as Contact[], hasLinked: false };
    }
    const linked = contacts.filter((contact) =>
      (contact.projectIds ?? []).includes(workspaceProject.id)
    );
    if (linked.length) {
      return { list: linked, hasLinked: true };
    }
    return { list: contacts, hasLinked: false };
  }, [contacts, workspaceProject]);

  const filteredTasks = useMemo(() => {
    const todayKey = getTodayKey();
    const todayTimestamp = toMidnightTimestamp(todayKey)!;
    const endOfWeek = new Date(todayTimestamp);
    endOfWeek.setDate(endOfWeek.getDate() + 7);
    const endOfWeekTimestamp = endOfWeek.getTime();

    return tasks.filter((task) => {
      // Apply search filter first
      if (searchQuery && !taskMatchesSearch(task, searchQuery)) {
        return false;
      }

      const normalizedStatus =
        mapStatusToFilterValue(task.status) ??
        mapStatusToFilterValue(task.normalizedStatus) ??
        task.normalizedStatus;
      const isUrgent = Boolean(task.urgent);
      const isImportant = Boolean(task.important);
      const dueDateKey = extractDateKey(task.dueDate);
      const dueDateTimestamp = dueDateKey
        ? toMidnightTimestamp(dueDateKey)
        : null;

      if (dayFilter === 'today') {
        if (dueDateTimestamp === null) {
          return false;
        }
        if (dueDateTimestamp > todayTimestamp) {
          return false;
        }
      }
      if (dayFilter === 'week') {
        if (dueDateTimestamp === null) {
          return false;
        }
        if (dueDateTimestamp > endOfWeekTimestamp) {
          return false;
        }
      }
      if (matrixFilter === 'do-now' && !(isUrgent && isImportant)) {
        return false;
      }
      if (
        matrixFilter === 'deep-work' &&
        !(isImportant && !isUrgent)
      ) {
        return false;
      }
      if (
        matrixFilter === 'delegate' &&
        !(isUrgent && !isImportant)
      ) {
        return false;
      }
      if (matrixFilter === 'trash' && (isUrgent || isImportant)) {
        return false;
      }
      if (deadlineFilter === 'hard' && !task.hardDeadline) {
        return false;
      }
      if (statusFilter !== 'all' && normalizedStatus !== statusFilter) {
        return false;
      }
      if (
        viewMode === 'projects' &&
        selectedProjectId &&
        !(task.projectIds ?? []).includes(selectedProjectId)
      ) {
        return false;
      }
      return true;
    });
  }, [
    tasks,
    dayFilter,
    matrixFilter,
    deadlineFilter,
    statusFilter,
    searchQuery,
    selectedProjectId,
    viewMode
  ]);

  const baseSortedTasks = useMemo(
    () => sortTasks(filteredTasks, sortRules),
    [filteredTasks, sortRules]
  );

  useEffect(() => {
    setDisplayTasks((previous) => {
      const seed = previous.length ? previous : baseSortedTasks;
      return mergeTasksWithHold(seed, baseSortedTasks, sortHold);
    });
  }, [baseSortedTasks, sortHold]);

  useEffect(() => {
    setSortHold((prev) => pruneHoldMap(prev, baseSortedTasks));
  }, [baseSortedTasks]);

  const taskGroups = useMemo(
    () =>
      grouping === 'none'
        ? undefined
        : groupTasks(displayTasks, grouping, projects),
    [displayTasks, grouping, projects]
  );

  const visibleGrouping: GroupingOption = isFocusMode ? 'none' : grouping;
  const visibleGroups = isFocusMode ? undefined : taskGroups;

  const filterEmptyMessage =
    searchQuery
      ? `No tasks match "${searchQuery}"`
      : dayFilter === 'today'
      ? 'No tasks due today match these filters.'
      : dayFilter === 'week'
        ? 'No tasks due this week match these filters.'
      : 'No tasks match the current filters.';

  const handleUpdateTask = useCallback(
    async (taskId: string, updates: TaskUpdatePayload) => {
      try {
        const updated = await getWidgetAPI().updateTask(taskId, updates);
        setTasks((prev) =>
          prev.map((task) => (task.id === taskId ? updated : task))
        );
        setSortHold((prev) => ({
          ...prev,
          [taskId]: Date.now() + SORT_HOLD_DURATION
        }));
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Unable to update Notion task'
        );
        throw err;
      }
    },
    []
  );

  const handleUpdateTaskStatus = useCallback(
    async (taskId: string, updates: { status: string | null }) => {
      await handleUpdateTask(taskId, updates);
    },
    [handleUpdateTask]
  );

  const handleProjectDragOver = useCallback(
    (event: ReactDragEvent<HTMLLIElement>, projectId: string | null) => {
      // Allow drops from both internal drags and cross-window drags
      if (!draggedTaskId && !crossWindowDrag.isDragging) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setProjectDropTarget(projectId ?? 'all');
    },
    [draggedTaskId, crossWindowDrag.isDragging]
  );

  const handleProjectDragLeave = useCallback((projectId: string | null) => {
    setProjectDropTarget((previous) => {
      const key = projectId ?? 'all';
      return previous === key ? null : previous;
    });
  }, []);

  // Cross-window drop handler - must be defined before callbacks that use it
  const handleCrossWindowDrop = useCallback(
    async (payload: CrossWindowDropPayload) => {
      if (!crossWindowDrag.isDragging || !crossWindowDrag.task) {
        return;
      }
      try {
        await getWidgetAPI().handleCrossWindowDrop(payload);
      } catch (error) {
        console.error('Cross-window drop failed', error);
      }
    },
    [crossWindowDrag]
  );
  
  // Click-based cross-window drop (since native drag events don't work across Electron windows)
  // Users click on drop zones to place the dragged task
  const handleCalendarDayCrossWindowClick = useCallback(
    async (dateStr: string) => {
      if (!crossWindowDrag.isDragging || !crossWindowDrag.task) return;
      try {
        await getWidgetAPI().handleCrossWindowDrop({ zoneType: 'calendar', date: dateStr });
        setCalendarDate(new Date(dateStr));
      } catch (error) {
        console.error('Cross-window calendar click drop failed', error);
      }
    },
    [crossWindowDrag]
  );
  
  const handleProjectCrossWindowClick = useCallback(
    async (projectId: string | null) => {
      if (!crossWindowDrag.isDragging || !crossWindowDrag.task) return;
      try {
        await getWidgetAPI().handleCrossWindowDrop({ 
          zoneType: 'project', 
          projectId: projectId ?? undefined 
        });
        if (projectId) {
          setSelectedProjectId(projectId);
        }
      } catch (error) {
        console.error('Cross-window project click drop failed', error);
      }
    },
    [crossWindowDrag]
  );
  
  // Cancel cross-window drag with Escape key or clicking outside drop zones
  useEffect(() => {
    if (!crossWindowDrag.isDragging) return;
    
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        getWidgetAPI().endCrossWindowDrag?.();
      }
    };
    
    // Click outside of drop zones cancels the drag
    const handleClickCancel = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Check if click is on a drop zone (has cross-window-target class or is inside focus-stack-panel)
      const isDropZone = 
        target.closest('.is-cross-window-target') ||
        target.closest('.focus-stack-drop-button') ||
        target.closest('.cross-window-drop-hint');
      
      if (!isDropZone) {
        // Clicked outside drop zone - cancel drag
        getWidgetAPI().endCrossWindowDrag?.();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    // Use capture phase and a small delay to let drop zone clicks be handled first
    const timeoutId = setTimeout(() => {
      window.addEventListener('click', handleClickCancel, true);
    }, 100);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timeoutId);
      window.removeEventListener('click', handleClickCancel, true);
    };
  }, [crossWindowDrag.isDragging]);

  const handleProjectDrop = useCallback(
    async (event: ReactDragEvent<HTMLLIElement>, projectId: string | null) => {
      event.preventDefault();
      setProjectDropTarget(null);
      
      // Handle cross-window drops from widget
      if (crossWindowDrag.isDragging && crossWindowDrag.task) {
        await handleCrossWindowDrop({ 
          zoneType: 'project', 
          projectId: projectId ?? undefined 
        });
        if (projectId) {
          setSelectedProjectId(projectId);
        }
        return;
      }
      
      // Handle internal drags (within fullscreen)
      if (!dragTaskRef.current) return;
      const task = dragTaskRef.current;
      const nextProjectIds = projectId === null ? [] : [projectId];
      const currentProjects = task.projectIds ?? [];
      const alreadyAssigned =
        projectId === null
          ? currentProjects.length === 0
          : currentProjects.length === 1 && currentProjects[0] === projectId;
      if (alreadyAssigned) {
        return;
      }
      try {
        await handleUpdateTask(task.id, { projectIds: nextProjectIds });
        if (projectId) {
          setSelectedProjectId(projectId);
        }
      } catch (error) {
        console.error('Failed to update project link from drag', error);
      }
    },
    [handleUpdateTask, crossWindowDrag, handleCrossWindowDrop]
  );

  const handleCalendarDayDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, dateStr: string) => {
      // Allow drops from both internal drags and cross-window drags
      if (!draggedTaskId && !crossWindowDrag.isDragging) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setCalendarDropTarget(dateStr);
    },
    [draggedTaskId, crossWindowDrag.isDragging]
  );

  const handleCalendarDayDragLeave = useCallback((dateStr: string) => {
    setCalendarDropTarget((previous) => (previous === dateStr ? null : previous));
  }, []);

  const handleCalendarDayDrop = useCallback(
    async (event: ReactDragEvent<HTMLDivElement>, dateStr: string) => {
      event.preventDefault();
      setCalendarDropTarget(null);
      
      // Handle cross-window drops from widget
      if (crossWindowDrag.isDragging && crossWindowDrag.task) {
        await handleCrossWindowDrop({ zoneType: 'calendar', date: dateStr });
        setCalendarDate(new Date(dateStr));
        return;
      }
      
      // Handle internal drags (within fullscreen)
      if (!dragTaskRef.current) return;
      const task = dragTaskRef.current;
      const nextDueDate = toLocalMiddayIso(dateStr);
      if (!nextDueDate) {
        return;
      }
      if (task.dueDate?.startsWith(dateStr)) {
        return;
      }
      try {
        await handleUpdateTask(task.id, {
          dueDate: nextDueDate,
          dueDateEnd: null
        });
        setCalendarDate(new Date(dateStr));
      } catch (error) {
        console.error('Failed to reschedule task from calendar drop', error);
      }
    },
    [handleUpdateTask, crossWindowDrag, handleCrossWindowDrop]
  );

  const toggleCalendarSidebarPosition = useCallback(() => {
    setCalendarSidebarPosition((previous) =>
      previous === 'left' ? 'right' : 'left'
    );
  }, []);
  
  const handleFocusStackDrop = useCallback(
    async (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setFocusStackDropActive(false);
      
      // Handle cross-window drops from widget
      if (crossWindowDrag.isDragging && crossWindowDrag.task) {
        await handleCrossWindowDrop({ zoneType: 'focus-stack' });
        return;
      }
      
      // Handle internal drags (within fullscreen)
      if (dragTaskRef.current) {
        const task = dragTaskRef.current;
        if (!focusStack.includes(task.id)) {
          try {
            await getWidgetAPI().addToFocusStack(task.id);
          } catch (error) {
            console.error('Failed to add to focus stack', error);
          }
        }
      }
    },
    [crossWindowDrag, handleCrossWindowDrop, focusStack]
  );
  
  // Click-based handler for focus stack (cross-window)
  const handleFocusStackCrossWindowClick = useCallback(async () => {
    if (!crossWindowDrag.isDragging || !crossWindowDrag.task) return;
    try {
      await getWidgetAPI().handleCrossWindowDrop({ zoneType: 'focus-stack' });
    } catch (error) {
      console.error('Cross-window focus stack click drop failed', error);
    }
  }, [crossWindowDrag]);
  
  const handleFocusStackDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (crossWindowDrag.isDragging || draggedTaskId) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setFocusStackDropActive(true);
      }
    },
    [crossWindowDrag.isDragging, draggedTaskId]
  );
  
  const handleFocusStackDragLeave = useCallback(() => {
    setFocusStackDropActive(false);
  }, []);
  
  const handleRemoveFromFocusStack = useCallback(async (taskId: string) => {
    try {
      await getWidgetAPI().removeFromFocusStack(taskId);
    } catch (error) {
      console.error('Failed to remove from focus stack', error);
    }
  }, []);
  
  const handleClearFocusStack = useCallback(async () => {
    try {
      await getWidgetAPI().clearFocusStack();
    } catch (error) {
      console.error('Failed to clear focus stack', error);
    }
  }, []);

  const defaultTodoStatus = useMemo(() => {
    const lowerLookup = (value?: string) => value?.trim().toLowerCase() ?? '';

    const explicitTodo = statusOptions.find((opt) => {
      const name = lowerLookup(opt.name);
      return name === 'to-do' || name === 'todo' || name === 'to do';
    });
    if (explicitTodo) return explicitTodo.name;

    if (notionSettings?.statusPresets?.length) {
      const presetMatch = statusOptions.find((opt) =>
        notionSettings.statusPresets.some(
          (preset) => lowerLookup(preset) === lowerLookup(opt.name)
        )
      );
      if (presetMatch) return presetMatch.name;
    }

    return statusOptions[0]?.name ?? null;
  }, [statusOptions, notionSettings]);

  const [completedTaskId, setCompletedTaskId] = useState<string | null>(null);
  const hydrationRequests = useRef<Set<string>>(new Set());

  const handleCountdownComplete = useCallback((taskId: string) => {
    setCompletedTaskId(taskId);
    setTimeout(() => {
      setCompletedTaskId(null);
    }, 3000);
  }, []);

  const {
    startCountdown,
    stopCountdown,
    resumeCountdown,
    extendCountdown,
    getRemainingTime,
    getEndTime,
    formatTime,
    formatEndTime,
    isCountingDown
  } = useCountdownTimer(
    tasks,
    handleUpdateTaskStatus,
    handleCreateTimeLogEntry,
    defaultTodoStatus,
    handleCountdownComplete
  );

  const activeTaskIdSet = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((task) => {
      if (task.status === '⌚' || isCountingDown(task.id)) {
        set.add(task.id);
      }
    });
    return set;
  }, [tasks, isCountingDown]);

  const orderedTasks = useMemo(() => {
    const active = displayTasks.filter((task) => activeTaskIdSet.has(task.id));
    const rest = displayTasks.filter((task) => !activeTaskIdSet.has(task.id));
    const combined = [...active, ...rest];
    if (focusTaskId) {
      const target = combined.find((task) => task.id === focusTaskId);
      return target ? [target] : combined;
    }
    return combined;
  }, [displayTasks, activeTaskIdSet, focusTaskId]);

  useEffect(() => {
    if (focusTaskId && !tasks.some((task) => task.id === focusTaskId)) {
      setFocusTaskId(null);
    }
  }, [focusTaskId, tasks]);

  // Filtered and sorted projects
  const filteredProjects = useMemo(() => {
    let result = [...projects];
    
    // Filter by completion status
    if (!showCompletedProjects) {
      result = result.filter(p => {
        const status = p.status?.toLowerCase() || '';
        return !status.includes('done') && !status.includes('complete') && !status.includes('cancel');
      });
    }
    
    // Filter by status
    if (projectStatusFilter !== 'all') {
      result = result.filter(p => p.status === projectStatusFilter);
    }
    
    // Filter by search
    if (projectSearch.trim()) {
      const searchLower = projectSearch.toLowerCase();
      result = result.filter(p => 
        p.title?.toLowerCase().includes(searchLower) ||
        p.description?.toLowerCase().includes(searchLower)
      );
    }
    
    // Sort
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    result.sort((a, b) => {
      let comparison = 0;
      
      switch (projectSortBy) {
        case 'name':
          comparison = (a.title || '').localeCompare(b.title || '');
          break;
        case 'deadline':
          const aDate = a.endDate ? new Date(a.endDate).getTime() : Infinity;
          const bDate = b.endDate ? new Date(b.endDate).getTime() : Infinity;
          comparison = aDate - bDate;
          break;
        case 'progress': {
          const aTasks = tasks.filter(t => (t.projectIds ?? []).includes(a.id));
          const bTasks = tasks.filter(t => (t.projectIds ?? []).includes(b.id));
          const aProgress = aTasks.length > 0 ? aTasks.filter(t => t.normalizedStatus === 'complete').length / aTasks.length : 0;
          const bProgress = bTasks.length > 0 ? bTasks.filter(t => t.normalizedStatus === 'complete').length / bTasks.length : 0;
          comparison = aProgress - bProgress;
          break;
        }
        case 'status':
          comparison = (a.status || '').localeCompare(b.status || '');
          break;
      }
      
      return projectSortDir === 'asc' ? comparison : -comparison;
    });
    
    return result;
  }, [projects, tasks, projectSearch, projectStatusFilter, projectSortBy, projectSortDir, showCompletedProjects]);
  
  // Get unique project statuses for filter dropdown
  const projectStatuses = useMemo(() => {
    const statuses = new Set<string>();
    projects.forEach(p => {
      if (p.status) statuses.add(p.status);
    });
    return Array.from(statuses).sort();
  }, [projects]);

  useEffect(() => {
    if (focusTaskId) {
      setActiveWidget('tasks');
    }
  }, [focusTaskId]);

  const handleStopSession = useCallback(
    async (taskId: string) => {
      stopCountdown(taskId);
      await handleUpdateTaskStatus(taskId, { status: '📋' });
    },
    [stopCountdown, handleUpdateTaskStatus]
  );

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const targets = tasks.filter(
        (task) =>
          task.status === '⌚' &&
          !isCountingDown(task.id) &&
          !hydrationRequests.current.has(task.id)
      );
      await Promise.all(
        targets.map(async (task) => {
          hydrationRequests.current.add(task.id);
          try {
            const entry = await getWidgetAPI().getActiveTimeLogEntry(task.id);
            hydrationRequests.current.delete(task.id);
            if (cancelled || !entry) return;
            const startMs = entry.startTime
              ? Date.parse(entry.startTime)
              : Date.now();
            let endMs = entry.endTime ? Date.parse(entry.endTime) : undefined;
            if ((!endMs || Number.isNaN(endMs)) && entry.durationMinutes) {
              endMs = startMs + entry.durationMinutes * 60 * 1000;
            }
            if (!endMs || Number.isNaN(endMs) || endMs <= Date.now()) return;
            resumeCountdown(
              task.id,
              startMs,
              endMs,
              task.status ?? defaultTodoStatus
            );
          } catch (error) {
            hydrationRequests.current.delete(task.id);
            console.error('Failed to hydrate active session', error);
          }
        })
      );
    };
    hydrate();
    return () => {
      cancelled = true;
    };
  }, [tasks, isCountingDown, resumeCountdown, defaultTodoStatus]);

  const toggleOrganizerPanel = (panel: Exclude<OrganizerPanel, null>) => {
    setActiveOrganizerPanel((previous) =>
      previous === panel ? null : panel
    );
  };

  const filterSummaryParts: string[] = [];
  if (dayFilter === 'today') {
    filterSummaryParts.push('Due today');
  } else if (dayFilter === 'week') {
    filterSummaryParts.push('Due this week');
  }
  if (deadlineFilter === 'hard') {
    filterSummaryParts.push('Hard deadlines');
  }
  if (matrixFilter !== 'all') {
    const matrixLabel =
      MATRIX_FILTER_BUTTONS.find((option) => option.id === matrixFilter)
        ?.label ?? 'Priority';
    filterSummaryParts.push(matrixLabel);
  }
  if (statusFilter !== 'all') {
    const statusLabel =
      STATUS_FILTERS.find((option) => option.value === statusFilter)?.label ??
      'Status';
    filterSummaryParts.push(statusLabel);
  }
  const filterSummary = filterSummaryParts.length
    ? filterSummaryParts.join(' • ')
    : 'All tasks';
  const filtersPanelOpen = activeOrganizerPanel === 'filters';
  const filterTriggerHighlighted =
    filtersPanelOpen || filterSummaryParts.length > 0;
  const sortPanelOpen = activeOrganizerPanel === 'sort';
  const groupPanelOpen = activeOrganizerPanel === 'group';
  const organizerPanelOpen = activeOrganizerPanel !== null;
  const organizerPanelLabel =
    activeOrganizerPanel === 'sort'
      ? 'Task sorting controls'
      : activeOrganizerPanel === 'group'
        ? 'Task grouping controls'
        : 'Task filters';
  // Enable cross-window drag for all views with tasks - users can drag tasks to drop zones
  const taskDragEnabled = true;

  const handleMatrixUpdateTask = useCallback(
    async (taskId: string, updates: TaskUpdatePayload) => {
      await handleUpdateTask(taskId, updates);
    },
    [handleUpdateTask]
  );

  // Handle task selection from subviews - NO focus mode, just selection
  // Double-click should open pop-out instead
  const handleOpenTaskFromSubview = useCallback((taskId: string) => {
    // Don't trigger focus mode - just log selection for now
    // The actual selection is handled within each component
    console.log('[FullScreen] Task selected:', taskId);
  }, []);

  // Handler to open a project in full workspace mode
  const handleOpenProjectWorkspace = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setProjectWorkspaceMode(true);
    console.log('[FullScreen] Opening project workspace:', projectId);
  }, []);

  // Handler to close project workspace and return to projects list
  const handleCloseProjectWorkspace = useCallback(() => {
    setProjectWorkspaceMode(false);
    console.log('[FullScreen] Closing project workspace');
  }, []);
  const handleRefreshContacts = useCallback(async () => {
    setContactsRefreshing(true);
    try {
      const data = await getWidgetAPI().refreshContacts();
      setContacts(data);
      setContactsError(null);
    } catch (error) {
      setContactsError(
        error instanceof Error
          ? error.message
          : 'Unable to refresh contacts'
      );
    } finally {
      setContactsRefreshing(false);
    }
  }, []);
  const handleToggleContactsVisible = useCallback(() => {
    setContactsPanelVisible((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage?.setItem(
          WORKSPACE_CONTACTS_VISIBLE_KEY,
          String(next)
        );
      }
      return next;
    });
  }, []);
  const handleCopyContactValue = useCallback((value?: string | null) => {
    if (!value) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(value);
      }
    } catch (error) {
      console.warn('Unable to copy contact value', error);
    }
  }, []);
  const handleWorkspaceQuickAdd = useCallback(
    async (payload: NotionCreatePayload) => {
      if (!selectedProjectId) {
        await handleAddTask(payload);
        return;
      }
      const projectIds = new Set(payload.projectIds ?? []);
      projectIds.add(selectedProjectId);
      await handleAddTask({
        ...payload,
        projectIds: Array.from(projectIds)
      });
    },
    [handleAddTask, selectedProjectId]
  );

  // Helper to get week start (Sunday)
  const getWeekStart = (date: Date) => {
    const d = new Date(date);
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  };

  // Helper to get week end (Saturday)
  const getWeekEnd = (date: Date) => {
    const d = getWeekStart(date);
    d.setDate(d.getDate() + 6);
    return d;
  };


  // Get date range label for header
  const getCalendarRangeLabel = () => {
    if (calendarViewRange === 'day') {
      return calendarDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
    }
    if (calendarViewRange === 'week') {
      const weekStart = getWeekStart(calendarDate);
      const weekEnd = getWeekEnd(calendarDate);
      const startMonth = weekStart.toLocaleDateString('en-US', { month: 'short' });
      const endMonth = weekEnd.toLocaleDateString('en-US', { month: 'short' });
      if (startMonth === endMonth) {
        return `${startMonth} ${weekStart.getDate()} - ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;
      }
      return `${startMonth} ${weekStart.getDate()} - ${endMonth} ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;
    }
    if (calendarViewRange === 'custom') {
      const startDate = new Date(calendarDate);
      const endDate = new Date(calendarDate);
      endDate.setDate(endDate.getDate() + calendarCustomDays - 1);
      const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
      const endMonth = endDate.toLocaleDateString('en-US', { month: 'short' });
      if (startMonth === endMonth) {
        return `${startMonth} ${startDate.getDate()} - ${endDate.getDate()}, ${endDate.getFullYear()}`;
      }
      return `${startMonth} ${startDate.getDate()} - ${endMonth} ${endDate.getDate()}, ${endDate.getFullYear()}`;
    }
    if (calendarViewRange === 'list') {
      const startDate = new Date(calendarDate);
      const endDate = new Date(calendarDate);
      endDate.setDate(endDate.getDate() + calendarListDays - 1);
      const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
      const endMonth = endDate.toLocaleDateString('en-US', { month: 'short' });
      if (startMonth === endMonth) {
        return `${startMonth} ${startDate.getDate()} - ${endDate.getDate()}, ${endDate.getFullYear()}`;
      }
      return `${startMonth} ${startDate.getDate()} - ${endMonth} ${endDate.getDate()}, ${endDate.getFullYear()}`;
    }
    return calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  // Render full calendar grid (main view)
  // Search icon for the toolbar
  const SearchIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
  const [searchExpanded, setSearchExpanded] = useState(false);

  // Render organizer toolbar (filter/sort/group/search buttons) - reusable across views
  const renderOrganizerToolbar = (variant: 'compact' | 'full' = 'full', hideSearch = false) => (
    <div className={`widget-toolbar ${variant === 'compact' ? 'is-compact' : ''}`}>
              <div className="task-organizer">
                <OrganizerIconButton
                  label="Filters"
                  icon={<FilterIcon />}
                  pressed={filtersPanelOpen}
                  highlighted={filterTriggerHighlighted}
                  onClick={() => toggleOrganizerPanel('filters')}
                  ariaControls="task-organizer-panel"
                  title={filterSummary}
                />
              </div>
              <SortButton
                sortRules={sortRules}
                isOpen={sortPanelOpen}
                onToggle={() => toggleOrganizerPanel('sort')}
                ariaControls="task-organizer-panel"
              />
              <GroupButton
                grouping={grouping}
                isOpen={groupPanelOpen}
                onToggle={() => toggleOrganizerPanel('group')}
                ariaControls="task-organizer-panel"
              />
      {!hideSearch && (
        <div className="task-organizer">
          <OrganizerIconButton
            label="Search"
            icon={<SearchIcon />}
            pressed={searchExpanded}
            highlighted={searchExpanded || Boolean(searchQuery)}
            onClick={() => setSearchExpanded((prev) => !prev)}
            ariaControls="fullscreen-search-panel"
            title={searchQuery ? `Search: "${searchQuery}"` : 'Search tasks'}
          />
        </div>
      )}
      {variant === 'full' && !searchQuery && filterSummaryParts.length > 0 && (
                <span className="filter-summary-text" title={filterSummary}>
                  {filterSummary}
                </span>
              )}
            </div>
  );

  // Render organizer panels (filter/sort/group dropdowns) - reusable across views
  const renderOrganizerPanels = () => (
    <>
                {filtersPanelOpen && (
        <div className="task-organizer-pane sidebar-organizer-pane compact-filters">
                    <div className="task-organizer-section">
            {/* Compact single-row filter layout */}
            <div className="filter-row-compact">
                          <div
                            className="widget-switch task-filter-switch day-filter-switch"
                            role="group"
                            aria-label="Day filter"
                          >
                            <button
                              type="button"
                              data-day="all"
                              className={dayFilter === 'all' ? 'active' : ''}
                              aria-pressed={dayFilter === 'all'}
                              onClick={() => setDayFilter('all')}
                            >
                              All
                            </button>
                            <button
                              type="button"
                              data-day="today"
                              className={dayFilter === 'today' ? 'active' : ''}
                              aria-pressed={dayFilter === 'today'}
                              onClick={() => setDayFilter('today')}
                            >
                              Today
                            </button>
                            <button
                              type="button"
                              data-day="week"
                              className={dayFilter === 'week' ? 'active' : ''}
                              aria-pressed={dayFilter === 'week'}
                              onClick={() => setDayFilter('week')}
                            >
                              Week
                            </button>
                          </div>
              
                          <div
                            className="widget-switch task-filter-switch status-switch"
                            role="group"
                            aria-label="Status filter"
                          >
                            {STATUS_FILTER_BUTTONS.map((option) => {
                              const isActive = statusFilter === option.value;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  data-status={toFilterSlug(option.value)}
                                  className={isActive ? 'active' : ''}
                                  aria-pressed={isActive}
                                  onClick={() =>
                                    setStatusFilter((prev) =>
                                      prev === option.value ? 'all' : option.value
                                    )
                                  }
                                  title={option.label}
                                  aria-label={option.label}
                                >
                                  {option.emoji ?? option.label}
                                </button>
                              );
                            })}
                          </div>
              
                          <div
                            className="widget-switch task-filter-switch deadline-filter-switch"
                            role="group"
                            aria-label="Deadline filter"
                          >
                            <button
                              type="button"
                              data-deadline="all"
                              className={deadlineFilter === 'all' ? 'active' : ''}
                              aria-pressed={deadlineFilter === 'all'}
                              onClick={() => setDeadlineFilter('all')}
                            >
                              All
                            </button>
                            <button
                              type="button"
                              data-deadline="hard"
                              className={deadlineFilter === 'hard' ? 'active' : ''}
                              aria-pressed={deadlineFilter === 'hard'}
                              onClick={() => setDeadlineFilter('hard')}
                            >
                              Hard only
                            </button>
                          </div>
              
                          <div
                            className="widget-switch task-filter-switch matrix-switch"
                            role="group"
                            aria-label="Matrix filter"
                          >
                            {MATRIX_FILTER_BUTTONS.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                data-matrix={toFilterSlug(option.id)}
                    className={matrixFilter === option.id ? 'active' : ''}
                                aria-pressed={matrixFilter === option.id}
                                onClick={() => setMatrixFilter(option.id)}
                                title={option.description}
                                aria-label={option.description}
                              >
                                {option.label}
                              </button>
                            ))}
                        </div>
                      </div>
                      <div className="task-organizer-section-footer">
                        <span className="task-organizer-section-meta">
                          {filterSummary}
                        </span>
                          <button
                            type="button"
                            className="task-organizer-close"
                            onClick={() => setActiveOrganizerPanel(null)}
                aria-label="Close filters"
                          >
                ✕
                          </button>
                      </div>
                    </div>
                  </div>
                )}
      {sortPanelOpen && (
        <div className="task-organizer-pane sidebar-organizer-pane">
                <SortPanel
                  sortRules={sortRules}
                  onSortRulesChange={setSortRules}
                  onClose={() => setActiveOrganizerPanel(null)}
                />
              </div>
            )}
      {groupPanelOpen && (
        <div className="task-organizer-pane sidebar-organizer-pane">
                <GroupPanel
                  grouping={grouping}
                  onGroupingChange={setGrouping}
                  onClose={() => setActiveOrganizerPanel(null)}
                />
              </div>
            )}
    </>
  );

  // Render search input for sidebars
  const renderSearchInput = () => (
    <div className="sidebar-search-bar">
      <SearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search tasks…"
      />
      {searchQuery && (
        <span className={`search-results-count ${orderedTasks.length > 0 ? 'has-results' : 'no-results'}`}>
          {orderedTasks.length}
        </span>
      )}
    </div>
  );

  // Handle project sidebar resize
  const handleStartProjectSidebarResize = (event: ReactPointerEvent) => {
    event.preventDefault();
    setActiveResize({
      type: 'split',
      startX: event.clientX,
      startWidth: projectSidebarWidth,
      orientation: 'left'
    });
  };

  // Render projects sidebar for filtering tasks by project
  const renderProjectsSidebar = () => {
    if (!projectSidebarOpen) return null;
    
    return (
      <>
        <aside
          className="projects-filter-sidebar"
          style={{ width: `${projectSidebarWidth}px` }}
        >
          <div className="projects-sidebar-header">
            <h3>📁 Projects</h3>
            <button
              type="button"
              className="icon-button"
              onClick={loadProjectsFromCache}
              title="Refresh projects"
            >
              ⟳
            </button>
          </div>
          <div className="projects-sidebar-content">
            {projectsLoading ? (
              <div className="panel muted">Loading projects…</div>
            ) : projects.length === 0 ? (
              <div className="panel muted">No projects found.</div>
            ) : (
              <ul className="projects-filter-list">
                <li
                  className={`projects-filter-item ${selectedProjectId === null ? 'active' : ''}`}
                  onClick={() => setSelectedProjectId(null)}
                >
                  <span className="project-icon">📋</span>
                  <span className="project-title">All Tasks</span>
                  <span className="project-count">{tasks.length}</span>
                </li>
                {projects.map((project) => (
                  <li
                    key={project.id}
                    className={`projects-filter-item ${selectedProjectId === project.id ? 'active' : ''}`}
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    <span className="project-icon">📁</span>
                    <span className="project-title">{project.title || 'Untitled'}</span>
                    {project.status && (
                      <span className="project-status">{project.status}</span>
                    )}
                    <span className="project-count">
                      {projectTaskCounts.get(project.id) ?? 0}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* Kanban shortcut when project is selected */}
          {selectedProjectId && (
            <div className="projects-sidebar-footer">
              <button
                type="button"
                className="kanban-shortcut-btn"
                onClick={() => setProjectSubView('kanban')}
                title="Open Kanban board for this project"
              >
                ▥ Open Kanban Board
              </button>
            </div>
          )}
        </aside>
        <div
          className={`projects-sidebar-resizer ${activeResize?.type === 'split' ? 'is-active' : ''}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize projects sidebar"
          onPointerDown={handleStartProjectSidebarResize}
          onDoubleClick={() => setProjectSidebarWidth(240)}
        />
      </>
    );
  };

  // Calculate normalized widths for active panels
  const normalizedPanelWidths = useMemo(() => {
    const activeTotal = activePanels.reduce((sum, p) => sum + panelWidths[p], 0);
    const normalized: Record<TaskPanel, number> = { list: 0, matrix: 0, kanban: 0, calendar: 0 };
    activePanels.forEach(p => {
      normalized[p] = (panelWidths[p] / activeTotal) * 100;
    });
    return normalized;
  }, [activePanels, panelWidths]);
  const normalizedWorkspacePanelWidths = useMemo(() => {
    const activeTotal = activeWorkspacePanels.reduce(
      (sum, panel) => sum + workspacePanelWidths[panel],
      0
    );
    const normalized: Record<TaskPanel, number> = {
      list: 0,
      matrix: 0,
      kanban: 0,
      calendar: 0
    };
    activeWorkspacePanels.forEach((panel) => {
      normalized[panel] =
        activeTotal > 0
          ? (workspacePanelWidths[panel] / activeTotal) * 100
          : 0;
    });
    return normalized;
  }, [activeWorkspacePanels, workspacePanelWidths]);
  
  // Render a single task panel (list, matrix, or kanban)
  const renderTaskPanel = (panel: TaskPanel) => {
    // Only apply project filter when the sidebar is visible
    const effectiveProjectId = projectSidebarOpen ? selectedProjectId : null;
    const filteredTasks = effectiveProjectId 
      ? orderedTasks.filter(t => (t.projectIds ?? []).includes(effectiveProjectId))
      : orderedTasks;
    const config = PANEL_CONFIG[panel];
    // Use flex-grow instead of width to properly handle resizer space
    const panelStyle = activePanels.length > 1 
      ? { flex: `${normalizedPanelWidths[panel]} 0 0`, '--panel-color': config.color } as React.CSSProperties
      : { flex: 1, '--panel-color': config.color } as React.CSSProperties;
    
    switch (panel) {
      case 'list':
        return (
          <div key="list" className="dashboard-panel panel-list" style={panelStyle}>
            <div className="dashboard-panel-body">
            <TaskList
                tasks={filteredTasks}
              loading={loading}
              error={error}
              statusOptions={statusOptions}
              manualStatuses={manualStatuses}
              completedStatus={notionSettings?.completedStatus}
              onUpdateTask={handleUpdateTask}
              emptyMessage={filterEmptyMessage}
              grouping={visibleGrouping}
              groups={visibleGroups}
                sortHold={sortHold}
                holdDuration={SORT_HOLD_DURATION}
                onPopOutTask={
                  canUseWindowControls
                    ? (task) => { void handlePopOutTask(task.id); }
                    : undefined
                }
                getRemainingTime={getRemainingTime}
                getEndTime={getEndTime}
                formatTime={formatTime}
                formatEndTime={formatEndTime}
                isCountingDown={isCountingDown}
                startCountdown={startCountdown}
                extendCountdown={extendCountdown}
                onStopSession={handleStopSession}
                scrollContainerRef={taskListScrollRef}
                onScrollToCenter={scrollToCenterTaskElement}
                onFocusTask={setFocusTaskId}
                focusTaskId={focusTaskId}
                isFocusMode={isFocusMode}
                enableExternalDrag={taskDragEnabled}
                onTaskDragStart={taskDragEnabled ? handleExternalTaskDragStart : undefined}
                onTaskDragEnd={taskDragEnabled ? handleExternalTaskDragEnd : undefined}
                projects={projects}
              />
            </div>
          </div>
        );
      
      case 'matrix':
        return (
          <div key="matrix" className="dashboard-panel panel-matrix" style={panelStyle}>
            <div className="dashboard-panel-body">
              <EisenhowerMatrix
                tasks={effectiveProjectId 
                  ? tasks.filter(t => (t.projectIds ?? []).includes(effectiveProjectId))
                  : tasks
                }
                projects={projects}
                completedStatus={notionSettings?.completedStatus}
                selectedProjectId={effectiveProjectId}
                onSelectProject={setSelectedProjectId}
                onUpdateTask={handleMatrixUpdateTask}
                onAddTask={handleAddTask}
                onSelectTask={handleOpenTaskFromSubview}
                onPopOutTask={canUseWindowControls ? (task) => { void handlePopOutTask(task.id); } : undefined}
              />
            </div>
          </div>
        );
      
      case 'kanban':
        return (
          <div key="kanban" className="dashboard-panel panel-kanban" style={panelStyle}>
            <div className="dashboard-panel-body">
              <KanbanBoard
                tasks={effectiveProjectId 
                  ? tasks.filter(t => (t.projectIds ?? []).includes(effectiveProjectId))
                  : tasks
                }
                statusOptions={statusOptions}
                projects={projects}
                completedStatus={notionSettings?.completedStatus}
                project={effectiveProjectId ? projects.find(p => p.id === effectiveProjectId) : null}
                onUpdateTask={handleUpdateTask}
                onAddTask={handleAddTask}
                onSelectTask={handleOpenTaskFromSubview}
                onPopOutTask={canUseWindowControls ? (task) => { void handlePopOutTask(task.id); } : undefined}
                hideToolbar
              />
            </div>
          </div>
        );
      
      case 'calendar':
        return (
          <div key="calendar" className="dashboard-panel panel-calendar" style={panelStyle}>
            <div className="dashboard-panel-body panel-calendar-body">
              <div className="panel-calendar-controls">
                <div className="panel-calendar-nav-inline">
                  <button
                    type="button"
                    onClick={() => setCalendarDate(prev => {
                      const d = new Date(prev);
                      if (panelCalendarView === 'month') {
                        d.setMonth(d.getMonth() - 1);
                      } else if (panelCalendarView === 'week') {
                        d.setDate(d.getDate() - 7);
                      } else {
                        d.setDate(d.getDate() - panelCalendarDays);
                      }
                      return d;
                    })}
                  >
                    ◀
                  </button>
                  <span className="panel-calendar-month">
                    {panelCalendarView === 'month' 
                      ? calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                      : panelCalendarView === 'week'
                        ? `Week of ${calendarDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                        : `${calendarDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${panelCalendarDays}d`
                    }
                  </span>
                  <button
                    type="button"
                    onClick={() => setCalendarDate(prev => {
                      const d = new Date(prev);
                      if (panelCalendarView === 'month') {
                        d.setMonth(d.getMonth() + 1);
                      } else if (panelCalendarView === 'week') {
                        d.setDate(d.getDate() + 7);
                      } else {
                        d.setDate(d.getDate() + panelCalendarDays);
                      }
                      return d;
                    })}
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    className="panel-calendar-today"
                    onClick={() => setCalendarDate(new Date())}
                  >
                    Today
                  </button>
                </div>
                <div className="panel-calendar-view-toggle">
                  <button
                    type="button"
                    className={panelCalendarView === 'month' ? 'active' : ''}
                    onClick={() => setPanelCalendarView('month')}
                  >
                    Month
                  </button>
                  <button
                    type="button"
                    className={panelCalendarView === 'week' ? 'active' : ''}
                    onClick={() => setPanelCalendarView('week')}
                  >
                    Week
                  </button>
                  <div className="panel-calendar-custom-toggle">
                    <button
                      type="button"
                      className={panelCalendarView === 'custom' ? 'active' : ''}
                      onClick={() => setPanelCalendarView('custom')}
                    >
                      {panelCalendarDays}d
                    </button>
                    {panelCalendarView === 'custom' && (
                      <input
                        type="range"
                        min="1"
                        max="6"
                        value={panelCalendarDays}
                        onChange={(e) => setPanelCalendarDays(parseInt(e.target.value, 10))}
                        className="panel-calendar-days-slider"
                        title={`${panelCalendarDays} days`}
                      />
                    )}
                  </div>
                </div>
              </div>
              {renderSimpleCalendarGrid(filteredTasks)}
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  const renderWorkspacePanel = (panel: TaskPanel, projectTasks: Task[]) => {
    const config = PANEL_CONFIG[panel];
    const normalizedWidth =
      normalizedWorkspacePanelWidths[panel] ||
      (activeWorkspacePanels.length
        ? 100 / activeWorkspacePanels.length
        : 100);
    const panelStyle =
      activeWorkspacePanels.length > 1
        ? ({ flex: `${normalizedWidth} 0 0`, '--panel-color': config.color } as React.CSSProperties)
        : ({ flex: 1, '--panel-color': config.color } as React.CSSProperties);

    switch (panel) {
      case 'list':
        return (
          <section
            key={`workspace-${panel}`}
            className="dashboard-panel panel-list"
            style={panelStyle}
          >
            <div className="dashboard-panel-body">
              <TaskList
                tasks={projectTasks}
                loading={loading}
                error={error}
                statusOptions={statusOptions}
                manualStatuses={manualStatuses}
                completedStatus={notionSettings?.completedStatus}
                onUpdateTask={handleUpdateTask}
                grouping="none"
                sortHold={sortHold}
                holdDuration={SORT_HOLD_DURATION}
                onPopOutTask={
                  canUseWindowControls
                    ? (task) => {
                        void handlePopOutTask(task.id);
                      }
                    : undefined
                }
                onSelectTask={handleOpenTaskFromSubview}
                onFocusTask={setFocusTaskId}
                focusTaskId={focusTaskId}
                isFocusMode={isFocusMode}
                enableExternalDrag={taskDragEnabled}
                onTaskDragStart={
                  taskDragEnabled ? handleExternalTaskDragStart : undefined
                }
                onTaskDragEnd={
                  taskDragEnabled ? handleExternalTaskDragEnd : undefined
                }
                projects={projects}
              />
            </div>
          </section>
        );
      case 'matrix':
        return (
          <section
            key={`workspace-${panel}`}
            className="dashboard-panel panel-matrix"
            style={panelStyle}
          >
            <div className="dashboard-panel-body">
              <EisenhowerMatrix
                tasks={projectTasks}
                projects={projects}
                completedStatus={notionSettings?.completedStatus}
                onUpdateTask={handleUpdateTask}
                onSelectTask={handleOpenTaskFromSubview}
                onPopOutTask={
                  canUseWindowControls
                    ? (task) => {
                        void handlePopOutTask(task.id);
                      }
                    : undefined
                }
              />
            </div>
          </section>
        );
      case 'kanban':
        return (
          <section
            key={`workspace-${panel}`}
            className="dashboard-panel panel-kanban"
            style={panelStyle}
          >
            <div className="dashboard-panel-body">
              <KanbanBoard
                tasks={projectTasks}
                statusOptions={statusOptions}
                projects={projects}
                completedStatus={notionSettings?.completedStatus}
                onUpdateTask={handleUpdateTask}
                onSelectTask={handleOpenTaskFromSubview}
                onPopOutTask={
                  canUseWindowControls
                    ? (task) => {
                        void handlePopOutTask(task.id);
                      }
                    : undefined
                }
                hideToolbar
              />
            </div>
          </section>
        );
      case 'calendar':
        return (
          <section
            key={`workspace-${panel}`}
            className="dashboard-panel panel-calendar"
            style={panelStyle}
          >
            <div className="dashboard-panel-body panel-calendar-body">
              <div className="panel-calendar-controls">
                <div className="panel-calendar-nav-inline">
                  <button
                    type="button"
                    onClick={() =>
                      setCalendarDate((prev) => {
                        const d = new Date(prev);
                        if (panelCalendarView === 'month') {
                          d.setMonth(d.getMonth() - 1);
                        } else if (panelCalendarView === 'week') {
                          d.setDate(d.getDate() - 7);
                        } else {
                          d.setDate(d.getDate() - panelCalendarDays);
                        }
                        return d;
                      })
                    }
                  >
                    ◀
                  </button>
                  <span className="panel-calendar-month">
                    {panelCalendarView === 'month' 
                      ? calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                      : panelCalendarView === 'week'
                        ? `Week of ${calendarDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                        : `${calendarDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${panelCalendarDays}d`
                    }
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setCalendarDate((prev) => {
                        const d = new Date(prev);
                        if (panelCalendarView === 'month') {
                          d.setMonth(d.getMonth() + 1);
                        } else if (panelCalendarView === 'week') {
                          d.setDate(d.getDate() + 7);
                        } else {
                          d.setDate(d.getDate() + panelCalendarDays);
                        }
                        return d;
                      })
                    }
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    className="panel-calendar-today"
                    onClick={() => setCalendarDate(new Date())}
                  >
                    Today
                  </button>
                </div>
                <div className="panel-calendar-view-toggle">
                  <button
                    type="button"
                    className={panelCalendarView === 'month' ? 'active' : ''}
                    onClick={() => setPanelCalendarView('month')}
                  >
                    Month
                  </button>
                  <button
                    type="button"
                    className={panelCalendarView === 'week' ? 'active' : ''}
                    onClick={() => setPanelCalendarView('week')}
                  >
                    Week
                  </button>
                  <div className="panel-calendar-custom-toggle">
                    <button
                      type="button"
                      className={panelCalendarView === 'custom' ? 'active' : ''}
                      onClick={() => setPanelCalendarView('custom')}
                    >
                      {panelCalendarDays}d
                    </button>
                    {panelCalendarView === 'custom' && (
                      <input
                        type="range"
                        min="1"
                        max="6"
                        value={panelCalendarDays}
                        onChange={(e) => setPanelCalendarDays(parseInt(e.target.value, 10))}
                        className="panel-calendar-days-slider"
                        title={`${panelCalendarDays} days`}
                      />
                    )}
                  </div>
                </div>
              </div>
              {renderSimpleCalendarGrid(projectTasks)}
            </div>
          </section>
        );
      default:
        return null;
    }
  };
  
  // Simple calendar grid for the calendar panel
  const renderSimpleCalendarGrid = (tasksToShow: Task[]) => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Group tasks by date
    const tasksByDate = new Map<string, Task[]>();
    tasksToShow.forEach(task => {
      if (task.dueDate) {
        const dateKey = task.dueDate.slice(0, 10);
        const existing = tasksByDate.get(dateKey) ?? [];
        existing.push(task);
        tasksByDate.set(dateKey, existing);
      }
    });

    // Generate days based on view mode
    const getDaysForView = (): Date[] => {
      if (panelCalendarView === 'week') {
        // Get the week containing the current date (Sunday start)
        const weekStart = new Date(calendarDate);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const days: Date[] = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(weekStart);
          d.setDate(d.getDate() + i);
          days.push(d);
        }
        return days;
      }
      
      if (panelCalendarView === 'custom') {
        // Show panelCalendarDays starting from calendarDate
        const days: Date[] = [];
        for (let i = 0; i < panelCalendarDays; i++) {
          const d = new Date(calendarDate);
          d.setDate(d.getDate() + i);
          days.push(d);
        }
        return days;
      }
      
      // Month view - return empty, we'll use the weeks array
      return [];
    };

    // For week and custom views
    if (panelCalendarView === 'week' || panelCalendarView === 'custom') {
      const days = getDaysForView();
      const maxTasksPerDay = panelCalendarView === 'week' ? 6 : (panelCalendarDays <= 3 ? 10 : 6);
      
      return (
        <div className={`simple-calendar-grid view-${panelCalendarView}`} style={panelCalendarView === 'custom' ? { '--panel-days': panelCalendarDays } as React.CSSProperties : undefined}>
          <div className="simple-calendar-header">
            {days.map(date => (
              <div key={date.toISOString()} className="simple-calendar-day-name">
                {date.toLocaleDateString('en-US', { weekday: panelCalendarDays > 4 ? 'narrow' : 'short' })}
              </div>
            ))}
          </div>
          <div className="simple-calendar-row-view">
            {days.map(date => {
              const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
              const dayTasks = tasksByDate.get(dateKey) ?? [];
              const isToday = date.getTime() === today.getTime();
              const isPast = date < today;
              
              return (
                <div
                  key={dateKey}
                  className={`simple-calendar-day ${isToday ? 'is-today' : ''} ${isPast ? 'is-past' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('drop-zone-active');
                    const taskId = e.dataTransfer.getData('application/x-task-id');
                    if (taskId && handleUpdateTask) {
                      await handleUpdateTask(taskId, { dueDate: dateKey });
                      return;
                    }
                    const newTaskData = e.dataTransfer.getData('application/x-new-task');
                    if (newTaskData) {
                      try {
                        const payload = JSON.parse(newTaskData);
                        payload.date = dateKey;
                        await handleAddTask(payload);
                        setQuickAddCollapsed(true);
                      } catch (err) {
                        console.error('Failed to create task:', err);
                      }
                    }
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add('drop-zone-active');
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.classList.remove('drop-zone-active');
                  }}
                >
                  <div className="simple-calendar-day-number">{date.getDate()}</div>
                  <div className="simple-calendar-day-tasks">
                    {dayTasks.slice(0, maxTasksPerDay).map(task => {
                      const isComplete = task.status === notionSettings?.completedStatus;
                      const priorityClass = task.urgent && task.important ? 'priority-do-now' 
                        : task.important ? 'priority-schedule'
                        : task.urgent ? 'priority-delegate' 
                        : 'priority-eliminate';
                      
                      return (
                        <div
                          key={task.id}
                          className={`simple-calendar-task ${isComplete ? 'is-complete' : ''} ${task.hardDeadline ? 'has-hard-deadline' : ''}`}
                          onClick={(e) => {
                            e.currentTarget.classList.add('is-clicked');
                            setTimeout(() => e.currentTarget.classList.remove('is-clicked'), 200);
                          }}
                          onDoubleClick={() => {
                            if (canUseWindowControls) {
                              void handlePopOutTask(task.id);
                            }
                          }}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('application/x-task-id', task.id);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                        >
                          <span className={`simple-calendar-task-dot ${priorityClass}`} />
                          {task.hardDeadline && <span className="simple-calendar-task-hard">!</span>}
                          <span className="simple-calendar-task-title">{task.title}</span>
                        </div>
                      );
                    })}
                    {dayTasks.length > maxTasksPerDay && (
                      <div className="simple-calendar-more">+{dayTasks.length - maxTasksPerDay}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    
    // Month view (original logic)
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    
    const weeks: Date[][] = [];
    let currentWeek: Date[] = [];
    
    // Fill in leading empty days
    for (let i = 0; i < startOffset; i++) {
      const d = new Date(year, month, 1 - (startOffset - i));
      currentWeek.push(d);
    }
    
    // Fill in days of month
    for (let day = 1; day <= daysInMonth; day++) {
      currentWeek.push(new Date(year, month, day));
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }
    
    // Fill in trailing days
    if (currentWeek.length > 0) {
      let nextDay = 1;
      while (currentWeek.length < 7) {
        currentWeek.push(new Date(year, month + 1, nextDay++));
      }
      weeks.push(currentWeek);
    }
    
    return (
      <div className="simple-calendar-grid view-month">
        <div className="simple-calendar-header">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="simple-calendar-day-name">{day}</div>
          ))}
        </div>
        <div className="simple-calendar-weeks">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="simple-calendar-week">
              {week.map(date => {
                const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                const dayTasks = tasksByDate.get(dateKey) ?? [];
                const isToday = date.getTime() === today.getTime();
                const isCurrentMonth = date.getMonth() === month;
                const isPast = date < today;
                
                return (
                  <div
                    key={dateKey}
                    className={`simple-calendar-day ${isToday ? 'is-today' : ''} ${!isCurrentMonth ? 'other-month' : ''} ${isPast ? 'is-past' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('drop-zone-active');
                      // Handle existing task drop
                      const taskId = e.dataTransfer.getData('application/x-task-id');
                      if (taskId && handleUpdateTask) {
                        await handleUpdateTask(taskId, { dueDate: dateKey });
                        return;
                      }
                      // Handle new task drop
                      const newTaskData = e.dataTransfer.getData('application/x-new-task');
                      if (newTaskData) {
                        try {
                          const payload = JSON.parse(newTaskData);
                          payload.date = dateKey;
                          await handleAddTask(payload);
                          setQuickAddCollapsed(true);
                        } catch (err) {
                          console.error('Failed to create task:', err);
                        }
                      }
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.add('drop-zone-active');
                    }}
                    onDragLeave={(e) => {
                      e.currentTarget.classList.remove('drop-zone-active');
                    }}
                  >
                    <div className="simple-calendar-day-number">{date.getDate()}</div>
                    <div className="simple-calendar-day-tasks">
                      {dayTasks.slice(0, 3).map(task => {
                        const isComplete = task.status === notionSettings?.completedStatus;
                        const priorityClass = task.urgent && task.important ? 'priority-do-now' 
                          : task.important ? 'priority-schedule'
                          : task.urgent ? 'priority-delegate' 
                          : 'priority-eliminate';
                        const priorityLabel = task.urgent && task.important ? '🔥 Do Now' :
                          task.important ? '📅 Schedule' :
                          task.urgent ? '👥 Delegate' : '📋 Low Priority';
                        const tooltipLines = [
                          `📝 ${task.title}`,
                          `━━━━━━━━━━━━━━━`,
                          task.status ? `Status: ${task.status}` : '',
                          `Priority: ${priorityLabel}`,
                          task.hardDeadline ? '⚠️ Hard Deadline' : '',
                          `━━━━━━━━━━━━━━━`,
                          'Click to select • Double-click to open',
                        ].filter(Boolean).join('\n');
                        
                        return (
                          <div
                            key={task.id}
                            className={`simple-calendar-task ${isComplete ? 'is-complete' : ''} ${task.hardDeadline ? 'has-hard-deadline' : ''}`}
                            onClick={(e) => {
                              // Single click - just visual feedback, no focus mode
                              e.currentTarget.classList.add('is-clicked');
                              setTimeout(() => e.currentTarget.classList.remove('is-clicked'), 200);
                            }}
                            onDoubleClick={() => {
                              // Double click opens pop-out
                              if (canUseWindowControls) {
                                void handlePopOutTask(task.id);
                              }
                            }}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('application/x-task-id', task.id);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            data-tooltip={tooltipLines}
                          >
                            <span className={`simple-calendar-task-dot ${priorityClass}`} />
                            {task.hardDeadline && <span className="simple-calendar-task-hard">!</span>}
                            <span className="simple-calendar-task-title">{task.title}</span>
                          </div>
                        );
                      })}
                      {dayTasks.length > 3 && (
                        <div className="simple-calendar-more">+{dayTasks.length - 3} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderFullCalendarGrid = () => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const todayStr = new Date().toISOString().split('T')[0];
    const selectedStr = calendarDate.toISOString().split('T')[0];
    
    // Helper to check if a date string matches a day
    const matchesDate = (dateStr: string | null | undefined, targetDateStr: string) => {
      if (!dateStr) return false;
      return dateStr.startsWith(targetDateStr);
    };
    
    // Get projects with deadlines
    const projectsWithDeadlines = projects.filter(p => p.endDate);

    // Get calendar days based on view range
    const getDaysToRender = () => {
      if (calendarViewRange === 'day') {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(calendarDate.getDate()).padStart(2, '0')}`;
        return [{ date: new Date(calendarDate), dateStr, isCurrentMonth: true }];
      }

      if (calendarViewRange === 'week') {
        const weekStart = getWeekStart(calendarDate);
        const days = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(weekStart);
          d.setDate(d.getDate() + i);
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          days.push({ date: d, dateStr, isCurrentMonth: d.getMonth() === month });
        }
        return days;
      }

      if (calendarViewRange === 'list') {
        const days = [];
        for (let i = 0; i < calendarListDays; i++) {
          const d = new Date(calendarDate);
          d.setDate(d.getDate() + i);
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          days.push({ date: d, dateStr, isCurrentMonth: d.getMonth() === month });
        }
        return days;
      }

      if (calendarViewRange === 'custom') {
        const days = [];
        for (let i = 0; i < calendarCustomDays; i++) {
          const d = new Date(calendarDate);
          d.setDate(d.getDate() + i);
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          days.push({ date: d, dateStr, isCurrentMonth: d.getMonth() === month });
        }
        return days;
      }

      // Month view - include days from prev/next month to fill grid
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const daysInPrevMonth = new Date(year, month, 0).getDate();
      const days = [];

      // Previous month days
      for (let i = firstDay - 1; i >= 0; i--) {
        const d = new Date(year, month - 1, daysInPrevMonth - i);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        days.push({ date: d, dateStr, isCurrentMonth: false });
      }

      // Current month days
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(year, month, day);
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        days.push({ date: d, dateStr, isCurrentMonth: true });
      }

      // Next month days to fill remaining cells (6 rows * 7 days = 42)
      const remaining = 42 - days.length;
      for (let i = 1; i <= remaining; i++) {
        const d = new Date(year, month + 1, i);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        days.push({ date: d, dateStr, isCurrentMonth: false });
      }

      return days;
    };

    const daysToRender = getDaysToRender();
    // List view shows all tasks, other views have limits
    const maxTasksPerDay = calendarViewRange === 'list' ? Infinity :
                          calendarViewRange === 'month' ? 4 : 
                          calendarViewRange === 'custom' ? (calendarCustomDays <= 4 ? 12 : calendarCustomDays <= 7 ? 8 : 6) : 10;
    const maxProjectsPerDay = calendarViewRange === 'list' ? Infinity :
                             calendarViewRange === 'month' ? 2 : 
                             calendarViewRange === 'custom' ? (calendarCustomDays <= 4 ? 6 : 4) : 5;
    

    // Determine if we should show the horizontal day header (not for day view or list view)
    const showHorizontalDayHeader = calendarViewRange !== 'day' && calendarViewRange !== 'list';
    // For custom view, show abbreviated day names if more than 7 days
    const dayHeaderLabels = calendarViewRange === 'custom' 
      ? daysToRender.map(d => d.date.toLocaleDateString('en-US', { weekday: calendarCustomDays > 7 ? 'narrow' : 'short' }))
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const gridStyles = calendarViewRange === 'custom' 
      ? { '--custom-days': calendarCustomDays } as React.CSSProperties 
      : calendarViewRange === 'list'
        ? { '--list-days': calendarListDays, '--list-columns': calendarListColumns } as React.CSSProperties
        : undefined;

    return (
      <div className={`calendar-full-grid ${calendarViewRange} ${calendarViewRange === 'list' && calendarListColumns === 2 ? 'list-2col' : ''}`} style={gridStyles}>
        {showHorizontalDayHeader && calendarViewRange !== 'custom' && (
          <div className="calendar-grid-header">
            {dayHeaderLabels.map((dayLabel, idx) => (
              <div key={idx} className="calendar-grid-day-header">
                {dayLabel}
              </div>
            ))}
          </div>
        )}
        <div 
          className={`calendar-grid-body ${calendarViewRange}`}
          onWheel={(e) => {
            // Smooth incremental scroll navigation for all views
            const direction = e.deltaY > 0 ? 1 : -1;
            const newDate = new Date(calendarDate);
            
            if (calendarViewRange === 'list') {
              // List view - regular scroll navigates by 1 day
              e.preventDefault();
              newDate.setDate(newDate.getDate() + direction);
              setCalendarDate(newDate);
            } else if (calendarViewRange === 'day') {
              // Day view - Shift+scroll navigates by 1 day
              if (e.shiftKey) {
                e.preventDefault();
                newDate.setDate(newDate.getDate() + direction);
                setCalendarDate(newDate);
              }
            } else if (calendarViewRange === 'week') {
              // Week view - Shift+scroll navigates by 1-2 days (smooth)
              if (e.shiftKey) {
                e.preventDefault();
                newDate.setDate(newDate.getDate() + direction * 2);
                setCalendarDate(newDate);
              }
            } else if (calendarViewRange === 'month') {
              // Month view - Shift+scroll navigates by ~3-4 days (smooth vertical feel)
              if (e.shiftKey) {
                e.preventDefault();
                newDate.setDate(newDate.getDate() + direction * 3);
                setCalendarDate(newDate);
              }
            } else if (calendarViewRange === 'custom') {
              // Custom view - Shift+scroll navigates by ~20-25% of the range
              if (e.shiftKey) {
                e.preventDefault();
                const increment = Math.max(1, Math.round(calendarCustomDays * 0.25));
                newDate.setDate(newDate.getDate() + direction * increment);
                setCalendarDate(newDate);
              }
            }
          }}
        >
          {/* Helper function to render a day cell */}
          {(() => {
            const renderDayCell = ({ date, dateStr, isCurrentMonth }: { date: Date; dateStr: string; isCurrentMonth: boolean }) => {
              const isToday = dateStr === todayStr;
              const isSelected = selectedStr === dateStr;
              const tasksOnDay = tasks.filter((t) => matchesDate(t.dueDate, dateStr));
              const projectDeadlinesOnDay = projectsWithDeadlines.filter((p) => matchesDate(p.endDate, dateStr));
              const isDropTarget = calendarDropTarget === dateStr;
              
              // Check if this day is in the past for overdue styling
              const dayDate = new Date(dateStr);
              dayDate.setHours(0, 0, 0, 0);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const isPastDay = dayDate < today;
              
              // Calculate visible items based on space (Infinity for list view = show all)
              const totalItems = tasksOnDay.length + projectDeadlinesOnDay.length;
              const visibleProjects = maxProjectsPerDay === Infinity ? projectDeadlinesOnDay : projectDeadlinesOnDay.slice(0, maxProjectsPerDay);
              const remainingTaskSlots = maxTasksPerDay === Infinity ? Infinity : Math.max(0, maxTasksPerDay - visibleProjects.length);
              const visibleTasks = remainingTaskSlots === Infinity ? tasksOnDay : tasksOnDay.slice(0, remainingTaskSlots);
              const hiddenCount = maxTasksPerDay === Infinity ? 0 : totalItems - visibleProjects.length - visibleTasks.length;

              return (
                <div
                  key={dateStr}
                  className={`calendar-grid-cell ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''} ${
                    isCurrentMonth ? '' : 'is-other-month'
                  } ${isDropTarget ? 'is-drop-target' : ''} ${crossWindowDrag.isDragging ? 'is-cross-window-target' : ''}`}
                  onClick={() => {
                    // Handle cross-window click drop first
                    if (crossWindowDrag.isDragging) {
                      void handleCalendarDayCrossWindowClick(dateStr);
                      return;
                    }
                    // In list view, don't navigate on click - only select for drop targets
                    if (calendarViewRange === 'list') {
                      return;
                    }
                    setCalendarDate(date);
                  }}
                  onDragOver={(event) => handleCalendarDayDragOver(event, dateStr)}
                  onDragLeave={() => handleCalendarDayDragLeave(dateStr)}
                  onDrop={(event) => handleCalendarDayDrop(event, dateStr)}
                >
                  <div className="calendar-cell-header">
                    <span className={`calendar-cell-date ${isToday ? 'today-badge' : ''}`}>
                      {calendarViewRange === 'day' ? (
                        date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
                      ) : calendarViewRange === 'list' ? (
                        date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                      ) : calendarViewRange === 'custom' ? (
                        date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                      ) : (
                        date.getDate()
                      )}
                    </span>
                    {totalItems > 0 && (calendarViewRange === 'month' || calendarViewRange === 'custom') && (
                      <div className="calendar-cell-counts">
                        {tasksOnDay.length > 0 && (
                          <span className="calendar-cell-count tasks-count">{tasksOnDay.length}</span>
                        )}
                        {projectDeadlinesOnDay.length > 0 && (
                          <span className="calendar-cell-count projects-count">{projectDeadlinesOnDay.length}📁</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="calendar-cell-content">
                    {/* Project Deadlines - shown first with distinct styling */}
                    {visibleProjects.map((project) => {
                      const projectTasks = tasks.filter(t => (t.projectIds ?? []).includes(project.id));
                      const completedTasks = projectTasks.filter(t => t.normalizedStatus === 'complete').length;
                      const totalTasks = projectTasks.length;
                      const isOverdue = isPastDay && project.status?.toLowerCase() !== 'done' && project.status?.toLowerCase() !== 'complete';
                      
                      return (
                        <div
                          key={`project-${project.id}`}
                          className={`calendar-project-chip ${isOverdue ? 'is-overdue' : ''}`}
                          title={`${project.title} - Deadline${isOverdue ? ' (OVERDUE)' : ''}\n${completedTasks}/${totalTasks} tasks complete`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedProjectId(project.id);
                            setProjectWorkspaceMode(true);
                            setViewMode('projects');
                          }}
                        >
                          <span className="calendar-project-icon">{project.emoji || '📁'}</span>
                          <span className="calendar-project-title">{project.title}</span>
                        {totalTasks > 0 && (
                          <span className="calendar-project-progress">{completedTasks}/{totalTasks}</span>
                        )}
                        {isOverdue && <span className="calendar-overdue-badge">!</span>}
                      </div>
                    );
                  })}
                  
                  {/* Tasks */}
                  {visibleTasks.map((task) => {
                    const isComplete = task.status === completedStatus;
                    const isOverdue = isPastDay && !isComplete;
                    return (
                      <div
                        key={task.id}
                        className={`calendar-task-chip ${isComplete ? 'is-complete' : ''} ${
                          task.hardDeadline ? 'is-hard' : ''
                        } ${task.urgent && task.important ? 'is-urgent-important' : ''} ${isOverdue ? 'is-overdue' : ''}`}
                        title={`${task.title}${isOverdue ? ' (OVERDUE)' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          // Pop out the task instead of focus mode
                          if (canUseWindowControls) {
                            void handlePopOutTask(task.id);
                          }
                        }}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/x-task-id', task.id);
                          e.dataTransfer.effectAllowed = 'move';
                          handleExternalTaskDragStart(task);
                        }}
                        onDragEnd={handleExternalTaskDragEnd}
                      >
                        {task.status && <span className="calendar-task-status">{task.status}</span>}
                        <span className="calendar-task-title">{task.title}</span>
                        {isOverdue && <span className="calendar-overdue-badge">!</span>}
                      </div>
                    );
                  })}
                    {hiddenCount > 0 && (
                      <div className="calendar-task-more">+{hiddenCount} more</div>
                    )}
                  </div>
                </div>
              );
            };

            // Render all days - CSS grid handles 2-column zigzag layout
            return daysToRender.map(renderDayCell);
          })()}
        </div>
        
        {/* Navigation bar for all views */}
        <div className="calendar-timeline-scrubber">
          <button
            type="button"
            className="timeline-nav-btn"
            onClick={() => {
              const newDate = new Date(calendarDate);
              if (calendarViewRange === 'day') {
                newDate.setDate(newDate.getDate() - 1);
              } else if (calendarViewRange === 'week') {
                newDate.setDate(newDate.getDate() - 7);
              } else if (calendarViewRange === 'month') {
                newDate.setMonth(newDate.getMonth() - 1);
              } else if (calendarViewRange === 'list') {
                newDate.setDate(newDate.getDate() - calendarListDays);
              } else if (calendarViewRange === 'custom') {
                newDate.setDate(newDate.getDate() - calendarCustomDays);
              }
              setCalendarDate(newDate);
            }}
            title="Previous period"
          >
            ← {calendarViewRange === 'day' ? '1 day' : 
               calendarViewRange === 'week' ? '1 week' : 
               calendarViewRange === 'month' ? '1 month' :
               calendarViewRange === 'list' ? `${calendarListDays}d` : 
               `${calendarCustomDays}d`}
          </button>
          <button
            type="button"
            className="timeline-today-btn"
            onClick={() => setCalendarDate(new Date())}
          >
            Today
          </button>
          <button
            type="button"
            className="timeline-nav-btn"
            onClick={() => {
              const newDate = new Date(calendarDate);
              if (calendarViewRange === 'day') {
                newDate.setDate(newDate.getDate() + 1);
              } else if (calendarViewRange === 'week') {
                newDate.setDate(newDate.getDate() + 7);
              } else if (calendarViewRange === 'month') {
                newDate.setMonth(newDate.getMonth() + 1);
              } else if (calendarViewRange === 'list') {
                newDate.setDate(newDate.getDate() + calendarListDays);
              } else if (calendarViewRange === 'custom') {
                newDate.setDate(newDate.getDate() + calendarCustomDays);
              }
              setCalendarDate(newDate);
            }}
            title="Next period"
          >
            {calendarViewRange === 'day' ? '1 day' : 
             calendarViewRange === 'week' ? '1 week' : 
             calendarViewRange === 'month' ? '1 month' :
             calendarViewRange === 'list' ? `${calendarListDays}d` : 
             `${calendarCustomDays}d`} →
          </button>
          {!scrollHintDismissed && (
            <div className="timeline-hint-dismissable">
              <span className="timeline-hint-text">
                {calendarViewRange === 'list' ? 'Scroll to navigate' : 'Shift + Scroll'}
              </span>
              <button
                type="button"
                className="timeline-hint-dismiss"
                onClick={() => {
                  setScrollHintDismissed(true);
                  window.localStorage?.setItem('calendar.scrollHintDismissed', 'true');
                }}
                title="Dismiss hint"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Render mini calendar for sidebar
  const renderCalendarNavigationPanel = (variant: 'main' | 'sidebar' = 'sidebar') => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = new Date().toISOString().split('T')[0];
    const selectedStr = calendarDate.toISOString().split('T')[0];
    const cells = [];
    for (let i = 0; i < firstDay; i++) {
      cells.push(<div key={`empty-${i}`} className="calendar-day empty" />);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;
      const isSelected = selectedStr.startsWith(dateStr);
      const tasksOnDay = tasks.filter((t) => t.dueDate?.startsWith(dateStr));
      const isDropTarget = calendarDropTarget === dateStr;
      cells.push(
        <div
          key={day}
          className={`calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${
            tasksOnDay.length > 0 ? 'has-tasks' : ''
          } ${isDropTarget ? 'drop-target' : ''}`}
          onClick={() => {
            const newDate = new Date(year, month, day);
            setCalendarDate(newDate);
            // Close picker if it was open
            setCalendarPickerOpen(false);
          }}
          onDragOver={(event) => handleCalendarDayDragOver(event, dateStr)}
          onDragLeave={() => handleCalendarDayDragLeave(dateStr)}
          onDrop={(event) => handleCalendarDayDrop(event, dateStr)}
        >
          {day}
          {tasksOnDay.length > 0 && <span className="calendar-day-dot" />}
        </div>
      );
    }
    return (
      <div className={`calendar-mini ${variant === 'main' ? 'calendar-mini-large' : ''}`}>
        <div className="calendar-mini-header">
          <button
            type="button"
            className="calendar-nav-btn"
            onClick={() => {
              const prev = new Date(calendarDate);
              prev.setMonth(prev.getMonth() - 1);
              setCalendarDate(prev);
            }}
          >
            ←
          </button>
          <span className="calendar-month-year">
            {calendarDate.toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric'
            })}
          </span>
          <button
            type="button"
            className="calendar-nav-btn"
            onClick={() => {
              const next = new Date(calendarDate);
              next.setMonth(next.getMonth() + 1);
              setCalendarDate(next);
            }}
          >
            →
          </button>
        </div>
        <div className="calendar-mini-grid">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((dayLabel) => (
            <div key={dayLabel} className="calendar-day-header">
              {dayLabel}
            </div>
          ))}
          {cells}
        </div>
        <button
          type="button"
          className="calendar-today-btn"
          onClick={() => {
            setCalendarDate(new Date());
            setCalendarPickerOpen(false);
          }}
        >
          Today
        </button>
      </div>
    );
  };

  const renderCalendarTasksPanel = (variant: 'main' | 'sidebar' = 'main') => {
    const dateStr = calendarDate.toISOString().split('T')[0];
    const tasksOnDay = orderedTasks.filter((t) => t.dueDate?.startsWith(dateStr));
    
    // Projects on selected day
    const projectsOnDay = projects.filter((p) => p.endDate?.startsWith(dateStr));
    
    const panelClasses = ['calendar-day-view'];
    if (variant === 'sidebar') {
      panelClasses.push('is-compact');
    }
    
    return (
      <div className={panelClasses.join(' ')}>
        {/* Selected Day Section */}
        <h2 className="calendar-day-title">
          {calendarDate.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          })}
        </h2>
        
        {/* Projects with deadlines on this day */}
        {projectsOnDay.length > 0 && (
          <div className="calendar-day-projects">
            <h4 className="calendar-day-projects-title">📁 Project Deadlines</h4>
            {projectsOnDay.map((project) => {
              const projectTasks = tasks.filter(t => (t.projectIds ?? []).includes(project.id));
              const completedTasks = projectTasks.filter(t => t.normalizedStatus === 'complete').length;
              
              return (
                <div 
                  key={project.id}
                  className="calendar-day-project-item"
                  onClick={() => {
                    setSelectedProjectId(project.id);
                    setProjectWorkspaceMode(true);
                    setViewMode('projects');
                  }}
                >
                  <span className="day-project-emoji">{project.emoji || '📁'}</span>
                  <div className="day-project-info">
                    <span className="day-project-title">{project.title}</span>
                    <span className="day-project-meta">
                      {completedTasks}/{projectTasks.length} tasks complete
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        
        <div className="calendar-tasks">
          {tasksOnDay.length === 0 ? (
            <div className="panel muted">No tasks scheduled for this day</div>
          ) : (
            <TaskList
              tasks={tasksOnDay}
              loading={false}
              error={null}
              statusOptions={statusOptions}
              manualStatuses={manualStatuses}
              completedStatus={notionSettings?.completedStatus}
              onUpdateTask={handleUpdateTask}
              emptyMessage="No tasks for this day"
              grouping="none"
              sortHold={sortHold}
              holdDuration={SORT_HOLD_DURATION}
              onPopOutTask={
                canUseWindowControls
                  ? (task) => {
                      void handlePopOutTask(task.id);
                    }
                  : undefined
              }
              getRemainingTime={getRemainingTime}
              getEndTime={getEndTime}
              formatTime={formatTime}
              formatEndTime={formatEndTime}
              isCountingDown={isCountingDown}
              startCountdown={startCountdown}
              extendCountdown={extendCountdown}
              onStopSession={handleStopSession}
              scrollContainerRef={taskListScrollRef}
              onScrollToCenter={scrollToCenterTaskElement}
              onFocusTask={setFocusTaskId}
              focusTaskId={focusTaskId}
              isFocusMode={isFocusMode}
              enableExternalDrag={taskDragEnabled}
              onTaskDragStart={
                taskDragEnabled ? handleExternalTaskDragStart : undefined
              }
              onTaskDragEnd={
                taskDragEnabled ? handleExternalTaskDragEnd : undefined
              }
              projects={projects}
            />
          )}
        </div>
        <div className="calendar-quick-add">
          <QuickAdd
            onAdd={handleAddTask}
            statusOptions={statusOptions}
            manualStatuses={manualStatuses}
            completedStatus={notionSettings?.completedStatus}
            isCollapsed={quickAddCollapsed}
            onCollapseToggle={() => setQuickAddCollapsed(!quickAddCollapsed)}
            projects={projects}
          />
        </div>
      </div>
    );
  };


  // Early return with visible content if there's a critical error
  if (error && !tasks.length && !loading) {
    return (
      <div className="fullscreen-app" style={{ padding: '20px', color: 'white' }}>
        <h1>Error Loading Full Screen View</h1>
        <p>{error}</p>
        <button onClick={fetchTasks}>Retry</button>
      </div>
    );
  }

  const isWorkspaceViewActive =
    viewMode === 'projects' && Boolean(workspaceProject);

  return (
    <div className={`fullscreen-app ${navSidebarCollapsed ? 'nav-collapsed' : ''} ${headerCollapsed ? 'header-collapsed' : ''}`}>
      {/* Vertical Navigation Sidebar */}
      <nav className={`nav-sidebar ${navSidebarCollapsed ? 'is-collapsed' : ''}`}>
        <div className="nav-sidebar-header">
          <button
            type="button"
            className="nav-collapse-btn"
            onClick={() => setNavSidebarCollapsed(!navSidebarCollapsed)}
            title={navSidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {navSidebarCollapsed ? '»' : '«'}
          </button>
        </div>
        <div className="nav-sidebar-items">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${viewMode === item.id ? 'active' : ''}`}
              onClick={() => {
                if (viewMode === item.id) {
                  // Clicking active item toggles header visibility
                  setHeaderCollapsed(!headerCollapsed);
                } else {
                  setViewMode(item.id);
                }
              }}
              title={viewMode === item.id ? (headerCollapsed ? 'Show header' : 'Hide header') : item.description}
            >
              <span className="nav-item-icon">{item.icon}</span>
              {!navSidebarCollapsed && (
                <span className="nav-item-label">{item.label}</span>
              )}
            </button>
          ))}
        </div>
      </nav>
      
      <div className="main-content-area">
      {/* Show header button when collapsed */}
      {headerCollapsed && (
        <button
          type="button"
          className="header-show-btn"
          onClick={() => setHeaderCollapsed(false)}
          title="Show header"
        >
          <span className="header-show-icon">▼</span>
          <span className="header-show-label">{NAV_ITEMS.find(n => n.id === viewMode)?.label}</span>
        </button>
      )}
      <header className={`fullscreen-header ${headerCollapsed ? 'is-collapsed' : ''}`}>
        {/* Current View Label */}
        <div className="current-view-label">
          <span className="view-icon">{NAV_ITEMS.find(n => n.id === viewMode)?.icon}</span>
          <span className="view-name">{NAV_ITEMS.find(n => n.id === viewMode)?.label}</span>
          <button
            type="button"
            className="header-collapse-btn"
            onClick={() => setHeaderCollapsed(true)}
            title="Hide header (click nav item to show)"
          >
            ▲
          </button>
          {/* Projects sidebar toggle - inline with Tasks */}
          {viewMode === 'tasks' && (
            <button
              type="button"
              className={`projects-inline-toggle ${projectSidebarOpen ? 'is-open' : ''} ${!projectSidebarOpen && selectedProjectId ? 'has-filter' : ''}`}
              onClick={() => setProjectSidebarOpen(!projectSidebarOpen)}
              title={projectSidebarOpen ? 'Hide projects' : (selectedProjectId ? `Filtered: ${projects.find(p => p.id === selectedProjectId)?.title ?? 'project'}` : 'Show projects')}
            >
              <span className="toggle-icon">📁</span>
              <span className="toggle-label">{projectSidebarOpen ? 'Hide' : 'Projects'}</span>
              {!projectSidebarOpen && selectedProjectId && (
                <span className="filter-indicator">•</span>
              )}
            </button>
          )}
        </div>
        
        <div className="fullscreen-toolbar-cluster">
          {/* Panel toggles for Tasks dashboard */}
          {viewMode === 'tasks' && (
            <div className="panel-toggles">
              {panelOrder.map((panel, index) => {
                const config = PANEL_CONFIG[panel];
                const isActive = activePanels.includes(panel);
                // Calculate visual order: position among active panels in current panelOrder
                const activePanelsInOrder = panelOrder.filter(p => activePanels.includes(p));
                const visualIndex = activePanelsInOrder.indexOf(panel);
                const showControls = isActive && activePanels.length > 1;
                
                return (
                  <div 
                    key={panel} 
                    className={`panel-toggle-item ${isActive ? 'is-active' : ''} ${draggedPanel === panel ? 'is-dragging' : ''} ${draggedPanel && draggedPanel !== panel ? 'is-drop-target' : ''}`}
                    style={{ '--panel-color': config.color } as React.CSSProperties}
                    draggable={isActive}
                    onDragStart={(e) => {
                      if (!isActive) return;
                      setDraggedPanel(panel);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', panel);
                    }}
                    onDragEnd={() => setDraggedPanel(null)}
                    onDragOver={(e) => {
                      if (!draggedPanel || draggedPanel === panel || !isActive) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!draggedPanel || draggedPanel === panel) return;
                      const fromIndex = panelOrder.indexOf(draggedPanel);
                      const toIndex = panelOrder.indexOf(panel);
                      if (fromIndex !== -1 && toIndex !== -1) {
                        const newOrder = [...panelOrder];
                        newOrder.splice(fromIndex, 1);
                        newOrder.splice(toIndex, 0, draggedPanel);
                        setPanelOrder(newOrder);
                      }
                      setDraggedPanel(null);
                    }}
                  >
                    <button
                      type="button"
                      className={`panel-toggle-btn ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        if (isActive && activePanels.length > 1) {
                          setActivePanels(activePanels.filter(p => p !== panel));
                        } else if (!isActive) {
                          setActivePanels([...activePanels, panel]);
                        }
                      }}
                      title={config.description}
                    >
                      <span className="panel-toggle-indicator" />
                      <span className="panel-toggle-icon">{config.icon}</span>
                      <span className="panel-toggle-label">{config.label}</span>
                      {showControls && (
                        <span className="panel-toggle-number">{visualIndex + 1}</span>
                      )}
                    </button>
                    {/* Reorder controls - below button, subtle */}
                    {showControls && (
                      <div className="panel-reorder-controls">
                        <button
                          type="button"
                          className="panel-reorder-btn"
                          onClick={() => {
                            const currentIndex = panelOrder.indexOf(panel);
                            if (currentIndex > 0) {
                              const newOrder = [...panelOrder];
                              [newOrder[currentIndex - 1], newOrder[currentIndex]] = [newOrder[currentIndex], newOrder[currentIndex - 1]];
                              setPanelOrder(newOrder);
                            }
                          }}
                          title="Move left"
                          disabled={index === 0}
                        >
                          ←
                        </button>
                        <span className="panel-reorder-drag-hint">drag</span>
                        <button
                          type="button"
                          className="panel-reorder-btn"
                          onClick={() => {
                            const currentIndex = panelOrder.indexOf(panel);
                            if (currentIndex < panelOrder.length - 1) {
                              const newOrder = [...panelOrder];
                              [newOrder[currentIndex], newOrder[currentIndex + 1]] = [newOrder[currentIndex + 1], newOrder[currentIndex]];
                              setPanelOrder(newOrder);
                            }
                          }}
                          title="Move right"
                          disabled={index === panelOrder.length - 1}
                        >
                          →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* Panel toggles for Projects dashboard */}
          {viewMode === 'projects' && !isWorkspaceViewActive && (
            <div className="panel-toggles">
              {projectPanelOrder.map((panel, index) => {
                const config = PROJECT_PANEL_CONFIG[panel];
                const isActive = activeProjectPanels.includes(panel);
                const panelIndex = activeProjectPanels.indexOf(panel);
                return (
                  <div 
                    key={panel} 
                    className={`panel-toggle-item ${isActive ? 'is-active' : ''}`}
                    style={{ '--panel-color': config.color } as React.CSSProperties}
                  >
                    <button
                      type="button"
                      className={`panel-toggle-btn ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        if (isActive && activeProjectPanels.length > 1) {
                          setActiveProjectPanels(activeProjectPanels.filter(p => p !== panel));
                        } else if (!isActive) {
                          setActiveProjectPanels([...activeProjectPanels, panel]);
                        }
                      }}
                      title={config.description}
                    >
                      <span className="panel-toggle-indicator" />
                      <span className="panel-toggle-icon">{config.icon}</span>
                      <span className="panel-toggle-label">{config.label}</span>
                      {isActive && activeProjectPanels.length > 1 && (
                        <span className="panel-toggle-number">{panelIndex + 1}</span>
                      )}
                    </button>
                    {isActive && activeProjectPanels.length > 1 && (
                      <div className="panel-reorder-btns">
                        <button
                          type="button"
                          className="panel-reorder-btn"
                          onClick={() => {
                            const currentIndex = projectPanelOrder.indexOf(panel);
                            if (currentIndex > 0) {
                              const newOrder = [...projectPanelOrder];
                              [newOrder[currentIndex - 1], newOrder[currentIndex]] = [newOrder[currentIndex], newOrder[currentIndex - 1]];
                              setProjectPanelOrder(newOrder);
                            }
                          }}
                          title="Move left"
                          disabled={index === 0}
                        >
                          ◀
                        </button>
                        <button
                          type="button"
                          className="panel-reorder-btn"
                          onClick={() => {
                            const currentIndex = projectPanelOrder.indexOf(panel);
                            if (currentIndex < projectPanelOrder.length - 1) {
                              const newOrder = [...projectPanelOrder];
                              [newOrder[currentIndex], newOrder[currentIndex + 1]] = [newOrder[currentIndex + 1], newOrder[currentIndex]];
                              setProjectPanelOrder(newOrder);
                            }
                          }}
                          title="Move right"
                          disabled={index === projectPanelOrder.length - 1}
                        >
                          ▶
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
          {/* Projects organizer toolbar - Filter/Sort buttons */}
              <div className="widget-toolbar is-compact">
                <div className="task-organizer">
                  <OrganizerIconButton
                    label="Filters"
                    icon={<FilterIcon />}
                    pressed={projectOrganizerPanel === 'filters'}
                    highlighted={projectOrganizerPanel === 'filters' || projectStatusFilter !== 'all'}
                    onClick={() => setProjectOrganizerPanel(projectOrganizerPanel === 'filters' ? null : 'filters')}
                    title={projectStatusFilter !== 'all' ? `Status: ${projectStatusFilter}` : 'Filter projects'}
                  />
                </div>
                <div className="task-organizer">
                  <OrganizerIconButton
                    label="Sort"
                    icon={<SortIcon />}
                    pressed={projectOrganizerPanel === 'sort'}
                    highlighted={projectOrganizerPanel === 'sort'}
                    onClick={() => setProjectOrganizerPanel(projectOrganizerPanel === 'sort' ? null : 'sort')}
                    title={`Sort: ${projectSortBy} (${projectSortDir})`}
                  />
                </div>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={loadProjectsFromCache}
                title="Refresh projects"
              >
                ⟳
              </button>
            </div>
          )}
          {/* Panel toggles for Project workspace */}
          {viewMode === 'projects' && isWorkspaceViewActive && (
            <div className="panel-toggles">
              {workspacePanelOrder.map((panel, index) => {
                const config = PANEL_CONFIG[panel];
                const isActive = activeWorkspacePanels.includes(panel);
                const panelIndex = activeWorkspacePanels.indexOf(panel);
                return (
                  <div
                    key={`workspace-${panel}`}
                    className={`panel-toggle-item ${isActive ? 'is-active' : ''}`}
                    style={{ '--panel-color': config.color } as React.CSSProperties}
                  >
                    <button
                      type="button"
                      className={`panel-toggle-btn ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        if (isActive && activeWorkspacePanels.length > 1) {
                          setActiveWorkspacePanels(
                            activeWorkspacePanels.filter((p) => p !== panel)
                          );
                        } else if (!isActive) {
                          setActiveWorkspacePanels([
                            ...activeWorkspacePanels,
                            panel
                          ]);
                        }
                      }}
                      title={config.description}
                    >
                      <span className="panel-toggle-indicator" />
                      <span className="panel-toggle-icon">{config.icon}</span>
                      <span className="panel-toggle-label">
                        {config.label}
                      </span>
                      {isActive && activeWorkspacePanels.length > 1 && (
                        <span className="panel-toggle-number">
                          {panelIndex + 1}
                        </span>
                      )}
                    </button>
                    {isActive && activeWorkspacePanels.length > 1 && (
                      <div className="panel-reorder-btns">
                        <button
                          type="button"
                          className="panel-reorder-btn"
                          onClick={() => {
                            const currentIndex = workspacePanelOrder.indexOf(
                              panel
                            );
                            if (currentIndex > 0) {
                              const newOrder = [...workspacePanelOrder];
                              [newOrder[currentIndex - 1], newOrder[currentIndex]] =
                                [newOrder[currentIndex], newOrder[currentIndex - 1]];
                              setWorkspacePanelOrder(newOrder);
                            }
                          }}
                          title="Move left"
                          disabled={index === 0}
                        >
                          ◀
                        </button>
                        <button
                          type="button"
                          className="panel-reorder-btn"
                          onClick={() => {
                            const currentIndex = workspacePanelOrder.indexOf(
                              panel
                            );
                            if (currentIndex < workspacePanelOrder.length - 1) {
                              const newOrder = [...workspacePanelOrder];
                              [newOrder[currentIndex], newOrder[currentIndex + 1]] =
                                [newOrder[currentIndex + 1], newOrder[currentIndex]];
                              setWorkspacePanelOrder(newOrder);
                            }
                          }}
                          title="Move right"
                          disabled={index === workspacePanelOrder.length - 1}
                        >
                          ▶
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* Master filters for Tasks view - affects all panels */}
          {viewMode === 'tasks' && renderOrganizerToolbar('full')}
        </div>
        <div className="header-actions">
          <div className="widget-switch">
            <button
              type="button"
              className={activeWidget === 'tasks' ? 'active' : ''}
              onClick={() => setActiveWidget('tasks')}
            >
              Tasks{' '}
              <span style={{ opacity: 0.5, marginLeft: 4 }}>
                {focusTaskId ? 1 : displayTasks.length}
              </span>
            </button>
            <button
              type="button"
              className={activeWidget === 'writing' ? 'active' : ''}
              onClick={() => setActiveWidget('writing')}
            >
              Writing
            </button>
          </div>
          <ImportQueueMenu onImportStarted={() => fetchTasks()} />
          {focusTaskId && (
            <button
              className="pill ghost"
              type="button"
              onClick={() => setFocusTaskId(null)}
            >
              Exit focus
            </button>
          )}
          <button
            type="button"
            className="gear-button"
            onClick={handleOpenSettings}
            title="Open Control Center"
          >
            ⚙️
          </button>
          {canUseWindowControls && (
            <button
              type="button"
              className="icon-button"
              onClick={() => getWidgetAPI().closeWindow()}
              title="Close window"
              aria-label="Close window"
            >
              ✕
            </button>
          )}
        </div>
      </header>
      
      {/* Main Content Area */}
      {activeWidget === 'writing' ? (
        <section className="fullscreen-content">
          <WritingWidget
            settings={writingSettings}
            onCreate={handleCreateWritingEntry}
          />
        </section>
      ) : viewMode === 'tasks' ? (
        /* Tasks Dashboard - Multi-panel view */
        <div className="tasks-dashboard">
          {renderProjectsSidebar()}
          <div className="dashboard-panels-container">
            {/* Filter/Sort/Group panels - dropdown style */}
            {renderOrganizerPanels()}
            <div className={`dashboard-panels panels-${activePanels.length}`}>
              {panelOrder
                .filter(panel => activePanels.includes(panel))
                .map((panel, index, filteredPanels) => (
                  <React.Fragment key={panel}>
                    {renderTaskPanel(panel)}
                    {/* Resizer between panels */}
                    {index < filteredPanels.length - 1 && (
                      <div
                        className={`panel-resizer ${panelResizing?.leftPanel === panel ? 'is-active' : ''}`}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          const container = e.currentTarget.parentElement;
                          if (!container) return;
                          const rightPanel = filteredPanels[index + 1];
                          setPanelResizing({
                            leftPanel: panel,
                            rightPanel,
                            startX: e.clientX,
                            containerWidth: container.offsetWidth,
                            startLeftWidth: panelWidths[panel],
                            startRightWidth: panelWidths[rightPanel]
                          });
                        }}
                        onDoubleClick={() => {
                          // Reset to equal widths
                          const equalWidth = 100 / activePanels.length;
                          const newWidths = { ...panelWidths };
                          activePanels.forEach(p => { newWidths[p] = equalWidth; });
                          setPanelWidths(newWidths);
                        }}
                      />
                    )}
                  </React.Fragment>
                ))
              }
            </div>
            {completedTaskId && (
              <div className="completion-toast">
                ✅ Session Complete!
              </div>
            )}
          </div>
          {/* Bottom Bar: Quick Add + Capture Note */}
          <div className="tasks-bottom-bar">
            <div className={`dashboard-quick-add-bar ${quickAddCollapsed ? 'is-collapsed' : ''}`}>
              <button
                type="button"
                className="quick-add-toggle"
                onClick={() => setQuickAddCollapsed(!quickAddCollapsed)}
              >
                <span className="quick-add-toggle-icon">{quickAddCollapsed ? '＋' : '−'}</span>
                <span className="quick-add-toggle-label">{quickAddCollapsed ? 'Quick Add' : 'Collapse'}</span>
              </button>
              {!quickAddCollapsed && (
                <div className="quick-add-content">
              <QuickAdd
                onAdd={handleAddTask}
                statusOptions={statusOptions}
                manualStatuses={manualStatuses}
                completedStatus={notionSettings?.completedStatus}
                    isCollapsed={false}
                    onCollapseToggle={() => setQuickAddCollapsed(true)}
                    projects={projects}
                    enableDragToPlace={true}
                  />
                </div>
              )}
            </div>
            
            <button
              type="button"
              className={`capture-note-toggle ${notesPanelOpen ? 'is-active' : ''}`}
              onClick={() => setNotesPanelOpen(!notesPanelOpen)}
            >
              <span className="capture-note-icon">📝</span>
              <span className="capture-note-label">{notesPanelOpen ? 'Close Notes' : 'Capture Note'}</span>
            </button>
          </div>
          
          {/* Slide-in Notes Panel */}
          <aside className={`notes-slide-panel ${notesPanelOpen ? 'is-open' : ''}`}>
            <div className="notes-panel-header">
              <h4>📝 Capture Notes</h4>
              <button
                type="button"
                className="notes-panel-close"
                onClick={() => setNotesPanelOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="notes-panel-content">
              <WritingWidget
                settings={writingSettings}
                onCreate={handleCreateWritingEntry}
              />
            </div>
          </aside>
        </div>
      ) : viewMode === 'calendar' ? (
        /* Master Calendar View */
        <div className="calendar-shell calendar-full-view">
          <div className="calendar-toolbar">
            <div className="calendar-nav-group">
              <button
                type="button"
                className="calendar-nav-btn"
                onClick={() => navigateCalendar(-1)}
              >
                ←
              </button>
              <div 
                className="calendar-date-picker-wrapper"
                onBlur={(e) => {
                  // Close picker if focus moves outside the wrapper
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    setCalendarPickerOpen(false);
                  }
                }}
              >
                <button
                  type="button"
                  className={`calendar-range-label ${calendarPickerOpen ? 'is-active' : ''}`}
                  onClick={() => setCalendarPickerOpen(!calendarPickerOpen)}
                  title="Click to pick a date"
                >
                  {getCalendarRangeLabel()}
                  <span className="calendar-picker-arrow">{calendarPickerOpen ? '▲' : '▼'}</span>
                </button>
                {calendarPickerOpen && (
                  <div 
                    className="calendar-picker-dropdown"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {renderCalendarNavigationPanel('main')}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="calendar-nav-btn"
                onClick={() => navigateCalendar(1)}
              >
                →
              </button>
              <button
                type="button"
                className="calendar-today-btn-inline"
                onClick={() => setCalendarDate(new Date())}
              >
                Today
              </button>
            </div>
            <div className="calendar-view-range-toggle">
              <button
                type="button"
                className={calendarViewRange === 'month' ? 'active' : ''}
                onClick={() => setCalendarViewRange('month')}
                title="Month view"
              >
                Month
              </button>
              <button
                type="button"
                className={calendarViewRange === 'week' ? 'active' : ''}
                onClick={() => setCalendarViewRange('week')}
                title="Week view"
              >
                Week
              </button>
              <button
                type="button"
                className={calendarViewRange === 'day' ? 'active' : ''}
                onClick={() => setCalendarViewRange('day')}
                title="Day view"
              >
                Day
              </button>
              <div className="calendar-custom-range-toggle">
                <button
                  type="button"
                  className={calendarViewRange === 'custom' ? 'active' : ''}
                  onClick={() => setCalendarViewRange('custom')}
                  title={`Custom ${calendarCustomDays} days`}
                >
                  {calendarCustomDays}d
                </button>
                {calendarViewRange === 'custom' && (
                  <input
                    type="range"
                    min="1"
                    max="15"
                    value={calendarCustomDays}
                    onChange={(e) => setCalendarCustomDays(parseInt(e.target.value, 10))}
                    className="calendar-custom-days-slider"
                    title={`${calendarCustomDays} days`}
              />
            )}
          </div>
              <div className="calendar-list-view-toggle">
                <button
                  type="button"
                  className={calendarViewRange === 'list' ? 'active' : ''}
                  onClick={() => setCalendarViewRange('list')}
                  title="List view"
                >
                  List
                </button>
                {calendarViewRange === 'list' && (
                  <div className="list-view-options">
                    <input
                      type="range"
                      min="3"
                      max="14"
                      value={calendarListDays}
                      onChange={(e) => setCalendarListDays(parseInt(e.target.value, 10))}
                      className="list-days-slider"
                      title={`${calendarListDays} days`}
                    />
                    <span className="list-days-label">{calendarListDays}d</span>
                    <button
                      type="button"
                      className={`list-columns-btn ${calendarListColumns === 2 ? 'active' : ''}`}
                      onClick={() => setCalendarListColumns(calendarListColumns === 1 ? 2 : 1)}
                      title={calendarListColumns === 1 ? 'Switch to 2 columns' : 'Switch to 1 column'}
                    >
                      {calendarListColumns === 1 ? '⊟' : '⊞'}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="calendar-layout-controls">
              <button
                type="button"
                className="calendar-swap-btn"
                onClick={toggleCalendarSidebarPosition}
                title={calendarSidebarPosition === 'left' ? 'Tasks on right' : 'Tasks on left'}
              >
                {calendarSidebarPosition === 'left' ? '⇄ Tasks Right' : '⇄ Tasks Left'}
              </button>
            </div>
            
            {/* Overdue/Unscheduled Toggles */}
            <div className="calendar-inbox-toggles">
              {(() => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const todayStr = today.toISOString().split('T')[0];
                const overdueCount = orderedTasks.filter((t) => 
                  t.dueDate && t.normalizedStatus !== 'complete' && t.dueDate < todayStr
                ).length + projects.filter((p) => {
                  if (!p.endDate) return false;
                  const status = p.status?.toLowerCase() || '';
                  if (status.includes('done') || status.includes('complete')) return false;
                  return p.endDate < todayStr;
                }).length;
                const unscheduledCount = orderedTasks.filter((t) => 
                  !t.dueDate && t.normalizedStatus !== 'complete'
                ).length;
                
                return (
                  <>
                    {overdueCount > 0 && (
                      <button
                        type="button"
                        className={`calendar-inbox-toggle overdue ${calendarOverdueOpen ? 'is-active' : ''}`}
                        onClick={() => {
                          setCalendarOverdueOpen(!calendarOverdueOpen);
                          if (!calendarOverdueOpen) setCalendarUnscheduledOpen(false);
                        }}
                      >
                        <span className="toggle-count">{overdueCount}</span>
                        <span className="toggle-label">Overdue</span>
                      </button>
                    )}
                    {unscheduledCount > 0 && (
                      <button
                        type="button"
                        className={`calendar-inbox-toggle unscheduled ${calendarUnscheduledOpen ? 'is-active' : ''}`}
                        onClick={() => {
                          setCalendarUnscheduledOpen(!calendarUnscheduledOpen);
                          if (!calendarUnscheduledOpen) setCalendarOverdueOpen(false);
                        }}
                      >
                        <span className="toggle-count">{unscheduledCount}</span>
                        <span className="toggle-label">Unscheduled</span>
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          
          {/* Overdue/Unscheduled Dropdown Panels */}
          {(calendarOverdueOpen || calendarUnscheduledOpen) && (
            <div className="calendar-inbox-panel">
              {calendarOverdueOpen && (() => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const todayStr = today.toISOString().split('T')[0];
                const overdueTasks = orderedTasks.filter((t) => 
                  t.dueDate && t.normalizedStatus !== 'complete' && t.dueDate < todayStr
                );
                const overdueProjects = projects.filter((p) => {
                  if (!p.endDate) return false;
                  const status = p.status?.toLowerCase() || '';
                  if (status.includes('done') || status.includes('complete')) return false;
                  return p.endDate < todayStr;
                });
                
                return (
                  <div className="inbox-panel-content">
                    <div className="inbox-panel-header">
                      <span className="inbox-panel-icon">⚠️</span>
                      <span className="inbox-panel-title">Overdue Items</span>
                      <button 
                        type="button"
                        className="inbox-panel-close"
                        onClick={() => setCalendarOverdueOpen(false)}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="inbox-panel-items">
                      {overdueProjects.map((project) => {
                        const projectTasks = tasks.filter(t => (t.projectIds ?? []).includes(project.id));
                        const completedTasks = projectTasks.filter(t => t.normalizedStatus === 'complete').length;
                        const daysOverdue = Math.floor((today.getTime() - new Date(project.endDate!).getTime()) / (1000 * 60 * 60 * 24));
                        
                        return (
                          <div 
                            key={project.id}
                            className="inbox-item inbox-project"
                            onClick={() => {
                              setSelectedProjectId(project.id);
                              setProjectWorkspaceMode(true);
                              setViewMode('projects');
                              setCalendarOverdueOpen(false);
                            }}
                          >
                            <span className="inbox-item-emoji">{project.emoji || '📁'}</span>
                            <div className="inbox-item-info">
                              <span className="inbox-item-title">{project.title}</span>
                              <span className="inbox-item-meta">{daysOverdue}d overdue • {completedTasks}/{projectTasks.length} tasks</span>
                            </div>
                          </div>
                        );
                      })}
                      {overdueTasks.map((task) => {
                        const dueDate = new Date(task.dueDate!);
                        const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
                        
                        return (
                          <div 
                            key={task.id}
                            className="inbox-item inbox-task"
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('application/x-task-id', task.id);
                              e.dataTransfer.effectAllowed = 'move';
                              handleExternalTaskDragStart(task);
                            }}
                            onDragEnd={handleExternalTaskDragEnd}
                            onClick={async () => {
                              // Move to selected calendar date
                              const selectedDateStr = `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, '0')}-${String(calendarDate.getDate()).padStart(2, '0')}`;
                              const newDate = toLocalMiddayIso(selectedDateStr);
                              if (newDate) {
                                await handleUpdateTask(task.id, { dueDate: newDate });
                              }
                            }}
                            title="Click to move to selected date"
                          >
                            <div className="inbox-item-info">
                              <span className="inbox-item-title">{task.title}</span>
                              <span className="inbox-item-meta">
                                {daysOverdue}d overdue
                                {task.urgent && ' • ⚡'}
                              </span>
                            </div>
                            <button
                              type="button"
                              className="inbox-item-action"
                              title="Move to today"
                              onClick={async (e) => {
                                e.stopPropagation();
                                const todayDate = toLocalMiddayIso(todayStr);
                                if (todayDate) {
                                  await handleUpdateTask(task.id, { dueDate: todayDate });
                                }
                              }}
                            >
                              Today
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              
              {calendarUnscheduledOpen && (() => {
                const unscheduledTasks = orderedTasks.filter((t) => 
                  !t.dueDate && t.normalizedStatus !== 'complete'
                );
                
                return (
                  <div className="inbox-panel-content">
                    <div className="inbox-panel-header">
                      <span className="inbox-panel-icon">📋</span>
                      <span className="inbox-panel-title">Unscheduled Tasks</span>
                      <button 
                        type="button"
                        className="inbox-panel-close"
                        onClick={() => setCalendarUnscheduledOpen(false)}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="inbox-panel-hint">Click or drag tasks to schedule</div>
                    <div className="inbox-panel-items">
                      {unscheduledTasks.slice(0, 15).map((task) => (
                        <div 
                          key={task.id}
                          className={`inbox-item inbox-task ${task.urgent ? 'is-urgent' : ''}`}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('application/x-task-id', task.id);
                            e.dataTransfer.effectAllowed = 'move';
                            handleExternalTaskDragStart(task);
                          }}
                          onDragEnd={handleExternalTaskDragEnd}
                          onClick={async () => {
                            // Schedule to selected calendar date
                            const selectedDateStr = `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, '0')}-${String(calendarDate.getDate()).padStart(2, '0')}`;
                            const newDate = toLocalMiddayIso(selectedDateStr);
                            if (newDate) {
                              await handleUpdateTask(task.id, { dueDate: newDate });
                            }
                          }}
                          title="Click to schedule to selected date"
                        >
                          <span className="inbox-item-title">{task.title}</span>
                          {task.urgent && <span className="inbox-urgent-badge">⚡</span>}
                        </div>
                      ))}
                      {unscheduledTasks.length > 15 && (
                        <div className="inbox-panel-more">+{unscheduledTasks.length - 15} more</div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          <div
            className={`calendar-view calendar-grid-layout ${
              calendarSidebarPosition === 'right' ? 'is-reversed' : ''
            }`}
          >
            <aside
              className={`calendar-sidebar calendar-task-sidebar ${
                calendarDropTarget === 'sidebar' ? 'is-drop-target' : ''
              }`}
              style={{ width: `${calendarSidebarWidth}px` }}
              onDragOver={(event) => {
                if (!draggedTaskId) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setCalendarDropTarget('sidebar');
              }}
              onDragLeave={() => {
                setCalendarDropTarget((prev) => (prev === 'sidebar' ? null : prev));
              }}
              onDrop={async (event) => {
                if (!dragTaskRef.current) return;
                event.preventDefault();
                const task = dragTaskRef.current;
                setCalendarDropTarget(null);
                const selectedDateStr = `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, '0')}-${String(calendarDate.getDate()).padStart(2, '0')}`;
                const nextDueDate = toLocalMiddayIso(selectedDateStr);
                if (!nextDueDate || task.dueDate?.startsWith(selectedDateStr)) {
                  return;
                }
                try {
                  await handleUpdateTask(task.id, { dueDate: nextDueDate });
                } catch (err) {
                  console.error('Failed to update task date:', err);
                }
              }}
            >
              <div className="calendar-sidebar-header">
                <div className="calendar-sidebar-title-row">
                  <h3>Tasks</h3>
                  <span className="calendar-sidebar-date">
                    {calendarDate.toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </span>
                </div>
                {renderOrganizerToolbar('compact', true)}
              </div>
              {renderOrganizerPanels()}
              {renderCalendarTasksPanel('sidebar')}
            </aside>
            <div
              className={`calendar-resizer ${
                activeResize?.type === 'calendar' ? 'is-active' : ''
              }`}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize task sidebar"
              onPointerDown={handleStartCalendarResize}
              onDoubleClick={() =>
                setCalendarSidebarWidth(DEFAULT_CALENDAR_SIDEBAR_WIDTH)
              }
            />
            <main className="calendar-main calendar-grid-main">
              {renderFullCalendarGrid()}
            </main>
          </div>
          
          
          {/* Slide-in Notes Panel */}
          <aside className={`calendar-notes-panel ${calendarNotesPanelOpen ? 'is-open' : ''}`}>
            <div className="notes-panel-header">
              <h4>📝 Capture Notes</h4>
              <button
                type="button"
                className="notes-panel-close"
                onClick={() => setCalendarNotesPanelOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="notes-panel-content">
              <WritingWidget
                settings={writingSettings}
                onCreate={handleCreateWritingEntry}
              />
            </div>
          </aside>
        </div>
      ) : viewMode === 'writing' ? (
        /* Writing Logs View */
        <section className="fullscreen-content writing-section">
          <div className="writing-section-header">
            <h3>Writing Logs</h3>
            {renderOrganizerToolbar('compact')}
          </div>
          <WritingLogView
            tasks={tasks}
            projects={projects}
            writingSettings={writingSettings}
            completedStatus={notionSettings?.completedStatus}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
            onSelectTask={handleOpenTaskFromSubview}
            onCreateWritingEntry={handleCreateWritingEntry}
          />
        </section>
      ) : viewMode === 'projects' ? (
        (() => {
          // Get the active project if in workspace mode
          const activeProject = workspaceProject;
          
          // If project workspace is requested but project not found, render the dashboard instead
          if (projectWorkspaceMode && selectedProjectId && !activeProject) {
            // Schedule the state update for next render cycle
            setTimeout(() => setProjectWorkspaceMode(false), 0);
          }
          
          if (activeProject) {
            const allProjectTasks = tasks.filter((t) =>
              (t.projectIds ?? []).includes(activeProject.id)
            );
            const incompleteTasks = allProjectTasks.filter(t => t.normalizedStatus !== 'complete');
            const completedTasks = allProjectTasks.filter(t => t.normalizedStatus === 'complete');
            
            // Apply search filter
            const searchFiltered = workspaceSearch 
              ? allProjectTasks.filter(t => 
                  t.title.toLowerCase().includes(workspaceSearch.toLowerCase())
                )
              : allProjectTasks;
            
            // Apply matrix filter
            const matrixFiltered = workspaceMatrixFilter === 'all' 
              ? searchFiltered 
              : searchFiltered.filter(t => {
                  if (workspaceMatrixFilter === 'do-now') return t.urgent && t.important;
                  if (workspaceMatrixFilter === 'deep-work') return !t.urgent && t.important;
                  if (workspaceMatrixFilter === 'delegate') return t.urgent && !t.important;
                  if (workspaceMatrixFilter === 'defer') return !t.urgent && !t.important;
                  return true;
                });
            
            // Apply completed filter
            const statusFiltered = showCompletedWorkspaceTasks 
              ? matrixFiltered 
              : matrixFiltered.filter(t => t.normalizedStatus !== 'complete');
            
            // Apply sorting
            const projectTasks = [...statusFiltered].sort((a, b) => {
              let result = 0;
              if (workspaceSortBy === 'date') {
                if (a.dueDate && b.dueDate) result = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
                else if (a.dueDate) result = -1;
                else if (b.dueDate) result = 1;
              } else if (workspaceSortBy === 'priority') {
                const aPriority = (a.urgent && a.important) ? 0 : a.important ? 1 : a.urgent ? 2 : 3;
                const bPriority = (b.urgent && b.important) ? 0 : b.important ? 1 : b.urgent ? 2 : 3;
                result = aPriority - bPriority;
              } else if (workspaceSortBy === 'name') {
                result = a.title.localeCompare(b.title);
              }
              return workspaceSortDir === 'desc' ? -result : result;
            });
            
            // Sort incomplete tasks for next action: urgent+important first, then by due date
            const sortedIncompleteTasks = [...incompleteTasks].sort((a, b) => {
              // Priority: Do Now (urgent+important) > Deep Work (important) > Delegate (urgent) > others
              const aPriority = (a.urgent && a.important) ? 0 : a.important ? 1 : a.urgent ? 2 : 3;
              const bPriority = (b.urgent && b.important) ? 0 : b.important ? 1 : b.urgent ? 2 : 3;
              if (aPriority !== bPriority) return aPriority - bPriority;
              // Then by due date
              if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
              if (a.dueDate) return -1;
              if (b.dueDate) return 1;
              return 0;
            });
            const nextAction = sortedIncompleteTasks[0] || null;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const daysUntilDeadline = activeProject.endDate 
              ? Math.round((new Date(activeProject.endDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
              : null;
            const isOverdue = daysUntilDeadline !== null && daysUntilDeadline < 0;
            
            // Unique statuses from all projects
            const projectStatuses = [...new Set(projects.map(p => p.status).filter(Boolean))] as string[];
            
            const workspacePanels = workspacePanelOrder.filter((panel) =>
              activeWorkspacePanels.includes(panel)
            );
            const workspacePanelsToRender: TaskPanel[] =
              workspacePanels.length > 0 ? workspacePanels : ['list'];

            return (
              <div className="project-workspace">
                {/* Project Workspace Header */}
                <div className="project-workspace-header">
                  <div className="project-workspace-title">
                    <span className="project-emoji-large">{activeProject.emoji}</span>
                    <div className="project-info">
                      <h2>{activeProject.title}</h2>
                      <div className="project-meta">
                        {/* Editable Status */}
                        <select 
                          className="project-status-select"
                          value={activeProject.status || ''}
                          onChange={(e) => {
                            // Note: Project updates would need backend support
                            console.log('Status change requested:', e.target.value);
                          }}
                        >
                          <option value="">No Status</option>
                          {projectStatuses.map(status => (
                            <option key={status} value={status}>{status}</option>
                          ))}
                        </select>
                        <span className="project-task-count">
                          {incompleteTasks.length} tasks remaining • {completedTasks.length} completed
                        </span>
                        {completedTasks.length > 0 && (
                          <button
                            type="button"
                            className={`show-completed-toggle ${showCompletedWorkspaceTasks ? 'active' : ''}`}
                            onClick={() => setShowCompletedWorkspaceTasks(!showCompletedWorkspaceTasks)}
                            title={showCompletedWorkspaceTasks ? 'Hide completed tasks' : 'Show completed tasks'}
                          >
                            <span className="toggle-check">✓</span>
                            <span className="toggle-label">{showCompletedWorkspaceTasks ? 'Hide Done' : 'Show Done'}</span>
                          </button>
                        )}
                        <div className="project-dates-row">
                          <label className="project-date-label">
                            Start:
                            <input 
                              type="date"
                              className="project-date-input"
                              value={activeProject.startDate?.split('T')[0] || ''}
                              onChange={(e) => {
                                console.log('Start date change requested:', e.target.value);
                              }}
                            />
                          </label>
                          <label className="project-date-label">
                            Deadline:
                            <input 
                              type="date"
                              className={`project-date-input ${isOverdue ? 'is-overdue' : ''}`}
                              value={activeProject.endDate?.split('T')[0] || ''}
                              onChange={(e) => {
                                console.log('End date change requested:', e.target.value);
                              }}
                            />
                          </label>
                          {daysUntilDeadline !== null && (
                            <span className={`deadline-badge ${isOverdue ? 'overdue' : daysUntilDeadline <= 14 ? 'soon' : ''}`}>
                              {isOverdue ? `${Math.abs(daysUntilDeadline)}d overdue` : `${daysUntilDeadline}d left`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Back button at flex-end */}
                  <button 
                    type="button" 
                    className="back-to-projects-btn"
                    onClick={handleCloseProjectWorkspace}
                  >
                    ← Back
                  </button>
                </div>
                
                {/* Project Notes & Links Bar - Collapsible */}
                <div className="project-workspace-notes-bar">
                  <div className={`notes-section ${workspaceNotesCollapsed ? 'is-collapsed' : ''}`}>
                    <button 
                      type="button"
                      className="collapsible-header"
                      onClick={() => setWorkspaceNotesCollapsed(!workspaceNotesCollapsed)}
                    >
                      <span className="collapse-icon">{workspaceNotesCollapsed ? '▶' : '▼'}</span>
                      <span>📝 Project Notes</span>
                    </button>
                    {!workspaceNotesCollapsed && (
                      <textarea 
                        placeholder="Write notes, strategies, and thoughts about this project..."
                        className="project-workspace-notes"
                      />
                    )}
                  </div>
                  <div className={`links-section ${workspaceLinksCollapsed ? 'is-collapsed' : ''}`}>
                    <button 
                      type="button"
                      className="collapsible-header"
                      onClick={() => setWorkspaceLinksCollapsed(!workspaceLinksCollapsed)}
                    >
                      <span className="collapse-icon">{workspaceLinksCollapsed ? '▶' : '▼'}</span>
                      <span>🔗 Resources & Links</span>
                    </button>
                    {!workspaceLinksCollapsed && (
                      <textarea 
                        placeholder="Paste links and resources (one per line)..."
                        className="project-workspace-links"
                      />
                    )}
                  </div>
                </div>
                
                {/* Project Contacts - Only show if there are contacts */}
                {workspaceContacts.list.length > 0 && (
                <div className="project-contacts-section">
                  <button
                    type="button"
                    className="collapsible-section-header"
                    onClick={handleToggleContactsVisible}
                  >
                    <span className="collapse-icon">{contactsPanelVisible ? '▼' : '▶'}</span>
                    <span className="section-title">👥 Contacts ({workspaceContacts.list.length})</span>
                  </button>
                  {contactsPanelVisible && (
                    <div className="project-contacts-body">
                      {contactsLoading ? (
                        <div className="panel muted">Loading contacts…</div>
                      ) : (
                        <div className="project-contacts-table-wrapper">
                          <table className="project-contacts-table">
                            <thead>
                              <tr>
                                <th>Name</th>
                                <th>Company</th>
                                <th>Email</th>
                                <th>Phone</th>
                                <th>Notes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {workspaceContacts.list.map((contact) => (
                                <tr key={contact.id}>
                                  <td>
                                    <div className="contact-cell contact-name-cell">
                                      <span className="contact-name">
                                        {contact.name ?? 'Untitled contact'}
                                      </span>
                                      {contact.role && (
                                        <span className="contact-role-pill">
                                          {contact.role}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td>{contact.company ?? '—'}</td>
                                  <td>
                                    {contact.email ? (
                                      <div className="contact-cell contact-email-cell">
                                        <a href={`mailto:${contact.email}`}>
                                          {contact.email}
                                        </a>
                                        <button
                                          type="button"
                                          className="icon-button subtle"
                                          onClick={() =>
                                            handleCopyContactValue(contact.email)
                                          }
                                          title="Copy email"
                                        >
                                          ⧉
                                        </button>
                                      </div>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                  <td>{contact.phone ?? '—'}</td>
                                  <td className="contact-notes">
                                    {contact.notes ?? '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )}
                
                {/* Project Task Views with Toolbar */}
                <div className="project-workspace-views">
                  {/* Task Filter Toolbar */}
                  <div className="workspace-task-toolbar">
                    {/* Left: Search and organizer buttons */}
                    <div className="workspace-toolbar-left">
                      <div className="workspace-search-wrapper">
                        <input
                          type="text"
                          placeholder="Search tasks..."
                          value={workspaceSearch}
                          onChange={(e) => setWorkspaceSearch(e.target.value)}
                          className="workspace-search-input"
                        />
                        {workspaceSearch && (
                          <button
                            type="button"
                            className="workspace-search-clear"
                            onClick={() => setWorkspaceSearch('')}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <div className="workspace-organizer-btns">
                        <button
                          type="button"
                          className={`workspace-org-btn ${workspaceOrganizerPanel === 'filters' ? 'active' : ''} ${workspaceMatrixFilter !== 'all' ? 'highlighted' : ''}`}
                          onClick={() => setWorkspaceOrganizerPanel(workspaceOrganizerPanel === 'filters' ? null : 'filters')}
                          title="Filter tasks"
                        >
                          <FilterIcon />
                          <span>Filter</span>
                        </button>
                        <button
                          type="button"
                          className={`workspace-org-btn ${workspaceOrganizerPanel === 'sort' ? 'active' : ''}`}
                          onClick={() => setWorkspaceOrganizerPanel(workspaceOrganizerPanel === 'sort' ? null : 'sort')}
                          title="Sort tasks"
                        >
                          <SortIcon />
                          <span>Sort</span>
                        </button>
                        <button
                          type="button"
                          className={`workspace-org-btn ${workspaceOrganizerPanel === 'group' ? 'active' : ''} ${workspaceGroupBy !== 'none' ? 'highlighted' : ''}`}
                          onClick={() => setWorkspaceOrganizerPanel(workspaceOrganizerPanel === 'group' ? null : 'group')}
                          title="Group tasks"
                        >
                          <span className="org-icon">▤</span>
                          <span>Group</span>
                        </button>
                      </div>
                    </div>
                    
                    {/* Center: Next Action indicator */}
                    {nextAction && (
                      <div className="workspace-next-action">
                        <span className="next-action-label">Next:</span>
                        <span className="next-action-title" title={nextAction.title}>
                          {nextAction.urgent && nextAction.important && <span className="priority-dot do-now" />}
                          {nextAction.urgent && !nextAction.important && <span className="priority-dot delegate" />}
                          {!nextAction.urgent && nextAction.important && <span className="priority-dot deep-work" />}
                          {nextAction.title}
                        </span>
                        {nextAction.dueDate && (
                          <span className="next-action-due">
                            {new Date(nextAction.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                    )}
                    
                    {/* Right: View toggles and completed toggle */}
                    <div className="workspace-toolbar-right">
                      <div className="workspace-panel-toggles">
                        {workspacePanelOrder.map((panel) => {
                          const config = PANEL_CONFIG[panel];
                          const isActive = activeWorkspacePanels.includes(panel);
                          return (
                            <button
                              key={panel}
                              type="button"
                              className={`workspace-panel-btn ${isActive ? 'active' : ''}`}
                              onClick={() => {
                                if (isActive && activeWorkspacePanels.length > 1) {
                                  setActiveWorkspacePanels(activeWorkspacePanels.filter(p => p !== panel));
                                } else if (!isActive) {
                                  setActiveWorkspacePanels([...activeWorkspacePanels, panel]);
                                }
                              }}
                              title={config.description}
                            >
                              <span>{config.icon}</span>
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        className={`completed-toggle-btn ${showCompletedWorkspaceTasks ? 'active' : ''}`}
                        onClick={() => setShowCompletedWorkspaceTasks(!showCompletedWorkspaceTasks)}
                        title={showCompletedWorkspaceTasks ? 'Hide completed' : 'Show completed'}
                      >
                        <span className="toggle-check">✓</span>
                        <span className="toggle-count">{completedTasks.length}</span>
                      </button>
                    </div>
                  </div>
                  
                  {/* Organizer dropdown panels */}
                  {workspaceOrganizerPanel === 'filters' && (
                    <div className="workspace-organizer-dropdown">
                      <div className="organizer-section">
                        <span className="organizer-label">Priority</span>
                        <div className="widget-switch">
                          <button type="button" className={workspaceMatrixFilter === 'all' ? 'active' : ''} onClick={() => setWorkspaceMatrixFilter('all')}>All</button>
                          <button type="button" className={workspaceMatrixFilter === 'do-now' ? 'active do-now' : ''} onClick={() => setWorkspaceMatrixFilter('do-now')}>Do Now</button>
                          <button type="button" className={workspaceMatrixFilter === 'deep-work' ? 'active deep-work' : ''} onClick={() => setWorkspaceMatrixFilter('deep-work')}>Deep Work</button>
                          <button type="button" className={workspaceMatrixFilter === 'delegate' ? 'active delegate' : ''} onClick={() => setWorkspaceMatrixFilter('delegate')}>Delegate</button>
                          <button type="button" className={workspaceMatrixFilter === 'defer' ? 'active defer' : ''} onClick={() => setWorkspaceMatrixFilter('defer')}>Defer</button>
                        </div>
                      </div>
                      <button type="button" className="organizer-close" onClick={() => setWorkspaceOrganizerPanel(null)}>✕</button>
                    </div>
                  )}
                  
                  {workspaceOrganizerPanel === 'sort' && (
                    <div className="workspace-organizer-dropdown">
                      <div className="organizer-section">
                        <span className="organizer-label">Sort by</span>
                        <div className="widget-switch">
                          <button type="button" className={workspaceSortBy === 'date' ? 'active' : ''} onClick={() => setWorkspaceSortBy('date')}>Date</button>
                          <button type="button" className={workspaceSortBy === 'priority' ? 'active' : ''} onClick={() => setWorkspaceSortBy('priority')}>Priority</button>
                          <button type="button" className={workspaceSortBy === 'name' ? 'active' : ''} onClick={() => setWorkspaceSortBy('name')}>Name</button>
                        </div>
                      </div>
                      <div className="organizer-section">
                        <span className="organizer-label">Direction</span>
                        <div className="widget-switch">
                          <button type="button" className={workspaceSortDir === 'asc' ? 'active' : ''} onClick={() => setWorkspaceSortDir('asc')}>↑ Asc</button>
                          <button type="button" className={workspaceSortDir === 'desc' ? 'active' : ''} onClick={() => setWorkspaceSortDir('desc')}>↓ Desc</button>
                        </div>
                      </div>
                      <button type="button" className="organizer-close" onClick={() => setWorkspaceOrganizerPanel(null)}>✕</button>
                    </div>
                  )}
                  
                  {workspaceOrganizerPanel === 'group' && (
                    <div className="workspace-organizer-dropdown">
                      <div className="organizer-section">
                        <span className="organizer-label">Group by</span>
                        <div className="widget-switch">
                          <button type="button" className={workspaceGroupBy === 'none' ? 'active' : ''} onClick={() => setWorkspaceGroupBy('none')}>None</button>
                          <button type="button" className={workspaceGroupBy === 'priority' ? 'active' : ''} onClick={() => setWorkspaceGroupBy('priority')}>Priority</button>
                          <button type="button" className={workspaceGroupBy === 'status' ? 'active' : ''} onClick={() => setWorkspaceGroupBy('status')}>Status</button>
                        </div>
                      </div>
                      <button type="button" className="organizer-close" onClick={() => setWorkspaceOrganizerPanel(null)}>✕</button>
                    </div>
                  )}
                  <div
                    className={`dashboard-panels panels-${workspacePanelsToRender.length}`}
                  >
                    {workspacePanelsToRender.map((panel, index, filteredPanels) => (
                      <React.Fragment key={`workspace-fragment-${panel}`}>
                        {renderWorkspacePanel(panel, projectTasks)}
                        {index < filteredPanels.length - 1 && (
                          <div
                            className={`panel-resizer ${workspacePanelResizing?.leftPanel === panel ? 'is-active' : ''}`}
                            onPointerDown={(e) => {
                              e.preventDefault();
                              const container = e.currentTarget.parentElement;
                              if (!container) return;
                              const rightPanel = filteredPanels[index + 1];
                              setWorkspacePanelResizing({
                                leftPanel: panel,
                                rightPanel,
                                startX: e.clientX,
                                containerWidth: container.offsetWidth,
                                startLeftWidth: workspacePanelWidths[panel],
                                startRightWidth: workspacePanelWidths[rightPanel]
                              });
                            }}
                            onDoubleClick={() => {
                              const equalWidth = 100 / filteredPanels.length;
                              const newWidths = { ...workspacePanelWidths };
                              filteredPanels.forEach((p) => {
                                newWidths[p] = equalWidth;
                              });
                              setWorkspacePanelWidths(newWidths);
                            }}
                          />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
                
                {/* Quick Add Bar for this project */}
                <div className="project-workspace-bottom-bar">
                  <div
                    className={`dashboard-quick-add-bar ${
                      workspaceQuickAddCollapsed ? 'is-collapsed' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="quick-add-toggle"
                      onClick={() =>
                        setWorkspaceQuickAddCollapsed(!workspaceQuickAddCollapsed)
                      }
                    >
                      <span className="quick-add-toggle-icon">
                        {workspaceQuickAddCollapsed ? '＋' : '−'}
                      </span>
                      <span className="quick-add-toggle-label">
                        {workspaceQuickAddCollapsed ? 'Quick Add' : 'Collapse'}
                      </span>
                    </button>
                    {!workspaceQuickAddCollapsed && (
                      <div className="quick-add-content">
                        <QuickAdd
                          onAdd={handleWorkspaceQuickAdd}
                          statusOptions={statusOptions}
                          manualStatuses={manualStatuses}
                          completedStatus={notionSettings?.completedStatus}
                          isCollapsed={false}
                          onCollapseToggle={() =>
                            setWorkspaceQuickAddCollapsed(true)
                          }
                          projects={projects}
                          enableDragToPlace={false}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          }
          
          // Return Projects Dashboard when not in workspace mode
          return (
          /* Projects Dashboard - Multi-panel view like Tasks */
          <div className="projects-dashboard">
            <div className="projects-dashboard-main">
              <div className="dashboard-panels-container">
                {/* Projects Filter Panel - dropdown style */}
                {projectOrganizerPanel === 'filters' && (
                  <div className="task-organizer-pane sidebar-organizer-pane compact-filters">
                    <div className="task-organizer-section">
                      <div className="filter-row-compact">
                        {/* Status Filter */}
                        <div className="widget-switch task-filter-switch">
                          <button
                            type="button"
                            className={projectStatusFilter === 'all' ? 'active' : ''}
                            onClick={() => setProjectStatusFilter('all')}
                          >
                            All
                          </button>
                          <button
                            type="button"
                            className={projectStatusFilter === 'active' ? 'active' : ''}
                            onClick={() => setProjectStatusFilter('active')}
                          >
                            Active
                          </button>
                          <button
                            type="button"
                            className={projectStatusFilter === 'planning' ? 'active' : ''}
                            onClick={() => setProjectStatusFilter('planning')}
                          >
                            Planning
                          </button>
                          <button
                            type="button"
                            className={projectStatusFilter === 'on-hold' ? 'active' : ''}
                            onClick={() => setProjectStatusFilter('on-hold')}
                          >
                            On Hold
                          </button>
                        </div>
                        
                        {/* Show Completed */}
                        <div className="widget-switch task-filter-switch">
                          <button
                            type="button"
                            className={!showCompletedProjects ? 'active' : ''}
                            onClick={() => setShowCompletedProjects(false)}
                          >
                            Hide Done
                          </button>
                          <button
                            type="button"
                            className={showCompletedProjects ? 'active' : ''}
                            onClick={() => setShowCompletedProjects(true)}
                          >
                            Show Done
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="task-organizer-section-footer">
                      <span className="task-organizer-section-meta">
                        {filteredProjects.length} of {projects.length} projects
                      </span>
                      <button
                        type="button"
                        className="task-organizer-close"
                        onClick={() => setProjectOrganizerPanel(null)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
                
                {/* Projects Sort Panel - dropdown style */}
                {projectOrganizerPanel === 'sort' && (
                  <div className="task-organizer-pane sidebar-organizer-pane compact-filters">
                    <div className="task-organizer-section">
                      <div className="filter-row-compact">
                        <div className="widget-switch task-filter-switch">
                          <button
                            type="button"
                            className={projectSortBy === 'deadline' ? 'active' : ''}
                            onClick={() => setProjectSortBy('deadline')}
                          >
                            📅 Deadline
                          </button>
                          <button
                            type="button"
                            className={projectSortBy === 'name' ? 'active' : ''}
                            onClick={() => setProjectSortBy('name')}
                          >
                            🔤 Name
                          </button>
                          <button
                            type="button"
                            className={projectSortBy === 'progress' ? 'active' : ''}
                            onClick={() => setProjectSortBy('progress')}
                          >
                            📊 Progress
                          </button>
                          <button
                            type="button"
                            className={projectSortBy === 'status' ? 'active' : ''}
                            onClick={() => setProjectSortBy('status')}
                          >
                            📋 Status
                          </button>
                        </div>
                        
                        <div className="widget-switch task-filter-switch">
                          <button
                            type="button"
                            className={projectSortDir === 'asc' ? 'active' : ''}
                            onClick={() => setProjectSortDir('asc')}
                          >
                            ↑ Ascending
                          </button>
                          <button
                            type="button"
                            className={projectSortDir === 'desc' ? 'active' : ''}
                            onClick={() => setProjectSortDir('desc')}
                          >
                            ↓ Descending
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="task-organizer-section-footer">
                      <span className="task-organizer-section-meta">
                        Sort: {projectSortBy} ({projectSortDir})
                      </span>
                      <button
                        type="button"
                        className="task-organizer-close"
                        onClick={() => setProjectOrganizerPanel(null)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
                
                <div className={`dashboard-panels panels-${activeProjectPanels.length}`}>
                  {projectPanelOrder
                    .filter(panel => activeProjectPanels.includes(panel))
                    .map((panel, index, filteredPanels) => {
                      const config = PROJECT_PANEL_CONFIG[panel];
                      // Use flex-grow instead of fixed width to properly handle resizer space
                      const panelStyle = activeProjectPanels.length > 1 
                        ? { flex: `${projectPanelWidths[panel]} 0 0`, '--panel-color': config.color } as React.CSSProperties
                        : { flex: 1, '--panel-color': config.color } as React.CSSProperties;
                        
                      return (
                        <React.Fragment key={panel}>
                          <section className="dashboard-panel" style={panelStyle}>
                            <div className="panel-content">
                              {panel === 'list' && (
                                <ProjectList
                                  projects={filteredProjects}
                                  tasks={tasks}
                                  statusOptions={statusOptions}
                                  completedStatus={notionSettings?.completedStatus}
                                  onSelectProject={(id) => {
                                    setSelectedProjectId(id);
                                  }}
                                  onUpdateTask={handleUpdateTask}
                                  onAddTask={handleAddTask}
                                  onSelectTask={handleOpenTaskFromSubview}
                                  onOpenProjectWorkspace={handleOpenProjectWorkspace}
                                  selectedProjectId={selectedProjectId}
                                />
                              )}
                              {panel === 'health' && (
                                <ProjectHealth
                                  projects={filteredProjects}
                                  tasks={tasks}
                                  onSelectProject={setSelectedProjectId}
                                  onOpenProjectWorkspace={handleOpenProjectWorkspace}
                                  selectedProjectId={selectedProjectId}
                                />
                              )}
                              {panel === 'kanban' && (
                                <ProjectKanban
                                  projects={filteredProjects}
                                  tasks={tasks}
                                  onSelectProject={setSelectedProjectId}
                                  onOpenProjectWorkspace={handleOpenProjectWorkspace}
                                  selectedProjectId={selectedProjectId}
                                  hideToolbar
                                  statusOptions={projectStatusOptions}
                                  onUpdateProjectStatus={handleUpdateProjectStatus}
                                />
                              )}
                              {panel === 'timeline' && (
                                <ProjectTimeline
                                  projects={filteredProjects}
                                  tasks={tasks}
                                  onSelectProject={setSelectedProjectId}
                                  onOpenProjectWorkspace={handleOpenProjectWorkspace}
                                  selectedProjectId={selectedProjectId}
                                />
                              )}
                            </div>
                          </section>
                          {/* Resizer between panels */}
                          {index < filteredPanels.length - 1 && (
                            <div
                              className={`panel-resizer ${projectPanelResizing?.leftPanel === panel ? 'is-active' : ''}`}
                              onPointerDown={(e) => {
                                e.preventDefault();
                                const container = e.currentTarget.parentElement;
                                if (!container) return;
                                const rightPanel = filteredPanels[index + 1];
                                setProjectPanelResizing({
                                  leftPanel: panel,
                                  rightPanel,
                                  startX: e.clientX,
                                  containerWidth: container.offsetWidth,
                                  startLeftWidth: projectPanelWidths[panel],
                                  startRightWidth: projectPanelWidths[rightPanel]
                                });
                              }}
                              onDoubleClick={() => {
                                // Reset to equal widths
                                const equalWidth = 100 / activeProjectPanels.length;
                                const newWidths = { ...projectPanelWidths };
                                activeProjectPanels.forEach(p => { newWidths[p] = equalWidth; });
                                setProjectPanelWidths(newWidths);
                              }}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                </div>
              </div>
              
              {/* Bottom Bar: Quick Add (left) + Capture Note (right) */}
              <div className="projects-bottom-bar">
                <div className={`dashboard-quick-add-bar ${quickAddCollapsed ? 'is-collapsed' : ''}`}>
                  <button
                    type="button"
                    className="quick-add-toggle"
                    onClick={() => setQuickAddCollapsed(!quickAddCollapsed)}
                  >
                    <span className="quick-add-toggle-icon">{quickAddCollapsed ? '＋' : '−'}</span>
                    <span className="quick-add-toggle-label">{quickAddCollapsed ? 'Quick Add' : 'Collapse'}</span>
                  </button>
                  {!quickAddCollapsed && (
                    <div className="quick-add-content">
                      <QuickAdd
                        onAdd={handleAddTask}
                        statusOptions={statusOptions}
                        manualStatuses={manualStatuses}
                        completedStatus={notionSettings?.completedStatus}
                        isCollapsed={false}
                        onCollapseToggle={() => setQuickAddCollapsed(true)}
                        projects={projects}
                        enableDragToPlace={false}
                      />
                    </div>
                  )}
                </div>
                
                <button
                  type="button"
                  className={`capture-note-toggle ${notesPanelOpen ? 'is-active' : ''}`}
                  onClick={() => setNotesPanelOpen(!notesPanelOpen)}
                >
                  <span className="capture-note-icon">📝</span>
                  <span className="capture-note-label">{notesPanelOpen ? 'Close Notes' : 'Capture Note'}</span>
                </button>
              </div>
            </div>
            
            {/* Slide-in Notes Panel from Right */}
            <aside className={`notes-slide-panel ${notesPanelOpen ? 'is-open' : ''}`}>
              <div className="notes-panel-header">
                <h4>📝 Capture Notes</h4>
                <button
                  type="button"
                  className="notes-panel-close"
                  onClick={() => setNotesPanelOpen(false)}
                >
                  ✕
                </button>
              </div>
              <div className="notes-panel-content">
          <WritingWidget
            settings={writingSettings}
            onCreate={handleCreateWritingEntry}
          />
              </div>
            </aside>
          </div>
          );
        })()
      ) : null}
      </div>
      
      {/* Cross-window drag indicator */}
      {crossWindowDrag.isDragging && crossWindowDrag.sourceWindow === 'widget' && (
        <div className="cross-window-drag-indicator">
          <span className="drag-indicator-icon">📥</span>
          <span className="drag-indicator-text">
            Moving: {crossWindowDrag.task?.title}
          </span>
          <span className="drag-indicator-hint">
            Click on calendar day, project, or focus stack • ESC to cancel
          </span>
        </div>
      )}
      
      {/* Completion Toast */}
      {completedTaskId && (
        <div className="completion-toast">
          ✅ Session Complete!
        </div>
      )}
    </div>
  );
};

export default FullScreenApp;

