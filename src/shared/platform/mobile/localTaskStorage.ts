import { Preferences } from '@capacitor/preferences';
import type { Task, NotionCreatePayload, TaskUpdatePayload, TaskStatusOption } from '@shared/types';

const STORAGE_KEYS = {
  tasks: 'mobile.local.tasks',
  taskStatuses: 'mobile.local.taskStatuses',
  lastTaskId: 'mobile.local.lastTaskId'
} as const;

// Default status options for local-only mode
const DEFAULT_STATUS_OPTIONS: TaskStatusOption[] = [
  { id: 'todo', name: 'To-do', color: 'gray' },
  { id: 'in-progress', name: 'In Progress', color: 'blue' },
  { id: 'blocked', name: 'Blocked', color: 'red' },
  { id: 'done', name: 'Done', color: 'green' }
];

// Generate a unique local ID
function generateLocalId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const localTaskStorage = {
  /**
   * Get all locally stored tasks
   */
  async getTasks(): Promise<Task[]> {
    try {
      const { value } = await Preferences.get({ key: STORAGE_KEYS.tasks });
      if (!value) return [];
      const tasks = JSON.parse(value) as Task[];
      return tasks.sort((a, b) => {
        // Sort by creation (id contains timestamp) - newest first
        return b.id.localeCompare(a.id);
      });
    } catch (error) {
      console.error('[localTaskStorage] Failed to get tasks:', error);
      return [];
    }
  },

  /**
   * Get a single task by ID
   */
  async getTask(taskId: string): Promise<Task | null> {
    const tasks = await this.getTasks();
    return tasks.find((t) => t.id === taskId) || null;
  },

  /**
   * Create a new local task
   */
  async createTask(payload: NotionCreatePayload): Promise<Task> {
    const tasks = await this.getTasks();
    const now = new Date().toISOString();
    
    const newTask: Task = {
      id: generateLocalId(),
      title: payload.title,
      status: payload.status || 'To-do',
      normalizedStatus: payload.status ? undefined : 'active',
      dueDate: payload.date,
      dueDateEnd: payload.dateEnd || undefined,
      hardDeadline: payload.hardDeadline,
      urgent: payload.urgent,
      important: payload.important,
      mainEntry: payload.mainEntry || undefined,
      projectIds: payload.projectIds,
      parentTaskId: payload.parentTaskId,
      lastEdited: now,
      localOnly: true,
      syncStatus: 'local'
    };

    tasks.unshift(newTask); // Add to beginning
    await this.saveTasks(tasks);
    
    return newTask;
  },

  /**
   * Update an existing task
   */
  async updateTask(taskId: string, updates: TaskUpdatePayload): Promise<Task> {
    const tasks = await this.getTasks();
    const index = tasks.findIndex((t) => t.id === taskId);
    
    if (index === -1) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const existingTask = tasks[index];
    // Filter out null values from updates to avoid type conflicts
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== null)
    ) as Partial<Task>;
    const updatedTask: Task = {
      ...existingTask,
      ...cleanUpdates,
      dueDate: updates.dueDate !== undefined ? updates.dueDate || undefined : existingTask.dueDate,
      dueDateEnd: updates.dueDateEnd !== undefined ? updates.dueDateEnd || undefined : existingTask.dueDateEnd,
      lastEdited: new Date().toISOString(),
      syncStatus: existingTask.syncStatus === 'synced' ? 'pending' : existingTask.syncStatus
    };

    tasks[index] = updatedTask;
    await this.saveTasks(tasks);
    
    return updatedTask;
  },

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<boolean> {
    const tasks = await this.getTasks();
    const filtered = tasks.filter((t) => t.id !== taskId);
    
    if (filtered.length === tasks.length) {
      return false; // Task not found
    }

    await this.saveTasks(filtered);
    return true;
  },

  /**
   * Save all tasks (internal helper)
   */
  async saveTasks(tasks: Task[]): Promise<void> {
    await Preferences.set({
      key: STORAGE_KEYS.tasks,
      value: JSON.stringify(tasks)
    });
  },

  /**
   * Get local status options (can be customized by user)
   */
  async getStatusOptions(): Promise<TaskStatusOption[]> {
    try {
      const { value } = await Preferences.get({ key: STORAGE_KEYS.taskStatuses });
      if (!value) return [...DEFAULT_STATUS_OPTIONS];
      return JSON.parse(value) as TaskStatusOption[];
    } catch (error) {
      console.error('[localTaskStorage] Failed to get status options:', error);
      return [...DEFAULT_STATUS_OPTIONS];
    }
  },

  /**
   * Save custom status options
   */
  async setStatusOptions(options: TaskStatusOption[]): Promise<void> {
    await Preferences.set({
      key: STORAGE_KEYS.taskStatuses,
      value: JSON.stringify(options)
    });
  },

  /**
   * Merge tasks from Notion import (used during sync)
   */
  async mergeNotionTasks(notionTasks: Task[]): Promise<{ added: number; updated: number }> {
    const localTasks = await this.getTasks();
    let added = 0;
    let updated = 0;

    for (const notionTask of notionTasks) {
      // Check if we already have this task (by Notion ID)
      const existingIndex = localTasks.findIndex((t) => t.id === notionTask.id);
      
      if (existingIndex === -1) {
        // New task from Notion
        localTasks.push({
          ...notionTask,
          syncStatus: 'synced',
          localOnly: false
        });
        added++;
      } else {
        // Update existing task if Notion version is newer
        const existing = localTasks[existingIndex];
        const existingDate = existing.lastEdited ? new Date(existing.lastEdited).getTime() : 0;
        const notionDate = notionTask.lastEdited ? new Date(notionTask.lastEdited).getTime() : 0;
        
        if (notionDate >= existingDate && existing.syncStatus !== 'pending') {
          localTasks[existingIndex] = {
            ...notionTask,
            syncStatus: 'synced',
            localOnly: false
          };
          updated++;
        }
      }
    }

    await this.saveTasks(localTasks);
    return { added, updated };
  },

  /**
   * Get tasks that need to be synced to Notion
   */
  async getPendingSyncTasks(): Promise<Task[]> {
    const tasks = await this.getTasks();
    return tasks.filter((t) => t.syncStatus === 'pending' || t.syncStatus === 'local');
  },

  /**
   * Mark a task as synced
   */
  async markTaskSynced(localId: string, notionId: string): Promise<void> {
    const tasks = await this.getTasks();
    const index = tasks.findIndex((t) => t.id === localId);
    
    if (index !== -1) {
      tasks[index] = {
        ...tasks[index],
        id: notionId, // Replace local ID with Notion ID
        syncStatus: 'synced',
        localOnly: false
      };
      await this.saveTasks(tasks);
    }
  },

  /**
   * Clear all local tasks (use with caution!)
   */
  async clearAllTasks(): Promise<void> {
    await Preferences.remove({ key: STORAGE_KEYS.tasks });
  }
};

export type SyncStatus = 'local' | 'pending' | 'synced' | 'error';

