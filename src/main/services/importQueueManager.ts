import { EventEmitter } from 'node:events';

/**
 * Import types that can be queued
 */
export type ImportType = 'tasks' | 'projects' | 'contacts' | 'timeLogs';

/**
 * Status of an import operation
 */
export interface ImportJobStatus {
  type: ImportType;
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'error';
  progress?: number;
  message?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/**
 * Import job definition
 */
interface ImportJob {
  type: ImportType;
  priority: number; // Higher = more important
  executor: (abortSignal: AbortSignal) => Promise<void>;
  resolve: (value: ImportJobStatus) => void;
  reject: (reason: any) => void;
}

/**
 * ImportQueueManager ensures only ONE import operation runs at a time.
 * 
 * Key behaviors:
 * 1. When a new import is requested, any currently running import is cancelled
 * 2. The new import starts immediately after cancellation
 * 3. Progress is tracked and emitted for UI updates
 * 
 * This prevents:
 * - Notion API rate limiting from concurrent requests
 * - 504 timeouts from too many parallel connections
 * - Resource contention between different database imports
 */
class ImportQueueManager extends EventEmitter {
  private currentJob: {
    type: ImportType;
    abortController: AbortController;
    startedAt: Date;
  } | null = null;
  
  private jobStatuses: Map<ImportType, ImportJobStatus> = new Map();
  
  constructor() {
    super();
    // Initialize all job statuses as idle
    const types: ImportType[] = ['tasks', 'projects', 'contacts', 'timeLogs'];
    types.forEach(type => {
      this.jobStatuses.set(type, {
        type,
        status: 'completed',
        message: 'Ready'
      });
    });
  }
  
  /**
   * Get the currently running import type, if any
   */
  getCurrentImport(): ImportType | null {
    return this.currentJob?.type ?? null;
  }
  
  /**
   * Get status of all import types
   */
  getAllStatuses(): ImportJobStatus[] {
    return Array.from(this.jobStatuses.values());
  }
  
  /**
   * Get status for a specific import type
   */
  getStatus(type: ImportType): ImportJobStatus {
    return this.jobStatuses.get(type) ?? {
      type,
      status: 'completed',
      message: 'Ready'
    };
  }
  
  /**
   * Check if a specific import type is currently running
   */
  isRunning(type: ImportType): boolean {
    return this.currentJob?.type === type;
  }
  
  /**
   * Check if ANY import is currently running
   */
  isAnyRunning(): boolean {
    return this.currentJob !== null;
  }
  
  /**
   * Request an import operation. This will:
   * 1. Cancel any currently running import
   * 2. Start the new import immediately
   * 
   * @param type - The type of import to run
   * @param executor - Function that performs the import, receives AbortSignal for cancellation
   * @returns Promise that resolves with the job status when complete
   */
  async requestImport(
    type: ImportType,
    executor: (abortSignal: AbortSignal) => Promise<void>
  ): Promise<ImportJobStatus> {
    console.log(`[ImportQueue] Import requested: ${type}`);
    
    // Cancel any currently running import
    if (this.currentJob) {
      const cancelledType = this.currentJob.type;
      console.log(`[ImportQueue] Cancelling current import: ${cancelledType} (to make room for ${type})`);
      
      this.currentJob.abortController.abort();
      
      // Update the cancelled job's status
      this.updateStatus(cancelledType, {
        status: 'cancelled',
        message: `Cancelled to make room for ${type} import`,
        completedAt: new Date().toISOString()
      });
      
      // Wait a moment for cleanup
      await sleep(100);
    }
    
    // Create abort controller for this job
    const abortController = new AbortController();
    
    // Register this job as current
    this.currentJob = {
      type,
      abortController,
      startedAt: new Date()
    };
    
    // Update status to running
    this.updateStatus(type, {
      status: 'running',
      message: 'Starting import...',
      startedAt: this.currentJob.startedAt.toISOString(),
      progress: 0
    });
    
    try {
      // Execute the import
      await executor(abortController.signal);
      
      // Check if we were aborted
      if (abortController.signal.aborted) {
        throw new Error('Import was cancelled');
      }
      
      // Success!
      const finalStatus: ImportJobStatus = {
        type,
        status: 'completed',
        message: 'Import completed successfully',
        completedAt: new Date().toISOString(),
        progress: 100
      };
      
      this.updateStatus(type, finalStatus);
      console.log(`[ImportQueue] Import completed: ${type}`);
      
      return finalStatus;
      
    } catch (error) {
      const isAborted = error instanceof Error && 
        (error.message.includes('abort') || error.message.includes('cancel') || abortController.signal.aborted);
      
      const finalStatus: ImportJobStatus = {
        type,
        status: isAborted ? 'cancelled' : 'error',
        message: isAborted ? 'Import cancelled' : 'Import failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString()
      };
      
      this.updateStatus(type, finalStatus);
      
      if (!isAborted) {
        console.error(`[ImportQueue] Import failed: ${type}`, error);
      } else {
        console.log(`[ImportQueue] Import cancelled: ${type}`);
      }
      
      return finalStatus;
      
    } finally {
      // Clear current job if it's still this one
      if (this.currentJob?.type === type) {
        this.currentJob = null;
      }
    }
  }
  
  /**
   * Update progress for the current import
   */
  updateProgress(type: ImportType, progress: number, message?: string) {
    if (this.currentJob?.type !== type) {
      return; // Not our job
    }
    
    this.updateStatus(type, {
      progress,
      message: message ?? `Importing... ${progress}%`
    });
  }
  
  /**
   * Cancel a specific import type (if it's running)
   */
  cancelImport(type: ImportType): boolean {
    console.log(`[ImportQueue] Cancel requested for: ${type}, currentJob: ${this.currentJob?.type ?? 'none'}`);
    
    if (this.currentJob?.type !== type) {
      console.log(`[ImportQueue] Cannot cancel - job type mismatch or no job running`);
      return false;
    }
    
    console.log(`[ImportQueue] Aborting import: ${type}`);
    this.currentJob.abortController.abort();
    
    // Update status immediately to reflect cancellation
    this.updateStatus(type, {
      status: 'cancelled',
      message: 'Cancelling...'
    });
    
    return true;
  }
  
  /**
   * Cancel any running import
   */
  cancelAll(): void {
    if (this.currentJob) {
      console.log(`[ImportQueue] Cancel all requested (currently running: ${this.currentJob.type})`);
      this.currentJob.abortController.abort();
    }
  }
  
  /**
   * Update and emit status change
   */
  private updateStatus(type: ImportType, update: Partial<ImportJobStatus>) {
    const current = this.jobStatuses.get(type) ?? { type, status: 'completed' };
    const updated = { ...current, ...update, type };
    this.jobStatuses.set(type, updated);
    
    this.emit('status-changed', type, updated);
    this.emit('all-status-changed', this.getAllStatuses());
  }
  
  /**
   * Check if an abort signal has been triggered
   */
  checkAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new Error('Import was cancelled');
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Export singleton instance
export const importQueueManager = new ImportQueueManager();

