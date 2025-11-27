import { randomUUID } from 'node:crypto';
import type { Project, SyncStatus, StatusBreakdown } from '../../../shared/types';
import { getDb } from '../database';
import { enqueueSyncEntry, clearEntriesForEntity } from './syncQueueRepository';

const TABLE = 'projects';

/**
 * Project row with dedicated columns for performance.
 * Columns are the source of truth; payload kept for backwards compatibility.
 */
type ProjectRow = {
  client_id: string;
  notion_id: string | null;
  notion_unique_id: string | null;
  payload: string;  // Kept for backwards compatibility / extra fields
  sync_status: SyncStatus;
  last_modified_local: number;
  last_modified_notion: number;
  field_local_ts: string;
  field_notion_ts: string;
  // Dedicated columns (source of truth)
  title: string | null;
  status: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  tags: string | null;  // JSON array
  emoji: string | null;
  icon_url: string | null;
  url: string | null;
  last_edited: string | null;
};

/**
 * Extended Project type with sync status info
 */
export interface ProjectWithSyncStatus extends Project {
  syncStatus?: SyncStatus;
  localOnly?: boolean;
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
 * Map a database row to a Project object.
 * Reads from dedicated columns (source of truth), not from JSON payload.
 */
function mapRowToProject(row: ProjectRow): ProjectWithSyncStatus {
  return {
    // Identity
    id: row.notion_id ?? row.client_id,
    uniqueId: row.notion_unique_id ?? undefined,
    
    // Core fields from columns
    title: row.title ?? undefined,
    status: row.status ?? undefined,
    description: row.description ?? undefined,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    tags: parseJsonArray<string>(row.tags),
    emoji: row.emoji ?? undefined,
    iconUrl: row.icon_url ?? undefined,
    url: row.url ?? undefined,
    lastEdited: row.last_edited ?? undefined,
    
    // Sync status
    syncStatus: row.sync_status,
    localOnly: !row.notion_id
  };
}

/**
 * Save a project to the database using dedicated columns.
 */
function saveProjectRow(
  clientId: string,
  project: Project,
  syncStatus: SyncStatus,
  options: {
    notionId?: string | null;
    notionUniqueId?: string | null;
    lastModifiedLocal?: number;
    lastModifiedNotion?: number;
  }
) {
  const db = getDb();
  const {
    notionId = null,
    notionUniqueId = null,
    lastModifiedLocal = Date.now(),
    lastModifiedNotion = 0
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
      status,
      description,
      start_date,
      end_date,
      tags,
      emoji,
      icon_url,
      url,
      last_edited
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET
      notion_id = excluded.notion_id,
      notion_unique_id = excluded.notion_unique_id,
      payload = excluded.payload,
      sync_status = excluded.sync_status,
      last_modified_local = excluded.last_modified_local,
      last_modified_notion = excluded.last_modified_notion,
      title = excluded.title,
      status = excluded.status,
      description = excluded.description,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      tags = excluded.tags,
      emoji = excluded.emoji,
      icon_url = excluded.icon_url,
      url = excluded.url,
      last_edited = excluded.last_edited`
  ).run(
    clientId,
    notionId ?? null,
    notionUniqueId ?? null,
    payload,
    syncStatus,
    lastModifiedLocal,
    lastModifiedNotion,
    // Dedicated columns
    project.title ?? null,
    project.status ?? null,
    project.description ?? null,
    project.startDate ?? null,
    project.endDate ?? null,
    project.tags ? JSON.stringify(project.tags) : null,
    project.emoji ?? null,
    project.iconUrl ?? null,
    project.url ?? null,
    project.lastEdited ?? null
  );
}

export function listProjects() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM ${TABLE} ORDER BY last_modified_local DESC`
    )
    .all() as ProjectRow[];
  const projects = rows.map(mapRowToProject);
  
  const withStatus = projects.filter(p => p.status).length;
  console.log(`[DB] listProjects: ${projects.length} projects, ${withStatus} have status`);
  
  projects.slice(0, 3).forEach((p, i) => {
    console.log(`[DB] Project ${i + 1}: "${p.title}" → status="${p.status}"`);
  });
  
  return projects;
}

/**
 * List projects by status - uses indexed column for fast lookup
 */
export function listProjectsByStatus(status: string): ProjectWithSyncStatus[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} WHERE status = ? ORDER BY last_modified_local DESC`
  ).all(status) as ProjectRow[];
  return rows.map(mapRowToProject);
}

/**
 * List projects by date range - uses indexed columns
 */
export function listProjectsByDateRange(startDate: string, endDate: string): ProjectWithSyncStatus[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} 
     WHERE (start_date >= ? AND start_date <= ?) 
        OR (end_date >= ? AND end_date <= ?)
     ORDER BY start_date ASC`
  ).all(startDate, endDate, startDate, endDate) as ProjectRow[];
  return rows.map(mapRowToProject);
}

/**
 * List active projects (projects with end_date in the future or null)
 */
export function listActiveProjects(): ProjectWithSyncStatus[] {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} 
     WHERE end_date IS NULL OR end_date >= ?
     ORDER BY start_date ASC`
  ).all(today) as ProjectRow[];
  return rows.map(mapRowToProject);
}

/**
 * Find a project row by its Notion unique ID (e.g., "PRJ-123")
 */
function readRowByUniqueId(uniqueId: string | null | undefined): ProjectRow | undefined {
  if (!uniqueId) return undefined;
  const db = getDb();
  return db
    .prepare(`SELECT * FROM ${TABLE} WHERE notion_unique_id = ? LIMIT 1`)
    .get(uniqueId) as ProjectRow | undefined;
}

function readRowById(projectId: string): ProjectRow | undefined {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM ${TABLE} WHERE client_id = ? OR notion_id = ? LIMIT 1`)
    .get(projectId, projectId) as ProjectRow | undefined;
}

export function upsertProject(project: Project, updatedAt: string) {
  // DEDUPLICATION STRATEGY:
  // 1. First check by uniqueId (e.g., "PRJ-123")
  // 2. Then fall back to project.id
  
  let existingRow = project.uniqueId ? readRowByUniqueId(project.uniqueId) : undefined;
  if (!existingRow) {
    existingRow = readRowById(project.id);
  }
  
  const clientId = existingRow?.client_id ?? project.id;
  if (!clientId) {
    throw new Error('Project is missing identifier');
  }

  console.log(`[DB] upsertProject: "${project.title}" → status="${project.status}", uniqueId="${project.uniqueId}"`);
  
  saveProjectRow(clientId, project, 'synced', {
    notionId: project.id,
    notionUniqueId: project.uniqueId ?? null,
    lastModifiedLocal: Date.now(),
    lastModifiedNotion: Date.parse(updatedAt)
  });
}

/**
 * Get project status breakdown using indexed column queries.
 * Much faster than parsing JSON payload for each row!
 */
export function getProjectStatusBreakdown(): StatusBreakdown {
  const db = getDb();
  
  // Use column-based aggregation - much faster!
  const statusCounts = db.prepare(`
    SELECT 
      COALESCE(NULLIF(TRIM(status), ''), 'No Status') as status_name,
      COUNT(*) as count
    FROM ${TABLE}
    GROUP BY status_name
    ORDER BY count DESC
  `).all() as { status_name: string; count: number }[];

  const totals = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status IS NOT NULL AND TRIM(status) != '' THEN 1 ELSE 0 END) as with_status,
      MAX(last_modified_local) as latest
    FROM ${TABLE}
  `).get() as { total: number; with_status: number; latest: number | null };

  return {
    total: totals.total,
    withStatus: totals.with_status,
    withoutStatus: totals.total - totals.with_status,
    unique: statusCounts.length,
    lastUpdated: totals.latest ? new Date(totals.latest).toISOString() : null,
    statuses: statusCounts.map(({ status_name, count }) => ({ name: status_name, count }))
  };
}

// ============================================================================
// LOCAL PROJECT CREATION
// ============================================================================

/**
 * Payload for creating a new local project
 */
export interface CreateLocalProjectPayload {
  title: string;
  status?: string | null;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  tags?: string[] | null;
}

/**
 * Create a new project locally (will sync to Notion later)
 */
export function createLocalProject(payload: CreateLocalProjectPayload): ProjectWithSyncStatus {
  const clientId = `local-project-${randomUUID()}`;
  
  const project: Project = {
    id: clientId,
    title: payload.title?.trim() || 'Untitled Project',
    status: payload.status ?? undefined,
    description: payload.description ?? undefined,
    startDate: payload.startDate ?? undefined,
    endDate: payload.endDate ?? undefined,
    tags: payload.tags ?? undefined,
    lastEdited: new Date().toISOString()
  };
  
  saveProjectRow(clientId, project, 'pending', {
    notionId: null,
    lastModifiedLocal: Date.now(),
    lastModifiedNotion: 0
  });
  
  // Queue for sync to Notion
  const payloadRecord = payload as unknown as Record<string, unknown>;
  enqueueSyncEntry(
    'project',
    clientId,
    'create',
    { payload, clientId },
    Object.keys(payload).filter(k => payloadRecord[k] !== undefined)
  );
  
  console.log(`[DB] Created local project: "${project.title}" (id: ${clientId})`);
  
  return {
    ...project,
    syncStatus: 'pending',
    localOnly: true
  };
}

/**
 * Update a local project
 */
export function updateLocalProject(
  projectId: string, 
  updates: Partial<CreateLocalProjectPayload>
): ProjectWithSyncStatus | null {
  const row = readRowById(projectId);
  
  if (!row) {
    console.warn(`[DB] Project not found for update: ${projectId}`);
    return null;
  }
  
  const existingProject = mapRowToProject(row);
  
  // Apply updates
  const updatedProject: Project = {
    ...existingProject,
    title: updates.title !== undefined ? updates.title : existingProject.title,
    status: updates.status !== undefined ? (updates.status ?? undefined) : existingProject.status,
    description: updates.description !== undefined ? (updates.description ?? undefined) : existingProject.description,
    startDate: updates.startDate !== undefined ? (updates.startDate ?? undefined) : existingProject.startDate,
    endDate: updates.endDate !== undefined ? (updates.endDate ?? undefined) : existingProject.endDate,
    tags: updates.tags !== undefined ? (updates.tags ?? undefined) : existingProject.tags,
    lastEdited: new Date().toISOString()
  };
  
  saveProjectRow(row.client_id, updatedProject, 'pending', {
    notionId: row.notion_id,
    notionUniqueId: row.notion_unique_id,
    lastModifiedLocal: Date.now(),
    lastModifiedNotion: row.last_modified_notion
  });
  
  // Queue for sync (only if it has a Notion ID)
  if (row.notion_id) {
    enqueueSyncEntry(
      'project',
      row.client_id,
      'update',
      { updates, clientId: row.client_id },
      Object.keys(updates).filter(k => (updates as Record<string, unknown>)[k] !== undefined),
      row.notion_id
    );
  }
  
  console.log(`[DB] Updated project: "${updatedProject.title}" (id: ${projectId})`);
  
  return {
    ...updatedProject,
    syncStatus: 'pending',
    localOnly: !row.notion_id
  };
}

/**
 * Get a single project by ID
 */
export function getProject(projectId: string): ProjectWithSyncStatus | null {
  const row = readRowById(projectId);
  return row ? mapRowToProject(row) : null;
}

/**
 * Delete a local project
 */
export function deleteLocalProject(projectId: string): boolean {
  const row = readRowById(projectId);
  
  if (!row) {
    return false;
  }
  
  const db = getDb();
  db.prepare(`DELETE FROM ${TABLE} WHERE client_id = ?`).run(row.client_id);
  clearEntriesForEntity('project', row.client_id);
  
  console.log(`[DB] Deleted project: ${projectId}`);
  return true;
}

/**
 * Clear all projects from the database
 */
export function clearAllProjects(): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM ${TABLE}`).run();
  console.log(`[DB] Cleared all ${result.changes} projects`);
  return result.changes;
}

/**
 * Count total projects in the database
 */
export function countProjects(): number {
  const db = getDb();
  const result = db.prepare(`SELECT COUNT(*) as count FROM ${TABLE}`).get() as { count: number };
  return result.count;
}
