import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { Project, Task } from '@shared/types';

interface StatusOption {
  id: string;
  name: string;
  color?: string;
}

interface Props {
  projects: Project[];
  tasks: Task[];
  onSelectProject?: (projectId: string) => void;
  onOpenProjectWorkspace?: (projectId: string) => void;
  selectedProjectId?: string | null;
  hideToolbar?: boolean;
  /** Available status options - shows all as columns even if empty */
  statusOptions?: StatusOption[];
  /** Callback when a project is dragged to a new status column */
  onUpdateProjectStatus?: (projectId: string, newStatus: string) => void;
}

interface ColumnConfig {
  id: string;
  label: string;
  color: string;
  projects: Project[];
}

// Default status colors (map Notion status colors)
const STATUS_COLORS: Record<string, string> = {
  'Not started': '#6b7280',
  'Planning': '#6b7280',
  'In progress': '#3b82f6',
  'Active': '#3b82f6',
  'On Hold': '#f59e0b',
  'Blocked': '#ef4444',
  'Done': '#22c55e',
  'Completed': '#22c55e',
  'Cancelled': '#9ca3af',
  default: '#6b7280'
};

const getStatusColor = (status: string): string => {
  if (STATUS_COLORS[status]) return STATUS_COLORS[status];
  const lowerStatus = status.toLowerCase();
  if (lowerStatus.includes('progress') || lowerStatus.includes('active') || lowerStatus.includes('doing')) return '#3b82f6';
  if (lowerStatus.includes('done') || lowerStatus.includes('complete')) return '#22c55e';
  if (lowerStatus.includes('hold') || lowerStatus.includes('pause')) return '#f59e0b';
  if (lowerStatus.includes('block') || lowerStatus.includes('stuck')) return '#ef4444';
  if (lowerStatus.includes('cancel')) return '#9ca3af';
  if (lowerStatus.includes('plan') || lowerStatus.includes('backlog') || lowerStatus.includes('not started')) return '#6b7280';
  return STATUS_COLORS.default;
};

const formatDate = (dateStr: string | undefined | null): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const getDaysRemaining = (dateStr: string | undefined | null): number | null => {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

const DEFAULT_COLUMN_WIDTH = 300;
const MIN_COLUMN_WIDTH = 220;
const MAX_COLUMN_WIDTH = 500;

const ProjectKanban = ({
  projects,
  tasks,
  onSelectProject,
  onOpenProjectWorkspace,
  selectedProjectId,
  hideToolbar = false,
  statusOptions = [],
  onUpdateProjectStatus
}: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [collapsedColumns, setCollapsedColumns] = useState<Set<string>>(new Set());
  
  // Column resize state
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(0);

  // Filter projects
  const filteredProjects = useMemo(() => {
    let result = projects;
    
    // Filter by completed
    if (!showCompleted) {
      result = result.filter(p => {
        const status = p.status?.toLowerCase() || '';
        return !status.includes('done') && !status.includes('complete') && !status.includes('cancel');
      });
    }
    
    // Filter by search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(p => 
        p.title?.toLowerCase().includes(query) ||
        p.status?.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query)
      );
    }
    
    return result;
  }, [projects, showCompleted, searchQuery]);

  // Build columns from statusOptions (if provided) or actual project statuses
  const columns = useMemo((): ColumnConfig[] => {
    const statusMap = new Map<string, Project[]>();
    
    // Group projects by status
    filteredProjects.forEach(project => {
      const status = project.status || 'No Status';
      const list = statusMap.get(status) ?? [];
      list.push(project);
      statusMap.set(status, list);
    });
    
    // If we have statusOptions, use them as the column definitions (shows all even if empty)
    if (statusOptions.length > 0) {
      const columns: ColumnConfig[] = [];
      
      // Add columns for each status option
      statusOptions.forEach(option => {
        const statusName = option.name;
        columns.push({
          id: statusName.toLowerCase().replace(/\s+/g, '-'),
          label: statusName,
          color: option.color || getStatusColor(statusName),
          projects: statusMap.get(statusName) ?? []
        });
        // Remove from map so we know what's left
        statusMap.delete(statusName);
      });
      
      // Add "No Status" column at the end if there are projects without status
      const noStatusProjects = statusMap.get('No Status') ?? [];
      if (noStatusProjects.length > 0 || !statusOptions.some(o => o.name === 'No Status')) {
        // Check if we have projects with statuses not in our options
        const otherProjects: Project[] = [];
        statusMap.forEach((projects, status) => {
          if (status !== 'No Status') {
            otherProjects.push(...projects);
          }
        });
        
        if (noStatusProjects.length > 0 || otherProjects.length > 0) {
          columns.push({
            id: 'no-status',
            label: 'No Status',
            color: STATUS_COLORS.default,
            projects: [...noStatusProjects, ...otherProjects]
          });
        }
      }
      
      return columns;
    }
    
    // Fallback: Build columns from actual project statuses (old behavior)
    const statusOrder = ['Not started', 'Planning', 'Backlog', 'In progress', 'Active', 'On Hold', 'Blocked', 'Review', 'Done', 'Completed', 'Cancelled'];
    const sortedStatuses = Array.from(statusMap.keys()).sort((a, b) => {
      const aIndex = statusOrder.findIndex(s => a.toLowerCase().includes(s.toLowerCase()));
      const bIndex = statusOrder.findIndex(s => b.toLowerCase().includes(s.toLowerCase()));
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b);
    });
    
    return sortedStatuses.map(status => ({
      id: status.toLowerCase().replace(/\s+/g, '-'),
      label: status,
      color: getStatusColor(status),
      projects: statusMap.get(status) ?? []
    }));
  }, [filteredProjects, statusOptions]);

  // Calculate project stats
  const getProjectStats = useCallback((projectId: string) => {
    const projectTasks = tasks.filter(t => (t.projectIds ?? []).includes(projectId));
    const completed = projectTasks.filter(t => t.normalizedStatus === 'complete').length;
    const urgent = projectTasks.filter(t => t.urgent && t.normalizedStatus !== 'complete').length;
    const total = projectTasks.length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdue = projectTasks.filter(t => 
      t.dueDate && new Date(t.dueDate) < today && t.normalizedStatus !== 'complete'
    ).length;
    
    return { total, completed, urgent, progress, overdue, remaining: total - completed };
  }, [tasks]);

  // Stats
  const stats = useMemo(() => ({
    total: filteredProjects.length,
    active: filteredProjects.filter(p => {
      const s = p.status?.toLowerCase() || '';
      return s.includes('progress') || s.includes('active');
    }).length,
    completed: projects.filter(p => {
      const s = p.status?.toLowerCase() || '';
      return s.includes('done') || s.includes('complete');
    }).length
  }), [filteredProjects, projects]);

  // Drag handlers
  const handleDragStart = useCallback((project: Project, event: ReactDragEvent) => {
    setDraggedProjectId(project.id);
    event.dataTransfer.setData('application/x-project-id', project.id);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedProjectId(null);
    setDropTarget(null);
  }, []);

  const handleDragOver = useCallback((columnId: string, event: ReactDragEvent) => {
    if (!draggedProjectId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(columnId);
  }, [draggedProjectId]);

  const handleDragLeave = useCallback(() => setDropTarget(null), []);

  const handleDrop = useCallback((columnId: string, event: ReactDragEvent) => {
    event.preventDefault();
    setDropTarget(null);
    
    if (draggedProjectId) {
      // Find the column label (actual status name) from the column ID
      const column = columns.find(c => c.id === columnId);
      const newStatus = column?.label || columnId;
      
      if (onUpdateProjectStatus) {
        onUpdateProjectStatus(draggedProjectId, newStatus);
      } else {
        console.log(`Would move project ${draggedProjectId} to status "${newStatus}"`);
      }
    }
    setDraggedProjectId(null);
  }, [draggedProjectId, columns, onUpdateProjectStatus]);

  const toggleColumnCollapse = useCallback((columnId: string) => {
    setCollapsedColumns(prev => {
      const next = new Set(prev);
      next.has(columnId) ? next.delete(columnId) : next.add(columnId);
      return next;
    });
  }, []);

  // Column resize handlers
  const handleResizeStart = useCallback((columnId: string, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setResizingColumn(columnId);
    resizeStartX.current = event.clientX;
    resizeStartWidth.current = columnWidths[columnId] || DEFAULT_COLUMN_WIDTH;
  }, [columnWidths]);

  const handleResizeMove = useCallback((event: MouseEvent) => {
    if (!resizingColumn) return;
    const delta = event.clientX - resizeStartX.current;
    const newWidth = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, resizeStartWidth.current + delta));
    setColumnWidths(prev => ({ ...prev, [resizingColumn]: newWidth }));
  }, [resizingColumn]);

  const handleResizeEnd = useCallback(() => {
    setResizingColumn(null);
  }, []);

  // Attach resize mouse handlers
  useEffect(() => {
    if (!resizingColumn) return;
    
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    
    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizingColumn, handleResizeMove, handleResizeEnd]);

  const renderProjectCard = (project: Project) => {
    const isDragging = draggedProjectId === project.id;
    const isSelected = selectedProjectId === project.id;
    const stats = getProjectStats(project.id);
    const daysRemaining = getDaysRemaining(project.endDate);
    const isOverdue = daysRemaining !== null && daysRemaining < 0;
    const isUrgent = daysRemaining !== null && daysRemaining <= 7 && daysRemaining >= 0;
    
    return (
      <div
        key={project.id}
        className={`kanban-card project-card ${isDragging ? 'is-dragging' : ''} ${isSelected ? 'is-selected' : ''} ${isOverdue ? 'is-overdue' : ''}`}
        draggable
        onDragStart={(e) => handleDragStart(project, e)}
        onDragEnd={handleDragEnd}
        onClick={() => onSelectProject?.(project.id)}
        onDoubleClick={() => onOpenProjectWorkspace?.(project.id)}
      >
        {/* Card Header */}
        <div className="kanban-card-header">
          <span className="project-emoji">{project.emoji || '📁'}</span>
          <span className="kanban-card-title project-title-wrap">{project.title || 'Untitled'}</span>
        </div>
        
        {/* Task Progress */}
        <div className="project-card-progress">
          <div className="progress-bar">
            <span 
              className="progress-fill" 
              style={{ width: `${stats.progress}%` }}
            />
          </div>
          <div className="progress-info">
            <span className="progress-text">{stats.completed}/{stats.total} tasks</span>
            <span className="progress-percent">{stats.progress}%</span>
          </div>
        </div>
        
        {/* Footer with badges and deadline */}
        <div className="kanban-card-footer">
          <div className="card-badges">
            {stats.overdue > 0 && (
              <span className="badge overdue" title={`${stats.overdue} overdue tasks`}>
                ⚠️ {stats.overdue}
              </span>
            )}
            {stats.urgent > 0 && (
              <span className="badge urgent" title={`${stats.urgent} urgent tasks`}>
                🔥 {stats.urgent}
              </span>
            )}
            {stats.remaining > 0 && (
              <span className="badge remaining">{stats.remaining} left</span>
            )}
          </div>
          
          {/* Project Deadline */}
          {project.endDate && (
            <span className={`kanban-card-date project-deadline ${isOverdue ? 'is-overdue' : ''} ${isUrgent ? 'is-urgent' : ''}`}>
              {isOverdue 
                ? `${Math.abs(daysRemaining!)}d overdue`
                : daysRemaining === 0 
                  ? 'Due today'
                  : `${daysRemaining}d left`
              }
            </span>
          )}
        </div>
      </div>
    );
  };

  const renderColumn = (column: ColumnConfig, index: number) => {
    const isDropTarget = dropTarget === column.id;
    const isCollapsed = collapsedColumns.has(column.id);
    const columnWidth = isCollapsed ? 60 : (columnWidths[column.id] || DEFAULT_COLUMN_WIDTH);
    const isResizing = resizingColumn === column.id;
    
    return (
      <div
        key={column.id}
        className={`kanban-column ${isDropTarget ? 'is-drop-target' : ''} ${isCollapsed ? 'is-collapsed' : ''} ${isResizing ? 'is-resizing' : ''}`}
        style={{ width: columnWidth, minWidth: isCollapsed ? 60 : MIN_COLUMN_WIDTH, maxWidth: isCollapsed ? 60 : MAX_COLUMN_WIDTH }}
        onDragOver={(e) => handleDragOver(column.id, e)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(column.id, e)}
      >
        <div 
          className="kanban-column-header"
          style={{ '--column-color': column.color } as React.CSSProperties}
          onClick={() => toggleColumnCollapse(column.id)}
        >
          <span className="kanban-column-indicator" />
          <span className="kanban-column-title">{column.label}</span>
          <span className="kanban-column-count">{column.projects.length}</span>
          <button type="button" className="kanban-column-collapse" aria-label={isCollapsed ? 'Expand' : 'Collapse'}>
            {isCollapsed ? '▶' : '▼'}
          </button>
        </div>
        {!isCollapsed && (
          <div className="kanban-column-body">
            {column.projects.length === 0 ? (
              <div className="kanban-column-empty">
                No projects
              </div>
            ) : (
              column.projects.map(renderProjectCard)
            )}
          </div>
        )}
        {/* Resize handle */}
        {!isCollapsed && index < columns.length - 1 && (
          <div
            className="kanban-column-resizer"
            onMouseDown={(e) => handleResizeStart(column.id, e)}
          />
        )}
      </div>
    );
  };

  return (
    <div 
      className={`kanban-board project-kanban-board ${hideToolbar ? 'no-toolbar' : ''}`}
      ref={containerRef}
      tabIndex={-1}
    >
      {/* Toolbar - hidden when embedded in dashboard */}
      {!hideToolbar && (
        <div className="kanban-toolbar">
          <div className="kanban-toolbar-left">
            {/* Search */}
            <div className="kanban-search">
              <input
                type="text"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')}>✕</button>
              )}
            </div>
            
            {/* Show completed toggle switch */}
            <button
              type="button"
              className={`toggle-switch ${showCompleted ? 'is-active' : ''}`}
              onClick={() => setShowCompleted(!showCompleted)}
              aria-pressed={showCompleted}
              title={showCompleted ? 'Hide completed projects' : 'Show completed projects'}
            >
              <span className="toggle-switch-track">
                <span className="toggle-switch-thumb" />
              </span>
              <span className="toggle-switch-label">Done</span>
            </button>
          </div>
          
          <div className="kanban-toolbar-right">
            <div className="kanban-stats">
              <span className="kanban-stat"><strong>{stats.total}</strong> total</span>
              <span className="kanban-stat progress"><strong>{stats.active}</strong> active</span>
              <span className="kanban-stat done"><strong>{stats.completed}</strong> done</span>
            </div>
          </div>
        </div>
      )}

      {/* Columns */}
      <div className={`kanban-columns ${resizingColumn ? 'is-resizing' : ''}`}>
        {columns.map((col, idx) => renderColumn(col, idx))}
        
        {columns.length === 0 && (
          <div className="kanban-empty">
            <span className="empty-icon">📊</span>
            <p>No projects found</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectKanban;
