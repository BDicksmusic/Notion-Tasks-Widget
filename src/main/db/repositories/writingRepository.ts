import { randomUUID } from 'node:crypto';
import type { SyncStatus, WritingEntryPayload } from '@shared/types';
import { getDb } from '../database';
import {
  clearEntriesForEntity,
  enqueueSyncEntry
} from './syncQueueRepository';

const TABLE = 'writing_entries';

type WritingRow = {
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
    // ignore
  }
  return {};
}

function serializeFieldMap(map: FieldMap) {
  return JSON.stringify(map ?? {});
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

function saveRow(
  clientId: string,
  payload: WritingEntryPayload,
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
    JSON.stringify(payload),
    syncStatus,
    lastModifiedLocal,
    lastModifiedNotion,
    serializeFieldMap(fieldLocal),
    serializeFieldMap(fieldNotion)
  );
}

export function createLocalWritingEntry(payload: WritingEntryPayload) {
  const clientId = `writing-${randomUUID()}`;
  saveRow(clientId, payload, 'pending', {
    notionId: null,
    lastModifiedLocal: Date.now(),
    lastModifiedNotion: 0,
    fieldLocal: extractChangedFields(payload).reduce<FieldMap>(
      (acc, field) => {
        acc[field] = new Date().toISOString();
        return acc;
      },
      {}
    )
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
    payload,
    syncStatus: 'pending' as SyncStatus
  };
}

export function markWritingEntrySynced(
  clientId: string,
  notionId: string,
  notionUpdatedAt: string
) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM ${TABLE} WHERE client_id = ? LIMIT 1`
    )
    .get(clientId) as WritingRow | undefined;

  if (!row) {
    return;
  }

  const payload = JSON.parse(row.payload) as WritingEntryPayload;
  saveRow(clientId, payload, 'synced', {
    notionId,
    lastModifiedLocal: row.last_modified_local,
    lastModifiedNotion: Date.parse(notionUpdatedAt),
    fieldLocal: parseFieldMap(row.field_local_ts),
    fieldNotion: parseFieldMap(row.field_notion_ts)
  });
  clearEntriesForEntity('writing', clientId);
}

export function pruneSyncedWritingEntries(retention = 10) {
  const db = getDb();
  db.prepare(
    `DELETE FROM ${TABLE}
     WHERE sync_status = 'synced'
     AND client_id NOT IN (
       SELECT client_id FROM ${TABLE}
       ORDER BY last_modified_local DESC
       LIMIT ?
     )`
  ).run(retention);
}

