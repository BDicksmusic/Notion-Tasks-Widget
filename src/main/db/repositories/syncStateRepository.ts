import { getDb } from '../database';

export function getSyncState(key: string) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT value FROM sync_state WHERE key = ? LIMIT 1`
    )
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSyncState(key: string, value: string) {
  const db = getDb();
  db.prepare(
    `INSERT INTO sync_state (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, Date.now());
}

export function clearSyncState(key: string) {
  const db = getDb();
  db.prepare(`DELETE FROM sync_state WHERE key = ?`).run(key);
}

export function clearAllSyncState() {
  const db = getDb();
  db.prepare(`DELETE FROM sync_state`).run();
  console.log('[SyncState] Cleared all sync state');
}

