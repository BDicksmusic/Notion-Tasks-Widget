import { useEffect, useRef, useState, useCallback } from 'react';
import type { Task, TimeLogEntryPayload } from '@shared/types';

interface CountdownState {
  taskId: string;
  sessionLengthMinutes: number;
  startTime: number;
  endTime: number;
  remainingSeconds: number;
  initialStatus?: string | null;
}

const TIMER_STATUS = '⌚';
const DEFAULT_TODO_STATUS = 'To-do';

export function useCountdownTimer(
  tasks: Task[],
  onUpdateTask: (taskId: string, updates: { status: string | null }) => Promise<void>,
  onCreateTimeLog: (payload: TimeLogEntryPayload) => Promise<void>,
  todoStatus: string = DEFAULT_TODO_STATUS,
  onComplete?: (taskId: string) => void
) {
  const [countdowns, setCountdowns] = useState<Map<string, CountdownState>>(new Map());
  const [sessionInputs, setSessionInputs] = useState<Map<string, string>>(new Map());
  const intervalRef = useRef<number | null>(null);
  const completionSoundRef = useRef<HTMLAudioElement | null>(null);
  const warningPlayedRef = useRef<Set<string>>(new Set());

  // Initialize audio for completion sound
  useEffect(() => {
    // Audio will be created on-demand
  }, [tasks]);

  const playCompletionSound = useCallback(() => {
    if (typeof window === 'undefined') return;
    const AudioCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    
    const ctx = new AudioCtor();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    
    // Play a pleasant completion sound (two-tone chime)
    const playTone = (frequency: number, duration: number, delay: number) => {
      setTimeout(() => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        const now = ctx.currentTime;
        gainNode.gain.setValueAtTime(0.3, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);
        oscillator.connect(gainNode).connect(ctx.destination);
        oscillator.start(now);
        oscillator.stop(now + duration);
      }, delay);
    };

    playTone(523.25, 0.3, 0); // C5
    playTone(659.25, 0.5, 200); // E5
  }, []);

  const playWarningSound = useCallback(() => {
    if (typeof window === 'undefined') return;
    const AudioCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    
    const ctx = new AudioCtor();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    
    // Play a subtle warning sound (single soft tone)
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 440; // A4
    const now = ctx.currentTime;
    gainNode.gain.setValueAtTime(0.15, now); // Much quieter than completion sound
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    oscillator.connect(gainNode).connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
  }, []);

  const startCountdown = useCallback((taskId: string, sessionLengthMinutes: number) => {
    if (sessionLengthMinutes <= 0) return;

    const task = tasks.find((t) => t.id === taskId);
    
    const startTime = Date.now();
    const sessionLengthSeconds = sessionLengthMinutes * 60;
    const endTime = startTime + sessionLengthSeconds * 1000;
    
    setCountdowns((prev) => {
      const next = new Map(prev);
      next.set(taskId, {
        taskId,
        sessionLengthMinutes,
        startTime,
        endTime,
        remainingSeconds: sessionLengthSeconds,
        initialStatus: task?.status
      });
      return next;
    });

    // Create time log entry with status "start"
    if (task) {
      const startTimeISO = new Date(startTime).toISOString();
      onCreateTimeLog({
        taskId: task.id,
        taskTitle: task.title,
        status: 'start',
        startTime: startTimeISO,
        sessionLengthMinutes
      }).catch((err) => {
        console.error('Failed to create time log entry on session start', err);
      });
    }

    // Clear session input
    setSessionInputs((prev) => {
      const next = new Map(prev);
      next.delete(taskId);
      return next;
    });
  }, [tasks, onCreateTimeLog]);

  const stopCountdown = useCallback((taskId: string): string | null => {
    let initialStatus: string | null = null;
    setCountdowns((prev) => {
      const next = new Map(prev);
      const existing = next.get(taskId);
      if (existing) {
        initialStatus = existing.initialStatus ?? null;
        next.delete(taskId);
      }
      return next;
    });
    // Clear warning flag when stopping
    warningPlayedRef.current.delete(taskId);
    return initialStatus;
  }, []);

  const resumeCountdown = useCallback(
    (taskId: string, startTime: number, endTime: number, initialStatus?: string | null) => {
      if (!endTime || endTime <= Date.now()) return;
      const remainingSeconds = Math.max(
        0,
        Math.floor((endTime - Date.now()) / 1000)
      );
      const sessionLengthMinutes = Math.max(
        1,
        Math.round((endTime - startTime) / 60000)
      );
      setCountdowns((prev) => {
        const next = new Map(prev);
        next.set(taskId, {
          taskId,
          sessionLengthMinutes,
          startTime,
          endTime,
          remainingSeconds,
          initialStatus: initialStatus ?? null
        });
        return next;
      });
    },
    []
  );

  // Stop countdowns for tasks that no longer exist
  useEffect(() => {
    setCountdowns((prev) => {
      const next = new Map(prev);
      let changed = false;
      
      prev.forEach((countdown, taskId) => {
        const task = tasks.find((t) => t.id === taskId);
        if (!task) {
          // Task no longer exists, stop the countdown
          next.delete(taskId);
          changed = true;
        }
      });
      
      return changed ? next : prev;
    });
  }, [tasks]);

  // Update countdown every second and handle completion
  useEffect(() => {
    if (countdowns.size === 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = window.setInterval(() => {
      setCountdowns((prev) => {
        const next = new Map(prev);
        let changed = false;
        const now = Date.now();
        
        prev.forEach((countdown, taskId) => {
          const remaining = Math.max(0, Math.floor((countdown.endTime - now) / 1000));
          
          // Play warning sound at 2 minutes (120 seconds) remaining
          if (remaining <= 120 && remaining > 0 && !warningPlayedRef.current.has(taskId)) {
            warningPlayedRef.current.add(taskId);
            playWarningSound();
          }
          
          if (remaining !== countdown.remainingSeconds) {
            if (remaining <= 0) {
              // Reset warning flag when countdown completes
              warningPlayedRef.current.delete(taskId);
              // Countdown completed!
              const task = tasks.find((t) => t.id === taskId);
              if (task) {
                const actualDurationSeconds = Math.floor((now - countdown.startTime) / 1000);
                const durationMinutes = Math.round(actualDurationSeconds / 60);
                const startTime = new Date(countdown.startTime).toISOString();
                const endTime = new Date(now).toISOString();
                
                // Play completion sound
                playCompletionSound();
                
                // Create time log entry
                onCreateTimeLog({
                  taskId: task.id,
                  taskTitle: task.title,
                  status: 'completed',
                  startTime,
                  endTime,
                  sessionLengthMinutes: countdown.sessionLengthMinutes
                }).catch((err) => {
                  console.error('Failed to create time log entry', err);
                });

                // Change status back to To-do
                const targetStatus =
                  todoStatus ??
                  countdown.initialStatus ??
                  task.status ??
                  null;

                if (targetStatus) {
                  onUpdateTask(taskId, { status: targetStatus }).catch(
                    (err) => {
                      console.error('Failed to update task status', err);
                    }
                  );
                }

                // Call completion callback
                onComplete?.(taskId);
              }
              
              // Remove countdown and clear warning flag
              next.delete(taskId);
              warningPlayedRef.current.delete(taskId);
            } else {
              next.set(taskId, {
                ...countdown,
                remainingSeconds: remaining
              });
            }
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
  }, [countdowns.size, tasks, onUpdateTask, onCreateTimeLog, todoStatus, onComplete, playCompletionSound, playWarningSound]);

  const getRemainingTime = (taskId: string): number => {
    return countdowns.get(taskId)?.remainingSeconds ?? 0;
  };

  const getEndTime = (taskId: string): Date | null => {
    const countdown = countdowns.get(taskId);
    return countdown ? new Date(countdown.endTime) : null;
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

  const formatEndTime = (date: Date): string => {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const setSessionInput = (taskId: string, value: string) => {
    setSessionInputs((prev) => {
      const next = new Map(prev);
      if (value) {
        next.set(taskId, value);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  };

  const getSessionInput = (taskId: string): string => {
    return sessionInputs.get(taskId) ?? '';
  };

  const isCountingDown = (taskId: string): boolean => {
    return countdowns.has(taskId);
  };

  const extendCountdown = useCallback((taskId: string, additionalMinutes: number) => {
    if (additionalMinutes <= 0) return;
    
    setCountdowns((prev) => {
      const next = new Map(prev);
      const existing = next.get(taskId);
      if (!existing) return prev;
      
      const additionalSeconds = additionalMinutes * 60;
      const newEndTime = existing.endTime + (additionalSeconds * 1000);
      const newRemainingSeconds = Math.max(0, Math.floor((newEndTime - Date.now()) / 1000));
      
      next.set(taskId, {
        ...existing,
        endTime: newEndTime,
        remainingSeconds: newRemainingSeconds,
        sessionLengthMinutes: existing.sessionLengthMinutes + additionalMinutes
      });
      
      return next;
    });
  }, []);

  return {
    startCountdown,
    stopCountdown,
    resumeCountdown,
    extendCountdown,
    getRemainingTime,
    getEndTime,
    formatTime,
    formatEndTime,
    isCountingDown
  };
}

