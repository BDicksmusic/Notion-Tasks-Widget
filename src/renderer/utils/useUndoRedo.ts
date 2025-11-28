import { useCallback, useRef, useState, useEffect } from 'react';

export type UndoableActionType = 
  | 'task:update'
  | 'task:complete'
  | 'task:delete'
  | 'timelog:update'
  | 'timelog:delete';

export interface UndoableAction {
  type: UndoableActionType;
  description: string;
  timestamp: number;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface UndoRedoState {
  undoStack: UndoableAction[];
  redoStack: UndoableAction[];
  lastAction: UndoableAction | null;
}

const MAX_HISTORY_SIZE = 50;

export interface UseUndoRedoResult {
  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string | null;
  redoDescription: string | null;
  pushAction: (action: Omit<UndoableAction, 'timestamp'>) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clearHistory: () => void;
}

export function useUndoRedo(): UseUndoRedoResult {
  const [state, setState] = useState<UndoRedoState>({
    undoStack: [],
    redoStack: [],
    lastAction: null
  });
  
  const isProcessingRef = useRef(false);

  const pushAction = useCallback((action: Omit<UndoableAction, 'timestamp'>) => {
    const fullAction: UndoableAction = {
      ...action,
      timestamp: Date.now()
    };
    
    setState((prev) => {
      const newUndoStack = [...prev.undoStack, fullAction];
      // Trim history if it gets too long
      if (newUndoStack.length > MAX_HISTORY_SIZE) {
        newUndoStack.shift();
      }
      return {
        undoStack: newUndoStack,
        redoStack: [], // Clear redo stack on new action
        lastAction: fullAction
      };
    });
  }, []);

  const undo = useCallback(async () => {
    if (isProcessingRef.current) return;
    
    const action = state.undoStack[state.undoStack.length - 1];
    if (!action) return;
    
    isProcessingRef.current = true;
    
    try {
      await action.undo();
      
      setState((prev) => {
        const newUndoStack = prev.undoStack.slice(0, -1);
        return {
          undoStack: newUndoStack,
          redoStack: [...prev.redoStack, action],
          lastAction: null
        };
      });
    } catch (error) {
      console.error('Undo failed:', error);
    } finally {
      isProcessingRef.current = false;
    }
  }, [state.undoStack]);

  const redo = useCallback(async () => {
    if (isProcessingRef.current) return;
    
    const action = state.redoStack[state.redoStack.length - 1];
    if (!action) return;
    
    isProcessingRef.current = true;
    
    try {
      await action.redo();
      
      setState((prev) => {
        const newRedoStack = prev.redoStack.slice(0, -1);
        return {
          undoStack: [...prev.undoStack, action],
          redoStack: newRedoStack,
          lastAction: action
        };
      });
    } catch (error) {
      console.error('Redo failed:', error);
    } finally {
      isProcessingRef.current = false;
    }
  }, [state.redoStack]);

  const clearHistory = useCallback(() => {
    setState({
      undoStack: [],
      redoStack: [],
      lastAction: null
    });
  }, []);

  return {
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
    undoDescription: state.undoStack[state.undoStack.length - 1]?.description ?? null,
    redoDescription: state.redoStack[state.redoStack.length - 1]?.description ?? null,
    pushAction,
    undo,
    redo,
    clearHistory
  };
}

// Hook to set up global keyboard shortcuts for undo/redo
export function useUndoRedoKeyboard(
  undo: () => Promise<void>,
  redo: () => Promise<void>,
  enabled = true
) {
  useEffect(() => {
    if (!enabled) return;
    
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if we're in an editable element
      const target = event.target as HTMLElement;
      const isEditable = 
        target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT';
      
      // Allow undo/redo in editable fields (browser handles text undo)
      // but we handle it at app level for other actions
      if (isEditable) return;
      
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? event.metaKey : event.ctrlKey;
      
      if (modKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          // Ctrl+Shift+Z or Cmd+Shift+Z = Redo
          void redo();
        } else {
          // Ctrl+Z or Cmd+Z = Undo
          void undo();
        }
        return;
      }
      
      // Ctrl+Y = Redo (Windows convention)
      if (modKey && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        void redo();
        return;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [undo, redo, enabled]);
}

// Helper to create undoable task update action
export function createTaskUpdateAction(
  taskId: string,
  taskTitle: string,
  previousState: Record<string, unknown>,
  newState: Record<string, unknown>,
  updateFn: (taskId: string, updates: Record<string, unknown>) => Promise<void>
): Omit<UndoableAction, 'timestamp'> {
  const changedFields = Object.keys(newState).filter(
    (key) => newState[key] !== previousState[key]
  );
  
  let description = `Update "${taskTitle}"`;
  if (changedFields.includes('status')) {
    if (newState.status === 'Done' || previousState.status === 'Done') {
      description = newState.status === 'Done' 
        ? `Complete "${taskTitle}"`
        : `Uncomplete "${taskTitle}"`;
    } else {
      description = `Change status of "${taskTitle}"`;
    }
  } else if (changedFields.includes('dueDate')) {
    description = `Change date of "${taskTitle}"`;
  }
  
  return {
    type: 'task:update',
    description,
    undo: async () => {
      await updateFn(taskId, previousState);
    },
    redo: async () => {
      await updateFn(taskId, newState);
    }
  };
}

// Helper to create undoable task completion action
export function createTaskCompletionAction(
  taskId: string,
  taskTitle: string,
  wasCompleted: boolean,
  completedStatus: string,
  updateFn: (taskId: string, updates: Record<string, unknown>) => Promise<void>
): Omit<UndoableAction, 'timestamp'> {
  return {
    type: 'task:complete',
    description: wasCompleted 
      ? `Uncomplete "${taskTitle}"`
      : `Complete "${taskTitle}"`,
    undo: async () => {
      await updateFn(taskId, { 
        status: wasCompleted ? completedStatus : null 
      });
    },
    redo: async () => {
      await updateFn(taskId, { 
        status: wasCompleted ? null : completedStatus 
      });
    }
  };
}





