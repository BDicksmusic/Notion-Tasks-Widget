import type { Database } from 'better-sqlite3';

type Migration = {
  id: string;
  statements: string[];
};

const migrations: Migration[] = [
  {
    id: '001_initial_schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS tasks (
        client_id TEXT PRIMARY KEY,
        notion_id TEXT,
        payload TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_modified_local INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        last_modified_notion INTEGER NOT NULL DEFAULT 0,
        field_local_ts TEXT NOT NULL DEFAULT '{}',
        field_notion_ts TEXT NOT NULL DEFAULT '{}'
      );`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_notion ON tasks(notion_id);`,
      `CREATE TABLE IF NOT EXISTS time_logs (
        client_id TEXT PRIMARY KEY,
        notion_id TEXT,
        payload TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_modified_local INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        last_modified_notion INTEGER NOT NULL DEFAULT 0,
        field_local_ts TEXT NOT NULL DEFAULT '{}',
        field_notion_ts TEXT NOT NULL DEFAULT '{}'
      );`,
      `CREATE INDEX IF NOT EXISTS idx_time_logs_notion ON time_logs(notion_id);`,
      `CREATE TABLE IF NOT EXISTS writing_entries (
        client_id TEXT PRIMARY KEY,
        notion_id TEXT,
        payload TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_modified_local INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        last_modified_notion INTEGER NOT NULL DEFAULT 0,
        field_local_ts TEXT NOT NULL DEFAULT '{}',
        field_notion_ts TEXT NOT NULL DEFAULT '{}'
      );`,
      `CREATE INDEX IF NOT EXISTS idx_writing_entries_notion ON writing_entries(notion_id);`,
      `CREATE TABLE IF NOT EXISTS projects (
        client_id TEXT PRIMARY KEY,
        notion_id TEXT,
        payload TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_modified_local INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        last_modified_notion INTEGER NOT NULL DEFAULT 0,
        field_local_ts TEXT NOT NULL DEFAULT '{}',
        field_notion_ts TEXT NOT NULL DEFAULT '{}'
      );`,
      `CREATE INDEX IF NOT EXISTS idx_projects_notion ON projects(notion_id);`,
      `CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        client_id TEXT NOT NULL,
        notion_id TEXT,
        operation TEXT NOT NULL,
        payload TEXT NOT NULL,
        changed_fields TEXT NOT NULL DEFAULT '[]',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        pending_since INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, client_id);`,
      `CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );`
    ]
  },
  {
    id: '002_recurring_subtasks_snooze',
    statements: [
      // Add local-only columns for snooze, time tracking goals, and done tracking toggle
      `ALTER TABLE tasks ADD COLUMN snoozed_until TEXT;`,
      `ALTER TABLE tasks ADD COLUMN tracking_goal_minutes INTEGER;`,
      `ALTER TABLE tasks ADD COLUMN done_tracking_after_cycle INTEGER DEFAULT 0;`,
      `ALTER TABLE tasks ADD COLUMN auto_fill_estimated_time INTEGER DEFAULT 0;`,
      // Create index for finding snoozed tasks efficiently
      `CREATE INDEX IF NOT EXISTS idx_tasks_snoozed ON tasks(snoozed_until) WHERE snoozed_until IS NOT NULL;`,
      // Create table for task snooze notifications
      `CREATE TABLE IF NOT EXISTS task_snooze_notifications (
        task_id TEXT PRIMARY KEY,
        snooze_until INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );`
    ]
  },
  {
    id: '003_task_reminders',
    statements: [
      // Add reminder_at column for task notifications
      `ALTER TABLE tasks ADD COLUMN reminder_at TEXT;`,
      // Create index for finding tasks with reminders efficiently
      `CREATE INDEX IF NOT EXISTS idx_tasks_reminder ON tasks(reminder_at) WHERE reminder_at IS NOT NULL;`,
      // Create table for scheduled task reminders
      `CREATE TABLE IF NOT EXISTS task_reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        reminder_at INTEGER NOT NULL,
        notified INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );`,
      `CREATE INDEX IF NOT EXISTS idx_reminders_pending ON task_reminders(reminder_at) WHERE notified = 0;`
    ]
  },
  {
    id: '004_local_status_config',
    statements: [
      // Local status options - allows defining statuses independently of Notion
      // These serve as the PRIMARY source of truth for status options
      // Notion statuses can be synced/merged with these
      `CREATE TABLE IF NOT EXISTS local_status_options (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT,
        category TEXT DEFAULT 'task',
        sort_order INTEGER DEFAULT 0,
        is_completed INTEGER DEFAULT 0,
        notion_synced INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );`,
      `CREATE INDEX IF NOT EXISTS idx_status_category ON local_status_options(category);`,
      `CREATE INDEX IF NOT EXISTS idx_status_sort ON local_status_options(sort_order);`,
      
      // Local project status options (separate from task statuses)
      `CREATE TABLE IF NOT EXISTS local_project_status_options (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT,
        sort_order INTEGER DEFAULT 0,
        is_completed INTEGER DEFAULT 0,
        notion_synced INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );`,
      
      // Sync log for tracking what has been synced to Notion
      `CREATE TABLE IF NOT EXISTS sync_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error_message TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        completed_at INTEGER
      );`,
      `CREATE INDEX IF NOT EXISTS idx_sync_audit_pending ON sync_audit_log(status) WHERE status = 'pending';`
    ]
  },
  {
    id: '005_chat_summaries',
    statements: [
      // Chat summaries table for storing chatbot conversation summaries
      `CREATE TABLE IF NOT EXISTS chat_summaries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        transcript TEXT NOT NULL,
        actions_json TEXT NOT NULL DEFAULT '[]',
        summary_text TEXT,
        notion_page_id TEXT,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );`,
      `CREATE INDEX IF NOT EXISTS idx_chat_summaries_created ON chat_summaries(created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_chat_summaries_sync ON chat_summaries(sync_status);`
    ]
  }
];

export function runMigrations(db: Database) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );`
  );

  const applied = new Set<string>(
    (db.prepare(`SELECT id FROM migrations ORDER BY applied_at ASC`).all() as { id: string }[])
      .map((entry) => entry.id)
  );

  const apply = db.transaction((migration: Migration) => {
    migration.statements.forEach((statement) => db.exec(statement));
    db.prepare(
      `INSERT OR REPLACE INTO migrations (id, applied_at) VALUES (?, ?)`
    ).run(migration.id, Date.now());
  });

  migrations.forEach((migration) => {
    if (!applied.has(migration.id)) {
      apply(migration);
    }
  });
}

