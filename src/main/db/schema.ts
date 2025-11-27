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
  },
  {
    id: '006_task_trash',
    statements: [
      // Add trashed_at column to track when tasks were detected as deleted in Notion
      `ALTER TABLE tasks ADD COLUMN trashed_at TEXT;`,
      // Index for efficiently querying trashed tasks
      `CREATE INDEX IF NOT EXISTS idx_tasks_trashed ON tasks(trashed_at) WHERE trashed_at IS NOT NULL;`
    ]
  },
  {
    id: '007_notion_unique_id',
    statements: [
      // Add notion_unique_id column to all entity tables for Notion's unique ID property
      // This stores prefixed IDs like "ACTION-123", "PRJ-45", "TIME-LOG-67", "WRITE-LOG-89"
      // which are stable identifiers that survive page duplication and are better for deduplication
      `ALTER TABLE tasks ADD COLUMN notion_unique_id TEXT;`,
      `ALTER TABLE time_logs ADD COLUMN notion_unique_id TEXT;`,
      `ALTER TABLE writing_entries ADD COLUMN notion_unique_id TEXT;`,
      `ALTER TABLE projects ADD COLUMN notion_unique_id TEXT;`,
      // Create unique indexes to enforce deduplication by Notion unique ID
      // UNIQUE constraint ensures we can't have duplicates with the same Notion unique ID
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_unique_id ON tasks(notion_unique_id) WHERE notion_unique_id IS NOT NULL;`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_time_logs_unique_id ON time_logs(notion_unique_id) WHERE notion_unique_id IS NOT NULL;`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_writing_entries_unique_id ON writing_entries(notion_unique_id) WHERE notion_unique_id IS NOT NULL;`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_unique_id ON projects(notion_unique_id) WHERE notion_unique_id IS NOT NULL;`
    ]
  },
  {
    id: '008_dedicated_columns',
    statements: [
      // ============================================================================
      // TASKS: Add dedicated columns for frequently accessed/queried fields
      // This replaces JSON payload parsing with direct column access for better performance
      // ============================================================================
      `ALTER TABLE tasks ADD COLUMN title TEXT;`,
      `ALTER TABLE tasks ADD COLUMN status TEXT;`,
      `ALTER TABLE tasks ADD COLUMN normalized_status TEXT;`,
      `ALTER TABLE tasks ADD COLUMN due_date TEXT;`,
      `ALTER TABLE tasks ADD COLUMN due_date_end TEXT;`,
      `ALTER TABLE tasks ADD COLUMN hard_deadline INTEGER DEFAULT 0;`,
      `ALTER TABLE tasks ADD COLUMN urgent INTEGER DEFAULT 0;`,
      `ALTER TABLE tasks ADD COLUMN important INTEGER DEFAULT 0;`,
      `ALTER TABLE tasks ADD COLUMN parent_task_id TEXT;`,
      `ALTER TABLE tasks ADD COLUMN main_entry TEXT;`,
      `ALTER TABLE tasks ADD COLUMN body TEXT;`,
      `ALTER TABLE tasks ADD COLUMN recurrence TEXT;`,  // JSON array of weekdays
      `ALTER TABLE tasks ADD COLUMN session_length_minutes INTEGER;`,
      `ALTER TABLE tasks ADD COLUMN estimated_length_minutes INTEGER;`,
      `ALTER TABLE tasks ADD COLUMN order_value TEXT;`,
      `ALTER TABLE tasks ADD COLUMN order_color TEXT;`,
      `ALTER TABLE tasks ADD COLUMN project_ids TEXT;`,  // JSON array of project IDs
      `ALTER TABLE tasks ADD COLUMN url TEXT;`,
      `ALTER TABLE tasks ADD COLUMN last_edited TEXT;`,
      
      // ============================================================================
      // PROJECTS: Add dedicated columns
      // ============================================================================
      `ALTER TABLE projects ADD COLUMN title TEXT;`,
      `ALTER TABLE projects ADD COLUMN status TEXT;`,
      `ALTER TABLE projects ADD COLUMN description TEXT;`,
      `ALTER TABLE projects ADD COLUMN start_date TEXT;`,
      `ALTER TABLE projects ADD COLUMN end_date TEXT;`,
      `ALTER TABLE projects ADD COLUMN tags TEXT;`,  // JSON array
      `ALTER TABLE projects ADD COLUMN emoji TEXT;`,
      `ALTER TABLE projects ADD COLUMN icon_url TEXT;`,
      `ALTER TABLE projects ADD COLUMN url TEXT;`,
      `ALTER TABLE projects ADD COLUMN last_edited TEXT;`,
      
      // ============================================================================
      // TIME_LOGS: Add dedicated columns
      // ============================================================================
      `ALTER TABLE time_logs ADD COLUMN title TEXT;`,
      `ALTER TABLE time_logs ADD COLUMN task_id TEXT;`,
      `ALTER TABLE time_logs ADD COLUMN task_title TEXT;`,
      `ALTER TABLE time_logs ADD COLUMN status TEXT;`,
      `ALTER TABLE time_logs ADD COLUMN start_time TEXT;`,
      `ALTER TABLE time_logs ADD COLUMN end_time TEXT;`,
      `ALTER TABLE time_logs ADD COLUMN duration_minutes INTEGER;`,
      
      // ============================================================================
      // INDEXES: Create indexes for commonly queried columns
      // ============================================================================
      `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_normalized_status ON tasks(normalized_status);`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_urgent ON tasks(urgent) WHERE urgent = 1;`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_important ON tasks(important) WHERE important = 1;`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_hard_deadline ON tasks(hard_deadline) WHERE hard_deadline = 1;`,
      
      `CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);`,
      `CREATE INDEX IF NOT EXISTS idx_projects_start_date ON projects(start_date);`,
      `CREATE INDEX IF NOT EXISTS idx_projects_end_date ON projects(end_date);`,
      
      `CREATE INDEX IF NOT EXISTS idx_time_logs_task_id ON time_logs(task_id);`,
      `CREATE INDEX IF NOT EXISTS idx_time_logs_start_time ON time_logs(start_time);`,
      `CREATE INDEX IF NOT EXISTS idx_time_logs_status ON time_logs(status);`,
      
      // ============================================================================
      // WRITING_ENTRIES: Add dedicated columns
      // ============================================================================
      `ALTER TABLE writing_entries ADD COLUMN title TEXT;`,
      `ALTER TABLE writing_entries ADD COLUMN summary TEXT;`,
      `ALTER TABLE writing_entries ADD COLUMN content TEXT;`,
      `ALTER TABLE writing_entries ADD COLUMN tags TEXT;`,  // JSON array
      `ALTER TABLE writing_entries ADD COLUMN status TEXT;`,
      `ALTER TABLE writing_entries ADD COLUMN content_blocks TEXT;`,  // JSON array of MarkdownBlock
      
      // Indexes for writing entries
      `CREATE INDEX IF NOT EXISTS idx_writing_entries_status ON writing_entries(status);`,
      `CREATE INDEX IF NOT EXISTS idx_writing_entries_title ON writing_entries(title);`
    ]
  },
  {
    id: '009_notion_database_schema',
    statements: [
      // ============================================================================
      // NOTION DATABASE SCHEMA REGISTRY
      // Stores the actual property definitions from Notion databases
      // This enables:
      // - Auto-discovery of available properties
      // - Stable sync using property_id (survives renames)
      // - Caching of select/status options
      // - Smart property mapping suggestions
      // ============================================================================
      `CREATE TABLE IF NOT EXISTS notion_database_schema (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        
        -- Database identity
        database_id TEXT NOT NULL,
        database_type TEXT NOT NULL,
        
        -- Property info from Notion
        property_name TEXT NOT NULL,
        property_id TEXT,
        property_type TEXT NOT NULL,
        property_options TEXT,
        
        -- Local mapping
        local_column TEXT,
        is_mapped INTEGER DEFAULT 0,
        is_required INTEGER DEFAULT 0,
        
        -- Tracking
        last_synced_at TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        
        UNIQUE(database_id, property_name)
      );`,
      
      `CREATE INDEX IF NOT EXISTS idx_schema_database ON notion_database_schema(database_id);`,
      `CREATE INDEX IF NOT EXISTS idx_schema_type ON notion_database_schema(database_type);`,
      `CREATE INDEX IF NOT EXISTS idx_schema_local ON notion_database_schema(local_column) WHERE local_column IS NOT NULL;`,
      `CREATE INDEX IF NOT EXISTS idx_schema_property_id ON notion_database_schema(property_id) WHERE property_id IS NOT NULL;`
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

  // Run data migration for dedicated columns if migration 008 was just applied
  if (!applied.has('008_dedicated_columns')) {
    migratePayloadToColumns(db);
  }
}

/**
 * Migrate existing JSON payload data to dedicated columns.
 * This is a one-time migration that populates the new columns from payload.
 */
function migratePayloadToColumns(db: Database) {
  console.log('[Migration] Migrating payload data to dedicated columns...');

  // Migrate tasks
  const taskRows = db.prepare('SELECT client_id, payload FROM tasks').all() as { client_id: string; payload: string }[];
  let tasksUpdated = 0;
  
  const updateTask = db.prepare(`
    UPDATE tasks SET
      title = ?,
      status = ?,
      normalized_status = ?,
      due_date = ?,
      due_date_end = ?,
      hard_deadline = ?,
      urgent = ?,
      important = ?,
      parent_task_id = ?,
      main_entry = ?,
      body = ?,
      recurrence = ?,
      session_length_minutes = ?,
      estimated_length_minutes = ?,
      order_value = ?,
      order_color = ?,
      project_ids = ?,
      url = ?,
      last_edited = ?
    WHERE client_id = ?
  `);

  const migrateTasksTransaction = db.transaction(() => {
    for (const row of taskRows) {
      try {
        const task = JSON.parse(row.payload);
        updateTask.run(
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
          row.client_id
        );
        tasksUpdated++;
      } catch (e) {
        console.warn(`[Migration] Failed to migrate task ${row.client_id}:`, e);
      }
    }
  });
  migrateTasksTransaction();
  console.log(`[Migration] Migrated ${tasksUpdated} tasks to dedicated columns`);

  // Migrate projects
  const projectRows = db.prepare('SELECT client_id, payload FROM projects').all() as { client_id: string; payload: string }[];
  let projectsUpdated = 0;

  const updateProject = db.prepare(`
    UPDATE projects SET
      title = ?,
      status = ?,
      description = ?,
      start_date = ?,
      end_date = ?,
      tags = ?,
      emoji = ?,
      icon_url = ?,
      url = ?,
      last_edited = ?
    WHERE client_id = ?
  `);

  const migrateProjectsTransaction = db.transaction(() => {
    for (const row of projectRows) {
      try {
        const project = JSON.parse(row.payload);
        updateProject.run(
          project.title ?? null,
          project.status ?? null,
          project.description ?? null,
          project.startDate ?? null,
          project.endDate ?? null,
          project.tags ? JSON.stringify(project.tags) : null,
          project.emoji ?? null,
          project.iconUrl ?? null,
          project.url ?? null,
          project.lastEdited ?? null,
          row.client_id
        );
        projectsUpdated++;
      } catch (e) {
        console.warn(`[Migration] Failed to migrate project ${row.client_id}:`, e);
      }
    }
  });
  migrateProjectsTransaction();
  console.log(`[Migration] Migrated ${projectsUpdated} projects to dedicated columns`);

  // Migrate time logs
  const timeLogRows = db.prepare('SELECT client_id, payload FROM time_logs').all() as { client_id: string; payload: string }[];
  let timeLogsUpdated = 0;

  const updateTimeLog = db.prepare(`
    UPDATE time_logs SET
      title = ?,
      task_id = ?,
      task_title = ?,
      status = ?,
      start_time = ?,
      end_time = ?,
      duration_minutes = ?
    WHERE client_id = ?
  `);

  const migrateTimeLogsTransaction = db.transaction(() => {
    for (const row of timeLogRows) {
      try {
        const entry = JSON.parse(row.payload);
        updateTimeLog.run(
          entry.title ?? null,
          entry.taskId ?? null,
          entry.taskTitle ?? null,
          entry.status ?? null,
          entry.startTime ?? null,
          entry.endTime ?? null,
          entry.durationMinutes ?? null,
          row.client_id
        );
        timeLogsUpdated++;
      } catch (e) {
        console.warn(`[Migration] Failed to migrate time log ${row.client_id}:`, e);
      }
    }
  });
  migrateTimeLogsTransaction();
  console.log(`[Migration] Migrated ${timeLogsUpdated} time logs to dedicated columns`);

  // Migrate writing entries
  const writingRows = db.prepare('SELECT client_id, payload FROM writing_entries').all() as { client_id: string; payload: string }[];
  let writingUpdated = 0;

  const updateWriting = db.prepare(`
    UPDATE writing_entries SET
      title = ?,
      summary = ?,
      content = ?,
      tags = ?,
      status = ?,
      content_blocks = ?
    WHERE client_id = ?
  `);

  const migrateWritingTransaction = db.transaction(() => {
    for (const row of writingRows) {
      try {
        const entry = JSON.parse(row.payload);
        updateWriting.run(
          entry.title ?? null,
          entry.summary ?? null,
          entry.content ?? null,
          entry.tags ? JSON.stringify(entry.tags) : null,
          entry.status ?? null,
          entry.contentBlocks ? JSON.stringify(entry.contentBlocks) : null,
          row.client_id
        );
        writingUpdated++;
      } catch (e) {
        console.warn(`[Migration] Failed to migrate writing entry ${row.client_id}:`, e);
      }
    }
  });
  migrateWritingTransaction();
  console.log(`[Migration] Migrated ${writingUpdated} writing entries to dedicated columns`);

  console.log('[Migration] Payload to columns migration complete!');
}

