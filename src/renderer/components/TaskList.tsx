import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  MouseEvent as ReactMouseEvent,
  DragEvent as ReactDragEvent
} from 'react';
import type {
  Project,
  Task,
  TaskOrderOption,
  TaskStatusOption,
  TaskUpdatePayload
} from '@shared/types';
import {
  getMatrixClass,
  matrixOptions,
  findMatrixOptionById,
  findMatrixOptionFromFlags,
  type MatrixOptionId
} from '../constants/matrix';
import DateField from './DateField';
import { StatusSelect } from './StatusSelect';
import { getStatusColorClass, getStatusColorClassFromNotionColor } from '../utils/statusColors';
import type { GroupingOption, TaskGroup } from '../utils/sorting';
import MassEditToolbar from './MassEditToolbar';

// Virtualization constants
const TASK_ROW_HEIGHT = 56; // Approximate height of a task row in pixels
const BUFFER_SIZE = 10; // Number of extra items to render above/below viewport
const INITIAL_RENDER_COUNT = 30; // Initial number of tasks to render for fast first paint

const POP_OUT_INTERACTIVE_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'label',
  'a'
].join(', ');

export type TaskShortcutAction =
  | { type: 'session'; taskId: string }
  | { type: 'notes'; taskId: string };

export interface TaskShortcutSignal {
  id: number;
  action: TaskShortcutAction;
}

interface Props {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  statusOptions: TaskStatusOption[];
  manualStatuses: string[];
  completedStatus?: string;
  onUpdateTask(
    taskId: string,
    updates: TaskUpdatePayload
  ): Promise<Task | void>;
  emptyMessage?: string;
  grouping?: GroupingOption;
  groups?: TaskGroup[];
  sortHold?: Record<string, number>;
  holdDuration?: number;
  onPopOutTask?: (task: Task) => void;
  disableSortHoldIndicators?: boolean;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  onScrollToCenter?: (element: HTMLElement) => void;
  getRemainingTime?: (taskId: string) => number;
  getEndTime?: (taskId: string) => Date | null;
  formatTime?: (seconds: number) => string;
  formatEndTime?: (date: Date) => string;
  isCountingDown?: (taskId: string) => boolean;
  startCountdown?: (taskId: string, minutes: number) => void;
  extendCountdown?: (taskId: string, minutes: number) => void;
  onStopSession?: (taskId: string) => void;
  onFocusTask?: (taskId: string | null) => void;
  focusTaskId?: string | null;
  isFocusMode?: boolean;
  orderOptions?: TaskOrderOption[];
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string | null) => void;
  manualOrderingEnabled?: boolean;
  onManualReorder?: (payload: {
    sourceId: string;
    targetId: string | '__end';
    position: 'above' | 'below';
  }) => void;
  onInspectTask?: (taskId: string) => void;
  onHoverTask?: (taskId: string | null) => void;
  shortcutSignal?: TaskShortcutSignal | null;
  onShortcutHandled?: (id: number) => void;
  enableExternalDrag?: boolean;
  onTaskDragStart?: (task: Task, event: ReactDragEvent<HTMLElement>) => void;
  onTaskDragEnd?: () => void;
  projects?: Project[];
  onAddSubtask?: (parentTaskId: string, title: string) => Promise<Task | void>;
  // Collapsible columns settings
  collapseTimeColumn?: boolean;    // Column 3: Estimate time, Start session
  collapseProjectColumn?: boolean; // Column 4: Add to project, Add subtasks
  autoExpandProjectRow?: boolean;  // When true, auto-expand project row if task has a project
}

const NOTION_COLOR_MAP: Record<
  string,
  {
    bg: string;
    text: string;
  }
> = {
  default: { bg: 'rgba(148, 163, 184, 0.25)', text: '#e2e8f0' },
  gray: { bg: 'rgba(148, 163, 184, 0.35)', text: '#f8fafc' },
  brown: { bg: 'rgba(120, 53, 15, 0.4)', text: '#fff7ed' },
  orange: { bg: 'rgba(249, 115, 22, 0.4)', text: '#fff7ed' },
  yellow: { bg: 'rgba(234, 179, 8, 0.45)', text: '#1f2937' },
  green: { bg: 'rgba(34, 197, 94, 0.35)', text: '#ecfdf5' },
  blue: { bg: 'rgba(59, 130, 246, 0.35)', text: '#dbeafe' },
  purple: { bg: 'rgba(147, 51, 234, 0.35)', text: '#f3e8ff' },
  pink: { bg: 'rgba(236, 72, 153, 0.35)', text: '#fdf4ff' },
  red: { bg: 'rgba(239, 68, 68, 0.35)', text: '#fee2e2' }
};

const getOrderBadgeStyle = (token?: string) =>
  NOTION_COLOR_MAP[token ?? 'default'] ?? NOTION_COLOR_MAP.default;

type CompletionVariant = 'complete' | 'undo';

let completionAudioCtx: AudioContext | null = null;

const playCompletionSound = (variant: CompletionVariant) => {
  if (typeof window === 'undefined') return;
  const AudioCtor =
    window.AudioContext ||
    (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
  if (!AudioCtor) return;
  if (!completionAudioCtx) {
    completionAudioCtx = new AudioCtor();
  }
  const ctx = completionAudioCtx;
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.value = variant === 'complete' ? 880 : 520;
  const now = ctx.currentTime;
  gainNode.gain.setValueAtTime(0.14, now);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  oscillator.connect(gainNode).connect(ctx.destination);
  oscillator.start();
  oscillator.stop(now + 0.25);
};

const TaskList = ({
  tasks,
  loading,
  error,
  statusOptions,
  manualStatuses,
  completedStatus,
  onUpdateTask,
  emptyMessage,
  grouping = 'none',
  groups,
  sortHold,
  holdDuration = 7000,
  onPopOutTask,
  disableSortHoldIndicators = false,
  scrollContainerRef,
  onScrollToCenter,
  getRemainingTime,
  getEndTime,
  formatTime,
  formatEndTime,
  isCountingDown,
  startCountdown,
  extendCountdown,
  onStopSession,
  onFocusTask,
  focusTaskId,
  isFocusMode,
  orderOptions = [],
  selectedTaskId,
  onSelectTask,
  manualOrderingEnabled,
  onManualReorder,
  onInspectTask,
  onHoverTask,
  shortcutSignal,
  onShortcutHandled,
  enableExternalDrag,
  onTaskDragStart,
  onTaskDragEnd,
  projects = [],
  onAddSubtask,
  collapseTimeColumn = false,
  collapseProjectColumn = false,
  autoExpandProjectRow = false
}: Props) => {
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [customStatusDrafts, setCustomStatusDrafts] = useState<
    Record<string, string>
  >({});
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleDrafts, setTitleDrafts] = useState<Record<string, string>>({});
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>(
    {}
  );
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [expandedTrackingData, setExpandedTrackingData] = useState<Record<string, boolean>>({});
  const [trackingData, setTrackingData] = useState<Record<string, any[]>>({});
  const [expandedSessionTimer, setExpandedSessionTimer] = useState<Record<string, boolean>>({});
  const [sessionInputs, setSessionInputs] = useState<Record<string, { value: string; unit: 'minutes' | 'hours' }>>({});
  const [sessionSettingsOpen, setSessionSettingsOpen] = useState<Record<string, boolean>>({});
  const [sessionPresets, setSessionPresets] = useState<{ label: string; minutes: number }[]>([
    { label: '15m', minutes: 15 },
    { label: '25m', minutes: 25 },
    { label: '45m', minutes: 45 },
    { label: '1h', minutes: 60 },
  ]);
  const [sessionPresetInput, setSessionPresetInput] = useState('');
  const [expandedEstimateEditor, setExpandedEstimateEditor] = useState<Record<string, boolean>>({});
  const [estimateInputs, setEstimateInputs] = useState<Record<string, { value: string; unit: 'minutes' | 'hours' }>>({});
  const [estimateSettingsOpen, setEstimateSettingsOpen] = useState<Record<string, boolean>>({});
  const [estimatePresets, setEstimatePresets] = useState<{ label: string; minutes: number }[]>([
    { label: '30m', minutes: 30 },
    { label: '1h', minutes: 60 },
    { label: '2h', minutes: 120 },
    { label: '4h', minutes: 240 },
  ]);
  const [estimatePresetInput, setEstimatePresetInput] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());
  const [loggedTimes, setLoggedTimes] = useState<Record<string, number>>({});
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    targetId: string | '__end';
    position: 'above' | 'below';
  } | null>(null);
  const [groupDropTarget, setGroupDropTarget] = useState<string | null>(null);
  const [expandedProjectPicker, setExpandedProjectPicker] = useState<string | null>(null);
  const [pickerPosition, setPickerPosition] = useState<{ top: number; left: number } | null>(null);
  const [expandedSubtasks, setExpandedSubtasks] = useState<Record<string, boolean>>({});
  const [subtaskCache, setSubtaskCache] = useState<Record<string, Task[]>>({});
  const [addingSubtaskFor, setAddingSubtaskFor] = useState<string | null>(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [selectedSubtaskId, setSelectedSubtaskId] = useState<string | null>(null);
  
  // Multi-select state
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedTaskId, setLastClickedTaskId] = useState<string | null>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [focusedTaskIndex, setFocusedTaskIndex] = useState<number>(-1);
  // Anchor index is where the selection started (for rubber-band selection)
  const [selectionAnchorIndex, setSelectionAnchorIndex] = useState<number>(-1);
  
  // Virtualization state for lazy loading
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: INITIAL_RENDER_COUNT });
  const virtualListRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  
  // Suppress hover during scroll/click until mouse moves
  const [suppressHover, setSuppressHover] = useState(false);
  
  const manualOrderingActive = Boolean(manualOrderingEnabled && onManualReorder);
  const hasGroups = grouping !== 'none' && Boolean(groups?.length);
  
  // Virtualization: calculate visible range based on scroll position
  const updateVisibleRange = useCallback(() => {
    const container = scrollContainerRef?.current || virtualListRef.current;
    if (!container) return;
    
    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;
    
    // Calculate which items should be visible
    const startIndex = Math.max(0, Math.floor(scrollTop / TASK_ROW_HEIGHT) - BUFFER_SIZE);
    const visibleCount = Math.ceil(viewportHeight / TASK_ROW_HEIGHT);
    const endIndex = startIndex + visibleCount + BUFFER_SIZE * 2;
    
    setVisibleRange(prev => {
      // Only update if range changed significantly to avoid excessive re-renders
      if (Math.abs(prev.start - startIndex) > 3 || Math.abs(prev.end - endIndex) > 3) {
        return { start: startIndex, end: endIndex };
      }
      return prev;
    });
  }, [scrollContainerRef]);
  
  // Set up scroll listener for virtualization
  useEffect(() => {
    const container = scrollContainerRef?.current || virtualListRef.current;
    if (!container) return;
    
    // Initial calculation
    updateVisibleRange();
    
    // Throttled scroll handler
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          updateVisibleRange();
          ticking = false;
        });
        ticking = true;
      }
    };
    
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [scrollContainerRef, updateVisibleRange]);
  
  // Suppress hover during scroll/click until mouse actually moves
  useEffect(() => {
    const container = scrollContainerRef?.current || virtualListRef.current;
    if (!container) return;
    
    let lastMouseX = 0;
    let lastMouseY = 0;
    
    const handleScroll = () => {
      setSuppressHover(true);
    };
    
    // Removed: mousedown suppress was causing selection issues
    // const handleMouseDown = () => {
    //   setSuppressHover(true);
    // };
    
    const handleMouseMove = (e: MouseEvent) => {
      // Only re-enable hover if mouse actually moved (not just scroll causing position change)
      const moved = Math.abs(e.clientX - lastMouseX) > 2 || Math.abs(e.clientY - lastMouseY) > 2;
      if (moved) {
        setSuppressHover(false);
      }
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    };
    
    container.addEventListener('scroll', handleScroll, { passive: true });
    // Removed: mousedown suppress was causing selection issues
    // container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mousemove', handleMouseMove, { passive: true });
    
    return () => {
      container.removeEventListener('scroll', handleScroll);
      // Removed: mousedown suppress was causing selection issues
      // container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mousemove', handleMouseMove);
    };
  }, [scrollContainerRef]);
  
  // Reset visible range when tasks change significantly
  useEffect(() => {
    setVisibleRange({ start: 0, end: Math.max(INITIAL_RENDER_COUNT, visibleRange.end) });
  }, [tasks.length > 0 ? tasks[0]?.id : null]);
  const orderOptionMap = useMemo(() => {
    const map = new Map<string, { index: number; color?: string }>();
    orderOptions.forEach((option, index) => {
      map.set(option.name.toLowerCase(), { index, color: option.color });
    });
    return map;
  }, [orderOptions]);

  // Project lookup map for efficient name resolution
  const projectMap = useMemo(() => {
    const map = new Map<string, Project>();
    projects.forEach((project) => {
      map.set(project.id, project);
    });
    return map;
  }, [projects]);

  // Get project names for a task
  const getTaskProjects = useCallback((task: Task) => {
    if (!task.projectIds || task.projectIds.length === 0) return [];
    return task.projectIds
      .map((id) => projectMap.get(id))
      .filter((p): p is Project => Boolean(p));
  }, [projectMap]);

  // Open projects only (for dropdown)
  const openProjects = useMemo(() => {
    // Filter to show only projects that seem active (have title, not marked completed)
    return projects.filter((p) => p.title);
  }, [projects]);

  const getTaskRowElement = useCallback((taskId: string) => {
    if (typeof document === 'undefined') return null;
    return document.querySelector<HTMLElement>(
      `.task-row[data-task-id="${taskId}"]`
    );
  }, []);

  const focusTaskField = useCallback(
    (taskId: string, selector: string, defer = false) => {
      const focus = () => {
        const row = getTaskRowElement(taskId);
        const element = row?.querySelector<HTMLElement>(selector);
        if (!element || typeof (element as HTMLElement).focus !== 'function') {
          return;
        }
        (element as HTMLElement).focus();
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
        ) {
          try {
            element.select();
          } catch {
            // Ignore selection errors
          }
        }
      };
      if (defer) {
        if (typeof window === 'undefined') return;
        window.setTimeout(focus, 30);
      } else {
        focus();
      }
    },
    [getTaskRowElement]
  );

  const focusSessionInput = useCallback(
    (taskId: string, defer = false) => {
      focusTaskField(taskId, '[data-task-session-input="true"]', defer);
    },
    [focusTaskField]
  );

  const focusNotesTextarea = useCallback(
    (taskId: string, defer = false) => {
      focusTaskField(taskId, '[data-task-notes-input="true"]', defer);
    },
    [focusTaskField]
  );

  useEffect(() => {
    if (!manualOrderingActive) {
      setDraggingTaskId(null);
      setDragPreview(null);
    }
  }, [manualOrderingActive]);
  const formatMinutes = (minutes?: number | null) => {
    if (minutes === undefined || minutes === null || Number.isNaN(minutes)) {
      return '';
    }
    const totalMinutes = Number(minutes);
    const hours = Math.floor(totalMinutes / 60);
    const remaining = Math.round(totalMinutes % 60);
    if (hours && remaining) {
      return `${hours}h ${remaining}m`;
    }
    if (hours && !remaining) {
      return `${hours}h`;
    }
    if (!hours) {
      return `${totalMinutes}m`;
    }
    return `${totalMinutes}m`;
  };

  // Parse time string like "15m", "1h", "1h30m", "90" (minutes)
  const parseTimeString = (input: string): { minutes: number; label: string } | null => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return null;
    
    // Try to parse formats like "1h30m", "1h 30m", "1h30"
    const hourMinMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*h(?:r|our)?s?\s*(\d+)?\s*m?(?:in)?s?$/);
    if (hourMinMatch) {
      const hours = parseFloat(hourMinMatch[1]);
      const mins = hourMinMatch[2] ? parseInt(hourMinMatch[2]) : 0;
      const totalMins = Math.round(hours * 60) + mins;
      const label = mins > 0 ? `${Math.floor(hours)}h${mins}m` : `${hours}h`;
      return { minutes: totalMins, label };
    }
    
    // Try to parse "1h" or "2hr" or "1.5h"
    const hourMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*h(?:r|our)?s?$/);
    if (hourMatch) {
      const hours = parseFloat(hourMatch[1]);
      const totalMins = Math.round(hours * 60);
      const label = hours % 1 === 0 ? `${hours}h` : `${hours}h`;
      return { minutes: totalMins, label };
    }
    
    // Try to parse "30m" or "30min" or "30 minutes"
    const minMatch = trimmed.match(/^(\d+)\s*m(?:in)?(?:ute)?s?$/);
    if (minMatch) {
      const mins = parseInt(minMatch[1]);
      return { minutes: mins, label: `${mins}m` };
    }
    
    // Try to parse plain number as minutes
    const numMatch = trimmed.match(/^(\d+)$/);
    if (numMatch) {
      const mins = parseInt(numMatch[1]);
      return { minutes: mins, label: `${mins}m` };
    }
    
    return null;
  };

  useEffect(() => {
    if (!sortHold) return;
    const hasActive = Object.values(sortHold).some((expiry) => expiry > Date.now());
    if (!hasActive) return;
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 200);
    return () => {
      window.clearInterval(interval);
    };
  }, [sortHold]);

  // Fetch logged times for tasks with estimated time
  useEffect(() => {
    const fetchLoggedTimes = async () => {
      const tasksWithEstimate = tasks.filter(
        (task) => task.estimatedLengthMinutes != null
      );
      
      if (tasksWithEstimate.length === 0) return;

      const loggedTimePromises = tasksWithEstimate.map(async (task) => {
        try {
          const totalMinutes = await window.widgetAPI.getTotalLoggedTime(task.id);
          return { taskId: task.id, minutes: totalMinutes };
        } catch (error) {
          console.error(`Failed to fetch logged time for task ${task.id}`, error);
          return { taskId: task.id, minutes: 0 };
        }
      });

      const results = await Promise.all(loggedTimePromises);
      const newLoggedTimes: Record<string, number> = {};
      results.forEach(({ taskId, minutes }) => {
        newLoggedTimes[taskId] = minutes;
      });
      setLoggedTimes(newLoggedTimes);
    };

    void fetchLoggedTimes();
  }, [tasks]);

  useEffect(() => {
    if (!selectedTaskId || !onScrollToCenter) return;
    if (typeof document === 'undefined') return;
    const element = document.querySelector<HTMLElement>(
      `.task-row[data-task-id="${selectedTaskId}"]`
    );
    if (element) {
      onScrollToCenter(element);
    }
  }, [selectedTaskId, onScrollToCenter]);

  // Clear subtask selection when main task selection changes
  useEffect(() => {
    setSelectedSubtaskId(null);
  }, [selectedTaskId]);

  // Update countdown display every second
  const [timerNow, setTimerNow] = useState(() => Date.now());
  useEffect(() => {
    const hasCountdownTasks = tasks.some(
      (task) => isCountingDown?.(task.id)
    );
    if (!hasCountdownTasks) return;
    const interval = window.setInterval(() => {
      setTimerNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [tasks, isCountingDown]);

  useEffect(() => {
    if (grouping === 'none' || !groups || !groups.length) {
      setCollapsedGroups({});
      return;
    }
    setCollapsedGroups((previous) => {
      const next = { ...previous };
      let changed = false;
      const activeIds = new Set(groups.map((group) => group.id));

      Object.keys(next).forEach((id) => {
        if (!activeIds.has(id)) {
          delete next[id];
          changed = true;
        }
      });

      groups.forEach((group) => {
        if (next[group.id] === undefined) {
          next[group.id] = true;
          changed = true;
        }
      });

      return changed ? next : previous;
    });
  }, [grouping, groups]);

  const handleUpdate = async (taskId: string, updates: TaskUpdatePayload) => {
    setUpdatingId(taskId);
    try {
      await onUpdateTask(taskId, updates);
    } finally {
      setUpdatingId((current) => (current === taskId ? null : current));
    }
  };

  const isInteractiveDragTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest('.task-drag-handle') ||
        target.closest(POP_OUT_INTERACTIVE_SELECTOR)
    );
  };

  const handleDragStart =
    (taskId: string) => (event: React.DragEvent<HTMLElement>) => {
      if (!manualOrderingActive) return;
      if (isInteractiveDragTarget(event.target)) {
        event.preventDefault();
        return;
      }
      setDraggingTaskId(taskId);
      setDragPreview(null);
      event.dataTransfer?.setData('text/plain', taskId);
      event.dataTransfer?.setDragImage(event.currentTarget, 0, 0);
    };

  const handleDragEnd = () => {
    setDraggingTaskId(null);
    setDragPreview(null);
  };

  const handleDragOverRow =
    (taskId: string) => (event: React.DragEvent<HTMLElement>) => {
      if (
        !manualOrderingActive ||
        !draggingTaskId ||
        draggingTaskId === taskId
      ) {
        return;
      }
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const position =
        event.clientY - rect.top < rect.height / 2 ? 'above' : 'below';
      setDragPreview({ targetId: taskId, position });
    };

  const handleDropOnRow =
    (taskId: string) => (event: React.DragEvent<HTMLElement>) => {
      if (!manualOrderingActive || !draggingTaskId || !onManualReorder) return;
      event.preventDefault();
      const preview =
        dragPreview && dragPreview.targetId === taskId
          ? dragPreview.position
          : 'below';
      onManualReorder({
        sourceId: draggingTaskId,
        targetId: taskId,
        position: preview
      });
      setDraggingTaskId(null);
      setDragPreview(null);
    };

  const handleListDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!manualOrderingActive || !draggingTaskId) return;
    event.preventDefault();
    if (!tasks.length) {
      setDragPreview({ targetId: '__end', position: 'below' });
      return;
    }
    const lastTaskId = tasks[tasks.length - 1].id;
    setDragPreview({ targetId: lastTaskId, position: 'below' });
  };

  const handleListDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!manualOrderingActive || !draggingTaskId || !onManualReorder) return;
    event.preventDefault();
    onManualReorder({
      sourceId: draggingTaskId,
      targetId: '__end',
      position: 'below'
    });
    setDraggingTaskId(null);
    setDragPreview(null);
  };

  // Multi-select handlers
  const allVisibleTaskIds = useMemo((): string[] => {
    if (hasGroups && groups) {
      return groups.flatMap((group) => group.tasks.map((t) => t.id));
    }
    return tasks.map((t) => t.id);
  }, [tasks, groups, hasGroups]);

  const getAllVisibleTaskIds = useCallback((): string[] => {
    return allVisibleTaskIds;
  }, [allVisibleTaskIds]);

  const handleTaskClick = useCallback((
    event: ReactMouseEvent<HTMLElement>,
    taskId: string
  ) => {
    // Don't select if clicking on interactive elements inside the task row
    const target = event.target as HTMLElement;
    const interactiveSelector = 'button, input, select, textarea, a, [role="button"], .notion-input, .status-select, .matrix-select';
    if (target.closest(interactiveSelector)) {
      return; // Let the inner element handle the click
    }
    
    const allIds = getAllVisibleTaskIds();
    const taskIndex = allIds.indexOf(taskId);
    
    if (event.shiftKey && lastClickedTaskId) {
      // Shift+Click: Range selection - rubber band from anchor to clicked task
      const anchorIndex = selectionAnchorIndex !== -1 
        ? selectionAnchorIndex 
        : allIds.indexOf(lastClickedTaskId);
      const currentIndex = taskIndex;
      
      if (anchorIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(anchorIndex, currentIndex);
        const end = Math.max(anchorIndex, currentIndex);
        const rangeIds = allIds.slice(start, end + 1);
        
        setMultiSelectMode(true);
        setFocusedTaskIndex(currentIndex);
        // Use rubber-band selection (replace, don't add)
        setMultiSelectedIds(new Set(rangeIds));
      }
    } else if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd+Click: Toggle selection - enter multi-select mode
      // This sets a new anchor at the clicked task
      setMultiSelectMode(true);
      setFocusedTaskIndex(taskIndex);
      setSelectionAnchorIndex(taskIndex);
      setMultiSelectedIds((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(taskId)) {
          newSet.delete(taskId);
        } else {
          newSet.add(taskId);
        }
        return newSet;
      });
      setLastClickedTaskId(taskId);
    } else {
      // Regular click: Clear multi-select mode and select single
      if (multiSelectMode || multiSelectedIds.size > 0) {
        setMultiSelectedIds(new Set());
        setMultiSelectMode(false);
      }
      setLastClickedTaskId(taskId);
      setFocusedTaskIndex(taskIndex);
      setSelectionAnchorIndex(taskIndex); // Set anchor for next Shift+Click
      onSelectTask?.(taskId);
    }
  }, [lastClickedTaskId, selectionAnchorIndex, getAllVisibleTaskIds, multiSelectedIds.size, multiSelectMode, onSelectTask]);

  const handleClearMultiSelection = useCallback(() => {
    setMultiSelectedIds(new Set());
    setLastClickedTaskId(null);
    setMultiSelectMode(false);
    setFocusedTaskIndex(-1);
    setSelectionAnchorIndex(-1);
  }, []);

  const handleSelectAll = useCallback(() => {
    const allIds = getAllVisibleTaskIds();
    setMultiSelectedIds(new Set(allIds));
    setMultiSelectMode(true);
  }, [getAllVisibleTaskIds]);

  const handleMassUpdate = useCallback(async (updates: TaskUpdatePayload) => {
    const selectedIds = Array.from(multiSelectedIds);
    // Update all selected tasks
    await Promise.all(
      selectedIds.map((taskId) => onUpdateTask(taskId, updates))
    );
  }, [multiSelectedIds, onUpdateTask]);

  // Enter multi-select mode via drag handle
  const handleEnterMultiSelectMode = useCallback((taskId: string, event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation();
    
    const allIds = allVisibleTaskIds;
    const taskIndex = allIds.indexOf(taskId);
    
    setMultiSelectMode(true);
    setFocusedTaskIndex(taskIndex);
    setSelectionAnchorIndex(taskIndex); // Set anchor for rubber-band selection
    setLastClickedTaskId(taskId);
    
    // Add the task to selection
    setMultiSelectedIds((prev) => {
      const newSet = new Set(prev);
      newSet.add(taskId);
      return newSet;
    });
  }, [allVisibleTaskIds]);

  // Handle keyboard navigation for multi-select
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as Element;
      const isInInput = target.closest('input, textarea, [contenteditable]');
      
      // Escape to clear selection
      if (event.key === 'Escape' && (multiSelectedIds.size > 0 || multiSelectMode)) {
        handleClearMultiSelection();
        return;
      }
      
      // Ctrl/Cmd+A to select all
      if ((event.ctrlKey || event.metaKey) && event.key === 'a' && !isInInput) {
        event.preventDefault();
        handleSelectAll();
        return;
      }
      
      // Shift+Arrow for multi-select navigation (rubber-band selection)
      if (event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && !isInInput) {
        event.preventDefault();
        
        const allIds = allVisibleTaskIds;
        if (allIds.length === 0) return;
        
        // Determine current focus position
        let currentIndex = focusedTaskIndex;
        let anchorIndex = selectionAnchorIndex;
        
        // If no anchor set, establish it from current position
        if (anchorIndex === -1) {
          if (selectedTaskId) {
            anchorIndex = allIds.indexOf(selectedTaskId);
          }
          if (anchorIndex === -1) {
            anchorIndex = event.key === 'ArrowDown' ? 0 : allIds.length - 1;
          }
          // Set the anchor - this is where the selection started
          setSelectionAnchorIndex(anchorIndex);
          currentIndex = anchorIndex;
        }
        
        if (currentIndex === -1) {
          currentIndex = anchorIndex;
        }
        
        // Calculate new focus index
        const newIndex = event.key === 'ArrowDown'
          ? Math.min(currentIndex + 1, allIds.length - 1)
          : Math.max(currentIndex - 1, 0);
        
        if (newIndex === currentIndex) return;
        
        const taskId = allIds[newIndex];
        if (!taskId) return;
        
        // Enter multi-select mode
        setMultiSelectMode(true);
        setFocusedTaskIndex(newIndex);
        setLastClickedTaskId(taskId);
        
        // Rubber-band selection: select ONLY tasks between anchor and new focus
        const start = Math.min(anchorIndex, newIndex);
        const end = Math.max(anchorIndex, newIndex);
        const rangeIds = allIds.slice(start, end + 1);
        
        setMultiSelectedIds(new Set(rangeIds));
        
        // Scroll the task into view
        const taskElement = document.querySelector<HTMLElement>(
          `.task-row[data-task-id="${taskId}"]`
        );
        if (taskElement && onScrollToCenter) {
          onScrollToCenter(taskElement);
        } else if (taskElement) {
          taskElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      
      // Regular arrow keys (without shift) - navigate focus
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !isInInput && !event.shiftKey) {
        event.preventDefault();
        
        const allIds = allVisibleTaskIds;
        if (allIds.length === 0) return;
        
        let currentIndex = selectedTaskId ? allIds.indexOf(selectedTaskId) : -1;
        if (currentIndex === -1) {
          currentIndex = event.key === 'ArrowDown' ? -1 : allIds.length;
        }
        
        const newIndex = event.key === 'ArrowDown'
          ? Math.min(currentIndex + 1, allIds.length - 1)
          : Math.max(currentIndex - 1, 0);
        
        const taskId = allIds[newIndex];
        if (taskId) {
          onSelectTask?.(taskId);
          setFocusedTaskIndex(newIndex);
          
          const taskElement = document.querySelector<HTMLElement>(
            `.task-row[data-task-id="${taskId}"]`
          );
          if (taskElement && onScrollToCenter) {
            onScrollToCenter(taskElement);
          } else if (taskElement) {
            taskElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    multiSelectedIds.size,
    multiSelectMode,
    handleClearMultiSelection,
    handleSelectAll,
    allVisibleTaskIds,
    focusedTaskIndex,
    selectionAnchorIndex,
    selectedTaskId,
    onSelectTask,
    onScrollToCenter
  ]);

  const handleDragOverZone =
    (targetId: string | '__end', position: 'above' | 'below') =>
    (event: React.DragEvent<HTMLElement>) => {
      if (!manualOrderingActive || !draggingTaskId) return;
      event.preventDefault();
      setDragPreview({ targetId, position });
    };

  const handleDropOnZone =
    (targetId: string | '__end', position: 'above' | 'below') =>
    (event: React.DragEvent<HTMLElement>) => {
      if (!manualOrderingActive || !draggingTaskId || !onManualReorder) return;
      event.preventDefault();
      onManualReorder({
        sourceId: draggingTaskId,
        targetId,
        position
      });
      setDraggingTaskId(null);
      setDragPreview(null);
    };

  const shouldShowDropZones = manualOrderingActive && Boolean(draggingTaskId);

  const renderDropZone = (
    key: string,
    targetId: string | '__end',
    position: 'above' | 'below',
    label?: string
  ) => {
    if (!shouldShowDropZones) return null;
    const isActive =
      dragPreview?.targetId === targetId && dragPreview?.position === position;
    const message =
      targetId === '__end'
        ? 'Drop to move to the end'
        : position === 'above'
          ? `Drop above ${label ?? 'this task'}`
          : `Drop below ${label ?? 'this task'}`;
    return (
      <div
        key={key}
        className={`task-drop-zone ${isActive ? 'is-active' : ''}`}
        onDragOver={handleDragOverZone(targetId, position)}
        onDrop={handleDropOnZone(targetId, position)}
      >
        <span className="drop-zone-label">{message}</span>
      </div>
    );
  };

  const toggleNotes = (taskId: string, currentValue?: string, taskElement?: HTMLElement) => {
    const wasExpanded = expandedNotes[taskId];
    setExpandedNotes((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
    setNoteDrafts((prev) => {
      if (prev[taskId] !== undefined) return prev;
      return {
        ...prev,
        [taskId]: currentValue ?? ''
      };
    });
    
    // Scroll to center the task element after notes expand/collapse
    if (onScrollToCenter && taskElement) {
      // Use setTimeout to wait for the DOM to update after state change
      setTimeout(() => {
        const taskRow = taskElement.closest('.task-row') as HTMLElement;
        if (taskRow) {
          onScrollToCenter(taskRow);
        }
      }, 0);
    }
  };

  const handleNoteChange = (taskId: string, value: string) => {
    setNoteDrafts((prev) => ({ ...prev, [taskId]: value }));
  };

  const commitNoteChange = async (
    taskId: string,
    value: string,
    original?: string
  ) => {
    const trimmed = value.trim();
    const baseline = (original ?? '').trim();
    if (trimmed === baseline) return;
    await handleUpdate(taskId, { mainEntry: trimmed || null });
  };

  const closeNotes = (taskId: string) => {
    setExpandedNotes((prev) => ({ ...prev, [taskId]: false }));
  };

  const toggleTrackingData = async (taskId: string, taskElement?: HTMLElement) => {
    const wasExpanded = expandedTrackingData[taskId];
    const willExpand = !wasExpanded;
    
    setExpandedTrackingData((prev) => ({ ...prev, [taskId]: willExpand }));
    
    // Fetch tracking data when expanding
    if (willExpand && !trackingData[taskId]) {
      try {
        const entries = await window.widgetAPI.getAllTimeLogEntries(taskId);
        setTrackingData((prev) => ({ ...prev, [taskId]: entries }));
      } catch (error) {
        console.error('Failed to fetch tracking data', error);
        setTrackingData((prev) => ({ ...prev, [taskId]: [] }));
      }
    }
    
    // Scroll to center the task element after expand/collapse
    if (onScrollToCenter && taskElement) {
      setTimeout(() => {
        const taskRow = taskElement.closest('.task-row') as HTMLElement;
        if (taskRow) {
          onScrollToCenter(taskRow);
        }
      }, 0);
    }
  };

  const closeTrackingData = (taskId: string) => {
    setExpandedTrackingData((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  };

  const toggleSessionTimer = (taskId: string, taskElement?: HTMLElement) => {
    const wasExpanded = expandedSessionTimer[taskId];
    setExpandedSessionTimer((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
    
    // Always sync input with task's current session length when expanding
    if (!wasExpanded) {
      const taskData = tasks.find((task) => task.id === taskId);
      const defaultMinutes = taskData?.sessionLengthMinutes ?? null;
      const prefersHours =
        defaultMinutes !== null &&
        defaultMinutes !== undefined &&
        defaultMinutes >= 60 &&
        defaultMinutes % 60 === 0;
      const defaultValue =
        defaultMinutes && prefersHours
          ? String(defaultMinutes / 60)
          : defaultMinutes
            ? String(defaultMinutes)
            : '';
      setSessionInputs((prev) => ({
        ...prev,
        [taskId]: {
          value: defaultValue,
          unit: prefersHours ? 'hours' : 'minutes'
        }
      }));
    }
    
    // Scroll to center the task element after timer expand/collapse
    if (onScrollToCenter && taskElement && !wasExpanded) {
      setTimeout(() => {
        const taskRow = taskElement.closest('.task-row') as HTMLElement;
        if (taskRow) {
          onScrollToCenter(taskRow);
        }
      }, 0);
    }
  };

  const closeSessionTimer = (taskId: string) => {
    setExpandedSessionTimer((prev) => ({ ...prev, [taskId]: false }));
  };

  const toggleEstimateEditor = (taskId: string, taskElement?: HTMLElement) => {
    const wasExpanded = expandedEstimateEditor[taskId];
    setExpandedEstimateEditor((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
    setEstimateInputs((prev) => {
      if (prev[taskId] !== undefined) return prev;
      const taskData = tasks.find((task) => task.id === taskId);
      const defaultMinutes = taskData?.estimatedLengthMinutes ?? null;
      const prefersHours =
        defaultMinutes !== null &&
        defaultMinutes !== undefined &&
        defaultMinutes >= 60 &&
        defaultMinutes % 60 === 0;
      const defaultValue =
        defaultMinutes && prefersHours
          ? String(defaultMinutes / 60)
          : defaultMinutes
            ? String(defaultMinutes)
            : '';
      return {
        ...prev,
        [taskId]: {
          value: defaultValue,
          unit: prefersHours ? 'hours' : 'minutes'
        }
      };
    });

    if (onScrollToCenter && taskElement && !wasExpanded) {
      setTimeout(() => {
        const taskRow = taskElement.closest('.task-row') as HTMLElement;
        if (taskRow) {
          onScrollToCenter(taskRow);
        }
      }, 0);
    }
  };

  const closeEstimateEditor = (taskId: string) => {
    setExpandedEstimateEditor((prev) => ({ ...prev, [taskId]: false }));
  };

  const handleSessionInputChange = (taskId: string, value: string) => {
    setSessionInputs((prev) => ({
      ...prev,
      [taskId]: { ...(prev[taskId] ?? { value: '', unit: 'minutes' }), value }
    }));
  };

  const handleSessionUnitToggle = (taskId: string) => {
    setSessionInputs((prev) => {
      const current = prev[taskId] ?? { value: '', unit: 'minutes' as const };
      return {
        ...prev,
        [taskId]: { ...current, unit: current.unit === 'minutes' ? 'hours' : 'minutes' }
      };
    });
  };

  const handleEstimateInputChange = (taskId: string, value: string) => {
    setEstimateInputs((prev) => ({
      ...prev,
      [taskId]: { ...(prev[taskId] ?? { value: '', unit: 'minutes' }), value }
    }));
  };

  const handleEstimateUnitToggle = (taskId: string) => {
    setEstimateInputs((prev) => {
      const current = prev[taskId] ?? { value: '', unit: 'minutes' as const };
      return {
        ...prev,
        [taskId]: { ...current, unit: current.unit === 'minutes' ? 'hours' : 'minutes' }
      };
    });
  };

  const handleStartSession = async (taskId: string) => {
    const input = sessionInputs[taskId];
    if (!input || !input.value) return;
    
    const numericValue = parseFloat(input.value);
    if (isNaN(numericValue) || numericValue <= 0) return;
    
    const minutes = input.unit === 'hours' ? Math.round(numericValue * 60) : Math.round(numericValue);
    if (minutes > 0) {
      const task = tasks.find((t) => t.id === taskId);
      const isActive = isCountingDown?.(taskId);
      
      if (isActive && extendCountdown) {
        // Extend existing session
        extendCountdown(taskId, minutes);
        const currentSessionLength = task?.sessionLengthMinutes ?? 0;
        void handleUpdate(taskId, { sessionLengthMinutes: currentSessionLength + minutes });
        // Clear input but keep panel open
        setSessionInputs((prev) => {
          const next = { ...prev };
          if (next[taskId]) {
            next[taskId] = { ...next[taskId], value: '' };
          }
          return next;
        });
      } else {
        // Start new session
        if (task && task.status !== '⌚') {
          await handleUpdate(taskId, { status: '⌚' });
        }
        
        if (startCountdown) {
          startCountdown(taskId, minutes);
          void handleUpdate(taskId, { sessionLengthMinutes: minutes });
          closeSessionTimer(taskId);
        }
      }
    }
  };

  const runSessionShortcut = useCallback(
    (taskId: string) => {
      if (!tasks.some((task) => task.id === taskId)) return;
      if (!expandedSessionTimer[taskId]) {
        const taskElement = getTaskRowElement(taskId) ?? undefined;
        toggleSessionTimer(taskId, taskElement);
        focusSessionInput(taskId, true);
        return;
      }
      const rawValue = sessionInputs[taskId]?.value ?? '';
      const numericValue = parseFloat(rawValue);
      if (!rawValue || Number.isNaN(numericValue) || numericValue <= 0) {
        focusSessionInput(taskId);
        return;
      }
      void handleStartSession(taskId);
    },
    [
      expandedSessionTimer,
      focusSessionInput,
      getTaskRowElement,
      handleStartSession,
      sessionInputs,
      tasks,
      toggleSessionTimer
    ]
  );

  const runNotesShortcut = useCallback(
    (taskId: string) => {
      const task = tasks.find((entry) => entry.id === taskId);
      if (!task) return;
      if (!expandedNotes[taskId]) {
        const taskElement = getTaskRowElement(taskId) ?? undefined;
        toggleNotes(taskId, task.mainEntry, taskElement);
        focusNotesTextarea(taskId, true);
        return;
      }
      focusNotesTextarea(taskId);
    },
    [
      expandedNotes,
      focusNotesTextarea,
      getTaskRowElement,
      tasks,
      toggleNotes
    ]
  );

  useEffect(() => {
    if (!shortcutSignal) return;
    if (shortcutSignal.action.type === 'session') {
      runSessionShortcut(shortcutSignal.action.taskId);
    } else if (shortcutSignal.action.type === 'notes') {
      runNotesShortcut(shortcutSignal.action.taskId);
    }
    onShortcutHandled?.(shortcutSignal.id);
  }, [shortcutSignal, onShortcutHandled, runNotesShortcut, runSessionShortcut]);

  const handleSaveEstimatedLength = async (taskId: string) => {
    const input = estimateInputs[taskId];
    const numericValue = parseFloat(input?.value ?? '');
    if (isNaN(numericValue) || numericValue <= 0) {
      await handleUpdate(taskId, { estimatedLengthMinutes: null });
      closeEstimateEditor(taskId);
      return;
    }
    const minutes =
      (input?.unit ?? 'minutes') === 'hours'
        ? Math.round(numericValue * 60)
        : Math.round(numericValue);
    await handleUpdate(taskId, { estimatedLengthMinutes: minutes });
    closeEstimateEditor(taskId);
  };

  const handleCustomStatusChange = (taskId: string, value: string) => {
    setCustomStatusDrafts((prev) => ({ ...prev, [taskId]: value }));
  };

  const commitCustomStatus = async (taskId: string, value: string) => {
    const trimmed = value.trim();
    await handleUpdate(taskId, { status: trimmed || null });
    setCustomStatusDrafts((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  };

  const startEditingTitle = (task: Task) => {
    setEditingTitleId(task.id);
    setTitleDrafts((prev) => ({ ...prev, [task.id]: task.title }));
  };

  const cancelEditingTitle = (taskId: string) => {
    setEditingTitleId((current) => (current === taskId ? null : current));
    setTitleDrafts((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  };

  const commitTitleEdit = async (taskId: string) => {
    const draft = (titleDrafts[taskId] ?? '').trim();
    const original = tasks.find((task) => task.id === taskId)?.title ?? '';
    if (!draft || draft === original) {
      cancelEditingTitle(taskId);
      return;
    }
    try {
      await handleUpdate(taskId, { title: draft });
      cancelEditingTitle(taskId);
    } catch (error) {
      console.error('Unable to update title', error);
    }
  };

  if (loading) {
    return <div className="panel muted">Syncing tasks…</div>;
  }

  if (error) {
    return <div className="panel error">⚠️ {error}</div>;
  }

  if (!tasks.length) {
    return (
      <div className="panel muted">
        {emptyMessage ?? 'No tasks found for this database.'}
      </div>
    );
  }

  const availableStatusOptions =
    statusOptions.length > 0
      ? statusOptions
      : manualStatuses.map((name) => ({ id: name, name }));

  // Helper to get status color class - prefers Notion color from options
  const getStatusClass = (statusValue: string | undefined | null) => {
    if (!statusValue) return '';
    // Find the status option to get its Notion color
    const statusOption = availableStatusOptions.find(
      (opt) => opt.name.toLowerCase() === statusValue.toLowerCase()
    );
    // Prefer Notion color if available
    if (statusOption?.color) {
      return getStatusColorClassFromNotionColor(statusOption.color);
    }
    // Fallback to name-based mapping
    return getStatusColorClass(statusValue);
  };

  const isTaskActive = (task: Task) =>
    task.status === '⌚' || Boolean(isCountingDown?.(task.id));
  const ungroupedActiveTasks = !hasGroups
    ? tasks.filter((task) => isTaskActive(task))
    : [];
  const ungroupedInactiveTasks = !hasGroups
    ? tasks.filter((task) => !isTaskActive(task))
    : tasks;

  const renderTask = (task: Task) => {
        const handleRowDoubleClickCapture = (
          event: ReactMouseEvent<HTMLElement>
        ) => {
          if (!onPopOutTask) return;
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest(
              `${POP_OUT_INTERACTIVE_SELECTOR}, .task-title, .task-title-input`
            )
          ) {
            return;
          }
          onPopOutTask(task);
        };
        const isUpdating = updatingId === task.id;
        const isComplete =
          Boolean(completedStatus) && task.status === completedStatus;
        const defaultStatus =
          availableStatusOptions.find(
            (option) => option.name !== completedStatus
          )
            ?.name ?? '';
        const statusValue = task.status ?? '';
        const statusMissing =
          Boolean(statusValue) &&
          !availableStatusOptions.some(
            (option) => option.name === statusValue
          );
        const holdExpiry = disableSortHoldIndicators
          ? undefined
          : sortHold?.[task.id];
        const holdRemaining = holdExpiry ? Math.max(0, holdExpiry - now) : 0;
        const holdActive = Boolean(holdRemaining);
        const holdProgress = holdActive
          ? Math.min(1, 1 - holdRemaining / holdDuration)
          : 0;

        const handleCompleteToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
          if (!completedStatus) return;
          // Capture the task row before async operations (React events are recycled)
          const taskRow = (event.currentTarget as HTMLElement)?.closest('.task-row') as HTMLElement | null;
          playCompletionSound(isComplete ? 'undo' : 'complete');
          void handleUpdate(task.id, {
            status: isComplete ? defaultStatus || null : completedStatus
          });
          // Scroll to center after toggle
          if (onScrollToCenter && taskRow) {
            setTimeout(() => {
              onScrollToCenter(taskRow);
            }, 0);
          }
        };
        const matrixClass = getMatrixClass(
          Boolean(task.urgent),
          Boolean(task.important)
        );
        const currentMatrix =
          findMatrixOptionFromFlags(task.urgent, task.important) ??
          matrixOptions[matrixOptions.length - 1];
        const matrixSelection = currentMatrix.id;
        const matrixSelectId = `${task.id}-matrix`;
        const handleMatrixChange = (optionId: MatrixOptionId) => {
          const option = findMatrixOptionById(optionId);
          if (!option) return;
          void handleUpdate(task.id, {
            urgent: option.urgent,
            important: option.important
          });
        };
        const sessionButtonLabel = task.sessionLengthMinutes
          ? `Start ${formatMinutes(task.sessionLengthMinutes)} session`
          : 'Add session length';
        const estimatedButtonLabel = task.estimatedLengthMinutes
          ? `Edit ${formatMinutes(task.estimatedLengthMinutes)} estimate`
          : 'Add estimated time';
        
        // Calculate remaining time: estimated - (logged + current session elapsed)
        // Reference timerNow to ensure dynamic updates during active sessions
        let remainingMinutes: number | null = null;
        if (task.estimatedLengthMinutes != null) {
          const loggedMinutes = loggedTimes[task.id] ?? 0;
          let currentSessionMinutes = 0;
          
          // Add current session elapsed time if counting down
          // Calculation automatically updates when timerNow state changes (updates every second)
          if (isCountingDown?.(task.id) && getRemainingTime && task.sessionLengthMinutes) {
            const remainingSeconds = getRemainingTime(task.id);
            const elapsedSeconds = (task.sessionLengthMinutes * 60) - remainingSeconds;
            currentSessionMinutes = Math.floor(elapsedSeconds / 60);
            // Reference timerNow to ensure React re-renders when timer updates
            void timerNow;
          }
          
          const totalLogged = loggedMinutes + currentSessionMinutes;
          remainingMinutes = Math.max(0, task.estimatedLengthMinutes - totalLogged);
        }
        
        const remainingLabel = remainingMinutes != null ? formatMinutes(remainingMinutes) : '';

        const isSessionActive = isTaskActive(task);
        const isFocusedTask = focusTaskId === task.id;
        const isSelected = selectedTaskId === task.id;
        const isMultiSelected = multiSelectedIds.has(task.id);
        const allIds = allVisibleTaskIds;
        const taskIndex = allIds.indexOf(task.id);
        const isKeyboardFocused = multiSelectMode && focusedTaskIndex === taskIndex;
        const dragIndicatorClass =
          manualOrderingActive && dragPreview?.targetId === task.id
            ? dragPreview.position === 'above'
              ? 'drag-over-above'
              : 'drag-over-below'
            : '';
        const isBeingDragged = draggingTaskId === task.id;
        // Allow external drag for cross-window functionality (must be defined before use in rowClasses)
        const allowExternalDrag = Boolean(enableExternalDrag && onTaskDragStart);
        const hasSubtasks = task.subtaskProgress && task.subtaskProgress.total > 0;
        const isSubtask = Boolean(task.parentTaskId);
        const rowClasses = [
          'task-row',
          isSessionActive ? 'has-active-session' : '',
          isFocusedTask ? 'is-focused-task' : '',
          isSelected ? 'is-selected' : '',
          isMultiSelected ? 'is-multi-selected' : '',
          isKeyboardFocused ? 'is-keyboard-focused' : '',
          manualOrderingActive || allowExternalDrag ? 'is-draggable' : '',
          isBeingDragged ? 'is-being-dragged' : '',
          dragIndicatorClass,
          hasSubtasks ? 'has-subtasks' : '',
          isSubtask ? 'is-subtask' : ''
        ]
          .filter(Boolean)
          .join(' ');
        const orderMeta = task.orderValue
          ? orderOptionMap.get(task.orderValue.toLowerCase())
          : undefined;
        const orderDisplayNumber = orderMeta ? orderMeta.index + 1 : null;
        const orderBadgeColors = orderMeta
          ? getOrderBadgeStyle(orderMeta.color)
          : null;
        
        // Create a combined drag handler that supports both manual ordering AND cross-window drag
        const dragStartHandler = (event: ReactDragEvent<HTMLElement>) => {
          // Always set cross-window data for external drops
          if (event.dataTransfer && allowExternalDrag) {
            event.dataTransfer.setData('application/x-task-id', task.id);
            event.dataTransfer.setData('text/plain', task.title ?? task.id);
            event.dataTransfer.effectAllowed = 'move';
            // Start cross-window drag
            onTaskDragStart?.(task, event);
          }
          // Also handle internal manual ordering if enabled
          if (manualOrderingActive) {
            handleDragStart(task.id)(event);
          }
        };
        
        const dragEndHandler = () => {
          if (manualOrderingActive) {
            handleDragEnd();
          }
          if (allowExternalDrag) {
            onTaskDragEnd?.();
          }
        };
        
        return (
          <Fragment key={task.id}>
            {renderDropZone(`${task.id}-drop-above`, task.id, 'above', task.title)}
            <article
            className={rowClasses}
            data-task-id={task.id}
            onPointerEnter={() => onHoverTask?.(task.id)}
            onPointerLeave={() => onHoverTask?.(null)}
            onDoubleClickCapture={handleRowDoubleClickCapture}
            draggable={manualOrderingActive || allowExternalDrag}
            onDragStart={manualOrderingActive || allowExternalDrag ? dragStartHandler : undefined}
            onDragEnd={manualOrderingActive || allowExternalDrag ? dragEndHandler : undefined}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              handleTaskClick(event as unknown as ReactMouseEvent<HTMLElement>, task.id);
            }}
            onDragOver={
              manualOrderingActive ? handleDragOverRow(task.id) : undefined
            }
            onDrop={
              manualOrderingActive ? handleDropOnRow(task.id) : undefined
            }
          >
            <div className="task-row-header">
              <div className="task-header-left">
                {/* Multi-select checkbox - only visible in multi-select mode */}
                {multiSelectMode && (
                  <input
                    type="checkbox"
                    className="task-multi-checkbox is-visible"
                    checked={isMultiSelected}
                    onChange={(e) => {
                      e.stopPropagation();
                      setMultiSelectedIds((prev) => {
                        const newSet = new Set(prev);
                        if (newSet.has(task.id)) {
                          newSet.delete(task.id);
                        } else {
                          newSet.add(task.id);
                        }
                        return newSet;
                      });
                      setLastClickedTaskId(task.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    title="Select task"
                  />
                )}
                <button
                  type="button"
                  className={`task-drag-handle ${multiSelectMode ? 'in-multi-select' : ''}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    // Enter multi-select mode
                    handleEnterMultiSelectMode(task.id, event);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    // Double-click opens inspector
                    onInspectTask?.(task.id);
                  }}
                  aria-label={multiSelectMode ? "Select task" : "Select task (double-click to inspect)"}
                  title={multiSelectMode ? "Click to toggle selection" : "Click to select, double-click to inspect"}
                >
                  ⋮⋮
                </button>
                <button
                  type="button"
                  className={`complete-toggle ${
                    isComplete ? 'is-complete' : ''
                  } ${holdActive ? 'is-holding' : ''}`}
                  data-state={isComplete ? 'complete' : 'idle'}
                  onClick={handleCompleteToggle}
                  disabled={isUpdating || !completedStatus}
                  title={
                    isComplete ? 'Mark as to-do' : 'Mark as complete'
                  }
                  aria-label={
                    isComplete ? 'Mark as to-do' : 'Mark as complete'
                  }
                >
                  {holdActive && (
                    <span
                      className="complete-hold-indicator"
                      style={{ width: `${holdProgress * 100}%` }}
                    />
                  )}
                </button>
                {orderDisplayNumber && (
                  <span
                    className="task-order-badge"
                    style={
                      orderBadgeColors
                        ? {
                            backgroundColor: orderBadgeColors.bg,
                            color: orderBadgeColors.text
                          }
                        : undefined
                    }
                  >
                    #{orderDisplayNumber}
                  </span>
                )}
                {editingTitleId === task.id ? (
                  <input
                    className="task-title-input editing"
                    value={titleDrafts[task.id] ?? ''}
                    onChange={(event) =>
                      setTitleDrafts((prev) => ({
                        ...prev,
                        [task.id]: event.target.value
                      }))
                    }
                    onBlur={() => void commitTitleEdit(task.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void commitTitleEdit(task.id);
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelEditingTitle(task.id);
                      }
                    }}
                    onDoubleClick={(event) => event.stopPropagation()}
                    autoFocus
                    disabled={isUpdating}
                  />
                ) : (
                  <p
                    className="task-title"
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      startEditingTitle(task);
                    }}
                  >
                    {task.title}
                  </p>
                )}
              </div>
              <div className="task-header-right">
                {/* Recurrence indicator (visual only, editing is in DateField) */}
                {task.recurrence && task.recurrence.length > 0 && (
                  <span className="recurrence-indicator" title={`Repeats: ${task.recurrence.join(', ')}`}>
                    🔄
                  </span>
                )}
                {/* Reminder indicator (visual only, editing is in DateField) */}
                {task.reminderAt && new Date(task.reminderAt) > new Date() && (
                  <span className="reminder-indicator" title={`Reminder at ${new Date(task.reminderAt).toLocaleString()}`}>
                    🔔
                  </span>
                )}
                {/* Subtask progress indicator - Notion rollup style */}
                {(() => {
                  const cachedSubtasks = subtaskCache[task.id] || [];
                  const hasSubtasksFromProgress = task.subtaskProgress && task.subtaskProgress.total > 0;
                  const hasSubtasksFromCache = cachedSubtasks.length > 0;
                  
                  if (!hasSubtasksFromProgress && !hasSubtasksFromCache) return null;
                  
                  // Calculate progress from cache if available, otherwise use task.subtaskProgress
                  const total = hasSubtasksFromCache ? cachedSubtasks.length : (task.subtaskProgress?.total ?? 0);
                  const completed = hasSubtasksFromCache 
                    ? cachedSubtasks.filter(s => s.status === completedStatus).length
                    : (task.subtaskProgress?.completed ?? 0);
                  const allDone = total > 0 && completed === total;
                  const isExpanded = expandedSubtasks[task.id];
                  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
                  
                  // Check for overdue subtasks (incomplete subtasks with past due dates)
                  const now = new Date();
                  now.setHours(0, 0, 0, 0); // Compare dates only
                  const hasOverdueSubtask = hasSubtasksFromCache && cachedSubtasks.some(s => {
                    if (s.status === completedStatus) return false; // Skip completed
                    if (!s.dueDate) return false; // No due date
                    const dueDate = new Date(s.dueDate);
                    dueDate.setHours(0, 0, 0, 0);
                    return dueDate < now;
                  });
                  
                  // Determine ring color based on state
                  let ringColor = 'currentColor'; // Default gray
                  let statusClass = '';
                  if (allDone) {
                    ringColor = '#22c55e'; // Green - all complete
                    statusClass = 'all-done';
                  } else if (hasOverdueSubtask) {
                    ringColor = '#ef4444'; // Red - has overdue
                    statusClass = 'has-overdue';
                  }
                  
                  return (
                    <button
                      type="button"
                      className={`subtask-rollup-pill ${statusClass} ${isExpanded ? 'is-expanded' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedSubtasks(prev => ({ ...prev, [task.id]: !isExpanded }));
                        
                        // Clear subtask selection when collapsing
                        if (isExpanded) {
                          setSelectedSubtaskId(null);
                        }
                        
                        // Fetch subtasks if not cached and expanding
                        if (!isExpanded && !subtaskCache[task.id]) {
                          window.widgetAPI.getSubtasks(task.id).then(subtasks => {
                            setSubtaskCache(prev => ({ ...prev, [task.id]: subtasks }));
                          });
                        }
                      }}
                      title={hasOverdueSubtask ? `${completed} of ${total} subtasks done (has overdue!)` : `${completed} of ${total} subtasks done`}
                    >
                      <span className="subtask-rollup-count">{completed}/{total}</span>
                      <svg 
                        className="subtask-progress-ring" 
                        viewBox="0 0 36 36"
                        width="14"
                        height="14"
                      >
                        {/* Background circle */}
                        <circle
                          cx="18"
                          cy="18"
                          r="15.9"
                          fill="none"
                          stroke="rgba(255, 255, 255, 0.15)"
                          strokeWidth="4"
                        />
                        {/* Progress arc */}
                        <circle
                          cx="18"
                          cy="18"
                          r="15.9"
                          fill="none"
                          stroke={ringColor}
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeDasharray={`${progressPercent}, 100`}
                          transform="rotate(-90 18 18)"
                          style={{ transition: 'stroke-dasharray 300ms ease, stroke 200ms ease' }}
                        />
                      </svg>
                    </button>
                  );
                })()}
                <button
                  type="button"
                  aria-label="Toggle deadline hardness"
                  className={`chip deadline-chip ${
                    task.hardDeadline ? 'chip-hard' : 'chip-soft'
                  }`}
                  onClick={(e) => {
                    // Capture the task row before async operations (React events are recycled)
                    const taskRow = (e.currentTarget as HTMLElement)?.closest('.task-row') as HTMLElement | null;
                    void handleUpdate(task.id, {
                      hardDeadline: !task.hardDeadline
                    });
                    // Scroll to center after toggle
                    if (onScrollToCenter && taskRow) {
                      setTimeout(() => {
                        onScrollToCenter(taskRow);
                      }, 0);
                    }
                  }}
                  disabled={isUpdating}
                >
                  {task.hardDeadline ? 'Hard Deadline' : 'Soft Deadline'}
                </button>
              </div>
            </div>
            <div className="task-properties-row">
              <div className="property-group-left task-row-property-left">
                {/* Status first */}
                <div className="property-item status-item">
                  {availableStatusOptions.length ? (
                    <StatusSelect
                      value={statusValue}
                      options={
                        statusMissing
                          ? [{ id: statusValue, name: statusValue }, ...availableStatusOptions]
                          : availableStatusOptions
                      }
                      onChange={(nextValue) => {
                        void handleUpdate(task.id, {
                          status: nextValue || null
                        });
                      }}
                      disabled={isUpdating}
                      showLabel={true}
                    />
                  ) : (
                    <input
                      type="text"
                      aria-label="Status"
                      value={customStatusDrafts[task.id] ?? statusValue}
                      onChange={(event) =>
                        handleCustomStatusChange(task.id, event.target.value)
                      }
                      onBlur={(event) =>
                        void commitCustomStatus(task.id, event.target.value)
                      }
                      placeholder="Status"
                      disabled={isUpdating}
                      className="status-pill"
                    />
                  )}
                </div>
                {/* Date second */}
                <div className="date-stack">
                  <DateField
                    value={task.dueDate ?? null}
                    endValue={task.dueDateEnd ?? null}
                    allowRange
                    allowTime
                    onChange={(
                      nextStart: string | null,
                      nextEnd?: string | null
                    ) => {
                      void handleUpdate(task.id, {
                        dueDate: nextStart,
                        dueDateEnd: nextEnd ?? null
                      });
                    }}
                    disabled={isUpdating}
                    ariaLabel="Due date"
                    inputClassName="pill-input"
                    placeholder="Due date"
                    recurrence={task.recurrence}
                    onRecurrenceChange={(recurrence) => {
                      void handleUpdate(task.id, { recurrence });
                    }}
                    reminderAt={task.reminderAt}
                    onReminderChange={(reminderAt) => {
                      void handleUpdate(task.id, { reminderAt });
                    }}
                  />
                </div>
                {/* Priority last */}
                <div className="matrix-inline task-row-matrix-inline">
                  <label htmlFor={matrixSelectId} className="sr-only">
                    Priority
                  </label>
                  <select
                    id={matrixSelectId}
                    className={`matrix-select task-row-matrix-select ${matrixClass}`}
                    value={matrixSelection}
                    onChange={(event) =>
                      handleMatrixChange(event.target.value as MatrixOptionId)
                    }
                    disabled={isUpdating}
                  >
                    {matrixOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="property-group-flags task-row-property-flags">
                <div className="task-row-flag-row">
                  <button
                    type="button"
                    className="task-notes-toggle notes-toggle-inline"
                    onClick={(e) => {
                      const taskRow = e.currentTarget.closest('.task-row') as HTMLElement;
                      toggleNotes(task.id, task.mainEntry, taskRow);
                    }}
                  >
                    {task.mainEntry ? 'Notes' : 'Add notes…'}
                  </button>
                  <label
                    className={`flag urgent ${task.urgent ? 'is-active' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={task.urgent}
                      onChange={() =>
                        void handleUpdate(task.id, {
                          urgent: !task.urgent
                        })
                      }
                      disabled={isUpdating}
                    />
                    <span className="flag-label">Urgent</span>
                  </label>

                  <label
                    className={`flag important ${
                      task.important ? 'is-active' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={task.important}
                      onChange={() =>
                        void handleUpdate(task.id, {
                          important: !task.important
                        })
                      }
                      disabled={isUpdating}
                    />
                    <span className="flag-label">Important</span>
                  </label>
                </div>
              </div>
            </div>
            {/* Project & Tags row - now above secondary row */}
            {(() => {
              const taskProjects = getTaskProjects(task);
              const hasProjects = taskProjects.length > 0;
              const isPickerOpen = expandedProjectPicker === task.id;
              // Placeholder for tags - will be implemented later
              const taskTags: string[] = [];
              
              return (
                <div className={`task-project-row ${(collapseProjectColumn || collapseTimeColumn) ? 'collapsible-column' : ''} ${hasProjects && autoExpandProjectRow ? 'has-project' : ''}`}>
                  <div className="task-project-row-left">
                    {hasProjects ? (
                      <button
                        type="button"
                        className="task-project-label"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isPickerOpen) {
                            setExpandedProjectPicker(null);
                            setPickerPosition(null);
                          } else {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setPickerPosition({ top: rect.bottom + 4, left: rect.left });
                            setExpandedProjectPicker(task.id);
                          }
                        }}
                        title="Change project"
                      >
                        <span className="project-name">
                          {taskProjects.map((p) => p.title || 'Untitled').join(', ')}
                        </span>
                        <span className="project-chevron">{isPickerOpen ? '▾' : '▸'}</span>
                      </button>
                    ) : openProjects.length > 0 ? (
                      <button
                        type="button"
                        className="task-project-label task-project-add"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isPickerOpen) {
                            setExpandedProjectPicker(null);
                            setPickerPosition(null);
                          } else {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setPickerPosition({ top: rect.bottom + 4, left: rect.left });
                            setExpandedProjectPicker(task.id);
                          }
                        }}
                        title="Add to project"
                      >
                        <span className="project-name">+ Project</span>
                      </button>
                    ) : null}
                    
                    {/* Add tag button */}
                    <button
                      type="button"
                      className="task-tag-add-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        // TODO: Open tag picker/input
                      }}
                      title="Add tag"
                    >
                      <span className="tag-icon">🏷️</span>
                      <span className="tag-label">+ Tag</span>
                    </button>
                    
                    {isPickerOpen && openProjects.length > 0 && pickerPosition && createPortal(
                      <>
                        <div 
                          className="task-project-picker-backdrop"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedProjectPicker(null);
                            setPickerPosition(null);
                          }}
                        />
                        <div 
                          className="task-project-picker"
                          style={{ top: pickerPosition.top, left: pickerPosition.left }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className={`project-option ${!hasProjects ? 'is-selected' : ''}`}
                            onClick={() => {
                              void handleUpdate(task.id, { projectIds: null });
                              setExpandedProjectPicker(null);
                              setPickerPosition(null);
                            }}
                          >
                            No project
                          </button>
                          {openProjects.map((project) => {
                            const isSelected = task.projectIds?.includes(project.id);
                            return (
                              <button
                                key={project.id}
                                type="button"
                                className={`project-option ${isSelected ? 'is-selected' : ''}`}
                                onClick={() => {
                                  void handleUpdate(task.id, { projectIds: [project.id] });
                                  setExpandedProjectPicker(null);
                                  setPickerPosition(null);
                                }}
                              >
                                {project.title || 'Untitled'}
                              </button>
                            );
                          })}
                        </div>
                      </>,
                      document.body
                    )}
                  </div>
                  
                  {/* Tags section - placeholder for future implementation */}
                  <div className="task-project-row-right">
                    {taskTags.length > 0 && (
                      <div className="task-tags">
                        {taskTags.map((tag, idx) => (
                          <span key={idx} className="task-tag">{tag}</span>
                        ))}
                      </div>
                    )}
                    
                    {/* Add subtask button - expands subtask panel */}
                    {onAddSubtask && (
                      <div className="add-subtask-container">
                        <button
                          type="button"
                          className="add-subtask-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Expand subtasks panel and start adding
                            setExpandedSubtasks(prev => ({ ...prev, [task.id]: true }));
                            setAddingSubtaskFor(task.id);
                            // Fetch subtasks if not cached
                            if (!subtaskCache[task.id]) {
                              window.widgetAPI.getSubtasks(task.id).then(subtasks => {
                                setSubtaskCache(prev => ({ ...prev, [task.id]: subtasks }));
                              });
                            }
                          }}
                          title="Add subtask"
                        >
                          <span className="add-subtask-icon">+</span>
                          <span className="add-subtask-label">Add subtask</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
            {/* Subtask list - positioned above secondary row */}
            {expandedSubtasks[task.id] && ((task.subtaskProgress && task.subtaskProgress.total > 0) || (subtaskCache[task.id] && subtaskCache[task.id].length > 0)) && (
              <div className="subtask-list-container">
                <div className="subtask-list-header">
                  <span className="subtask-list-label">Subtasks</span>
                  {onAddSubtask && (
                    <button
                      type="button"
                      className="add-subtask-inline-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAddingSubtaskFor(task.id);
                      }}
                      title="Add subtask"
                    >
                      + New
                    </button>
                  )}
                </div>
                <div className="subtask-list-body">
                  {/* Add subtask form */}
                  {addingSubtaskFor === task.id && (
                    <form
                      className="add-subtask-form subtask-row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (newSubtaskTitle.trim()) {
                          void onAddSubtask?.(task.id, newSubtaskTitle.trim()).then((newTask) => {
                            if (newTask) {
                              setSubtaskCache(prev => ({
                                ...prev,
                                [task.id]: [...(prev[task.id] || []), newTask]
                              }));
                            }
                          });
                          setNewSubtaskTitle('');
                          setAddingSubtaskFor(null);
                        }
                      }}
                    >
                      <div className="subtask-row-main">
                        <span className="subtask-checkbox-placeholder" />
                        <input
                          type="text"
                          className="subtask-title-input"
                          placeholder="New subtask..."
                          value={newSubtaskTitle}
                          onChange={(e) => setNewSubtaskTitle(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.stopPropagation();
                              setNewSubtaskTitle('');
                              setAddingSubtaskFor(null);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="subtask-form-actions">
                          <button
                            type="submit"
                            className="subtask-add-btn"
                            disabled={!newSubtaskTitle.trim()}
                          >
                            Add
                          </button>
                          <button
                            type="button"
                            className="subtask-cancel-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setNewSubtaskTitle('');
                              setAddingSubtaskFor(null);
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    </form>
                  )}
                  {subtaskCache[task.id] ? (
                    subtaskCache[task.id].map((subtask) => {
                      const subtaskIsComplete = subtask.status === completedStatus;
                      const subtaskStatusValue = subtask.status || '';
                      const subtaskMatrixSelection = 
                        subtask.urgent && subtask.important ? 'do-now' :
                        !subtask.urgent && subtask.important ? 'deep-work' :
                        subtask.urgent && !subtask.important ? 'delegate' : 'trash';
                      const subtaskMatrixClass = `matrix-${subtaskMatrixSelection}`;
                      
                      // Time tracking calculations for subtask
                      const subtaskLoggedMinutes = loggedTimes[subtask.id] ?? 0;
                      const subtaskEstimated = subtask.estimatedLengthMinutes ?? 0;
                      const subtaskRemaining = subtaskEstimated > 0 ? Math.max(0, subtaskEstimated - subtaskLoggedMinutes) : null;
                      const subtaskRemainingLabel = subtaskRemaining != null ? formatMinutes(subtaskRemaining) : null;
                      
                      return (
                        <div 
                          key={subtask.id} 
                          className={`subtask-row ${subtaskIsComplete ? 'is-complete' : ''} ${selectedSubtaskId === subtask.id ? 'is-selected' : ''}`}
                          onClick={(e) => {
                            // Don't select if clicking on an interactive element
                            if ((e.target as HTMLElement).closest(POP_OUT_INTERACTIVE_SELECTOR)) {
                              return;
                            }
                            // Toggle subtask selection
                            setSelectedSubtaskId(prev => prev === subtask.id ? null : subtask.id);
                          }}
                        >
                          {/* Row 1: Checkbox + Title + Deadline */}
                          <div className="subtask-row-main">
                            <button
                              type="button"
                              className={`subtask-checkbox ${subtaskIsComplete ? 'is-checked' : ''}`}
                              onClick={() => {
                                const newStatus = subtaskIsComplete 
                                  ? (availableStatusOptions.find(opt => opt.name !== completedStatus)?.name ?? '')
                                  : completedStatus;
                                void onUpdateTask(subtask.id, { status: newStatus });
                                setSubtaskCache(prev => ({
                                  ...prev,
                                  [task.id]: prev[task.id]?.map(s => 
                                    s.id === subtask.id ? { ...s, status: newStatus } : s
                                  ) ?? []
                                }));
                              }}
                              disabled={isUpdating}
                              title={subtaskIsComplete ? 'Mark as to-do' : 'Mark as complete'}
                            >
                              {subtaskIsComplete && <span className="check-icon">✓</span>}
                            </button>
                            <span className="subtask-title">{subtask.title}</span>
                            <div className="subtask-row-right">
                              <button
                                type="button"
                                className={`subtask-deadline-chip ${subtask.hardDeadline ? 'is-hard' : 'is-soft'}`}
                                onClick={() => {
                                  void onUpdateTask(subtask.id, { hardDeadline: !subtask.hardDeadline });
                                  setSubtaskCache(prev => ({
                                    ...prev,
                                    [task.id]: prev[task.id]?.map(s => 
                                      s.id === subtask.id ? { ...s, hardDeadline: !subtask.hardDeadline } : s
                                    ) ?? []
                                  }));
                                }}
                                disabled={isUpdating}
                              >
                                {subtask.hardDeadline ? 'Hard' : 'Soft'}
                              </button>
                            </div>
                          </div>
                          
                          {/* Row 2: Properties - Due date, Status, Priority | Notes, Urgent, Important */}
                          <div className="subtask-row-properties">
                            <div className="subtask-properties-left">
                              <DateField
                                value={subtask.dueDate ?? null}
                                endValue={subtask.dueDateEnd ?? null}
                                allowRange
                                allowTime
                                onChange={(nextStart, nextEnd) => {
                                  void onUpdateTask(subtask.id, { 
                                    dueDate: nextStart, 
                                    dueDateEnd: nextEnd ?? null 
                                  });
                                  setSubtaskCache(prev => ({
                                    ...prev,
                                    [task.id]: prev[task.id]?.map(s => 
                                      s.id === subtask.id ? { ...s, dueDate: nextStart ?? undefined, dueDateEnd: nextEnd ?? undefined } : s
                                    ) ?? []
                                  }));
                                }}
                                disabled={isUpdating}
                                inputClassName="subtask-date-field"
                                placeholder="Due date"
                              />
                              <StatusSelect
                                value={subtaskStatusValue}
                                options={availableStatusOptions}
                                onChange={(newStatus) => {
                                  void onUpdateTask(subtask.id, { status: newStatus });
                                  setSubtaskCache(prev => ({
                                    ...prev,
                                    [task.id]: prev[task.id]?.map(s => 
                                      s.id === subtask.id ? { ...s, status: newStatus } : s
                                    ) ?? []
                                  }));
                                }}
                                disabled={isUpdating}
                                showLabel={true}
                                className="subtask-status-select"
                              />
                              <select
                                className={`subtask-matrix-select ${subtaskMatrixClass}`}
                                value={subtaskMatrixSelection}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const newUrgent = val === 'do-now' || val === 'delegate';
                                  const newImportant = val === 'do-now' || val === 'deep-work';
                                  void onUpdateTask(subtask.id, { urgent: newUrgent, important: newImportant });
                                  setSubtaskCache(prev => ({
                                    ...prev,
                                    [task.id]: prev[task.id]?.map(s => 
                                      s.id === subtask.id ? { ...s, urgent: newUrgent, important: newImportant } : s
                                    ) ?? []
                                  }));
                                }}
                                disabled={isUpdating}
                              >
                                <option value="do-now">Do Now</option>
                                <option value="deep-work">Deep Work</option>
                                <option value="delegate">Delegate</option>
                                <option value="trash">Trash</option>
                              </select>
                            </div>
                            <div className="subtask-properties-right">
                              <button
                                type="button"
                                className="subtask-notes-btn"
                                onClick={(e) => {
                                  const taskRow = e.currentTarget.closest('.subtask-row') as HTMLElement;
                                  toggleNotes(subtask.id, subtask.mainEntry, taskRow);
                                }}
                              >
                                {subtask.mainEntry ? 'Notes' : 'Add notes...'}
                              </button>
                              <label className={`subtask-flag ${subtask.urgent ? 'is-active' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={subtask.urgent || false}
                                  onChange={() => {
                                    void onUpdateTask(subtask.id, { urgent: !subtask.urgent });
                                    setSubtaskCache(prev => ({
                                      ...prev,
                                      [task.id]: prev[task.id]?.map(s => 
                                        s.id === subtask.id ? { ...s, urgent: !subtask.urgent } : s
                                      ) ?? []
                                    }));
                                  }}
                                  disabled={isUpdating}
                                />
                                <span>Urgent</span>
                              </label>
                              <label className={`subtask-flag ${subtask.important ? 'is-active' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={subtask.important || false}
                                  onChange={() => {
                                    void onUpdateTask(subtask.id, { important: !subtask.important });
                                    setSubtaskCache(prev => ({
                                      ...prev,
                                      [task.id]: prev[task.id]?.map(s => 
                                        s.id === subtask.id ? { ...s, important: !subtask.important } : s
                                      ) ?? []
                                    }));
                                  }}
                                  disabled={isUpdating}
                                />
                                <span>Important</span>
                              </label>
                            </div>
                          </div>
                          
                          {/* Row 3: Actions */}
                          <div className="subtask-row-actions">
                            <button
                              type="button"
                              className="subtask-action-btn"
                              onClick={(e) => {
                                const row = e.currentTarget.closest('.subtask-row') as HTMLElement;
                                toggleEstimateEditor(subtask.id, row);
                              }}
                            >
                              {subtask.estimatedLengthMinutes ? `Edit ${subtask.estimatedLengthMinutes}m estimate` : 'Add time'}
                            </button>
                            <button
                              type="button"
                              className="subtask-action-btn subtask-trash-btn"
                              onClick={() => {
                                // Mark as cancelled/trash status
                                void onUpdateTask(subtask.id, { status: '🗑️' });
                                setSubtaskCache(prev => ({
                                  ...prev,
                                  [task.id]: prev[task.id]?.filter(s => s.id !== subtask.id) ?? []
                                }));
                              }}
                            >
                              Trash
                            </button>
                            {subtaskRemaining != null && (
                              <span className="subtask-remaining">{subtaskRemainingLabel} left</span>
                            )}
                            <a
                              className="subtask-open-link"
                              href={subtask.url || `https://notion.so/${subtask.id.replace(/-/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open
                            </a>
                          </div>
                          
                          {/* Expanded panels for subtask */}
                          {expandedNotes[subtask.id] && (
                            <div className="subtask-expanded-panel">
                              <textarea
                                className="subtask-notes-textarea"
                                placeholder="Add notes..."
                                defaultValue={subtask.mainEntry || ''}
                                onBlur={(e) => {
                                  const val = e.target.value;
                                  if (val !== subtask.mainEntry) {
                                    void onUpdateTask(subtask.id, { mainEntry: val || null });
                                    setSubtaskCache(prev => ({
                                      ...prev,
                                      [task.id]: prev[task.id]?.map(s => 
                                        s.id === subtask.id ? { ...s, mainEntry: val || undefined } : s
                                      ) ?? []
                                    }));
                                  }
                                }}
                                rows={3}
                              />
                              <button
                                type="button"
                                className="subtask-panel-close"
                                onClick={() => setExpandedNotes(prev => ({ ...prev, [subtask.id]: false }))}
                              >
                                ↖
                              </button>
                            </div>
                          )}
                          
                          {expandedEstimateEditor[subtask.id] && (
                            <div className="subtask-expanded-panel">
                              <div className="subtask-estimate-fields">
                                <label>
                                  <span>Estimated (min):</span>
                                  <input
                                    type="number"
                                    defaultValue={subtask.estimatedLengthMinutes || ''}
                                    min={0}
                                    step={5}
                                    onBlur={(e) => {
                                      const val = e.target.value ? parseInt(e.target.value, 10) : null;
                                      void onUpdateTask(subtask.id, { estimatedLengthMinutes: val });
                                      setSubtaskCache(prev => ({
                                        ...prev,
                                        [task.id]: prev[task.id]?.map(s => 
                                          s.id === subtask.id ? { ...s, estimatedLengthMinutes: val ?? undefined } : s
                                        ) ?? []
                                      }));
                                    }}
                                  />
                                </label>
                              </div>
                              <button
                                type="button"
                                className="subtask-panel-close"
                                onClick={() => setExpandedEstimateEditor(prev => ({ ...prev, [subtask.id]: false }))}
                              >
                                ↖
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="subtask-loading">Loading subtasks...</div>
                  )}
                </div>
              </div>
            )}
            {/* Time Column: Session, Time Left, Estimate + Tracking - collapsible on hover */}
            <div className={`task-secondary-row ${collapseTimeColumn ? 'collapsible-column' : ''}`}>
              <div className="task-secondary-left">
                {/* Start/Active Session - Notion style */}
                {isSessionActive || task.status === '⌚' ? (
                  <button
                    type="button"
                    className="notion-session-btn is-active"
                    onClick={(e) => {
                      const taskRow = e.currentTarget.closest('.task-row') as HTMLElement;
                      toggleSessionTimer(task.id, taskRow);
                    }}
                  >
                    <span className="session-indicator" />
                    {isCountingDown?.(task.id) && getRemainingTime && task.sessionLengthMinutes ? (
                      (() => {
                        const remainingSeconds = getRemainingTime(task.id);
                        const elapsedSeconds = (task.sessionLengthMinutes * 60) - remainingSeconds;
                        const elapsedMinutes = Math.floor(elapsedSeconds / 60);
                        const elapsedSecondsRemainder = Math.floor(elapsedSeconds % 60);
                        if (elapsedMinutes > 0) {
                          return `${elapsedMinutes}m ${elapsedSecondsRemainder}s`;
                        }
                        return `${elapsedSecondsRemainder}s`;
                      })()
                    ) : (
                      task.sessionLengthMinutes ? formatMinutes(task.sessionLengthMinutes) : 'Start'
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="notion-session-btn"
                    onClick={(e) => {
                      const taskRow = e.currentTarget.closest('.task-row') as HTMLElement;
                      toggleSessionTimer(task.id, taskRow);
                    }}
                  >
                    <span className="session-play-icon">▶</span>
                    {task.sessionLengthMinutes ? formatMinutes(task.sessionLengthMinutes) : 'Start'}
                  </button>
                )}
                {/* Time remaining - code style with dynamic colors */}
                {task.estimatedLengthMinutes && remainingMinutes != null && (
                  <code className={`time-remaining-code ${remainingMinutes <= 0 ? 'is-overtime' : remainingMinutes <= 15 ? 'is-low' : ''}`}>
                    {remainingMinutes <= 0 ? `+${formatMinutes(Math.abs(remainingMinutes))} over` : `${remainingLabel} left`}
                  </code>
                )}
              </div>
              <div className="task-secondary-right">
                {/* Estimate + Tracking grouped together */}
                <button
                  type="button"
                  className="notion-estimate-btn"
                  onClick={(e) => {
                    const taskRow = e.currentTarget.closest('.task-row') as HTMLElement;
                    toggleEstimateEditor(task.id, taskRow);
                  }}
                >
                  {task.estimatedLengthMinutes ? `⏱ ${formatMinutes(task.estimatedLengthMinutes)}` : '⏱ Estimate'}
                </button>
                <button
                  type="button"
                  className="notion-tracking-btn"
                  onClick={(e) => {
                    const taskRow = e.currentTarget.closest('.task-row') as HTMLElement;
                    toggleTrackingData(task.id, taskRow);
                  }}
                >
                  <span className="tracking-icon">📊</span>
                  Tracking
                </button>
              </div>
            </div>
            {expandedTrackingData[task.id] && (
              <div className="task-notes">
                {(() => {
                  const entries = trackingData[task.id] || [];
                  const loggedMinutes = loggedTimes[task.id] ?? 0;
                  
                  // Add current session elapsed time if active
                  let currentSessionMinutes = 0;
                  if (isCountingDown?.(task.id) && getRemainingTime && task.sessionLengthMinutes) {
                    const remainingSeconds = getRemainingTime(task.id);
                    const elapsedSeconds = (task.sessionLengthMinutes * 60) - remainingSeconds;
                    currentSessionMinutes = Math.floor(elapsedSeconds / 60);
                    void timerNow;
                  }
                  
                  const totalMinutes = loggedMinutes + currentSessionMinutes;
                  const sessionCount = entries.length;
                  const estimatedMinutes = task.estimatedLengthMinutes ?? null;
                  const goalMinutes = task.trackingGoalMinutes ?? null;
                  const hasSubtasks = task.subtaskProgress && task.subtaskProgress.total > 0;
                  
                  // Calculate remaining time
                  let calculatedRemaining: number | null = null;
                  if (estimatedMinutes != null) {
                    calculatedRemaining = Math.max(0, estimatedMinutes - totalMinutes);
                  }
                  
                  // Goal progress calculation
                  const goalProgress = goalMinutes ? Math.min(1, totalMinutes / goalMinutes) : null;
                  const isGoalExceeded = goalMinutes && totalMinutes > goalMinutes;
                  
                  const formatDateTime = (dateString: string | null | undefined) => {
                    if (!dateString) return 'N/A';
                    try {
                      const date = new Date(dateString);
                      return date.toLocaleString();
                    } catch {
                      return 'Invalid date';
                    }
                  };
                  
                  return (
                    <div style={{ padding: '12px 0' }}>
                      <div style={{ marginBottom: '16px' }}>
                        <h4 style={{ margin: '0 0 8px 0', fontSize: '0.95em', fontWeight: 600 }}>Time Tracking Summary</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.9em' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ opacity: 0.7 }}>Estimated time:</span>
                            <span>{estimatedMinutes ? formatMinutes(estimatedMinutes) : 'Not set'}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ opacity: 0.7 }}>Total tracked:</span>
                            <span style={{ fontWeight: 600 }}>{formatMinutes(totalMinutes)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ opacity: 0.7 }}>Today's session:</span>
                            <span style={{ color: '#86efac' }}>{currentSessionMinutes > 0 ? formatMinutes(currentSessionMinutes) : 'None active'}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ opacity: 0.7 }}>Remaining:</span>
                            <span>{calculatedRemaining !== null ? formatMinutes(calculatedRemaining) : 'N/A'}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ opacity: 0.7 }}>Sessions:</span>
                            <span>{sessionCount}</span>
                          </div>
                          {hasSubtasks && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '6px', marginTop: '4px' }}>
                              <span style={{ opacity: 0.7 }}>Subtasks:</span>
                              <span>{task.subtaskProgress?.completed}/{task.subtaskProgress?.total} complete</span>
                            </div>
                          )}
                        </div>
                        
                        {/* Goal progress circle */}
                        {goalMinutes && goalProgress !== null && (
                          <div className="tracking-goal-circle-container">
                            <div className={`tracking-goal-circle ${isGoalExceeded ? 'exceeded' : ''}`}>
                              <svg viewBox="0 0 36 36" className="tracking-goal-svg">
                                {/* Background track */}
                                <circle
                                  cx="18"
                                  cy="18"
                                  r="15.9"
                                  fill="none"
                                  stroke="rgba(255, 255, 255, 0.1)"
                                  strokeWidth="3"
                                />
                                {/* Progress arc */}
                                <circle
                                  cx="18"
                                  cy="18"
                                  r="15.9"
                                  fill="none"
                                  stroke={isGoalExceeded ? '#fbbf24' : '#22c55e'}
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                  strokeDasharray={`${Math.min(100, goalProgress * 100)}, 100`}
                                  transform="rotate(-90 18 18)"
                                  style={{ transition: 'stroke-dasharray 300ms ease' }}
                                />
                              </svg>
                              <div className="tracking-goal-text">
                                <span className="tracking-goal-percent">{Math.round(goalProgress * 100)}%</span>
                              </div>
                            </div>
                            <div className="tracking-goal-info">
                              <span className="tracking-goal-title">Tracking Goal/Est. Progress</span>
                              <span className="tracking-goal-detail">Goal: {formatMinutes(goalMinutes)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      {entries.length > 0 && (
                        <div>
                          <h4 style={{ margin: '0 0 8px 0', fontSize: '0.95em', fontWeight: 600 }}>Session History</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                            {entries.map((entry) => (
                              <div
                                key={entry.id}
                                style={{
                                  padding: '8px',
                                  background: 'rgba(255, 255, 255, 0.03)',
                                  borderRadius: '4px',
                                  fontSize: '0.85em'
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                  <span style={{ opacity: 0.7 }}>Duration:</span>
                                  <span>{entry.durationMinutes ? formatMinutes(entry.durationMinutes) : 'N/A'}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                  <span style={{ opacity: 0.7 }}>Started:</span>
                                  <span>{formatDateTime(entry.startTime)}</span>
                                </div>
                                {entry.endTime && (
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ opacity: 0.7 }}>Ended:</span>
                                    <span>{formatDateTime(entry.endTime)}</span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {entries.length === 0 && (
                        <p style={{ margin: 0, opacity: 0.6, fontSize: '0.9em' }}>No time tracking sessions yet.</p>
                      )}
                      
                      <button
                        type="button"
                        className="task-notes-collapse"
                        onClick={() => closeTrackingData(task.id)}
                        title="Collapse tracking data"
                        style={{ marginTop: '12px' }}
                      >
                        ↖
                      </button>
                    </div>
                  );
                })()}
              </div>
            )}
            {expandedNotes[task.id] && (
              <div className="task-notes">
                <textarea
                  data-task-notes-input="true"
                  value={noteDrafts[task.id] ?? task.mainEntry ?? ''}
                  onChange={(event) =>
                    handleNoteChange(task.id, event.target.value)
                  }
                  onBlur={(event) =>
                    void commitNoteChange(
                      task.id,
                      event.target.value,
                      task.mainEntry
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.shiftKey) {
                      event.preventDefault();
                      const value = event.currentTarget.value;
                      void (async () => {
                        await commitNoteChange(task.id, value, task.mainEntry);
                        closeNotes(task.id);
                      })();
                    }
                  }}
                  placeholder="Write context for this entry…"
                  disabled={isUpdating}
                />
                <p className="task-notes-hint">Maps to "Main Entry"</p>
                <button
                  type="button"
                  className="task-notes-collapse"
                  onClick={() => closeNotes(task.id)}
                  title="Collapse notes"
                >
                  ↖
                </button>
              </div>
            )}
            {expandedSessionTimer[task.id] && (
              <div className="task-notes">
                {isCountingDown?.(task.id) && getRemainingTime && task.sessionLengthMinutes ? (
                  <div style={{ marginBottom: '12px', padding: '8px', background: 'rgba(107, 33, 168, 0.1)', borderRadius: '4px' }}>
                    <div style={{ fontSize: '0.9em', opacity: 0.8, marginBottom: '4px' }}>Current session:</div>
                    <div style={{ fontSize: '1.1em', fontWeight: 600 }}>
                      {(() => {
                        const remainingSeconds = getRemainingTime(task.id);
                        const elapsedSeconds = (task.sessionLengthMinutes * 60) - remainingSeconds;
                        const elapsedMinutes = Math.floor(elapsedSeconds / 60);
                        const elapsedSecondsRemainder = Math.floor(elapsedSeconds % 60);
                        const remainingMinutes = Math.floor(remainingSeconds / 60);
                        const remainingSecondsRemainder = remainingSeconds % 60;
                        return `${elapsedMinutes}m ${elapsedSecondsRemainder}s elapsed • ${remainingMinutes}m ${remainingSecondsRemainder}s remaining`;
                      })()}
                    </div>
                  </div>
                ) : null}
                {/* Panel header */}
                <div className="panel-header">
                  <span className="panel-title">Sessions</span>
                  <div className="panel-header-actions">
                    <button
                      type="button"
                      className="panel-reset-btn"
                      onClick={() => {
                        setSessionInputs(prev => ({ ...prev, [task.id]: { value: '', unit: 'minutes' } }));
                      }}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      className={`panel-settings-btn ${sessionSettingsOpen[task.id] ? 'is-active' : ''}`}
                      onClick={() => setSessionSettingsOpen(prev => ({ ...prev, [task.id]: !prev[task.id] }))}
                      title="Session settings"
                    >
                      <span className="settings-icon">⚙</span>
                    </button>
                    <button
                      type="button"
                      className="notion-panel-close-sm"
                      onClick={() => closeSessionTimer(task.id)}
                      title="Close"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="notion-session-panel">
                  {/* Quick presets with remove buttons */}
                  <div className="session-presets">
                    {sessionPresets.map((preset, index) => {
                      const currentMinutes = sessionInputs[task.id]?.unit === 'hours'
                        ? parseFloat(sessionInputs[task.id]?.value || '0') * 60
                        : parseFloat(sessionInputs[task.id]?.value || '0');
                      const isSelected = currentMinutes === preset.minutes;
                      return (
                        <div key={`${preset.label}-${index}`} className="preset-chip">
                          <button
                            type="button"
                            className={`session-preset-btn ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => {
                              const useHours = preset.minutes >= 60 && preset.minutes % 60 === 0;
                              setSessionInputs(prev => ({
                                ...prev,
                                [task.id]: {
                                  value: useHours ? String(preset.minutes / 60) : String(preset.minutes),
                                  unit: useHours ? 'hours' : 'minutes'
                                }
                              }));
                            }}
                            disabled={isUpdating}
                          >
                            {preset.label}
                          </button>
                          {sessionPresets.length > 2 && (
                            <button
                              type="button"
                              className="preset-remove-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSessionPresets(prev => prev.filter((_, i) => i !== index));
                              }}
                              title="Remove preset"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {/* Add preset input */}
                    {sessionPresets.length < 6 && (
                      <div className="preset-add">
                        <input
                          type="text"
                          className="preset-add-input"
                          placeholder="+ add"
                          value={sessionPresetInput}
                          onChange={(e) => setSessionPresetInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const parsed = parseTimeString(sessionPresetInput);
                              if (parsed && !sessionPresets.some(p => p.minutes === parsed.minutes)) {
                                setSessionPresets(prev => [...prev, parsed]);
                                setSessionPresetInput('');
                              }
                            }
                          }}
                          onBlur={() => {
                            const parsed = parseTimeString(sessionPresetInput);
                            if (parsed && !sessionPresets.some(p => p.minutes === parsed.minutes)) {
                              setSessionPresets(prev => [...prev, parsed]);
                              setSessionPresetInput('');
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>
                  {/* Custom input + Start */}
                  <div className="session-custom">
                    <div className="session-input-group">
                      <input
                        data-task-session-input="true"
                        type="number"
                        min="0.5"
                        step="0.5"
                        placeholder="0"
                        className="notion-input session-duration-input"
                        value={sessionInputs[task.id]?.value ?? ''}
                        onChange={(e) => handleSessionInputChange(task.id, e.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleStartSession(task.id);
                          }
                        }}
                        disabled={isUpdating}
                      />
                      <div className="session-unit-toggle">
                        <button
                          type="button"
                          className={`unit-btn ${sessionInputs[task.id]?.unit === 'minutes' ? 'is-active' : ''}`}
                          onClick={() => sessionInputs[task.id]?.unit !== 'minutes' && handleSessionUnitToggle(task.id)}
                          disabled={isUpdating}
                        >
                          min
                        </button>
                        <button
                          type="button"
                          className={`unit-btn ${sessionInputs[task.id]?.unit === 'hours' ? 'is-active' : ''}`}
                          onClick={() => sessionInputs[task.id]?.unit !== 'hours' && handleSessionUnitToggle(task.id)}
                          disabled={isUpdating}
                        >
                          hr
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="notion-start-btn"
                      onClick={() => handleStartSession(task.id)}
                      disabled={isUpdating || !sessionInputs[task.id]?.value || parseFloat(sessionInputs[task.id]?.value ?? '0') <= 0}
                    >
                      {isCountingDown?.(task.id) ? 'Add' : 'Start'}
                    </button>
                  </div>
                </div>
                {/* Settings dropdown */}
                {sessionSettingsOpen[task.id] && (
                  <div className="panel-settings-dropdown">
                    <label className="settings-option">
                      <input
                        type="checkbox"
                        checked={task.doneTrackingAfterCycle ?? false}
                        onChange={(e) => {
                          void handleUpdate(task.id, { doneTrackingAfterCycle: e.target.checked });
                        }}
                      />
                      <div className="option-content">
                        <span className="option-label">Auto-end session</span>
                        <span className="option-hint">Stop timer when it reaches zero (otherwise continues negative)</span>
                      </div>
                    </label>
                  </div>
                )}
              </div>
            )}
            {expandedEstimateEditor[task.id] && (
              <div className="task-notes estimate-editor notion-estimate-panel">
                {/* Panel header */}
                <div className="panel-header">
                  <span className="panel-title">Estimates</span>
                  <div className="panel-header-actions">
                    <button
                      type="button"
                      className="panel-reset-btn"
                      onClick={() => {
                        handleUpdate(task.id, { estimatedLengthMinutes: null });
                        setEstimateInputs(prev => ({ ...prev, [task.id]: { value: '', unit: 'minutes' } }));
                      }}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      className={`panel-settings-btn ${estimateSettingsOpen[task.id] ? 'is-active' : ''}`}
                      onClick={() => setEstimateSettingsOpen(prev => ({ ...prev, [task.id]: !prev[task.id] }))}
                      title="Estimate settings"
                    >
                      <span className="settings-icon">⚙</span>
                    </button>
                    <button
                      type="button"
                      className="notion-panel-close-sm"
                      onClick={() => closeEstimateEditor(task.id)}
                      title="Close"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="estimate-panel-content">
                  {/* Quick presets with remove buttons */}
                  <div className="estimate-presets">
                    {estimatePresets.map((preset, index) => {
                      const currentMinutes = estimateInputs[task.id]?.unit === 'hours'
                        ? parseFloat(estimateInputs[task.id]?.value || '0') * 60
                        : parseFloat(estimateInputs[task.id]?.value || '0');
                      const isSelected = currentMinutes === preset.minutes;
                      return (
                        <div key={`${preset.label}-${index}`} className="preset-chip">
                          <button
                            type="button"
                            className={`estimate-preset-btn ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => {
                              const useHours = preset.minutes >= 60 && preset.minutes % 60 === 0;
                              setEstimateInputs(prev => ({
                                ...prev,
                                [task.id]: {
                                  value: useHours ? String(preset.minutes / 60) : String(preset.minutes),
                                  unit: useHours ? 'hours' : 'minutes'
                              }
                            }));
                          }}
                          disabled={isUpdating}
                        >
                          {preset.label}
                        </button>
                          {estimatePresets.length > 2 && (
                            <button
                              type="button"
                              className="preset-remove-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEstimatePresets(prev => prev.filter((_, i) => i !== index));
                              }}
                              title="Remove preset"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {/* Add preset input */}
                    {estimatePresets.length < 6 && (
                      <div className="preset-add">
                        <input
                          type="text"
                          className="preset-add-input"
                          placeholder="+ add"
                          value={estimatePresetInput}
                          onChange={(e) => setEstimatePresetInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const parsed = parseTimeString(estimatePresetInput);
                              if (parsed && !estimatePresets.some(p => p.minutes === parsed.minutes)) {
                                setEstimatePresets(prev => [...prev, parsed]);
                                setEstimatePresetInput('');
                              }
                            }
                          }}
                          onBlur={() => {
                            const parsed = parseTimeString(estimatePresetInput);
                            if (parsed && !estimatePresets.some(p => p.minutes === parsed.minutes)) {
                              setEstimatePresets(prev => [...prev, parsed]);
                              setEstimatePresetInput('');
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>
                  {/* Custom input + Save */}
                  <div className="estimate-custom">
                    <div className="estimate-input-group">
                      <input
                        type="number"
                        min="0.5"
                        step="0.5"
                        placeholder="0"
                        className="notion-input estimate-duration-input"
                        value={estimateInputs[task.id]?.value ?? ''}
                        onChange={(e) => handleEstimateInputChange(task.id, e.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleSaveEstimatedLength(task.id);
                          }
                        }}
                        disabled={isUpdating}
                      />
                      <div className="estimate-unit-toggle">
                        <button
                          type="button"
                          className={`unit-btn ${estimateInputs[task.id]?.unit === 'minutes' ? 'is-active' : ''}`}
                          onClick={() => estimateInputs[task.id]?.unit !== 'minutes' && handleEstimateUnitToggle(task.id)}
                          disabled={isUpdating}
                        >
                          min
                        </button>
                        <button
                          type="button"
                          className={`unit-btn ${estimateInputs[task.id]?.unit === 'hours' ? 'is-active' : ''}`}
                          onClick={() => estimateInputs[task.id]?.unit !== 'hours' && handleEstimateUnitToggle(task.id)}
                          disabled={isUpdating}
                        >
                          hr
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="notion-save-btn"
                      onClick={() => handleSaveEstimatedLength(task.id)}
                      disabled={isUpdating}
                    >
                      Save
                    </button>
                  </div>
                </div>
                {/* Settings dropdown */}
                {estimateSettingsOpen[task.id] && (
                  <div className="panel-settings-dropdown">
                    <label className="settings-option">
                      <input
                        type="checkbox"
                        checked={task.autoFillEstimatedTime ?? false}
                        onChange={(e) => {
                          void handleUpdate(task.id, { autoFillEstimatedTime: e.target.checked });
                        }}
                      />
                      <div className="option-content">
                        <span className="option-label">Auto-fill on completion</span>
                        <span className="option-hint">Log estimate as tracked time when task completes</span>
                      </div>
                    </label>
                  </div>
                )}
              </div>
            )}
            {isCountingDown?.(task.id) && (
              <div className="task-notes" style={{ background: 'rgba(107, 33, 168, 0.1)', border: '1px solid rgba(107, 33, 168, 0.3)' }}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '12px',
                  flexWrap: 'wrap',
                  padding: '8px 0'
                }}>
                  <div style={{ 
                    fontSize: '1.5em',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontWeight: '600',
                    color: '#a855f7',
                    letterSpacing: '1px'
                  }}>
                    {formatTime?.(getRemainingTime?.(task.id) ?? 0) ?? '0:00'}
                  </div>
                  {getEndTime?.(task.id) && formatEndTime && (
                    <div style={{ 
                      fontSize: '0.9em',
                      color: 'rgba(255, 255, 255, 0.7)'
                    }}>
                      Ends at {formatEndTime(getEndTime(task.id)!)}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onStopSession?.(task.id)}
                    style={{
                      marginLeft: 'auto',
                      padding: '6px 14px',
                      background: 'transparent',
                      border: '1px solid rgba(255, 255, 255, 0.4)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'rgba(255, 255, 255, 0.85)',
                      cursor: 'pointer',
                      fontWeight: 500
                    }}
                  >
                    Stop session
                  </button>
                  {onFocusTask && (
                    <button
                      type="button"
                      onClick={() =>
                        onFocusTask(isFocusedTask ? null : task.id)
                      }
                      style={{
                        padding: '6px 14px',
                        background: 'rgba(168, 85, 247, 0.2)',
                        border: '1px solid rgba(168, 85, 247, 0.5)',
                        borderRadius: 'var(--radius-sm)',
                        color: '#f3e8ff',
                        cursor: 'pointer',
                        fontWeight: 500
                      }}
                    >
                      {isFocusedTask ? 'Exit focus' : 'Focus'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </article>
          </Fragment>
        );
      };

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  // Handle dropping a task onto a group header (inline function to avoid hook order issues)
  const handleGroupDrop = async (groupId: string, event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setGroupDropTarget(null);
    
    // Get the dragged task
    const taskId = event.dataTransfer.getData('application/x-task-id');
    const draggedTask = taskId ? tasks.find((t) => t.id === taskId) : draggingTaskId ? tasks.find((t) => t.id === draggingTaskId) : null;
    
    if (!draggedTask || !grouping || grouping === 'none') return;
    
    // Determine what updates to apply based on grouping type
    let updates: TaskUpdatePayload = {};
    
    switch (grouping) {
      case 'dueDate': {
        if (groupId === 'no-date') {
          updates.dueDate = null;
        } else {
          // groupId is a date string like "2025-11-25"
          const parts = groupId.split('-').map(Number);
          if (parts.length === 3) {
            const dropDate = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
            updates.dueDate = dropDate.toISOString();
          }
        }
        break;
      }
      case 'status': {
        // Map normalized status back to emoji status
        const statusMap: Record<string, string> = {
          'todo': '📋',
          'in-progress': '🔥',
          'waiting': '⏳',
          'blocked': '🚫',
          'review': '👀',
          'done': '✅',
          'cancelled': '🗑️'
        };
        const newStatus = statusMap[groupId] || groupId;
        updates.status = newStatus;
        break;
      }
      case 'priority': {
        // Map priority ID to urgent/important flags
        switch (groupId) {
          case 'do-now':
            updates.urgent = true;
            updates.important = true;
            break;
          case 'deep-work':
            updates.urgent = false;
            updates.important = true;
            break;
          case 'delegate':
            updates.urgent = true;
            updates.important = false;
            break;
          case 'trash':
            updates.urgent = false;
            updates.important = false;
            break;
        }
        break;
      }
    }
    
    if (Object.keys(updates).length > 0) {
      try {
        await onUpdateTask(draggedTask.id, updates);
      } catch (error) {
        console.error('Failed to update task on group drop', error);
      }
    }
    
    // Clean up drag state
    if (manualOrderingActive) {
      handleDragEnd();
    }
  };
  
  const handleGroupDragOver = (groupId: string, event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setGroupDropTarget(groupId);
  };
  
  const handleGroupDragLeave = (groupId: string) => {
    setGroupDropTarget((prev) => (prev === groupId ? null : prev));
  };

  const renderGroup = (group: TaskGroup) => {
    const collapsed = collapsedGroups[group.id] ?? true;
    const isDropTarget = groupDropTarget === group.id;
    
    return (
      <section
        key={group.id}
        className={`task-group ${collapsed ? 'is-collapsed' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
        onDragOver={(e) => handleGroupDragOver(group.id, e)}
        onDragLeave={() => handleGroupDragLeave(group.id)}
        onDrop={(e) => handleGroupDrop(group.id, e)}
      >
        <div
          className={`task-group-header ${isDropTarget ? 'is-drop-target' : ''}`}
          onClick={() => toggleGroup(group.id)}
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleGroup(group.id);
            }
          }}
        >
          <div className="task-group-header-text">
            <span className="task-group-title">{group.label}</span>
            {group.description && (
              <span className="task-group-description">
                {group.description}
              </span>
            )}
          </div>
          <div className="task-group-meta">
            <span className="task-group-count">{group.tasks.length}</span>
            <span className="task-group-chevron" aria-hidden="true"></span>
          </div>
          {isDropTarget && (
            <div className="group-drop-indicator">
              Drop to move here
            </div>
          )}
        </div>
        {!collapsed && (
          <div className="task-group-body">
            {group.tasks.map((task) => renderTask(task))}
          </div>
        )}
      </section>
    );
  };

  // Virtualized rendering for ungrouped tasks
  const renderVirtualizedTasks = () => {
    // Always render active tasks (they're usually few and at the top)
    const activeTasksRendered = ungroupedActiveTasks.map((task) => renderTask(task));
    
    // For inactive tasks, use virtualization if there are many
    const totalInactive = ungroupedInactiveTasks.length;
    const shouldVirtualize = totalInactive > INITIAL_RENDER_COUNT && !manualOrderingActive;
    
    if (!shouldVirtualize) {
      // Render all tasks normally if count is small or manual ordering is active
      return (
        <>
          {ungroupedActiveTasks.length > 0 && (
            <div className="task-active-stack">
              {activeTasksRendered}
            </div>
          )}
          {ungroupedInactiveTasks.map((task) => renderTask(task))}
        </>
      );
    }
    
    // Virtualized rendering: only render visible tasks with spacers
    const { start, end } = visibleRange;
    const clampedStart = Math.max(0, Math.min(start, totalInactive));
    const clampedEnd = Math.min(end, totalInactive);
    
    const topSpacerHeight = clampedStart * TASK_ROW_HEIGHT;
    const bottomSpacerHeight = Math.max(0, (totalInactive - clampedEnd) * TASK_ROW_HEIGHT);
    
    const visibleTasks = ungroupedInactiveTasks.slice(clampedStart, clampedEnd);
    
    return (
      <>
        {ungroupedActiveTasks.length > 0 && (
          <div className="task-active-stack">
            {activeTasksRendered}
          </div>
        )}
        {topSpacerHeight > 0 && (
          <div 
            className="task-list-spacer" 
            style={{ height: topSpacerHeight, minHeight: topSpacerHeight }}
            aria-hidden="true"
          />
        )}
        {visibleTasks.map((task) => renderTask(task))}
        {bottomSpacerHeight > 0 && (
          <div 
            className="task-list-spacer" 
            style={{ height: bottomSpacerHeight, minHeight: bottomSpacerHeight }}
            aria-hidden="true"
          />
        )}
      </>
    );
  };

  return (
    <>
      {multiSelectMode && (
        <MassEditToolbar
          selectedCount={multiSelectedIds.size}
          statusOptions={availableStatusOptions}
          onMassUpdate={handleMassUpdate}
          onClearSelection={handleClearMultiSelection}
          onSelectAll={handleSelectAll}
          totalCount={tasks.length}
        />
      )}
      <div
        ref={(node) => {
          // Support both external scrollContainerRef and internal virtualListRef
          if (virtualListRef) virtualListRef.current = node;
          if (scrollContainerRef && 'current' in scrollContainerRef) {
            (scrollContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
          }
        }}
        className={`task-list ${hasGroups ? 'with-groups' : ''} ${multiSelectMode ? 'in-multi-select-mode' : ''} ${draggingTaskId ? 'is-dragging' : ''} ${suppressHover ? 'suppress-hover' : ''}`}
        onDragOver={manualOrderingActive ? handleListDragOver : undefined}
        onDrop={manualOrderingActive ? handleListDrop : undefined}
        onClick={(e) => {
          // Deselect when clicking on empty space (not on a task row)
          const target = e.target as HTMLElement;
          if (!target.closest('.task-row') && !target.closest('.task-group-header')) {
            onSelectTask?.(null);
          }
        }}
      >
        {hasGroups && groups ? (
          groups.map((group) => renderGroup(group))
        ) : (
          renderVirtualizedTasks()
        )}
        {renderDropZone('drop-end', '__end', 'below')}
      </div>
    </>
  );
};

export default TaskList;


