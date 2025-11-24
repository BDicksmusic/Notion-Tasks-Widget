import { useEffect, useRef, useState } from 'react';
import type { Task, TimeLogEntryPayload } from '@shared/types';

interface TimerState {
  taskId: string;
  startTime: number;
  elapsedSeconds: number;
}

const TIMER_STATUS = '⌚';
const DEFAULT_TODO_STATUS = 'To-do';

export function useTimeTracker(
  tasks: Task[],
  onUpdateTask: (taskId: string, updates: { status: string | null }) => Promise<void>,
  onCreateTimeLog: (payload: TimeLogEntryPayload) => Promise<void>,
  todoStatus: string = DEFAULT_TODO_STATUS
) {
  const [timers, setTimers] = useState<Map<string, TimerState>>(new Map());
  const intervalRef = useRef<number | null>(null);

  // Detect when a task status changes to ⌚ and start timer
  useEffect(() => {
    setTimers((prevTimers) => {
      const activeTimers = new Map<string, TimerState>();
      const taskIdsWithTimerStatus = new Set<string>();
      
      // Find all tasks with ⌚ status
      tasks.forEach((task) => {
        if (task.status === TIMER_STATUS) {
          taskIdsWithTimerStatus.add(task.id);
          const existing = prevTimers.get(task.id);
          if (existing) {
            // Timer already exists, keep it running
            activeTimers.set(task.id, existing);
          } else {
            // New timer, start it
            activeTimers.set(task.id, {
              taskId: task.id,
              startTime: Date.now(),
              elapsedSeconds: 0
            });
          }
        }
      });

      // Remove timers for tasks that no longer have ⌚ status
      prevTimers.forEach((timer, taskId) => {
        if (!taskIdsWithTimerStatus.has(taskId)) {
          // Timer was stopped, create time log entry
          const task = tasks.find((t) => t.id === taskId);
          if (task && timer.elapsedSeconds > 0) {
            const durationMinutes = Math.round(timer.elapsedSeconds / 60);
            const startTime = new Date(timer.startTime).toISOString();
            const endTime = new Date(timer.startTime + timer.elapsedSeconds * 1000).toISOString();
            
            onCreateTimeLog({
              taskId: task.id,
              taskTitle: task.title,
              duration: durationMinutes,
              startTime,
              endTime
            }).catch((err) => {
              console.error('Failed to create time log entry', err);
            });

            // Change status back to To-do
            onUpdateTask(taskId, { status: todoStatus }).catch((err) => {
              console.error('Failed to update task status', err);
            });
          }
        }
      });

      return activeTimers;
    });
  }, [tasks, onUpdateTask, onCreateTimeLog, todoStatus]);

  // Update elapsed time every second
  useEffect(() => {
    if (timers.size === 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = window.setInterval(() => {
      setTimers((prev) => {
        const next = new Map(prev);
        let changed = false;
        
        prev.forEach((timer, taskId) => {
          const elapsed = Math.floor((Date.now() - timer.startTime) / 1000);
          if (elapsed !== timer.elapsedSeconds) {
            next.set(taskId, {
              ...timer,
              elapsedSeconds: elapsed
            });
            changed = true;
          }
        });

        return changed ? next : prev;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [timers.size]);

  const getElapsedTime = (taskId: string): number => {
    return timers.get(taskId)?.elapsedSeconds ?? 0;
  };

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  };

  return {
    getElapsedTime,
    formatTime,
    isTracking: (taskId: string) => timers.has(taskId)
  };
}

