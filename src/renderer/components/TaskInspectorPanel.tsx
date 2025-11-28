import { useEffect, useMemo, useState } from 'react';
import type {
  Task,
  TaskStatusOption,
  TaskUpdatePayload
} from '@shared/types';

interface Props {
  task: Task;
  statusOptions: TaskStatusOption[];
  completedStatus?: string;
  onClose: () => void;
  onUpdateTask(taskId: string, updates: TaskUpdatePayload): Promise<void>;
}

const TaskInspectorPanel = ({
  task,
  statusOptions,
  completedStatus,
  onClose,
  onUpdateTask
}: Props) => {
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [statusDraft, setStatusDraft] = useState(task.status ?? '');
  const [dueDateDraft, setDueDateDraft] = useState(
    task.dueDate ? task.dueDate.slice(0, 10) : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitleDraft(task.title);
    setStatusDraft(task.status ?? '');
    setDueDateDraft(task.dueDate ? task.dueDate.slice(0, 10) : '');
    setError(null);
  }, [task.id, task.title, task.status, task.dueDate]);

  const hasChanges = useMemo(() => {
    const originalDue = task.dueDate ? task.dueDate.slice(0, 10) : '';
    return (
      titleDraft.trim() !== task.title.trim() ||
      statusDraft !== (task.status ?? '') ||
      dueDateDraft !== originalDue
    );
  }, [task.dueDate, task.status, task.title, titleDraft, statusDraft, dueDateDraft]);

  const handleSave = async () => {
    if (!hasChanges) return;
    setSaving(true);
    setError(null);
    try {
      await onUpdateTask(task.id, {
        title: titleDraft.trim() || task.title,
        status: statusDraft ? statusDraft : null,
        dueDate: dueDateDraft || null
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update task');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleComplete = async () => {
    if (!completedStatus) return;
    setSaving(true);
    setError(null);
    try {
      const isComplete = task.status === completedStatus;
      await onUpdateTask(task.id, {
        status: isComplete ? null : completedStatus
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update task');
    } finally {
      setSaving(false);
    }
  };

  const inspectorStatusOptions =
    statusOptions.length > 0
      ? statusOptions
      : [{ id: 'default', name: statusDraft || 'To-do' }];

  return (
    <aside
      className="task-inspector-panel"
      role="dialog"
      aria-label={`Inspector for ${task.title}`}
    >
      <header className="task-inspector-header">
        <div>
          <p className="task-inspector-eyebrow">Task inspector</p>
          <h3>{task.title}</h3>
        </div>
        <button
          type="button"
          className="task-inspector-close"
          onClick={onClose}
          aria-label="Close task inspector"
        >
          ×
        </button>
      </header>

      <div className="task-inspector-body">
        <label className="inspector-field">
          <span>Title</span>
          <input
            type="text"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            placeholder="Task title"
          />
        </label>

        <label className="inspector-field">
          <span>Status</span>
          <select
            value={statusDraft}
            onChange={(event) => setStatusDraft(event.target.value)}
          >
            <option value="">Unspecified</option>
            {inspectorStatusOptions.map((option) => (
              <option key={option.id} value={option.name}>
                {option.name}
              </option>
            ))}
          </select>
        </label>

        <label className="inspector-field">
          <span>Due date</span>
          <input
            type="date"
            value={dueDateDraft}
            onChange={(event) => setDueDateDraft(event.target.value)}
          />
        </label>

        <div className="task-inspector-actions">
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || saving}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            onClick={handleToggleComplete}
            disabled={!completedStatus || saving}
          >
            {task.status === completedStatus ? 'Mark as to-do' : 'Mark complete'}
          </button>
          {task.url && (
            <button
              type="button"
              onClick={() => window.open(task.url, '_blank', 'noopener')}
            >
              Open in Notion
            </button>
          )}
        </div>

        {error && <p className="task-inspector-error">{error}</p>}

        <section className="task-inspector-section">
          <h4>Sub-actions</h4>
          <p>
            We detected the Notion relation named <strong>Subactions</strong>.
            This panel will soon surface those linked subtasks so you can keep
            everything in sync without leaving the widget.
          </p>
          <p className="subactions-hint">
            For now you can continue managing them directly in your database—we
            already know there’s a parent/child relationship, we’re just wiring
            up the UI.
          </p>
        </section>
      </div>
    </aside>
  );
};

export default TaskInspectorPanel;






