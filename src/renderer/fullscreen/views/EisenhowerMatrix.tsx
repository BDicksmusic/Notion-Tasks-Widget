import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Task, TaskUpdatePayload, Project, NotionCreatePayload } from '@shared/types';

interface EisenhowerMatrixProps {
  tasks: Task[];
  projects: Project[];
  completedStatus?: string;
  selectedProjectId?: string | null;
  onSelectProject?: (projectId: string | null) => void;
  onUpdateTask?: (taskId: string, updates: TaskUpdatePayload) => Promise<void>;
  onAddTask?: (payload: NotionCreatePayload) => Promise<void>;
  onSelectTask?: (taskId: string) => void;
  onPopOutTask?: (task: Task) => void;
}

type MatrixQuadrant = 'do-now' | 'schedule' | 'delegate' | 'eliminate';

interface QuadrantConfig {
  id: MatrixQuadrant;
  title: string;
  shortTitle: string;
  urgent: boolean;
  important: boolean;
  color: string;
  bgColor: string;
}

const QUADRANTS: QuadrantConfig[] = [
  {
    id: 'do-now',
    title: 'Do First',
    shortTitle: 'DO',
    urgent: true,
    important: true,
    color: '#ef4444',
    bgColor: 'rgba(239, 68, 68, 0.08)'
  },
  {
    id: 'schedule',
    title: 'Schedule',
    shortTitle: 'PLAN',
    urgent: false,
    important: true,
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.08)'
  },
  {
    id: 'delegate',
    title: 'Delegate',
    shortTitle: 'ASSIGN',
    urgent: true,
    important: false,
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.08)'
  },
  {
    id: 'eliminate',
    title: 'Eliminate',
    shortTitle: 'DROP',
    urgent: false,
    important: false,
    color: '#6b7280',
    bgColor: 'rgba(107, 114, 128, 0.08)'
  }
];

const getQuadrant = (task: Task): MatrixQuadrant => {
  const urgent = Boolean(task.urgent);
  const important = Boolean(task.important);
  
  if (urgent && important) return 'do-now';
  if (!urgent && important) return 'schedule';
  if (urgent && !important) return 'delegate';
  return 'eliminate';
};

const EisenhowerMatrix = ({
  tasks,
  projects,
  completedStatus,
  selectedProjectId,
  onSelectProject,
  onUpdateTask,
  onAddTask,
  onSelectTask,
  onPopOutTask
}: EisenhowerMatrixProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<MatrixQuadrant | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [activeFilter, setActiveFilter] = useState<MatrixQuadrant | null>(null);
  
  // Selection state (like TaskList)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  const [selectionAnchorIndex, setSelectionAnchorIndex] = useState<number>(-1);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // Filter tasks by project if selected
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
    
    return result;
  }, [tasks, selectedProjectId, showCompleted, completedStatus]);

  // Get all visible task IDs in order (for keyboard navigation)
  const allVisibleTaskIds = useMemo(() => {
    const ids: string[] = [];
    QUADRANTS.forEach(q => {
      const quadrantTasks = filteredTasks.filter(t => getQuadrant(t) === q.id);
      quadrantTasks.forEach(t => ids.push(t.id));
    });
    return ids;
  }, [filteredTasks]);

  // Group tasks by quadrant
  const tasksByQuadrant = useMemo(() => {
    const groups: Record<MatrixQuadrant, Task[]> = {
      'do-now': [],
      'schedule': [],
      'delegate': [],
      'eliminate': []
    };
    
    filteredTasks.forEach((task) => {
      const quadrant = getQuadrant(task);
      groups[quadrant].push(task);
    });
    
    // Sort each quadrant by due date
    Object.values(groups).forEach((group) => {
      group.sort((a, b) => {
        if (a.hardDeadline && !b.hardDeadline) return -1;
        if (!a.hardDeadline && b.hardDeadline) return 1;
        const dateA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const dateB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return dateA - dateB;
      });
    });
    
    return groups;
  }, [filteredTasks]);

  // Calculate counts
  const counts = useMemo(() => {
    return {
      'do-now': tasksByQuadrant['do-now'].length,
      'schedule': tasksByQuadrant['schedule'].length,
      'delegate': tasksByQuadrant['delegate'].length,
      'eliminate': tasksByQuadrant['eliminate'].length,
      total: filteredTasks.length
    };
  }, [tasksByQuadrant, filteredTasks]);
  
  // Calculate axis counts
  const urgentCount = counts['do-now'] + counts['delegate'];
  const notUrgentCount = counts['schedule'] + counts['eliminate'];
  const importantCount = counts['do-now'] + counts['schedule'];
  const notImportantCount = counts['delegate'] + counts['eliminate'];

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

  const handleDragOver = useCallback((quadrant: MatrixQuadrant, event: ReactDragEvent) => {
    // Accept both internal drags and external drags (from task list, calendar, etc.)
    const hasTaskData = event.dataTransfer.types.includes('application/x-task-id');
    if (!draggedTaskId && !hasTaskData) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(quadrant);
  }, [draggedTaskId]);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(async (quadrant: MatrixQuadrant, event: ReactDragEvent) => {
    event.preventDefault();
    setDropTarget(null);
    
    const config = QUADRANTS.find((q) => q.id === quadrant);
    if (!config) return;
    
    // Handle new task drop
    const newTaskData = event.dataTransfer.getData('application/x-new-task');
    if (newTaskData && onAddTask) {
      try {
        const payload = JSON.parse(newTaskData);
        payload.urgent = config.urgent;
        payload.important = config.important;
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
    
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    
    const currentQuadrant = getQuadrant(task);
    if (currentQuadrant === quadrant) return;
    
    try {
      await onUpdateTask(taskId, {
        urgent: config.urgent,
        important: config.important
      });
    } catch (error) {
      console.error('Failed to update task quadrant', error);
    }
  }, [draggedTaskId, tasks, onUpdateTask, onAddTask]);

  // Quick toggle handlers
  const handleToggleUrgent = useCallback(async (task: Task, event: ReactMouseEvent) => {
    event.stopPropagation();
    if (!onUpdateTask) return;
    try {
      await onUpdateTask(task.id, { urgent: !task.urgent });
    } catch (error) {
      console.error('Failed to toggle urgent', error);
    }
  }, [onUpdateTask]);

  const handleToggleImportant = useCallback(async (task: Task, event: ReactMouseEvent) => {
    event.stopPropagation();
    if (!onUpdateTask) return;
    try {
      await onUpdateTask(task.id, { important: !task.important });
    } catch (error) {
      console.error('Failed to toggle important', error);
    }
  }, [onUpdateTask]);

  const renderTaskCard = (task: Task) => {
    const isComplete = task.status === completedStatus;
    const isDragging = draggedTaskId === task.id;
    const isSelected = multiSelectedIds.has(task.id);
    const isFocused = allVisibleTaskIds[focusedIndex] === task.id;
    const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && !isComplete;
    
    return (
      <div
        key={task.id}
        className={`matrix-task ${isComplete ? 'is-complete' : ''} ${isDragging ? 'is-dragging' : ''} ${isSelected ? 'is-selected' : ''} ${isFocused ? 'is-focused' : ''} ${task.hardDeadline ? 'has-hard-deadline' : ''}`}
        draggable
        onDragStart={(e) => handleDragStart(task, e)}
        onDragEnd={handleDragEnd}
        onClick={(e) => handleTaskClick(e, task)}
        onDoubleClick={() => handleTaskDoubleClick(task)}
        tabIndex={0}
      >
        {/* Quick toggles */}
        <div className="matrix-task-toggles">
          <button
            type="button"
            className={`matrix-toggle urgent ${task.urgent ? 'is-active' : ''}`}
            onClick={(e) => handleToggleUrgent(task, e)}
            title={task.urgent ? 'Mark as not urgent' : 'Mark as urgent'}
          >
            ⚡
          </button>
          <button
            type="button"
            className={`matrix-toggle important ${task.important ? 'is-active' : ''}`}
            onClick={(e) => handleToggleImportant(task, e)}
            title={task.important ? 'Mark as not important' : 'Mark as important'}
          >
            ★
          </button>
        </div>
        
        <div className="matrix-task-content">
          <span className="matrix-task-title">{task.title}</span>
          {(task.dueDate || task.status) && (
            <div className="matrix-task-meta">
              {task.dueDate && (
                <span className={`matrix-task-date ${isOverdue ? 'is-overdue' : ''}`}>
                  {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderQuadrant = (config: QuadrantConfig, position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => {
    const quadrantTasks = tasksByQuadrant[config.id];
    const isDropTarget = dropTarget === config.id;
    const isFiltered = activeFilter === config.id;
    const count = counts[config.id];
    
    return (
      <div
        key={config.id}
        className={`matrix-quadrant ${config.id} ${position} ${isDropTarget ? 'is-drop-target' : ''} ${isFiltered ? 'is-expanded' : ''}`}
        style={{ '--quadrant-color': config.color, '--quadrant-bg': config.bgColor } as React.CSSProperties}
        onDragOver={(e) => handleDragOver(config.id, e)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(config.id, e)}
      >
        <div 
          className="matrix-quadrant-header"
          onClick={() => setActiveFilter(isFiltered ? null : config.id)}
        >
          <span className="matrix-quadrant-title">{config.title}</span>
          <span className="matrix-quadrant-count">{count}</span>
          {isFiltered && (
            <button type="button" className="matrix-quadrant-close" onClick={(e) => { e.stopPropagation(); setActiveFilter(null); }}>
              ✕
            </button>
          )}
        </div>
        <div className="matrix-quadrant-tasks">
          {quadrantTasks.length === 0 ? (
            <div className="matrix-quadrant-empty">
              <span>Drop tasks here</span>
            </div>
          ) : (
            quadrantTasks.map(renderTaskCard)
          )}
        </div>
      </div>
    );
  };

  return (
    <div 
      className={`matrix-container ${activeFilter ? 'has-filter' : ''}`}
      ref={containerRef}
      tabIndex={-1}
    >
      {/* Compact header */}
      <div className="matrix-header">
        <div className="matrix-header-left">
          <label className="matrix-toggle-completed">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
            />
            <span>Done</span>
          </label>
          {multiSelectedIds.size > 1 && (
            <span className="matrix-selection-count">{multiSelectedIds.size} selected</span>
          )}
        </div>
        <div className="matrix-header-right">
          {/* Quick filter buttons */}
          <div className="matrix-quick-filters">
            {QUADRANTS.map((q) => (
              <button
                key={q.id}
                type="button"
                className={`matrix-quick-filter ${activeFilter === q.id ? 'is-active' : ''}`}
                style={{ '--filter-color': q.color } as React.CSSProperties}
                onClick={() => setActiveFilter(activeFilter === q.id ? null : q.id)}
              >
                <span className="matrix-quick-filter-count">{counts[q.id]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Matrix with axis labels */}
      <div className="matrix-grid-container">
        {/* Column labels: URGENT | NOT URGENT */}
        <div className="matrix-col-labels">
          <div className="matrix-col-label urgent">
            <span className="matrix-axis-icon">⚡</span>
            <span className="matrix-axis-text">Urgent</span>
            <span className="matrix-axis-count">{urgentCount}</span>
          </div>
          <div className="matrix-col-label not-urgent">
            <span className="matrix-axis-icon">📅</span>
            <span className="matrix-axis-text">Not Urgent</span>
            <span className="matrix-axis-count">{notUrgentCount}</span>
          </div>
        </div>
        
        {/* Row labels + Grid */}
        <div className="matrix-row-wrapper">
          {/* Row labels: IMPORTANT | NOT IMPORTANT */}
          <div className="matrix-row-labels">
            <div className="matrix-row-label important">
              <span className="matrix-axis-icon">★</span>
              <span className="matrix-axis-text">Important</span>
              <span className="matrix-axis-count">{importantCount}</span>
            </div>
            <div className="matrix-row-label not-important">
              <span className="matrix-axis-icon">○</span>
              <span className="matrix-axis-text">Not Important</span>
              <span className="matrix-axis-count">{notImportantCount}</span>
            </div>
          </div>
          
          {/* 2x2 Grid */}
          <div className="matrix-grid-2x2">
            {renderQuadrant(QUADRANTS[0], 'top-left')}
            {renderQuadrant(QUADRANTS[1], 'top-right')}
            {renderQuadrant(QUADRANTS[2], 'bottom-left')}
            {renderQuadrant(QUADRANTS[3], 'bottom-right')}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EisenhowerMatrix;
