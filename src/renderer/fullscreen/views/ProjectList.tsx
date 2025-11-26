import { useCallback, useMemo, useState } from 'react';
import type { Project, Task, TaskStatusOption, TaskUpdatePayload, NotionCreatePayload } from '@shared/types';

interface ProjectStats {
  total: number;
  completed: number;
  inProgress: number;
  todo: number;
  urgent: number;
  important: number;
  overdue: number;
  dueThisWeek: number;
  progress: number;
  tasksRemaining: number;
  nextAction: Task | null;
  overdueTask: Task | null;
}

interface Props {
  projects: Project[];
  tasks: Task[];
  statusOptions: TaskStatusOption[];
  completedStatus?: string;
  onSelectProject?: (projectId: string) => void;
  onUpdateTask?: (taskId: string, updates: TaskUpdatePayload) => Promise<void>;
  onAddTask?: (payload: NotionCreatePayload) => Promise<void>;
  onSelectTask?: (taskId: string) => void;
  onOpenProjectWorkspace?: (projectId: string) => void;
  selectedProjectId?: string | null;
}

// Format relative date with days
const formatRelativeDate = (dateStr: string) => {
  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  const diffDays = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  return `${diffDays}d left`;
};

// Format date as MM/DD/YY
const formatDateShort = (dateStr: string) => {
  const date = new Date(dateStr);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
};

// Format date with relative indicator: "MM/DD/YY (Xd left)"
const formatDateWithRelative = (dateStr: string) => {
  const shortDate = formatDateShort(dateStr);
  const relative = formatRelativeDate(dateStr);
  return { shortDate, relative };
};

// Format full date
const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: 'numeric'
  });
};

const ProjectList = ({
  projects,
  tasks,
  statusOptions,
  completedStatus,
  onSelectProject,
  onUpdateTask,
  onAddTask,
  onSelectTask,
  onOpenProjectWorkspace,
  selectedProjectId
}: Props) => {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [showCompleted, setShowCompleted] = useState(false);
  const [projectNotes, setProjectNotes] = useState<Record<string, string>>({});
  const [projectLinks, setProjectLinks] = useState<Record<string, string>>({});
  const [notesExpanded, setNotesExpanded] = useState<Set<string>>(new Set());
  const [selectedTaskForPopup, setSelectedTaskForPopup] = useState<string | null>(null);
  const [quickAddUrgent, setQuickAddUrgent] = useState<Record<string, boolean>>({});
  const [quickAddImportant, setQuickAddImportant] = useState<Record<string, boolean>>({});
  // Open tasks expanded by default, completed tasks hidden by default
  const [openTasksExpanded, setOpenTasksExpanded] = useState<Set<string>>(new Set(projects.map(p => p.id)));
  const [completedTasksExpanded, setCompletedTasksExpanded] = useState<Set<string>>(new Set());
  const [showCompletedTasks, setShowCompletedTasks] = useState<Set<string>>(new Set());

  // Calculate stats for each project
  const projectStats = useMemo(() => {
    const stats = new Map<string, ProjectStats>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekFromNow = new Date(today);
    weekFromNow.setDate(weekFromNow.getDate() + 7);

    projects.forEach(project => {
      const projectTasks = tasks.filter(t => (t.projectIds ?? []).includes(project.id));
      const completed = projectTasks.filter(t => t.normalizedStatus === 'complete');
      const inProgress = projectTasks.filter(t => t.normalizedStatus === 'in-progress');
      const todo = projectTasks.filter(t => t.normalizedStatus === 'not-started');
      const urgent = projectTasks.filter(t => t.urgent && t.normalizedStatus !== 'complete');
      const important = projectTasks.filter(t => t.important && t.normalizedStatus !== 'complete');
      
      // Get incomplete tasks sorted by due date
      const incompleteTasks = projectTasks
        .filter(t => t.normalizedStatus !== 'complete')
        .sort((a, b) => {
          // Tasks with due dates come first, sorted by date
          if (a.dueDate && b.dueDate) {
            return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
          }
          if (a.dueDate) return -1;
          if (b.dueDate) return 1;
          // Then urgent tasks
          if (a.urgent && !b.urgent) return -1;
          if (!a.urgent && b.urgent) return 1;
          return 0;
        });
      
      // Find overdue tasks
      const overdueTasks = incompleteTasks.filter(t => 
        t.dueDate && new Date(t.dueDate) < today
      );
      
      // Next action is the first incomplete task (prioritized by date/urgency)
      const nextAction = incompleteTasks[0] || null;
      
      // First overdue task
      const overdueTask = overdueTasks[0] || null;
      
      const dueThisWeek = incompleteTasks.filter(t => {
        if (!t.dueDate) return false;
        const d = new Date(t.dueDate);
        return d >= today && d <= weekFromNow;
      });

      const tasksRemaining = projectTasks.length - completed.length;

      stats.set(project.id, {
        total: projectTasks.length,
        completed: completed.length,
        inProgress: inProgress.length,
        todo: todo.length,
        urgent: urgent.length,
        important: important.length,
        overdue: overdueTasks.length,
        dueThisWeek: dueThisWeek.length,
        progress: projectTasks.length > 0 
          ? Math.round((completed.length / projectTasks.length) * 100)
          : 0,
        tasksRemaining,
        nextAction,
        overdueTask
      });
    });

    return stats;
  }, [projects, tasks]);

  const toggleExpanded = useCallback((projectId: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  const getProjectTasks = useCallback((projectId: string) => {
    return tasks
      .filter(t => (t.projectIds ?? []).includes(projectId))
      .filter(t => showCompleted || t.normalizedStatus !== 'complete');
  }, [tasks, showCompleted]);

  const handleQuickComplete = useCallback(async (taskId: string, currentStatus: string) => {
    if (!onUpdateTask || !completedStatus) return;
    const isComplete = currentStatus === completedStatus;
    await onUpdateTask(taskId, { 
      status: isComplete ? statusOptions[0]?.name : completedStatus 
    });
  }, [onUpdateTask, completedStatus, statusOptions]);

  const toggleNotesExpanded = useCallback((projectId: string) => {
    setNotesExpanded(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  // Single click = show edit popup inline
  const handleTaskClick = useCallback((taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedTaskForPopup(taskId);
  }, []);

  // Double click = pop out to separate window/panel
  const handleTaskDoubleClick = useCallback((taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectTask?.(taskId); // This triggers the pop-out view
  }, [onSelectTask]);

  const closeTaskPopup = useCallback(() => {
    setSelectedTaskForPopup(null);
  }, []);

  const toggleOpenTasks = useCallback((projectId: string) => {
    setOpenTasksExpanded(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const toggleCompletedTasks = useCallback((projectId: string) => {
    setCompletedTasksExpanded(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const toggleShowCompleted = useCallback((projectId: string) => {
    setShowCompletedTasks(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
        // Also collapse the completed section when hiding
        setCompletedTasksExpanded(prev2 => {
          const next2 = new Set(prev2);
          next2.delete(projectId);
          return next2;
        });
      } else {
        next.add(projectId);
        // Auto-expand completed section when showing
        setCompletedTasksExpanded(prev2 => {
          const next2 = new Set(prev2);
          next2.add(projectId);
          return next2;
        });
      }
      return next;
    });
  }, []);

  // Sort projects by various criteria
  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const statsA = projectStats.get(a.id);
      const statsB = projectStats.get(b.id);
      // Sort by urgent tasks first, then by overdue, then by progress
      if ((statsA?.urgent ?? 0) !== (statsB?.urgent ?? 0)) {
        return (statsB?.urgent ?? 0) - (statsA?.urgent ?? 0);
      }
      if ((statsA?.overdue ?? 0) !== (statsB?.overdue ?? 0)) {
        return (statsB?.overdue ?? 0) - (statsA?.overdue ?? 0);
      }
      return (statsA?.progress ?? 0) - (statsB?.progress ?? 0);
    });
  }, [projects, projectStats]);

  if (!projects.length) {
    return (
      <div className="project-list-empty">
        <span className="empty-icon">📁</span>
        <p>No projects found</p>
      </div>
    );
  }

  // Calculate days until project deadline
  const getDaysUntilDeadline = (endDate: string | null | undefined) => {
    if (!endDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadline = new Date(endDate);
    deadline.setHours(0, 0, 0, 0);
    return Math.round((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="project-list task-list">
      <div className="project-list-header">
        <span className="project-count">{projects.length} projects</span>
        <label className="show-completed-toggle">
          <input 
            type="checkbox" 
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
          />
          Show completed tasks
        </label>
      </div>
      
      <div className="project-list-items">
        {sortedProjects.map(project => {
          const stats = projectStats.get(project.id);
          const isExpanded = expandedProjects.has(project.id);
          const projectTasks = getProjectTasks(project.id);
          const daysUntilDeadline = getDaysUntilDeadline(project.endDate);
          const isOverdue = daysUntilDeadline !== null && daysUntilDeadline < 0;
          
          return (
            <div 
              key={project.id} 
              className={`project-list-item ${isExpanded ? 'is-expanded' : ''} ${selectedProjectId === project.id ? 'is-selected' : ''}`}
            >
              {/* Project Header - 2 Row Layout */}
              <div 
                className="project-header-two-row"
                onClick={() => toggleExpanded(project.id)}
              >
                {/* Row 1: Title and basic info */}
                <div className="project-row-1">
                  <div className="project-row-1-left">
                    <button 
                      type="button"
                      className="expand-toggle"
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? '▼' : '▶'}
                    </button>
                    
                    <span className="project-emoji">{project.emoji || '📁'}</span>
                    
                    <span className="project-title">{project.title || 'Untitled'}</span>
                    
                    {project.status && (
                      <span className="project-status-badge">{project.status}</span>
                    )}
                  </div>
                  
                  <div className="project-row-1-right">
                    {/* Open full workspace button */}
                    <button
                      type="button"
                      className="open-workspace-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenProjectWorkspace?.(project.id);
                      }}
                      title="Open full project workspace (Kanban, Calendar, Matrix)"
                    >
                      ↗
                    </button>
                  </div>
                </div>
                
                {/* Row 2: Progress, Actions, and Deadline */}
                <div className="project-row-2">
                  {/* Circular Progress */}
                  <div 
                    className={`project-progress-circle ${isOverdue ? 'overdue' : (stats?.progress ?? 0) === 100 ? 'complete' : ''}`}
                    title={`${stats?.completed ?? 0} of ${stats?.total ?? 0} tasks complete`}
                  >
                    <svg width="36" height="36" viewBox="0 0 36 36">
                      <circle
                        cx="18"
                        cy="18"
                        r="14"
                        fill="none"
                        stroke="rgba(255, 255, 255, 0.1)"
                        strokeWidth="3"
                      />
                      <circle
                        cx="18"
                        cy="18"
                        r="14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeDasharray={`${(stats?.progress ?? 0) * 0.88} 88`}
                        strokeLinecap="round"
                        transform="rotate(-90 18 18)"
                      />
                    </svg>
                    <span className="progress-text">{stats?.progress ?? 0}%</span>
                  </div>
                  
                  {/* Task counts */}
                  <div className="project-task-counts">
                    <span className="task-count-done">{stats?.completed ?? 0} of {stats?.total ?? 0}</span>
                    <span className="task-count-left">{stats?.tasksRemaining ?? 0} left</span>
                  </div>
                  
                  {/* Next Action / Overdue Info - Clickable */}
                  <div className="project-actions-info">
                    {stats?.overdueTask && (
                      <button
                        type="button"
                        className="overdue-action clickable"
                        title={`Click: edit task | Double-click: pop-out view`}
                        onClick={(e) => handleTaskClick(stats.overdueTask!.id, e)}
                        onDoubleClick={(e) => handleTaskDoubleClick(stats.overdueTask!.id, e)}
                      >
                        <span className="action-label overdue">⚠️ Overdue:</span>
                        {stats.overdueTask.dueDate && (
                          <span className="action-date-inline overdue">
                            {formatRelativeDate(stats.overdueTask.dueDate)}
                          </span>
                        )}
                        <span className="action-task">{stats.overdueTask.title}</span>
                      </button>
                    )}
                    
                    {stats?.nextAction && (!stats.overdueTask || stats.nextAction.id !== stats.overdueTask.id) && (
                      <button
                        type="button"
                        className="next-action clickable"
                        title={`Click: edit task | Double-click: pop-out view`}
                        onClick={(e) => handleTaskClick(stats.nextAction!.id, e)}
                        onDoubleClick={(e) => handleTaskDoubleClick(stats.nextAction!.id, e)}
                      >
                        <span className="action-label">Next:</span>
                        {stats.nextAction.dueDate && (
                          <span className="action-date-inline">
                            {formatRelativeDate(stats.nextAction.dueDate)}
                          </span>
                        )}
                        <span className="action-task">{stats.nextAction.title}</span>
                      </button>
                    )}
                    
                    {!stats?.nextAction && !stats?.overdueTask && (
                      <div className="no-action">
                        <span className="action-label muted">No tasks</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Project Deadline */}
                  <div className="project-deadline-section">
                    {project.endDate ? (
                      <div 
                        className={`project-deadline-info ${isOverdue ? 'overdue' : ''}`}
                        title={`Project deadline: ${formatDate(project.endDate)}`}
                      >
                        <span className="deadline-date">{formatDate(project.endDate)}</span>
                        <span className={`deadline-days ${isOverdue ? 'overdue' : daysUntilDeadline !== null && daysUntilDeadline <= 14 ? 'soon' : ''}`}>
                          {daysUntilDeadline !== null && (
                            isOverdue 
                              ? `${Math.abs(daysUntilDeadline)}d overdue`
                              : `${daysUntilDeadline}d left`
                          )}
                        </span>
                      </div>
                    ) : (
                      <div className="project-deadline-info no-deadline">
                        <span className="deadline-date muted">No deadline</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Expanded Content */}
              {isExpanded && (
                <div className="project-expanded-content">
                  {/* Collapsible Notes & Links Section */}
                  <div className="project-notes-links-section">
                    <button
                      type="button"
                      className="notes-toggle-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleNotesExpanded(project.id);
                      }}
                    >
                      <span className="toggle-icon">{notesExpanded.has(project.id) ? '▾' : '▸'}</span>
                      <span className="toggle-label">📝 Notes & Links</span>
                    </button>
                    
                    {notesExpanded.has(project.id) && (
                      <div className="notes-links-content">
                        <div className="notes-area">
                          <label className="section-label">Notes</label>
                          <textarea
                            className="project-notes-input"
                            placeholder="Write notes about this project..."
                            value={projectNotes[project.id] || ''}
                            onChange={(e) => setProjectNotes(prev => ({
                              ...prev,
                              [project.id]: e.target.value
                            }))}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className="links-area">
                          <label className="section-label">Links & Resources</label>
                          <textarea
                            className="project-links-input"
                            placeholder="Paste links here (one per line)..."
                            value={projectLinks[project.id] || ''}
                            onChange={(e) => setProjectLinks(prev => ({
                              ...prev,
                              [project.id]: e.target.value
                            }))}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Task List - Grouped by Status */}
                  <div className="project-tasks-section">
                    {(() => {
                      // Sort tasks: date first, then hard deadline, then Eisenhower priority
                      const sortTasks = (taskList: Task[]) => {
                        return [...taskList].sort((a, b) => {
                          // 1. Tasks with dates first, sorted by date
                          const dateA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
                          const dateB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
                          if (dateA !== dateB) return dateA - dateB;
                          
                          // 2. Hard deadlines before soft
                          const hardA = a.hardDeadline ? 0 : 1;
                          const hardB = b.hardDeadline ? 0 : 1;
                          if (hardA !== hardB) return hardA - hardB;
                          
                          // 3. Eisenhower priority: Do Now > Delegate > Deep Work > Trash
                          const getPriority = (t: Task) => {
                            if (t.urgent && t.important) return 0; // Do Now
                            if (t.urgent) return 1; // Delegate
                            if (t.important) return 2; // Deep Work
                            return 3; // Trash
                          };
                          return getPriority(a) - getPriority(b);
                        });
                      };
                      
                      const openTasks = sortTasks(projectTasks.filter(t => t.normalizedStatus !== 'complete'));
                      const completedTasks = projectTasks.filter(t => t.normalizedStatus === 'complete');
                      const isOpenExpanded = openTasksExpanded.has(project.id);
                      const isCompletedExpanded = completedTasksExpanded.has(project.id);
                      const isShowingCompleted = showCompletedTasks.has(project.id);
                      
                      // Empty state
                      if (projectTasks.length === 0) {
                        return (
                          <>
                            <div className="tasks-section-header">
                              <span className="tasks-count">No tasks</span>
                              <button
                                type="button"
                                className="open-full-view-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenProjectWorkspace?.(project.id);
                                }}
                              >
                                Open Full View →
                              </button>
                            </div>
                            <div className="no-tasks">No tasks in this project</div>
                          </>
                        );
                      }
                      
                      const renderTaskRow = (task: Task, isComplete: boolean) => {
                        const isOverdueTask = task.dueDate && new Date(task.dueDate) < new Date();
                        const dateInfo = task.dueDate ? formatDateWithRelative(task.dueDate) : null;
                        
                        return (
                          <div 
                            key={task.id}
                            className={`project-task-row ${isComplete ? 'is-complete' : ''} ${task.id === stats?.nextAction?.id ? 'is-next-action' : ''} ${selectedTaskForPopup === task.id ? 'is-popup-open' : ''}`}
                            onClick={(e) => handleTaskClick(task.id, e)}
                            onDoubleClick={(e) => handleTaskDoubleClick(task.id, e)}
                          >
                            <button
                              type="button"
                              className={`task-checkbox ${isComplete ? 'checked' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleQuickComplete(task.id, task.status ?? '');
                              }}
                              title={isComplete ? 'Mark incomplete' : 'Mark complete'}
                            >
                              {isComplete ? <span className="checkbox-check">✓</span> : <span className="checkbox-circle" />}
                            </button>
                            
                            {/* Date info next to checkbox */}
                            {dateInfo && (
                              <span className={`task-date-inline ${isOverdueTask && !isComplete ? 'overdue' : ''} ${isComplete ? 'completed' : ''}`}>
                                <span className="date-short">{dateInfo.shortDate}</span>
                                <span className="date-relative">({dateInfo.relative})</span>
                              </span>
                            )}
                            
                            {/* Hard/Soft deadline indicator */}
                            {task.dueDate && (
                              <span 
                                className={`deadline-type ${task.hardDeadline ? 'hard' : 'soft'}`}
                                title={task.hardDeadline ? 'Hard deadline' : 'Soft deadline'}
                              >
                                {task.hardDeadline ? '🔴' : '🔵'}
                              </span>
                            )}
                            
                            <span className={`task-title ${isComplete ? 'completed' : ''}`}>
                              {task.title}
                            </span>
                            
                            <div className="task-meta">
                              {task.id === stats?.nextAction?.id && !isComplete && (
                                <span className="next-action-badge">NEXT</span>
                              )}
                              
                              {/* Priority as checkmarks instead of badges */}
                              {!isComplete && (
                                <div className="priority-checks">
                                  <span 
                                    className={`priority-check urgent ${task.urgent ? 'active' : ''}`}
                                    title={task.urgent ? 'Urgent' : 'Not urgent'}
                                  >
                                    ⚡
                                  </span>
                                  <span 
                                    className={`priority-check important ${task.important ? 'active' : ''}`}
                                    title={task.important ? 'Important' : 'Not important'}
                                  >
                                    ★
                                  </span>
                                </div>
                              )}
                            </div>
                            
                            {/* Task Edit Popup */}
                            {selectedTaskForPopup === task.id && (
                              <TaskEditPopup
                                task={task}
                                onClose={closeTaskPopup}
                                onUpdateTask={onUpdateTask}
                                completedStatus={completedStatus}
                              />
                            )}
                          </div>
                        );
                      };
                      
                      return (
                        <>
                          <div className="tasks-section-header">
                            <span className="tasks-count">
                              {openTasks.length} open{completedTasks.length > 0 && ` • ${completedTasks.length} done`}
                            </span>
                            <div className="tasks-section-actions">
                              {completedTasks.length > 0 && (
                                <button
                                  type="button"
                                  className={`show-completed-toggle ${isShowingCompleted ? 'active' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleShowCompleted(project.id);
                                  }}
                                  title={isShowingCompleted ? 'Hide completed' : 'Show completed'}
                                >
                                  <span className="toggle-check">✓</span>
                                  <span className="toggle-label">{isShowingCompleted ? 'Hide Done' : 'Show Done'}</span>
                                </button>
                              )}
                              <button
                                type="button"
                                className="open-full-view-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenProjectWorkspace?.(project.id);
                                }}
                              >
                                Open Full View →
                              </button>
                            </div>
                          </div>
                          
                          <div className="project-tasks-grouped">
                            {/* Open Tasks - Collapsible */}
                          {openTasks.length > 0 && (
                            <div className="task-group open-tasks">
                              <button
                                type="button"
                                className="task-group-header collapsible"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleOpenTasks(project.id);
                                }}
                              >
                                <span className="toggle-icon">{isOpenExpanded ? '▾' : '▸'}</span>
                                <span className="group-label">Open ({openTasks.length})</span>
                              </button>
                              {isOpenExpanded && (
                                <div className="project-tasks-list">
                                  {openTasks.map(task => renderTaskRow(task, false))}
                                </div>
                              )}
                            </div>
                          )}
                          
                          {/* Completed Tasks - Only show when toggle is on */}
                          {isShowingCompleted && completedTasks.length > 0 && (
                            <div className="task-group completed-tasks">
                              <button
                                type="button"
                                className="task-group-header collapsible"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleCompletedTasks(project.id);
                                }}
                              >
                                <span className="toggle-icon">{isCompletedExpanded ? '▾' : '▸'}</span>
                                <span className="group-label completed">✓ Completed ({completedTasks.length})</span>
                              </button>
                              {isCompletedExpanded && (
                                <div className="project-tasks-list">
                                  {completedTasks.map(task => renderTaskRow(task, true))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    );
                    })()}
                    
                    {/* Quick Add for this project with priority options */}
                    <div className="project-quick-add enhanced">
                      <div className="quick-add-row">
                        <input
                          type="text"
                          id={`quick-add-${project.id}`}
                          placeholder="+ Add task to this project..."
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                              e.stopPropagation();
                              const dateInput = document.getElementById(`quick-add-date-${project.id}`) as HTMLInputElement;
                              await onAddTask?.({
                                title: e.currentTarget.value.trim(),
                                projectIds: [project.id],
                                date: dateInput?.value || undefined,
                                urgent: quickAddUrgent[project.id] ?? false,
                                important: quickAddImportant[project.id] ?? false
                              });
                              e.currentTarget.value = '';
                              if (dateInput) dateInput.value = '';
                              // Reset priority after adding
                              setQuickAddUrgent(prev => ({ ...prev, [project.id]: false }));
                              setQuickAddImportant(prev => ({ ...prev, [project.id]: false }));
                            }
                          }}
                        />
                        <input
                          type="date"
                          id={`quick-add-date-${project.id}`}
                          className="quick-add-date-input"
                          onClick={(e) => e.stopPropagation()}
                          title="Due date"
                        />
                        <div className="quick-add-priority-buttons">
                          <button
                            type="button"
                            className={`priority-toggle urgent ${quickAddUrgent[project.id] ? 'active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setQuickAddUrgent(prev => ({ ...prev, [project.id]: !prev[project.id] }));
                            }}
                            title="Urgent"
                          >
                            ⚡
                          </button>
                          <button
                            type="button"
                            className={`priority-toggle important ${quickAddImportant[project.id] ? 'active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setQuickAddImportant(prev => ({ ...prev, [project.id]: !prev[project.id] }));
                            }}
                            title="Important"
                          >
                            ★
                          </button>
                        </div>
                        <button
                          type="button"
                          className="quick-add-submit-btn"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const textInput = document.getElementById(`quick-add-${project.id}`) as HTMLInputElement;
                            const dateInput = document.getElementById(`quick-add-date-${project.id}`) as HTMLInputElement;
                            if (textInput?.value.trim()) {
                              await onAddTask?.({
                                title: textInput.value.trim(),
                                projectIds: [project.id],
                                date: dateInput?.value || undefined,
                                urgent: quickAddUrgent[project.id] ?? false,
                                important: quickAddImportant[project.id] ?? false
                              });
                              textInput.value = '';
                              if (dateInput) dateInput.value = '';
                              setQuickAddUrgent(prev => ({ ...prev, [project.id]: false }));
                              setQuickAddImportant(prev => ({ ...prev, [project.id]: false }));
                            }
                          }}
                          title="Add task (or press Enter)"
                        >
                          Add
                        </button>
                      </div>
                      {(quickAddUrgent[project.id] || quickAddImportant[project.id]) && (
                        <div className="quick-add-priority-indicator">
                          {quickAddUrgent[project.id] && quickAddImportant[project.id] && (
                            <span className="priority-badge do-now">Do Now</span>
                          )}
                          {quickAddUrgent[project.id] && !quickAddImportant[project.id] && (
                            <span className="priority-badge delegate">Delegate</span>
                          )}
                          {!quickAddUrgent[project.id] && quickAddImportant[project.id] && (
                            <span className="priority-badge deep-work">Deep Work</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Task Edit Popup Component
interface TaskEditPopupProps {
  task: Task;
  onClose: () => void;
  onUpdateTask?: (taskId: string, updates: TaskUpdatePayload) => Promise<void>;
  completedStatus?: string;
}

const TaskEditPopup = ({ task, onClose, onUpdateTask, completedStatus }: TaskEditPopupProps) => {
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate ? task.dueDate.slice(0, 10) : '');
  const [urgent, setUrgent] = useState(task.urgent ?? false);
  const [important, setImportant] = useState(task.important ?? false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const hasChanges = useMemo(() => {
    const originalDate = task.dueDate ? task.dueDate.slice(0, 10) : '';
    return (
      title !== task.title ||
      dueDate !== originalDate ||
      urgent !== (task.urgent ?? false) ||
      important !== (task.important ?? false)
    );
  }, [title, dueDate, urgent, important, task]);

  const handleSave = async () => {
    if (!onUpdateTask || !hasChanges) return;
    
    const updates: TaskUpdatePayload = {};
    if (title !== task.title) updates.title = title;
    if (dueDate !== (task.dueDate ? task.dueDate.slice(0, 10) : '')) {
      updates.dueDate = dueDate ? `${dueDate}T00:00:00` : null;
    }
    if (urgent !== (task.urgent ?? false)) updates.urgent = urgent;
    if (important !== (task.important ?? false)) updates.important = important;
    
    if (Object.keys(updates).length === 0) return;
    
    try {
      setSaving(true);
      await onUpdateTask(task.id, updates);
      setFeedback('Saved!');
      setTimeout(onClose, 500);
    } catch (err) {
      setFeedback('Error saving');
    } finally {
      setSaving(false);
    }
  };

  const getPriorityLabel = () => {
    if (urgent && important) return { label: 'Do Now', class: 'do-now' };
    if (urgent) return { label: 'Delegate', class: 'delegate' };
    if (important) return { label: 'Deep Work', class: 'deep-work' };
    return { label: 'Trash', class: 'trash' };
  };

  const priority = getPriorityLabel();

  return (
    <div className="task-edit-popup" onClick={(e) => e.stopPropagation()}>
      <div className="popup-header">
        <span className="popup-title">Edit Task</span>
        <button type="button" className="popup-close" onClick={onClose}>×</button>
      </div>
      
      <div className="popup-body">
        <div className="popup-field">
          <label>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="popup-input"
          />
        </div>
        
        <div className="popup-field">
          <label>Due Date</label>
          <div className="date-input-row">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="popup-input"
            />
            {dueDate && (
              <button type="button" className="clear-date" onClick={() => setDueDate('')}>
                Clear
              </button>
            )}
          </div>
        </div>
        
        <div className="popup-field">
          <label>Priority</label>
          <div className="priority-toggles">
            <button
              type="button"
              className={`priority-btn urgent ${urgent ? 'active' : ''}`}
              onClick={() => setUrgent(!urgent)}
            >
              ⚡ Urgent
            </button>
            <button
              type="button"
              className={`priority-btn important ${important ? 'active' : ''}`}
              onClick={() => setImportant(!important)}
            >
              ★ Important
            </button>
          </div>
          <div className="priority-result">
            <span className={`priority-badge ${priority.class}`}>{priority.label}</span>
          </div>
        </div>
        
        {feedback && (
          <div className={`popup-feedback ${feedback === 'Saved!' ? 'success' : 'error'}`}>
            {feedback}
          </div>
        )}
      </div>
      
      <div className="popup-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="primary"
          onClick={handleSave}
          disabled={!hasChanges || saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
};

export default ProjectList;

