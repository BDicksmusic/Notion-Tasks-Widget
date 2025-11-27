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

/**
 * Task row with dedicated columns for performance.
 * Columns are the source of truth; payload is kept for backwards compatibility.
 */
type TaskRow = {
  client_id: string;
  notion_id: string | null;
  notion_unique_id: string | null;
  payload: string;  // Kept for backwards compatibility / extra fields
  sync_status: SyncStatus;
  last_modified_local: number;
  last_modified_notion: number;
  field_local_ts: string;
  field_notion_ts: string;
  // Dedicated columns (source of truth)
  title: string | null;
  status: string | null;
  normalized_status: string | null;
  due_date: string | null;
  due_date_end: string | null;
  hard_deadline: number;
  urgent: number;
  important: number;
  parent_task_id: string | null;
  main_entry: string | null;
  body: string | null;
  recurrence: string | null;  // JSON array
  session_length_minutes: number | null;
  estimated_length_minutes: number | null;
  order_value: string | null;
  order_color: string | null;
  project_ids: string | null;  // JSON array
  url: string | null;
  last_edited: string | null;
  // Local-only columns
  snoozed_until: string | null;
  reminder_at: string | null;
  tracking_goal_minutes: number | null;
  done_tracking_after_cycle: number | null;
  auto_fill_estimated_time: number | null;
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

function parseJsonArray<T>(raw: string | null | undefined): T[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Map a database row to a Task object.
 * Reads from dedicated columns (source of truth), not from JSON payload.
 */
function mapRowToTask(row: TaskRow): Task {
  // Read extra fields from payload that aren't in columns yet
  let extraFields: Partial<Task> = {};
  try {
    const payloadData = JSON.parse(row.payload);
    // Only extract fields that aren't in dedicated columns
    extraFields = {
      subtaskIds: payloadData.subtaskIds,
      subtaskProgress: payloadData.subtaskProgress,
    };
  } catch {
    // ignore payload parse errors
  }

  const task: Task = {
    // Identity
    id: row.notion_id ?? row.client_id,
    uniqueId: row.notion_unique_id ?? undefined,
    
    // Core fields from columns
    title: row.title ?? '',
    status: row.status ?? undefined,
    normalizedStatus: row.normalized_status ?? undefined,
    dueDate: row.due_date ?? undefined,
    dueDateEnd: row.due_date_end ?? undefined,
    hardDeadline: row.hard_deadline === 1,
    urgent: row.urgent === 1,
    important: row.important === 1,
    parentTaskId: row.parent_task_id ?? undefined,
    mainEntry: row.main_entry ?? undefined,
    body: row.body ?? undefined,
    recurrence: parseJsonArray<string>(row.recurrence),
    sessionLengthMinutes: row.session_length_minutes ?? undefined,
    estimatedLengthMinutes: row.estimated_length_minutes ?? undefined,
    orderValue: row.order_value ?? undefined,
    orderColor: row.order_color ?? undefined,
    projectIds: parseJsonArray<string>(row.project_ids),
    url: row.url ?? undefined,
    lastEdited: row.last_edited ?? undefined,
    
    // Sync status
    syncStatus: row.sync_status,
    localOnly: !row.notion_id,
    
    // Local-only fields
    snoozedUntil: row.snoozed_until ?? undefined,
    reminderAt: row.reminder_at ?? undefined,
    trackingGoalMinutes: row.tracking_goal_minutes ?? undefined,
    doneTrackingAfterCycle: row.done_tracking_after_cycle === 1,
    autoFillEstimatedTime: row.auto_fill_estimated_time === 1,
    trashedAt: row.trashed_at ?? undefined,
    
    // Extra fields from payload
    ...extraFields
  };
  
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
      `SELECT * FROM ${TABLE} WHERE client_id = ? OR notion_id = ? OR notion_unique_id = ? LIMIT 1`
    )
    .get(taskId, taskId, taskId) as TaskRow | undefined;
}

/**
 * Find a task row by its Notion unique ID (e.g., "ACTION-123")
 * This is used for deduplication during sync
 */
function readRowByUniqueId(uniqueId: string | null | undefined): TaskRow | undefined {
  if (!uniqueId) return undefined;
  const db = getDb();
  return db
    .prepare(`SELECT * FROM ${TABLE} WHERE notion_unique_id = ? LIMIT 1`)
    .get(uniqueId) as TaskRow | undefined;
}

/**
 * Save a task to the database using dedicated columns.
 * The payload is kept for backwards compatibility but columns are the source of truth.
 */
function saveTaskRow(
  clientId: string,
  task: Task,
  syncStatus: SyncStatus,
  options: {
    notionId?: string | null;
    notionUniqueId?: string | null;
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
    notionUniqueId = null,
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

  // Keep payload for backwards compatibility (stores extra fields)
  const payload = JSON.stringify({
    subtaskIds: task.subtaskIds,
    subtaskProgress: task.subtaskProgress,
  });

  db.prepare(
    `INSERT INTO ${TABLE} (
      client_id,
      notion_id,
      notion_unique_id,
      payload,
      sync_status,
      last_modified_local,
      last_modified_notion,
      field_local_ts,
      field_notion_ts,
      -- Dedicated columns
      title,
      status,
      normalized_status,
      due_date,
      due_date_end,
      hard_deadline,
      urgent,
      important,
      parent_task_id,
      main_entry,
      body,
      recurrence,
      session_length_minutes,
      estimated_length_minutes,
      order_value,
      order_color,
      project_ids,
      url,
      last_edited,
      -- Local-only columns
      snoozed_until,
      reminder_at,
      tracking_goal_minutes,
      done_tracking_after_cycle,
      auto_fill_estimated_time
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET
      notion_id = excluded.notion_id,
      notion_unique_id = excluded.notion_unique_id,
      payload = excluded.payload,
      sync_status = excluded.sync_status,
      last_modified_local = excluded.last_modified_local,
      last_modified_notion = excluded.last_modified_notion,
      field_local_ts = excluded.field_local_ts,
      field_notion_ts = excluded.field_notion_ts,
      title = excluded.title,
      status = excluded.status,
      normalized_status = excluded.normalized_status,
      due_date = excluded.due_date,
      due_date_end = excluded.due_date_end,
      hard_deadline = excluded.hard_deadline,
      urgent = excluded.urgent,
      important = excluded.important,
      parent_task_id = excluded.parent_task_id,
      main_entry = excluded.main_entry,
      body = excluded.body,
      recurrence = excluded.recurrence,
      session_length_minutes = excluded.session_length_minutes,
      estimated_length_minutes = excluded.estimated_length_minutes,
      order_value = excluded.order_value,
      order_color = excluded.order_color,
      project_ids = excluded.project_ids,
      url = excluded.url,
      last_edited = excluded.last_edited,
      snoozed_until = excluded.snoozed_until,
      reminder_at = excluded.reminder_at,
      tracking_goal_minutes = excluded.tracking_goal_minutes,
      done_tracking_after_cycle = excluded.done_tracking_after_cycle,
      auto_fill_estimated_time = excluded.auto_fill_estimated_time`
  ).run(
    clientId,
    notionId ?? null,
    notionUniqueId ?? null,
    payload,
    syncStatus,
    lastModifiedLocal,
    lastModifiedNotion,
    serializeFieldMap(fieldLocal),
    serializeFieldMap(fieldNotion),
    // Dedicated columns
    task.title ?? null,
    task.status ?? null,
    task.normalizedStatus ?? null,
    task.dueDate ?? null,
    task.dueDateEnd ?? null,
    task.hardDeadline ? 1 : 0,
    task.urgent ? 1 : 0,
    task.important ? 1 : 0,
    task.parentTaskId ?? null,
    task.mainEntry ?? null,
    task.body ?? null,
    task.recurrence ? JSON.stringify(task.recurrence) : null,
    task.sessionLengthMinutes ?? null,
    task.estimatedLengthMinutes ?? null,
    task.orderValue ?? null,
    task.orderColor ?? null,
    task.projectIds ? JSON.stringify(task.projectIds) : null,
    task.url ?? null,
    task.lastEdited ?? null,
    // Local-only columns
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

/**
 * List tasks with optional filtering using indexed columns.
 * Much faster than loading all tasks and filtering in JS!
 */
export function listTasks(limit = 2000, includeTrash = false) {
  const db = getDb();
  // Use column-based query for better performance
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

/**
 * List tasks by status - uses indexed column for fast lookup
 */
export function listTasksByStatus(status: string, limit = 500): Task[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} WHERE status = ? AND sync_status != 'trashed' ORDER BY due_date ASC LIMIT ?`
  ).all(status, limit) as TaskRow[];
  return rows.map(mapRowToTask);
}

/**
 * List tasks by due date range - uses indexed column
 */
export function listTasksByDateRange(startDate: string, endDate: string, limit = 500): Task[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} 
     WHERE due_date >= ? AND due_date <= ? AND sync_status != 'trashed' 
     ORDER BY due_date ASC LIMIT ?`
  ).all(startDate, endDate, limit) as TaskRow[];
  return rows.map(mapRowToTask);
}

/**
 * List urgent tasks - uses indexed column
 */
export function listUrgentTasks(limit = 100): Task[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} WHERE urgent = 1 AND sync_status != 'trashed' ORDER BY due_date ASC LIMIT ?`
  ).all(limit) as TaskRow[];
  return rows.map(mapRowToTask);
}

/**
 * List important tasks - uses indexed column
 */
export function listImportantTasks(limit = 100): Task[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} WHERE important = 1 AND sync_status != 'trashed' ORDER BY due_date ASC LIMIT ?`
  ).all(limit) as TaskRow[];
  return rows.map(mapRowToTask);
}

/**
 * List tasks with hard deadlines - uses indexed column
 */
export function listHardDeadlineTasks(limit = 100): Task[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} WHERE hard_deadline = 1 AND sync_status != 'trashed' ORDER BY due_date ASC LIMIT ?`
  ).all(limit) as TaskRow[];
  return rows.map(mapRowToTask);
}

export function countTasks(): number {
  const db = getDb();
  const result = db.prepare(`SELECT COUNT(*) as count FROM ${TABLE}`).get() as { count: number };
  return result.count;
}

export function getOldestSyncTimestamp(): string | null {
  const db = getDb();
  const result = db.prepare(
    `SELECT MIN(last_modified_notion) as oldest FROM ${TABLE} WHERE last_modified_notion > 0`
  ).get() as { oldest: number | null };
  if (result?.oldest) {
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
    const status = (st.normalizedStatus || st.status || '').toLowerCase();
    return status === 'done' || status.includes('complete') || status.includes('done');
  }).length;

  // Update parent with new subtask info
  const nextParent: Task = {
    ...parentTask,
    subtaskIds: subtasks.map(st => st.id),
    subtaskProgress: { completed: completedCount, total: subtasks.length }
  };

  // Save updated parent (uses columns + payload for subtask info)
  saveTaskRow(parentRow.client_id, nextParent, parentRow.sync_status, {
    notionId: parentRow.notion_id,
    notionUniqueId: parentRow.notion_unique_id,
    lastModifiedLocal: parentRow.last_modified_local,
    lastModifiedNotion: parentRow.last_modified_notion,
    fieldLocal: parseFieldMap(parentRow.field_local_ts),
    fieldNotion: parseFieldMap(parentRow.field_notion_ts),
    snoozedUntil: parentRow.snoozed_until,
    reminderAt: parentRow.reminder_at,
    trackingGoalMinutes: parentRow.tracking_goal_minutes,
    doneTrackingAfterCycle: parentRow.done_tracking_after_cycle === 1,
    autoFillEstimatedTime: parentRow.auto_fill_estimated_time === 1
  });
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
    nextTask.sessionLengthMinutes = updates.sessionLengthMinutes ?? undefined;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'estimatedLengthMinutes')) {
    nextTask.estimatedLengthMinutes = updates.estimatedLengthMinutes ?? undefined;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'orderValue')) {
    nextTask.orderValue = updates.orderValue ?? undefined;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'recurrence')) {
    nextTask.recurrence = updates.recurrence ?? undefined;
  }

  nextTask.syncStatus = 'pending';
  nextTask.localOnly = !row.notion_id;

  const changedFields = extractChangedFields(updates);
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
    notionUniqueId: row.notion_unique_id,
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

/**
 * Get task status breakdown using indexed column queries.
 * Much faster than parsing JSON payload for each row!
 */
export function getTaskStatusBreakdown(): StatusBreakdown {
  const db = getDb();
  
  // Use column-based aggregation - much faster!
  const statusCounts = db.prepare(`
    SELECT 
      COALESCE(NULLIF(TRIM(status), ''), 'No Status') as status_name,
      COUNT(*) as count
    FROM ${TABLE}
    GROUP BY status_name
    ORDER BY count DESC
  `).all() as { status_name: string; count: number }[];

  const totals = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status IS NOT NULL AND TRIM(status) != '' THEN 1 ELSE 0 END) as with_status,
      MAX(last_modified_local) as latest
    FROM ${TABLE}
  `).get() as { total: number; with_status: number; latest: number | null };

  return {
    total: totals.total,
    withStatus: totals.with_status,
    withoutStatus: totals.total - totals.with_status,
    unique: statusCounts.length,
    lastUpdated: totals.latest ? new Date(totals.latest).toISOString() : null,
    statuses: statusCounts.map(({ status_name, count }) => ({ name: status_name, count }))
  };
}

export function upsertRemoteTask(entity: Task, notionId: string, notionUpdatedAt: string) {
  // DEDUPLICATION STRATEGY:
  // 1. First check by uniqueId (e.g., "ACTION-123")
  // 2. Then fall back to notionId
  // 3. Finally use entity.id
  
  console.log(`[TaskRepo] upsertRemoteTask called for: ${entity.title} (${notionId})`);
  
  let row = entity.uniqueId ? readRowByUniqueId(entity.uniqueId) : undefined;
  if (!row) {
    row = readRowById(notionId);
  }
  
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

  try {
    saveTaskRow(clientId, payload, 'synced', {
      notionId,
      notionUniqueId: entity.uniqueId ?? null,
      lastModifiedLocal: existingLocal ? row!.last_modified_local : Date.now(),
      lastModifiedNotion: Date.parse(notionUpdatedAt),
      fieldLocal: parseFieldMap(row?.field_local_ts),
      fieldNotion
    });
    console.log(`[TaskRepo] ✓ Task saved: ${entity.title} (clientId: ${clientId})`);
  } catch (error) {
    console.error(`[TaskRepo] ❌ Failed to save task: ${entity.title}`, error);
    throw error;
  }

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

export function clearAllTasks(): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM ${TABLE}`).run();
  console.log(`[DB] Cleared all ${result.changes} cached tasks`);
  return result.changes;
}

/**
 * Import tasks from the JSON file created by the import script.
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
    
    const insertMany = db.transaction((tasks: Task[]) => {
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
          sessionLengthMinutes: task.sessionLengthMinutes ?? undefined,
          estimatedLengthMinutes: task.estimatedLengthMinutes ?? undefined,
          url: task.url ?? undefined,
          syncStatus: 'synced',
          localOnly: false
        };
        
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
    
    const backupPath = jsonPath.replace('.json', `-imported-${Date.now()}.json`);
    fs.renameSync(jsonPath, backupPath);
    console.log(`[DB] Moved import file to: ${path.basename(backupPath)}`);
    
    return imported;
  } catch (error) {
    console.error('[DB] Error importing tasks from JSON:', error);
    return 0;
  }
}

export function getTaskCount(): number {
  const db = getDb();
  const result = db.prepare(`SELECT COUNT(*) as count FROM ${TABLE}`).get() as { count: number };
  return result.count;
}

/**
 * Build subtask relationships using indexed parent_task_id column.
 */
export function buildSubtaskRelationships(
  tasks: Task[],
  completedStatus?: string
): { parentTasks: Task[]; subtaskMap: Map<string, Task[]> } {
  const subtaskMap = new Map<string, Task[]>();
  const parentTasks: Task[] = [];
  
  for (const task of tasks) {
    if (task.parentTaskId) {
      const existing = subtaskMap.get(task.parentTaskId) || [];
      existing.push(task);
      subtaskMap.set(task.parentTaskId, existing);
    } else {
      parentTasks.push(task);
    }
  }
  
  for (const task of parentTasks) {
    const subtasks = subtaskMap.get(task.id);
    if (subtasks && subtasks.length > 0) {
      task.subtaskIds = subtasks.map(s => s.id);
      const completed = subtasks.filter(s => s.status === completedStatus).length;
      task.subtaskProgress = { completed, total: subtasks.length };
    }
  }
  
  return { parentTasks, subtaskMap };
}

/**
 * Get all subtasks for a given parent task ID - uses indexed column!
 */
export function getSubtasks(parentTaskId: string): Task[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} WHERE parent_task_id = ? AND sync_status != 'trashed'`
  ).all(parentTaskId) as TaskRow[];
  return rows.map(mapRowToTask);
}

// ============================================================================
// TRASH MANAGEMENT
// ============================================================================

export function markTaskAsTrashed(taskId: string): void {
  const db = getDb();
  const trashedAt = new Date().toISOString();
  db.prepare(
    `UPDATE ${TABLE} SET sync_status = 'trashed', trashed_at = ? WHERE client_id = ? OR notion_id = ?`
  ).run(trashedAt, taskId, taskId);
  console.log(`[TaskRepo] Marked task as trashed: ${taskId}`);
}

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

export function listTrashedTasks(): Task[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM ${TABLE} WHERE sync_status = 'trashed' ORDER BY trashed_at DESC`)
    .all() as TaskRow[];
  return rows.map(mapRowToTask);
}

export function countTrashedTasks(): number {
  const db = getDb();
  const result = db
    .prepare(`SELECT COUNT(*) as count FROM ${TABLE} WHERE sync_status = 'trashed'`)
    .get() as { count: number };
  return result.count;
}

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

export function permanentlyDeleteTask(taskId: string): boolean {
  const db = getDb();
  const result = db.prepare(
    `DELETE FROM ${TABLE} WHERE client_id = ? OR notion_id = ?`
  ).run(taskId, taskId);
  
  clearEntriesForEntity('task', taskId);
  
  if (result.changes > 0) {
    console.log(`[TaskRepo] Permanently deleted task: ${taskId}`);
    return true;
  }
  return false;
}

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

export function cleanupOldTrashedTasks(daysOld: number = 30): number {
  const db = getDb();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  const cutoffIso = cutoffDate.toISOString();
  
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

export function getSyncedTaskNotionIds(): Set<string> {
  const db = getDb();
  const rows = db.prepare(
    `SELECT notion_id FROM ${TABLE} WHERE notion_id IS NOT NULL AND sync_status != 'trashed' AND sync_status != 'local'`
  ).all() as { notion_id: string }[];
  return new Set(rows.map(r => r.notion_id));
}
