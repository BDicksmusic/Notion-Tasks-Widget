/**
 * Task Repository using PostgreSQL
 * Provides the same interface as the SQLite taskRepository
 */
import { randomUUID } from 'node:crypto';
import type {
  NotionCreatePayload,
  SyncStatus,
  Task,
  TaskUpdatePayload
} from '../../../shared/types';
import { mapStatusToFilterValue } from '../../../shared/statusFilters';
import { query, getClient } from '../postgres';

type TaskRow = {
  client_id: string;
  notion_id: string | null;
  payload: Task;
  sync_status: SyncStatus;
  last_modified_local: number;
  last_modified_notion: number;
  field_local_ts: Record<string, string>;
  field_notion_ts: Record<string, string>;
};

const TABLE = 'tasks';

function mapRowToTask(row: TaskRow): Task {
  const task = row.payload;
  task.id = task.id ?? row.notion_id ?? row.client_id;
  task.syncStatus = row.sync_status;
  task.localOnly = !row.notion_id;
  return task;
}

async function readRowById(taskId: string): Promise<TaskRow | undefined> {
  const result = await query<TaskRow>(
    `SELECT * FROM ${TABLE} WHERE client_id = $1 OR notion_id = $1 LIMIT 1`,
    [taskId]
  );
  return result.rows[0];
}

async function saveTaskRow(
  clientId: string,
  payload: Task,
  syncStatus: SyncStatus,
  options: {
    notionId?: string | null;
    lastModifiedLocal?: number;
    lastModifiedNotion?: number;
    fieldLocal?: Record<string, string>;
    fieldNotion?: Record<string, string>;
  }
): Promise<void> {
  const {
    notionId = null,
    lastModifiedLocal = Date.now(),
    lastModifiedNotion = 0,
    fieldLocal = {},
    fieldNotion = {}
  } = options;

  await query(
    `INSERT INTO ${TABLE} (
      client_id, notion_id, payload, sync_status,
      last_modified_local, last_modified_notion,
      field_local_ts, field_notion_ts
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (client_id) DO UPDATE SET
      notion_id = EXCLUDED.notion_id,
      payload = EXCLUDED.payload,
      sync_status = EXCLUDED.sync_status,
      last_modified_local = EXCLUDED.last_modified_local,
      last_modified_notion = EXCLUDED.last_modified_notion,
      field_local_ts = EXCLUDED.field_local_ts,
      field_notion_ts = EXCLUDED.field_notion_ts`,
    [
      clientId,
      notionId,
      JSON.stringify(payload),
      syncStatus,
      lastModifiedLocal,
      lastModifiedNotion,
      JSON.stringify(fieldLocal),
      JSON.stringify(fieldNotion)
    ]
  );
}

// ==================== Public API ====================

export async function listStoredTasks(limit = 2000): Promise<Task[]> {
  const result = await query<TaskRow>(
    `SELECT * FROM ${TABLE} ORDER BY last_modified_local DESC LIMIT $1`,
    [limit]
  );
  console.log(`[DB] listTasks returning ${result.rows.length} tasks (limit: ${limit})`);
  return result.rows.map(mapRowToTask);
}

export async function getTaskById(taskId: string): Promise<Task | null> {
  const row = await readRowById(taskId);
  return row ? mapRowToTask(row) : null;
}

export async function getTaskCount(): Promise<number> {
  const result = await query<{ count: string }>('SELECT COUNT(*) as count FROM tasks');
  return parseInt(result.rows[0].count, 10);
}

export async function upsertRemoteTask(
  task: Task,
  notionId: string,
  timestamp: string
): Promise<Task> {
  const existing = await readRowById(notionId);
  const clientId = existing?.client_id ?? notionId;

  const nextTask: Task = {
    ...task,
    id: notionId,
    syncStatus: 'synced',
    localOnly: false
  };

  await saveTaskRow(clientId, nextTask, 'synced', {
    notionId,
    lastModifiedNotion: Date.now(),
    lastModifiedLocal: existing?.last_modified_local ?? Date.now()
  });

  return nextTask;
}

export async function createLocalTask(payload: NotionCreatePayload): Promise<Task> {
  const clientId = randomUUID();
  const now = Date.now();

  const task: Task = {
    id: clientId,
    title: payload.title,
    status: payload.status ?? undefined,
    normalizedStatus: payload.status
      ? mapStatusToFilterValue(payload.status) ?? payload.status
      : undefined,
    dueDate: undefined,
    syncStatus: 'pending',
    localOnly: true
  };

  await saveTaskRow(clientId, task, 'pending', {
    lastModifiedLocal: now
  });

  // Note: In a real implementation, you'd also enqueue for sync here
  // For now, we're just storing locally

  return task;
}

export async function updateLocalTask(
  taskId: string,
  updates: TaskUpdatePayload
): Promise<Task> {
  const row = await readRowById(taskId);
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
  if (Object.prototype.hasOwnProperty.call(updates, 'estimatedLengthMinutes')) {
    nextTask.estimatedLengthMinutes = updates.estimatedLengthMinutes ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'orderValue')) {
    nextTask.orderValue = updates.orderValue ?? null;
  }

  nextTask.syncStatus = 'pending';
  nextTask.localOnly = !row.notion_id;

  await saveTaskRow(row.client_id, nextTask, 'pending', {
    notionId: row.notion_id,
    lastModifiedLocal: Date.now(),
    lastModifiedNotion: row.last_modified_notion
  });

  // Note: In a real implementation, you'd also enqueue for sync here

  return nextTask;
}

export async function deleteTask(taskId: string): Promise<void> {
  await query(`DELETE FROM ${TABLE} WHERE client_id = $1 OR notion_id = $1`, [taskId]);
}

export async function clearAllTasks(): Promise<void> {
  await query(`DELETE FROM ${TABLE}`);
  console.log('[DB] Cleared all tasks');
}

// Import tasks from JSON (for migration)
export async function importTasksFromJson(tasks: Task[]): Promise<number> {
  let imported = 0;
  for (const task of tasks) {
    try {
      await saveTaskRow(task.id, task, task.syncStatus ?? 'synced', {
        notionId: task.id,
        lastModifiedNotion: Date.now()
      });
      imported++;
    } catch (err) {
      console.error(`Failed to import task ${task.id}:`, err);
    }
  }
  return imported;
}

