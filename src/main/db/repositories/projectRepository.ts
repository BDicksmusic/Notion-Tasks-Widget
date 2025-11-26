import { randomUUID } from 'node:crypto';
import type { Project, SyncStatus, StatusBreakdown } from '../../../shared/types';
import { getDb } from '../database';
import { enqueueSyncEntry, clearEntriesForEntity } from './syncQueueRepository';

const TABLE = 'projects';

type ProjectRow = {
  client_id: string;
  notion_id: string | null;
  payload: string;
  sync_status: SyncStatus;
  last_modified_local: number;
  last_modified_notion: number;
  field_local_ts: string;
  field_notion_ts: string;
};

/**
 * Extended Project type with sync status info
 */
export interface ProjectWithSyncStatus extends Project {
  syncStatus?: SyncStatus;
  localOnly?: boolean;
}

function mapRowToProject(row: ProjectRow): ProjectWithSyncStatus {
  const project = JSON.parse(row.payload) as Project;
  project.id = project.id ?? row.notion_id ?? row.client_id;
  return {
    ...project,
    syncStatus: row.sync_status,
    localOnly: !row.notion_id
  };
}

export function listProjects() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM ${TABLE} ORDER BY last_modified_local DESC`
    )
    .all() as ProjectRow[];
  const projects = rows.map(mapRowToProject);
  
  // Log status data for diagnostics
  const withStatus = projects.filter(p => p.status).length;
  console.log(`[DB] listProjects: ${projects.length} projects, ${withStatus} have status`);
  
  // Log first few for inspection
  projects.slice(0, 3).forEach((p, i) => {
    console.log(`[DB] Project ${i + 1}: "${p.title}" → status="${p.status}"`);
  });
  
  return projects;
}

export function upsertProject(project: Project, updatedAt: string) {
  const db = getDb();
  const clientId = project.id;
  if (!clientId) {
    throw new Error('Project is missing identifier');
  }

  const payload = JSON.stringify(project);
  console.log(`[DB] upsertProject: "${project.title}" → status="${project.status}"`);
  
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
    ) VALUES (?, ?, ?, 'synced', ?, ?, '{}', '{}')
    ON CONFLICT(client_id) DO UPDATE SET
      notion_id = excluded.notion_id,
      payload = excluded.payload,
      sync_status = excluded.sync_status,
      last_modified_local = excluded.last_modified_local,
      last_modified_notion = excluded.last_modified_notion`
  ).run(
    clientId,
    project.id,
    payload,
    Date.now(),
    Date.parse(updatedAt)
  );
}

export function getProjectStatusBreakdown(): StatusBreakdown {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT payload, last_modified_local FROM ${TABLE}`
    )
    .all() as Pick<ProjectRow, 'payload' | 'last_modified_local'>[];

  const counts = new Map<string, number>();
  let withStatus = 0;
  let withoutStatus = 0;
  let latest = 0;

  rows.forEach((row) => {
    const project = JSON.parse(row.payload) as Project;
    const statusName = (project.status?.trim() || 'No Status');
    if (statusName === 'No Status') {
      withoutStatus += 1;
    } else {
      withStatus += 1;
    }
    counts.set(statusName, (counts.get(statusName) ?? 0) + 1);
    if (row.last_modified_local > latest) {
      latest = row.last_modified_local;
    }
  });

  return {
    total: rows.length,
    withStatus,
    withoutStatus,
    unique: counts.size,
    lastUpdated: latest ? new Date(latest).toISOString() : null,
    statuses: Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
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
 * 
 * LOCAL-FIRST: Projects created here work immediately without Notion.
 * They will be synced to Notion in the background when possible.
 */
export function createLocalProject(payload: CreateLocalProjectPayload): ProjectWithSyncStatus {
  const db = getDb();
  const clientId = `local-project-${randomUUID()}`;
  const now = Date.now();
  
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
  
  const serializedPayload = JSON.stringify(project);
  
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
    ) VALUES (?, NULL, ?, 'pending', ?, 0, '{}', '{}')`
  ).run(clientId, serializedPayload, now);
  
  // Queue for sync to Notion
  enqueueSyncEntry(
    'project',
    clientId,
    'create',
    { payload, clientId },
    Object.keys(payload).filter(k => (payload as any)[k] !== undefined)
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
  const db = getDb();
  
  // Get existing project
  const row = db.prepare(
    `SELECT * FROM ${TABLE} WHERE client_id = ? OR notion_id = ? LIMIT 1`
  ).get(projectId, projectId) as ProjectRow | undefined;
  
  if (!row) {
    console.warn(`[DB] Project not found for update: ${projectId}`);
    return null;
  }
  
  const existingProject = JSON.parse(row.payload) as Project;
  
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
  
  const serializedPayload = JSON.stringify(updatedProject);
  
  db.prepare(
    `UPDATE ${TABLE} SET 
      payload = ?,
      sync_status = 'pending',
      last_modified_local = ?
     WHERE client_id = ? OR notion_id = ?`
  ).run(serializedPayload, Date.now(), projectId, projectId);
  
  // Queue for sync (only if it has a Notion ID)
  if (row.notion_id) {
    enqueueSyncEntry(
      'project',
      row.client_id,
      'update',
      { updates, clientId: row.client_id },
      Object.keys(updates).filter(k => (updates as any)[k] !== undefined),
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
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM ${TABLE} WHERE client_id = ? OR notion_id = ? LIMIT 1`
  ).get(projectId, projectId) as ProjectRow | undefined;
  
  return row ? mapRowToProject(row) : null;
}

/**
 * Delete a local project
 */
export function deleteLocalProject(projectId: string): boolean {
  const db = getDb();
  
  const row = db.prepare(
    `SELECT * FROM ${TABLE} WHERE client_id = ? OR notion_id = ? LIMIT 1`
  ).get(projectId, projectId) as ProjectRow | undefined;
  
  if (!row) {
    return false;
  }
  
  db.prepare(`DELETE FROM ${TABLE} WHERE client_id = ?`).run(row.client_id);
  clearEntriesForEntity('project', row.client_id);
  
  console.log(`[DB] Deleted project: ${projectId}`);
  return true;
}


