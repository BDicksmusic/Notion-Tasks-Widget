import { randomUUID } from 'node:crypto';
import type { ChatSummary, TaskAction, SyncStatus } from '../../../shared/types';
import { getDb } from '../database';

type ChatSummaryRow = {
  id: string;
  title: string;
  transcript: string;
  actions_json: string;
  summary_text: string | null;
  notion_page_id: string | null;
  sync_status: SyncStatus;
  created_at: number;
  updated_at: number;
};

const TABLE = 'chat_summaries';

function mapRowToSummary(row: ChatSummaryRow): ChatSummary {
  let actions: TaskAction[] = [];
  try {
    actions = JSON.parse(row.actions_json);
  } catch {
    // ignore parse errors
  }

  return {
    id: row.id,
    title: row.title,
    transcript: row.transcript,
    actions,
    summaryText: row.summary_text ?? undefined,
    notionPageId: row.notion_page_id ?? undefined,
    syncStatus: row.sync_status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export interface CreateChatSummaryPayload {
  title: string;
  transcript: string;
  actions: TaskAction[];
  summaryText?: string;
}

export function createChatSummary(payload: CreateChatSummaryPayload): ChatSummary {
  const db = getDb();
  const id = `chat-${randomUUID()}`;
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO ${TABLE} (id, title, transcript, actions_json, summary_text, sync_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    payload.title,
    payload.transcript,
    JSON.stringify(payload.actions),
    payload.summaryText ?? null,
    'pending',
    now,
    now
  );

  return {
    id,
    title: payload.title,
    transcript: payload.transcript,
    actions: payload.actions,
    summaryText: payload.summaryText,
    syncStatus: 'pending',
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString()
  };
}

export function getChatSummary(id: string): ChatSummary | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).get(id) as ChatSummaryRow | undefined;
  
  if (!row) return null;
  return mapRowToSummary(row);
}

export function listChatSummaries(limit = 50, offset = 0): ChatSummary[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM ${TABLE}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as ChatSummaryRow[];

  return rows.map(mapRowToSummary);
}

export function updateChatSummarySyncStatus(
  id: string,
  syncStatus: SyncStatus,
  notionPageId?: string
): void {
  const db = getDb();
  const now = Date.now();

  if (notionPageId) {
    db.prepare(`
      UPDATE ${TABLE}
      SET sync_status = ?, notion_page_id = ?, updated_at = ?
      WHERE id = ?
    `).run(syncStatus, notionPageId, now, id);
  } else {
    db.prepare(`
      UPDATE ${TABLE}
      SET sync_status = ?, updated_at = ?
      WHERE id = ?
    `).run(syncStatus, now, id);
  }
}

export function updateChatSummary(
  id: string,
  updates: Partial<{
    title: string;
    summaryText: string;
    syncStatus: SyncStatus;
  }>
): ChatSummary | null {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).get(id) as ChatSummaryRow | undefined;
  
  if (!existing) return null;

  const now = Date.now();
  const sets: string[] = ['updated_at = ?'];
  const values: (string | number)[] = [now];

  if (updates.title !== undefined) {
    sets.push('title = ?');
    values.push(updates.title);
  }
  if (updates.summaryText !== undefined) {
    sets.push('summary_text = ?');
    values.push(updates.summaryText);
  }
  if (updates.syncStatus !== undefined) {
    sets.push('sync_status = ?');
    values.push(updates.syncStatus);
  }

  values.push(id);

  db.prepare(`
    UPDATE ${TABLE}
    SET ${sets.join(', ')}
    WHERE id = ?
  `).run(...values);

  const updated = db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).get(id) as ChatSummaryRow;
  return mapRowToSummary(updated);
}

export function deleteChatSummary(id: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function getPendingSyncSummaries(): ChatSummary[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM ${TABLE}
    WHERE sync_status = 'pending'
    ORDER BY created_at ASC
  `).all() as ChatSummaryRow[];

  return rows.map(mapRowToSummary);
}

export function getChatSummaryCount(): number {
  const db = getDb();
  const result = db.prepare(`SELECT COUNT(*) as count FROM ${TABLE}`).get() as { count: number };
  return result.count;
}

/**
 * Clear all chat summaries from the database
 */
export function clearAllChatSummaries(): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM ${TABLE}`).run();
  console.log(`[DB] Cleared all ${result.changes} chat summaries`);
  return result.changes;
}


