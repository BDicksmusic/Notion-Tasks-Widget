import { randomUUID } from 'node:crypto';
import type {
  NotionCreatePayload,
  StatusBreakdown,
  SyncStatus,
  Task,
  TaskUpdatePayload
} from '../../../shared/types';
import { mapStatusToFilterValue } from '../../../shared/statusFilters';
import { getDb } from '../database';
import {
  clearEntriesForEntity,
  enqueueSyncEntry
} from './syncQueueRepository';

type TaskRow = {
  client_id: string;
  notion_id: string | null;
  payload: string;
  sync_status: SyncStatus;
  last_modified_local: number;
  last_modified_notion: number;
  field_local_ts: string;
  field_notion_ts: string;
  // Local-only columns for recurring, subtasks, snooze, reminder, and time tracking
  snoozed_until: string | null;
  reminder_at: string | null;
  tracking_goal_minutes: number | null;
  done_tracking_after_cycle: number | null;
  auto_fill_estimated_time: number | null;
  // Trash tracking
  trashed_at: string | null;
};

type FieldMap = Record<string, string>;

const TABLE = 'tasks';

function parseFieldMap(raw: string | null | undefined): FieldMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as FieldMap;
    }
  } catch {
    // ignore
  }
  return {};
}

function serializeFieldMap(map: FieldMap) {
  return JSON.stringify(map ?? {});
}

function mapRowToTask(row: TaskRow): Task {
  const task = JSON.parse(row.payload) as Task;
  task.id = task.id ?? row.notion_id ?? row.client_id;
  task.syncStatus = row.sync_status;
  task.localOnly = !row.notion_id;
  // Apply local-only fields from columns
  if (row.snoozed_until) {
    task.snoozedUntil = row.snoozed_until;
  }
  if (row.reminder_at) {
    task.reminderAt = row.reminder_at;
  }
  if (row.tracking_goal_minutes != null) {
    task.trackingGoalMinutes = row.tracking_goal_minutes;
  }
  if (row.done_tracking_after_cycle != null) {
    task.doneTrackingAfterCycle = row.done_tracking_after_cycle === 1;
  }
  if (row.auto_fill_estimated_time != null) {
    task.autoFillEstimatedTime = row.auto_fill_estimated_time === 1;
  }
  // Trash tracking
  if (row.trashed_at) {
    task.trashedAt = row.trashed_at;
  }
  return task;
}

function touchFields(map: FieldMap, fields: string[]) {
  if (!fields.length) return map;
  const iso = new Date().toISOString();
  const next = { ...map };
  fields.forEach((field) => {
    next[field] = iso;
  });
  return next;
}

function readRowById(taskId: string): TaskRow | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM ${TABLE} WHERE client_id = ? OR notion_id = ? LIMIT 1`
    )
    .get(taskId, taskId) as TaskRow | undefined;
}

function saveTaskRow(
  clientId: string,
  payload: Task,
  syncStatus: SyncStatus,
  options: {
    notionId?: string | null;
    lastModifiedLocal?: number;
    lastModifiedNotion?: number;
    fieldLocal?: FieldMap;
    fieldNotion?: FieldMap;
    snoozedUntil?: string | null;
    reminderAt?: string | null;
    trackingGoalMinutes?: number | null;
    doneTrackingAfterCycle?: boolean | null;
    autoFillEstimatedTime?: boolean | null;
  }
) {
  const db = getDb();
  const {
    notionId = null,
    lastModifiedLocal = Date.now(),
    lastModifiedNotion = 0,
    fieldLocal = {},
    fieldNotion = {},
    snoozedUntil = null,
    reminderAt = null,
    trackingGoalMinutes = null,
    doneTrackingAfterCycle = null,
    autoFillEstimatedTime = null
  } = options;
  const serializedTask = JSON.stringify(payload);
  db.prepare(
    `INSERT INTO ${TABLE} (
      client_id,
      notion_id,
      payload,
      sync_status,
      last_modified_local,
      last_modified_notion,
      field_local_ts,
      field_notion_ts,
      snoozed_until,
      reminder_at,
      tracking_goal_minutes,
      done_tracking_after_cycle,
      auto_fill_estimated_time
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET
      notion_id = excluded.notion_id,
      payload = excluded.payload,
      sync_status = excluded.sync_status,
      last_modified_local = excluded.last_modified_local,
      last_modified_notion = excluded.last_modified_notion,
      field_local_ts = excluded.field_local_ts,
      field_notion_ts = excluded.field_notion_ts,
      snoozed_until = excluded.snoozed_until,
      reminder_at = excluded.reminder_at,
      tracking_goal_minutes = excluded.tracking_goal_minutes,
      done_tracking_after_cycle = excluded.done_tracking_after_cycle,
      auto_fill_estimated_time = excluded.auto_fill_estimated_time`
  ).run(
    clientId,
    notionId ?? null,
    serializedTask,
    syncStatus,
    lastModifiedLocal,
    lastModifiedNotion,
    serializeFieldMap(fieldLocal),
    serializeFieldMap(fieldNotion),
    snoozedUntil,
    reminderAt,
    trackingGoalMinutes,
    doneTrackingAfterCycle === null ? null : (doneTrackingAfterCycle ? 1 : 0),
    autoFillEstimatedTime === null ? null : (autoFillEstimatedTime ? 1 : 0)
  );
}

function extractChangedFields(input: object) {
  return Array.from(
    new Set(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key)
    )
  );
}

export function taskToCreatePayload(task: Task): NotionCreatePayload {
  return {
    title: task.title,
    status: task.status ?? undefined,
    date: task.dueDate ?? undefined,
    dateEnd: task.dueDateEnd ?? undefined,
    hardDeadline: task.hardDeadline ?? undefined,
    urgent: task.urgent ?? undefined,
    important: task.important ?? undefined,
    mainEntry: task.mainEntry ?? undefined
  };
}

function updatesToCreatePayload(
  updates: TaskUpdatePayload
): Partial<NotionCreatePayload> {
  const createPayload: Partial<NotionCreatePayload> = {};
  if (updates.title !== undefined) {
    createPayload.title = updates.title ?? '';
  }
  if (updates.status !== undefined) {
    createPayload.status = updates.status ?? undefined;
  }
  if (updates.dueDate !== undefined) {
    createPayload.date = updates.dueDate ?? undefined;
  }
  if (updates.dueDateEnd !== undefined) {
    createPayload.dateEnd = updates.dueDateEnd ?? undefined;
  }
  if (updates.hardDeadline !== undefined) {
    createPayload.hardDeadline = updates.hardDeadline;
  }
  if (updates.urgent !== undefined) {
    createPayload.urgent = updates.urgent;
  }
  if (updates.important !== undefined) {
    createPayload.important = updates.important;
  }
  if (updates.mainEntry !== undefined) {
    createPayload.mainEntry = updates.mainEntry ?? undefined;
  }
  return createPayload;
}

export function listTasks(limit = 2000, includeTrash = false) {
  const db = getDb();
  // By default, exclude trashed tasks from the main list
  const query = includeTrash
    ? `SELECT * FROM ${TABLE} ORDER BY last_modified_local DESC LIMIT ?`
    : `SELECT * FROM ${TABLE} WHERE sync_status != 'trashed' ORDER BY last_modified_local DESC LIMIT ?`;
  const rows = db.prepare(query).all(limit) as TaskRow[];
  const tasks = rows.map(mapRowToTask);
  
  const withStatus = tasks.filter(t => t.status).length;
  console.log(`[DB] listTasks: ${tasks.length} tasks (limit: ${limit}), ${withStatus} have status`);
  
  // Sample first few
  tasks.slice(0, 3).forEach((t, i) => {
    console.log(`[DB] Task ${i + 1}: "${t.title}" → status="${t.status}"`);
  });
  
  return tasks;
}

export function countTasks(): number {
  const db = getDb();
  const result = db.prepare(`SELECT COUNT(*) as count FROM ${TABLE}`).get() as { count: number };
  return result.count;
}

export function getOldestSyncTimestamp(): string | null {
  const db = getDb();
  // last_modified_notion is stored as epoch milliseconds
  const result = db.prepare(
    `SELECT MIN(last_modified_notion) as oldest FROM ${TABLE} WHERE last_modified_notion > 0`
  ).get() as { oldest: number | null };
  if (result?.oldest) {
    // Convert epoch ms to ISO string
    return new Date(result.oldest).toISOString();
  }
  return null;
}

export function getTask(taskId: string) {
  const row = readRowById(taskId);
  return row ? mapRowToTask(row) : null;
}

export function createLocalTask(payload: NotionCreatePayload) {
  const clientId = `local-${randomUUID()}`;
  const trimmedTitle = payload.title?.trim();
  if (!trimmedTitle) {
    throw new Error('Task title cannot be empty');
  }

  const normalizedStatus =
    mapStatusToFilterValue(payload.status ?? undefined) ??
    payload.status ??
    undefined;

  const task: Task = {
    id: clientId,
    title: trimmedTitle,
    status: payload.status ?? undefined,
    normalizedStatus,
    mainEntry: payload.mainEntry ?? undefined,
    dueDate: payload.date ?? undefined,
    dueDateEnd: payload.dateEnd ?? undefined,
    hardDeadline: payload.hardDeadline ?? false,
    urgent: payload.urgent ?? false,
    important: payload.important ?? false,
    syncStatus: 'pending',
    localOnly: true,
    // Subtask relationship
    parentTaskId: payload.parentTaskId ?? undefined
  };

  saveTaskRow(clientId, task, 'pending', {
    notionId: null,
    lastModifiedLocal: Date.now(),
    lastModifiedNotion: 0,
    fieldLocal: touchFields({}, extractChangedFields(payload))
  });

  enqueueSyncEntry(
    'task',
    clientId,
    'create',
    { payload, clientId },
    extractChangedFields(payload)
  );

  // If this is a subtask, update the parent's subtaskIds and subtaskProgress
  if (payload.parentTaskId) {
    updateParentSubtaskInfo(payload.parentTaskId);
  }

  return task;
}

/**
 * Update a parent task's subtaskIds and subtaskProgress based on its current subtasks
 */
export function updateParentSubtaskInfo(parentTaskId: string) {
  const parentRow = readRowById(parentTaskId);
  if (!parentRow) return;

  const parentTask = mapRowToTask(parentRow);
  const subtasks = getSubtasks(parentTaskId);
  
  // Calculate progress
  const completedCount = subtasks.filter(st => {
    // Consider a task completed if its normalizedStatus is 'done' or status contains 'done'/'complete'
    const status = (st.normalizedStatus || st.status || '').toLowerCase();
    return status === 'done' || status.includes('complete') || status.includes('done');
  }).length;

  // Update parent with new subtask info
  const nextParent: Task = {
    ...parentTask,
    subtaskIds: subtasks.map(st => st.id),
    subtaskProgress: { completed: completedCount, total: subtasks.length }
  };

  // Save updated parent (don't sync to Notion, this is local-only metadata)
  const db = getDb();
  db.prepare(`UPDATE ${TABLE} SET payload = ? WHERE client_id = ? OR notion_id = ?`)
    .run(JSON.stringify(nextParent), parentTaskId, parentTaskId);
}

export function updateLocalTask(taskId: string, updates: TaskUpdatePayload) {
  const row = readRowById(taskId);
  if (!row) {
    throw new Error(`Unable to find task ${taskId}`);
  }

  const task = mapRowToTask(row);
  const nextTask: Task = { ...task };
  if (updates.title !== undefined && updates.title !== null) {
    nextTask.title = updates.title;
  }
  if (updates.status !== undefined) {
    nextTask.status = updates.status ?? undefined;
    nextTask.normalizedStatus =
      updates.status === null
        ? undefined
        : mapStatusToFilterValue(updates.status ?? undefined) ??
          updates.status ??
          nextTask.normalizedStatus;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'dueDate')) {
    nextTask.dueDate = updates.dueDate ?? undefined;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'dueDateEnd')) {
    nextTask.dueDateEnd = updates.dueDateEnd ?? undefined;
  }
  if (updates.hardDeadline !== undefined) {
    nextTask.hardDeadline = updates.hardDeadline;
  }
  if (updates.urgent !== undefined) {
    nextTask.urgent = updates.urgent;
  }
  if (updates.important !== undefined) {
    nextTask.important = updates.important;
  }
  if (updates.mainEntry !== undefined) {
    nextTask.mainEntry = updates.mainEntry ?? undefined;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'sessionLengthMinutes')) {
    nextTask.sessionLengthMinutes = updates.sessionLengthMinutes ?? null;
  }
  if (
    Object.prototype.hasOwnProperty.call(updates, 'estimatedLengthMinutes')
  ) {
    nextTask.estimatedLengthMinutes = updates.estimatedLengthMinutes ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'orderValue')) {
    nextTask.orderValue = updates.orderValue ?? null;
  }
  // Handle recurrence updates (synced to Notion)
  if (Object.prototype.hasOwnProperty.call(updates, 'recurrence')) {
    nextTask.recurrence = updates.recurrence ?? undefined;
  }

  nextTask.syncStatus = 'pending';
  nextTask.localOnly = !row.notion_id;

  const changedFields = extractChangedFields(updates);
  // Filter out local-only fields from changed fields sent to Notion
  const localOnlyFields = ['snoozedUntil', 'reminderAt', 'trackingGoalMinutes', 'doneTrackingAfterCycle', 'autoFillEstimatedTime'];
  const notionChangedFields = changedFields.filter(f => !localOnlyFields.includes(f));
  const fieldLocalTs = touchFields(parseFieldMap(row.field_local_ts), notionChangedFields);

  // Determine local-only field values
  const snoozedUntil = Object.prototype.hasOwnProperty.call(updates, 'snoozedUntil')
    ? updates.snoozedUntil ?? null
    : row.snoozed_until;
  const reminderAt = Object.prototype.hasOwnProperty.call(updates, 'reminderAt')
    ? updates.reminderAt ?? null
    : row.reminder_at;
  const trackingGoalMinutes = Object.prototype.hasOwnProperty.call(updates, 'trackingGoalMinutes')
    ? updates.trackingGoalMinutes ?? null
    : row.tracking_goal_minutes;
  const doneTrackingAfterCycle = Object.prototype.hasOwnProperty.call(updates, 'doneTrackingAfterCycle')
    ? updates.doneTrackingAfterCycle ?? null
    : row.done_tracking_after_cycle === 1;
  const autoFillEstimatedTime = Object.prototype.hasOwnProperty.call(updates, 'autoFillEstimatedTime')
    ? updates.autoFillEstimatedTime ?? null
    : row.auto_fill_estimated_time === 1;

  saveTaskRow(row.client_id, nextTask, 'pending', {
    notionId: row.notion_id,
    lastModifiedLocal: Date.now(),
    lastModifiedNotion: row.last_modified_notion,
    fieldLocal: fieldLocalTs,
    fieldNotion: parseFieldMap(row.field_notion_ts),
    snoozedUntil,
    reminderAt,
    trackingGoalMinutes,
    doneTrackingAfterCycle,
    autoFillEstimatedTime
  });

  const queuePayload = row.notion_id
    ? { updates, clientId: row.client_id }
    : {
        payload: {
          ...taskToCreatePayload(nextTask),
          ...updatesToCreatePayload(updates)
        },
        clientId: row.client_id
      };

  // Only enqueue sync if there are Notion-syncable changes
  if (notionChangedFields.length > 0) {
    enqueueSyncEntry(
      'task',
      row.client_id,
      row.notion_id ? 'update' : 'create',
      queuePayload,
      notionChangedFields,
      row.notion_id
    );
  }

  return nextTask;
}

export function getTaskStatusBreakdown(): StatusBreakdown {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT payload, last_modified_local FROM ${TABLE}`
    )
    .all() as Pick<TaskRow, 'payload' | 'last_modified_local'>[];

  const counts = new Map<string, number>();
  let withStatus = 0;
  let withoutStatus = 0;
  let latest = 0;

  rows.forEach((row) => {
    const task = JSON.parse(row.payload) as Task;
    const statusName = (task.status?.trim() || 'No Status');
    if (statusName === 'No Status') {
      withoutStatus += 1;
    } else {
      withStatus += 1;
    }
    counts.set(statusName, (counts.get(statusName) ?? 0) + 1);
    if (row.last_modified_local > latest) {
      latest = row.last_modified_local;
    }
  });

  return {
    total: rows.length,
    withStatus,
    withoutStatus,
    unique: counts.size,
    lastUpdated: latest ? new Date(latest).toISOString() : null,
    statuses: Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
  };
}

export function upsertRemoteTask(entity: Task, notionId: string, notionUpdatedAt: string) {
  const row = readRowById(notionId);
  const existingLocal = row ? mapRowToTask(row) : null;
  const clientId = row?.client_id ?? entity.id ?? notionId;

  const fieldNotion = touchFields(
    parseFieldMap(row?.field_notion_ts),
    Object.keys(entity)
  );

  const normalizedStatus =
    mapStatusToFilterValue(entity.status ?? entity.normalizedStatus) ??
    entity.normalizedStatus ??
    entity.status ??
    undefined;

  const payload: Task = {
    ...entity,
    id: notionId,
    normalizedStatus,
    syncStatus: 'synced',
    localOnly: false
  };

  saveTaskRow(clientId, payload, 'synced', {
    notionId,
    lastModifiedLocal: existingLocal ? row!.last_modified_local : Date.now(),
    lastModifiedNotion: Date.parse(notionUpdatedAt),
    fieldLocal: parseFieldMap(row?.field_local_ts),
    fieldNotion
  });

  clearEntriesForEntity('task', clientId);
  return payload;
}

export function removeLocalTask(taskId: string) {
  const row = readRowById(taskId);
  if (!row) return;
  const db = getDb();
  db.prepare(`DELETE FROM ${TABLE} WHERE client_id = ?`).run(row.client_id);
  clearEntriesForEntity('task', row.client_id);
}

export function clearAllTasks() {
  const db = getDb();
  db.prepare(`DELETE FROM ${TABLE}`).run();
  console.log('[DB] Cleared all cached tasks');
}

/**
 * Import tasks from the JSON file created by the import script.
 * This is a one-time operation - once imported, tasks are in SQLite and load instantly.
 */
export function importTasksFromJson(jsonPath: string): number {
  const fs = require('fs');
  const path = require('path');
  
  if (!fs.existsSync(jsonPath)) {
    console.log('[DB] No import file found at:', jsonPath);
    return 0;
  }
  
  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw);
    
    if (!data.tasks || !Array.isArray(data.tasks)) {
      console.log('[DB] Invalid import file format');
      return 0;
    }
    
    console.log(`[DB] Importing ${data.tasks.length} tasks from JSON...`);
    
    let imported = 0;
    const db = getDb();
    
    // Use a transaction for better performance
    const insertMany = db.transaction((tasks: any[]) => {
      for (const task of tasks) {
        if (!task.id || !task.title) continue;
        
        const normalizedStatus =
          mapStatusToFilterValue(task.status ?? task.normalizedStatus) ??
          task.normalizedStatus ??
          task.status ??
          undefined;
        
        const payload: Task = {
          id: task.id,
          title: task.title,
          status: task.status ?? undefined,
          normalizedStatus,
          mainEntry: task.mainEntry ?? undefined,
          dueDate: task.dueDate ?? undefined,
          dueDateEnd: task.dueDateEnd ?? undefined,
          hardDeadline: task.hardDeadline ?? false,
          urgent: task.urgent ?? false,
          important: task.important ?? false,
          sessionLengthMinutes: task.sessionLengthMinutes ?? null,
          estimatedLengthMinutes: task.estimatedLengthMinutes ?? null,
          url: task.url ?? undefined,
          syncStatus: 'synced',
          localOnly: false
        };
        
        // Check if task already exists
        const existing = readRowById(task.id);
        if (!existing) {
          saveTaskRow(task.id, payload, 'synced', {
            notionId: task.id,
            lastModifiedLocal: Date.now(),
            lastModifiedNotion: Date.now()
          });
          imported++;
        }
      }
    });
    
    insertMany(data.tasks);
    
    console.log(`[DB] Successfully imported ${imported} new tasks`);
    
    // Rename the import file so we don't import again
    const backupPath = jsonPath.replace('.json', `-imported-${Date.now()}.json`);
    fs.renameSync(jsonPath, backupPath);
    console.log(`[DB] Moved import file to: ${path.basename(backupPath)}`);
    
    return imported;
  } catch (error) {
    console.error('[DB] Error importing tasks from JSON:', error);
    return 0;
  }
}

/**
 * Get the count of tasks in the database
 */
export function getTaskCount(): number {
  const db = getDb();
  const result = db.prepare(`SELECT COUNT(*) as count FROM ${TABLE}`).get() as { count: number };
  return result.count;
}

/**
 * Build subtask relationships for a list of tasks.
 * For each parent task, populates subtaskIds and subtaskProgress.
 * Returns tasks sorted with parent tasks first (subtasks filtered out of main list).
 */
export function buildSubtaskRelationships(
  tasks: Task[],
  completedStatus?: string
): { parentTasks: Task[]; subtaskMap: Map<string, Task[]> } {
  // Create a map of parent ID -> subtasks
  const subtaskMap = new Map<string, Task[]>();
  const parentTasks: Task[] = [];
  
  // First pass: identify subtasks and group them by parent
  for (const task of tasks) {
    if (task.parentTaskId) {
      // This is a subtask
      const existing = subtaskMap.get(task.parentTaskId) || [];
      existing.push(task);
      subtaskMap.set(task.parentTaskId, existing);
    } else {
      // This is a parent task (or standalone task)
      parentTasks.push(task);
    }
  }
  
  // Second pass: enrich parent tasks with subtask info
  for (const task of parentTasks) {
    const subtasks = subtaskMap.get(task.id);
    if (subtasks && subtasks.length > 0) {
      task.subtaskIds = subtasks.map(s => s.id);
      
      // Calculate progress
      const completed = subtasks.filter(s => s.status === completedStatus).length;
      task.subtaskProgress = {
        completed,
        total: subtasks.length
      };
    }
  }
  
  return { parentTasks, subtaskMap };
}

/**
 * Get all subtasks for a given parent task ID
 */
export function getSubtasks(parentTaskId: string): Task[] {
  const allTasks = listTasks();
  return allTasks.filter(task => task.parentTaskId === parentTaskId);
}

// ============================================================================
// TRASH MANAGEMENT
// Tasks deleted in Notion are marked as trashed rather than immediately deleted
// ============================================================================

/**
 * Mark a task as trashed (detected as deleted in Notion)
 */
export function markTaskAsTrashed(taskId: string): void {
  const db = getDb();
  const trashedAt = new Date().toISOString();
  db.prepare(
    `UPDATE ${TABLE} SET sync_status = 'trashed', trashed_at = ? WHERE client_id = ? OR notion_id = ?`
  ).run(trashedAt, taskId, taskId);
  console.log(`[TaskRepo] Marked task as trashed: ${taskId}`);
}

/**
 * Mark multiple tasks as trashed in a single transaction
 */
export function markTasksAsTrashed(taskIds: string[]): number {
  if (taskIds.length === 0) return 0;
  
  const db = getDb();
  const trashedAt = new Date().toISOString();
  let count = 0;
  
  const markTrashed = db.transaction(() => {
    for (const taskId of taskIds) {
      const result = db.prepare(
        `UPDATE ${TABLE} SET sync_status = 'trashed', trashed_at = ? WHERE (client_id = ? OR notion_id = ?) AND sync_status != 'trashed'`
      ).run(trashedAt, taskId, taskId);
      count += result.changes;
    }
  });
  
  markTrashed();
  if (count > 0) {
    console.log(`[TaskRepo] Marked ${count} tasks as trashed`);
  }
  return count;
}

/**
 * List all trashed tasks
 */
export function listTrashedTasks(): Task[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM ${TABLE} WHERE sync_status = 'trashed' ORDER BY trashed_at DESC`)
    .all() as TaskRow[];
  return rows.map(mapRowToTask);
}

/**
 * Count trashed tasks
 */
export function countTrashedTasks(): number {
  const db = getDb();
  const result = db
    .prepare(`SELECT COUNT(*) as count FROM ${TABLE} WHERE sync_status = 'trashed'`)
    .get() as { count: number };
  return result.count;
}

/**
 * Restore a task from trash (set back to synced status)
 */
export function restoreTaskFromTrash(taskId: string): Task | null {
  const db = getDb();
  const result = db.prepare(
    `UPDATE ${TABLE} SET sync_status = 'synced', trashed_at = NULL WHERE (client_id = ? OR notion_id = ?) AND sync_status = 'trashed'`
  ).run(taskId, taskId);
  
  if (result.changes === 0) {
    return null;
  }
  
  console.log(`[TaskRepo] Restored task from trash: ${taskId}`);
  const row = readRowById(taskId);
  return row ? mapRowToTask(row) : null;
}

/**
 * Permanently delete a task (removes from database entirely)
 */
export function permanentlyDeleteTask(taskId: string): boolean {
  const db = getDb();
  const result = db.prepare(
    `DELETE FROM ${TABLE} WHERE client_id = ? OR notion_id = ?`
  ).run(taskId, taskId);
  
  // Also clear any sync queue entries
  clearEntriesForEntity('task', taskId);
  
  if (result.changes > 0) {
    console.log(`[TaskRepo] Permanently deleted task: ${taskId}`);
    return true;
  }
  return false;
}

/**
 * Permanently delete all trashed tasks
 */
export function emptyTrash(): number {
  const db = getDb();
  const trashedTasks = listTrashedTasks();
  
  let deleted = 0;
  const deleteAll = db.transaction(() => {
    for (const task of trashedTasks) {
      const result = db.prepare(
        `DELETE FROM ${TABLE} WHERE client_id = ? OR notion_id = ?`
      ).run(task.id, task.id);
      deleted += result.changes;
      clearEntriesForEntity('task', task.id);
    }
  });
  
  deleteAll();
  if (deleted > 0) {
    console.log(`[TaskRepo] Emptied trash: ${deleted} tasks permanently deleted`);
  }
  return deleted;
}

/**
 * Auto-cleanup: permanently delete tasks that have been in trash for more than X days
 */
export function cleanupOldTrashedTasks(daysOld: number = 30): number {
  const db = getDb();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  const cutoffIso = cutoffDate.toISOString();
  
  // First get the tasks to delete (so we can clear sync queue entries)
  const oldTrashedRows = db.prepare(
    `SELECT client_id FROM ${TABLE} WHERE sync_status = 'trashed' AND trashed_at < ?`
  ).all(cutoffIso) as { client_id: string }[];
  
  if (oldTrashedRows.length === 0) {
    return 0;
  }
  
  let deleted = 0;
  const cleanup = db.transaction(() => {
    for (const row of oldTrashedRows) {
      db.prepare(`DELETE FROM ${TABLE} WHERE client_id = ?`).run(row.client_id);
      clearEntriesForEntity('task', row.client_id);
      deleted++;
    }
  });
  
  cleanup();
  console.log(`[TaskRepo] Auto-cleaned ${deleted} tasks older than ${daysOld} days from trash`);
  return deleted;
}

/**
 * Get all notion_ids for synced (non-trashed, non-local) tasks
 * Used to detect which tasks have been deleted in Notion
 */
export function getSyncedTaskNotionIds(): Set<string> {
  const db = getDb();
  const rows = db.prepare(
    `SELECT notion_id FROM ${TABLE} WHERE notion_id IS NOT NULL AND sync_status != 'trashed' AND sync_status != 'local'`
  ).all() as { notion_id: string }[];
  return new Set(rows.map(r => r.notion_id));
}

