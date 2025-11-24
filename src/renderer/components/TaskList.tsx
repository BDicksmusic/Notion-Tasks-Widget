import { useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Task, TaskStatusOption, TaskUpdatePayload } from '@shared/types';
import {
  getMatrixClass,
  matrixOptions,
  findMatrixOptionById,
  findMatrixOptionFromFlags,
  type MatrixOptionId
} from '../constants/matrix';
import DateField from './DateField';
import { getStatusColorClass } from '../utils/statusColors';
import type { GroupingOption, TaskGroup } from '../utils/sorting';

const POP_OUT_INTERACTIVE_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'label',
  'a'
].join(', ');

interface Props {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  statusOptions: TaskStatusOption[];
  manualStatuses: string[];
  completedStatus?: string;
  onUpdateTask(taskId: string, updates: TaskUpdatePayload): Promise<void>;
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
  onStopSession?: (taskId: string) => void;
  onFocusTask?: (taskId: string | null) => void;
  focusTaskId?: string | null;
  isFocusMode?: boolean;
}

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
  isFocusMode
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
  const [expandedEstimateEditor, setExpandedEstimateEditor] = useState<Record<string, boolean>>({});
  const [estimateInputs, setEstimateInputs] = useState<Record<string, { value: string; unit: 'minutes' | 'hours' }>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());
  const [loggedTimes, setLoggedTimes] = useState<Record<string, number>>({});
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
    setSessionInputs((prev) => {
      if (prev[taskId] !== undefined) return prev;
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
      return {
        ...prev,
        [taskId]: {
          value: defaultValue,
          unit: prefersHours ? 'hours' : 'minutes'
        }
      };
    });
    
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

  const hasGroups = grouping !== 'none' && Boolean(groups?.length);
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
          playCompletionSound(isComplete ? 'undo' : 'complete');
          void handleUpdate(task.id, {
            status: isComplete ? defaultStatus || null : completedStatus
          });
          // Scroll to center after toggle
          if (onScrollToCenter) {
            setTimeout(() => {
              const taskRow = event.currentTarget.closest('.task-row') as HTMLElement;
              if (taskRow) {
                onScrollToCenter(taskRow);
              }
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
        
        return (
          <article
            key={task.id}
            className={`task-row ${isSessionActive ? 'has-active-session' : ''} ${
              isFocusedTask ? 'is-focused-task' : ''
            }`}
            onDoubleClickCapture={handleRowDoubleClickCapture}
          >
            <div className="task-row-header">
              <div className="task-header-left">
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
                <button
                  type="button"
                  aria-label="Toggle deadline hardness"
                  className={`chip deadline-chip ${
                    task.hardDeadline ? 'chip-hard' : 'chip-soft'
                  }`}
                  onClick={(e) => {
                    void handleUpdate(task.id, {
                      hardDeadline: !task.hardDeadline
                    });
                    // Scroll to center after toggle
                    if (onScrollToCenter) {
                      setTimeout(() => {
                        const taskRow = e.currentTarget.closest('.task-row') as HTMLElement;
                        if (taskRow) {
                          onScrollToCenter(taskRow);
                        }
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
                  />
                </div>
                <div className="property-item status-item">
                  {availableStatusOptions.length ? (
                    <select
                      className={`pill-select status-pill ${getStatusColorClass(statusValue)}`}
                      aria-label="Status"
                      value={statusValue}
                      onChange={(event) => {
                        const nextValue = event.target.value || null;
                        void handleUpdate(task.id, {
                          status: nextValue
                        });
                      }}
                      disabled={isUpdating}
                    >
                      {statusMissing && (
                        <option value={statusValue}>{statusValue}</option>
                      )}
                      {availableStatusOptions.map((option) => (
                        <option key={option.id} value={option.name}>
                          {option.name}
                        </option>
                      ))}
                    </select>
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
            <div className="task-secondary-row">
              <div className="task-secondary-left">
                <button
                  type="button"
                  className="task-notes-toggle"
                  onClick={(e) => {
                    const taskRow = e.currentTarget.closest('.task-row') as HTMLElement;
                    toggleEstimateEditor(task.id, taskRow);
                  }}
                >
                  {estimatedButtonLabel}
                </button>
                {isSessionActive || task.status === '⌚' ? (
                  <button
                    type="button"
                    className="task-notes-toggle"
                    onClick={(e) => {
                      const taskRow = e.currentTarget.closest('.task-row') as HTMLElement;
                      toggleSessionTimer(task.id, taskRow);
                    }}
                  >
                    {isCountingDown?.(task.id) && getRemainingTime && task.sessionLengthMinutes ? (
                      (() => {
                        const remainingSeconds = getRemainingTime(task.id);
                        const elapsedSeconds = (task.sessionLengthMinutes * 60) - remainingSeconds;
                        const elapsedMinutes = Math.floor(elapsedSeconds / 60);
                        const elapsedSecondsRemainder = Math.floor(elapsedSeconds % 60);
                        // Format as "Xm Ys elapsed" or just "Xs elapsed" if less than a minute
                        if (elapsedMinutes > 0) {
                          return `${elapsedMinutes}m ${elapsedSecondsRemainder}s elapsed`;
                        }
                        return `${elapsedSecondsRemainder}s elapsed`;
                      })()
                    ) : (
                      sessionButtonLabel
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="task-notes-toggle"
                    onClick={(e) => {
                      const taskRow = e.currentTarget.closest('.task-row') as HTMLElement;
                      toggleSessionTimer(task.id, taskRow);
                    }}
                  >
                    {sessionButtonLabel}
                  </button>
                )}
              </div>
              <div className="task-secondary-right">
                {task.estimatedLengthMinutes && remainingMinutes != null && (
                  <span className="estimated-length-pill">
                    {remainingLabel} left
                  </span>
                )}
                <button
                  type="button"
                  className="task-notes-toggle"
                  onClick={(e) => {
                    const taskRow = e.currentTarget.closest('.task-row') as HTMLElement;
                    toggleNotes(task.id, task.mainEntry, taskRow);
                  }}
                >
                  {task.mainEntry ? 'View notes' : 'Add notes…'}
                </button>
                <button
                  type="button"
                  className="task-notes-toggle"
                  onClick={(e) => {
                    const taskRow = e.currentTarget.closest('.task-row') as HTMLElement;
                    toggleTrackingData(task.id, taskRow);
                  }}
                >
                  Tracking data
                </button>
                {task.url && (
                  <a
                    className="pill link open-link"
                    href={task.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                  </a>
                )}
              </div>
            </div>
            {expandedNotes[task.id] && (
              <div className="task-notes">
                <textarea
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
                  
                  // Calculate remaining time
                  let calculatedRemaining: number | null = null;
                  if (estimatedMinutes != null) {
                    calculatedRemaining = Math.max(0, estimatedMinutes - totalMinutes);
                  }
                  
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
                            <span>{formatMinutes(totalMinutes)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ opacity: 0.7 }}>Remaining:</span>
                            <span>{calculatedRemaining !== null ? formatMinutes(calculatedRemaining) : 'N/A'}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ opacity: 0.7 }}>Sessions:</span>
                            <span>{sessionCount}</span>
                          </div>
                        </div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    placeholder="0"
                    value={sessionInputs[task.id]?.value ?? ''}
                    onChange={(e) => handleSessionInputChange(task.id, e.target.value)}
                    style={{
                      width: '60px',
                      padding: '4px 6px',
                      fontSize: '0.9em',
                      border: '1px solid var(--notion-border)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--notion-bg-secondary)',
                      color: 'var(--notion-text)'
                    }}
                    disabled={isUpdating}
                  />
                  <button
                    type="button"
                    onClick={() => handleSessionUnitToggle(task.id)}
                    style={{
                      padding: '4px 12px',
                      fontSize: '0.85em',
                      border: '1px solid var(--notion-border)',
                      borderRadius: 'var(--radius-sm)',
                      background: sessionInputs[task.id]?.unit === 'hours' ? 'var(--notion-blue)' : 'var(--notion-bg-secondary)',
                      color: 'var(--notion-text)',
                      cursor: 'pointer'
                    }}
                    disabled={isUpdating}
                  >
                    {sessionInputs[task.id]?.unit === 'hours' ? 'Hours' : 'Minutes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStartSession(task.id)}
                    disabled={isUpdating || !sessionInputs[task.id]?.value || parseFloat(sessionInputs[task.id]?.value ?? '0') <= 0}
                    style={{
                      padding: '4px 12px',
                      fontSize: '0.85em',
                      border: '1px solid #4CAF50',
                      borderRadius: 'var(--radius-sm)',
                      background: '#4CAF50',
                      color: 'white',
                      cursor: 'pointer',
                      opacity: (!sessionInputs[task.id]?.value || parseFloat(sessionInputs[task.id]?.value ?? '0') <= 0) ? 0.5 : 1
                    }}
                  >
                    {isCountingDown?.(task.id) ? 'Add time' : 'Start'}
                  </button>
                </div>
                <p className="task-notes-hint">
                  {isCountingDown?.(task.id) ? 'Add extra time to current session' : 'Start a timed work session'}
                </p>
                <button
                  type="button"
                  className="task-notes-collapse"
                  onClick={() => closeSessionTimer(task.id)}
                  title="Collapse session timer"
                >
                  ↖
                </button>
              </div>
            )}
            {expandedEstimateEditor[task.id] && (
              <div className="task-notes estimate-editor">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap'
                  }}
                >
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    placeholder="0"
                    value={estimateInputs[task.id]?.value ?? ''}
                    onChange={(e) => handleEstimateInputChange(task.id, e.target.value)}
                    style={{
                      width: '60px',
                      padding: '4px 6px',
                      fontSize: '0.9em',
                      border: '1px solid var(--notion-border)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--notion-bg-secondary)',
                      color: 'var(--notion-text)'
                    }}
                    disabled={isUpdating}
                  />
                  <button
                    type="button"
                    onClick={() => handleEstimateUnitToggle(task.id)}
                    style={{
                      padding: '4px 12px',
                      fontSize: '0.85em',
                      border: '1px solid var(--notion-border)',
                      borderRadius: 'var(--radius-sm)',
                      background: estimateInputs[task.id]?.unit === 'hours' ? 'var(--notion-blue)' : 'var(--notion-bg-secondary)',
                      color: 'var(--notion-text)',
                      cursor: 'pointer'
                    }}
                    disabled={isUpdating}
                  >
                    {estimateInputs[task.id]?.unit === 'hours' ? 'Hours' : 'Minutes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveEstimatedLength(task.id)}
                    style={{
                      padding: '4px 12px',
                      fontSize: '0.85em',
                      border: '1px solid rgba(168, 85, 247, 0.5)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(168, 85, 247, 0.25)',
                      color: '#d8b4fe',
                      cursor: 'pointer'
                    }}
                  >
                    Save estimate
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleUpdate(task.id, { estimatedLengthMinutes: null });
                      closeEstimateEditor(task.id);
                    }}
                    style={{
                      padding: '4px 12px',
                      fontSize: '0.85em',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'transparent',
                      color: 'rgba(255, 255, 255, 0.8)',
                      cursor: 'pointer'
                    }}
                  >
                    Clear
                  </button>
                </div>
                <p className="task-notes-hint">Plan how long you expect this to take</p>
                <button
                  type="button"
                  className="task-notes-collapse"
                  onClick={() => closeEstimateEditor(task.id)}
                  title="Collapse estimated length editor"
                >
                  ↖
                </button>
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
        );
      };

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  const renderGroup = (group: TaskGroup) => {
    const collapsed = collapsedGroups[group.id] ?? true;
    return (
      <section
        key={group.id}
        className={`task-group ${collapsed ? 'is-collapsed' : ''}`}
      >
        <button
          type="button"
          className="task-group-header"
          onClick={() => toggleGroup(group.id)}
          aria-expanded={!collapsed}
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
        </button>
        {!collapsed && (
          <div className="task-group-body">
            {group.tasks.map((task) => renderTask(task))}
          </div>
        )}
      </section>
    );
  };

  return (
    <div
      ref={scrollContainerRef}
      className={`task-list ${hasGroups ? 'with-groups' : ''}`}
    >
      {hasGroups && groups ? (
        groups.map((group) => renderGroup(group))
      ) : (
        <>
          {ungroupedActiveTasks.length > 0 && (
            <div className="task-active-stack">
              {ungroupedActiveTasks.map((task) => renderTask(task))}
            </div>
          )}
          {ungroupedInactiveTasks.map((task) => renderTask(task))}
        </>
      )}
    </div>
  );
};

export default TaskList;

