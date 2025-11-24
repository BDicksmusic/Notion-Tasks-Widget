import { useCallback, useEffect, useMemo, useState } from 'react';
import TaskList from '../components/TaskList';
import { widgetBridge } from '@shared/platform';
import type {
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

  return (
    <div className="task-window-shell">
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

