import { useCallback, useEffect, useMemo, useState } from 'react';
import TaskList from '../components/TaskList';
import { widgetBridge } from '@shared/platform';
import type {
  CrossWindowDragState,
  NotionSettings,
  Task,
  TaskStatusOption,
  TaskUpdatePayload
} from '@shared/types';

const widgetAPI = widgetBridge;

const TaskWindowApp = () => {
  const [task, setTask] = useState<Task | null>(null);
  const [loadingTask, setLoadingTask] = useState(true);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [statusOptions, setStatusOptions] = useState<TaskStatusOption[]>([]);
  const [notionSettings, setNotionSettings] = useState<NotionSettings | null>(
    null
  );
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [sortHold, setSortHold] = useState<Record<string, number>>({});
  const [crossWindowDrag, setCrossWindowDrag] = useState<CrossWindowDragState>({
    task: null,
    sourceWindow: null,
    isDragging: false
  });
  const [isDropTarget, setIsDropTarget] = useState(false);

  const taskId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('taskId');
  }, []);

  const refreshTask = useCallback(async () => {
    if (!taskId) {
      setTask(null);
      setTaskError('No task selected');
      setLoadingTask(false);
      return;
    }
    setLoadingTask(true);
    try {
      const tasks = await widgetAPI.getTasks();
      const nextTask = tasks.find((entry) => entry.id === taskId) ?? null;
        setTask(nextTask);
        if (nextTask) {
          setSortHold({
            [nextTask.id]: Date.now() + 7000
          });
        }
      setTaskError(nextTask ? null : 'Task not found');
    } catch (error) {
      setTaskError(
        error instanceof Error ? error.message : 'Unable to load task'
      );
    } finally {
      setLoadingTask(false);
    }
  }, [taskId]);

  useEffect(() => {
    void refreshTask();
  }, [refreshTask]);

  useEffect(() => {
    widgetAPI
      .getStatusOptions()
      .then(setStatusOptions)
      .catch((error) => {
        console.error('Unable to load status options', error);
      });
    widgetAPI
      .getSettings()
      .then(setNotionSettings)
      .catch((error) => {
        console.error('Unable to load Notion settings', error);
      });
    widgetAPI
      .getAlwaysOnTop()
      .then(setAlwaysOnTop)
      .catch((error) => {
        console.error('Unable to read always-on-top state', error);
      });
  }, []);

  useEffect(() => {
    if (!taskId) return;
    const unsubscribe = widgetAPI.onTaskUpdated((updatedTask) => {
      if (updatedTask.id !== taskId) return;
      setTask(updatedTask);
      setSortHold({
        [updatedTask.id]: Date.now() + 7000
      });
    });
    return () => {
      unsubscribe?.();
    };
  }, [taskId]);

  // Subscribe to cross-window drag state
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

  // Cross-window drag handlers
  const handleCrossWindowDragStart = useCallback((dragTask: Task) => {
    if (typeof widgetAPI.startCrossWindowDrag === 'function') {
      void widgetAPI.startCrossWindowDrag(dragTask, 'widget');
    }
  }, []);

  const handleCrossWindowDragEnd = useCallback(() => {
    // Don't auto-end - let the drop handler or cancel do it
  }, []);

  // Cancel cross-window drag with Escape
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

  const handleUpdateTask = useCallback(
    async (id: string, updates: TaskUpdatePayload) => {
      await widgetAPI.updateTask(id, updates);
      setSortHold({
        [id]: Date.now() + 7000
      });
    },
    []
  );

  const handlePinToggle = useCallback(async () => {
    const next = !alwaysOnTop;
    try {
      const result = await widgetAPI.setAlwaysOnTop(next);
      setAlwaysOnTop(result);
    } catch (error) {
      console.error('Unable to toggle pin state', error);
    }
  }, [alwaysOnTop]);

  const handleCloseWindow = useCallback(() => {
    widgetAPI.closeWindow();
  }, []);

  const handleRefreshTask = useCallback(() => {
    void refreshTask();
  }, [refreshTask]);

  const manualStatuses = notionSettings?.statusPresets ?? [];
  const completedStatus = notionSettings?.completedStatus;

  // Handle dropping a task onto this window to replace the current focus task
  const handleDrop = useCallback(async () => {
    if (!crossWindowDrag.isDragging || !crossWindowDrag.task) return;
    
    // Add to focus stack
    try {
      await widgetAPI.addToFocusStack?.(crossWindowDrag.task.id);
      widgetAPI.endCrossWindowDrag?.();
    } catch (error) {
      console.error('Failed to add to focus stack', error);
    }
    setIsDropTarget(false);
  }, [crossWindowDrag]);

  return (
    <div 
      className={`task-window-shell ${isDropTarget ? 'is-drop-target' : ''} ${crossWindowDrag.isDragging ? 'is-receiving-drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDropTarget(true);
      }}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={(e) => {
        e.preventDefault();
        void handleDrop();
      }}
      onClick={crossWindowDrag.isDragging ? () => void handleDrop() : undefined}
    >
      {/* Cross-window drag indicator */}
      {crossWindowDrag.isDragging && (
        <div className="task-window-drop-overlay" onClick={() => void handleDrop()}>
          <div className="drop-overlay-content">
            <span className="drop-icon">📥</span>
            <span className="drop-text">Click to add "{crossWindowDrag.task?.title}" to queue</span>
          </div>
        </div>
      )}
      <div className="task-window-surface">
        <section className="task-window-body">
          <TaskList
            tasks={task ? [task] : []}
            loading={loadingTask}
            error={taskError}
            statusOptions={statusOptions}
            manualStatuses={manualStatuses}
            completedStatus={completedStatus}
            onUpdateTask={handleUpdateTask}
            emptyMessage="Task not available"
            grouping="none"
            sortHold={sortHold}
            holdDuration={7000}
            disableSortHoldIndicators
            enableExternalDrag={true}
            onTaskDragStart={handleCrossWindowDragStart}
            onTaskDragEnd={handleCrossWindowDragEnd}
          />
        </section>
        <footer className="task-window-footer">
          <div className="task-window-footer-left">
            <p className="eyebrow">Focused task</p>
          </div>
          <div className="task-window-footer-actions">
            <button
              type="button"
              className="pill ghost"
              onClick={handleRefreshTask}
              disabled={loadingTask}
            >
              Refresh
            </button>
            <button
              type="button"
              className={`pin-toggle ${alwaysOnTop ? 'is-active' : ''}`}
              onClick={handlePinToggle}
              aria-pressed={alwaysOnTop}
              title="Pin this window above others"
            >
              <span className="pin-icon" aria-hidden="true">
                ✔
              </span>
              <span>Pin</span>
            </button>
            <button
              type="button"
              className="task-window-close"
              onClick={handleCloseWindow}
              aria-label="Close window"
            >
              ×
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default TaskWindowApp;

