import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FC, MouseEvent as ReactMouseEvent } from 'react';
import type { Descendant } from 'slate';
import type {
  Project,
  ProjectsSettings,
  Task,
  TaskUpdatePayload,
  WritingEntryPayload
} from '@shared/types';
import { widgetBridge } from '@shared/platform';
import { getMatrixCategory } from '../utils/projectInsights';
import {
  getMatrixClass,
  findMatrixOptionFromFlags,
  matrixOptions,
  type MatrixOptionId
} from '../constants/matrix';
import RichBodyEditor, {
  createInitialBodyValue,
  valueToMarkdownBlocks,
  valueToPlainText
} from './RichBodyEditor';
import SearchInput from './SearchInput';

export interface ProjectsWidgetProps {
  settings: ProjectsSettings | null;
  tasks: Task[];
  completedStatus?: string;
  onProjectCountChange?: (count: number) => void;
  onCreateWritingEntry?: (payload: WritingEntryPayload) => Promise<void>;
  statusOptions?: Array<{ id: string; name: string }>;
  onUpdateTask?: (taskId: string, updates: TaskUpdatePayload) => Promise<void>;
}

// Widget only uses list view (board/gantt are in fullscreen)
type ProjectSortOption = 'deadline' | 'progress' | 'tasks' | 'name';
type ProjectFilterOption = 'all' | 'active' | 'overdue' | 'completed';

const widgetAPI = widgetBridge;

const SORT_STORAGE_KEY = 'widget.projects.sort';
const FILTER_STORAGE_KEY = 'widget.projects.filter';
const SEARCH_STORAGE_KEY = 'widget.projects.search';

// Matrix category labels and colors
const MATRIX_LABELS: Record<string, { label: string; class: string }> = {
  'do-now': { label: 'Do Now', class: 'do-now' },
  'deep-work': { label: 'Deep Work', class: 'deep-work' },
  'delegate': { label: 'Delegate', class: 'delegate' },
  'trash': { label: 'Trash', class: 'trash' }
};

const ProjectsWidget: FC<ProjectsWidgetProps> = ({
  settings,
  tasks,
  completedStatus,
  onProjectCountChange,
  onCreateWritingEntry,
  statusOptions = [],
  onUpdateTask
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [expandedTasksProjectId, setExpandedTasksProjectId] = useState<string | null>(null);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [notesProjectId, setNotesProjectId] = useState<string | null>(null);
  const [editDatesProjectId, setEditDatesProjectId] = useState<string | null>(null);
  
  // Sort state
  const [sortBy, setSortBy] = useState<ProjectSortOption>(() => {
    if (typeof window === 'undefined') return 'deadline';
    const stored = window.localStorage?.getItem(SORT_STORAGE_KEY);
    if (stored === 'deadline' || stored === 'progress' || stored === 'tasks' || stored === 'name') {
      return stored;
    }
    return 'deadline';
  });
  
  // Filter state
  const [filterBy, setFilterBy] = useState<ProjectFilterOption>(() => {
    if (typeof window === 'undefined') return 'all';
    const stored = window.localStorage?.getItem(FILTER_STORAGE_KEY);
    if (stored === 'all' || stored === 'active' || stored === 'overdue' || stored === 'completed') {
      return stored;
    }
    return 'all';
  });

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage?.getItem(SEARCH_STORAGE_KEY) ?? '';
  });

  // Persist sort option
  useEffect(() => {
    window.localStorage?.setItem(SORT_STORAGE_KEY, sortBy);
  }, [sortBy]);
  
  useEffect(() => {
    window.localStorage?.setItem(FILTER_STORAGE_KEY, filterBy);
  }, [filterBy]);

  // Persist search query
  useEffect(() => {
    window.localStorage?.setItem(SEARCH_STORAGE_KEY, searchQuery);
  }, [searchQuery]);

  const loadProjectsFromCache = useCallback(async () => {
    if (!settings?.databaseId) {
      setProjects([]);
      setLoading(false);
      setError(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const cached = await widgetAPI.getProjects();
      setProjects(cached);
    } catch (err) {
      console.error('Failed to load cached projects:', err);
      setError(
        err instanceof Error ? err.message : 'Unable to load projects'
      );
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    loadProjectsFromCache();
  }, [loadProjectsFromCache]);

  useEffect(() => {
    const unsubscribe = widgetAPI.onProjectsUpdated((updatedProjects) => {
      setProjects(updatedProjects);
      setLoading(false);
      setError(null);
    });
    return unsubscribe;
  }, []);

  // Build project insights
  const projectInsights = useMemo(() => {
    const tasksByProject = new Map<string, Task[]>();
    
    tasks.forEach((task) => {
      const projectIds = task.projectIds ?? [];
      projectIds.forEach((projectId) => {
        const bucket = tasksByProject.get(projectId) ?? [];
        bucket.push(task);
        tasksByProject.set(projectId, bucket);
      });
    });

    return projects.map((project) => {
      const projectTasks = tasksByProject.get(project.id) ?? [];
      const openTasks = projectTasks.filter(
        (t) => t.status !== completedStatus
      );
      const completedTasks = projectTasks.filter(
        (t) => t.status === completedStatus
      );
      
      // Count by matrix category
      const doNow = openTasks.filter((t) => getMatrixCategory(t) === 'do-now').length;
      const deepWork = openTasks.filter((t) => getMatrixCategory(t) === 'deep-work').length;
      const delegate = openTasks.filter((t) => getMatrixCategory(t) === 'delegate').length;
      
      // Next action (prioritize do-now, then by due date)
      const sortedOpen = [...openTasks].sort((a, b) => {
        const matrixOrder = ['do-now', 'delegate', 'deep-work', 'trash'];
        const rankA = matrixOrder.indexOf(getMatrixCategory(a));
        const rankB = matrixOrder.indexOf(getMatrixCategory(b));
        if (rankA !== rankB) return rankA - rankB;
        const dueA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const dueB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return dueA - dueB;
      });
      
      // Timeline calculations
      const startDate = project.startDate ? new Date(project.startDate) : null;
      const endDate = project.endDate ? new Date(project.endDate) : null;
      const now = new Date();
      
      let timelineStatus: 'upcoming' | 'active' | 'overdue' | 'completed' | 'no-dates' = 'no-dates';
      let daysRemaining: number | null = null;
      
      if (startDate && endDate) {
        if (now < startDate) {
          timelineStatus = 'upcoming';
          daysRemaining = Math.ceil((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        } else if (now > endDate) {
          timelineStatus = openTasks.length > 0 ? 'overdue' : 'completed';
          daysRemaining = -Math.floor((now.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
        } else {
          timelineStatus = 'active';
          daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        }
      } else if (endDate) {
        if (now > endDate) {
          timelineStatus = openTasks.length > 0 ? 'overdue' : 'completed';
          daysRemaining = -Math.floor((now.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
        } else {
          timelineStatus = 'active';
          daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        }
      }

      let timelineVisualStatus: ProjectInsight['timelineVisualStatus'] = timelineStatus;
      if (timelineStatus === 'active' && daysRemaining !== null && daysRemaining <= 3) {
        timelineVisualStatus = 'due-soon';
      }

      return {
        project,
        tasks: projectTasks,
        openTasks,
        completedTasks,
        doNow,
        deepWork,
        delegate,
        nextAction: sortedOpen[0] ?? null,
        progress: projectTasks.length
          ? completedTasks.length / projectTasks.length
          : 0,
        timelineStatus,
        timelineVisualStatus,
        daysRemaining,
        startDate,
        endDate
      };
    });
  }, [projects, tasks, completedStatus]);

  // Filter projects
  const filteredProjects = useMemo(() => {
    const searchLower = searchQuery.toLowerCase().trim();
    
    return projectInsights.filter((p) => {
      // Apply status filter first
      let passesFilter = true;
      switch (filterBy) {
        case 'active':
          passesFilter = p.openTasks.length > 0 && p.timelineStatus !== 'overdue';
          break;
        case 'overdue':
          passesFilter = p.timelineStatus === 'overdue';
          break;
        case 'completed':
          passesFilter = p.openTasks.length === 0;
          break;
        default:
          passesFilter = true;
      }
      
      if (!passesFilter) return false;
      
      // Apply search filter
      if (searchLower) {
        const titleMatch = p.project.title?.toLowerCase().includes(searchLower);
        const descMatch = p.project.description?.toLowerCase().includes(searchLower);
        const tagMatch = p.project.tags?.some(tag => tag.toLowerCase().includes(searchLower));
        const statusMatch = p.project.status?.toLowerCase().includes(searchLower);
        // Also search in task titles within this project
        const taskMatch = p.tasks.some(task => task.title.toLowerCase().includes(searchLower));
        
        if (!titleMatch && !descMatch && !tagMatch && !statusMatch && !taskMatch) {
          return false;
        }
      }
      
      return true;
    });
  }, [projectInsights, filterBy, searchQuery]);

  // Sort projects
  const sortedProjects = useMemo(() => {
    return [...filteredProjects].sort((a, b) => {
      switch (sortBy) {
        case 'deadline': {
          const aEnd = a.endDate?.getTime() ?? Infinity;
          const bEnd = b.endDate?.getTime() ?? Infinity;
          if (aEnd !== bEnd) return aEnd - bEnd;
          return (a.project.title ?? '').localeCompare(b.project.title ?? '');
        }
        case 'progress': {
          if (a.progress !== b.progress) return b.progress - a.progress;
          return (a.project.title ?? '').localeCompare(b.project.title ?? '');
        }
        case 'tasks': {
          if (a.openTasks.length !== b.openTasks.length) {
            return b.openTasks.length - a.openTasks.length;
          }
          return (a.project.title ?? '').localeCompare(b.project.title ?? '');
        }
        case 'name':
        default:
          return (a.project.title ?? '').localeCompare(b.project.title ?? '');
      }
    });
  }, [filteredProjects, sortBy]);

  // Report project count to parent
  useEffect(() => {
    onProjectCountChange?.(filteredProjects.length);
  }, [filteredProjects.length, onProjectCountChange]);

  // Handle task double-click to show popup
  const handleTaskDoubleClick = useCallback((task: Task) => {
    setSelectedTaskId(selectedTaskId === task.id ? null : task.id);
  }, [selectedTaskId]);

  // Handle task completion toggle
  const handleToggleTaskComplete = useCallback(async (task: Task) => {
    if (!onUpdateTask || !completedStatus) return;
    const isComplete = task.status === completedStatus;
    await onUpdateTask(task.id, {
      status: isComplete ? null : completedStatus
    });
  }, [onUpdateTask, completedStatus]);

  if (!settings?.databaseId) {
    return (
      <section className="projects-widget-v2">
        <div className="projects-empty-state">
          <div className="empty-icon">📁</div>
          <h3>Projects not configured</h3>
          <p>Add your Projects database ID in settings to start tracking.</p>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="projects-widget-v2">
        <div className="projects-empty-state">
          <div className="loading-spinner" />
          <p>Loading projects...</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="projects-widget-v2">
        <div className="projects-empty-state error">
          <div className="empty-icon">⚠️</div>
          <p>{error}</p>
          <button
            type="button"
            className="retry-button"
            onClick={loadProjectsFromCache}
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  const renderToolbar = () => (
    <div className="projects-toolbar">
      <div className="projects-toolbar-left">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search projects..."
        />
        
        <select
          className="projects-filter-select"
          value={filterBy}
          onChange={(e) => setFilterBy(e.target.value as ProjectFilterOption)}
        >
          <option value="all">All Projects</option>
          <option value="active">Active</option>
          <option value="overdue">Overdue</option>
          <option value="completed">Completed</option>
        </select>
        
        <select
          className="projects-sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as ProjectSortOption)}
        >
          <option value="deadline">Sort: Deadline</option>
          <option value="progress">Sort: Progress</option>
          <option value="tasks">Sort: Task Count</option>
          <option value="name">Sort: Name</option>
        </select>
      </div>
      
      <div className="projects-toolbar-right">
        <button
          type="button"
          className="projects-refresh-btn"
          onClick={loadProjectsFromCache}
          title="Refresh projects"
        >
          ↻
        </button>
      </div>
    </div>
  );

  const renderListView = () => (
    <div className="projects-list-v2">
      {sortedProjects.map((insight) => (
        <ProjectCard
          key={insight.project.id}
          insight={insight}
          isExpanded={expandedProjectId === insight.project.id}
          onToggleExpand={() => setExpandedProjectId(
            expandedProjectId === insight.project.id ? null : insight.project.id
          )}
          showTasks={expandedTasksProjectId === insight.project.id}
          onToggleTasks={() => setExpandedTasksProjectId(
            expandedTasksProjectId === insight.project.id ? null : insight.project.id
          )}
          hoveredTaskId={hoveredTaskId}
          onHoverTask={setHoveredTaskId}
          selectedTaskId={selectedTaskId}
          onTaskDoubleClick={handleTaskDoubleClick}
          onToggleTaskComplete={handleToggleTaskComplete}
          completedStatus={completedStatus}
          showNotes={notesProjectId === insight.project.id}
          onToggleNotes={() => setNotesProjectId(
            notesProjectId === insight.project.id ? null : insight.project.id
          )}
          onCreateWritingEntry={onCreateWritingEntry}
          statusOptions={statusOptions}
          onUpdateTask={onUpdateTask}
          showDateEditor={editDatesProjectId === insight.project.id}
          onToggleDateEditor={() => setEditDatesProjectId(
            editDatesProjectId === insight.project.id ? null : insight.project.id
          )}
        />
      ))}
    </div>
  );

  return (
    <section className="projects-widget-v2">
      <header className="projects-header-v2">
        <div className="projects-header-left">
          <span className="projects-count">
            {sortedProjects.length} project{sortedProjects.length !== 1 ? 's' : ''}
            {filterBy !== 'all' && ` (${filterBy})`}
          </span>
        </div>
      </header>

      {renderToolbar()}

      <div className="projects-scroll-area">
        {sortedProjects.length === 0 ? (
          <div className="projects-empty-state compact">
            <p>{searchQuery.trim() 
              ? 'No projects match your search.' 
              : 'No projects match your filters.'}</p>
          </div>
        ) : (
          renderListView()
        )}
      </div>
    </section>
  );
};

// Project Card Component for List View
interface ProjectInsight {
  project: Project;
  tasks: Task[];
  openTasks: Task[];
  completedTasks: Task[];
  doNow: number;
  deepWork: number;
  delegate: number;
  nextAction: Task | null;
  progress: number;
  timelineStatus: 'upcoming' | 'active' | 'overdue' | 'completed' | 'no-dates';
  timelineVisualStatus: 'upcoming' | 'active' | 'due-soon' | 'overdue' | 'completed' | 'no-dates';
  daysRemaining: number | null;
  startDate: Date | null;
  endDate: Date | null;
}

interface ProjectCardProps {
  insight: ProjectInsight;
  isExpanded: boolean;
  onToggleExpand: () => void;
  showTasks: boolean;
  onToggleTasks: () => void;
  hoveredTaskId: string | null;
  onHoverTask: (taskId: string | null) => void;
  selectedTaskId: string | null;
  onTaskDoubleClick: (task: Task) => void;
  onToggleTaskComplete: (task: Task) => void;
  completedStatus?: string;
  showNotes: boolean;
  onToggleNotes: () => void;
  onCreateWritingEntry?: (payload: WritingEntryPayload) => Promise<void>;
  statusOptions: Array<{ id: string; name: string }>;
  onUpdateTask?: (taskId: string, updates: TaskUpdatePayload) => Promise<void>;
  showDateEditor: boolean;
  onToggleDateEditor: () => void;
}

const ProjectCard: FC<ProjectCardProps> = ({
  insight,
  isExpanded,
  onToggleExpand,
  showTasks,
  onToggleTasks,
  hoveredTaskId,
  onHoverTask,
  selectedTaskId,
  onTaskDoubleClick,
  onToggleTaskComplete,
  completedStatus,
  showNotes,
  onToggleNotes,
  onCreateWritingEntry,
  statusOptions,
  onUpdateTask,
  showDateEditor,
  onToggleDateEditor
}) => {
  const {
    project,
    openTasks,
    completedTasks,
    doNow,
    deepWork,
    delegate,
    nextAction,
    progress,
    timelineStatus,
    timelineVisualStatus,
    daysRemaining,
    startDate,
    endDate
  } = insight;
  
  const hasOpenTasks = openTasks.length > 0;
  const totalTasks = openTasks.length + completedTasks.length;
  const hasAnyTasks = totalTasks > 0;
  const progressPct = Math.round(progress * 100);
  const visualStatus = timelineVisualStatus;
  const shouldShowCheckIcon =
    !hasOpenTasks ||
    timelineStatus === 'completed' ||
    (daysRemaining !== null && daysRemaining <= 0 && timelineStatus !== 'overdue');

  let timelineIcon = '⏳';
  if (!hasAnyTasks) {
    timelineIcon = '…';
  }
  if (visualStatus === 'due-soon') {
    timelineIcon = '⚠';
  }
  if (timelineStatus === 'overdue') {
    timelineIcon = '!';
  }
  if (shouldShowCheckIcon) {
    timelineIcon = '✓';
  }

  const now = new Date();
  const timelineSummary = (() => {
    if (timelineStatus === 'overdue' && daysRemaining !== null) {
      return `${Math.abs(daysRemaining)}d late`;
    }
    if ((timelineStatus === 'active' || visualStatus === 'due-soon') && daysRemaining !== null) {
      if (daysRemaining === 0) return 'Due today';
      if (daysRemaining === 1) return 'Due tomorrow';
      return `${daysRemaining}d left`;
    }
    if (timelineStatus === 'upcoming' && daysRemaining !== null) {
      return `Starts in ${daysRemaining}d`;
    }
    if (timelineStatus === 'completed' || (!hasOpenTasks && hasAnyTasks)) {
      return 'All tasks complete';
    }
    if (!hasAnyTasks) {
      return 'No linked tasks';
    }
    if (!startDate && !endDate) {
      return 'No schedule';
    }
    return 'On track';
  })();
  const showTimelineIndicator = Boolean(startDate || endDate || timelineSummary);

  const timelineFillPercent = (() => {
    if (startDate && endDate) {
      return Math.min(
        100,
        Math.max(0, getTimelineProgress(startDate, endDate, now))
      );
    }
    if (!startDate && endDate) {
      return timelineStatus === 'overdue' || timelineStatus === 'completed' ? 100 : 0;
    }
    return 0;
  })();
  const timelineFillColor = getTimelineColor(timelineFillPercent / 100);
  const timelineArrowPercent =
    startDate && endDate ? Math.min(100, getTimelineProgress(startDate, endDate, now)) : 0;
  const timelineArrowGradient = getTimelineGradient(timelineArrowPercent / 100);

  return (
    <article
      className={`project-card-v2 ${isExpanded ? 'is-expanded' : ''} ${!hasOpenTasks ? 'is-complete' : ''} timeline-${visualStatus}`}
    >
      <button
        type="button"
        className="project-card-header"
        onClick={onToggleExpand}
      >
        {/* Row 1: Title, status, and expand chevron */}
        <div className="project-main-info">
          <div className="project-title-section">
            <h3 className="project-title-v2">
              {project.title ?? 'Untitled Project'}
            </h3>
            {project.status && (
              <span className="project-status-badge">{project.status}</span>
            )}
          </div>
          <div className="expand-chevron" aria-hidden="true">
            {isExpanded ? '▾' : '▸'}
          </div>
        </div>
        
        {/* Row 2: Progress, task counts, and timeline */}
        <div className="project-right-info">
          <div className="project-stats-group">
            {/* Circular progress indicator */}
            <div className={`project-progress-circle ${visualStatus}`}>
              <svg width="40" height="40" viewBox="0 0 40 40">
                <circle
                  cx="20"
                  cy="20"
                  r="16"
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.1)"
                  strokeWidth="3"
                />
                <circle
                  cx="20"
                  cy="20"
                  r="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray={`${progressPct * 1.005} 100.5`}
                  strokeLinecap="round"
                  transform="rotate(-90 20 20)"
                />
                <text
                  x="20"
                  y="20"
                  textAnchor="middle"
                  dy="0.35em"
                  fontSize="10"
                  fill="currentColor"
                  fontWeight="600"
                >
                  {progressPct}%
                </text>
              </svg>
            </div>
            
            {/* Task counts */}
            <div className="project-task-counts">
              {hasAnyTasks ? (
                <>
                  <span className="task-count-label">
                    {completedTasks.length} of {totalTasks} done
                  </span>
                  {hasOpenTasks && (
                    <span className="task-count-open">
                      {openTasks.length} open
                    </span>
                  )}
                </>
              ) : (
                <span className="task-count-empty">
                  No tasks yet
                </span>
              )}
            </div>
          </div>
          
          {showTimelineIndicator && (
            <button
              type="button"
              className={`timeline-indicator ${visualStatus}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleDateEditor();
              }}
              title="Click to edit project dates"
            >
              <span className="timeline-summary-text">{timelineSummary}</span>
              <div className="timeline-progress-row">
                <span className="timeline-range-label">
                  {startDate ? formatDate(startDate) : 'Start'}
                </span>
                <div className="timeline-progress-track">
                  <div
                    className="timeline-progress-fill"
                    style={{
                      width: `${timelineFillPercent}%`,
                      background: timelineFillColor
                    }}
                  />
                </div>
                <span className={`timeline-range-label ${timelineStatus === 'overdue' ? 'overdue' : ''}`}>
                  {endDate ? formatDate(endDate) : 'Deadline'}
                </span>
              </div>
            </button>
          )}
        </div>
      </button>

      {/* Progress bar */}
      <div className="project-progress-track">
        <div
          className="project-progress-fill"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="project-expanded-content">
          {/* Timeline arrow section */}
          {(startDate || endDate) && (
            <div className={`project-timeline-arrow ${visualStatus}`}>
              <span className="timeline-start-date">
                {startDate ? formatDate(startDate) : '—'}
              </span>
              <div className="timeline-arrow-track">
                <div 
                  className="timeline-arrow-progress"
                  style={{
                    width: `${timelineArrowPercent}%`,
                    background: timelineArrowGradient
                  }}
                />
                <div className="timeline-arrow-head">▶</div>
              </div>
              <span className={`timeline-end-date ${timelineStatus === 'overdue' ? 'overdue' : ''}`}>
                {endDate ? formatDate(endDate) : '—'}
              </span>
            </div>
          )}

          {/* Project Date Editor */}
          {showDateEditor && (
            <ProjectDateEditor
              project={project}
              onClose={onToggleDateEditor}
            />
          )}

          {/* Priority breakdown */}
          {hasOpenTasks && (
            <div className="project-priority-breakdown">
              {doNow > 0 && (
                <span className="priority-chip do-now">{doNow} Do Now</span>
              )}
              {deepWork > 0 && (
                <span className="priority-chip deep-work">{deepWork} Deep Work</span>
              )}
              {delegate > 0 && (
                <span className="priority-chip delegate">{delegate} Delegate</span>
              )}
            </div>
          )}

          {/* Next action */}
          {nextAction && (
            <button
              type="button"
              className="project-next-action"
              onClick={(e) => {
                e.stopPropagation();
                onTaskDoubleClick(nextAction);
              }}
              title="Click to view task details"
            >
              <span className="next-action-label">Next action</span>
              <div className="next-action-content">
                <span className="next-action-title">{nextAction.title}</span>
                {nextAction.dueDate && (
                  <span className="next-action-due">
                    Due {formatDate(new Date(nextAction.dueDate))}
                  </span>
                )}
              </div>
            </button>
          )}

          {/* Toggle to show all tasks */}
          {(openTasks.length > 0 || completedTasks.length > 0) && (
            <button
              type="button"
              className="project-tasks-toggle"
              onClick={(e) => {
                e.stopPropagation();
                onToggleTasks();
              }}
            >
              {showTasks ? '▾ Hide tasks' : '▸ Show all tasks'}
              <span className="tasks-toggle-count">
                ({openTasks.length + completedTasks.length})
              </span>
            </button>
          )}

          {/* Task list with clickable items */}
          {showTasks && (
            <div className="project-tasks-list">
              {openTasks.length > 0 && (
                <div className="tasks-section">
                  <div className="tasks-section-header">Open Tasks ({openTasks.length})</div>
                  {[...openTasks].sort((a, b) => {
                    // 1. Sort by date first (earliest first, no date last)
                    const dateA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
                    const dateB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
                    if (dateA !== dateB) return dateA - dateB;
                    
                    // 2. Sort by hard deadline (hard deadlines first)
                    const hardA = a.hardDeadline ? 0 : 1;
                    const hardB = b.hardDeadline ? 0 : 1;
                    if (hardA !== hardB) return hardA - hardB;
                    
                    // 3. Sort by priority (Eisenhower matrix)
                    const matrixOrder = ['do-now', 'delegate', 'deep-work', 'trash'];
                    const rankA = matrixOrder.indexOf(getMatrixCategory(a));
                    const rankB = matrixOrder.indexOf(getMatrixCategory(b));
                    return rankA - rankB;
                  }).map((task) => {
                    const matrixCategory = getMatrixCategory(task);
                    const matrixInfo = MATRIX_LABELS[matrixCategory] || { label: '', class: '' };
                    const isHovered = hoveredTaskId === task.id;
                    const isSelected = selectedTaskId === task.id;
                    const dueDateLabel = task.dueDate ? formatDate(new Date(task.dueDate)) : null;
                    const deadlineEmoji = task.dueDate ? (task.hardDeadline ? '🔴' : '🔵') : null;
                    
                    return (
                      <div
                        key={task.id}
                        className={`project-task-item ${isHovered ? 'is-hovered' : ''} ${isSelected ? 'is-selected' : ''}`}
                        onMouseEnter={() => onHoverTask(task.id)}
                        onMouseLeave={() => onHoverTask(null)}
                        onDoubleClick={() => onTaskDoubleClick(task)}
                      >
                        <button
                          type="button"
                          className="task-checkbox-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleTaskComplete(task);
                          }}
                          title="Mark as complete"
                        >
                          ○
                        </button>
                        <span
                          className="task-title"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            onTaskDoubleClick(task);
                          }}
                        >
                          {task.title}
                        </span>
                        <div className="task-meta">
                          {dueDateLabel && (
                            <span className="task-due">
                              {dueDateLabel}
                            </span>
                          )}
                          {deadlineEmoji && (
                            <span
                              className={`task-deadline-flag ${task.hardDeadline ? 'hard' : 'soft'}`}
                              title={task.hardDeadline ? 'Hard deadline' : 'Soft deadline'}
                            >
                              {deadlineEmoji}
                            </span>
                          )}
                          {matrixInfo.label && (
                            <span className={`task-matrix-badge ${matrixInfo.class}`}>
                              {matrixInfo.label}
                            </span>
                          )}
                        </div>
                        
                        {/* Task popup on selection */}
                        {isSelected && (
                          <TaskDetailPopup
                            task={task}
                            completedStatus={completedStatus}
                            onClose={() => onTaskDoubleClick(task)}
                            onToggleTaskComplete={onToggleTaskComplete}
                            onUpdateTask={onUpdateTask}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {completedTasks.length > 0 && (
                <div className="tasks-section completed">
                  <div className="tasks-section-header">Completed ({completedTasks.length})</div>
                  {completedTasks.map((task) => (
                    <div
                      key={task.id}
                      className={`project-task-item completed ${selectedTaskId === task.id ? 'is-selected' : ''}`}
                      onMouseEnter={() => onHoverTask(task.id)}
                      onMouseLeave={() => onHoverTask(null)}
                      onDoubleClick={() => onTaskDoubleClick(task)}
                    >
                      <button
                        type="button"
                        className="task-checkbox-btn completed"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleTaskComplete(task);
                        }}
                        title="Mark as to-do"
                      >
                        ✓
                      </button>
                      <span
                        className="task-title"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          onTaskDoubleClick(task);
                        }}
                      >
                        {task.title}
                      </span>
                      <div className="task-meta">
                        {task.dueDate && (
                          <span className="task-due">
                            {formatDate(new Date(task.dueDate))}
                          </span>
                        )}
                        {task.dueDate && (
                          <span
                            className={`task-deadline-flag ${task.hardDeadline ? 'hard' : 'soft'}`}
                            title={task.hardDeadline ? 'Hard deadline' : 'Soft deadline'}
                          >
                            {task.hardDeadline ? '🔴' : '🔵'}
                          </span>
                        )}
                      </div>

                      {selectedTaskId === task.id && (
                        <TaskDetailPopup
                          task={task}
                          completedStatus={completedStatus}
                          onClose={() => onTaskDoubleClick(task)}
                          onToggleTaskComplete={onToggleTaskComplete}
                          onUpdateTask={onUpdateTask}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Project Notes Entry */}
          <button
            type="button"
            className="project-notes-toggle"
            onClick={(e) => {
              e.stopPropagation();
              onToggleNotes();
            }}
          >
            {showNotes ? '▾ Close project log' : '▸ Add project log entry'}
          </button>

          {showNotes && onCreateWritingEntry && (
            <ProjectNotesEntry
              projectTitle={project.title ?? 'Project'}
              onCreateEntry={onCreateWritingEntry}
            />
          )}

          {/* Description */}
          {project.description && (
            <p className="project-description-v2">{project.description}</p>
          )}

          {/* Tags */}
          {project.tags && project.tags.length > 0 && (
            <div className="project-tags-row">
              {project.tags.map((tag) => (
                <span key={tag} className="project-tag-v2">{tag}</span>
              ))}
            </div>
          )}

          {/* Open in Notion */}
          {project.url && (
            <div className="project-actions-row">
              <a
                href={project.url}
                target="_blank"
                rel="noopener noreferrer"
                className="project-open-link"
              >
                Open in Notion →
              </a>
            </div>
          )}
        </div>
      )}
    </article>
  );
};

// Project Date Editor Component
interface ProjectDateEditorProps {
  project: Project;
  onClose: () => void;
}

const ProjectDateEditor: FC<ProjectDateEditorProps> = ({ project, onClose }) => {
  return (
    <div className="project-date-editor">
      <div className="date-editor-header">
        <span className="date-editor-title">Project Timeline</span>
        <button type="button" className="date-editor-close" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="date-editor-feedback">
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--notion-text-muted)' }}>
          Project date editing coming soon. For now, edit dates directly in Notion.
        </p>
        {project.url && (
          <a
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              marginTop: '8px',
              fontSize: '12px',
              color: '#a78bfa',
              textDecoration: 'none'
            }}
          >
            Open in Notion →
          </a>
        )}
      </div>
    </div>
  );
};

// Project Notes Entry Component
interface ProjectNotesEntryProps {
  projectTitle: string;
  onCreateEntry: (payload: WritingEntryPayload) => Promise<void>;
}

const ProjectNotesEntry: FC<ProjectNotesEntryProps> = ({ projectTitle, onCreateEntry }) => {
  const bodyValueRef = useRef(createInitialBodyValue());
  const [editorResetSignal, setEditorResetSignal] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const handleSubmit = async () => {
    const content = valueToPlainText(bodyValueRef.current);
    if (!content.trim()) {
      setFeedback({ kind: 'error', message: 'Please enter some content' });
      return;
    }

    const blocks = valueToMarkdownBlocks(bodyValueRef.current);
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const title = `${projectTitle} Log - ${dateStr}`;

    try {
      setSubmitting(true);
      setFeedback(null);
      await onCreateEntry({
        title,
        content,
        contentBlocks: blocks
      });
      setFeedback({ kind: 'success', message: 'Log entry saved to Notion' });
      bodyValueRef.current = createInitialBodyValue();
      setEditorResetSignal((s) => s + 1);
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to save entry'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditorChange = useCallback((val: Descendant[]) => {
    bodyValueRef.current = val;
  }, []);

  return (
    <div className="project-notes-entry">
      <div className="notes-entry-header">
        <span className="notes-entry-title">{projectTitle} Log</span>
        <span className="notes-entry-hint">Markdown supported</span>
      </div>
      
      {feedback && (
        <div className={`notes-feedback ${feedback.kind}`}>
          {feedback.message}
        </div>
      )}
      
      <div className="notes-editor-wrapper">
        <RichBodyEditor
          onValueChange={handleEditorChange}
          placeholder="Write your project notes here..."
          resetSignal={editorResetSignal}
        />
      </div>
      
      <div className="notes-entry-actions">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="notes-submit-btn"
        >
          {submitting ? 'Saving...' : 'Save to Writing Log'}
        </button>
      </div>
    </div>
  );
};

interface TaskDetailPopupProps {
  task: Task;
  completedStatus?: string;
  onClose: () => void;
  onToggleTaskComplete: (task: Task) => void;
  onUpdateTask?: (taskId: string, updates: TaskUpdatePayload) => Promise<void>;
}

const TaskDetailPopup: FC<TaskDetailPopupProps> = ({
  task,
  completedStatus,
  onClose,
  onToggleTaskComplete,
  onUpdateTask
}) => {
  const [titleValue, setTitleValue] = useState(task.title);
  const [dueDateValue, setDueDateValue] = useState(task.dueDate ? task.dueDate.slice(0, 10) : '');
  const [hardDeadlineValue, setHardDeadlineValue] = useState(Boolean(task.hardDeadline));
  const initialMatrix = findMatrixOptionFromFlags(task.urgent, task.important);
  const [matrixId, setMatrixId] = useState<MatrixOptionId>(initialMatrix.id);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitleValue(task.title);
    setDueDateValue(task.dueDate ? task.dueDate.slice(0, 10) : '');
    setHardDeadlineValue(Boolean(task.hardDeadline));
    setMatrixId(findMatrixOptionFromFlags(task.urgent, task.important).id);
    setFeedback(null);
    setError(null);
  }, [task]);

  const hasChanges = useMemo(() => {
    const baselineMatrix = findMatrixOptionFromFlags(task.urgent, task.important);
    return (
      titleValue.trim() !== task.title ||
      (task.dueDate ? task.dueDate.slice(0, 10) : '') !== dueDateValue ||
      Boolean(task.hardDeadline) !== hardDeadlineValue ||
      baselineMatrix.id !== matrixId
    );
  }, [titleValue, dueDateValue, hardDeadlineValue, matrixId, task]);

  const handleSave = useCallback(async () => {
    if (!onUpdateTask || !hasChanges) return;
    const updates: TaskUpdatePayload = {};
    const trimmedTitle = titleValue.trim();
    if (trimmedTitle && trimmedTitle !== task.title) {
      updates.title = trimmedTitle;
    }
    const originalDate = task.dueDate ? task.dueDate.slice(0, 10) : '';
    if (dueDateValue !== originalDate) {
      updates.dueDate = dueDateValue ? new Date(`${dueDateValue}T00:00:00`).toISOString() : null;
    }
    if (hardDeadlineValue !== Boolean(task.hardDeadline)) {
      updates.hardDeadline = hardDeadlineValue;
    }
    const selectedMatrix = matrixOptions.find((option) => option.id === matrixId);
    if (selectedMatrix) {
      if (Boolean(task.urgent) !== selectedMatrix.urgent) {
        updates.urgent = selectedMatrix.urgent;
      }
      if (Boolean(task.important) !== selectedMatrix.important) {
        updates.important = selectedMatrix.important;
      }
    }
    if (Object.keys(updates).length === 0) {
      setFeedback('No changes to save');
      return;
    }

    try {
      setSaving(true);
      setFeedback(null);
      setError(null);
      await onUpdateTask(task.id, updates);
      setFeedback('Saved to Notion');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save changes');
    } finally {
      setSaving(false);
    }
  }, [dueDateValue, hardDeadlineValue, hasChanges, matrixId, onUpdateTask, task, titleValue]);

  return (
    <div className="task-popup" onClick={(e) => e.stopPropagation()}>
      <div className="task-popup-header">
        <span className="task-popup-title">Task details</span>
        <button type="button" className="task-popup-close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="task-popup-body">
        <label className="task-popup-field-label">Title</label>
        <input
          type="text"
          className="task-popup-input"
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
        />

        <div className="task-popup-field-grid">
          <div className="task-popup-field">
            <label className="task-popup-field-label">Due date</label>
            <div className="task-popup-date-row">
              <input
                type="date"
                className="task-popup-input"
                value={dueDateValue}
                onChange={(e) => setDueDateValue(e.target.value)}
              />
              {dueDateValue && (
                <button
                  type="button"
                  className="task-popup-clear"
                  onClick={() => setDueDateValue('')}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="task-popup-field">
            <label className="task-popup-field-label">Deadline type</label>
            <div className="deadline-toggle">
              <button
                type="button"
                className={hardDeadlineValue ? 'active' : ''}
                onClick={() => setHardDeadlineValue(true)}
              >
                🔴 Hard
              </button>
              <button
                type="button"
                className={!hardDeadlineValue ? 'active' : ''}
                onClick={() => setHardDeadlineValue(false)}
              >
                🔵 Soft
              </button>
            </div>
          </div>
        </div>

        <label className="task-popup-field-label">Priority</label>
        <div className="matrix-selector">
          {matrixOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`matrix-selector-btn ${matrixId === option.id ? 'active' : ''}`}
              onClick={() => setMatrixId(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {feedback && <div className="task-popup-feedback success">{feedback}</div>}
        {error && <div className="task-popup-feedback error">{error}</div>}
      </div>
      <div className="task-popup-actions">
        <div className="task-popup-actions-left">
          <button type="button" onClick={() => onToggleTaskComplete(task)}>
            {task.status === completedStatus ? 'Mark as To-do' : 'Mark Complete'}
          </button>
          {task.url && (
            <button type="button" onClick={() => window.open(task.url, '_blank', 'noopener')}>
              Open in Notion
            </button>
          )}
        </div>
        <div className="task-popup-actions-right">
          <button
            type="button"
            className="primary"
            disabled={!hasChanges || saving || !onUpdateTask}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectsWidget;

function formatDate(date: Date): string {
  const now = new Date();
  const isThisYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: isThisYear ? undefined : 'numeric'
  });
}

function getTimelineProgress(start: Date, end: Date, now: Date): number {
  const total = end.getTime() - start.getTime();
  if (total <= 0) return 100;
  const elapsed = now.getTime() - start.getTime();
  if (elapsed <= 0) return 0;
  if (elapsed >= total) return 100;
  return Math.round((elapsed / total) * 100);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function getTimelineColor(ratio: number) {
  const hueStart = 270; // purple
  const hueEnd = 120; // green
  const hue = hueStart - (hueStart - hueEnd) * clamp01(ratio);
  return `hsl(${hue}, 80%, 62%)`;
}

function getTimelineGradient(ratio: number) {
  const baseColor = getTimelineColor(ratio);
  const secondaryColor = getTimelineColor(clamp01(ratio + 0.1));
  return `linear-gradient(90deg, ${baseColor}, ${secondaryColor})`;
}
