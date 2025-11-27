import { randomUUID } from 'node:crypto';
import type {
  SyncStatus,
  TimeLogEntry,
  TimeLogEntryPayload,
  TimeLogUpdatePayload
} from '@shared/types';
import { getDb } from '../database';

// Sync queue removed - time logs stored locally only

const TABLE = 'time_logs';

/**
 * Time log row with dedicated columns for performance.
 * Columns are the source of truth; payload kept for backwards compatibility.
 */
type TimeLogRow = {
  client_id: string;
  notion_id: string | null;
  notion_unique_id: string | null;
  payload: string;  // Kept for backwards compatibility
  sync_status: SyncStatus;
  last_modified_local: number;
  last_modified_notion: number;
  field_local_ts: string;
  field_notion_ts: string;
  // Dedicated columns (source of truth)
  title: string | null;
  task_id: string | null;
  task_title: string | null;
  status: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
};

type FieldMap = Record<string, string>;

function parseFieldMap(raw: string | null | undefined): FieldMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as FieldMap;
    }
  } catch {
    // ignore invalid JSON
  }
  return {};
}

function serializeFieldMap(map: FieldMap) {
  return JSON.stringify(map ?? {});
}

function computeDuration(
  startTime?: string | null,
  endTime?: string | null,
  fallback?: number | null
) {
  if (startTime && endTime) {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
      return Math.round((end - start) / (1000 * 60));
    }
  }
  if (startTime && !endTime) {
    const start = new Date(startTime).getTime();
    const now = Date.now();
    if (!Number.isNaN(start) && now >= start) {
      return Math.round((now - start) / (1000 * 60));
    }
  }
  return fallback ?? null;
}

/**
 * Map a database row to a TimeLogEntry object.
 * Reads from dedicated columns (source of truth), not from JSON payload.
 */
function mapRowToEntry(row: TimeLogRow): TimeLogEntry {
  const durationMinutes = computeDuration(
    row.start_time,
    row.end_time,
    row.duration_minutes
  );

  return {
    // Identity
    id: row.notion_id ?? row.client_id,
    uniqueId: row.notion_unique_id ?? undefined,
    
    // Core fields from columns
    title: row.title ?? undefined,
    taskId: row.task_id ?? undefined,
    taskTitle: row.task_title ?? undefined,
    status: row.status ?? undefined,
    startTime: row.start_time ?? undefined,
    endTime: row.end_time ?? undefined,
    durationMinutes,
    
    // Sync status
    syncStatus: row.sync_status,
    localOnly: !row.notion_id
  };
}

function readRowById(entryId: string): TimeLogRow | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM ${TABLE} WHERE client_id = ? OR notion_id = ? LIMIT 1`
    )
    .get(entryId, entryId) as TimeLogRow | undefined;
}

/**
 * Find a time log row by its Notion unique ID (e.g., "TIME-LOG-123")
 */
function readRowByUniqueId(uniqueId: string | null | undefined): TimeLogRow | undefined {
  if (!uniqueId) return undefined;
  const db = getDb();
  return db
    .prepare(`SELECT * FROM ${TABLE} WHERE notion_unique_id = ? LIMIT 1`)
    .get(uniqueId) as TimeLogRow | undefined;
}

/**
 * Save a time log entry to the database using dedicated columns.
 */
function saveRow(
  clientId: string,
  entry: TimeLogEntry,
  syncStatus: SyncStatus,
  options: {
    notionId?: string | null;
    notionUniqueId?: string | null;
    lastModifiedLocal?: number;
    lastModifiedNotion?: number;
    fieldLocal?: FieldMap;
    fieldNotion?: FieldMap;
  }
) {
  const db = getDb();
  const {
    notionId = null,
    notionUniqueId = null,
    lastModifiedLocal = Date.now(),
    lastModifiedNotion = 0,
    fieldLocal = {},
    fieldNotion = {}
  } = options;

  // Minimal payload for backwards compatibility
  const payload = JSON.stringify({});

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
      task_id,
      task_title,
      status,
      start_time,
      end_time,
      duration_minutes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      task_id = excluded.task_id,
      task_title = excluded.task_title,
      status = excluded.status,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      duration_minutes = excluded.duration_minutes`
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
    entry.title ?? null,
    entry.taskId ?? null,
    entry.taskTitle ?? null,
    entry.status ?? null,
    entry.startTime ?? null,
    entry.endTime ?? null,
    entry.durationMinutes ?? null
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

export function timeLogEntryToPayload(entry: TimeLogEntry): TimeLogEntryPayload {
  return {
    taskId: entry.taskId ?? '',
    taskTitle: entry.taskTitle ?? entry.title ?? '',
    status: entry.status ?? (entry.endTime ? 'completed' : 'start'),
    startTime: entry.startTime ?? undefined,
    endTime: entry.endTime ?? undefined,
    sessionLengthMinutes: entry.durationMinutes ?? undefined
  };
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

export function listTimeLogs(limit = 100) {
  const db = getDb();
  // Use column-based sorting for better performance
  const rows = db
    .prepare(
      `SELECT * FROM ${TABLE} ORDER BY start_time DESC LIMIT ?`
    )
    .all(limit) as TimeLogRow[];
  return rows.map(mapRowToEntry);
}

/**
 * List time logs for a specific task - uses indexed column for fast lookup
 */
export function listTimeLogsForTask(taskId: string) {
  const db = getDb();
  // Normalize the task ID for comparison (remove dashes)
  const normalizedId = taskId.replace(/-/g, '');
  
  // Use indexed column query - much faster than filtering in JS!
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} 
     WHERE REPLACE(task_id, '-', '') = ? 
     ORDER BY start_time DESC`
  ).all(normalizedId) as TimeLogRow[];
  
  return rows.map(mapRowToEntry);
}

/**
 * List time logs by date range - uses indexed column
 */
export function listTimeLogsByDateRange(startDate: string, endDate: string): TimeLogEntry[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} 
     WHERE start_time >= ? AND start_time <= ?
     ORDER BY start_time DESC`
  ).all(startDate, endDate) as TimeLogRow[];
  return rows.map(mapRowToEntry);
}

/**
 * List active time logs (no end_time) - uses indexed column
 */
export function listActiveTimeLogs(): TimeLogEntry[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} 
     WHERE end_time IS NULL AND start_time IS NOT NULL
     ORDER BY start_time DESC`
  ).all() as TimeLogRow[];
  return rows.map(mapRowToEntry);
}

export function getActiveEntryForTask(taskId: string) {
  const db = getDb();
  const normalizedId = taskId.replace(/-/g, '');
  
  // Direct indexed query for active entry
  const row = db.prepare(
    `SELECT * FROM ${TABLE} 
     WHERE REPLACE(task_id, '-', '') = ? AND end_time IS NULL
     ORDER BY start_time DESC LIMIT 1`
  ).get(normalizedId) as TimeLogRow | undefined;
  
  return row ? mapRowToEntry(row) : null;
}

/**
 * Get total logged minutes for a task - uses column-based aggregation
 */
export function getTotalLoggedMinutes(taskId: string) {
  const db = getDb();
  const normalizedId = taskId.replace(/-/g, '');
  
  // Use SQL aggregation - much faster than loading all entries!
  const result = db.prepare(
    `SELECT SUM(duration_minutes) as total 
     FROM ${TABLE} 
     WHERE REPLACE(task_id, '-', '') = ? AND duration_minutes IS NOT NULL`
  ).get(normalizedId) as { total: number | null };
  
  return result?.total ?? 0;
}

export function createLocalTimeLogEntry(payload: TimeLogEntryPayload) {
  const clientId = `timelog-${randomUUID()}`;
  const entry: TimeLogEntry = {
    id: clientId,
    startTime: payload.startTime ?? undefined,
    endTime: payload.endTime ?? undefined,
    durationMinutes: computeDuration(
      payload.startTime,
      payload.endTime,
      payload.sessionLengthMinutes ?? null
    ) ?? undefined,
    title: payload.taskTitle ?? undefined,
    taskId: payload.taskId ?? undefined,
    taskTitle: payload.taskTitle ?? undefined,
    status: payload.status,
    syncStatus: 'pending',
    localOnly: true
  };

  saveRow(clientId, entry, 'pending', {
    notionId: null,
    lastModifiedLocal: Date.now(),
    lastModifiedNotion: 0,
    fieldLocal: touchFields({}, extractChangedFields(payload)),
    fieldNotion: {}
  });

  // Sync disabled - local only
  // enqueueSyncEntry('timeLog', clientId, 'create', { payload, clientId }, extractChangedFields(payload));

  return entry;
}

export function updateLocalTimeLogEntry(
  entryId: string,
  updates: TimeLogUpdatePayload
) {
  const row = readRowById(entryId);
  if (!row) {
    throw new Error(`Unable to find time log entry ${entryId}`);
  }

  const entry = mapRowToEntry(row);
  const nextEntry: TimeLogEntry = { ...entry };

  if (updates.startTime !== undefined) {
    nextEntry.startTime = updates.startTime ?? undefined;
  }
  if (updates.endTime !== undefined) {
    nextEntry.endTime = updates.endTime ?? undefined;
  }
  if (updates.title !== undefined) {
    nextEntry.title = updates.title ?? undefined;
  }

  nextEntry.durationMinutes = computeDuration(
    nextEntry.startTime,
    nextEntry.endTime
  ) ?? undefined;
  nextEntry.syncStatus = 'pending';
  nextEntry.localOnly = !row.notion_id;

  const changedFields = extractChangedFields(updates);
  const fieldLocal = touchFields(parseFieldMap(row.field_local_ts), changedFields);

  saveRow(row.client_id, nextEntry, 'pending', {
    notionId: row.notion_id,
    notionUniqueId: row.notion_unique_id,
    lastModifiedLocal: Date.now(),
    lastModifiedNotion: row.last_modified_notion,
    fieldLocal,
    fieldNotion: parseFieldMap(row.field_notion_ts)
  });

  // Sync disabled - local only
  // if (row.notion_id) {
  //   enqueueSyncEntry('timeLog', row.client_id, 'update', { updates, clientId: row.client_id, notionId: row.notion_id }, changedFields, row.notion_id);
  // } else {
  //   enqueueSyncEntry('timeLog', row.client_id, 'create', { payload: mergedPayload, clientId: row.client_id }, changedFields);
  // }

  return nextEntry;
}

export function deleteLocalTimeLogEntry(entryId: string) {
  const row = readRowById(entryId);
  if (!row) return;
  const db = getDb();
  db.prepare(`DELETE FROM ${TABLE} WHERE client_id = ?`).run(row.client_id);
  // Sync disabled - just delete locally
}

export function upsertRemoteTimeLogEntry(
  entry: TimeLogEntry,
  notionUpdatedAt: string
) {
  // DEDUPLICATION STRATEGY:
  // 1. First check by uniqueId (e.g., "TIME-LOG-123")
  // 2. Then fall back to entry.id
  
  let row = entry.uniqueId ? readRowByUniqueId(entry.uniqueId) : undefined;
  if (!row) {
    row = readRowById(entry.id);
  }
  
  const clientId = row?.client_id ?? entry.id;
  const payload: TimeLogEntry = {
    ...entry,
    id: entry.id,
    durationMinutes: computeDuration(
      entry.startTime,
      entry.endTime,
      entry.durationMinutes
    ) ?? undefined,
    syncStatus: 'synced',
    localOnly: false
  };

  saveRow(clientId, payload, 'synced', {
    notionId: entry.id,
    notionUniqueId: entry.uniqueId ?? null,
    lastModifiedLocal: row?.last_modified_local ?? Date.now(),
    lastModifiedNotion: Date.parse(notionUpdatedAt),
    fieldLocal: parseFieldMap(row?.field_local_ts),
    fieldNotion: touchFields(parseFieldMap(row?.field_notion_ts), Object.keys(payload))
  });
  // clearEntriesForEntity('timeLog', clientId); // Sync disabled
  return payload;
}

export function getTimeLog(entryId: string) {
  const row = readRowById(entryId);
  return row ? mapRowToEntry(row) : null;
}

/**
 * Clear all time logs from the database
 */
export function clearAllTimeLogs(): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM ${TABLE}`).run();
  console.log(`[DB] Cleared all ${result.changes} time logs`);
  return result.changes;
}

/**
 * Count total time logs in the database
 */
export function countTimeLogs(): number {
  const db = getDb();
  const result = db.prepare(`SELECT COUNT(*) as count FROM ${TABLE}`).get() as { count: number };
  return result.count;
}

/**
 * Get total minutes logged today for a task - uses column-based query
 */
export function getTodayLoggedMinutes(taskId: string): number {
  const db = getDb();
  const normalizedId = taskId.replace(/-/g, '');
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  // Use SQL aggregation with date filtering
  const result = db.prepare(
    `SELECT SUM(duration_minutes) as total 
     FROM ${TABLE} 
     WHERE REPLACE(task_id, '-', '') = ? 
       AND duration_minutes IS NOT NULL
       AND DATE(start_time) = ?`
  ).get(normalizedId, today) as { total: number | null };
  
  return result?.total ?? 0;
}

/**
 * Aggregated time data for a task and its subtasks
 */
export interface AggregatedTimeData {
  totalMinutes: number;
  todayMinutes: number;
  sessionCount: number;
  subtaskTotalMinutes: number;
}

/**
 * Get aggregated time data for a task and optionally its subtasks.
 * Uses efficient SQL queries with indexed columns.
 */
export function getAggregatedTimeData(taskId: string, subtaskIds: string[] = []): AggregatedTimeData {
  const db = getDb();
  const normalizedId = taskId.replace(/-/g, '');
  const today = new Date().toISOString().split('T')[0];
  
  // Get main task data in a single query
  const taskData = db.prepare(
    `SELECT 
       COALESCE(SUM(duration_minutes), 0) as total_minutes,
       COALESCE(SUM(CASE WHEN DATE(start_time) = ? THEN duration_minutes ELSE 0 END), 0) as today_minutes,
       COUNT(*) as session_count
     FROM ${TABLE} 
     WHERE REPLACE(task_id, '-', '') = ? AND duration_minutes IS NOT NULL`
  ).get(today, normalizedId) as { total_minutes: number; today_minutes: number; session_count: number };
  
  // Get subtask totals if any subtask IDs provided
  let subtaskTotalMinutes = 0;
  if (subtaskIds.length > 0) {
    // Normalize all subtask IDs
    const normalizedSubtaskIds = subtaskIds.map(id => id.replace(/-/g, ''));
    const placeholders = normalizedSubtaskIds.map(() => '?').join(',');
    
    const subtaskData = db.prepare(
      `SELECT COALESCE(SUM(duration_minutes), 0) as total
       FROM ${TABLE} 
       WHERE REPLACE(task_id, '-', '') IN (${placeholders}) AND duration_minutes IS NOT NULL`
    ).get(...normalizedSubtaskIds) as { total: number };
    
    subtaskTotalMinutes = subtaskData?.total ?? 0;
  }
  
  return {
    totalMinutes: taskData?.total_minutes ?? 0,
    todayMinutes: taskData?.today_minutes ?? 0,
    sessionCount: taskData?.session_count ?? 0,
    subtaskTotalMinutes
  };
}
