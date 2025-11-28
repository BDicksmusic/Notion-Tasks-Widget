import React, { useCallback, useRef, useState, useEffect } from 'react';
import type { Task, TaskUpdatePayload } from '@shared/types';

interface Props {
  task: Task;
  completedStatus?: string;
  onUpdateTask: (taskId: string, updates: TaskUpdatePayload) => Promise<Task | void>;
  onLongPress?: (task: Task) => void;
  onDragStart?: (task: Task, y: number) => void;
  onDragMove?: (y: number) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  dragOffset?: number;
  children: React.ReactNode;
}

const SWIPE_THRESHOLD = 80; // Minimum swipe distance to trigger action
const LONG_PRESS_DURATION = 500; // ms before long press triggers

export const SwipeableTaskRow: React.FC<Props> = ({
  task,
  completedStatus,
  onUpdateTask,
  onLongPress,
  onDragStart,
  onDragMove,
  onDragEnd,
  isDragging,
  dragOffset = 0,
  children
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [translateX, setTranslateX] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [actionRevealed, setActionRevealed] = useState<'left' | 'right' | null>(null);
  
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressing = useRef(false);
  const hasMovedSignificantly = useRef(false);

  // Clear long press timer
  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    isLongPressing.current = false;
  }, []);

  // Handle touch start
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
    touchStartTime.current = Date.now();
    hasMovedSignificantly.current = false;
    setIsAnimating(false);

    // Set up long press timer for drag
    if (onLongPress || onDragStart) {
      longPressTimer.current = setTimeout(() => {
        if (!hasMovedSignificantly.current) {
          isLongPressing.current = true;
          onLongPress?.(task);
          onDragStart?.(task, touch.clientY);
          // Haptic feedback if available
          if ('vibrate' in navigator) {
            navigator.vibrate(50);
          }
        }
      }, LONG_PRESS_DURATION);
    }
  }, [task, onLongPress, onDragStart]);

  // Handle touch move
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartX.current;
    const deltaY = touch.clientY - touchStartY.current;

    // If we're in drag mode, handle vertical movement
    if (isLongPressing.current && onDragMove) {
      e.preventDefault();
      onDragMove(touch.clientY);
      return;
    }

    // Check if moved significantly (more than 10px in any direction)
    if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
      hasMovedSignificantly.current = true;
      clearLongPress();
    }

    // If vertical movement is larger, don't interfere with scrolling
    if (Math.abs(deltaY) > Math.abs(deltaX)) {
      return;
    }

    // Prevent default to stop scrolling during horizontal swipe
    if (Math.abs(deltaX) > 15) {
      e.preventDefault();
    }

    // Apply resistance at edges
    let newTranslateX = deltaX;
    if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
      const excess = Math.abs(deltaX) - SWIPE_THRESHOLD;
      const direction = deltaX > 0 ? 1 : -1;
      newTranslateX = direction * (SWIPE_THRESHOLD + excess * 0.3);
    }

    setTranslateX(newTranslateX);
    
    // Update revealed action indicator
    if (newTranslateX < -SWIPE_THRESHOLD * 0.5) {
      setActionRevealed('left'); // Swiped left - complete
    } else if (newTranslateX > SWIPE_THRESHOLD * 0.5) {
      setActionRevealed('right'); // Swiped right - options
    } else {
      setActionRevealed(null);
    }
  }, [clearLongPress, onDragMove]);

  // Handle touch end
  const handleTouchEnd = useCallback(async () => {
    clearLongPress();

    // If we were dragging, end the drag
    if (isLongPressing.current) {
      isLongPressing.current = false;
      onDragEnd?.();
      return;
    }

    const currentTranslateX = translateX;
    
    // Animate back to center
    setIsAnimating(true);
    setTranslateX(0);
    setActionRevealed(null);

    // Check if swipe was far enough to trigger action
    if (currentTranslateX < -SWIPE_THRESHOLD) {
      // Swiped left - Complete task
      const isCompleted = task.status?.toLowerCase() === completedStatus?.toLowerCase();
      const newStatus = isCompleted ? 'To-do' : completedStatus;
      if (newStatus) {
        try {
          await onUpdateTask(task.id, { status: newStatus });
          // Haptic feedback
          if ('vibrate' in navigator) {
            navigator.vibrate([50, 50, 50]);
          }
        } catch (err) {
          console.error('Failed to update task:', err);
        }
      }
    } else if (currentTranslateX > SWIPE_THRESHOLD) {
      // Swiped right - Could be used for other actions
      // For now, let's make it trigger edit mode or focus
      if ('vibrate' in navigator) {
        navigator.vibrate(30);
      }
      // Could emit an event here for edit mode
    }
  }, [translateX, task, completedStatus, onUpdateTask, clearLongPress, onDragEnd]);

  // Clean up long press timer on unmount
  useEffect(() => {
    return () => {
      clearLongPress();
    };
  }, [clearLongPress]);

  const isCompleted = task.status?.toLowerCase() === completedStatus?.toLowerCase();

  return (
    <div 
      ref={containerRef}
      className={`swipeable-task-row ${isDragging ? 'dragging' : ''}`}
      style={{
        transform: isDragging && dragOffset !== 0 ? `translateY(${dragOffset}px)` : undefined,
        zIndex: isDragging ? 1000 : undefined
      }}
    >
      {/* Left action (complete) - revealed when swiping left */}
      <div className={`swipe-action swipe-action-left ${actionRevealed === 'left' ? 'active' : ''}`}>
        <span className="swipe-action-icon">
          {isCompleted ? '↩️' : '✓'}
        </span>
        <span className="swipe-action-label">
          {isCompleted ? 'Undo' : 'Done'}
        </span>
      </div>

      {/* Right action (options) - revealed when swiping right */}
      <div className={`swipe-action swipe-action-right ${actionRevealed === 'right' ? 'active' : ''}`}>
        <span className="swipe-action-icon">✏️</span>
        <span className="swipe-action-label">Edit</span>
      </div>

      {/* Main content */}
      <div
        ref={contentRef}
        className="swipeable-task-content"
        style={{
          transform: `translateX(${translateX}px)`,
          transition: isAnimating ? 'transform 0.25s ease-out' : 'none'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
};

export default SwipeableTaskRow;



