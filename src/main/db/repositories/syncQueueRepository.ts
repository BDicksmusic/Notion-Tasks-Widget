import { getDb } from '../database';

export type SyncEntityType = 'task' | 'timeLog' | 'writing' | 'project';
export type SyncOperation = 'create' | 'update' | 'delete';

export interface SyncQueueEntry<T = unknown> {
  id: number;
  entityType: SyncEntityType;
  clientId: string;
  notionId?: string | null;
  operation: SyncOperation;
  payload: T;
  changedFields: string[];
  retryCount: number;
  lastError?: string | null;
  pendingSince: number;
}

interface SyncQueueRow {
  id: number;
  entity_type: string;
  client_id: string;
  notion_id: string | null;
  operation: string;
  payload: string;
  changed_fields: string;
  retry_count: number;
  last_error?: string | null;
  pending_since: number;
}

function mapRow<T>(row: SyncQueueRow): SyncQueueEntry<T> {
  return {
    id: row.id,
    entityType: row.entity_type as SyncEntityType,
    clientId: row.client_id,
    notionId: row.notion_id,
    operation: row.operation as SyncOperation,
    payload: JSON.parse(row.payload) as T,
    changedFields: JSON.parse(row.changed_fields) as string[],
    retryCount: row.retry_count,
    lastError: row.last_error ?? undefined,
    pendingSince: row.pending_since
  };
}

function mergePayload(existing: unknown, next: unknown) {
  if (
    existing &&
    typeof existing === 'object' &&
    next &&
    typeof next === 'object'
  ) {
    return { ...(existing as Record<string, unknown>), ...(next as Record<string, unknown>) };
  }
  return next ?? existing;
}

export function enqueueSyncEntry<T>(
  entityType: SyncEntityType,
  clientId: string,
  operation: SyncOperation,
  payload: T,
  changedFields: string[],
  notionId?: string | null
) {
  const db = getDb();
  const now = Date.now();
  const existing = db
    .prepare(
      `SELECT * FROM sync_queue WHERE entity_type = ? AND client_id = ? LIMIT 1`
    )
    .get(entityType, clientId) as SyncQueueRow | undefined;

  const serializedPayload = JSON.stringify(payload ?? {});
  const serializedFields = JSON.stringify(changedFields ?? []);

  if (existing) {
    const mergedPayload = mergePayload(
      JSON.parse(existing.payload),
      payload
    );
    const mergedFields = Array.from(
      new Set([
        ...(JSON.parse(existing.changed_fields) as string[]),
        ...changedFields
      ])
    );
    const nextOperation =
      existing.operation === 'create' ? 'create' : operation;
    db.prepare(
      `UPDATE sync_queue
       SET notion_id = COALESCE(?, notion_id),
           operation = ?,
           payload = ?,
           changed_fields = ?,
           updated_at = ?,
           pending_since = MIN(pending_since, ?)
       WHERE id = ?`
    ).run(
      notionId ?? null,
      nextOperation,
      JSON.stringify(mergedPayload ?? {}),
      JSON.stringify(mergedFields),
      now,
      existing.pending_since,
      existing.id
    );
    return existing.id;
  }

  db.prepare(
    `INSERT INTO sync_queue (
      entity_type,
      client_id,
      notion_id,
      operation,
      payload,
      changed_fields,
      retry_count,
      last_error,
      pending_since,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`
  ).run(
    entityType,
    clientId,
    notionId ?? null,
    operation,
    serializedPayload,
    serializedFields,
    now,
    now
  );
}

export function listPendingEntries<T = unknown>(limit = 25) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM sync_queue ORDER BY pending_since ASC LIMIT ?`
    )
    .all(limit) as SyncQueueRow[];
  return rows.map((row) => mapRow<T>(row));
}

export function countPendingEntries() {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM sync_queue`)
    .get() as { count: number } | undefined;
  return row?.count ?? 0;
}

export function markEntryComplete(id: number) {
  const db = getDb();
  db.prepare(`DELETE FROM sync_queue WHERE id = ?`).run(id);
}

export function markEntryFailed(id: number, error: string) {
  const db = getDb();
  db.prepare(
    `UPDATE sync_queue
     SET retry_count = retry_count + 1,
         last_error = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(error, Date.now(), id);
}

export function clearEntriesForEntity(entityType: SyncEntityType, clientId: string) {
  const db = getDb();
  db.prepare(
    `DELETE FROM sync_queue WHERE entity_type = ? AND client_id = ?`
  ).run(entityType, clientId);
}

/**
 * Clear entries that have failed too many times (stuck entries)
 * These will never succeed and just block the sync queue
 */
export function clearStuckEntries(maxRetries: number = 10): number {
  const db = getDb();
  const result = db.prepare(
    `DELETE FROM sync_queue WHERE retry_count >= ?`
  ).run(maxRetries);
  if (result.changes > 0) {
    console.log(`[SyncQueue] Cleared ${result.changes} stuck entries (retryCount >= ${maxRetries})`);
  }
  return result.changes;
}

/**
 * Clear all entries from the sync queue
 */
export function clearAllSyncQueue(): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM sync_queue`).run();
  console.log(`[SyncQueue] Cleared all ${result.changes} entries`);
  return result.changes;
}

/**
 * Clear all entries for a specific entity type
 */
export function clearEntriesByType(entityType: SyncEntityType): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM sync_queue WHERE entity_type = ?`).run(entityType);
  if (result.changes > 0) {
    console.log(`[SyncQueue] Cleared ${result.changes} ${entityType} entries`);
  }
  return result.changes;
}

