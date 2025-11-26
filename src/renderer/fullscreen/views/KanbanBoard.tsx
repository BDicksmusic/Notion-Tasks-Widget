import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { Task, TaskStatusOption, TaskUpdatePayload, Project, NotionCreatePayload } from '@shared/types';

interface KanbanBoardProps {
  tasks: Task[];
  statusOptions: TaskStatusOption[];
  projects?: Project[];
  completedStatus?: string;
  project?: Project | null;
  onUpdateTask?: (taskId: string, updates: TaskUpdatePayload) => Promise<void>;
  onAddTask?: (payload: NotionCreatePayload) => Promise<void>;
  onSelectTask?: (taskId: string) => void;
  onPopOutTask?: (task: Task) => void;
  onClose?: () => void;
  hideToolbar?: boolean;
}

type GroupBy = 'status' | 'priority' | 'project' | 'dueDate';

interface ColumnConfig {
  id: string;
  label: string;
  color: string;
  tasks: Task[];
  icon?: string;
}

const STATUS_COLORS: Record<string, string> = {
  'Not started': '#6b7280',
  'In progress': '#3b82f6',
  'Blocked': '#ef4444',
  'Done': '#22c55e',
  'Cancelled': '#9ca3af',
  default: '#6b7280'
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  'do-now': { label: 'Do Now', color: '#ef4444', icon: '🔥' },
  'schedule': { label: 'Schedule', color: '#3b82f6', icon: '📅' },
  'delegate': { label: 'Delegate', color: '#f59e0b', icon: '👥' },
  'eliminate': { label: 'Eliminate', color: '#6b7280', icon: '🗑️' }
};

const DUE_DATE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  'overdue': { label: 'Overdue', color: '#ef4444', icon: '⚠️' },
  'today': { label: 'Today', color: '#f59e0b', icon: '📌' },
  'tomorrow': { label: 'Tomorrow', color: '#eab308', icon: '🌅' },
  'this-week': { label: 'This Week', color: '#3b82f6', icon: '📆' },
  'later': { label: 'Later', color: '#6b7280', icon: '📋' },
  'no-date': { label: 'No Date', color: '#4b5563', icon: '❓' }
};

const getStatusColor = (status: string): string => {
  if (STATUS_COLORS[status]) return STATUS_COLORS[status];
  const lowerStatus = status.toLowerCase();
  if (lowerStatus.includes('progress') || lowerStatus.includes('doing')) return '#3b82f6';
  if (lowerStatus.includes('done') || lowerStatus.includes('complete')) return '#22c55e';
  if (lowerStatus.includes('block') || lowerStatus.includes('stuck')) return '#ef4444';
  if (lowerStatus.includes('cancel')) return '#9ca3af';
  if (lowerStatus.includes('review') || lowerStatus.includes('test')) return '#f59e0b';
  return STATUS_COLORS.default;
};

const getPriorityKey = (task: Task): string => {
  const urgent = Boolean(task.urgent);
  const important = Boolean(task.important);
  if (urgent && important) return 'do-now';
  if (!urgent && important) return 'schedule';
  if (urgent && !important) return 'delegate';
  return 'eliminate';
};

const getDueDateKey = (task: Task): string => {
  if (!task.dueDate) return 'no-date';
  const due = new Date(task.dueDate);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const endOfWeek = new Date(today);
  endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
  
  if (due < today) return 'overdue';
  if (due.getTime() === today.getTime()) return 'today';
  if (due.getTime() === tomorrow.getTime()) return 'tomorrow';
  if (due <= endOfWeek) return 'this-week';
  return 'later';
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

const DEFAULT_COLUMN_WIDTH = 300;
const MIN_COLUMN_WIDTH = 200;
const MAX_COLUMN_WIDTH = 600;

const KanbanBoard = ({
  tasks,
  statusOptions,
  projects = [],
  completedStatus,
  project,
  onUpdateTask,
  onAddTask,
  onSelectTask,
  onPopOutTask,
  onClose,
  hideToolbar = false
}: KanbanBoardProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [filterProject, setFilterProject] = useState<string | null>(null);
  const [collapsedColumns, setCollapsedColumns] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  
  // Column resize state
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(0);
  
  // Column order state - allows reordering columns
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null);
  const [columnDropTarget, setColumnDropTarget] = useState<string | null>(null);
  
  // Layout mode - horizontal (side-by-side columns) or vertical (stacked rows)
  type LayoutMode = 'horizontal' | 'vertical';
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    if (typeof window === 'undefined') return 'horizontal';
    const stored = window.localStorage?.getItem('kanban.layoutMode');
    return stored === 'vertical' ? 'vertical' : 'horizontal';
  });
  
  // Selection state (like TaskList)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  const [selectionAnchorIndex, setSelectionAnchorIndex] = useState<number>(-1);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    let result = tasks;
    
    // Filter by completed status
    if (!showCompleted) {
      result = result.filter(t => t.status !== completedStatus);
    }
    
    // Filter by project
    if (filterProject) {
      result = result.filter(t => (t.projectIds ?? []).includes(filterProject));
    }
    
    // Filter by search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(t => 
        t.title.toLowerCase().includes(query) ||
        t.status?.toLowerCase().includes(query)
      );
    }
    
    return result;
  }, [tasks, showCompleted, completedStatus, filterProject, searchQuery]);

  // Build columns based on groupBy
  const columns = useMemo(() => {
    const result: ColumnConfig[] = [];
    
    if (groupBy === 'status') {
      const statusMap = new Map<string, Task[]>();
      statusOptions.forEach(opt => statusMap.set(opt.name, []));
      filteredTasks.forEach(task => {
        const status = task.status || 'Not started';
        const bucket = statusMap.get(status) ?? [];
        bucket.push(task);
        statusMap.set(status, bucket);
      });
      statusOptions.forEach(opt => {
        result.push({
          id: opt.name,
          label: opt.name,
          color: opt.color || getStatusColor(opt.name),
          tasks: statusMap.get(opt.name) ?? []
        });
      });
    } else if (groupBy === 'priority') {
      const priorityMap: Record<string, Task[]> = {
        'do-now': [], 'schedule': [], 'delegate': [], 'eliminate': []
      };
      filteredTasks.forEach(task => {
        const key = getPriorityKey(task);
        priorityMap[key].push(task);
      });
      Object.entries(PRIORITY_CONFIG).forEach(([key, config]) => {
        result.push({
          id: key,
          label: config.label,
          color: config.color,
          icon: config.icon,
          tasks: priorityMap[key]
        });
      });
    } else if (groupBy === 'project') {
      const projectMap = new Map<string, Task[]>();
      projectMap.set('no-project', []);
      projects.forEach(p => projectMap.set(p.id, []));
      filteredTasks.forEach(task => {
        const taskProjects = task.projectIds ?? [];
        if (taskProjects.length === 0) {
          projectMap.get('no-project')?.push(task);
        } else {
          taskProjects.forEach(pid => {
            projectMap.get(pid)?.push(task);
          });
        }
      });
      // No project column
      const noProjectTasks = projectMap.get('no-project') ?? [];
      if (noProjectTasks.length > 0) {
        result.push({
          id: 'no-project',
          label: 'No Project',
          color: '#6b7280',
          icon: '📋',
          tasks: noProjectTasks
        });
      }
      // Project columns
      projects.forEach(p => {
        const projectTasks = projectMap.get(p.id) ?? [];
        result.push({
          id: p.id,
          label: p.title ?? 'Untitled',
          color: '#8b5cf6',
          icon: '📁',
          tasks: projectTasks
        });
      });
    } else if (groupBy === 'dueDate') {
      const dateMap: Record<string, Task[]> = {
        'overdue': [], 'today': [], 'tomorrow': [], 'this-week': [], 'later': [], 'no-date': []
      };
      filteredTasks.forEach(task => {
        const key = getDueDateKey(task);
        dateMap[key].push(task);
      });
      Object.entries(DUE_DATE_CONFIG).forEach(([key, config]) => {
        result.push({
          id: key,
          label: config.label,
          color: config.color,
          icon: config.icon,
          tasks: dateMap[key]
        });
      });
    }
    
    // Sort tasks within columns
    result.forEach(col => {
      col.tasks.sort((a, b) => {
        if (a.hardDeadline && !b.hardDeadline) return -1;
        if (!a.hardDeadline && b.hardDeadline) return 1;
        const dateA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const dateB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return dateA - dateB;
      });
    });
    
    return result;
  }, [filteredTasks, groupBy, statusOptions, projects]);

  // Sorted columns respecting user-defined order
  const sortedColumns = useMemo(() => {
    if (columnOrder.length === 0) return columns;
    
    // Create a map for quick lookup
    const columnMap = new Map(columns.map(col => [col.id, col]));
    
    // Build ordered list based on columnOrder, then add any columns not in order
    const orderedColumns: ColumnConfig[] = [];
    columnOrder.forEach(id => {
      const col = columnMap.get(id);
      if (col) {
        orderedColumns.push(col);
        columnMap.delete(id);
      }
    });
    
    // Add remaining columns that weren't in the order
    columnMap.forEach(col => orderedColumns.push(col));
    
    return orderedColumns;
  }, [columns, columnOrder]);

  // Initialize column order when columns change
  useEffect(() => {
    if (columns.length > 0 && columnOrder.length === 0) {
      setColumnOrder(columns.map(col => col.id));
    }
  }, [columns, columnOrder.length]);

  // Get all visible task IDs in order (for keyboard navigation)
  const allVisibleTaskIds = useMemo(() => {
    const ids: string[] = [];
    sortedColumns.forEach(col => {
      col.tasks.forEach(t => ids.push(t.id));
    });
    return ids;
  }, [sortedColumns]);

  const stats = useMemo(() => {
    const total = filteredTasks.length;
    const completed = tasks.filter(t => t.status === completedStatus).length;
    const inProgress = filteredTasks.filter(t => 
      t.status?.toLowerCase().includes('progress')
    ).length;
    return { total, completed, inProgress };
  }, [tasks, filteredTasks, completedStatus]);

  // Handle task click (single click to select)
  const handleTaskClick = useCallback((event: ReactMouseEvent, task: Task) => {
    const taskIndex = allVisibleTaskIds.indexOf(task.id);
    
    if (event.shiftKey && selectedTaskId) {
      // Shift+Click: Range selection
      const anchorIndex = selectionAnchorIndex !== -1 ? selectionAnchorIndex : allVisibleTaskIds.indexOf(selectedTaskId);
      if (anchorIndex !== -1 && taskIndex !== -1) {
        const start = Math.min(anchorIndex, taskIndex);
        const end = Math.max(anchorIndex, taskIndex);
        const newSelection = new Set<string>();
        for (let i = start; i <= end; i++) {
          newSelection.add(allVisibleTaskIds[i]);
        }
        setMultiSelectedIds(newSelection);
      }
    } else if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd+Click: Toggle individual selection
      const newSelection = new Set(multiSelectedIds);
      if (newSelection.has(task.id)) {
        newSelection.delete(task.id);
      } else {
        newSelection.add(task.id);
      }
      setMultiSelectedIds(newSelection);
      setSelectionAnchorIndex(taskIndex);
    } else {
      // Regular click: Single selection
      setSelectedTaskId(task.id);
      setMultiSelectedIds(new Set([task.id]));
      setSelectionAnchorIndex(taskIndex);
      setFocusedIndex(taskIndex);
      onSelectTask?.(task.id);
    }
  }, [selectedTaskId, selectionAnchorIndex, allVisibleTaskIds, multiSelectedIds, onSelectTask]);

  // Handle double click (open task popup)
  const handleTaskDoubleClick = useCallback((task: Task) => {
    onPopOutTask?.(task);
  }, [onPopOutTask]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!containerRef.current?.contains(document.activeElement) && 
          document.activeElement !== containerRef.current) return;
      
      const { key, shiftKey } = event;
      
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        event.preventDefault();
        const direction = key === 'ArrowUp' ? -1 : 1;
        let newIndex = focusedIndex + direction;
        
        if (newIndex < 0) newIndex = 0;
        if (newIndex >= allVisibleTaskIds.length) newIndex = allVisibleTaskIds.length - 1;
        
        if (newIndex >= 0 && newIndex < allVisibleTaskIds.length) {
          const newTaskId = allVisibleTaskIds[newIndex];
          
          if (shiftKey) {
            // Shift+Arrow: Extend selection
            const anchorIndex = selectionAnchorIndex !== -1 ? selectionAnchorIndex : focusedIndex;
            const start = Math.min(anchorIndex, newIndex);
            const end = Math.max(anchorIndex, newIndex);
            const newSelection = new Set<string>();
            for (let i = start; i <= end; i++) {
              newSelection.add(allVisibleTaskIds[i]);
            }
            setMultiSelectedIds(newSelection);
          } else {
            // Regular arrow: Move focus and select
            setSelectedTaskId(newTaskId);
            setMultiSelectedIds(new Set([newTaskId]));
            setSelectionAnchorIndex(newIndex);
            onSelectTask?.(newTaskId);
          }
          setFocusedIndex(newIndex);
        }
      } else if (key === 'Enter' && selectedTaskId) {
        // Enter: Open selected task
        const task = tasks.find(t => t.id === selectedTaskId);
        if (task) onPopOutTask?.(task);
      } else if (key === 'Escape') {
        // Escape: Clear selection
        setSelectedTaskId(null);
        setMultiSelectedIds(new Set());
        setFocusedIndex(-1);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [focusedIndex, allVisibleTaskIds, selectedTaskId, selectionAnchorIndex, tasks, onSelectTask, onPopOutTask]);

  // Drag handlers
  const handleDragStart = useCallback((task: Task, event: ReactDragEvent) => {
    setDraggedTaskId(task.id);
    event.dataTransfer.setData('application/x-task-id', task.id);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedTaskId(null);
    setDropTarget(null);
  }, []);

  const handleDragOver = useCallback((columnId: string, event: ReactDragEvent) => {
    // Accept both internal drags and external drags (from task list, calendar, etc.)
    const hasTaskData = event.dataTransfer.types.includes('application/x-task-id');
    if (!draggedTaskId && !hasTaskData) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(columnId);
  }, [draggedTaskId]);

  const handleDragLeave = useCallback(() => setDropTarget(null), []);

  const handleDrop = useCallback(async (columnId: string, event: ReactDragEvent) => {
    event.preventDefault();
    setDropTarget(null);
    
    // Handle new task drop
    const newTaskData = event.dataTransfer.getData('application/x-new-task');
    if (newTaskData && onAddTask) {
      try {
        const payload = JSON.parse(newTaskData);
        
        // Set properties based on groupBy and column
        if (groupBy === 'status') {
          payload.status = columnId;
        } else if (groupBy === 'priority') {
          payload.urgent = columnId === 'do-now' || columnId === 'delegate';
          payload.important = columnId === 'do-now' || columnId === 'schedule';
        } else if (groupBy === 'dueDate') {
          // Set due date based on column
          const today = new Date();
          if (columnId === 'today') {
            payload.date = today.toISOString().slice(0, 10);
          } else if (columnId === 'tomorrow') {
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            payload.date = tomorrow.toISOString().slice(0, 10);
          } else if (columnId === 'this-week') {
            const endOfWeek = new Date(today);
            endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
            payload.date = endOfWeek.toISOString().slice(0, 10);
          } else if (columnId === 'no-date') {
            payload.date = undefined;
          }
        } else if (groupBy === 'project' && columnId !== 'no-project') {
          payload.projectIds = [columnId];
        }
        
        await onAddTask(payload);
        return;
      } catch (error) {
        console.error('Failed to create task:', error);
      }
    }
    
    if (!onUpdateTask) return;
    
    // Get task ID from either internal state or external data transfer
    const taskId = draggedTaskId || event.dataTransfer.getData('application/x-task-id');
    if (!taskId) return;
    
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    // Update based on groupBy
    try {
      if (groupBy === 'status') {
        if (task.status === columnId) return;
        await onUpdateTask(taskId, { status: columnId });
      } else if (groupBy === 'priority') {
        const config = PRIORITY_CONFIG[columnId];
        if (!config) return;
        const urgent = columnId === 'do-now' || columnId === 'delegate';
        const important = columnId === 'do-now' || columnId === 'schedule';
        await onUpdateTask(taskId, { urgent, important });
      }
      // For dueDate and project groupings, we don't update anything on drop
      // (could add project assignment or date changes in the future)
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  }, [draggedTaskId, tasks, onUpdateTask, onAddTask, groupBy]);

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

  // Persist layout mode
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem('kanban.layoutMode', layoutMode);
  }, [layoutMode]);

  const renderTaskCard = (task: Task) => {
    const isComplete = task.status === completedStatus;
    const isDragging = draggedTaskId === task.id;
    const dueDate = formatDate(task.dueDate);
    const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && !isComplete;
    const priority = getPriorityKey(task);
    const isSelected = multiSelectedIds.has(task.id);
    const isFocused = allVisibleTaskIds[focusedIndex] === task.id;
    
    return (
      <div
        key={task.id}
        className={`kanban-card ${isComplete ? 'is-complete' : ''} ${isDragging ? 'is-dragging' : ''} ${isSelected ? 'is-selected' : ''} ${isFocused ? 'is-focused' : ''} ${task.hardDeadline ? 'has-hard-deadline' : ''}`}
        draggable={groupBy === 'status' || groupBy === 'priority'}
        onDragStart={(e) => handleDragStart(task, e)}
        onDragEnd={handleDragEnd}
        onClick={(e) => handleTaskClick(e, task)}
        onDoubleClick={() => handleTaskDoubleClick(task)}
        tabIndex={0}
      >
        <div className="kanban-card-header">
          <span className={`kanban-card-priority-dot priority-${priority}`} title={PRIORITY_CONFIG[priority].label} />
          <span className="kanban-card-title">{task.title}</span>
        </div>
        {(dueDate || task.status) && (
          <div className="kanban-card-footer">
            {dueDate && (
              <span className={`kanban-card-date ${isOverdue ? 'is-overdue' : ''}`}>
                {dueDate}
              </span>
            )}
            {groupBy !== 'status' && task.status && (
              <span className="kanban-card-status" style={{ '--status-color': getStatusColor(task.status) } as React.CSSProperties}>
                {task.status}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  // Column drag handlers
  const handleColumnDragStart = useCallback((columnId: string, event: ReactDragEvent) => {
    event.stopPropagation();
    setDraggedColumnId(columnId);
    event.dataTransfer.setData('application/x-kanban-column', columnId);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleColumnDragEnd = useCallback(() => {
    setDraggedColumnId(null);
    setColumnDropTarget(null);
  }, []);

  const handleColumnDragOver = useCallback((columnId: string, event: ReactDragEvent) => {
    if (!draggedColumnId || draggedColumnId === columnId) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setColumnDropTarget(columnId);
  }, [draggedColumnId]);

  const handleColumnDrop = useCallback((targetColumnId: string, event: ReactDragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    if (!draggedColumnId || draggedColumnId === targetColumnId) {
      setColumnDropTarget(null);
      setDraggedColumnId(null);
      return;
    }
    
    setColumnOrder(prev => {
      const currentOrder = prev.length > 0 ? prev : sortedColumns.map(c => c.id);
      const fromIndex = currentOrder.indexOf(draggedColumnId);
      const toIndex = currentOrder.indexOf(targetColumnId);
      
      if (fromIndex === -1 || toIndex === -1) return currentOrder;
      
      const newOrder = [...currentOrder];
      newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, draggedColumnId);
      return newOrder;
    });
    
    setColumnDropTarget(null);
    setDraggedColumnId(null);
  }, [draggedColumnId, sortedColumns]);

  const renderColumn = (column: ColumnConfig, index: number) => {
    const isDropTarget = dropTarget === column.id;
    const isCollapsed = collapsedColumns.has(column.id);
    const canDrop = groupBy === 'status' || groupBy === 'priority';
    const columnWidth = isCollapsed ? 60 : (columnWidths[column.id] || DEFAULT_COLUMN_WIDTH);
    const isResizing = resizingColumn === column.id;
    const isDraggingColumn = draggedColumnId === column.id;
    const isColumnDropTarget = columnDropTarget === column.id;
    
    return (
      <div
        key={column.id}
        className={`kanban-column ${isDropTarget ? 'is-drop-target' : ''} ${isCollapsed ? 'is-collapsed' : ''} ${isResizing ? 'is-resizing' : ''} ${isDraggingColumn ? 'is-column-dragging' : ''} ${isColumnDropTarget ? 'is-column-drop-target' : ''}`}
        style={{ width: columnWidth, minWidth: isCollapsed ? 60 : MIN_COLUMN_WIDTH, maxWidth: isCollapsed ? 60 : MAX_COLUMN_WIDTH }}
        onDragOver={(e) => {
          // Handle column reorder drop target
          if (draggedColumnId && draggedColumnId !== column.id) {
            handleColumnDragOver(column.id, e);
          } else if (canDrop) {
            handleDragOver(column.id, e);
          }
        }}
        onDragLeave={(e) => {
          if (draggedColumnId) {
            setColumnDropTarget(null);
          } else if (canDrop) {
            handleDragLeave();
          }
        }}
        onDrop={(e) => {
          if (draggedColumnId) {
            handleColumnDrop(column.id, e);
          } else if (canDrop) {
            handleDrop(column.id, e);
          }
        }}
      >
        <div 
          className="kanban-column-header"
          style={{ '--column-color': column.color } as React.CSSProperties}
          draggable
          onDragStart={(e) => handleColumnDragStart(column.id, e)}
          onDragEnd={handleColumnDragEnd}
          onClick={(e) => {
            // Don't toggle collapse if we just finished dragging
            if (!draggedColumnId) {
              toggleColumnCollapse(column.id);
            }
          }}
        >
          <span className="kanban-column-drag-handle" title="Drag to reorder">⋮⋮</span>
          <span className="kanban-column-indicator" />
          {column.icon && <span className="kanban-column-icon">{column.icon}</span>}
          <span className="kanban-column-title">{column.label}</span>
          <span className="kanban-column-count">{column.tasks.length}</span>
          <button type="button" className="kanban-column-collapse" aria-label={isCollapsed ? 'Expand' : 'Collapse'}>
            {isCollapsed ? '▶' : '▼'}
          </button>
        </div>
        {!isCollapsed && (
          <div className="kanban-column-body">
            {column.tasks.length === 0 ? (
              <div className="kanban-column-empty">
                {canDrop ? 'Drop tasks here' : 'No tasks'}
              </div>
            ) : (
              column.tasks.map(renderTaskCard)
            )}
          </div>
        )}
        {/* Resize handle - only show when not collapsed and not the last column */}
        {!isCollapsed && index < sortedColumns.length - 1 && (
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
      className={`kanban-board ${project ? 'has-project' : ''} ${hideToolbar ? 'no-toolbar' : ''}`}
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
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')}>✕</button>
              )}
            </div>
            
            {/* Group by selector */}
            <div className="kanban-group-selector">
              <label>Group:</label>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                <option value="status">Status</option>
                <option value="priority">Priority</option>
                <option value="dueDate">Due Date</option>
                {projects.length > 0 && <option value="project">Project</option>}
              </select>
            </div>
            
            {/* Project filter */}
            {!project && projects.length > 0 && (
              <div className="kanban-filter">
                <select value={filterProject || ''} onChange={(e) => setFilterProject(e.target.value || null)}>
                  <option value="">All Projects</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.title ?? 'Untitled'}</option>
                  ))}
                </select>
              </div>
            )}
            
            {/* Show completed toggle switch */}
            <button
              type="button"
              className={`toggle-switch ${showCompleted ? 'is-active' : ''}`}
              onClick={() => setShowCompleted(!showCompleted)}
              aria-pressed={showCompleted}
              title={showCompleted ? 'Hide completed tasks' : 'Show completed tasks'}
            >
              <span className="toggle-switch-track">
                <span className="toggle-switch-thumb" />
              </span>
              <span className="toggle-switch-label">Done</span>
            </button>
            
            {/* Layout toggle */}
            <div className="kanban-layout-toggle">
              <button
                type="button"
                className={`layout-toggle-btn ${layoutMode === 'horizontal' ? 'is-active' : ''}`}
                onClick={() => setLayoutMode('horizontal')}
                title="Horizontal layout (columns)"
              >
                ▥
              </button>
              <button
                type="button"
                className={`layout-toggle-btn ${layoutMode === 'vertical' ? 'is-active' : ''}`}
                onClick={() => setLayoutMode('vertical')}
                title="Vertical layout (rows)"
              >
                ☰
              </button>
            </div>
          </div>
          
          <div className="kanban-toolbar-right">
            {multiSelectedIds.size > 1 && (
              <span className="kanban-selection-count">{multiSelectedIds.size} selected</span>
            )}
            <div className="kanban-stats">
              <span className="kanban-stat"><strong>{stats.total}</strong> total</span>
              <span className="kanban-stat progress"><strong>{stats.inProgress}</strong> active</span>
              <span className="kanban-stat done"><strong>{stats.completed}</strong> done</span>
            </div>
            {onClose && (
              <button type="button" className="kanban-close-btn" onClick={onClose}>✕</button>
            )}
          </div>
        </div>
      )}

      {/* Columns */}
      <div className={`kanban-columns ${resizingColumn ? 'is-resizing' : ''} ${draggedColumnId ? 'is-column-dragging' : ''} ${layoutMode === 'vertical' ? 'is-vertical' : ''}`}>
        {sortedColumns.map((col, idx) => renderColumn(col, idx))}
      </div>
    </div>
  );
};

export default KanbanBoard;
