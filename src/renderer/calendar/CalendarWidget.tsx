import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type { PointerEvent as ReactPointerEvent, DragEvent as ReactDragEvent } from 'react';
import type {
  DockState,
  NotionSettings,
  Project,
  ResizeDirection,
  Task,
  TaskStatusOption,
  TaskUpdatePayload
} from '@shared/types';
import { widgetBridge } from '@shared/platform';
import TaskList from '../components/TaskList';

// Constants
const DEFAULT_DOCK_STATE: DockState = { edge: 'right', collapsed: false };
const widgetAPI = widgetBridge;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Helper functions
const getDateKey = (date: Date) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const getTodayKey = () => getDateKey(new Date());

const matchesDate = (dateStr: string | undefined, targetDateStr: string): boolean => {
  if (!dateStr) return false;
  return dateStr.startsWith(targetDateStr);
};

const CalendarWidget: React.FC = () => {
  // Core state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusOptions, setStatusOptions] = useState<TaskStatusOption[]>([]);
  const [notionSettings, setNotionSettings] = useState<NotionSettings | null>(null);
  
  // Calendar state
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  
  // Widget state
  const [dockState, setDockState] = useState<DockState>(DEFAULT_DOCK_STATE);
  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState(false);
  
  // Refs
  const shellRef = useRef<HTMLDivElement>(null);
  const collapseTimeoutRef = useRef<number | null>(null);
  const taskListScrollRef = useRef<HTMLDivElement>(null);
  
  // Today's date key
  const todayKey = getTodayKey();
  const selectedDateKey = getDateKey(selectedDate);
  
  // Check if we're running in Electron (with full API)
  const isElectron = typeof window !== 'undefined' && window.widgetAPI;
  
  // Load tasks
  const fetchTasks = useCallback(async () => {
    // In browser mode, show empty state
    if (!isElectron) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [fetched, opts, settings, prjs] = await Promise.all([
        widgetAPI.getTasks(),
        widgetAPI.getStatusOptions(),
        widgetAPI.getSettings(),
        widgetAPI.getProjects()
      ]);
      setTasks(fetched);
      setStatusOptions(opts);
      setNotionSettings(settings);
      setProjects(prjs);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [isElectron]);
  
  // Load settings
  useEffect(() => {
    if (!isElectron) {
      setLoading(false);
      return;
    }
    
    const loadSettings = async () => {
      try {
        const [appPrefs, dock] = await Promise.all([
          widgetAPI.getAppPreferences(),
          widgetAPI.getCalendarDockState()
        ]);
        setPinned(appPrefs?.pinWidget ?? false);
        if (dock) {
          setDockState(dock);
          setCollapsed(dock.collapsed);
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    };
    loadSettings();
    void fetchTasks();
  }, [isElectron, fetchTasks]);
  
  // Subscribe to task updates
  useEffect(() => {
    if (!isElectron) return;
    
    const unsubscribe = widgetAPI.onTaskUpdated?.((updatedTask) => {
      setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
    });
    return () => { unsubscribe?.(); };
  }, [isElectron]);
  
  // Subscribe to dock state changes
  useEffect(() => {
    if (!isElectron) return;
    
    const unsubscribe = widgetAPI.onDockStateChange?.((state) => {
      widgetAPI.getCalendarDockState().then((calState) => {
        if (calState) {
          setDockState(calState);
          setCollapsed(calState.collapsed);
        }
      }).catch(() => {});
    });
    return () => { unsubscribe?.(); };
  }, [isElectron]);
  
  // Handle task update (for drag & drop reschedule)
  const handleUpdateTask = useCallback(async (taskId: string, updates: TaskUpdatePayload) => {
    if (!isElectron) return;
    try {
      await widgetAPI.updateTask(taskId, updates);
      void fetchTasks();
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  }, [isElectron, fetchTasks]);
  
  // Navigation
  const navigatePrev = useCallback(() => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() - 1);
      return d;
    });
  }, []);
  
  const navigateNext = useCallback(() => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + 1);
      return d;
    });
  }, []);
  
  const navigateToday = useCallback(() => {
    const today = new Date();
    setCurrentDate(today);
    setSelectedDate(today);
  }, []);
  
  // Collapse/expand handlers
  const handleMouseEnter = useCallback(() => {
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
    if (collapsed && isElectron) {
      void widgetAPI.calendarExpand?.();
    }
  }, [collapsed, isElectron]);
  
  const handleMouseLeave = useCallback(() => {
    if (pinned || !isElectron) return;
    collapseTimeoutRef.current = window.setTimeout(() => {
      void widgetAPI.calendarCollapse?.();
    }, 2000);
  }, [pinned, isElectron]);
  
  // Resize handlers
  const handleResizePointerDown = useCallback(
    (direction: ResizeDirection) => (event: ReactPointerEvent) => {
      if (!isElectron) return;
      
      event.preventDefault();
      event.stopPropagation();
      let lastX = event.screenX;
      let lastY = event.screenY;
      
      const handleMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.screenX - lastX;
        const deltaY = moveEvent.screenY - lastY;
        if (deltaX !== 0 || deltaY !== 0) {
          widgetAPI.resizeWindow?.(direction, deltaX, deltaY);
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
    [isElectron]
  );
  
  // Drag and drop handlers
  const handleDayDragOver = useCallback((event: ReactDragEvent, dateStr: string) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(dateStr);
  }, []);
  
  const handleDayDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);
  
  const handleDayDrop = useCallback(async (event: ReactDragEvent, dateStr: string) => {
    event.preventDefault();
    setDropTarget(null);
    
    const taskId = event.dataTransfer.getData('application/x-task-id');
    if (taskId) {
      await handleUpdateTask(taskId, { dueDate: dateStr });
    }
  }, [handleUpdateTask]);
  
  // Generate calendar grid data
  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    
    const startDayOfWeek = firstDayOfMonth.getDay();
    const daysInMonth = lastDayOfMonth.getDate();
    
    const days: Array<{ date: Date; dateStr: string; isCurrentMonth: boolean }> = [];
    
    // Add days from previous month
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const date = new Date(year, month, -i);
      days.push({
        date,
        dateStr: getDateKey(date),
        isCurrentMonth: false
      });
    }
    
    // Add days of current month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      days.push({
        date,
        dateStr: getDateKey(date),
        isCurrentMonth: true
      });
    }
    
    // Add days from next month to fill the grid (6 rows × 7 days = 42 cells)
    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      const date = new Date(year, month + 1, i);
      days.push({
        date,
        dateStr: getDateKey(date),
        isCurrentMonth: false
      });
    }
    
    return days;
  }, [currentDate]);
  
  // Get month/year title
  const monthTitle = useMemo(() => {
    return currentDate.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric'
    });
  }, [currentDate]);
  
  // Selected date title for task panel
  const selectedDateTitle = useMemo(() => {
    return selectedDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
  }, [selectedDate]);
  
  // Tasks on selected day
  const tasksOnSelectedDay = useMemo(() => {
    return tasks.filter(t => matchesDate(t.dueDate, selectedDateKey));
  }, [tasks, selectedDateKey]);
  
  // Manual status list
  const manualStatuses = useMemo(() => {
    return statusOptions.map(s => s.name);
  }, [statusOptions]);
  
  // Completed status for checking task completion
  const completedStatus = notionSettings?.completedStatus;
  
  // Shell classes
  const shellClass = useMemo(() => {
    const classes = ['calendar-widget-shell'];
    if (collapsed) classes.push('is-collapsed');
    if (dockState.edge) classes.push(`dock-${dockState.edge}`);
    return classes.join(' ');
  }, [collapsed, dockState.edge]);
  
  // Render a day cell
  const renderDayCell = useCallback(({ date, dateStr, isCurrentMonth }: { date: Date; dateStr: string; isCurrentMonth: boolean }) => {
    const isToday = dateStr === todayKey;
    const isSelected = dateStr === selectedDateKey;
    const tasksOnDay = tasks.filter((t) => matchesDate(t.dueDate, dateStr));
    const isDropTargetCell = dropTarget === dateStr;
    
    // Check if day is in the past
    const dayDate = new Date(dateStr);
    dayDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isPastDay = dayDate < today;
    
    // Limit visible tasks
    const maxTasks = 3;
    const visibleTasks = tasksOnDay.slice(0, maxTasks);
    const hiddenCount = tasksOnDay.length - visibleTasks.length;
    
    return (
      <div
        key={dateStr}
        className={`calendar-grid-cell ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''} ${
          isCurrentMonth ? '' : 'is-other-month'
        } ${isDropTargetCell ? 'is-drop-target' : ''}`}
        onClick={() => {
          setSelectedDate(date);
        }}
        onDragOver={(e) => handleDayDragOver(e, dateStr)}
        onDragLeave={handleDayDragLeave}
        onDrop={(e) => handleDayDrop(e, dateStr)}
      >
        <div className="calendar-cell-header">
          <span className={`calendar-cell-date ${isToday ? 'today-badge' : ''}`}>
            {date.getDate()}
          </span>
          {tasksOnDay.length > 0 && (
            <span className="calendar-cell-count">{tasksOnDay.length}</span>
          )}
        </div>
        <div className="calendar-cell-content">
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
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-task-id', task.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
              >
                <span className="calendar-task-title">{task.title}</span>
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <div className="calendar-task-more">+{hiddenCount} more</div>
          )}
        </div>
      </div>
    );
  }, [tasks, todayKey, selectedDateKey, dropTarget, completedStatus, handleDayDragOver, handleDayDragLeave, handleDayDrop]);
  
  return (
    <div 
      ref={shellRef}
      className={shellClass}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="calendar-widget-surface">
        {/* Drag strip for window movement */}
        <div className="calendar-drag-strip" aria-hidden="true" />
        
        {/* Two-panel layout: Tasks on left, Calendar on right */}
        <div className="calendar-widget-layout">
          {/* Left panel: Task list for selected day */}
          <div className="calendar-tasks-panel">
            <header className="calendar-tasks-header">
              <h2 className="calendar-tasks-title">{selectedDateTitle}</h2>
            </header>
            <div className="calendar-tasks-content" ref={taskListScrollRef}>
              {loading ? (
                <div className="calendar-tasks-empty">Loading tasks...</div>
              ) : tasksOnSelectedDay.length === 0 ? (
                <div className="calendar-tasks-empty">
                  <span className="empty-icon">📅</span>
                  <p>No tasks for this day</p>
                </div>
              ) : (
                <TaskList
                  tasks={tasksOnSelectedDay}
                  loading={false}
                  error={null}
                  statusOptions={statusOptions}
                  manualStatuses={manualStatuses}
                  completedStatus={completedStatus}
                  onUpdateTask={handleUpdateTask}
                  emptyMessage="No tasks for this day"
                  grouping="none"
                  scrollContainerRef={taskListScrollRef}
                  projects={projects}
                />
              )}
            </div>
          </div>
          
          {/* Right panel: Calendar grid */}
          <div className="calendar-grid-panel">
            {/* Header with month navigation */}
            <header className="calendar-widget-header">
              <button
                type="button"
                className="calendar-nav-btn"
                onClick={navigatePrev}
                title="Previous month"
              >
                ←
              </button>
              <h2 className="calendar-month-title">{monthTitle}</h2>
              <button
                type="button"
                className="calendar-nav-btn"
                onClick={navigateNext}
                title="Next month"
              >
                →
              </button>
            </header>
            
            {/* Calendar grid */}
            <div className="calendar-grid-container">
              {error ? (
                <div className="calendar-error">{error}</div>
              ) : (
                <div className="calendar-full-grid">
                  {/* Weekday headers */}
                  <div className="calendar-weekday-header">
                    {WEEKDAYS.map((day) => (
                      <div key={day} className="calendar-weekday">{day}</div>
                    ))}
                  </div>
                  
                  {/* Calendar grid body */}
                  <div className="calendar-grid-body">
                    {calendarDays.map(renderDayCell)}
                  </div>
                </div>
              )}
            </div>
            
            {/* Navigation bar at bottom */}
            <footer className="calendar-timeline-scrubber">
              <button
                type="button"
                className="timeline-nav-btn"
                onClick={navigatePrev}
                title="Previous month"
              >
                ← 1 month
              </button>
              <button
                type="button"
                className="timeline-today-btn"
                onClick={navigateToday}
              >
                Today
              </button>
              <button
                type="button"
                className="timeline-nav-btn"
                onClick={navigateNext}
                title="Next month"
              >
                1 month →
              </button>
            </footer>
          </div>
        </div>
        
        {/* Resize handles */}
        <div className="resize-handle edge-left" onPointerDown={handleResizePointerDown('left')} />
        <div className="resize-handle edge-right" onPointerDown={handleResizePointerDown('right')} />
        <div className="resize-handle edge-top" onPointerDown={handleResizePointerDown('top')} />
        <div className="resize-handle edge-bottom" onPointerDown={handleResizePointerDown('bottom')} />
        <div className="resize-handle corner top-left" onPointerDown={handleResizePointerDown('top-left')} />
        <div className="resize-handle corner top-right" onPointerDown={handleResizePointerDown('top-right')} />
        <div className="resize-handle corner bottom-left" onPointerDown={handleResizePointerDown('bottom-left')} />
        <div className="resize-handle corner bottom-right" onPointerDown={handleResizePointerDown('bottom-right')} />
      </div>
    </div>
  );
};

export default CalendarWidget;
