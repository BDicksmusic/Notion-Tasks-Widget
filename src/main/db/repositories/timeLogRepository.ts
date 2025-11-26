import { randomUUID } from 'node:crypto';
import type {
  SyncStatus,
  TimeLogEntry,
  TimeLogEntryPayload,
  TimeLogUpdatePayload
} from '@shared/types';
import { getDb } from '../database';
import {
  clearEntriesForEntity,
  enqueueSyncEntry
} from './syncQueueRepository';

const TABLE = 'time_logs';

type TimeLogRow = {
  client_id: string;
  notion_id: string | null;
  payload: string;
  sync_status: SyncStatus;
  last_modified_local: number;
  last_modified_notion: number;
  field_local_ts: string;
  field_notion_ts: string;
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

function mapRowToEntry(row: TimeLogRow): TimeLogEntry {
  const entry = JSON.parse(row.payload) as TimeLogEntry;
  entry.id = entry.id ?? row.notion_id ?? row.client_id;
  entry.syncStatus = row.sync_status;
  entry.localOnly = !row.notion_id;
  entry.durationMinutes = computeDuration(
    entry.startTime,
    entry.endTime,
    entry.durationMinutes
  );
  return entry;
}

function readRowById(entryId: string): TimeLogRow | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM ${TABLE} WHERE client_id = ? OR notion_id = ? LIMIT 1`
    )
    .get(entryId, entryId) as TimeLogRow | undefined;
}

function saveRow(
  clientId: string,
  entry: TimeLogEntry,
  syncStatus: SyncStatus,
  options: {
    notionId?: string | null;
    lastModifiedLocal?: number;
    lastModifiedNotion?: number;
    fieldLocal?: FieldMap;
    fieldNotion?: FieldMap;
  }
) {
  const db = getDb();
  const {
    notionId = null,
    lastModifiedLocal = Date.now(),
    lastModifiedNotion = 0,
    fieldLocal = {},
    fieldNotion = {}
  } = options;

  db.prepare(
    `INSERT INTO ${TABLE} (
      client_id,
      notion_id,
      payload,
      sync_status,
      last_modified_local,
      last_modified_notion,
      field_local_ts,
      field_notion_ts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET
      notion_id = excluded.notion_id,
      payload = excluded.payload,
      sync_status = excluded.sync_status,
      last_modified_local = excluded.last_modified_local,
      last_modified_notion = excluded.last_modified_notion,
      field_local_ts = excluded.field_local_ts,
      field_notion_ts = excluded.field_notion_ts`
  ).run(
    clientId,
    notionId ?? null,
    JSON.stringify(entry),
    syncStatus,
    lastModifiedLocal,
    lastModifiedNotion,
    serializeFieldMap(fieldLocal),
    serializeFieldMap(fieldNotion)
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
    status: entry.status ?? (entry.endTime ? 'End' : 'Start'),
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
  const rows = db
    .prepare(
      `SELECT * FROM ${TABLE} ORDER BY last_modified_local DESC LIMIT ?`
    )
    .all(limit) as TimeLogRow[];
  const entries = rows.map(mapRowToEntry);
  return entries.sort((a, b) => {
    const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
    const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
    return bTime - aTime;
  });
}

export function listTimeLogsForTask(taskId: string) {
  return listTimeLogs(500).filter(
    (entry) => entry.taskId?.replace(/-/g, '') === taskId.replace(/-/g, '')
  );
}

export function getActiveEntryForTask(taskId: string) {
  return listTimeLogsForTask(taskId).find((entry) => !entry.endTime) ?? null;
}

export function getTotalLoggedMinutes(taskId: string) {
  return listTimeLogsForTask(taskId).reduce((total, entry) => {
    return total + (entry.durationMinutes ?? 0);
  }, 0);
}

/**
 * Get time logged today (session time) for a specific task
 */
export function getTodayLoggedMinutes(taskId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  
  return listTimeLogsForTask(taskId).reduce((total, entry) => {
    if (!entry.startTime) return total;
    const entryDate = new Date(entry.startTime).getTime();
    if (entryDate >= todayStart) {
      return total + (entry.durationMinutes ?? 0);
    }
    return total;
  }, 0);
}

/**
 * Get aggregated time tracking data for a task including all its subtasks
 */
export interface AggregatedTimeData {
  totalMinutes: number;
  todayMinutes: number;
  sessionCount: number;
  subtaskTotalMinutes: number;
}

export function getAggregatedTimeData(
  taskId: string,
  subtaskIds: string[] = []
): AggregatedTimeData {
  // Get direct time for this task
  const directLogs = listTimeLogsForTask(taskId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  
  let totalMinutes = 0;
  let todayMinutes = 0;
  let sessionCount = directLogs.length;
  
  for (const entry of directLogs) {
    const duration = entry.durationMinutes ?? 0;
    totalMinutes += duration;
    
    if (entry.startTime) {
      const entryDate = new Date(entry.startTime).getTime();
      if (entryDate >= todayStart) {
        todayMinutes += duration;
      }
    }
  }
  
  // Get time from subtasks
  let subtaskTotalMinutes = 0;
  for (const subtaskId of subtaskIds) {
    const subtaskLogs = listTimeLogsForTask(subtaskId);
    sessionCount += subtaskLogs.length;
    
    for (const entry of subtaskLogs) {
      const duration = entry.durationMinutes ?? 0;
      subtaskTotalMinutes += duration;
      totalMinutes += duration;
      
      if (entry.startTime) {
        const entryDate = new Date(entry.startTime).getTime();
        if (entryDate >= todayStart) {
          todayMinutes += duration;
        }
      }
    }
  }
  
  return {
    totalMinutes,
    todayMinutes,
    sessionCount,
    subtaskTotalMinutes
  };
}

export function createLocalTimeLogEntry(payload: TimeLogEntryPayload) {
  const clientId = `timelog-${randomUUID()}`;
  const entry: TimeLogEntry = {
    id: clientId,
    startTime: payload.startTime ?? null,
    endTime: payload.endTime ?? null,
    durationMinutes: computeDuration(
      payload.startTime,
      payload.endTime,
      payload.sessionLengthMinutes ?? null
    ),
    title: payload.taskTitle ?? null,
    taskId: payload.taskId ?? null,
    taskTitle: payload.taskTitle ?? null,
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

  enqueueSyncEntry(
    'timeLog',
    clientId,
    'create',
    { payload, clientId },
    extractChangedFields(payload)
  );

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
    nextEntry.startTime = updates.startTime;
  }
  if (updates.endTime !== undefined) {
    nextEntry.endTime = updates.endTime;
  }
  if (updates.title !== undefined) {
    nextEntry.title = updates.title ?? null;
  }

  nextEntry.durationMinutes = computeDuration(
    nextEntry.startTime,
    nextEntry.endTime
  );
  nextEntry.syncStatus = 'pending';
  nextEntry.localOnly = !row.notion_id;

  const changedFields = extractChangedFields(updates);
  const fieldLocal = touchFields(parseFieldMap(row.field_local_ts), changedFields);

  saveRow(row.client_id, nextEntry, 'pending', {
    notionId: row.notion_id,
    lastModifiedLocal: Date.now(),
    lastModifiedNotion: row.last_modified_notion,
    fieldLocal,
    fieldNotion: parseFieldMap(row.field_notion_ts)
  });

  if (row.notion_id) {
    enqueueSyncEntry(
      'timeLog',
      row.client_id,
      'update',
      { updates, clientId: row.client_id, notionId: row.notion_id },
      changedFields,
      row.notion_id
    );
  } else {
    const mergedPayload = {
      ...timeLogEntryToPayload(nextEntry),
      ...updates
    };
    enqueueSyncEntry(
      'timeLog',
      row.client_id,
      'create',
      { payload: mergedPayload, clientId: row.client_id },
      changedFields
    );
  }

  return nextEntry;
}

export function deleteLocalTimeLogEntry(entryId: string) {
  const row = readRowById(entryId);
  if (!row) return;
  const db = getDb();
  db.prepare(`DELETE FROM ${TABLE} WHERE client_id = ?`).run(row.client_id);
  if (!row.notion_id) {
    clearEntriesForEntity('timeLog', row.client_id);
    return;
  }
  enqueueSyncEntry(
    'timeLog',
    row.client_id,
    'delete',
    { notionId: row.notion_id },
    ['delete'],
    row.notion_id
  );
}

export function upsertRemoteTimeLogEntry(
  entry: TimeLogEntry,
  notionUpdatedAt: string
) {
  const row = readRowById(entry.id);
  const clientId = row?.client_id ?? entry.id;
  const payload: TimeLogEntry = {
    ...entry,
    id: entry.id,
    durationMinutes: computeDuration(
      entry.startTime,
      entry.endTime,
      entry.durationMinutes
    ),
    syncStatus: 'synced',
    localOnly: false
  };

  saveRow(clientId, payload, 'synced', {
    notionId: entry.id,
    lastModifiedLocal: row?.last_modified_local ?? Date.now(),
    lastModifiedNotion: Date.parse(notionUpdatedAt),
    fieldLocal: parseFieldMap(row?.field_local_ts),
    fieldNotion: touchFields(parseFieldMap(row?.field_notion_ts), Object.keys(payload))
  });
  clearEntriesForEntity('timeLog', clientId);
  return payload;
}

export function getTimeLog(entryId: string) {
  const row = readRowById(entryId);
  return row ? mapRowToEntry(row) : null;
}

