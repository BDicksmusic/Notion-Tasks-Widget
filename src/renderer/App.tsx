import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type {
  AppPreferences,
  DockState,
  SavedView,
  Task,
  TaskOrderOption,
  TaskStatusOption,
  TaskUpdatePayload,
  NotionCreatePayload,
  NotionSettings,
  Project,
  ProjectsSettings,
  SyncStateSummary,
  TimeLogEntryPayload,
  TimeLogSettings,
  WritingEntryPayload,
  WritingSettings,
  ResizeDirection
} from '@shared/types';
import TaskList, {
  type TaskShortcutAction,
  type TaskShortcutSignal
} from './components/TaskList';
import TaskInspectorPanel from './components/TaskInspectorPanel';
import QuickAdd from './components/QuickAdd';
import WritingWidget from './components/WritingWidget';
import TimeLogWidget from './components/TimeLogWidget';
import ProjectsWidget from './components/ProjectsWidget';
import SearchInput from './components/SearchInput';
import ViewSelector from './components/ViewSelector';
import ViewTabs from './components/ViewTabs';
import ChatbotPanel from './components/ChatbotPanel';
import ImportQueueMenu from './components/ImportQueueMenu';
import FilterPillsToolbar from './components/FilterPillsToolbar';
import { playWidgetSound, playUISound } from './utils/sounds';
import {
  FilterIcon,
  GroupButton,
  GroupPanel,
  OrganizerIconButton,
  SortButton,
  SortPanel
} from './components/TaskOrganizerControls';

// Search icon for the toolbar
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
import { matrixOptions } from './constants/matrix';
import { PREFERENCE_DEFAULTS } from './constants/preferences';
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
} from './utils/sorting';
import { useCountdownTimer } from './utils/useCountdownTimer';
import {
  useUndoRedo,
  useUndoRedoKeyboard,
  createTaskCompletionAction
} from './utils/useUndoRedo';

const COLLAPSE_DELAY = 4200;
const THIN_STATE_DELAY = 4000;
const SORT_HOLD_DURATION = 7000;
const UNDO_TOAST_TIMEOUT = 6000;
const SORT_RULES_STORAGE_KEY = 'widget.sort.rules';
const GROUPING_STORAGE_KEY = 'widget.group.option';
const FILTER_PANEL_STORAGE_KEY = 'widget.filters.visible';
const SEARCH_QUERY_STORAGE_KEY = 'widget.search.query';
type OrganizerPanel = 'filters' | 'sort' | 'group' | null;

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
type ManualReorderPayload = {
  sourceId: string;
  targetId: string | '__end';
  position: 'above' | 'below';
};

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

// Use platformBridge.widgetAPI directly to ensure we always get the current API instance
// (not a stale reference from module load time)
const widgetAPI = platformBridge.widgetAPI;
const canUseWindowControls = platformBridge.hasWindowControls;

// Debug: Log platform capabilities
console.log('[Widget] Platform:', {
  target: platformBridge.target,
  hasWindowControls: platformBridge.hasWindowControls,
  canUseWindowControls
});

const toFilterSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const CLOSE_BY_WINDOW_DAYS = 3;
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

const isTextEditingTarget = (target: EventTarget | null) => {
  if (typeof window === 'undefined' || typeof HTMLElement === 'undefined') {
    return false;
  }
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT')
  );
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

const getDueTimestamp = (task: Task) => {
  const key = extractDateKey(task.dueDate);
  return key ? toMidnightTimestamp(key) : null;
};

const getDateCategoryRank = (task: Task, todayTimestamp: number) => {
  const dueTimestamp = getDueTimestamp(task);
  if (dueTimestamp == null) {
    return 3; // undated last
  }
  if (dueTimestamp >= todayTimestamp) {
    return 0; // upcoming (today and future)
  }
  const daysPastDue = Math.floor((todayTimestamp - dueTimestamp) / DAY_IN_MS);
  if (daysPastDue <= CLOSE_BY_WINDOW_DAYS) {
    return 1; // recently past due ("close by")
  }
  return 2; // older tasks
};

const App = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appPreferences, setAppPreferences] = useState<AppPreferences | null>(
    null
  );
  const [dockState, setDockState] = useState<DockState>({
    edge: 'right',
    collapsed: false
  });
  const [notionSettings, setNotionSettings] = useState<NotionSettings | null>(
    null
  );
  const [writingSettings, setWritingSettings] = useState<WritingSettings | null>(
    null
  );
  const [timeLogSettings, setTimeLogSettings] = useState<TimeLogSettings | null>(
    null
  );
  const [projectsSettings, setProjectsSettings] = useState<ProjectsSettings | null>(
    null
  );
  const [syncStatus, setSyncStatus] = useState<SyncStateSummary | null>(null);
  const [dayFilter, setDayFilter] = useState<'all' | 'today' | 'tomorrow' | 'week' | 'overdue' | 'has-date' | 'no-date'>(() => {
    if (typeof window === 'undefined') return 'all';
    const stored =
      window.localStorage?.getItem('widget.dayFilter') ??
      window.localStorage?.getItem('widget.taskFilter');
    if (stored === 'all' || stored === 'today' || stored === 'tomorrow' || stored === 'week' || stored === 'overdue' || stored === 'has-date' || stored === 'no-date') {
      return stored;
    }
    return 'all';
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
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [statusOptions, setStatusOptions] = useState<TaskStatusOption[]>([]);
  const [orderOptions, setOrderOptions] = useState<TaskOrderOption[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [chatbotOpen, setChatbotOpen] = useState(false);
  const [activeWidget, setActiveWidget] = useState<'tasks' | 'writing' | 'timelog' | 'projects'>(() => {
    if (typeof window === 'undefined') return 'tasks';
    const stored = window.localStorage?.getItem('widget.activeView');
    if (stored === 'writing' || stored === 'timelog' || stored === 'projects') {
      return stored;
    }
    return 'tasks';
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
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [sortHold, setSortHold] = useState<Record<string, number>>({});
  const [displayTasks, setDisplayTasks] = useState<Task[]>([]);
  const [quickAddCollapsed, setQuickAddCollapsed] = useState(false);
  const [collapsedView, setCollapsedView] = useState<'button' | 'thin'>('button');
  const [viewMode, setViewMode] = useState<'full' | 'capture'>('full');
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [focusStack, setFocusStack] = useState<string[]>([]);
  const [focusStackDropActive, setFocusStackDropActive] = useState(false);
  const [crossWindowDrag, setCrossWindowDrag] = useState<{
    task: Task | null;
    sourceWindow: 'widget' | 'fullscreen' | null;
    isDragging: boolean;
  }>({ task: null, sourceWindow: null, isDragging: false });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [taskShortcutSignal, setTaskShortcutSignal] =
    useState<TaskShortcutSignal | null>(null);
  const shortcutSignalCounter = useRef(0);
  const emitTaskShortcut = useCallback((action: TaskShortcutAction) => {
    shortcutSignalCounter.current += 1;
    setTaskShortcutSignal({ id: shortcutSignalCounter.current, action });
  }, []);
  const handleTaskShortcutHandled = useCallback((id: number) => {
    setTaskShortcutSignal((current) =>
      current?.id === id ? null : current
    );
  }, []);
  const [localOrderOverrides, setLocalOrderOverrides] = useState<string[]>([]);
  const [inspectorTaskId, setInspectorTaskId] = useState<string | null>(null);
  const [projectCount, setProjectCount] = useState<number>(0);
  const [undoToastVisible, setUndoToastVisible] = useState(false);
  const isFocusMode = Boolean(focusTaskId);
  const manualStatuses = notionSettings?.statusPresets ?? [];
  const pinned = appPreferences?.pinWidget ?? false;
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskListScrollRef = useRef<HTMLDivElement>(null);

  // Undo/Redo system
  const {
    canUndo,
    canRedo,
    undoDescription,
    redoDescription,
    pushAction,
    undo,
    redo
  } = useUndoRedo();

  // Set up Ctrl+Z / Ctrl+Y keyboard shortcuts
  useUndoRedoKeyboard(undo, redo, true);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await widgetAPI.getTasks();
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
      const options = await widgetAPI.getStatusOptions();
      setStatusOptions(options);
    } catch (err) {
      console.error('Unable to load status options', err);
    }
  }, []);

  const loadOrderOptions = useCallback(async () => {
    try {
      const options = await widgetAPI.getOrderOptions();
      setOrderOptions(options);
    } catch (err) {
      console.error('Unable to load order options', err);
      setOrderOptions([]);
    }
  }, []);

  const SETTINGS_RETRY_ATTEMPTS = 5;
  const SETTINGS_RETRY_DELAY_MS = 600;

  // Load view from URL hash if present (for view windows)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (hash.startsWith('#view=')) {
      try {
        const viewParam = decodeURIComponent(hash.slice(6));
        const view = JSON.parse(viewParam) as SavedView;
        setDayFilter(view.dayFilter);
        setMatrixFilter(view.matrixFilter);
        setDeadlineFilter(view.deadlineFilter);
        setStatusFilter(view.statusFilter as StatusFilterValue);
        if (view.sortRules) {
          setSortRules(view.sortRules);
        }
        setGrouping(view.grouping);
        if (view.activeWidget) {
          setActiveWidget(view.activeWidget);
        }
        console.log('[Widget] Applied view from URL:', view.name);
      } catch (err) {
        console.error('Failed to parse view from URL hash:', err);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadSettingsWithRetry = async () => {
      for (let attempt = 0; attempt < SETTINGS_RETRY_ATTEMPTS && !cancelled; attempt += 1) {
        try {
          const settings = await widgetAPI.getSettings();
          if (!cancelled) {
            setNotionSettings(settings);
          }
          return;
        } catch (err) {
          console.error('Unable to load Notion settings (attempt %d)', attempt + 1, err);
          await new Promise((resolve) =>
            setTimeout(resolve, SETTINGS_RETRY_DELAY_MS * (attempt + 1))
          );
        }
      }
      if (!cancelled) {
        setError((prev) => prev ?? 'Unable to load Notion settings');
      }
    };

    fetchTasks();
    loadStatusOptions();
    
    // Load app preferences with error handling for mobile bridge initialization
    (async () => {
      try {
        const prefs = await widgetAPI.getAppPreferences();
        if (!cancelled) {
          setAppPreferences(prefs);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('not available')) {
          // Bridge not initialized yet, try again after a short delay
          setTimeout(async () => {
            try {
              const prefs = await platformBridge.widgetAPI.getAppPreferences();
              if (!cancelled) {
                setAppPreferences(prefs);
              }
            } catch (retryError) {
              console.error('Failed to load app preferences:', retryError);
            }
          }, 100);
        } else {
          console.error('Failed to load app preferences:', error);
        }
      }
    })();
    
    // Load writing settings with error handling
    (async () => {
      try {
        const settings = await widgetAPI.getWritingSettings();
        if (!cancelled) {
          setWritingSettings(settings);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('not available')) {
          // Bridge not initialized yet, try again after a short delay
          setTimeout(async () => {
            try {
              const settings = await platformBridge.widgetAPI.getWritingSettings();
              if (!cancelled) {
                setWritingSettings(settings);
              }
            } catch (retryError) {
              console.error('Failed to load writing settings:', retryError);
            }
          }, 100);
        } else {
          console.error('Failed to load writing settings:', error);
        }
      }
    })();
    loadSettingsWithRetry();

    const unsubscribe = widgetAPI.onDockStateChange((state) => {
      setDockState(state);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
      if (collapseTimer.current) {
        clearTimeout(collapseTimer.current);
      }
    };
  }, [fetchTasks, loadStatusOptions]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    widgetAPI
      .getSyncStatus()
      .then(setSyncStatus)
      .catch(() => {
        setSyncStatus(null);
      });
    if (typeof widgetAPI.onSyncStatusChange === 'function') {
      unsubscribe = widgetAPI.onSyncStatusChange((status) => {
        setSyncStatus(status);
      });
    }
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!notionSettings) return;
    if (!notionSettings.orderProperty) {
      setOrderOptions([]);
      return;
    }
    loadOrderOptions();
  }, [notionSettings?.orderProperty, loadOrderOptions]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem('widget.activeView', activeWidget);
  }, [activeWidget]);

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

  // Comprehensive Escape key handler - closes UI elements in priority order
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      
      // Check if any dropdown/popover is open in the DOM
      // These have their own Escape handlers, so let them close first
      const hasOpenDropdown = document.querySelector(
        '.status-select-dropdown, .date-field-popover, .filter-pill-menu, ' +
        '.mass-edit-dropdown, .import-queue-dropdown, .view-selector-dropdown, ' +
        '.task-status-dropdown, [role="listbox"]'
      );
      if (hasOpenDropdown) {
        // Dropdown's own handler will close it - don't do anything else this press
        return;
      }
      
      // Check if user is typing in an input - blur it first
      const activeElement = document.activeElement as HTMLElement;
      const isInTextInput = activeElement?.matches('input, textarea, [contenteditable="true"]');
      if (isInTextInput) {
        activeElement.blur();
        return;
      }
      
      // Priority 1: Close search panel
      if (searchExpanded) {
        setSearchExpanded(false);
        return;
      }
      
      // Priority 2: Close chatbot panel
      if (chatbotOpen) {
        setChatbotOpen(false);
        return;
      }
      
      // Priority 3: Close inspector panel
      if (inspectorTaskId) {
        setInspectorTaskId(null);
        return;
      }
      
      // Priority 4: Exit focus mode
      if (focusTaskId) {
        setFocusTaskId(null);
        return;
      }
      
      // Priority 5: Deselect task (only if we have a selection and we're in task view)
      if (selectedTaskId && activeWidget === 'tasks') {
        setSelectedTaskId(null);
        return;
      }
    };
    
    window.addEventListener('keydown', handleEscapeKey);
    return () => window.removeEventListener('keydown', handleEscapeKey);
  }, [searchExpanded, chatbotOpen, inspectorTaskId, focusTaskId, selectedTaskId, activeWidget]);

  useEffect(() => {
    if (viewMode === 'capture') {
      setActiveOrganizerPanel(null);
    }
  }, [viewMode]);

  useEffect(() => {
    if (activeWidget !== 'writing') return;
    widgetAPI.getWritingSettings().then(setWritingSettings);
  }, [activeWidget]);

  useEffect(() => {
    if (activeWidget === 'timelog') {
      widgetAPI.getTimeLogSettings().then(setTimeLogSettings).catch(() => {
        // Time log settings may not be configured yet
      });
    }
  }, [activeWidget]);

  useEffect(() => {
    if (activeWidget === 'projects') {
      widgetAPI.getProjectsSettings().then(setProjectsSettings).catch(() => {
        // Projects settings may not be configured yet
      });
    }
  }, [activeWidget]);

  // Fetch projects for task list and quick add
  useEffect(() => {
    widgetAPI.getProjects()
      .then(setProjects)
      .catch(() => {
        // Projects may not be configured yet
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

  // Focus-based sync REMOVED - was causing hidden automatic syncs
  // User can manually refresh using the refresh button if they want to pull from Notion

  const handleAddTask = useCallback(
    async (payload: NotionCreatePayload) => {
      try {
        const newTask = await widgetAPI.addTask(payload);
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
      await widgetAPI.createWritingEntry(payload);
    },
    []
  );

  // Handler for creating a task from project view with minimal info
  const handleCreateTaskFromProject = useCallback(
    async (payload: { title: string; projectId: string; status?: string }) => {
      const fullPayload: NotionCreatePayload = {
        title: payload.title,
        projectId: payload.projectId,
        status: payload.status,
        urgent: false,
        important: false,
      };
      await handleAddTask(fullPayload);
    },
    [handleAddTask]
  );

  const handleCreateTimeLogEntry = useCallback(
    async (payload: TimeLogEntryPayload) => {
      await widgetAPI.createTimeLogEntry(payload);
    },
    []
  );

  const handleForceSync = useCallback(() => {
    if (typeof widgetAPI.forceSync === 'function') {
      widgetAPI.forceSync().catch((error) => {
        console.error('Unable to force sync', error);
      });
    }
  }, []);

  const handleApplyView = useCallback((view: SavedView) => {
    setDayFilter(view.dayFilter);
    setMatrixFilter(view.matrixFilter);
    setDeadlineFilter(view.deadlineFilter);
    setStatusFilter(view.statusFilter as StatusFilterValue);
    if (view.sortRules) {
      setSortRules(view.sortRules);
    }
    setGrouping(view.grouping);
    if (view.activeWidget) {
      setActiveWidget(view.activeWidget);
    }
    // Set the active view ID so ViewTabs knows which tab is active
    setActiveViewId(view.id);
  }, []);

  // Reset filters to the saved view's state
  const handleResetFilters = useCallback(async () => {
    if (!activeViewId) return;
    try {
      const views = await widgetAPI.getSavedViews();
      const activeView = views.find(v => v.id === activeViewId);
      if (activeView) {
        handleApplyView(activeView);
      }
    } catch (error) {
      console.error('Unable to reset filters:', error);
    }
  }, [activeViewId, handleApplyView]);

  const handleOpenSettings = useCallback(() => {
    // Always open Control Center - it's the primary settings interface
    widgetAPI
      .openSettingsWindow()
      .catch((err) => console.error('Unable to open Control Center window', err));
  }, []);

  const handleAppPreferenceChange = useCallback(
    async (changes: Partial<AppPreferences>) => {
      const previous = appPreferences ?? PREFERENCE_DEFAULTS;
      const next = { ...previous, ...changes };
      setAppPreferences(next);
      try {
        const saved = await widgetAPI.updateAppPreferences(next);
        setAppPreferences(saved);
      } catch (err) {
        console.error('Unable to update app preferences', err);
        setAppPreferences(previous);
        throw err;
      }
    },
    [appPreferences]
  );

  const handlePinToggle = useCallback(
    async (next: boolean) => {
      try {
        await handleAppPreferenceChange({ pinWidget: next });
        if (next) {
          await widgetAPI.requestExpand();
        }
      } catch {
        // Errors handled in preference change helper.
      }
    },
    [handleAppPreferenceChange]
  );

  const handlePopOutTask = useCallback(
    async (taskId: string) => {
      if (!canUseWindowControls) {
        return;
      }
      const openTaskWindow = widgetAPI.openTaskWindow;
      if (typeof openTaskWindow !== 'function') {
        console.error('widgetAPI.openTaskWindow is not available');
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
    
    // Use scrollIntoView to center the element
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest'
    });
  }, []);

  const triggerExpand = useCallback(() => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
    }
    widgetAPI.requestExpand();
  }, []);

  const triggerCollapse = useCallback(() => {
    if (pinned) return;
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
    }
    collapseTimer.current = setTimeout(() => {
      widgetAPI.requestCollapse();
    }, COLLAPSE_DELAY);
  }, [pinned]);

  const clearThinTimer = useCallback(() => {
    if (thinTimer.current) {
      clearTimeout(thinTimer.current);
      thinTimer.current = null;
    }
  }, []);

  const scheduleThinState = useCallback(() => {
    if (!dockState.collapsed) return;
    clearThinTimer();
    thinTimer.current = setTimeout(() => {
      // 1. Update UI to thin state (starts CSS animation)
      setCollapsedView('thin');
      // 2. Wait for CSS animation (200ms), then shrink window
      setTimeout(() => {
        widgetAPI.setThinState(true);
      }, 200);
    }, THIN_STATE_DELAY);
  }, [dockState.collapsed, clearThinTimer]);

  // Handle collapsed state changes - only run logic when dockState.collapsed actually changes
  const prevCollapsedRef = useRef<boolean | null>(null);
  
  useEffect(() => {
    const wasCollapsed = prevCollapsedRef.current;
    const isCollapsed = dockState.collapsed;
    
    // Only run the full logic when collapsed state actually changes
    if (wasCollapsed === isCollapsed) {
      // No change in collapsed state - don't do anything
      return;
    }
    
    prevCollapsedRef.current = isCollapsed;
    
    if (isCollapsed) {
      // Just became collapsed - set initial state
      setCollapsedView('button');
      setQuickAddCollapsed(true);
      setViewMode('full');
      widgetAPI.setThinState(false);
      widgetAPI.setCaptureState(false);
      // Check if we should prevent minimal view during active session or if pinned
      const hasActiveSessionNow = typeof isCountingDown === 'function' 
        ? tasks.some((task) => isCountingDown(task.id))
        : false;
      const shouldPreventThinState = pinned || 
        (hasActiveSessionNow && (appPreferences?.preventMinimalDuringSession !== false));
      if (!shouldPreventThinState) {
        scheduleThinState();
      }
    } else {
      // Just became expanded - reset state
      setCollapsedView('button');
      widgetAPI.setThinState(false);
      clearThinTimer();
    }
  }, [dockState.collapsed, scheduleThinState, clearThinTimer, tasks, appPreferences?.preventMinimalDuringSession, pinned]);
  
  // Cleanup thin timer on unmount only
  useEffect(() => {
    return () => {
      clearThinTimer();
    };
  }, [clearThinTimer]);

  const expandMode = appPreferences?.expandMode ?? 'hover';
  const useHoverMode = expandMode === 'hover';
  const autoCollapse = appPreferences?.autoCollapse ?? true;

  const handleShellPointerEnter = useCallback(() => {
    // Only trigger expand when not collapsed, or when hovering over the handle area
    // Only if hover mode is enabled and auto-collapse is enabled
    if (useHoverMode && autoCollapse && !dockState.collapsed) {
      triggerExpand();
    }
  }, [triggerExpand, dockState.collapsed, useHoverMode, autoCollapse]);

  const handleShellPointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!useHoverMode || !autoCollapse || pinned || dockState.collapsed) return;
      const nextTarget = event.relatedTarget;
      if (nextTarget && nextTarget instanceof Node) {
        if (event.currentTarget.contains(nextTarget)) {
          return;
        }
      }
      triggerCollapse();
    },
    [triggerCollapse, pinned, dockState.collapsed, useHoverMode, autoCollapse]
  );

  const handleHandlePointerEnter = useCallback(() => {
    // Only trigger expand via hover when in thin state, not button state
    if (useHoverMode && autoCollapse && dockState.collapsed && collapsedView === 'thin') {
      triggerExpand();
    }
  }, [triggerExpand, dockState.collapsed, useHoverMode, autoCollapse, collapsedView]);

  const handleHandlePointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // This handler is for when the user hovers to expand from thin state
      // and then leaves - we should NOT do anything when already collapsed
      // (button state transitions are handled by thin timer, not this handler)
      if (!useHoverMode || !autoCollapse || pinned || dockState.collapsed) return;
      const nextTarget = event.relatedTarget;
      if (nextTarget && nextTarget instanceof Node) {
        if (event.currentTarget.contains(nextTarget)) {
          return;
        }
      }
      // Only collapse if leaving the handle area and not entering the widget surface
      const widgetSurface = event.currentTarget.parentElement?.querySelector('.widget-surface');
      if (widgetSurface && widgetSurface.contains(nextTarget as Node)) {
        return;
      }
      triggerCollapse();
    },
    [triggerCollapse, pinned, dockState.collapsed, useHoverMode, autoCollapse]
  );

  const handleDynamicButtonClick = useCallback(() => {
    if (dockState.collapsed) {
      triggerExpand();
    } else {
      triggerCollapse();
    }
  }, [dockState.collapsed, triggerExpand, triggerCollapse]);

  const handleWidgetToggleClick = useCallback(
    async (event?: React.MouseEvent) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      if (dockState.collapsed) {
        if (collapseTimer.current) {
          clearTimeout(collapseTimer.current);
          collapseTimer.current = null;
        }
        clearThinTimer();
        setCollapsedView('button');
        widgetAPI.setCaptureState(false);
        setViewMode('full');
        if (appPreferences?.enableSounds) {
          playWidgetSound('expand');
        }
        await widgetAPI.requestExpand();
        return;
      }

      if (collapseTimer.current) {
        clearTimeout(collapseTimer.current);
        collapseTimer.current = null;
      }

      try {
        console.log('Collapsing widget via forceCollapse (overriding PIN)...');
        if (appPreferences?.enableSounds) {
          playWidgetSound('collapse');
        }
        if (typeof widgetAPI.forceCollapse === 'function') {
          const result = await widgetAPI.forceCollapse();
          console.log('Collapse result:', result);
        } else {
          const wasPinned = pinned;
          if (wasPinned) {
            await handlePinToggle(false);
          }
          await widgetAPI.requestCollapse();
          if (wasPinned) {
            setTimeout(() => {
              handlePinToggle(true);
            }, 350);
          }
        }
      } catch (error) {
        console.error('Error collapsing widget:', error);
      } finally {
        setCollapsedView('button');
        // Check if we should prevent minimal view during active session or if pinned
        const hasActiveSessionNow = typeof isCountingDown === 'function'
          ? tasks.some((task) => isCountingDown(task.id))
          : false;
        const shouldPreventThinState = pinned || 
          (hasActiveSessionNow && (appPreferences?.preventMinimalDuringSession !== false));
        if (!shouldPreventThinState) {
          scheduleThinState();
        }
      }
    },
    [dockState.collapsed, pinned, handlePinToggle, clearThinTimer, scheduleThinState, tasks, appPreferences?.preventMinimalDuringSession]
  );

  const handleHandleClick = useCallback(() => {
    // When collapsed, clicking the handle should:
    // - In thin state: go to button state
    // - In button state: expand fully
    if (dockState.collapsed) {
      if (collapsedView === 'thin') {
        clearThinTimer();
        widgetAPI.setThinState(false);
        setCollapsedView('button');
      } else {
        triggerExpand();
      }
    }
  }, [dockState.collapsed, collapsedView, triggerExpand, clearThinTimer]);

  const renderBottomControls = (variant: 'inline' | 'collapsed') => {
    const isCollapsedVariant = variant === 'collapsed';
    const wrapperClasses = [
      'bottom-controls',
      isCollapsedVariant ? 'is-collapsed' : '',
      isCollapsedVariant && collapsedView === 'thin' ? 'is-thin' : '',
      isCollapsedVariant && hasActiveSession ? 'has-active-session' : ''
    ]
      .join(' ')
      .trim();
    const buttonIsInOpenState = dockState.collapsed && isCollapsedVariant;
    const quickToggleVisible =
      !isCollapsedVariant || (isCollapsedVariant && collapsedView === 'button');

    const collapsedPositionStyle =
      isCollapsedVariant && dockState.collapsed
        ? (() => {
            switch (dockState.edge) {
              case 'left':
                return { left: 12, right: 'auto', bottom: 6 };
              case 'right':
                return { right: 12, left: 'auto', bottom: 6 };
              default:
                return { left: 12, right: 12, bottom: 6 };
            }
          })()
        : undefined;

    const isCaptureMode = !dockState.collapsed && viewMode === 'capture';
    const buttonLabel = dockState.collapsed
      ? 'Expand widget'
      : isCaptureMode
        ? 'Open full widget'
        : 'Collapse widget';

    // Show timer in collapsed view if session is active
    // Note: isCountingDown may not be available when this function is first defined
    const activeTaskForCollapsed = typeof isCountingDown === 'function'
      ? tasks.find((task) => isCountingDown(task.id))
      : null;
    const showTimerInCollapsed =
      isCollapsedVariant && hasActiveSession && activeTaskForCollapsed;
    const collapsedRemainingSeconds = activeTaskForCollapsed
      ? getRemainingTime?.(activeTaskForCollapsed.id) ?? 0
      : 0;
    const formattedCollapsedTime =
      typeof formatTime === 'function'
        ? formatTime(collapsedRemainingSeconds)
        : `${Math.max(0, Math.round(collapsedRemainingSeconds / 60))}m`;

    if (isCollapsedVariant && collapsedView === 'thin') {
      // Calculate progress percentage for active session
      const sessionProgress = activeTaskForCollapsed?.sessionLengthMinutes
        ? Math.min(100, Math.max(0, 
            ((activeTaskForCollapsed.sessionLengthMinutes * 60 - collapsedRemainingSeconds) / 
            (activeTaskForCollapsed.sessionLengthMinutes * 60)) * 100
          ))
        : 0;
      const hasSessionProgress = showTimerInCollapsed && sessionProgress > 0;

      return (
        <div
          className={wrapperClasses}
          style={collapsedPositionStyle}
        >
          <button
            type="button"
            className={`thin-indicator ${hasSessionProgress ? 'has-progress' : ''}`}
            aria-label="Show controls"
            title={showTimerInCollapsed ? `${formattedCollapsedTime} remaining` : 'Show controls'}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // Go to button state instead of full expand
              clearThinTimer();
              widgetAPI.setThinState(false);
              setCollapsedView('button');
            }}
            style={hasSessionProgress ? {
              '--progress': `${sessionProgress}%`
            } as React.CSSProperties : undefined}
          >
            {hasSessionProgress && <span className="thin-progress-bar" />}
          </button>
        </div>
      );
    }

    const collapsedSessionIndicator =
      showTimerInCollapsed && collapsedView !== 'thin' ? (
        <div className="collapsed-session-indicator">
          <div className="collapsed-session-times">
            <span className="collapsed-session-emoji">⏱</span>
            <span className="collapsed-session-remaining">
              {formatTime?.(collapsedRemainingSeconds) ?? '0:00'}
            </span>
            {getEndTime && formatEndTime && activeTaskForCollapsed && (
              <span className="collapsed-session-end">
                until {formatEndTime(getEndTime(activeTaskForCollapsed.id)!)}
              </span>
            )}
          </div>
          {activeTaskForCollapsed && (
            <button
              type="button"
              className="collapsed-session-stop"
              onClick={() => handleStopSession(activeTaskForCollapsed.id)}
            >
              Stop
            </button>
          )}
        </div>
      ) : null;

    // Next action indicator for collapsed view (when no active session)
    const nextActionIndicator =
      isCollapsedVariant && collapsedView !== 'thin' && !showTimerInCollapsed && nextAction ? (
        <button
          type="button"
          className="collapsed-next-action"
          onClick={() => {
            setFocusTaskId(nextAction.id);
            widgetAPI.requestExpand();
          }}
          title={`Next: ${nextAction.title}${nextAction.dueDate ? ` (Due: ${new Date(nextAction.dueDate).toLocaleDateString()})` : ''}`}
        >
          <span className="next-action-label">Next</span>
          <span className="next-action-title">{nextAction.title}</span>
          {nextAction.projectId && <span className="next-action-project">•</span>}
        </button>
      ) : null;

    return (
      <div
        className={wrapperClasses}
        style={collapsedPositionStyle}
      >
        <div className="bottom-controls-left">
          <button
            type="button"
            className={`icon-button collapsed-icon-btn widget-toggle-button ${buttonIsInOpenState ? 'is-collapsed' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('Widget toggle button clicked');
              
              if (isCaptureMode) {
                if (appPreferences?.enableSounds) {
                  playWidgetSound('expand');
                }
                setViewMode('full');
                widgetAPI.setCaptureState(false);
                widgetAPI.requestExpand();
              } else {
                handleWidgetToggleClick(e);
              }
            }}
            aria-label={buttonLabel}
            title={buttonLabel}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          {isCollapsedVariant && collapsedView !== 'thin' && (
            <button
              type="button"
              className={`icon-button collapsed-icon-btn collapsed-pin ${pinned ? 'is-active' : ''}`}
              onClick={async () => {
                const newPinState = !pinned;
                await handleAppPreferenceChange({ pinWidget: newPinState });
                if (!newPinState) {
                  scheduleThinState();
                } else {
                  clearThinTimer();
                }
              }}
              aria-pressed={pinned}
              title={pinned ? 'Unpin widget' : 'Pin widget'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 17v5"/>
                <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4.76z"/>
              </svg>
            </button>
          )}
        </div>
        {isCollapsedVariant && collapsedView !== 'thin' && (
          <div className="bottom-controls-center">
            {collapsedSessionIndicator}
            {nextActionIndicator}
          </div>
        )}
        <div className="bottom-controls-right">
          {isCollapsedVariant && collapsedView !== 'thin' && (
            <>
              <button
                type="button"
                className={`icon-button collapsed-icon-btn ${activeWidget === 'writing' ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveWidget('writing');
                  widgetAPI.requestExpand();
                }}
                title="Writing"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9"/>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
              </button>
              <button
                type="button"
                className={`icon-button collapsed-icon-btn ${chatbotOpen ? 'is-active' : ''}`}
                onClick={() => {
                  playUISound(chatbotOpen ? 'panel-close' : 'panel-open');
                  setChatbotOpen(!chatbotOpen);
                  if (!chatbotOpen) {
                    widgetAPI.requestExpand();
                  }
                }}
                title={chatbotOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/>
                  <circle cx="8" cy="14" r="1.5"/>
                  <circle cx="16" cy="14" r="1.5"/>
                </svg>
              </button>
            </>
          )}
          {!isCollapsedVariant && (
            <>
              <button
                type="button"
                className={`icon-button pin-toggle ${pinned ? 'is-active' : ''}`}
                onClick={() => handlePinToggle(!pinned)}
                aria-pressed={pinned}
                title={pinned ? 'Unpin widget' : 'Pin widget'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 17v5"/>
                  <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4.76z"/>
                </svg>
              </button>
              {canUseWindowControls && (
                <>
                  <button
                    type="button"
                    className={`icon-button ai-button ${chatbotOpen ? 'active' : ''}`}
                    onClick={() => {
                      playUISound(chatbotOpen ? 'panel-close' : 'panel-open');
                      setChatbotOpen(!chatbotOpen);
                    }}
                    title={chatbotOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
                    aria-label={chatbotOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/>
                      <circle cx="8" cy="14" r="1.5"/>
                      <circle cx="16" cy="14" r="1.5"/>
                    </svg>
                  </button>
                  {canUseWindowControls && (
                    <button
                      type="button"
                      className="icon-button"
                      onClick={async () => {
                        try {
                          if (typeof widgetAPI.openFullScreenWindow === 'function') {
                            await widgetAPI.openFullScreenWindow();
                          }
                        } catch (error) {
                          console.error('Failed to open full-screen window:', error);
                          alert(`Failed to open full-screen window: ${error instanceof Error ? error.message : 'Unknown error'}`);
                        }
                      }}
                      title="Open full-screen view"
                      aria-label="Open full-screen view"
                    >
                      ⛶
                    </button>
                  )}
                </>
              )}
            </>
          )}
          {quickToggleVisible && (
            <button
              type="button"
              className="quick-add-toggle"
              onClick={() => {
                if (isCollapsedVariant) {
                  if (appPreferences?.enableSounds) {
                    playWidgetSound('capture');
                  }
                  setViewMode('capture');
                  widgetAPI.requestExpand();
                  widgetAPI.setCaptureState(true);
                  setQuickAddCollapsed(false);
                  setActiveOrganizerPanel(null);
                } else if (viewMode === 'capture') {
                  handleWidgetToggleClick();
                } else {
                  setQuickAddCollapsed(!quickAddCollapsed);
                }
              }}
              aria-expanded={!quickAddCollapsed}
              aria-label="Quick Capture"
              title="Quick Capture"
            >
              +
            </button>
          )}
        </div>
      </div>
    );
  };

  const dockClasses = useMemo(() => {
    return [
      `edge-${dockState.edge}`,
      dockState.collapsed ? 'is-collapsed' : '',
      dockState.collapsed && collapsedView === 'thin' ? 'is-thin' : ''
    ]
      .join(' ')
      .trim();
  }, [dockState, collapsedView]);

  const filteredTasks = useMemo(() => {
    const todayKey = getTodayKey();
    const todayTimestamp = toMidnightTimestamp(todayKey)!;
    const endOfWeek = new Date(todayTimestamp);
    endOfWeek.setDate(endOfWeek.getDate() + 7);
    const endOfWeekTimestamp = endOfWeek.getTime();
    const completedStatusValue = mapStatusToFilterValue(
      notionSettings?.completedStatus
    );

    if (!notionSettings?.completedStatus) {
      // If settings are not loaded yet, show everything to avoid accidentally filtering all tasks.
      return tasks;
    }

    return tasks.filter((task) => {
      // Apply search filter first
      if (searchQuery && !taskMatchesSearch(task, searchQuery)) {
        return false;
      }

      // Filter out snoozed tasks (hide until snooze expires)
      if (task.snoozedUntil) {
        const snoozeEnd = new Date(task.snoozedUntil);
        if (snoozeEnd > new Date()) {
          return false; // Task is still snoozed, hide it
        }
      }

      // Filter out subtasks from main list (they're shown nested under parent)
      if (task.parentTaskId) {
        return false;
      }

      const normalizedStatus =
        mapStatusToFilterValue(task.status) ??
        mapStatusToFilterValue(task.normalizedStatus) ??
        (task.normalizedStatus as StatusFilterValue | undefined);

      // Exclude completed tasks - check both normalized status and direct string match
      const completedStatusString = notionSettings?.completedStatus;
      const isCompleted =
        (completedStatusValue && normalizedStatus === completedStatusValue) ||
        (completedStatusString &&
          task.status?.toLowerCase() === completedStatusString.toLowerCase()) ||
        (completedStatusString &&
          task.normalizedStatus?.toLowerCase() ===
            completedStatusString.toLowerCase());

      if (isCompleted) {
        return false;
      }

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
      if (dayFilter === 'tomorrow') {
        if (dueDateTimestamp === null) {
          return false;
        }
        const tomorrowStart = todayTimestamp + 24 * 60 * 60 * 1000;
        const tomorrowEnd = tomorrowStart + 24 * 60 * 60 * 1000 - 1;
        if (dueDateTimestamp < tomorrowStart || dueDateTimestamp > tomorrowEnd) {
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
      if (dayFilter === 'overdue') {
        if (dueDateTimestamp === null) {
          return false;
        }
        if (dueDateTimestamp >= todayTimestamp) {
          return false;
        }
      }
      if (dayFilter === 'has-date') {
        if (dueDateTimestamp === null) {
          return false;
        }
      }
      if (dayFilter === 'no-date') {
        if (dueDateTimestamp !== null) {
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
      if (statusFilter !== 'all') {
        // Only filter out if task has a recognized status that doesn't match the filter
        // Tasks with unrecognized/unmapped statuses are included (they might be custom open statuses)
        if (normalizedStatus && normalizedStatus !== statusFilter) {
          return false;
        }
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
    notionSettings?.completedStatus
  ]);

  const dateOrderedTasks = useMemo(() => {
    if (!filteredTasks.length) return filteredTasks;
    const todayTimestamp = toMidnightTimestamp(getTodayKey())!;
    const ranked = filteredTasks.map((task) => ({
      task,
      rank: getDateCategoryRank(task, todayTimestamp)
    }));

    ranked.sort((a, b) => a.rank - b.rank);
    return ranked.map((entry) => entry.task);
  }, [filteredTasks]);

  const baseSortedTasks = useMemo(
    () => sortTasks(dateOrderedTasks, sortRules),
    [dateOrderedTasks, sortRules]
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

  // Prune local order overrides when task set changes (remove stale IDs)
  useEffect(() => {
    if (!localOrderOverrides.length) return;
    const validIds = new Set(displayTasks.map((task) => task.id));
    const pruned = localOrderOverrides.filter((id) => validIds.has(id));
    if (pruned.length !== localOrderOverrides.length) {
      setLocalOrderOverrides(pruned);
    }
  }, [displayTasks, localOrderOverrides]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const unsubscribe = widgetAPI.onTaskUpdated((updatedTask) => {
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
  }, []);

  const taskGroups = useMemo(
    () =>
      grouping === 'none'
        ? undefined
        : groupTasks(displayTasks, grouping, projects),
    [displayTasks, grouping, projects]
  );

  const visibleGrouping: GroupingOption = isFocusMode ? 'none' : grouping;
  const visibleGroups = isFocusMode ? undefined : taskGroups;
  // Always enable drag-drop reordering; persist to Notion when orderProperty configured
  const manualOrderingEnabled = true;
  const persistOrderToNotion = Boolean(
    orderOptions.length && notionSettings?.orderProperty
  );

  const settingsReady = Boolean(notionSettings?.completedStatus);
  const waitingForSettings = !settingsReady;

  const filterEmptyMessage = waitingForSettings
    ? 'Loading Notion settings...'
    : searchQuery
      ? `No tasks match "${searchQuery}"`
      : dayFilter === 'today'
        ? 'No tasks due today match these filters.'
        : dayFilter === 'tomorrow'
          ? 'No tasks due tomorrow match these filters.'
          : dayFilter === 'week'
            ? 'No tasks due this week match these filters.'
            : dayFilter === 'overdue'
              ? 'No overdue tasks match these filters.'
              : dayFilter === 'has-date'
                ? 'No tasks with dates match these filters.'
                : dayFilter === 'no-date'
                  ? 'No tasks without dates match these filters.'
                  : 'No tasks match the current filters.';

  const listLoading = loading || waitingForSettings;

  // Raw update function without undo tracking (used by undo/redo actions)
  const rawUpdateTask = useCallback(
    async (taskId: string, updates: TaskUpdatePayload) => {
      const updated = await widgetAPI.updateTask(taskId, updates);
      setTasks((prev) =>
        prev.map((task) => (task.id === taskId ? updated : task))
      );
      setSortHold((prev) => ({
        ...prev,
        [taskId]: Date.now() + SORT_HOLD_DURATION
      }));
      setError(null);
      return updated;
    },
    []
  );

  const handleUpdateTask = useCallback(
    async (taskId: string, updates: TaskUpdatePayload, skipUndo = false) => {
      // Find the task to get its previous state
      const task = tasks.find((t) => t.id === taskId);
      
      // If completing a task, remember the taskId to maintain selection position
      if ('status' in updates && updates.status === notionSettings?.completedStatus) {
        lastCompletedTaskIdRef.current = taskId;
      }
      
      try {
        await rawUpdateTask(taskId, updates);
        
        // Track undo action if we have task info and not skipping
        if (task && !skipUndo) {
          const previousState: TaskUpdatePayload = {};
          const changedFields: string[] = [];
          
          // Capture previous state for changed fields
          if ('status' in updates) {
            previousState.status = task.status ?? null;
            changedFields.push('status');
          }
          if ('dueDate' in updates) {
            previousState.dueDate = task.dueDate ?? null;
            changedFields.push('dueDate');
          }
          if ('title' in updates) {
            previousState.title = task.title;
            changedFields.push('title');
          }
          if ('urgent' in updates) {
            previousState.urgent = task.urgent ?? false;
            changedFields.push('urgent');
          }
          if ('important' in updates) {
            previousState.important = task.important ?? false;
            changedFields.push('important');
          }
          
          // Generate description
          let description = `Update "${task.title}"`;
          if (changedFields.includes('status')) {
            const completedStatus = notionSettings?.completedStatus;
            if (updates.status === completedStatus) {
              description = `Complete "${task.title}"`;
            } else if (task.status === completedStatus) {
              description = `Uncomplete "${task.title}"`;
            } else {
              description = `Change status of "${task.title}"`;
            }
          } else if (changedFields.includes('dueDate')) {
            description = `Change date of "${task.title}"`;
          }
          
          pushAction({
            type: 'task:update',
            description,
            undo: async () => {
              await rawUpdateTask(taskId, previousState);
            },
            redo: async () => {
              await rawUpdateTask(taskId, updates);
            }
          });
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Unable to update Notion task'
        );
        throw err;
      }
    },
    [tasks, rawUpdateTask, pushAction, notionSettings?.completedStatus]
  );

  const handleUpdateTaskStatus = useCallback(
    async (taskId: string, updates: { status: string | null }) => {
      await handleUpdateTask(taskId, updates);
    },
    [handleUpdateTask]
  );

  // Get the default "To-do" status from status options
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
    // Show notification briefly, then clear
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
    handleCountdownComplete,
    timeLogSettings?.startStatusValue ?? 'Start',
    timeLogSettings?.endStatusValue ?? 'End'
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

  const orderOptionLookup = useMemo(() => {
    const map = new Map<string, number>();
    orderOptions.forEach((option, index) => {
      map.set(option.name.toLowerCase(), index);
    });
    return map;
  }, [orderOptions]);

  const getOrderRank = useCallback(
    (task: Task) => {
      if (!task.orderValue) return null;
      return orderOptionLookup.get(task.orderValue.toLowerCase()) ?? null;
    },
    [orderOptionLookup]
  );

  const prioritizedTasks = useMemo(() => {
    // If we have local overrides (from drag/drop without Notion order property), use them
    if (localOrderOverrides.length && !persistOrderToNotion) {
      const overrideIndex = new Map(
        localOrderOverrides.map((id, idx) => [id, idx])
      );
      const withIndex = displayTasks.map((task, index) => ({ task, index }));
      withIndex.sort((a, b) => {
        const overrideA = overrideIndex.get(a.task.id);
        const overrideB = overrideIndex.get(b.task.id);
        // Tasks with local order come first, in their specified order
        if (overrideA !== undefined && overrideB !== undefined) {
          return overrideA - overrideB;
        }
        if (overrideA !== undefined) return -1;
        if (overrideB !== undefined) return 1;
        return a.index - b.index;
      });
      return withIndex.map((entry) => entry.task);
    }
    // If we have Notion order options, use those
    if (orderOptions.length) {
      const withIndex = displayTasks.map((task, index) => ({ task, index }));
      withIndex.sort((a, b) => {
        const rankA = getOrderRank(a.task);
        const rankB = getOrderRank(b.task);
        const normalizedA = rankA ?? Number.POSITIVE_INFINITY;
        const normalizedB = rankB ?? Number.POSITIVE_INFINITY;
        if (normalizedA === normalizedB) {
          return a.index - b.index;
        }
        return normalizedA - normalizedB;
      });
      return withIndex.map((entry) => entry.task);
    }
    return displayTasks;
  }, [displayTasks, orderOptions.length, getOrderRank, localOrderOverrides, persistOrderToNotion]);

  const orderedTasks = useMemo(() => {
    const source = prioritizedTasks;
    const active = source.filter((task) => activeTaskIdSet.has(task.id));
    const rest = source.filter((task) => !activeTaskIdSet.has(task.id));
    const combined = [...active, ...rest];
    if (focusTaskId) {
      const target = combined.find((task) => task.id === focusTaskId);
      return target ? [target] : combined;
    }
    return combined;
  }, [prioritizedTasks, activeTaskIdSet, focusTaskId]);

  // Calculate "Next Action" - the most urgent task to work on
  const nextAction = useMemo(() => {
    const now = Date.now();
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndTime = todayEnd.getTime();
    
    // Filter to incomplete tasks only
    const incompleteTasks = displayTasks.filter(task => 
      task.normalizedStatus !== 'complete' && !activeTaskIdSet.has(task.id)
    );
    
    if (incompleteTasks.length === 0) return null;
    
    // Score each task based on priority criteria
    const scoredTasks = incompleteTasks.map(task => {
      let score = 0;
      const dueDate = task.dueDate ? new Date(task.dueDate).getTime() : null;
      const deadline = task.deadlineDate ? new Date(task.deadlineDate).getTime() : null;
      
      // Priority 1: Overdue tasks (highest priority)
      if (dueDate && dueDate < now) {
        score += 1000;
      }
      if (deadline && deadline < now) {
        score += 500;
      }
      
      // Priority 2: Due today
      if (dueDate && dueDate <= todayEndTime && dueDate >= now) {
        score += 300;
      }
      
      // Priority 3: Has a deadline coming up (within 3 days)
      const threeDays = now + (3 * 24 * 60 * 60 * 1000);
      if (deadline && deadline <= threeDays && deadline >= now) {
        score += 200;
      }
      
      // Priority 4: Part of a project (has context)
      if (task.projectId) {
        score += 50;
      }
      
      // Priority 5: Earlier due date wins
      if (dueDate) {
        // Closer dates get higher scores (inverse of days away)
        const daysAway = Math.max(0, (dueDate - now) / (24 * 60 * 60 * 1000));
        score += Math.max(0, 100 - daysAway * 5);
      }
      
      // Priority 6: Matrix priority (Do Now > Schedule > Delegate > Eliminate)
      if (task.matrix === 'do') score += 40;
      else if (task.matrix === 'schedule') score += 30;
      else if (task.matrix === 'delegate') score += 20;
      
      return { task, score };
    });
    
    // Sort by score (highest first) and return top task
    scoredTasks.sort((a, b) => b.score - a.score);
    return scoredTasks[0]?.task ?? null;
  }, [displayTasks, activeTaskIdSet]);

  // Track the last completed task ID to maintain selection position
  const lastCompletedTaskIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (!orderedTasks.length) {
      setSelectedTaskId(null);
      lastCompletedTaskIdRef.current = null;
      return;
    }
    
    // If we just completed a task, use the stored index to select the next one
    if (lastCompletedTaskIdRef.current !== null) {
      const stored = lastCompletedTaskIdRef.current;
      lastCompletedTaskIdRef.current = null; // Clear immediately to prevent re-use
      
      // Check if we stored an index directly (from toggleSelectedCompletion)
      if (typeof stored === 'string' && stored.startsWith('__index__')) {
        const rememberedIndex = parseInt(stored.replace('__index__', ''), 10);
        if (!isNaN(rememberedIndex) && rememberedIndex >= 0) {
          // Select the task at the remembered index (or closest valid index)
          const targetIndex = Math.min(rememberedIndex, orderedTasks.length - 1);
          if (targetIndex >= 0 && orderedTasks[targetIndex]) {
            setSelectedTaskId(orderedTasks[targetIndex].id);
            return;
          }
        }
      } else {
        // We stored a taskId (from handleUpdateTask checkbox click)
        const completedTaskId = stored;
        const completedIndex = orderedTasks.findIndex((t) => t.id === completedTaskId);
        
        if (completedIndex >= 0) {
          // Task still in list - select it (or next if filtered)
          const targetIndex = Math.min(completedIndex, orderedTasks.length - 1);
          if (orderedTasks[targetIndex]) {
            setSelectedTaskId(orderedTasks[targetIndex].id);
            return;
          }
        }
      }
      
      // Fallback after task completion: clear selection (don't auto-select first)
      setSelectedTaskId(null);
      return;
    }
    
    // Clear selection if the selected task no longer exists (don't auto-select first)
    if (selectedTaskId && !orderedTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(null);
    }
  }, [orderedTasks, selectedTaskId]);

  useEffect(() => {
    if (
      hoveredTaskId &&
      !orderedTasks.some((task) => task.id === hoveredTaskId)
    ) {
      setHoveredTaskId(null);
    }
  }, [hoveredTaskId, orderedTasks]);

  useEffect(() => {
    if (activeWidget !== 'tasks' || viewMode !== 'full') {
      setHoveredTaskId(null);
    }
  }, [activeWidget, viewMode]);

  useEffect(() => {
    if (!inspectorTaskId) return;
    if (!tasks.some((task) => task.id === inspectorTaskId)) {
      setInspectorTaskId(null);
    }
  }, [tasks, inspectorTaskId]);

  useEffect(() => {
    if (activeWidget !== 'tasks' || viewMode !== 'full') {
      setInspectorTaskId(null);
    }
  }, [activeWidget, viewMode]);

  const selectedTask = useMemo(() => {
    if (!selectedTaskId) return null;
    return orderedTasks.find((task) => task.id === selectedTaskId) ?? null;
  }, [orderedTasks, selectedTaskId]);

  const inspectorTask = useMemo(() => {
    if (!inspectorTaskId) return null;
    return tasks.find((task) => task.id === inspectorTaskId) ?? null;
  }, [tasks, inspectorTaskId]);

  const moveSelection = useCallback(
    (delta: number) => {
      if (!orderedTasks.length) return;
      if (!selectedTaskId) {
        setSelectedTaskId(orderedTasks[0].id);
        return;
      }
      const currentIndex = orderedTasks.findIndex(
        (task) => task.id === selectedTaskId
      );
      const safeIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex = Math.min(
        orderedTasks.length - 1,
        Math.max(0, safeIndex + delta)
      );
      if (nextIndex !== safeIndex) {
        setSelectedTaskId(orderedTasks[nextIndex].id);
      }
    },
    [orderedTasks, selectedTaskId]
  );

  const toggleSelectedCompletion = useCallback(async () => {
    if (!selectedTask || !notionSettings?.completedStatus) return;
    
    // Remember the index BEFORE completing, so we can select the next task
    const currentIndex = orderedTasks.findIndex((task) => task.id === selectedTask.id);
    if (currentIndex >= 0) {
      // Store the index we want to select after completion (same position)
      lastCompletedTaskIdRef.current = `__index__${currentIndex}`;
    }
    
    const isComplete = selectedTask.status === notionSettings.completedStatus;
    await handleUpdateTask(selectedTask.id, {
      status: isComplete ? defaultTodoStatus || null : notionSettings.completedStatus
    });
  }, [selectedTask, orderedTasks, notionSettings?.completedStatus, defaultTodoStatus, handleUpdateTask]);

  const applyOrderToSlots = useCallback(
    async (nextIds: string[]) => {
      if (!orderOptions.length) return;
      const slotAssignments = new Map<string, string | null>();
      nextIds.slice(0, orderOptions.length).forEach((taskId, index) => {
        const option = orderOptions[index];
        slotAssignments.set(taskId, option ? option.name : null);
      });
      tasks.forEach((task) => {
        if (!slotAssignments.has(task.id) && task.orderValue) {
          slotAssignments.set(task.id, null);
        }
      });
      const updates: Promise<void>[] = [];
      slotAssignments.forEach((nextValue, taskId) => {
        const current =
          tasks.find((task) => task.id === taskId)?.orderValue ?? null;
        if (current === nextValue) {
          return;
        }
        updates.push(handleUpdateTask(taskId, { orderValue: nextValue }));
      });
      if (updates.length) {
        await Promise.allSettled(updates);
      }
    },
    [orderOptions, tasks, handleUpdateTask]
  );

  const handleManualReorder = useCallback(
    (payload: ManualReorderPayload) => {
      const currentIds = orderedTasks.map((task) => task.id);
      if (!currentIds.includes(payload.sourceId)) return;
      const nextIds = currentIds.filter((id) => id !== payload.sourceId);
      let insertIndex: number;
      if (payload.targetId === '__end') {
        insertIndex = nextIds.length;
      } else {
        insertIndex = nextIds.indexOf(payload.targetId);
        if (insertIndex === -1) {
          insertIndex = nextIds.length;
        } else if (payload.position === 'below') {
          insertIndex += 1;
        }
      }
      nextIds.splice(insertIndex, 0, payload.sourceId);
      // If Notion order property is configured, persist; otherwise store locally
      if (persistOrderToNotion) {
        void applyOrderToSlots(nextIds);
      } else {
        setLocalOrderOverrides(nextIds);
      }
    },
    [orderedTasks, applyOrderToSlots, persistOrderToNotion]
  );

  const handleInspectTask = useCallback((taskId: string) => {
    setInspectorTaskId(taskId);
    setSelectedTaskId(taskId);
  }, []);

  const closeInspector = useCallback(() => {
    setInspectorTaskId(null);
  }, []);

  // Click-to-deselect: clear selection when clicking outside task rows
  const handleClickToDeselect = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Don't deselect if clicking on a task row or interactive element within it
    if (target.closest('.task-row')) {
      return;
    }
    // Don't deselect if clicking on actual interactive elements
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('a') ||
      target.closest('[role="button"]') ||
      target.closest('[role="option"]') ||
      target.closest('[role="listbox"]') ||
      target.closest('.task-group-header')
    ) {
      return;
    }
    // Clear selection
    setSelectedTaskId(null);
  }, []);

  useEffect(() => {
    if (activeWidget !== 'tasks' || viewMode !== 'full') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEditingTarget(event.target)) return;
      if (!orderedTasks.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelection(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelection(-1);
        return;
      }
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        selectedTaskId
      ) {
        event.preventDefault();
        setFocusTaskId((current) =>
          current === selectedTaskId ? null : selectedTaskId
        );
        return;
      }
      if (
        event.key === 'Enter' &&
        event.shiftKey &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        const targetTaskId = hoveredTaskId ?? selectedTaskId;
        if (!targetTaskId) return;
        if (selectedTaskId !== targetTaskId) {
          setSelectedTaskId(targetTaskId);
        }
        emitTaskShortcut({ type: 'notes', taskId: targetTaskId });
        return;
      }
      if (
        event.key === 'Enter' &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        event.preventDefault();
        const targetTaskId = hoveredTaskId ?? selectedTaskId;
        if (!targetTaskId) return;
        if (selectedTaskId !== targetTaskId) {
          setSelectedTaskId(targetTaskId);
        }
        emitTaskShortcut({ type: 'session', taskId: targetTaskId });
        return;
      }
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        (event.metaKey || event.ctrlKey) &&
        selectedTaskId
      ) {
        event.preventDefault();
        void toggleSelectedCompletion();
        return;
      }
      if (
        (event.key === 'o' || event.key === 'O') &&
        (event.metaKey || event.ctrlKey) &&
        selectedTask?.url
      ) {
        event.preventDefault();
        window.open(selectedTask.url, '_blank', 'noopener');
        return;
      }
      if (
        (event.key === 'p' || event.key === 'P') &&
        event.shiftKey &&
        (event.metaKey || event.ctrlKey) &&
        canUseWindowControls &&
        selectedTask
      ) {
        event.preventDefault();
        void handlePopOutTask(selectedTask.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    activeWidget,
    viewMode,
    orderedTasks.length,
    moveSelection,
    hoveredTaskId,
    selectedTaskId,
    selectedTask,
    toggleSelectedCompletion,
    canUseWindowControls,
    handlePopOutTask,
    emitTaskShortcut
  ]);

  useEffect(() => {
    if (focusTaskId && !tasks.some((task) => task.id === focusTaskId)) {
      setFocusTaskId(null);
    }
  }, [focusTaskId, tasks]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!canUndo || !undoDescription) {
      setUndoToastVisible(false);
      return;
    }
    setUndoToastVisible(true);
    const timeoutId = window.setTimeout(() => {
      setUndoToastVisible(false);
    }, UNDO_TOAST_TIMEOUT);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [canUndo, undoDescription]);

  useEffect(() => {
    if (focusTaskId) {
      setActiveWidget('tasks');
      setViewMode('full');
      setCollapsedView('button');
    setSelectedTaskId(focusTaskId);
    }
  }, [focusTaskId]);

  // Subscribe to focus stack changes from main process
  useEffect(() => {
    if (typeof widgetAPI.onFocusStackChange !== 'function') {
      return;
    }
    // Get initial state
    widgetAPI.getFocusStack?.().then((stack) => {
      setFocusStack(stack);
    }).catch(() => {
      // Ignore errors
    });
    
    const unsubscribe = widgetAPI.onFocusStackChange((stack) => {
      setFocusStack(stack);
      // Focus stack is just a holding area - don't auto-enter focus mode
    });
    return () => {
      unsubscribe?.();
    };
  }, [focusTaskId]);

  // Subscribe to cross-window drag state changes (to receive drops from fullscreen)
  useEffect(() => {
    if (typeof widgetAPI.onCrossWindowDragChange !== 'function') {
      return;
    }
    widgetAPI.getCrossWindowDragState?.().then((state) => {
      setCrossWindowDrag(state);
    }).catch(() => {});
    
    const unsubscribe = widgetAPI.onCrossWindowDragChange((state) => {
      setCrossWindowDrag(state);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  // Handle dropping a task from fullscreen onto the widget
  // This just adds to the focus stack (task queue) without entering focus mode
  const handleWidgetDrop = useCallback(async () => {
    if (!crossWindowDrag.isDragging || !crossWindowDrag.task) return;
    if (crossWindowDrag.sourceWindow === 'widget') return; // Don't drop onto self
    
    try {
      await widgetAPI.addToFocusStack?.(crossWindowDrag.task.id);
      widgetAPI.endCrossWindowDrag?.();
      // Don't enter focus mode - just add to the stack as a holding area
    } catch (error) {
      console.error('Failed to add to focus stack', error);
    }
    setFocusStackDropActive(false);
  }, [crossWindowDrag]);

  // Cancel cross-window drag with Escape in widget
  useEffect(() => {
    if (!crossWindowDrag.isDragging) return;
    
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        widgetAPI.endCrossWindowDrag?.();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [crossWindowDrag.isDragging]);

  // Handlers for focus stack drop zone in widget
  const handleFocusStackDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setFocusStackDropActive(true);
  }, []);

  const handleFocusStackDragLeave = useCallback(() => {
    setFocusStackDropActive(false);
  }, []);

  const handleFocusStackDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    setFocusStackDropActive(false);
    
    const taskId = event.dataTransfer.getData('application/x-task-id');
    if (taskId && !focusStack.includes(taskId)) {
      try {
        await widgetAPI.addToFocusStack?.(taskId);
        // Enter focus mode if not already
        if (!focusTaskId) {
          setFocusTaskId(taskId);
        }
      } catch (error) {
        console.error('Failed to add to focus stack', error);
      }
    }
  }, [focusStack, focusTaskId]);

  const handleRemoveFromFocusStack = useCallback(async (taskId: string) => {
    try {
      await widgetAPI.removeFromFocusStack?.(taskId);
      // If removing the current focus task, switch to next in stack
      if (focusTaskId === taskId) {
        const remaining = focusStack.filter(id => id !== taskId);
        setFocusTaskId(remaining[0] ?? null);
      }
    } catch (error) {
      console.error('Failed to remove from focus stack', error);
    }
  }, [focusStack, focusTaskId]);

  const handleClearFocusStack = useCallback(async () => {
    try {
      await widgetAPI.clearFocusStack?.();
      setFocusTaskId(null);
    } catch (error) {
      console.error('Failed to clear focus stack', error);
    }
  }, []);

  const handleStopSession = useCallback(
    async (taskId: string) => {
      stopCountdown(taskId);
      // Always set status to 📋 (clipboard) when stopping session
      await handleUpdateTaskStatus(taskId, { status: '📋' });
    },
    [stopCountdown, handleUpdateTaskStatus]
  );

  // Cross-window drag handlers for the widget
  const handleCrossWindowDragStart = useCallback(
    (task: Task) => {
      console.log('[Widget] Cross-window drag start:', task.title);
      if (typeof widgetAPI.startCrossWindowDrag === 'function') {
        void widgetAPI.startCrossWindowDrag(task, 'widget');
      } else {
        console.warn('[Widget] startCrossWindowDrag not available');
      }
    },
    []
  );

  // NOTE: When onDragEnd fires, we intentionally do NOT call endCrossWindowDrag
  // because the user might be releasing the drag over the fullscreen window.
  // The cross-window drag state stays active until:
  // 1. User clicks on a valid drop zone (handleCrossWindowDrop clears it)
  // 2. User presses Escape (escape handler clears it)
  // 3. User clicks elsewhere in fullscreen (click-to-cancel clears it)
  const handleCrossWindowDragEnd = useCallback(() => {
    // Intentionally empty - don't end cross-window drag on native dragend
    // The drag state will be cleared by the drop handler or cancel action
  }, []);

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
            const entry = await widgetAPI.getActiveTimeLogEntry(task.id);
            hydrationRequests.current.delete(task.id);
            if (cancelled || !entry) return;
            const startMs = entry.startTime
              ? Date.parse(entry.startTime)
              : Date.now();
            // Use endTime from date range (estimated end time for active sessions)
            let endMs = entry.endTime ? Date.parse(entry.endTime) : undefined;
            // If no endTime but we have duration, calculate it
            if ((!endMs || Number.isNaN(endMs)) && entry.durationMinutes) {
              endMs = startMs + entry.durationMinutes * 60 * 1000;
            }
            // If still no valid end time, skip hydration
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

  // Check if any session is active (must be after useCountdownTimer hook)
  const hasActiveSession = useMemo(() => {
    return tasks.some(
      (task) => task.status === '⌚' || isCountingDown(task.id)
    );
  }, [tasks, isCountingDown]);

  const handleResizePointerDown = useCallback(
    (direction: ResizeDirection) => (event: ReactPointerEvent) => {
      if (!canUseWindowControls) {
        return; // Resize not supported on mobile
      }
      
      event.preventDefault();
      event.stopPropagation();
      
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);
      
      let lastX = event.screenX;
      let lastY = event.screenY;
      console.log('[Resize] Start', direction, { lastX, lastY });

      const handleMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.screenX - lastX;
        const deltaY = moveEvent.screenY - lastY;
        if (deltaX !== 0 || deltaY !== 0) {
          console.log('[Resize] Move', direction, { deltaX, deltaY, screenX: moveEvent.screenX, screenY: moveEvent.screenY });
          if (typeof widgetAPI.resizeWindow === 'function') {
            widgetAPI.resizeWindow(direction, deltaX, deltaY);
          }
          lastX = moveEvent.screenX;
          lastY = moveEvent.screenY;
        }
      };

      const handleUp = (upEvent: PointerEvent) => {
        console.log('[Resize] End', direction);
        target.releasePointerCapture(upEvent.pointerId);
        target.removeEventListener('pointermove', handleMove);
        target.removeEventListener('pointerup', handleUp);
        target.removeEventListener('lostpointercapture', handleUp);
      };

      target.addEventListener('pointermove', handleMove);
      target.addEventListener('pointerup', handleUp);
      target.addEventListener('lostpointercapture', handleUp);
    },
    []
  );

  const toggleOrganizerPanel = (panel: Exclude<OrganizerPanel, null>) => {
    if (viewMode === 'capture') {
      return;
    }
    setActiveOrganizerPanel((previous) =>
      previous === panel ? null : panel
    );
  };

  const filterSummaryParts: string[] = [];
  if (dayFilter === 'today') {
    filterSummaryParts.push('Due today');
  } else if (dayFilter === 'tomorrow') {
    filterSummaryParts.push('Due tomorrow');
  } else if (dayFilter === 'week') {
    filterSummaryParts.push('Due this week');
  } else if (dayFilter === 'overdue') {
    filterSummaryParts.push('Overdue');
  } else if (dayFilter === 'has-date') {
    filterSummaryParts.push('Has a date');
  } else if (dayFilter === 'no-date') {
    filterSummaryParts.push('No date');
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
  const collapsedCueIcon =
    dockState.edge === 'left' ? '›' : dockState.edge === 'right' ? '‹' : '▼';

  return (
    <div
      className={`widget-shell ${dockClasses}`}
      onPointerEnter={handleShellPointerEnter}
      onPointerLeave={handleShellPointerLeave}
    >
      <div
        className={`widget-handle handle-${dockState.edge} ${!useHoverMode ? 'button-mode' : ''}`}
        onPointerEnter={handleHandlePointerEnter}
        onPointerLeave={handleHandlePointerLeave}
        onClick={handleHandleClick}
        role="button"
        tabIndex={0}
        aria-label={dockState.collapsed ? 'Expand widget' : 'Widget handle'}
      >
        <span />
        {dockState.collapsed && (() => {
          const activeTaskForCue = typeof isCountingDown === 'function'
            ? tasks.find((task) => isCountingDown(task.id))
            : null;
          return (
            <div className="collapsed-cue" aria-hidden="true">
              {hasActiveSession && activeTaskForCue ? (
                <div className="collapsed-timer-display">
                  <div className="collapsed-timer-task">{activeTaskForCue.title}</div>
                  <div className="collapsed-timer-time">
                    {formatTime(getRemainingTime(activeTaskForCue.id))}
                  </div>
                </div>
              ) : (
                <>
                  <span className="collapsed-cue-icon">{collapsedCueIcon}</span>
                  <span className="collapsed-cue-label">Menu</span>
                </>
              )}
            </div>
          );
        })()}
      </div>
      <div
        className={`widget-surface ${viewMode === 'capture' ? 'is-capture-mode' : ''} ${hasActiveSession ? 'has-active-session' : ''} ${crossWindowDrag.isDragging && crossWindowDrag.sourceWindow === 'fullscreen' ? 'is-receiving-drag' : ''}`}
        onPointerEnter={handleShellPointerEnter}
        onPointerLeave={handleShellPointerLeave}
        onClick={dockState.collapsed ? handleHandleClick : handleClickToDeselect}
        onDragOver={(e) => {
          if (crossWindowDrag.sourceWindow === 'fullscreen') {
            e.preventDefault();
            setFocusStackDropActive(true);
          }
        }}
        onDragLeave={() => setFocusStackDropActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          void handleWidgetDrop();
        }}
      >
        {/* Cross-window drop overlay - shows when dragging from fullscreen */}
        {crossWindowDrag.isDragging && crossWindowDrag.sourceWindow === 'fullscreen' && (
          <div 
            className="widget-cross-window-drop-overlay"
            onClick={() => void handleWidgetDrop()}
          >
            <div className="drop-overlay-content">
              <span className="drop-icon">📥</span>
              <span className="drop-text">Click to add "{crossWindowDrag.task?.title}" to queue</span>
            </div>
          </div>
        )}
        {viewMode === 'full' && (
          <header className="widget-header">
          {/* View selector - standalone island */}
          {activeWidget === 'tasks' && (
            <div className="view-selector-island">
              <ViewSelector
                dayFilter={dayFilter}
                matrixFilter={matrixFilter}
                deadlineFilter={deadlineFilter}
                statusFilter={statusFilter}
                sortRules={sortRules}
                grouping={grouping}
                activeWidget={activeWidget}
                onApplyView={handleApplyView}
              />
            </div>
          )}
          <div className="widget-toolbar-cluster">
            {!useHoverMode && (
              <button
                type="button"
                className="dynamic-button"
                onClick={handleDynamicButtonClick}
                aria-label={dockState.collapsed ? 'Expand widget' : 'Collapse widget'}
                title={dockState.collapsed ? 'Expand widget' : 'Collapse widget'}
              >
                Dynamic Button
              </button>
            )}
            {activeWidget === 'tasks' && (
              <div className="widget-toolbar">
                <div className="task-organizer">
                  <OrganizerIconButton
                    label="Filters"
                    icon={<FilterIcon />}
                    pressed={filtersPanelOpen}
                    highlighted={filterTriggerHighlighted}
                    onClick={() => toggleOrganizerPanel('filters')}
                    ariaControls="task-organizer-panel"
                    title={filtersPanelOpen ? 'Hide filters' : 'Show filters'}
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
                <div className="task-organizer">
                  <OrganizerIconButton
                    label="Search"
                    icon={<SearchIcon />}
                    pressed={searchExpanded}
                    highlighted={searchExpanded || Boolean(searchQuery)}
                    onClick={() => setSearchExpanded((prev) => !prev)}
                    ariaControls="widget-search-panel"
                    title={searchQuery ? `Search: "${searchQuery}"` : 'Search tasks'}
                  />
                </div>
                {searchQuery && (
                  <span className={`search-results-count ${orderedTasks.length > 0 ? 'has-results' : 'no-results'}`}>
                    {orderedTasks.length}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="header-actions">
            <div className="widget-switch widget-tabs">
              <button
                type="button"
                className={activeWidget === 'tasks' ? 'active' : ''}
                onClick={() => setActiveWidget('tasks')}
                title="Tasks"
              >
                <span className="tab-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6"/>
                    <line x1="8" y1="12" x2="21" y2="12"/>
                    <line x1="8" y1="18" x2="21" y2="18"/>
                    <line x1="3" y1="6" x2="3.01" y2="6"/>
                    <line x1="3" y1="12" x2="3.01" y2="12"/>
                    <line x1="3" y1="18" x2="3.01" y2="18"/>
                  </svg>
                </span>
                <span className="tab-count">{focusTaskId ? 1 : displayTasks.length}</span>
              </button>
              <button
                type="button"
                className={activeWidget === 'timelog' ? 'active' : ''}
                onClick={() => setActiveWidget('timelog')}
                title="Timelog"
              >
                <span className="tab-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                </span>
              </button>
              <button
                type="button"
                className={activeWidget === 'projects' ? 'active' : ''}
                onClick={() => setActiveWidget('projects')}
                title="Projects"
              >
                <span className="tab-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                </span>
                <span className="tab-count">{projectCount}</span>
              </button>
            </div>
            {focusTaskId && (
              <button
                className="pill ghost"
                type="button"
                onClick={() => setFocusTaskId(null)}
              >
                Exit focus
              </button>
            )}
            <div className="header-actions-right">
              <ImportQueueMenu onImportStarted={() => fetchTasks()} />
              <button
                type="button"
                className="icon-button"
                onClick={async () => {
                  try {
                    if (typeof widgetAPI.openFullScreenWindow === 'function') {
                      await widgetAPI.openFullScreenWindow();
                    }
                  } catch (error) {
                    console.error('Failed to open full-screen window:', error);
                  }
                }}
                title="Open full-screen view"
                aria-label="Open full-screen view"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
                  <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
                  <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
                  <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
                </svg>
              </button>
              <button
                type="button"
                className="gear-button"
                onClick={handleOpenSettings}
                title="Open Control Center"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </button>
            </div>
          </div>
        </header>
        )}
        
        {/* View tabs - Notion-style saved view tabs */}
        {viewMode === 'full' && activeWidget === 'tasks' && (
          <ViewTabs
            dayFilter={dayFilter}
            matrixFilter={matrixFilter}
            deadlineFilter={deadlineFilter}
            statusFilter={statusFilter}
            sortRules={sortRules}
            grouping={grouping}
            activeWidget={activeWidget}
            activeViewId={activeViewId}
            onApplyView={handleApplyView}
            onActiveViewChange={setActiveViewId}
            onResetFilters={handleResetFilters}
          />
        )}
        
        {/* Expandable search panel */}
        {activeWidget === 'tasks' && searchExpanded && (
          <div id="widget-search-panel" className="widget-search-panel">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search tasks…"
              autoFocus
            />
            {searchQuery && (
              <span className={`search-results-count inline ${orderedTasks.length > 0 ? 'has-results' : 'no-results'}`}>
                {orderedTasks.length} {orderedTasks.length === 1 ? 'result' : 'results'}
              </span>
            )}
          </div>
        )}
        
        {activeWidget === 'tasks' ? (
          <section className={`log-surface task-log ${viewMode === 'capture' ? 'is-capture-mode' : ''}`}>
            <div className={`task-log-body ${!quickAddCollapsed ? 'has-quick-add' : ''}`}>
              {!isFocusMode && (
                <div
                  id="task-organizer-panel"
                  className={`task-filter-bar ${
                    organizerPanelOpen ? 'is-open' : 'is-collapsed'
                  }`}
                  role="region"
                  aria-label={organizerPanelLabel}
                  aria-hidden={!organizerPanelOpen}
                >
                  {filtersPanelOpen && (
                    <div className="task-organizer-pane">
                      <FilterPillsToolbar
                        dayFilter={dayFilter}
                        deadlineFilter={deadlineFilter}
                        statusFilter={statusFilter}
                        matrixFilter={matrixFilter}
                        onDayFilterChange={setDayFilter}
                        onDeadlineFilterChange={setDeadlineFilter}
                        onStatusFilterChange={setStatusFilter}
                        onMatrixFilterChange={setMatrixFilter}
                        sortCount={sortRules.length}
                        onSortClick={() => setActiveOrganizerPanel('sort')}
                      />
                      <div className="task-organizer-section-footer">
                        <p className="task-organizer-section-title">
                          Filters
                        </p>
                        <span className="task-organizer-section-meta">
                          {filterSummary}
                        </span>
                        <div className="task-organizer-section-actions">
                          <button
                            type="button"
                            className="task-organizer-close"
                            onClick={() => setActiveOrganizerPanel(null)}
                            aria-label="Collapse organizer panel"
                          >
                            ↖
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {sortPanelOpen && (
                    <div className="task-organizer-pane">
                      <SortPanel
                        sortRules={sortRules}
                        onSortRulesChange={setSortRules}
                        onClose={() => setActiveOrganizerPanel(null)}
                      />
                    </div>
                  )}
                  {groupPanelOpen && (
                    <div className="task-organizer-pane">
                      <GroupPanel
                        grouping={grouping}
                        onGroupingChange={setGrouping}
                        onClose={() => setActiveOrganizerPanel(null)}
                      />
                    </div>
                  )}
                </div>
              )}
                {viewMode === 'full' && (
                <TaskList
                  tasks={orderedTasks}
                  loading={listLoading}
                  error={error}
                  statusOptions={statusOptions}
                  orderOptions={orderOptions}
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
                  selectedTaskId={selectedTaskId}
                  onSelectTask={setSelectedTaskId}
                  onHoverTask={setHoveredTaskId}
                  manualOrderingEnabled={manualOrderingEnabled}
                  onManualReorder={
                    manualOrderingEnabled ? handleManualReorder : undefined
                  }
                  shortcutSignal={taskShortcutSignal}
                  onShortcutHandled={handleTaskShortcutHandled}
                  enableExternalDrag={true}
                  onTaskDragStart={(task) => {
                    console.log('[Widget] TaskList onTaskDragStart called for:', task.title);
                    handleCrossWindowDragStart(task);
                  }}
                  onTaskDragEnd={handleCrossWindowDragEnd}
                  projects={projects}
                  onAddSubtask={async (parentTaskId, title) => {
                    try {
                      const newTask = await widgetAPI.addTask({
                        title,
                        parentTaskId
                      });
                      
                      // Update the tasks state with the new subtask and updated parent
                      setTasks((prev) => {
                        // Add the new subtask
                        const updated = [newTask, ...prev];
                        
                        // Find and update the parent task's subtaskProgress
                        return updated.map(task => {
                          if (task.id === parentTaskId) {
                            const currentSubtasks = prev.filter(t => t.parentTaskId === parentTaskId);
                            const subtaskCount = currentSubtasks.length + 1;
                            const completedCount = currentSubtasks.filter(t => {
                              const status = (t.normalizedStatus || t.status || '').toLowerCase();
                              return status === 'done' || status.includes('complete');
                            }).length;
                            
                            return {
                              ...task,
                              subtaskIds: [...(task.subtaskIds || []), newTask.id],
                              subtaskProgress: { completed: completedCount, total: subtaskCount }
                            };
                          }
                          return task;
                        });
                      });
                      
                      return newTask;
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : 'Unable to create subtask'
                      );
                    }
                  }}
                  collapseTimeColumn={appPreferences?.collapseTimeColumn}
                  collapseProjectColumn={appPreferences?.collapseProjectColumn}
                  autoExpandProjectRow={appPreferences?.autoExpandProjectRow}
                />
              )}
              {/* Task Queue Panel - shows when there are queued tasks */}
              {focusStack.length > 0 && (
                <div
                  className={`widget-focus-stack-panel ${focusStackDropActive ? 'is-drop-active' : ''}`}
                  onDragOver={handleFocusStackDragOver}
                  onDragLeave={handleFocusStackDragLeave}
                  onDrop={handleFocusStackDrop}
                >
                  <div className="focus-stack-header">
                    <span className="focus-stack-title">📋 Task Queue ({focusStack.length})</span>
                    <button
                      type="button"
                      className="focus-stack-clear"
                      onClick={handleClearFocusStack}
                      title="Clear all"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="focus-stack-items">
                    {focusStack.map((taskId) => {
                      const task = tasks.find((t) => t.id === taskId);
                      if (!task) return null;
                      return (
                        <div
                          key={taskId}
                          className="focus-stack-item"
                          onClick={() => {
                            // Open task in a floating window when clicked
                            if (typeof widgetAPI.openTaskWindow === 'function') {
                              void widgetAPI.openTaskWindow(taskId);
                            }
                          }}
                        >
                          <span className="focus-stack-item-title">{task.title}</span>
                          <button
                            type="button"
                            className="focus-stack-item-remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleRemoveFromFocusStack(taskId);
                            }}
                            title="Remove from queue"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {focusStackDropActive && (
                    <div className="focus-stack-drop-hint">
                      Drop here to add to queue
                    </div>
                  )}
                </div>
              )}
              
              {/* Task queue drop zone - shows when dragging and stack is empty */}
              {focusStack.length === 0 && focusStackDropActive && (
                <div
                  className="widget-focus-drop-zone is-active"
                  onDragOver={handleFocusStackDragOver}
                  onDragLeave={handleFocusStackDragLeave}
                  onDrop={handleFocusStackDrop}
                >
                  <div className="focus-drop-zone-content">
                    <span className="focus-drop-icon">📋</span>
                    <span>Drop to add to queue</span>
                  </div>
                </div>
              )}
              
              {completedTaskId && (
                <div
                  style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    background: '#4CAF50',
                    color: 'white',
                    padding: '20px 40px',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    zIndex: 10000,
                    fontSize: '18px',
                    fontWeight: 'bold',
                    textAlign: 'center',
                    animation: 'fadeIn 0.3s ease-in'
                  }}
                >
                  ✅ Session Complete!
                </div>
              )}
              {!isFocusMode && (
                <QuickAdd
                  onAdd={handleAddTask}
                  statusOptions={statusOptions}
                  manualStatuses={manualStatuses}
                  completedStatus={notionSettings?.completedStatus}
                  isCollapsed={quickAddCollapsed}
                  onCollapseToggle={() =>
                    setQuickAddCollapsed(!quickAddCollapsed)
                  }
                  projects={projects}
                />
              )}
              {!dockState.collapsed && renderBottomControls('inline')}
            </div>
          </section>
        ) : activeWidget === 'writing' ? (
          <section className="writing-tab-section">
            <WritingWidget
              settings={writingSettings}
              onCreate={handleCreateWritingEntry}
            />
            {!dockState.collapsed && renderBottomControls('inline')}
          </section>
        ) : activeWidget === 'timelog' ? (
          <section className="timelog-tab-section">
            <TimeLogWidget settings={timeLogSettings} />
            {!dockState.collapsed && renderBottomControls('inline')}
          </section>
        ) : activeWidget === 'projects' ? (
          <section className="projects-tab-section">
            <ProjectsWidget
              settings={projectsSettings}
              tasks={tasks}
              completedStatus={notionSettings?.completedStatus}
              onProjectCountChange={setProjectCount}
              onCreateWritingEntry={handleCreateWritingEntry}
              statusOptions={statusOptions}
              onUpdateTask={handleUpdateTask}
              onCreateTask={handleCreateTaskFromProject}
            />
            {!dockState.collapsed && renderBottomControls('inline')}
          </section>
        ) : null}
        {dockState.collapsed && renderBottomControls('collapsed')}
      </div>
      {canUseWindowControls && !dockState.collapsed && (
        <>
          <div
            className="resize-handle edge-left"
            onPointerDown={handleResizePointerDown('left')}
          />
          <div
            className="resize-handle edge-right"
            onPointerDown={handleResizePointerDown('right')}
          />
          <div
            className="resize-handle edge-top"
            onPointerDown={handleResizePointerDown('top')}
          />
          <div
            className="resize-handle edge-bottom"
            onPointerDown={handleResizePointerDown('bottom')}
          />
          <div
            className="resize-handle corner top-left"
            onPointerDown={handleResizePointerDown('top-left')}
          />
          <div
            className="resize-handle corner top-right"
            onPointerDown={handleResizePointerDown('top-right')}
          />
          <div
            className="resize-handle corner bottom-left"
            onPointerDown={handleResizePointerDown('bottom-left')}
          />
          <div
            className="resize-handle corner bottom-right"
            onPointerDown={handleResizePointerDown('bottom-right')}
          />
        </>
      )}
      {inspectorTask && (
        <div className="task-inspector-layer">
          <button
            type="button"
            className="task-inspector-backdrop"
            aria-label="Close task inspector"
            onClick={closeInspector}
          />
          <TaskInspectorPanel
            task={inspectorTask}
            statusOptions={statusOptions}
            completedStatus={notionSettings?.completedStatus}
            onClose={closeInspector}
            onUpdateTask={handleUpdateTask}
          />
        </div>
      )}
      {/* Undo Toast */}
      {undoToastVisible && canUndo && undoDescription && (
        <div className="undo-toast">
          <span className="undo-toast-text">{undoDescription}</span>
          <button
            type="button"
            className="undo-toast-btn"
            onClick={() => void undo()}
          >
            Undo
          </button>
          <span className="undo-toast-shortcut">Ctrl+Z</span>
        </div>
      )}
      {/* AI Chatbot Panel */}
      {chatbotOpen && (
        <div className="chatbot-sidebar-overlay">
          <ChatbotPanel
            tasks={tasks}
            projects={projects}
            onTasksUpdated={() => void fetchTasks()}
            onClose={() => setChatbotOpen(false)}
          />
        </div>
      )}
    </div>
  );
};

export default App;

