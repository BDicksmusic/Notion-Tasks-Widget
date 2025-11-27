/**
 * Data Management Service
 * 
 * Provides centralized functions for managing local data,
 * including full resets and merge operations.
 */

import { clearAllTasks, countTasks } from '../db/repositories/taskRepository';
import { clearAllProjects, countProjects } from '../db/repositories/projectRepository';
import { clearAllTimeLogs, countTimeLogs } from '../db/repositories/timeLogRepository';
import { clearAllWritingEntries, countWritingEntries } from '../db/repositories/writingRepository';
import { clearAllChatSummaries, getChatSummaryCount } from '../db/repositories/chatSummaryRepository';
import { clearAllLocalStatuses } from '../db/repositories/localStatusRepository';

// Sync queue/state removed - no longer needed

export interface DataCounts {
  tasks: number;
  projects: number;
  timeLogs: number;
  writingEntries: number;
  chatSummaries: number;
  pendingSyncItems: number;
}

export interface ResetResult {
  success: boolean;
  clearedCounts: DataCounts;
  error?: string;
}

export interface MergeResult {
  success: boolean;
  imported: {
    tasks: number;
    projects: number;
    timeLogs: number;
  };
  cleaned: {
    orphanedTasks: number;
    orphanedProjects: number;
    orphanedTimeLogs: number;
  };
  error?: string;
}

/**
 * Get current data counts
 */
export function getDataCounts(): DataCounts {
  return {
    tasks: countTasks(),
    projects: countProjects(),
    timeLogs: countTimeLogs(),
    writingEntries: countWritingEntries(),
    chatSummaries: getChatSummaryCount(),
    pendingSyncItems: 0  // Sync queue removed
  };
}

/**
 * FULL RESET - Complete wipe of all local data
 * 
 * This will:
 * - Delete all tasks
 * - Delete all projects
 * - Delete all time logs
 * - Delete all writing entries
 * - Delete all chat summaries
 * - Clear all local statuses
 * - Clear the sync queue
 * - Clear all sync state (import progress, cursors, etc.)
 * 
 * After this, the app will be in a fresh state as if just installed.
 * The next sync will re-import everything from Notion.
 */
export function performFullReset(): ResetResult {
  console.log('[DataManagement] Starting FULL RESET...');
  
  try {
    // Get counts before clearing for the result
    const beforeCounts = getDataCounts();
    
    // Clear all entity tables
    const tasksCleared = clearAllTasks();
    const projectsCleared = clearAllProjects();
    const timeLogsCleared = clearAllTimeLogs();
    const writingCleared = clearAllWritingEntries();
    const chatSummariesCleared = clearAllChatSummaries();
    
    // Clear local statuses
    clearAllLocalStatuses();
    
    // Sync queue/state removed - no longer needed
    const syncQueueCleared = 0;
    
    console.log('[DataManagement] FULL RESET complete:', {
      tasks: tasksCleared,
      projects: projectsCleared,
      timeLogs: timeLogsCleared,
      writingEntries: writingCleared,
      chatSummaries: chatSummariesCleared,
      syncQueue: syncQueueCleared
    });
    
    return {
      success: true,
      clearedCounts: {
        tasks: tasksCleared,
        projects: projectsCleared,
        timeLogs: timeLogsCleared,
        writingEntries: writingCleared,
        chatSummaries: chatSummariesCleared,
        pendingSyncItems: syncQueueCleared
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DataManagement] FULL RESET failed:', errorMessage);
    return {
      success: false,
      clearedCounts: {
        tasks: 0,
        projects: 0,
        timeLogs: 0,
        writingEntries: 0,
        chatSummaries: 0,
        pendingSyncItems: 0
      },
      error: errorMessage
    };
  }
}

/**
 * SOFT RESET - Clear data but preserve sync state
 * 
 * This is useful when you want to clear local data but 
 * keep the import progress intact.
 */
export function performSoftReset(): ResetResult {
  console.log('[DataManagement] Starting SOFT RESET...');
  
  try {
    const tasksCleared = clearAllTasks();
    const projectsCleared = clearAllProjects();
    const timeLogsCleared = clearAllTimeLogs();
    const writingCleared = clearAllWritingEntries();
    const chatSummariesCleared = clearAllChatSummaries();
    
    // Sync queue removed - no longer needed
    const syncQueueCleared = 0;
    
    console.log('[DataManagement] SOFT RESET complete');
    
    return {
      success: true,
      clearedCounts: {
        tasks: tasksCleared,
        projects: projectsCleared,
        timeLogs: timeLogsCleared,
        writingEntries: writingCleared,
        chatSummaries: chatSummariesCleared,
        pendingSyncItems: syncQueueCleared
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DataManagement] SOFT RESET failed:', errorMessage);
    return {
      success: false,
      clearedCounts: {
        tasks: 0,
        projects: 0,
        timeLogs: 0,
        writingEntries: 0,
        chatSummaries: 0,
        pendingSyncItems: 0
      },
      error: errorMessage
    };
  }
}

/**
 * RESET TASKS ONLY - Clear just the tasks table
 * 
 * Useful for re-importing tasks while keeping projects and time logs.
 */
export function resetTasksOnly(): { success: boolean; cleared: number; error?: string } {
  console.log('[DataManagement] Resetting tasks only...');
  
  try {
    const cleared = clearAllTasks();
    console.log(`[DataManagement] Cleared ${cleared} tasks`);
    return { success: true, cleared };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, cleared: 0, error: errorMessage };
  }
}

/**
 * RESET PROJECTS ONLY - Clear just the projects table
 */
export function resetProjectsOnly(): { success: boolean; cleared: number; error?: string } {
  console.log('[DataManagement] Resetting projects only...');
  
  try {
    const cleared = clearAllProjects();
    console.log(`[DataManagement] Cleared ${cleared} projects`);
    return { success: true, cleared };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, cleared: 0, error: errorMessage };
  }
}

/**
 * RESET TIME LOGS ONLY - Clear just the time logs table
 */
export function resetTimeLogsOnly(): { success: boolean; cleared: number; error?: string } {
  console.log('[DataManagement] Resetting time logs only...');
  
  try {
    const cleared = clearAllTimeLogs();
    console.log(`[DataManagement] Cleared ${cleared} time logs`);
    return { success: true, cleared };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, cleared: 0, error: errorMessage };
  }
}

