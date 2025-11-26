import React, { useCallback, useState, useRef, useEffect } from 'react';
import type { Task, TaskStatusOption, TaskUpdatePayload } from '@shared/types';
import type { GroupingOption, TaskGroup } from '../utils/sorting';
import SwipeableTaskRow from '../components/SwipeableTaskRow';
import DateField from '../components/DateField';

interface Props {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  statusOptions: TaskStatusOption[];
  completedStatus?: string;
  onUpdateTask: (taskId: string, updates: TaskUpdatePayload) => Promise<Task | void>;
  emptyMessage?: string;
  grouping?: GroupingOption;
  groups?: TaskGroup[];
  onTaskTap?: (task: Task) => void;
}

const MobileTaskList: React.FC<Props> = ({
  tasks,
  loading,
  error,
  statusOptions,
  completedStatus,
  onUpdateTask,
  emptyMessage = 'No tasks',
  grouping = 'none',
  groups,
  onTaskTap
}) => {
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [dragY, setDragY] = useState(0);
  const [dragStartY, setDragStartY] = useState(0);
  const [taskOrder, setTaskOrder] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  // Initialize task order when tasks change
  useEffect(() => {
    setTaskOrder(tasks.map((t) => t.id));
  }, [tasks]);

  // Get the display list based on whether we're using groups
  const displayTasks = grouping !== 'none' && groups ? [] : tasks;
  const hasGroups = grouping !== 'none' && groups && groups.length > 0;

  // Handle drag start
  const handleDragStart = useCallback((task: Task, y: number) => {
    setDraggedTask(task);
    setDragStartY(y);
    setDragY(0);
  }, []);

  // Handle drag move
  const handleDragMove = useCallback((y: number) => {
    if (!draggedTask) return;
    setDragY(y - dragStartY);
  }, [draggedTask, dragStartY]);

  // Handle drag end - reorder tasks
  const handleDragEnd = useCallback(async () => {
    if (!draggedTask) return;

    // Calculate new position based on drag offset
    const currentIndex = taskOrder.indexOf(draggedTask.id);
    const itemHeight = 70; // Approximate row height
    const moveBy = Math.round(dragY / itemHeight);
    const newIndex = Math.max(0, Math.min(taskOrder.length - 1, currentIndex + moveBy));

    if (newIndex !== currentIndex) {
      // Reorder the task list
      const newOrder = [...taskOrder];
      newOrder.splice(currentIndex, 1);
      newOrder.splice(newIndex, 0, draggedTask.id);
      setTaskOrder(newOrder);

      // Could emit reorder event here for backend sync
      console.log('[MobileTaskList] Task reordered:', draggedTask.id, 'from', currentIndex, 'to', newIndex);
    }

    setDraggedTask(null);
    setDragY(0);
  }, [draggedTask, dragY, taskOrder]);

  // Get sorted tasks based on current order
  const sortedTasks = taskOrder
    .map((id) => tasks.find((t) => t.id === id))
    .filter((t): t is Task => t !== undefined);

  // Render a single task row
  const renderTaskRow = (task: Task, index: number) => {
    const isCompleted = task.status?.toLowerCase() === completedStatus?.toLowerCase();
    const isDragging = draggedTask?.id === task.id;
    
    // Calculate drag offset for this item
    let dragOffset = 0;
    if (draggedTask && !isDragging) {
      const draggedIndex = taskOrder.indexOf(draggedTask.id);
      const currentIndex = taskOrder.indexOf(task.id);
      const itemHeight = 70;
      const draggedNewIndex = Math.round(dragY / itemHeight) + draggedIndex;
      
      if (draggedIndex < currentIndex && draggedNewIndex >= currentIndex) {
        dragOffset = -itemHeight;
      } else if (draggedIndex > currentIndex && draggedNewIndex <= currentIndex) {
        dragOffset = itemHeight;
      }
    }

    return (
      <SwipeableTaskRow
        key={task.id}
        task={task}
        completedStatus={completedStatus}
        onUpdateTask={onUpdateTask}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        isDragging={isDragging}
        dragOffset={isDragging ? dragY : dragOffset}
      >
        <div
          className={`mobile-task-row ${isCompleted ? 'completed' : ''}`}
          onClick={() => onTaskTap?.(task)}
        >
          {/* Complete toggle */}
          <button
            className={`mobile-task-toggle ${isCompleted ? 'checked' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              const newStatus = isCompleted ? 'To-do' : completedStatus;
              if (newStatus) {
                onUpdateTask(task.id, { status: newStatus });
              }
            }}
          >
            {isCompleted ? '✓' : ''}
          </button>

          {/* Task content */}
          <div className="mobile-task-content">
            <div className="mobile-task-title">{task.title}</div>
            
            <div className="mobile-task-meta">
              {/* Due date */}
              {task.dueDate && (
                <span className={`mobile-task-date ${task.hardDeadline ? 'hard' : ''}`}>
                  📅 {new Date(task.dueDate).toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric' 
                  })}
                </span>
              )}
              
              {/* Status */}
              {task.status && !isCompleted && (
                <span className="mobile-task-status">{task.status}</span>
              )}
              
              {/* Priority indicators */}
              {task.urgent && <span className="mobile-task-badge urgent">🔥</span>}
              {task.important && <span className="mobile-task-badge important">⭐</span>}
            </div>
          </div>

          {/* Drag handle indicator */}
          <div className="mobile-task-drag-handle">
            <span>⋮⋮</span>
          </div>
        </div>
      </SwipeableTaskRow>
    );
  };

  // Render group
  const renderGroup = (group: TaskGroup) => {
    return (
      <div key={group.id} className="mobile-task-group">
        <div className="mobile-task-group-header">
          <span className="mobile-task-group-label">{group.label}</span>
          <span className="mobile-task-group-count">{group.tasks.length}</span>
        </div>
        <div className="mobile-task-group-tasks">
          {group.tasks.map((task, index) => renderTaskRow(task, index))}
        </div>
      </div>
    );
  };

  if (loading && tasks.length === 0) {
    return (
      <div className="mobile-task-list-loading">
        <div className="mobile-loading-spinner" />
        <p>Loading tasks...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mobile-task-list-error">
        <p>{error}</p>
      </div>
    );
  }

  const tasksToRender = hasGroups ? [] : sortedTasks;
  const isEmpty = !hasGroups && tasksToRender.length === 0;

  return (
    <div className="mobile-task-list" ref={listRef}>
      {/* Swipe hint - show only if there are tasks */}
      {!isEmpty && (
        <div className="mobile-swipe-hint">
          <span><span className="hint-arrow">←</span> Swipe to complete</span>
          <span>Hold to reorder <span className="hint-arrow">↕</span></span>
        </div>
      )}

      {/* Grouped view */}
      {hasGroups && groups!.map(renderGroup)}

      {/* Flat view */}
      {!hasGroups && tasksToRender.map((task, index) => renderTaskRow(task, index))}

      {/* Empty state */}
      {isEmpty && (
        <div className="mobile-task-list-empty">
          <p>{emptyMessage}</p>
        </div>
      )}
    </div>
  );
};

export default MobileTaskList;


