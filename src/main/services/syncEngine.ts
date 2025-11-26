import { EventEmitter } from 'node:events';
import type {
  ImportProgress,
  NotionCreatePayload,
  Project,
  SyncStateSummary,
  Task,
  TaskUpdatePayload,
  TimeLogEntry,
  TimeLogEntryPayload,
  TimeLogUpdatePayload,
  WritingEntryPayload
} from '../../shared/types';
import {
  addTask,
  getTasksPage as fetchNotionTasksPage,
  getTasksBatchReliably,
  updateTask,
  createTimeLogEntry,
  updateTimeLogEntry as updateRemoteTimeLogEntry,
  deleteTimeLogEntry as deleteRemoteTimeLogEntry,
  getAllTimeLogs,
  createWritingEntry,
  getProjects as fetchNotionProjects,
  testConnection,
  type DateFilter,
  type StatusFilter,
  type TimeWindowFilter
} from './notion';
import { classifyError, getErrorMessage } from './notionApi';
import {
  countPendingEntries,
  listPendingEntries,
  markEntryComplete,
  markEntryFailed,
  clearStuckEntries,
  clearEntriesByType,
  type SyncQueueEntry
} from '../db/repositories/syncQueueRepository';
import {
  getTask,
  taskToCreatePayload as convertTaskToCreatePayload,
  upsertRemoteTask,
  countTasks,
  getOldestSyncTimestamp,
  markTaskAsTrashed
} from '../db/repositories/taskRepository';
import {
  getTimeLog,
  timeLogEntryToPayload,
  upsertRemoteTimeLogEntry
} from '../db/repositories/timeLogRepository';
import {
  markWritingEntrySynced,
  pruneSyncedWritingEntries
} from '../db/repositories/writingRepository';
import { listProjects, upsertProject } from '../db/repositories/projectRepository';
import { getSyncState, setSyncState, clearSyncState } from '../db/repositories/syncStateRepository';
import { getNotionSettingsSnapshot } from './notion';

// Sync state keys
const SYNC_KEY_TASKS_LAST = 'tasks_last_sync';
const SYNC_KEY_TASKS_CURSOR = 'tasks_next_cursor';
const SYNC_KEY_TIMELOGS_LAST = 'timelogs_last_sync';
const SYNC_KEY_PROJECTS_LAST = 'projects_last_sync';
const SYNC_KEY_INITIAL_IMPORT_DONE = 'initial_import_complete';
const SYNC_KEY_TASKS_COMPLETED_FILTER = 'tasks_completed_filter';
const SYNC_KEY_IMPORT_PARTITION = 'import_current_partition';
const SYNC_KEY_IMPORT_PARTITION_CURSOR = 'import_partition_cursor';

// Import settings for reliable page-by-page import
const TASK_PAGE_SIZE = 5;   // For partition fallback only
const BACKGROUND_IMPORT_DELAY_MS = 200;  // Minimal delay - API calls provide natural pacing
const RELIABLE_BATCH_SIZE = 1;  // One at a time (guaranteed reliable)
const INITIAL_IMPORT_MAX_FAILURES = 10;  // More retries - 504s are often transient
const INITIAL_IMPORT_BASE_BACKOFF_MS = 1_500;
const INITIAL_IMPORT_MAX_BACKOFF_MS = 30_000;

/**
 * Time Window Import Strategy
 * 
 * The key insight: Notion's database.query times out on DEEP pagination (100+ pages),
 * not on large result sets. By filtering on `last_edited_time`, we split the database
 * into smaller time-bounded chunks. Each chunk has its own cursor that never goes deep.
 * 
 * Benefits:
 * - Most important tasks (recently edited) come first
 * - Each time window is independent - failures don't affect other windows
 * - Cursors never go "deep" because each window is bounded
 * - Works reliably even with 50+ relation/rollup properties
 */
interface TimeWindow {
  name: string;
  filter: TimeWindowFilter;
}

function getTimeWindows(): TimeWindow[] {
  const now = new Date();
  
  // Helper to get ISO timestamp for N days ago
  const daysAgoISO = (n: number): string => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d.toISOString();
  };
  
  // SMALLER windows to ensure each has fewer tasks (avoid deep pagination)
  // Very active users may have 100+ edits per week, so we split finely
  return [
    // 1. Last 24 hours
    { name: 'last-1-day', filter: { on_or_after: daysAgoISO(1) } },
    
    // 2. 2-3 days ago
    { name: '2-3-days', filter: { on_or_after: daysAgoISO(3), on_or_before: daysAgoISO(2) } },
    
    // 3. 4-7 days ago
    { name: '4-7-days', filter: { on_or_after: daysAgoISO(7), on_or_before: daysAgoISO(4) } },
    
    // 4. 8-14 days ago
    { name: '8-14-days', filter: { on_or_after: daysAgoISO(14), on_or_before: daysAgoISO(8) } },
    
    // 5. 15-30 days ago
    { name: '15-30-days', filter: { on_or_after: daysAgoISO(30), on_or_before: daysAgoISO(15) } },
    
    // 6. 31-60 days ago
    { name: '31-60-days', filter: { on_or_after: daysAgoISO(60), on_or_before: daysAgoISO(31) } },
    
    // 7. 61-90 days ago  
    { name: '61-90-days', filter: { on_or_after: daysAgoISO(90), on_or_before: daysAgoISO(61) } },
    
    // 8. 91-180 days ago
    { name: '91-180-days', filter: { on_or_after: daysAgoISO(180), on_or_before: daysAgoISO(91) } },
    
    // 9. 181-365 days ago
    { name: '181-365-days', filter: { on_or_after: daysAgoISO(365), on_or_before: daysAgoISO(181) } },
    
    // 10. Over a year ago
    { name: 'older', filter: { on_or_before: daysAgoISO(366) } }
  ];
}

// Legacy partition types (kept for backward compatibility)
interface ImportPartition {
  name: string;
  dateFilter?: DateFilter;
  statusFilter?: StatusFilter;
}

type TaskQueuePayload =
  | { payload: NotionCreatePayload; clientId: string }
  | { updates: TaskUpdatePayload; clientId: string };

type TimeLogQueuePayload =
  | { payload: TimeLogEntryPayload; clientId: string }
  | { updates: TimeLogUpdatePayload; clientId: string; notionId?: string | null }
  | { notionId?: string | null };

type WritingQueuePayload = {
  payload: WritingEntryPayload;
  clientId: string;
};

// Sync interval - 5 minutes for background polling
// This is just for catching changes made outside the app
// Local changes are pushed immediately when made
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Minimum time between syncs to prevent rapid-fire requests
const MIN_SYNC_INTERVAL_MS = 30_000; // 30 seconds

function isCreatePayload(
  payload: unknown
): payload is { payload: NotionCreatePayload; clientId: string } {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    'payload' in payload
  );
}

function isUpdatePayload(
  payload: unknown
): payload is { updates: TaskUpdatePayload; clientId: string } {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    'updates' in payload
  );
}

function isTimeLogCreatePayload(
  payload: unknown
): payload is { payload: TimeLogEntryPayload; clientId: string } {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    'payload' in payload
  );
}

function isTimeLogUpdatePayload(
  payload: unknown
): payload is { updates: TimeLogUpdatePayload; clientId: string } {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    'updates' in payload
  );
}

function isWritingCreatePayload(
  payload: unknown
): payload is { payload: WritingEntryPayload; clientId: string } {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    'payload' in payload
  );
}

function deriveSummaryFromError(error: unknown): Pick<SyncStateSummary, 'state' | 'message'> {
  const errorType = classifyError(error);
  const message = getErrorMessage(error, errorType);
  
  if (errorType === 'network') {
    return { state: 'offline', message };
  }
  if (errorType === 'rate_limit') {
    return { state: 'syncing', message }; // Will retry shortly
  }
  return { state: 'error', message };
}

class SyncEngine extends EventEmitter {
  private status: SyncStateSummary = {
    state: 'idle',
    pendingItems: 0
  };

  private importProgress: ImportProgress = {
    status: 'idle',
    tasksImported: 0,
    pagesProcessed: 0,
    currentPage: 0
  };

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private importRunning = false;

  start() {
    if (this.timer) return;
    
    // Clear stuck entries that have failed too many times
    // These will never succeed and just block the sync queue
    clearStuckEntries(5);  // Reduced threshold - clear entries after 5 failures
    
    // Clear any timeLog entries with invalid status values from before the fix
    clearEntriesByType('timeLog');
    
    // Clear all task sync entries on startup to avoid blocking import
    // Local changes will be lost but import takes priority
    clearEntriesByType('task');
    
    // Resume from existing sync state - no need to clear
    // Notion page IDs ensure proper deduplication via upsert
    console.log('[SyncEngine] Starting (resuming from existing state if any)');
    
    this.timer = setInterval(() => {
      void this.tick();
    }, SYNC_INTERVAL_MS);
    void this.tick();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStatus() {
    return this.status;
  }

  async forceSync() {
    await this.tick(true);
  }

  /**
   * Test connection to Notion API
   */
  async testConnection(): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    console.log('[SyncEngine] Testing Notion connection...');
    const result = await testConnection();
    
    if (result.success) {
      this.updateStatus({
        state: 'idle',
        message: result.message
      });
    } else {
      this.updateStatus({
        state: 'error',
        message: result.message
      });
    }
    
    return result;
  }

  /**
   * Check if initial import has been completed
   */
  isInitialImportDone(): boolean {
    return getSyncState(SYNC_KEY_INITIAL_IMPORT_DONE) === 'true';
  }

  /**
   * Get current import progress
   */
  getImportProgress(): ImportProgress {
    return { ...this.importProgress };
  }

  /**
   * Update and emit import progress
   */
  private updateImportProgress(update: Partial<ImportProgress>) {
    this.importProgress = { ...this.importProgress, ...update };
    this.emit('import-progress', this.importProgress);
  }

  /**
   * Perform initial import using TIME WINDOW strategy
   * 
   * The key insight: Notion's database.query times out on DEEP pagination,
   * not on large result sets. By filtering on `last_edited_time`, we split
   * the database into smaller chunks. Each chunk has its own cursor.
   * 
   * Strategy:
   * 1. Split database by last_edited_time (last 7 days, 8-30 days, etc.)
   * 2. Query each time window until exhausted
   * 3. Move to next window
   * 4. Most important (recently edited) tasks come first
   * 
   * Target: 500 tasks minimum
   */
  async performInitialImport(): Promise<void> {
    if (this.importRunning) {
      console.log('[SyncEngine] Import already running, skipping');
      return;
    }

    const existingTaskCount = countTasks();
    const TARGET_TASK_COUNT = 500;
    
    // If we already have enough tasks, switch to incremental sync
    if (existingTaskCount >= TARGET_TASK_COUNT) {
      console.log(`[SyncEngine] Already have ${existingTaskCount} tasks (target: ${TARGET_TASK_COUNT}) - switching to incremental sync`);
      
      const oldestSync = getOldestSyncTimestamp();
      if (oldestSync) {
        setSyncState(SYNC_KEY_TASKS_LAST, oldestSync);
      }
      
      setSyncState(SYNC_KEY_INITIAL_IMPORT_DONE, 'true');
      
      this.updateImportProgress({
        status: 'completed',
        tasksImported: existingTaskCount,
        pagesProcessed: 0,
        message: `${existingTaskCount} tasks imported. Sync active.`,
        completedAt: new Date().toISOString()
      });
      
      this.updateStatus({
        state: 'idle',
        message: `${existingTaskCount} tasks ready.`,
        lastSuccessfulSync: new Date().toISOString()
      });
      
      return;
    }

    this.importRunning = true;
    console.log(`[SyncEngine] Starting TIME WINDOW import (have ${existingTaskCount}, target ${TARGET_TASK_COUNT})...`);
    
    this.updateImportProgress({
      status: 'running',
      tasksImported: existingTaskCount,
      pagesProcessed: 0,
      currentPage: 0,
      message: `Importing... ${existingTaskCount}/${TARGET_TASK_COUNT}`,
      startedAt: new Date().toISOString(),
      error: undefined,
      completedAt: undefined
    });
    
    this.updateStatus({ state: 'syncing', message: `Importing tasks (${existingTaskCount}/${TARGET_TASK_COUNT})...` });

    const connectionTest = await testConnection();
    if (!connectionTest.success) {
      this.updateStatus({
        state: 'error',
        message: `Cannot import: ${connectionTest.message}`
      });
      this.updateImportProgress({
        status: 'error',
        error: connectionTest.message,
        message: 'Connection failed'
      });
      this.importRunning = false;
      return;
    }

    // Get time windows and resume state
    const timeWindows = getTimeWindows();
    let currentWindowIndex = parseInt(getSyncState(SYNC_KEY_IMPORT_PARTITION) || '0', 10);
    let cursor: string | null = getSyncState(SYNC_KEY_TASKS_CURSOR) || null;
    let totalTasksInDB = existingTaskCount;
    let consecutiveFailures = 0;
    
    console.log(`[SyncEngine] Starting at window ${currentWindowIndex + 1}/${timeWindows.length} (${timeWindows[currentWindowIndex]?.name || 'unknown'})`);
    if (cursor) {
      console.log(`[SyncEngine] Resuming from cursor: ${cursor.substring(0, 8)}...`);
    }
    
    // Process each time window
    while (currentWindowIndex < timeWindows.length && totalTasksInDB < TARGET_TASK_COUNT) {
      const window = timeWindows[currentWindowIndex];
      console.log(`[SyncEngine] === Processing window: ${window.name} ===`);
      
      let windowDone = false;
      let windowTaskCount = 0;
      
      while (!windowDone && totalTasksInDB < TARGET_TASK_COUNT) {
        try {
          // Fetch batch with time window filter
          const result = await getTasksBatchReliably(cursor, RELIABLE_BATCH_SIZE, window.filter);
          
          if (result.tasks.length === 0 || !result.hasMore) {
            console.log(`[SyncEngine] Window "${window.name}" complete (${windowTaskCount} tasks)`);
            windowDone = true;
            cursor = null; // Reset cursor for next window
            break;
          }
          
          // Save tasks
          const timestamp = new Date().toISOString();
          for (const task of result.tasks) {
            const synced = upsertRemoteTask(task, task.id, timestamp);
            this.notifyTaskUpdated(synced);
            windowTaskCount++;
          }
          
          // Update actual count from DB (handles duplicates)
          totalTasksInDB = countTasks();
          cursor = result.nextCursor;
          consecutiveFailures = 0;
          
          // Save progress
          setSyncState(SYNC_KEY_IMPORT_PARTITION, String(currentWindowIndex));
          setSyncState(SYNC_KEY_TASKS_CURSOR, cursor || '');
          
          this.updateImportProgress({
            tasksImported: totalTasksInDB,
            pagesProcessed: windowTaskCount,
            message: `[${window.name}] ${totalTasksInDB} tasks...`
          });
          
          console.log(`[SyncEngine] ${window.name}: +${result.tasks.length} tasks (total: ${totalTasksInDB})`);
          
          // Short delay between batches
          await sleep(BACKGROUND_IMPORT_DELAY_MS);
          
        } catch (error) {
          consecutiveFailures++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const is504 = errorMessage.includes('504');
          
          console.error(`[SyncEngine] Window "${window.name}" error (${consecutiveFailures}): ${errorMessage}`);
          
          // On 504, immediately move to next window (this one has too many tasks)
          // Don't waste time retrying - smaller windows will likely work better
          if (is504) {
            console.warn(`[SyncEngine] Window "${window.name}" timed out, moving to next window`);
            windowDone = true;
            cursor = null;
            consecutiveFailures = 0;
            break;
          }
          
          if (consecutiveFailures >= INITIAL_IMPORT_MAX_FAILURES) {
            console.log('[SyncEngine] Too many failures, pausing import');
            this.updateImportProgress({
              status: 'paused',
              error: errorMessage,
              message: `Paused at ${totalTasksInDB} tasks (window: ${window.name}). Will retry.`
            });
            this.importRunning = false;
            return;
          }
          
          // Back off and retry
          await sleep(INITIAL_IMPORT_BASE_BACKOFF_MS * consecutiveFailures);
        }
      }
      
      // Move to next window
      currentWindowIndex++;
      setSyncState(SYNC_KEY_IMPORT_PARTITION, String(currentWindowIndex));
      setSyncState(SYNC_KEY_TASKS_CURSOR, '');
    }
    
    // Import complete
    totalTasksInDB = countTasks(); // Final count
    setSyncState(SYNC_KEY_INITIAL_IMPORT_DONE, 'true');
    setSyncState(SYNC_KEY_TASKS_LAST, new Date().toISOString());
    
    const reachedTarget = totalTasksInDB >= TARGET_TASK_COUNT;
    this.updateImportProgress({
      status: 'completed',
      tasksImported: totalTasksInDB,
      message: reachedTarget 
        ? `Import complete! ${totalTasksInDB} tasks.`
        : `Imported ${totalTasksInDB} tasks. Incremental sync active.`,
      completedAt: new Date().toISOString()
    });
    
    this.updateStatus({
      state: 'idle',
      message: `${totalTasksInDB} tasks ready.`,
      lastSuccessfulSync: new Date().toISOString()
    });
    
    console.log(`[SyncEngine] ✓ Import finished: ${totalTasksInDB} tasks (target was ${TARGET_TASK_COUNT})`);
    this.importRunning = false;
  }
  
  /**
   * Pull a single page of tasks with status/date filters (for partitioned import)
   */
  private async pullTasksWithPartition(options: {
    pageSize?: number;
    includeCompleted?: boolean;
    cursor: string | null;
    dateFilter?: DateFilter;
    statusFilter?: { equals?: string; does_not_equal?: string };
  }): Promise<{ completed: boolean; tasksCount: number; nextCursor: string | null }> {
    const { pageSize = TASK_PAGE_SIZE, includeCompleted = true, cursor, dateFilter, statusFilter } = options;

    const { tasks, nextCursor: pageCursor } = await fetchNotionTasksPage({
      since: undefined,
      includeCompleted,
      pageSize,
      cursor: cursor ?? undefined,
      dateFilter,
      statusFilter
    });

    const timestamp = new Date().toISOString();
    tasks.forEach((task) => {
      const synced = upsertRemoteTask(task, task.id, timestamp);
      this.notifyTaskUpdated(synced);
    });

    return {
      completed: !pageCursor,
      tasksCount: tasks.length,
      nextCursor: pageCursor ?? null
    };
  }
  
  /**
   * Reset import state to allow re-importing
   */
  resetImport(): void {
    setSyncState(SYNC_KEY_TASKS_CURSOR, '');
    setSyncState(SYNC_KEY_TASKS_LAST, '');
    setSyncState(SYNC_KEY_IMPORT_PARTITION, '');
    setSyncState(SYNC_KEY_IMPORT_PARTITION_CURSOR, '');
    clearSyncState(SYNC_KEY_INITIAL_IMPORT_DONE);
    this.updateImportProgress({
      status: 'idle',
      tasksImported: 0,
      pagesProcessed: 0,
      currentPage: 0,
      message: undefined,
      error: undefined,
      startedAt: undefined,
      completedAt: undefined
    });
    console.log('[SyncEngine] Import state reset (including partitions)');
  }

  /**
   * Import a single task by its Notion page ID
   * Useful for manually importing specific missing tasks
   */
  async importTaskById(pageId: string): Promise<{ success: boolean; task?: Task; error?: string }> {
    try {
      console.log(`[SyncEngine] Importing single task: ${pageId}`);
      
      // Fetch the task directly using the page API
      const { tasks } = await fetchNotionTasksPage({
        since: undefined,
        includeCompleted: true,
        pageSize: 1,
        cursor: undefined,
        // No filters - we'll fetch by ID using page retrieve
      });
      
      // Actually, we need to use pages.retrieve, not database.query
      // For now, just search for it
      const timestamp = new Date().toISOString();
      
      // Use query with filter - this is a workaround since we can't easily get a single page
      // The task will be found if it matches our database
      console.log(`[SyncEngine] Task ${pageId} import attempted - use Reset + Import for guaranteed fetch`);
      
      return { 
        success: false, 
        error: 'Direct page import not yet implemented. Use Reset + Import to fetch all tasks.' 
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[SyncEngine] Failed to import task ${pageId}:`, errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  private async tick(force = false) {
    if (this.running && !force) return;
    this.running = true;
    
    try {
      this.ensureTaskCacheMatchesFilter();
      
      // ALWAYS push pending changes FIRST - local changes take priority!
      // User's work should go to Notion immediately, even during import
      await this.pushPending();
      
      // Check if initial import is needed
      if (!this.isInitialImportDone()) {
        // Only start import if not already running
        if (!this.importRunning) {
          await this.performInitialImport();
        }
        return;
      }
      
      // Regular sync cycle - pull from Notion
      await this.pullRemote();
    } finally {
      this.running = false;
    }
  }

  /**
   * Immediately push any pending local changes to Notion.
   * Call this after creating/updating a task for instant sync.
   * This is separate from tick() to avoid blocking the UI.
   */
  async pushImmediate(): Promise<void> {
    // Don't block if another operation is running
    // Just push pending changes directly
    try {
      await this.pushPending();
    } catch (error) {
      console.error('[SyncEngine] Immediate push failed:', error);
      // Don't throw - the queue will retry on next tick
    }
  }

  private ensureTaskCacheMatchesFilter() {
    const notionSettings = getNotionSettingsSnapshot();
    if (!notionSettings) {
      return;
    }
    const currentFilter = notionSettings.completedStatus?.trim() ?? '';
    const storedFilter = getSyncState(SYNC_KEY_TASKS_COMPLETED_FILTER) ?? '';

    if (storedFilter === currentFilter) {
      return;
    }

    // Filter changed - just reset the sync cursor to re-fetch with new filter
    // NO need to clear tasks - upsert logic handles deduplication via notion_id
    console.log(
      `[SyncEngine] Completed status changed (${storedFilter || 'none'} -> ${
        currentFilter || 'none'
      }). Resetting sync cursor (keeping existing tasks).`
    );
    setSyncState(SYNC_KEY_TASKS_CURSOR, '');
    setSyncState(SYNC_KEY_TASKS_LAST, '');
    clearSyncState(SYNC_KEY_INITIAL_IMPORT_DONE);
    setSyncState(SYNC_KEY_TASKS_COMPLETED_FILTER, currentFilter);
  }

  private async pushPending() {
    const pendingEntries = listPendingEntries(25);
    if (!pendingEntries.length) {
      this.updateStatus({
        pendingItems: countPendingEntries(),
        state: this.status.state === 'syncing' ? 'idle' : this.status.state
      });
      return;
    }

    this.updateStatus({
      state: 'syncing',
      pendingItems: countPendingEntries()
    });

    for (const entry of pendingEntries) {
      try {
        switch (entry.entityType) {
          case 'task':
            await this.processTaskEntry(entry as SyncQueueEntry<TaskQueuePayload>);
            break;
          case 'timeLog':
            await this.processTimeLogEntry(entry as SyncQueueEntry<TimeLogQueuePayload>);
            break;
          case 'writing':
            await this.processWritingEntry(entry as SyncQueueEntry<WritingQueuePayload>);
            break;
          default:
            markEntryComplete(entry.id);
            continue;
        }
        markEntryComplete(entry.id);
      } catch (error) {
        console.error('Failed to process sync queue entry', { entry, error });
        markEntryFailed(entry.id, error instanceof Error ? error.message : String(error));
        this.updateStatus({
          ...deriveSummaryFromError(error),
          pendingItems: countPendingEntries()
        });
        throw error;
      }
    }
  }

  private async pullRemote() {
    // Track errors but don't let one type block others
    const errors: { type: string; error: unknown }[] = [];
    let anySuccess = false;
    
    this.updateStatus({ state: 'syncing', pendingItems: countPendingEntries() });
    
    // Pull TASKS ONLY - time logs disabled due to causing 504 timeouts
    try {
      await this.pullTasks();
      anySuccess = true;
    } catch (error) {
      console.error('[SyncEngine] Failed to pull tasks', error);
      errors.push({ type: 'tasks', error });
    }
    
    // TIME LOGS DISABLED - causes 504 timeouts on complex databases
    // try {
    //   await this.pullTimeLogs();
    //   anySuccess = true;
    // } catch (error) {
    //   console.error('[SyncEngine] Failed to pull time logs', error);
    //   errors.push({ type: 'timeLogs', error });
    // }
    
    // Projects sync
    try {
      await this.pullProjects();
      anySuccess = true;
    } catch (error) {
      console.error('[SyncEngine] Failed to pull projects', error);
      errors.push({ type: 'projects', error });
    }
    
    // Clean up synced writing entries
    try {
      pruneSyncedWritingEntries();
    } catch (error) {
      console.error('[SyncEngine] Failed to prune writing entries', error);
    }
    
    // Update status based on results
    const timestamp = new Date().toISOString();
    
    if (errors.length === 0) {
      // All succeeded
      this.updateStatus({
        state: 'idle',
        pendingItems: countPendingEntries(),
        lastSuccessfulSync: timestamp,
        message: undefined
      });
    } else if (anySuccess) {
      // Partial success
      const summary = deriveSummaryFromError(errors[0].error);
      this.updateStatus({
        state: summary.state === 'offline' ? 'offline' : 'idle',
        pendingItems: countPendingEntries(),
        lastSuccessfulSync: timestamp, // Still count partial success
        message: `Partial sync: ${errors.map(e => e.type).join(', ')} failed`
      });
    } else {
      // Complete failure
      const summary = deriveSummaryFromError(errors[0].error);
      this.updateStatus({
        ...summary,
        pendingItems: countPendingEntries()
      });
    }
  }

  /**
   * Pull a single page of tasks with EXPLICIT cursor - avoids database round-trip issues.
   * This is the preferred method for initial import where we track cursor locally.
   * @returns object with completion status, tasks count, and next cursor
   */
  private async pullTasksWithCountDirect(options: { 
    pageSize?: number; 
    includeCompleted?: boolean;
    cursor: string | null;
  }): Promise<{ completed: boolean; tasksCount: number; nextCursor: string | null }> {
    const pageSize = options.pageSize ?? TASK_PAGE_SIZE;
    const includeCompleted = options.includeCompleted ?? true;
    const cursor = options.cursor;

    const { tasks, nextCursor: pageCursor } = await fetchNotionTasksPage({
      since: undefined, // No incremental filter during initial import
      includeCompleted,
      pageSize,
      cursor: cursor ?? undefined
    });

    const timestamp = new Date().toISOString();
    tasks.forEach((task) => {
      const synced = upsertRemoteTask(task, task.id, timestamp);
      this.notifyTaskUpdated(synced);
    });

    // Save cursor to DB for resume support if app restarts
    if (pageCursor) {
      setSyncState(SYNC_KEY_TASKS_CURSOR, pageCursor);
      return { completed: false, tasksCount: tasks.length, nextCursor: pageCursor };
    } else {
      setSyncState(SYNC_KEY_TASKS_CURSOR, '');
      setSyncState(SYNC_KEY_TASKS_LAST, timestamp);
      return { completed: true, tasksCount: tasks.length, nextCursor: null };
    }
  }

  /**
   * Pull a single page of tasks and return count - legacy method that reads cursor from DB.
   * @returns object with completion status and tasks count
   */
  private async pullTasksWithCount(options?: { pageSize?: number; includeCompleted?: boolean }): Promise<{ completed: boolean; tasksCount: number }> {
    const pageSize = options?.pageSize ?? TASK_PAGE_SIZE;
    const lastSync = getSyncState(SYNC_KEY_TASKS_LAST);
    const includeCompleted = options?.includeCompleted ?? true;
    
    let cursor = getSyncState(SYNC_KEY_TASKS_CURSOR);
    // Only reset cursor if it's literally empty string
    // Don't check lastSync here - during initial import, lastSync won't be set
    // but we still want to use the cursor for pagination
    if (cursor === '') {
      cursor = null;
    }

    const { tasks, nextCursor: pageCursor } = await fetchNotionTasksPage({
      since: lastSync ?? undefined,
      includeCompleted,
      pageSize,
      cursor: cursor ?? undefined
    });

    const timestamp = new Date().toISOString();
    tasks.forEach((task) => {
      const synced = upsertRemoteTask(task, task.id, timestamp);
      this.notifyTaskUpdated(synced);
    });

    if (pageCursor) {
      setSyncState(SYNC_KEY_TASKS_CURSOR, pageCursor);
      return { completed: false, tasksCount: tasks.length };
    } else {
      setSyncState(SYNC_KEY_TASKS_CURSOR, '');
      setSyncState(SYNC_KEY_TASKS_LAST, timestamp);
      return { completed: true, tasksCount: tasks.length };
    }
  }

  /**
   * Pull tasks page-by-page with cursor persistence.
   * @returns boolean indicating whether the full task sync is complete.
   */
  private async pullTasks(options?: { pageSize?: number; includeCompleted?: boolean }): Promise<boolean> {
    const pageSize = options?.pageSize ?? TASK_PAGE_SIZE;
    const lastSync = getSyncState(SYNC_KEY_TASKS_LAST);
    const isInitialImport = !lastSync;
    
    // During initial import OR incremental sync, include completed tasks
    // - Initial import: we want ALL tasks in our local DB
    // - Incremental sync: we need to see status changes (task marked completed)
    const includeCompleted = options?.includeCompleted ?? true;
    
    // IMPORTANT: Clear cursor on first run - old cursors from queries without filter
    // are incompatible with new queries that have a filter (causes 400 error)
    let cursor = getSyncState(SYNC_KEY_TASKS_CURSOR);
    if (cursor === '' || isInitialImport) {
      // No lastSync means this is initial import - start fresh without cursor
      cursor = null;
      setSyncState(SYNC_KEY_TASKS_CURSOR, '');
    }

    console.log(
      `[SyncEngine] Pulling tasks (cursor: ${cursor ?? 'start'}, pageSize: ${pageSize}, includeCompleted: ${includeCompleted}, isInitialImport: ${isInitialImport})`
    );

    let pagesFetched = 0;
    let tasksFetched = 0;
    let nextCursor: string | null = cursor ?? null;

    // Continue fetching pages until we've exhausted the cursor
    while (true) {
      const { tasks, nextCursor: pageCursor } = await fetchNotionTasksPage({
        since: lastSync ?? undefined,
        includeCompleted,
        pageSize,
        cursor: nextCursor
      });

      const timestamp = new Date().toISOString();
      tasks.forEach((task) => {
        const synced = upsertRemoteTask(task, task.id, timestamp);
        this.notifyTaskUpdated(synced);
      });

      tasksFetched += tasks.length;
      pagesFetched += 1;

      nextCursor = pageCursor ?? null;

      if (nextCursor) {
        setSyncState(SYNC_KEY_TASKS_CURSOR, nextCursor);
        
        // Add delay between pages to avoid overwhelming Notion API
        // Increase delay as we go deeper into pagination
        const baseDelay = 500;
        const depthBonus = Math.floor(pagesFetched / 50) * 250; // +250ms per 50 pages
        await sleep(baseDelay + depthBonus);
      } else {
        setSyncState(SYNC_KEY_TASKS_CURSOR, '');
        setSyncState(SYNC_KEY_TASKS_LAST, timestamp);
        console.log('[SyncEngine] Task sync cursor exhausted - tasks up to date.');
        return true;
      }

      if (!tasks.length) {
        break;
      }
    }

    if (tasksFetched === 0 && cursor === null) {
      // No tasks and no cursor means there was nothing to fetch
      setSyncState(SYNC_KEY_TASKS_CURSOR, '');
      setSyncState(SYNC_KEY_TASKS_LAST, new Date().toISOString());
      return true;
    }

    return false;
  }

  /**
   * Pull time logs with incremental sync support
   */
  private async pullTimeLogs() {
    const lastSync = getSyncState(SYNC_KEY_TIMELOGS_LAST);
    const isInitialSync = !lastSync;
    
    console.log(`[SyncEngine] Pulling time logs (${isInitialSync ? 'initial' : 'incremental'} sync)`);
    
    // getAllTimeLogs already filters to last 2 days for efficiency
    const remoteLogs = await getAllTimeLogs();
    const timestamp = new Date().toISOString();
    
    console.log(`[SyncEngine] Received ${remoteLogs.length} time logs from Notion`);
    
    remoteLogs.forEach((entry) => {
      const synced = upsertRemoteTimeLogEntry(entry, timestamp);
      this.notifyTimeLogUpdated(synced);
    });
    
    setSyncState(SYNC_KEY_TIMELOGS_LAST, timestamp);
    
    return remoteLogs.length;
  }

  /**
   * Pull projects (internal method)
   */
  private async pullProjects() {
    console.log('[SyncEngine] Pulling projects');
    
    const projects = await fetchNotionProjects();
    const timestamp = new Date().toISOString();
    
    console.log(`[SyncEngine] Received ${projects.length} projects from Notion`);
    
    projects.forEach((project) => {
      upsertProject(project, timestamp);
    });
    
    setSyncState(SYNC_KEY_PROJECTS_LAST, timestamp);
    this.notifyProjectsUpdated(listProjects());
    
    return projects.length;
  }

  /**
   * Manually import projects from Notion
   * Call this to sync projects without affecting other data types
   */
  async importProjects(): Promise<{ success: boolean; count: number; error?: string }> {
    try {
      console.log('[SyncEngine] Manual projects import started');
      const count = await this.pullProjects();
      return { success: true, count };
    } catch (error) {
      console.error('[SyncEngine] Manual projects import failed:', error);
      return { 
        success: false, 
        count: 0, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Manually import time logs from Notion
   * Call this to sync time logs without affecting other data types
   */
  async importTimeLogs(): Promise<{ success: boolean; count: number; error?: string }> {
    try {
      console.log('[SyncEngine] Manual time logs import started');
      const count = await this.pullTimeLogs();
      return { success: true, count };
    } catch (error) {
      console.error('[SyncEngine] Manual time logs import failed:', error);
      return { 
        success: false, 
        count: 0, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Get the last sync timestamps for each data type
   */
  getSyncTimestamps(): { tasks: string | null; projects: string | null; timeLogs: string | null } {
    return {
      tasks: getSyncState(SYNC_KEY_TASKS_LAST),
      projects: getSyncState(SYNC_KEY_PROJECTS_LAST),
      timeLogs: getSyncState(SYNC_KEY_TIMELOGS_LAST)
    };
  }

  private async processTaskEntry(entry: SyncQueueEntry<TaskQueuePayload>) {
    const localTask =
      getTask(entry.clientId) ??
      (entry.notionId ? getTask(entry.notionId) : null);

    if (!localTask) {
      // Nothing to sync, drop entry
      return;
    }

    if (entry.operation === 'create') {
      const payload = isCreatePayload(entry.payload)
        ? entry.payload.payload
        : convertTaskToCreatePayload(localTask);
      const remoteTask = await addTask(payload);
      const synced = upsertRemoteTask(
        remoteTask,
        remoteTask.id,
        new Date().toISOString()
      );
      this.notifyTaskUpdated(synced);
      return;
    }

    const notionId = entry.notionId ?? localTask.id;
    if (!notionId) {
      throw new Error('Task update is missing Notion ID');
    }

    const updates = isUpdatePayload(entry.payload)
      ? entry.payload.updates
      : {};

    if (Object.keys(updates).length === 0) {
      // Nothing to push; mark as synced based on local state
      const synced = upsertRemoteTask(localTask, notionId, new Date().toISOString());
      this.notifyTaskUpdated(synced);
      return;
    }

    try {
      await updateTask(notionId, updates);
      const synced = upsertRemoteTask(
        {
          ...localTask,
          id: notionId
        },
        notionId,
        new Date().toISOString()
      );
      this.notifyTaskUpdated(synced);
    } catch (error) {
      // Check if task was deleted in Notion (404 error)
      const errorMessage = error instanceof Error ? error.message : String(error);
      const is404 = errorMessage.includes('404') || 
                    errorMessage.includes('not found') || 
                    errorMessage.includes('Could not find') ||
                    errorMessage.includes('object_not_found');
      
      if (is404) {
        console.log(`[SyncEngine] Task ${notionId} not found in Notion - marking as trashed`);
        markTaskAsTrashed(entry.clientId);
        // Don't rethrow - this is expected for deleted tasks
        return;
      }
      
      // Rethrow other errors
      throw error;
    }
  }

  private async processTimeLogEntry(entry: SyncQueueEntry<TimeLogQueuePayload>) {
    const localEntry =
      getTimeLog(entry.clientId) ??
      (entry.notionId ? getTimeLog(entry.notionId) : null);

    if (entry.operation === 'create') {
      const payload = isTimeLogCreatePayload(entry.payload)
        ? entry.payload.payload
        : localEntry
          ? timeLogEntryToPayload(localEntry)
          : null;
      if (!payload) {
        throw new Error('Missing payload for time log creation');
      }
      const remoteEntry = await createTimeLogEntry(payload);
      const synced = upsertRemoteTimeLogEntry(remoteEntry, new Date().toISOString());
      this.notifyTimeLogUpdated(synced);
      return;
    }

    if (entry.operation === 'update') {
      const notionId = entry.notionId ?? localEntry?.id;
      if (!notionId) {
        throw new Error('Time log update is missing Notion ID');
      }
      const updates = isTimeLogUpdatePayload(entry.payload)
        ? entry.payload.updates
        : {};
      const remoteEntry = await updateRemoteTimeLogEntry(notionId, updates);
      const synced = upsertRemoteTimeLogEntry(remoteEntry, new Date().toISOString());
      this.notifyTimeLogUpdated(synced);
      return;
    }

    if (entry.operation === 'delete') {
      const notionId =
        (entry.payload && 'notionId' in entry.payload
          ? entry.payload.notionId
          : undefined) ??
        entry.notionId ??
        (localEntry && !localEntry.localOnly ? localEntry.id : null);
      if (!notionId) {
        return;
      }
      await deleteRemoteTimeLogEntry(notionId);
    }
  }

  private async processWritingEntry(
    entry: SyncQueueEntry<WritingQueuePayload>
  ) {
    if (entry.operation !== 'create') {
      return;
    }

    if (!isWritingCreatePayload(entry.payload)) {
      throw new Error('Writing entry payload missing');
    }

    const remoteId = await createWritingEntry(entry.payload.payload);
    markWritingEntrySynced(entry.clientId, remoteId, new Date().toISOString());
  }

  private updateStatus(next: Partial<SyncStateSummary>) {
    this.status = {
      ...this.status,
      ...next
    };
    this.emit('status', this.status);
  }

  private notifyTaskUpdated(task: Task) {
    this.emit('task-updated', task);
  }

  private notifyTimeLogUpdated(entry: TimeLogEntry) {
    this.emit('timeLog-updated', entry);
  }

  private notifyProjectsUpdated(projects: Project[]) {
    this.emit('projects-updated', projects);
  }
}

export const syncEngine = new SyncEngine();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

