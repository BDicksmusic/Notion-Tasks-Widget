import { randomUUID } from 'node:crypto';
import type { SyncStatus, WritingEntryPayload, MarkdownBlock } from '@shared/types';
import { getDb } from '../database';
import {
  clearEntriesForEntity,
  enqueueSyncEntry
} from './syncQueueRepository';

const TABLE = 'writing_entries';

/**
 * Writing entry row with dedicated columns for performance.
 * Columns are the source of truth; payload kept for backwards compatibility.
 */
type WritingRow = {
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
  summary: string | null;
  content: string | null;
  tags: string | null;  // JSON array
  status: string | null;
  content_blocks: string | null;  // JSON array of MarkdownBlock
};

/**
 * Extended WritingEntry type with sync status
 */
export interface WritingEntry {
  id: string;
  uniqueId?: string;
  title: string;
  summary?: string;
  content: string;
  tags?: string[];
  status?: string;
  contentBlocks?: MarkdownBlock[];
  syncStatus: SyncStatus;
  localOnly: boolean;
  lastModifiedLocal?: number;
}

type FieldMap = Record<string, string>;

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
 * Map a database row to a WritingEntry object.
 * Reads from dedicated columns (source of truth), not from JSON payload.
 */
function mapRowToEntry(row: WritingRow): WritingEntry {
  return {
    id: row.notion_id ?? row.client_id,
    uniqueId: row.notion_unique_id ?? undefined,
    title: row.title ?? '',
    summary: row.summary ?? undefined,
    content: row.content ?? '',
    tags: parseJsonArray<string>(row.tags),
    status: row.status ?? undefined,
    contentBlocks: parseJsonArray<MarkdownBlock>(row.content_blocks),
    syncStatus: row.sync_status,
    localOnly: !row.notion_id,
    lastModifiedLocal: row.last_modified_local
  };
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

function touchFields(map: FieldMap, fields: string[]) {
  if (!fields.length) return map;
  const iso = new Date().toISOString();
  const next = { ...map };
  fields.forEach((field) => {
    next[field] = iso;
  });
  return next;
}

function readRowById(entryId: string): WritingRow | undefined {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM ${TABLE} WHERE client_id = ? OR notion_id = ? LIMIT 1`)
    .get(entryId, entryId) as WritingRow | undefined;
}

/**
 * Find a writing entry row by its Notion unique ID
 */
function readRowByUniqueId(uniqueId: string | null | undefined): WritingRow | undefined {
  if (!uniqueId) return undefined;
  const db = getDb();
  return db
    .prepare(`SELECT * FROM ${TABLE} WHERE notion_unique_id = ? LIMIT 1`)
    .get(uniqueId) as WritingRow | undefined;
}

/**
 * Save a writing entry to the database using dedicated columns.
 */
function saveRow(
  clientId: string,
  entry: WritingEntryPayload,
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
      summary,
      content,
      tags,
      status,
      content_blocks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      summary = excluded.summary,
      content = excluded.content,
      tags = excluded.tags,
      status = excluded.status,
      content_blocks = excluded.content_blocks`
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
    entry.summary ?? null,
    entry.content ?? null,
    entry.tags ? JSON.stringify(entry.tags) : null,
    entry.status ?? null,
    entry.contentBlocks ? JSON.stringify(entry.contentBlocks) : null
  );
}

/**
 * List all writing entries
 */
export function listWritingEntries(limit = 100): WritingEntry[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM ${TABLE} ORDER BY last_modified_local DESC LIMIT ?`)
    .all(limit) as WritingRow[];
  return rows.map(mapRowToEntry);
}

/**
 * List writing entries by status - uses indexed column
 */
export function listWritingEntriesByStatus(status: string): WritingEntry[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} WHERE status = ? ORDER BY last_modified_local DESC`
  ).all(status) as WritingRow[];
  return rows.map(mapRowToEntry);
}

/**
 * List synced writing entries
 */
export function listSyncedWritingEntries(): WritingEntry[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} WHERE sync_status = 'synced' ORDER BY last_modified_local DESC`
  ).all() as WritingRow[];
  return rows.map(mapRowToEntry);
}

/**
 * List pending writing entries (waiting to sync)
 */
export function listPendingWritingEntries(): WritingEntry[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} WHERE sync_status = 'pending' ORDER BY last_modified_local DESC`
  ).all() as WritingRow[];
  return rows.map(mapRowToEntry);
}

/**
 * Get a single writing entry by ID
 */
export function getWritingEntry(entryId: string): WritingEntry | null {
  const row = readRowById(entryId);
  return row ? mapRowToEntry(row) : null;
}

/**
 * Create a new local writing entry
 */
export function createLocalWritingEntry(payload: WritingEntryPayload) {
  const clientId = `writing-${randomUUID()}`;
  
  saveRow(clientId, payload, 'pending', {
    notionId: null,
    lastModifiedLocal: Date.now(),
    lastModifiedNotion: 0,
    fieldLocal: touchFields({}, extractChangedFields(payload))
  });

  enqueueSyncEntry(
    'writing',
    clientId,
    'create',
    { payload, clientId },
    extractChangedFields(payload)
  );

  return {
    id: clientId,
    ...payload,
    syncStatus: 'pending' as SyncStatus,
    localOnly: true
  };
}

/**
 * Update a local writing entry
 */
export function updateLocalWritingEntry(
  entryId: string,
  updates: Partial<WritingEntryPayload>
): WritingEntry | null {
  const row = readRowById(entryId);
  if (!row) {
    console.warn(`[DB] Writing entry not found for update: ${entryId}`);
    return null;
  }
  
  const existing = mapRowToEntry(row);
  
  const updatedPayload: WritingEntryPayload = {
    title: updates.title !== undefined ? updates.title : existing.title,
    content: updates.content !== undefined ? updates.content : existing.content,
    summary: updates.summary !== undefined ? updates.summary : existing.summary,
    tags: updates.tags !== undefined ? updates.tags : existing.tags,
    status: updates.status !== undefined ? updates.status : existing.status,
    contentBlocks: updates.contentBlocks !== undefined ? updates.contentBlocks : existing.contentBlocks
  };
  
  const changedFields = extractChangedFields(updates);
  const fieldLocal = touchFields(parseFieldMap(row.field_local_ts), changedFields);
  
  saveRow(row.client_id, updatedPayload, 'pending', {
    notionId: row.notion_id,
    notionUniqueId: row.notion_unique_id,
    lastModifiedLocal: Date.now(),
    lastModifiedNotion: row.last_modified_notion,
    fieldLocal,
    fieldNotion: parseFieldMap(row.field_notion_ts)
  });
  
  // Queue for sync if has a Notion ID
  if (row.notion_id) {
    enqueueSyncEntry(
      'writing',
      row.client_id,
      'update',
      { updates, clientId: row.client_id },
      changedFields,
      row.notion_id
    );
  }
  
  console.log(`[DB] Updated writing entry: "${updatedPayload.title}" (id: ${entryId})`);
  
  return {
    id: row.notion_id ?? row.client_id,
    ...updatedPayload,
    syncStatus: 'pending',
    localOnly: !row.notion_id
  };
}

/**
 * Mark a writing entry as synced after successful Notion upload
 */
export function markWritingEntrySynced(
  clientId: string,
  notionId: string,
  notionUpdatedAt: string,
  notionUniqueId?: string
) {
  const row = readRowById(clientId);
  if (!row) {
    return;
  }

  const existing = mapRowToEntry(row);
  const payload: WritingEntryPayload = {
    title: existing.title,
    content: existing.content,
    summary: existing.summary,
    tags: existing.tags,
    status: existing.status,
    contentBlocks: existing.contentBlocks
  };
  
  saveRow(clientId, payload, 'synced', {
    notionId,
    notionUniqueId: notionUniqueId ?? row.notion_unique_id,
    lastModifiedLocal: row.last_modified_local,
    lastModifiedNotion: Date.parse(notionUpdatedAt),
    fieldLocal: parseFieldMap(row.field_local_ts),
    fieldNotion: parseFieldMap(row.field_notion_ts)
  });
  clearEntriesForEntity('writing', clientId);
}

/**
 * Upsert a remote writing entry from Notion
 */
export function upsertRemoteWritingEntry(
  entry: WritingEntryPayload & { id: string; uniqueId?: string },
  notionUpdatedAt: string
) {
  // DEDUPLICATION: Check by uniqueId first, then by id
  let existingRow = entry.uniqueId ? readRowByUniqueId(entry.uniqueId) : undefined;
  if (!existingRow) {
    existingRow = readRowById(entry.id);
  }
  
  const clientId = existingRow?.client_id ?? entry.id;
  
  saveRow(clientId, entry, 'synced', {
    notionId: entry.id,
    notionUniqueId: entry.uniqueId ?? null,
    lastModifiedLocal: existingRow?.last_modified_local ?? Date.now(),
    lastModifiedNotion: Date.parse(notionUpdatedAt),
    fieldLocal: parseFieldMap(existingRow?.field_local_ts),
    fieldNotion: touchFields(parseFieldMap(existingRow?.field_notion_ts), Object.keys(entry))
  });
  
  clearEntriesForEntity('writing', clientId);
  
  return {
    ...entry,
    syncStatus: 'synced' as SyncStatus,
    localOnly: false
  };
}

/**
 * Delete a writing entry
 */
export function deleteWritingEntry(entryId: string): boolean {
  const row = readRowById(entryId);
  if (!row) {
    return false;
  }
  
  const db = getDb();
  db.prepare(`DELETE FROM ${TABLE} WHERE client_id = ?`).run(row.client_id);
  clearEntriesForEntity('writing', row.client_id);
  
  console.log(`[DB] Deleted writing entry: ${entryId}`);
  return true;
}

/**
 * Prune old synced writing entries, keeping only the most recent ones
 */
export function pruneSyncedWritingEntries(retention = 10) {
  const db = getDb();
  db.prepare(
    `DELETE FROM ${TABLE}
     WHERE sync_status = 'synced'
     AND client_id NOT IN (
       SELECT client_id FROM ${TABLE}
       WHERE sync_status = 'synced'
       ORDER BY last_modified_local DESC
       LIMIT ?
     )`
  ).run(retention);
}

/**
 * Clear all writing entries from the database
 */
export function clearAllWritingEntries(): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM ${TABLE}`).run();
  console.log(`[DB] Cleared all ${result.changes} writing entries`);
  return result.changes;
}

/**
 * Count total writing entries in the database
 */
export function countWritingEntries(): number {
  const db = getDb();
  const result = db.prepare(`SELECT COUNT(*) as count FROM ${TABLE}`).get() as { count: number };
  return result.count;
}

/**
 * Count pending writing entries
 */
export function countPendingWritingEntries(): number {
  const db = getDb();
  const result = db.prepare(
    `SELECT COUNT(*) as count FROM ${TABLE} WHERE sync_status = 'pending'`
  ).get() as { count: number };
  return result.count;
}

/**
 * Search writing entries by title - uses indexed column
 */
export function searchWritingEntriesByTitle(query: string, limit = 50): WritingEntry[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} 
     WHERE title LIKE ? 
     ORDER BY last_modified_local DESC 
     LIMIT ?`
  ).all(`%${query}%`, limit) as WritingRow[];
  return rows.map(mapRowToEntry);
}

/**
 * Get writing entries with specific tags - searches JSON array
 */
export function listWritingEntriesByTag(tag: string): WritingEntry[] {
  const db = getDb();
  // Use JSON contains pattern for SQLite
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} 
     WHERE tags LIKE ? 
     ORDER BY last_modified_local DESC`
  ).all(`%"${tag}"%`) as WritingRow[];
  return rows.map(mapRowToEntry);
}
