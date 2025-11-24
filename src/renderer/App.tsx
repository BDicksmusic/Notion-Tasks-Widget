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
  Task,
  TaskStatusOption,
  TaskUpdatePayload,
  NotionCreatePayload,
  NotionSettings,
  TimeLogEntryPayload,
  TimeLogSettings,
  WritingEntryPayload,
  WritingSettings,
  ResizeDirection
} from '@shared/types';
import TaskList from './components/TaskList';
import QuickAdd from './components/QuickAdd';
import WritingWidget from './components/WritingWidget';
import TimeLogWidget from './components/TimeLogWidget';
import { playWidgetSound } from './utils/sounds';
import {
  FilterIcon,
  GroupButton,
  GroupPanel,
  OrganizerIconButton,
  SortButton,
  SortPanel
} from './components/TaskOrganizerControls';
import { matrixOptions } from './constants/matrix';
import { PREFERENCE_DEFAULTS } from './constants/preferences';
import {
  STATUS_FILTERS,
  type StatusFilterValue,
  mapStatusToFilterValue
} from '@shared/statusFilters';
import { platformBridge, widgetBridge } from '@shared/platform';
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

const COLLAPSE_DELAY = 4200;
const THIN_STATE_DELAY = 4000;
const SORT_HOLD_DURATION = 7000;
const SORT_RULES_STORAGE_KEY = 'widget.sort.rules';
const GROUPING_STORAGE_KEY = 'widget.group.option';
const FILTER_PANEL_STORAGE_KEY = 'widget.filters.visible';
type OrganizerPanel = 'filters' | 'sort' | 'group' | null;

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

const widgetAPI = widgetBridge;
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
  const [sortHold, setSortHold] = useState<Record<string, number>>({});
  const [displayTasks, setDisplayTasks] = useState<Task[]>([]);
  const [quickAddCollapsed, setQuickAddCollapsed] = useState(false);
  const [collapsedView, setCollapsedView] = useState<'button' | 'thin'>('button');
  const [viewMode, setViewMode] = useState<'full' | 'capture'>('full');
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const isFocusMode = Boolean(focusTaskId);
  const manualStatuses = notionSettings?.statusPresets ?? [];
  const pinned = appPreferences?.pinWidget ?? false;
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskListScrollRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    fetchTasks();
    loadStatusOptions();
    widgetAPI.getAppPreferences().then(setAppPreferences);
    widgetAPI.getSettings().then(setNotionSettings);
    widgetAPI.getWritingSettings().then(setWritingSettings);
    const unsubscribe = widgetAPI.onDockStateChange((state) => {
      setDockState(state);
    });
    return () => {
      unsubscribe?.();
      if (collapseTimer.current) {
        clearTimeout(collapseTimer.current);
      }
    };
  }, [fetchTasks, loadStatusOptions]);

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
    if (!appPreferences?.autoRefreshTasks) return;
    const interval = window.setInterval(() => {
      fetchTasks();
    }, 5 * 60 * 1000);
    return () => {
      clearInterval(interval);
    };
  }, [appPreferences?.autoRefreshTasks, fetchTasks]);

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

  const handleCreateTimeLogEntry = useCallback(
    async (payload: TimeLogEntryPayload) => {
      await widgetAPI.createTimeLogEntry(payload);
    },
    []
  );

  const handleOpenWidgetSettings = useCallback(() => {
    if (typeof widgetAPI.openWidgetSettingsWindow === 'function') {
      widgetAPI
        .openWidgetSettingsWindow()
        .catch((err) => {
          console.error('Unable to open widget settings window', err);
        });
      return;
    }
    console.warn(
      'openWidgetSettingsWindow API unavailable, falling back to Control Center'
    );
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
    thinTimer.current = window.setTimeout(() => {
      // 1. Update UI to thin state (starts CSS animation)
      setCollapsedView('thin');
      // 2. Wait for CSS animation (200ms), then shrink window
      setTimeout(() => {
        widgetAPI.setThinState(true);
      }, 200);
    }, THIN_STATE_DELAY);
  }, [dockState.collapsed, clearThinTimer]);

  useEffect(() => {
    if (dockState.collapsed) {
      setCollapsedView('button');
      setQuickAddCollapsed(true);
      setViewMode('full');
      widgetAPI.setThinState(false);
      widgetAPI.setCaptureState(false);
      // Check if we should prevent minimal view during active session
      // Note: isCountingDown will be available when this effect runs
      const hasActiveSessionNow = typeof isCountingDown === 'function' 
        ? tasks.some((task) => isCountingDown(task.id))
        : false;
      if (!(hasActiveSessionNow && (appPreferences?.preventMinimalDuringSession !== false))) {
        scheduleThinState();
      }
    } else {
      setCollapsedView('button');
      widgetAPI.setThinState(false);
      clearThinTimer();
    }
    return () => {
      clearThinTimer();
    };
  }, [dockState.collapsed, scheduleThinState, clearThinTimer, tasks, appPreferences?.preventMinimalDuringSession]);

  const handleCollapsedControlsEnter = useCallback(() => {
    if (!dockState.collapsed) return;
    clearThinTimer();
    
    // 1. Expand window immediately
    widgetAPI.setThinState(false);
    
    // 2. Wait a tick for window to expand, then show button UI
    // This ensures the window is large enough before the UI expands
    requestAnimationFrame(() => {
      setCollapsedView('button');
    });
  }, [dockState.collapsed, clearThinTimer]);

  const handleCollapsedControlsLeave = useCallback(() => {
    if (!dockState.collapsed) return;
    // Check if we should prevent minimal view during active session
    const hasActiveSessionNow = typeof isCountingDown === 'function'
      ? tasks.some((task) => isCountingDown(task.id))
      : false;
    if (!(hasActiveSessionNow && (appPreferences?.preventMinimalDuringSession !== false))) {
      scheduleThinState();
    }
  }, [dockState.collapsed, scheduleThinState, tasks, appPreferences?.preventMinimalDuringSession]);

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
    if (useHoverMode && autoCollapse && dockState.collapsed) {
      triggerExpand();
    }
  }, [triggerExpand, dockState.collapsed, useHoverMode, autoCollapse]);

  const handleHandlePointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!useHoverMode || !autoCollapse || pinned || !dockState.collapsed) return;
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
        // Check if we should prevent minimal view during active session
        const hasActiveSessionNow = typeof isCountingDown === 'function'
          ? tasks.some((task) => isCountingDown(task.id))
          : false;
        if (!(hasActiveSessionNow && (appPreferences?.preventMinimalDuringSession !== false))) {
          scheduleThinState();
        }
      }
    },
    [dockState.collapsed, pinned, handlePinToggle, clearThinTimer, scheduleThinState, tasks, appPreferences?.preventMinimalDuringSession]
  );

  const handleHandleClick = useCallback(() => {
    if (dockState.collapsed) {
      triggerExpand();
    }
  }, [dockState.collapsed, triggerExpand]);

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
    const buttonText = dockState.collapsed
      ? 'Open Widget'
      : isCaptureMode
        ? 'Open Full Widget'
        : 'Collapse Widget';
    const buttonLabel = dockState.collapsed
      ? 'Open Widget'
      : isCaptureMode
        ? 'Open Full Widget'
        : 'Collapse Widget';

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
      return (
        <div
          className={wrapperClasses}
          style={collapsedPositionStyle}
          onPointerEnter={handleCollapsedControlsEnter}
          onPointerLeave={handleCollapsedControlsLeave}
        >
          {showTimerInCollapsed ? (
            <div className="collapsed-timer-display">
              <div className="collapsed-timer-task">{activeTaskForCollapsed?.title || 'Active Session'}</div>
              <div className="collapsed-timer-time">
                {formattedCollapsedTime}
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="thin-indicator"
              aria-label="Open Widget"
              title="Open Widget"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleWidgetToggleClick(e);
              }}
            >
              <span />
            </button>
          )}
        </div>
      );
    }

    const enableThinHoverHandlers =
      isCollapsedVariant && collapsedView === 'thin';

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

    return (
      <div
        className={wrapperClasses}
        style={collapsedPositionStyle}
        onPointerEnter={enableThinHoverHandlers ? handleCollapsedControlsEnter : undefined}
        onPointerLeave={enableThinHoverHandlers ? handleCollapsedControlsLeave : undefined}
      >
        <div className="bottom-controls-left">
          {collapsedSessionIndicator}
          <button
            type="button"
            className={`widget-toggle-button ${buttonIsInOpenState ? 'is-collapsed' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('Widget toggle button clicked');
              
              if (isCaptureMode) {
                // If in capture mode, expand to full
                if (appPreferences?.enableSounds) {
                  playWidgetSound('expand');
                }
                setViewMode('full');
                widgetAPI.setCaptureState(false);
                widgetAPI.requestExpand();
              } else {
                // Standard toggle
                handleWidgetToggleClick(e);
              }
            }}
            aria-label={buttonLabel}
            title={buttonLabel}
          >
            <span className="widget-toggle-text">
              {buttonText}
            </span>
          </button>
          {!isCollapsedVariant && (
            <button
              type="button"
              className={`pin-toggle ${pinned ? 'is-active' : ''}`}
              onClick={() => handlePinToggle(!pinned)}
              aria-pressed={pinned}
              title="Keep the widget from auto-collapsing on hover"
            >
              <span className="pin-icon" aria-hidden="true">
                ✔
              </span>
              <span>Pin</span>
            </button>
          )}
        </div>
        <div className="bottom-controls-right">
          {!isCollapsedVariant && (
            <>
              <button
                type="button"
                className="icon-button"
                onClick={fetchTasks}
                title="Refresh tasks"
                aria-label="Refresh tasks"
              >
                ⟳
              </button>
              {canUseWindowControls && (
                <button
                  type="button"
                  className="icon-button"
                  onClick={async () => {
                    try {
                      await widgetAPI.openFullScreenWindow();
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
                  // If in Capture Mode, closing Quick Capture should collapse the widget
                  handleWidgetToggleClick();
                } else {
                  setQuickAddCollapsed(!quickAddCollapsed);
                }
              }}
              aria-expanded={!quickAddCollapsed}
              aria-label={
                isCollapsedVariant
                  ? 'Open Quick Capture'
                  : quickAddCollapsed
                    ? 'Open Quick Capture'
                    : 'Collapse Quick Capture'
              }
            >
              {isCollapsedVariant
                ? 'Open Quick Capture'
                : quickAddCollapsed
                  ? 'Open Quick Capture'
                  : 'Collapse Quick Capture'}
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

    return tasks.filter((task) => {
      const normalizedStatus =
        task.normalizedStatus ?? mapStatusToFilterValue(task.status);
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
      return true;
    });
  }, [tasks, dayFilter, matrixFilter, deadlineFilter, statusFilter]);

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
        : groupTasks(displayTasks, grouping),
    [displayTasks, grouping]
  );

  const visibleGrouping: GroupingOption = isFocusMode ? 'none' : grouping;
  const visibleGroups = isFocusMode ? undefined : taskGroups;

  const filterEmptyMessage =
    dayFilter === 'today'
      ? 'No tasks due today match these filters.'
      : dayFilter === 'week'
        ? 'No tasks due this week match these filters.'
      : 'No tasks match the current filters.';

  const handleUpdateTask = useCallback(
    async (taskId: string, updates: TaskUpdatePayload) => {
      try {
        const updated = await widgetAPI.updateTask(taskId, updates);
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

  useEffect(() => {
    if (focusTaskId) {
      setActiveWidget('tasks');
      setViewMode('full');
      setCollapsedView('button');
    }
  }, [focusTaskId]);

  const handleStopSession = useCallback(
    async (taskId: string) => {
      stopCountdown(taskId);
      // Always set status to 📋 (clipboard) when stopping session
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
      event.preventDefault();
      event.stopPropagation();
      let lastX = event.screenX;
      let lastY = event.screenY;

      const handleMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.screenX - lastX;
        const deltaY = moveEvent.screenY - lastY;
        if (deltaX !== 0 || deltaY !== 0) {
          widgetAPI.resizeWindow(direction, deltaX, deltaY);
          lastX = moveEvent.screenX;
          lastY = moveEvent.screenY;
        }
      };

      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
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
        className={`widget-surface ${viewMode === 'capture' ? 'is-capture-mode' : ''} ${hasActiveSession ? 'has-active-session' : ''}`}
        onPointerEnter={handleShellPointerEnter}
        onPointerLeave={handleShellPointerLeave}
        onClick={dockState.collapsed ? handleHandleClick : undefined}
      >
        {viewMode === 'full' && (
          <header className="widget-header">
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
                {filterSummaryParts.length > 0 && (
                  <span className="filter-summary-text" title={filterSummary}>
                    {filterSummary}
                  </span>
                )}
              </div>
            )}
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
              <button
                type="button"
                className={activeWidget === 'timelog' ? 'active' : ''}
                onClick={() => setActiveWidget('timelog')}
              >
                Timelog
              </button>
              <button
                type="button"
                className={activeWidget === 'projects' ? 'active' : ''}
                onClick={() => setActiveWidget('projects')}
              >
                Projects
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
            <button
              type="button"
              className="gear-button"
              onClick={handleOpenWidgetSettings}
            >
              ⚙️
            </button>
          </div>
        </header>
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
                    <div className="task-organizer-section">
                      <div className="filter-row">
                        <div className="filter-cell align-start">
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
                        </div>
                        <div className="filter-cell align-end">
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
                        </div>
                      </div>
                      <div className="filter-row">
                        <div className="filter-cell align-start">
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
                        </div>
                        <div className="filter-cell align-end">
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
                                className={
                                  matrixFilter === option.id ? 'active' : ''
                                }
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
                      </div>
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
                  </div>
                    )}
                  </div>
                )}
                {sortPanelOpen && !isFocusMode && (
                  <div className="task-organizer-pane">
                    <SortPanel
                      sortRules={sortRules}
                      onSortRulesChange={setSortRules}
                      onClose={() => setActiveOrganizerPanel(null)}
                    />
                  </div>
                )}
                {groupPanelOpen && !isFocusMode && (
                  <div className="task-organizer-pane">
                    <GroupPanel
                      grouping={grouping}
                      onGroupingChange={setGrouping}
                      onClose={() => setActiveOrganizerPanel(null)}
                    />
                  </div>
                )}
                {viewMode === 'full' && (
                <TaskList
                  tasks={orderedTasks}
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
                />
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
                />
              )}
              {!dockState.collapsed && renderBottomControls('inline')}
            </div>
          </section>
        ) : activeWidget === 'writing' ? (
          <WritingWidget
            settings={writingSettings}
            onCreate={handleCreateWritingEntry}
          />
        ) : activeWidget === 'timelog' ? (
          <TimeLogWidget settings={timeLogSettings} />
        ) : activeWidget === 'projects' ? (
          <div className="projects-widget log-surface" style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>
            <h2>Projects</h2>
            <p>Projects widget coming soon...</p>
            <p style={{ fontSize: '0.9em', marginTop: '0.5rem' }}>
              This will integrate with your Notion projects database.
            </p>
          </div>
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
    </div>
  );
};

export default App;
