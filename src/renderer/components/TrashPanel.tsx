import { useEffect, useState, useCallback } from 'react';
import type { Task } from '@shared/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const TrashPanel = ({ isOpen, onClose }: Props) => {
  const [trashedTasks, setTrashedTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchTrashedTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tasks = await window.widgetAPI.listTrashedTasks();
      setTrashedTasks(tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trashed tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchTrashedTasks();
    }
  }, [isOpen, fetchTrashedTasks]);

  // Listen for trash changes
  useEffect(() => {
    const unsubscribe = window.widgetAPI.onTrashChanged(() => {
      if (isOpen) {
        fetchTrashedTasks();
      }
    });
    return unsubscribe;
  }, [isOpen, fetchTrashedTasks]);

  const handleRestore = async (taskId: string) => {
    setActionInProgress(taskId);
    setError(null);
    try {
      await window.widgetAPI.restoreTaskFromTrash(taskId);
      setTrashedTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore task');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm('Permanently delete this task? This cannot be undone.')) {
      return;
    }
    setActionInProgress(taskId);
    setError(null);
    try {
      await window.widgetAPI.permanentlyDeleteTask(taskId);
      setTrashedTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete task');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleEmptyTrash = async () => {
    if (!confirm(`Permanently delete all ${trashedTasks.length} trashed tasks? This cannot be undone.`)) {
      return;
    }
    setActionInProgress('all');
    setError(null);
    try {
      await window.widgetAPI.emptyTrash();
      setTrashedTasks([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to empty trash');
    } finally {
      setActionInProgress(null);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  if (!isOpen) return null;

  return (
    <div className="trash-panel-overlay" onClick={onClose}>
      <aside 
        className="trash-panel" 
        role="dialog" 
        aria-label="Trash"
        onClick={e => e.stopPropagation()}
      >
        <header className="trash-panel-header">
          <div className="trash-panel-title">
            <span className="trash-icon">🗑️</span>
            <h2>Trash</h2>
            <span className="trash-count">{trashedTasks.length}</span>
          </div>
          <button
            type="button"
            className="trash-panel-close"
            onClick={onClose}
            aria-label="Close trash panel"
          >
            ×
          </button>
        </header>

        {error && (
          <div className="trash-panel-error">
            {error}
          </div>
        )}

        <div className="trash-panel-body">
          {loading ? (
            <div className="trash-panel-loading">Loading...</div>
          ) : trashedTasks.length === 0 ? (
            <div className="trash-panel-empty">
              <span className="empty-icon">✨</span>
              <p>Trash is empty</p>
              <span className="empty-hint">Tasks deleted in Notion will appear here</span>
            </div>
          ) : (
            <ul className="trash-task-list">
              {trashedTasks.map(task => (
                <li key={task.id} className="trash-task-item">
                  <div className="trash-task-info">
                    <span className="trash-task-title">{task.title}</span>
                    <span className="trash-task-meta">
                      {task.trashedAt && `Deleted ${formatDate(task.trashedAt)}`}
                      {task.status && ` · ${task.status}`}
                    </span>
                  </div>
                  <div className="trash-task-actions">
                    <button
                      type="button"
                      className="trash-action restore"
                      onClick={() => handleRestore(task.id)}
                      disabled={actionInProgress !== null}
                      title="Restore task"
                    >
                      {actionInProgress === task.id ? '...' : '↩️'}
                    </button>
                    <button
                      type="button"
                      className="trash-action delete"
                      onClick={() => handleDelete(task.id)}
                      disabled={actionInProgress !== null}
                      title="Delete permanently"
                    >
                      {actionInProgress === task.id ? '...' : '🗑️'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {trashedTasks.length > 0 && (
          <footer className="trash-panel-footer">
            <span className="trash-footer-hint">
              Tasks are automatically removed after 30 days
            </span>
            <button
              type="button"
              className="trash-empty-btn"
              onClick={handleEmptyTrash}
              disabled={actionInProgress !== null}
            >
              {actionInProgress === 'all' ? 'Emptying...' : 'Empty Trash'}
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
};

export default TrashPanel;

