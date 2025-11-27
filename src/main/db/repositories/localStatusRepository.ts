import { randomUUID } from 'node:crypto';
import { getDb } from '../database';
import type { TaskStatusOption } from '../../../shared/types';

/**
 * Local Status Repository
 * 
 * This manages status options independently of Notion, allowing the app to:
 * 1. Work offline with locally-defined statuses
 * 2. Create statuses that will later sync to Notion
 * 3. Merge Notion statuses with local statuses
 * 
 * LOCAL-FIRST PHILOSOPHY:
 * - Local statuses are the PRIMARY source of truth
 * - Notion statuses are MERGED into local statuses during sync
 * - Users can create/edit statuses without Notion connection
 */

interface LocalStatusRow {
  id: string;
  name: string;
  color: string | null;
  category: string;
  sort_order: number;
  is_completed: number;
  notion_synced: number;
  created_at: number;
  updated_at: number;
}

interface LocalProjectStatusRow {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
  is_completed: number;
  notion_synced: number;
  created_at: number;
  updated_at: number;
}

function rowToStatusOption(row: LocalStatusRow): TaskStatusOption & { 
  category: string;
  sortOrder: number;
  isCompleted: boolean;
  notionSynced: boolean;
} {
  return {
    id: row.id,
    name: row.name,
    color: row.color ?? undefined,
    category: row.category,
    sortOrder: row.sort_order,
    isCompleted: row.is_completed === 1,
    notionSynced: row.notion_synced === 1
  };
}

// ============================================================================
// TASK STATUS OPERATIONS
// ============================================================================

/**
 * Get all local task status options
 */
export function listLocalTaskStatuses(): TaskStatusOption[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM local_status_options WHERE category = 'task' ORDER BY sort_order ASC, name ASC`
  ).all() as LocalStatusRow[];
  
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    color: row.color ?? undefined
  }));
}

/**
 * Get all local task status options with metadata
 */
export function listLocalTaskStatusesFull() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM local_status_options WHERE category = 'task' ORDER BY sort_order ASC, name ASC`
  ).all() as LocalStatusRow[];
  
  return rows.map(rowToStatusOption);
}

/**
 * Create a new local task status
 */
export function createLocalTaskStatus(options: {
  name: string;
  color?: string;
  sortOrder?: number;
  isCompleted?: boolean;
}): TaskStatusOption {
  const db = getDb();
  const id = `local-status-${randomUUID()}`;
  const now = Date.now();
  
  // Get max sort order if not provided
  let sortOrder = options.sortOrder;
  if (sortOrder === undefined) {
    const maxResult = db.prepare(
      `SELECT MAX(sort_order) as max FROM local_status_options WHERE category = 'task'`
    ).get() as { max: number | null };
    sortOrder = (maxResult?.max ?? -1) + 1;
  }
  
  db.prepare(
    `INSERT INTO local_status_options (id, name, color, category, sort_order, is_completed, notion_synced, created_at, updated_at)
     VALUES (?, ?, ?, 'task', ?, ?, 0, ?, ?)`
  ).run(id, options.name.trim(), options.color ?? null, sortOrder, options.isCompleted ? 1 : 0, now, now);
  
  console.log(`[LocalStatus] Created task status: "${options.name}" (id: ${id})`);
  
  return {
    id,
    name: options.name.trim(),
    color: options.color
  };
}

/**
 * Update a local task status
 */
export function updateLocalTaskStatus(id: string, updates: {
  name?: string;
  color?: string | null;
  sortOrder?: number;
  isCompleted?: boolean;
}): void {
  const db = getDb();
  const now = Date.now();
  
  const sets: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];
  
  if (updates.name !== undefined) {
    sets.push('name = ?');
    values.push(updates.name.trim());
  }
  if (updates.color !== undefined) {
    sets.push('color = ?');
    values.push(updates.color);
  }
  if (updates.sortOrder !== undefined) {
    sets.push('sort_order = ?');
    values.push(updates.sortOrder);
  }
  if (updates.isCompleted !== undefined) {
    sets.push('is_completed = ?');
    values.push(updates.isCompleted ? 1 : 0);
  }
  
  values.push(id);
  
  db.prepare(
    `UPDATE local_status_options SET ${sets.join(', ')} WHERE id = ?`
  ).run(...values);
  
  console.log(`[LocalStatus] Updated task status: ${id}`);
}

/**
 * Delete a local task status
 */
export function deleteLocalTaskStatus(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM local_status_options WHERE id = ?`).run(id);
  console.log(`[LocalStatus] Deleted task status: ${id}`);
}

/**
 * Merge Notion statuses into local statuses
 * - Adds new statuses from Notion that don't exist locally
 * - Does NOT overwrite existing local statuses
 * - Marks merged statuses as notion_synced
 */
export function mergeNotionTaskStatuses(notionStatuses: TaskStatusOption[]): void {
  const db = getDb();
  const now = Date.now();
  
  // Get existing local status names (case-insensitive comparison)
  const existingRows = db.prepare(
    `SELECT id, name, LOWER(name) as lower_name FROM local_status_options WHERE category = 'task'`
  ).all() as { id: string; name: string; lower_name: string }[];
  
  const existingNames = new Set(existingRows.map(r => r.lower_name));
  
  // Get max sort order
  const maxResult = db.prepare(
    `SELECT MAX(sort_order) as max FROM local_status_options WHERE category = 'task'`
  ).get() as { max: number | null };
  let sortOrder = (maxResult?.max ?? -1) + 1;
  
  const insert = db.prepare(
    `INSERT OR IGNORE INTO local_status_options (id, name, color, category, sort_order, is_completed, notion_synced, created_at, updated_at)
     VALUES (?, ?, ?, 'task', ?, 0, 1, ?, ?)`
  );
  
  let added = 0;
  for (const status of notionStatuses) {
    const lowerName = status.name.toLowerCase();
    if (!existingNames.has(lowerName)) {
      // Use Notion's ID if available, otherwise generate local ID
      const id = status.id || `notion-status-${randomUUID()}`;
      insert.run(id, status.name, status.color ?? null, sortOrder++, now, now);
      existingNames.add(lowerName);
      added++;
    }
  }
  
  if (added > 0) {
    console.log(`[LocalStatus] Merged ${added} task statuses from Notion`);
  }
}

/**
 * Initialize default task statuses if none exist
 * These are common statuses that most task systems use
 */
export function initializeDefaultTaskStatuses(): void {
  const db = getDb();
  
  // Check if any statuses exist
  const count = db.prepare(
    `SELECT COUNT(*) as count FROM local_status_options WHERE category = 'task'`
  ).get() as { count: number };
  
  if (count.count > 0) {
    return; // Already have statuses
  }
  
  console.log('[LocalStatus] Initializing default task statuses...');
  
  const defaults = [
    { name: '📥 Inbox', color: 'gray', sortOrder: 0, isCompleted: false },
    { name: '📋 To-Do', color: 'blue', sortOrder: 1, isCompleted: false },
    { name: '⌚ Active', color: 'yellow', sortOrder: 2, isCompleted: false },
    { name: '⌛ Waiting', color: 'orange', sortOrder: 3, isCompleted: false },
    { name: '✅ Done', color: 'green', sortOrder: 4, isCompleted: true }
  ];
  
  defaults.forEach(status => {
    createLocalTaskStatus(status);
  });
  
  console.log(`[LocalStatus] Initialized ${defaults.length} default task statuses`);
}

// ============================================================================
// PROJECT STATUS OPERATIONS
// ============================================================================

/**
 * Get all local project status options
 */
export function listLocalProjectStatuses(): TaskStatusOption[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM local_project_status_options ORDER BY sort_order ASC, name ASC`
  ).all() as LocalProjectStatusRow[];
  
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    color: row.color ?? undefined
  }));
}

/**
 * Create a new local project status
 */
export function createLocalProjectStatus(options: {
  name: string;
  color?: string;
  sortOrder?: number;
  isCompleted?: boolean;
}): TaskStatusOption {
  const db = getDb();
  const id = `local-proj-status-${randomUUID()}`;
  const now = Date.now();
  
  // Get max sort order if not provided
  let sortOrder = options.sortOrder;
  if (sortOrder === undefined) {
    const maxResult = db.prepare(
      `SELECT MAX(sort_order) as max FROM local_project_status_options`
    ).get() as { max: number | null };
    sortOrder = (maxResult?.max ?? -1) + 1;
  }
  
  db.prepare(
    `INSERT INTO local_project_status_options (id, name, color, sort_order, is_completed, notion_synced, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(id, options.name.trim(), options.color ?? null, sortOrder, options.isCompleted ? 1 : 0, now, now);
  
  console.log(`[LocalStatus] Created project status: "${options.name}" (id: ${id})`);
  
  return {
    id,
    name: options.name.trim(),
    color: options.color
  };
}

/**
 * Merge Notion project statuses into local project statuses
 */
export function mergeNotionProjectStatuses(notionStatuses: TaskStatusOption[]): void {
  const db = getDb();
  const now = Date.now();
  
  const existingRows = db.prepare(
    `SELECT id, name, LOWER(name) as lower_name FROM local_project_status_options`
  ).all() as { id: string; name: string; lower_name: string }[];
  
  const existingNames = new Set(existingRows.map(r => r.lower_name));
  
  const maxResult = db.prepare(
    `SELECT MAX(sort_order) as max FROM local_project_status_options`
  ).get() as { max: number | null };
  let sortOrder = (maxResult?.max ?? -1) + 1;
  
  const insert = db.prepare(
    `INSERT OR IGNORE INTO local_project_status_options (id, name, color, sort_order, is_completed, notion_synced, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 1, ?, ?)`
  );
  
  let added = 0;
  for (const status of notionStatuses) {
    const lowerName = status.name.toLowerCase();
    if (!existingNames.has(lowerName)) {
      const id = status.id || `notion-proj-status-${randomUUID()}`;
      insert.run(id, status.name, status.color ?? null, sortOrder++, now, now);
      existingNames.add(lowerName);
      added++;
    }
  }
  
  if (added > 0) {
    console.log(`[LocalStatus] Merged ${added} project statuses from Notion`);
  }
}

/**
 * Initialize default project statuses if none exist
 */
export function initializeDefaultProjectStatuses(): void {
  const db = getDb();
  
  const count = db.prepare(
    `SELECT COUNT(*) as count FROM local_project_status_options`
  ).get() as { count: number };
  
  if (count.count > 0) {
    return;
  }
  
  console.log('[LocalStatus] Initializing default project statuses...');
  
  const defaults = [
    { name: 'Planning', color: 'gray', sortOrder: 0, isCompleted: false },
    { name: 'Plotted', color: 'blue', sortOrder: 1, isCompleted: false },
    { name: 'Waiting', color: 'orange', sortOrder: 2, isCompleted: false },
    { name: 'To-Do', color: 'yellow', sortOrder: 3, isCompleted: false },
    { name: 'Done', color: 'green', sortOrder: 4, isCompleted: true }
  ];
  
  defaults.forEach(status => {
    createLocalProjectStatus(status);
  });
  
  console.log(`[LocalStatus] Initialized ${defaults.length} default project statuses`);
}

// ============================================================================
// COMBINED OPERATIONS
// ============================================================================

/**
 * Get combined status options (local + any from Notion not in local)
 * Local statuses take precedence
 */
export function getCombinedTaskStatuses(notionStatuses?: TaskStatusOption[]): TaskStatusOption[] {
  // Start with local statuses
  const localStatuses = listLocalTaskStatuses();
  
  if (!notionStatuses || notionStatuses.length === 0) {
    return localStatuses;
  }
  
  // Merge any Notion statuses that don't exist locally
  mergeNotionTaskStatuses(notionStatuses);
  
  // Return updated list
  return listLocalTaskStatuses();
}

/**
 * Initialize all default statuses
 * Call this on app startup
 */
export function initializeAllDefaultStatuses(): void {
  initializeDefaultTaskStatuses();
  initializeDefaultProjectStatuses();
}

/**
 * Clear all local task statuses from the database
 */
export function clearAllLocalTaskStatuses(): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM local_status_options`).run();
  console.log(`[DB] Cleared all ${result.changes} local task statuses`);
  return result.changes;
}

/**
 * Clear all local project statuses from the database
 */
export function clearAllLocalProjectStatuses(): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM local_project_status_options`).run();
  console.log(`[DB] Cleared all ${result.changes} local project statuses`);
  return result.changes;
}

/**
 * Clear all local statuses (both task and project)
 */
export function clearAllLocalStatuses(): number {
  const taskCount = clearAllLocalTaskStatuses();
  const projectCount = clearAllLocalProjectStatuses();
  return taskCount + projectCount;
}



