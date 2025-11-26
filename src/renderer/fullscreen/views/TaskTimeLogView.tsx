import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Task, TimeLogEntry, Project } from '@shared/types';
import { widgetBridge } from '@shared/platform';
import SearchInput from '../../components/SearchInput';

interface TaskTimeLogViewProps {
  tasks: Task[];
  projects: Project[];
  completedStatus?: string;
  selectedProjectId?: string | null;
  onSelectProject?: (projectId: string | null) => void;
  onSelectTask?: (taskId: string) => void;
}

interface TaskWithLogs {
  task: Task;
  logs: TimeLogEntry[];
  totalMinutes: number;
  lastActivity: Date | null;
}

const widgetAPI = widgetBridge;

const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

const formatTime = (timeString: string | null | undefined): string => {
  if (!timeString) return '—';
  const date = new Date(timeString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};

const formatDate = (timeString: string | null | undefined): string => {
  if (!timeString) return '—';
  const date = new Date(timeString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
};

const formatRelativeDate = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

type SortOption = 'recent' | 'total-time' | 'name' | 'due-date';
type ViewMode = 'cards' | 'timeline';

const SEARCH_STORAGE_KEY = 'widget.taskTimeLog.search';

const TaskTimeLogView = ({
  tasks,
  projects,
  completedStatus,
  selectedProjectId,
  onSelectProject,
  onSelectTask
}: TaskTimeLogViewProps) => {
  const [allLogs, setAllLogs] = useState<TimeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [showCompleted, setShowCompleted] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage?.getItem(SEARCH_STORAGE_KEY) ?? '';
  });

  // Persist search query
  useEffect(() => {
    window.localStorage?.setItem(SEARCH_STORAGE_KEY, searchQuery);
  }, [searchQuery]);

  // Fetch all time logs
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setLoading(true);
        const logs = await widgetAPI.getAllTimeLogs();
        setAllLogs(logs);
      } catch (error) {
        console.error('Failed to fetch time logs', error);
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, []);

  // Filter tasks by project and search
  const filteredTasks = useMemo(() => {
    let result = tasks;
    
    if (selectedProjectId) {
      result = result.filter((task) =>
        (task.projectIds ?? []).includes(selectedProjectId)
      );
    }
    
    if (!showCompleted) {
      result = result.filter((task) => task.status !== completedStatus);
    }
    
    // Apply search filter
    const searchLower = searchQuery.toLowerCase().trim();
    if (searchLower) {
      result = result.filter((task) => {
        const titleMatch = task.title?.toLowerCase().includes(searchLower);
        const bodyMatch = task.body?.toLowerCase().includes(searchLower);
        return titleMatch || bodyMatch;
      });
    }
    
    return result;
  }, [tasks, selectedProjectId, showCompleted, completedStatus, searchQuery]);

  // Build task-log associations
  const tasksWithLogs = useMemo((): TaskWithLogs[] => {
    return filteredTasks.map((task) => {
      const taskLogs = allLogs.filter((log) => log.taskId === task.id);
      const totalMinutes = taskLogs.reduce((sum, log) => {
        return sum + (log.durationMinutes ?? 0);
      }, 0);
      
      const lastLog = taskLogs
        .filter((log) => log.endTime)
        .sort((a, b) => {
          const dateA = new Date(a.endTime!).getTime();
          const dateB = new Date(b.endTime!).getTime();
          return dateB - dateA;
        })[0];
      
      const lastActivity = lastLog?.endTime ? new Date(lastLog.endTime) : null;
      
      return {
        task,
        logs: taskLogs.sort((a, b) => {
          const dateA = a.startTime ? new Date(a.startTime).getTime() : 0;
          const dateB = b.startTime ? new Date(b.startTime).getTime() : 0;
          return dateB - dateA;
        }),
        totalMinutes,
        lastActivity
      };
    });
  }, [filteredTasks, allLogs]);

  // Sort tasks
  const sortedTasks = useMemo(() => {
    return [...tasksWithLogs].sort((a, b) => {
      switch (sortBy) {
        case 'recent': {
          const dateA = a.lastActivity?.getTime() ?? 0;
          const dateB = b.lastActivity?.getTime() ?? 0;
          return dateB - dateA;
        }
        case 'total-time':
          return b.totalMinutes - a.totalMinutes;
        case 'name':
          return (a.task.title ?? '').localeCompare(b.task.title ?? '');
        case 'due-date': {
          const dateA = a.task.dueDate ? new Date(a.task.dueDate).getTime() : Infinity;
          const dateB = b.task.dueDate ? new Date(b.task.dueDate).getTime() : Infinity;
          return dateA - dateB;
        }
        default:
          return 0;
      }
    });
  }, [tasksWithLogs, sortBy]);

  // Calculate summary stats
  const stats = useMemo(() => {
    const totalTime = sortedTasks.reduce((sum, t) => sum + t.totalMinutes, 0);
    const tasksWithTime = sortedTasks.filter((t) => t.totalMinutes > 0).length;
    const avgTimePerTask = tasksWithTime > 0 ? Math.round(totalTime / tasksWithTime) : 0;
    const todayLogs = allLogs.filter((log) => {
      if (!log.startTime) return false;
      const logDate = new Date(log.startTime);
      const today = new Date();
      return logDate.toDateString() === today.toDateString();
    });
    const todayMinutes = todayLogs.reduce((sum, log) => sum + (log.durationMinutes ?? 0), 0);
    
    return { totalTime, tasksWithTime, avgTimePerTask, todayMinutes };
  }, [sortedTasks, allLogs]);

  const toggleExpand = useCallback((taskId: string) => {
    setExpandedTaskId((prev) => (prev === taskId ? null : taskId));
  }, []);

  const renderTaskCard = (item: TaskWithLogs) => {
    const { task, logs, totalMinutes, lastActivity } = item;
    const isExpanded = expandedTaskId === task.id;
    const isComplete = task.status === completedStatus;
    const hasEstimate = task.estimatedLengthMinutes != null;
    const progressPercent = hasEstimate && task.estimatedLengthMinutes
      ? Math.min(100, Math.round((totalMinutes / task.estimatedLengthMinutes) * 100))
      : null;
    
    return (
      <div
        key={task.id}
        className={`timelog-task-card ${isExpanded ? 'is-expanded' : ''} ${isComplete ? 'is-complete' : ''}`}
      >
        <div
          className="timelog-task-header"
          onClick={() => toggleExpand(task.id)}
        >
          <div className="timelog-task-info">
            <div className="timelog-task-title">{task.title}</div>
            <div className="timelog-task-meta">
              {task.dueDate && (
                <span className="timelog-task-due">
                  Due {formatDate(task.dueDate)}
                </span>
              )}
              {lastActivity && (
                <span className="timelog-task-activity">
                  Last: {formatRelativeDate(lastActivity)}
                </span>
              )}
            </div>
          </div>
          <div className="timelog-task-stats">
            <div className="timelog-task-time">
              <span className="timelog-task-time-value">
                {totalMinutes > 0 ? formatDuration(totalMinutes) : '—'}
              </span>
              {hasEstimate && (
                <span className="timelog-task-estimate">
                  / {formatDuration(task.estimatedLengthMinutes!)}
                </span>
              )}
            </div>
            {progressPercent !== null && (
              <div className="timelog-task-progress">
                <div
                  className="timelog-task-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}
            <span className="timelog-task-sessions">
              {logs.length} session{logs.length !== 1 ? 's' : ''}
            </span>
          </div>
          <span className="timelog-expand-icon">{isExpanded ? '▾' : '▸'}</span>
        </div>
        
        {isExpanded && (
          <div className="timelog-task-logs">
            {logs.length === 0 ? (
              <div className="timelog-no-logs">No time logged yet</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="timelog-log-entry">
                  <div className="timelog-log-date">
                    {formatDate(log.startTime)}
                  </div>
                  <div className="timelog-log-times">
                    <span className="timelog-log-start">{formatTime(log.startTime)}</span>
                    <span className="timelog-log-separator">→</span>
                    <span className="timelog-log-end">{formatTime(log.endTime)}</span>
                  </div>
                  <div className="timelog-log-duration">
                    {log.durationMinutes ? formatDuration(log.durationMinutes) : '—'}
                  </div>
                </div>
              ))
            )}
            <button
              type="button"
              className="timelog-open-task"
              onClick={(e) => {
                e.stopPropagation();
                onSelectTask?.(task.id);
              }}
            >
              Open task details →
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderTimelineView = () => {
    // Group logs by date
    const logsByDate = new Map<string, { date: Date; logs: (TimeLogEntry & { task?: Task })[] }>();
    
    allLogs.forEach((log) => {
      if (!log.startTime) return;
      const date = new Date(log.startTime);
      const dateKey = date.toDateString();
      
      // Check if task is in filtered set
      const task = filteredTasks.find((t) => t.id === log.taskId);
      if (!task && selectedProjectId) return;
      
      if (!logsByDate.has(dateKey)) {
        logsByDate.set(dateKey, { date, logs: [] });
      }
      logsByDate.get(dateKey)!.logs.push({ ...log, task });
    });
    
    // Sort dates descending
    const sortedDates = Array.from(logsByDate.values())
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 14); // Last 2 weeks
    
    return (
      <div className="timelog-timeline">
        {sortedDates.map(({ date, logs }) => {
          const dayTotal = logs.reduce((sum, log) => sum + (log.durationMinutes ?? 0), 0);
          
          return (
            <div key={date.toISOString()} className="timelog-day-group">
              <div className="timelog-day-header">
                <span className="timelog-day-date">{formatDate(date.toISOString())}</span>
                <span className="timelog-day-total">{formatDuration(dayTotal)}</span>
              </div>
              <div className="timelog-day-entries">
                {logs.sort((a, b) => {
                  const timeA = a.startTime ? new Date(a.startTime).getTime() : 0;
                  const timeB = b.startTime ? new Date(b.startTime).getTime() : 0;
                  return timeB - timeA;
                }).map((log) => (
                  <div
                    key={log.id}
                    className="timelog-timeline-entry"
                    onClick={() => log.taskId && onSelectTask?.(log.taskId)}
                  >
                    <div className="timelog-timeline-time">
                      {formatTime(log.startTime)} - {formatTime(log.endTime)}
                    </div>
                    <div className="timelog-timeline-task">
                      {log.task?.title ?? log.taskTitle ?? 'Unknown task'}
                    </div>
                    <div className="timelog-timeline-duration">
                      {log.durationMinutes ? formatDuration(log.durationMinutes) : '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="timelog-view-loading">
        <div className="loading-spinner" />
        <p>Loading time logs...</p>
      </div>
    );
  }

  return (
    <div className="task-timelog-view">
      <div className="timelog-view-toolbar">
        <div className="timelog-toolbar-left">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search tasks..."
          />
          <select
            className="timelog-project-filter"
            value={selectedProjectId ?? ''}
            onChange={(e) => onSelectProject?.(e.target.value || null)}
          >
            <option value="">All Projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title ?? 'Untitled'}
              </option>
            ))}
          </select>
          <select
            className="timelog-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
          >
            <option value="recent">Recent Activity</option>
            <option value="total-time">Total Time</option>
            <option value="name">Task Name</option>
            <option value="due-date">Due Date</option>
          </select>
          <label className="timelog-show-completed">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
            />
            Show completed
          </label>
        </div>
        <div className="timelog-toolbar-right">
          <div className="timelog-view-toggle">
            <button
              type="button"
              className={viewMode === 'cards' ? 'active' : ''}
              onClick={() => setViewMode('cards')}
            >
              Cards
            </button>
            <button
              type="button"
              className={viewMode === 'timeline' ? 'active' : ''}
              onClick={() => setViewMode('timeline')}
            >
              Timeline
            </button>
          </div>
        </div>
      </div>

      <div className="timelog-view-stats">
        <div className="timelog-stat">
          <span className="timelog-stat-value">{formatDuration(stats.todayMinutes)}</span>
          <span className="timelog-stat-label">Today</span>
        </div>
        <div className="timelog-stat">
          <span className="timelog-stat-value">{formatDuration(stats.totalTime)}</span>
          <span className="timelog-stat-label">Total Logged</span>
        </div>
        <div className="timelog-stat">
          <span className="timelog-stat-value">{stats.tasksWithTime}</span>
          <span className="timelog-stat-label">Tasks with Time</span>
        </div>
        <div className="timelog-stat">
          <span className="timelog-stat-value">{formatDuration(stats.avgTimePerTask)}</span>
          <span className="timelog-stat-label">Avg per Task</span>
        </div>
      </div>

      <div className="timelog-view-content">
        {viewMode === 'cards' ? (
          <div className="timelog-task-list">
            {sortedTasks.length === 0 ? (
              <div className="timelog-empty">
                <span className="timelog-empty-icon">⏱</span>
                <h3>No tasks found</h3>
                <p>
                  {searchQuery.trim()
                    ? 'No tasks match your search.'
                    : selectedProjectId
                      ? 'This project has no tasks yet.'
                      : 'Add tasks to start tracking time.'}
                </p>
              </div>
            ) : (
              sortedTasks.map(renderTaskCard)
            )}
          </div>
        ) : (
          renderTimelineView()
        )}
      </div>
    </div>
  );
};

export default TaskTimeLogView;

