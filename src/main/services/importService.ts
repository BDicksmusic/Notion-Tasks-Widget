/**
 * Import Service
 * 
 * Fast, reliable import from Notion to SQLite.
 * 
 * Key behavior:
 * - importActive() uses INSERT OR REPLACE to always update active items
 * - importAll() uses INSERT OR IGNORE to skip existing items (for initial setup)
 * - importSinceClose() fetches items modified since last app close
 */

import { getDb } from '../db/database';
import {
  getTaskSettings,
  getProjectsSettings,
} from '../configStore';

const PAGE_SIZE = 100;
const DELAY_MS = 50;
const RETRY_DELAY_MS = 3000;

// ============================================================================
// APP STATE MANAGEMENT
// ============================================================================

function ensureAppStateTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER
    )
  `);
}

export function getAppState(key: string): string | null {
  ensureAppStateTable();
  const db = getDb();
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setAppState(key: string, value: string): void {
  ensureAppStateTable();
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO app_state (key, value, updated_at)
    VALUES (?, ?, ?)
  `).run(key, value, Date.now());
}

export function getLastAppClose(): Date | null {
  const value = getAppState('last_app_close');
  return value ? new Date(value) : null;
}

export function markAppClose(): void {
  setAppState('last_app_close', new Date().toISOString());
  console.log('[ImportService] Marked app close time');
}

export function isFirstTimeSetup(): boolean {
  const setupComplete = getAppState('setup_complete');
  return setupComplete !== 'true';
}

export function markSetupComplete(mode: 'notion' | 'local'): void {
  setAppState('setup_complete', 'true');
  setAppState('setup_mode', mode);
  console.log(`[ImportService] Setup complete, mode: ${mode}`);
}

export function getSetupMode(): 'notion' | 'local' | null {
  const mode = getAppState('setup_mode');
  if (mode === 'notion' || mode === 'local') return mode;
  return null;
}

// ============================================================================
// NOTION API HELPERS
// ============================================================================

const NOTION_VERSION = '2022-06-28';

async function queryNotion(
  databaseId: string, 
  apiKey: string, 
  body: Record<string, unknown>
): Promise<{ results: any[]; has_more: boolean; next_cursor?: string }> {
  const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Notion API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data as { results: any[]; has_more: boolean; next_cursor?: string };
}

// ============================================================================
// PROPERTY EXTRACTION HELPERS
// ============================================================================

function isStatusActive(prop: any, activeValue: string): boolean {
  if (!prop) return false;
  const name = prop.status?.name || prop.select?.name || prop.checkbox;
  if (typeof name === 'boolean') return name;
  return name === activeValue;
}

function getNumber(prop: any): number | null {
  return prop?.number ?? null;
}

function getRichText(prop: any): string | null {
  const arr = prop?.rich_text;
  if (!arr || !Array.isArray(arr)) return null;
  return arr.map((t: any) => t.plain_text).join('') || null;
}

// ============================================================================
// IMPORT ACTIVE ITEMS (always updates existing)
// ============================================================================

export interface ImportResult {
  projects: { inserted: number; updated: number };
  tasks: { inserted: number; updated: number; links: number };
  timeMs: number;
}

export async function importActiveProjects(): Promise<{ inserted: number; updated: number }> {
  const settings = getProjectsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey || !settings.databaseId) {
    console.log('[ImportService] Projects not configured, skipping');
    return { inserted: 0, updated: 0 };
  }

  console.log('[ImportService] Syncing active projects...');
  
  const db = getDb();
  
  // Use INSERT OR REPLACE to always update active items
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO projects (
      client_id, notion_id, title, status, start_date, end_date, 
      url, last_edited, payload, sync_status, last_modified_local, last_modified_notion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'synced', ?, ?)
  `);
  const checkExists = db.prepare('SELECT 1 FROM projects WHERE client_id = ?');

  let inserted = 0, updated = 0, cursor: string | undefined, page = 0;
  
  const statusProp = settings.statusProperty || 'Status';
  const completedStatus = settings.completedStatus || 'Done';

  while (true) {
    page++;
    const body: Record<string, unknown> = {
      page_size: PAGE_SIZE,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      filter: {
        property: statusProp,
        status: { does_not_equal: completedStatus }
      }
    };
    if (cursor) body.start_cursor = cursor;

    try {
      const data = await queryNotion(settings.databaseId, apiKey, body);
      
      for (const p of data.results) {
        const exists = checkExists.get(p.id);
        
        const props = p.properties || {};
        const title = props[settings.titleProperty || 'Name']?.title?.[0]?.plain_text || 'Untitled';
        const status = props[statusProp]?.status?.name || null;
        const startDate = props[settings.startDateProperty || 'Start Date']?.date?.start || null;
        const endDate = props[settings.endDateProperty || 'Deadline']?.date?.start || null;
        
        upsert.run(
          p.id, p.id, title, status, startDate, endDate, 
          p.url, p.last_edited_time, Date.now(), Date.now()
        );
        
        if (exists) {
          updated++;
        } else {
          inserted++;
        }
      }

      console.log(`[ImportService] Projects page ${page}: ${data.results.length} fetched, ${inserted} new, ${updated} updated`);

      if (!data.has_more) break;
      cursor = data.next_cursor;
      await new Promise(r => setTimeout(r, DELAY_MS));
      
    } catch (error: any) {
      if (error.message?.includes('503') || error.message?.includes('504')) {
        console.log(`[ImportService] Timeout on page ${page}, retrying...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        page--;
        continue;
      }
      throw error;
    }
  }

  console.log(`[ImportService] Projects sync complete: ${inserted} new, ${updated} updated`);
  return { inserted, updated };
}

export async function importActiveTasks(): Promise<{ inserted: number; updated: number; links: number }> {
  const settings = getTaskSettings();
  
  if (!settings.apiKey || !settings.databaseId) {
    console.log('[ImportService] Tasks not configured, skipping');
    return { inserted: 0, updated: 0, links: 0 };
  }

  console.log('[ImportService] Syncing active tasks...');
  
  const db = getDb();
  
  // Use INSERT OR REPLACE to always update active items with ALL columns
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO tasks (
      client_id, notion_id, payload, sync_status, last_modified_local, last_modified_notion,
      title, status, due_date, due_date_end, url, last_edited,
      urgent, important, hard_deadline, main_entry, session_length_minutes, estimated_length_minutes, body
    ) VALUES (?, ?, ?, 'synced', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const checkExists = db.prepare('SELECT 1 FROM tasks WHERE client_id = ?');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_project_links (
      task_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      PRIMARY KEY (task_id, project_id)
    )
  `);
  const linkUpsert = db.prepare('INSERT OR IGNORE INTO task_project_links (task_id, project_id) VALUES (?, ?)');

  let inserted = 0, updated = 0, links = 0, cursor: string | undefined, page = 0;
  
  const statusProp = settings.statusProperty || 'Status';
  const completedStatus = settings.completedStatus || '✅';

  while (true) {
    page++;
    const reqBody: Record<string, unknown> = {
      page_size: PAGE_SIZE,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      filter: {
        property: statusProp,
        status: { does_not_equal: completedStatus }
      }
    };
    if (cursor) reqBody.start_cursor = cursor;

    try {
      const data = await queryNotion(settings.databaseId, settings.apiKey, reqBody);
      
      for (const t of data.results) {
        const exists = checkExists.get(t.id);
        const props = t.properties || {};
        
        // Core fields
        const title = props[settings.titleProperty || 'Name']?.title?.[0]?.plain_text || 'Untitled';
        const status = props[statusProp]?.status?.name || null;
        const dueDate = props[settings.dateProperty || 'Date']?.date?.start || null;
        const dueDateEnd = props[settings.dateProperty || 'Date']?.date?.end || null;
        const lastEdited = t.last_edited_time || null;
        const taskUrl = t.url || null;
        
        // Additional fields - with debug logging
        const urgentProp = props[settings.urgentProperty || 'Urgent'];
        const importantProp = props[settings.importantProperty || 'Important'];
        const deadlineProp = props[settings.deadlineProperty || 'Hard Deadline?'];
        
        // Debug: Log first few tasks to see property structure
        if (inserted + updated < 3) {
          console.log(`[ImportService] Task: ${title}`);
          console.log(`  - urgentProperty: "${settings.urgentProperty}" -> value:`, JSON.stringify(urgentProp));
          console.log(`  - importantProperty: "${settings.importantProperty}" -> value:`, JSON.stringify(importantProp));
          console.log(`  - deadlineProperty: "${settings.deadlineProperty}" -> value:`, JSON.stringify(deadlineProp));
        }
        
        const urgent = isStatusActive(urgentProp, settings.urgentStatusActive) ? 1 : 0;
        const important = isStatusActive(importantProp, settings.importantStatusActive) ? 1 : 0;
        const hardDeadline = isStatusActive(deadlineProp, settings.deadlineHardValue) ? 1 : 0;
        const mainEntry = getRichText(props[settings.mainEntryProperty || '']);
        const sessionLengthMinutes = getNumber(props[settings.sessionLengthProperty || '']);
        const estimatedLengthMinutes = getNumber(props[settings.estimatedLengthProperty || '']);
        const bodyText = getRichText(props[settings.bodyProperty || '']);
        
        const payload = JSON.stringify({ 
          title, status, dueDate, dueDateEnd, url: taskUrl, lastEdited,
          urgent: urgent === 1, important: important === 1, hardDeadline: hardDeadline === 1
        });
        
        upsert.run(
          t.id, t.id, payload, Date.now(), Date.now(),
          title, status, dueDate, dueDateEnd, taskUrl, lastEdited,
          urgent, important, hardDeadline, mainEntry, sessionLengthMinutes, estimatedLengthMinutes, bodyText
        );
        
        if (exists) {
          updated++;
        } else {
          inserted++;
        }

        // Capture project relations
        const projectRelProp = settings.projectRelationProperty || 'Project';
        const projectRel = props[projectRelProp]?.relation || props['Projects']?.relation || [];
        for (const rel of projectRel) {
          if (rel.id) { 
            linkUpsert.run(t.id, rel.id); 
            links++; 
          }
        }
      }

      console.log(`[ImportService] Tasks page ${page}: ${data.results.length} fetched, ${inserted} new, ${updated} updated`);

      if (!data.has_more) break;
      cursor = data.next_cursor;
      await new Promise(r => setTimeout(r, DELAY_MS));
      
    } catch (error: any) {
      if (error.message?.includes('503') || error.message?.includes('504')) {
        console.log(`[ImportService] Timeout on page ${page}, retrying...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        page--;
        continue;
      }
      throw error;
    }
  }

  console.log(`[ImportService] Tasks sync complete: ${inserted} new, ${updated} updated, ${links} links`);
  return { inserted, updated, links };
}

export async function importActive(): Promise<ImportResult> {
  const start = Date.now();
  
  const projects = await importActiveProjects();
  const tasks = await importActiveTasks();
  
  return {
    projects: { inserted: projects.inserted, updated: projects.updated },
    tasks: { inserted: tasks.inserted, updated: tasks.updated, links: tasks.links },
    timeMs: Date.now() - start
  };
}

// ============================================================================
// IMPORT SINCE CLOSE (DELTA SYNC)
// ============================================================================

export interface DeltaImportResult {
  projects: { updated: number };
  tasks: { updated: number; links: number };
  timeMs: number;
}

export async function importSinceClose(): Promise<DeltaImportResult> {
  const start = Date.now();
  const lastClose = getLastAppClose();
  const cutoff = lastClose?.toISOString() || '1970-01-01T00:00:00.000Z';
  
  console.log(`[ImportService] Delta sync since: ${lastClose?.toLocaleString() || 'beginning'}`);
  
  const projects = await importProjectsSince(cutoff);
  const tasks = await importTasksSince(cutoff);
  
  setAppState('last_app_close', new Date().toISOString());
  
  return {
    projects,
    tasks,
    timeMs: Date.now() - start
  };
}

async function importProjectsSince(cutoff: string): Promise<{ updated: number }> {
  const settings = getProjectsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey || !settings.databaseId) {
    return { updated: 0 };
  }

  const db = getDb();
  
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO projects (
      client_id, notion_id, title, status, start_date, end_date, 
      url, last_edited, payload, sync_status, last_modified_local, last_modified_notion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'synced', ?, ?)
  `);

  let updated = 0, cursor: string | undefined;

  while (true) {
    const body: Record<string, unknown> = {
      page_size: PAGE_SIZE,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }]
    };
    if (cursor) body.start_cursor = cursor;

    try {
      const data = await queryNotion(settings.databaseId, apiKey, body);
      let stoppedEarly = false;
      
      for (const p of data.results) {
        if (p.last_edited_time < cutoff) {
          console.log(`[ImportService] Projects: hit cutoff at ${p.last_edited_time.substring(0, 19)}`);
          stoppedEarly = true;
          break;
        }
        
        const props = p.properties || {};
        const title = props[settings.titleProperty || 'Name']?.title?.[0]?.plain_text || 'Untitled';
        const status = props[settings.statusProperty || 'Status']?.status?.name || null;
        const startDate = props[settings.startDateProperty || 'Start Date']?.date?.start || null;
        const endDate = props[settings.endDateProperty || 'Deadline']?.date?.start || null;
        
        upsert.run(
          p.id, p.id, title, status, startDate, endDate, 
          p.url, p.last_edited_time, Date.now(), Date.now()
        );
        updated++;
      }

      if (stoppedEarly || !data.has_more) break;
      cursor = data.next_cursor;
      
    } catch (error: any) {
      if (error.message?.includes('503') || error.message?.includes('504')) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw error;
    }
  }

  console.log(`[ImportService] Projects delta: ${updated} updated`);
  return { updated };
}

async function importTasksSince(cutoff: string): Promise<{ updated: number; links: number }> {
  const settings = getTaskSettings();
  
  if (!settings.apiKey || !settings.databaseId) {
    return { updated: 0, links: 0 };
  }

  const db = getDb();
  
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO tasks (
      client_id, notion_id, payload, sync_status, last_modified_local, last_modified_notion,
      title, status, due_date, due_date_end, url, last_edited,
      urgent, important, hard_deadline, main_entry, session_length_minutes, estimated_length_minutes, body
    ) VALUES (?, ?, ?, 'synced', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_project_links (
      task_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      PRIMARY KEY (task_id, project_id)
    )
  `);
  const linkUpsert = db.prepare('INSERT OR IGNORE INTO task_project_links (task_id, project_id) VALUES (?, ?)');

  let updated = 0, links = 0, cursor: string | undefined;

  while (true) {
    const body: Record<string, unknown> = {
      page_size: PAGE_SIZE,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }]
    };
    if (cursor) body.start_cursor = cursor;

    try {
      const data = await queryNotion(settings.databaseId, settings.apiKey, body);
      let stoppedEarly = false;
      
      for (const t of data.results) {
        if (t.last_edited_time < cutoff) {
          console.log(`[ImportService] Tasks: hit cutoff at ${t.last_edited_time.substring(0, 19)}`);
          stoppedEarly = true;
          break;
        }
        
        const props = t.properties || {};
        const title = props[settings.titleProperty || 'Name']?.title?.[0]?.plain_text || 'Untitled';
        const status = props[settings.statusProperty || 'Status']?.status?.name || null;
        const dueDate = props[settings.dateProperty || 'Date']?.date?.start || null;
        const dueDateEnd = props[settings.dateProperty || 'Date']?.date?.end || null;
        const lastEdited = t.last_edited_time || null;
        const taskUrl = t.url || null;
        
        const urgent = isStatusActive(props[settings.urgentProperty], settings.urgentStatusActive) ? 1 : 0;
        const important = isStatusActive(props[settings.importantProperty], settings.importantStatusActive) ? 1 : 0;
        const hardDeadline = isStatusActive(props[settings.deadlineProperty], settings.deadlineHardValue) ? 1 : 0;
        const mainEntry = getRichText(props[settings.mainEntryProperty || '']);
        const sessionLengthMinutes = getNumber(props[settings.sessionLengthProperty || '']);
        const estimatedLengthMinutes = getNumber(props[settings.estimatedLengthProperty || '']);
        const bodyText = getRichText(props[settings.bodyProperty || '']);
        
        const payload = JSON.stringify({ 
          title, status, dueDate, dueDateEnd, url: taskUrl, lastEdited,
          urgent: urgent === 1, important: important === 1, hardDeadline: hardDeadline === 1
        });
        
        upsert.run(
          t.id, t.id, payload, Date.now(), Date.now(),
          title, status, dueDate, dueDateEnd, taskUrl, lastEdited,
          urgent, important, hardDeadline, mainEntry, sessionLengthMinutes, estimatedLengthMinutes, bodyText
        );
        updated++;

        const projectRelProp = settings.projectRelationProperty || 'Project';
        const projectRel = props[projectRelProp]?.relation || props['Projects']?.relation || [];
        for (const rel of projectRel) {
          if (rel.id) { 
            linkUpsert.run(t.id, rel.id); 
            links++; 
          }
        }
      }

      if (stoppedEarly || !data.has_more) break;
      cursor = data.next_cursor;
      
    } catch (error: any) {
      if (error.message?.includes('503') || error.message?.includes('504')) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw error;
    }
  }

  console.log(`[ImportService] Tasks delta: ${updated} updated, ${links} links`);
  return { updated, links };
}

// ============================================================================
// FULL IMPORT (for initial setup - skips existing)
// ============================================================================

export async function importAll(): Promise<ImportResult> {
  const start = Date.now();
  console.log('[ImportService] Starting full import...');
  
  const projects = await importAllProjects();
  const tasks = await importAllTasks();
  
  return {
    projects: { inserted: projects.inserted, updated: 0 },
    tasks: { inserted: tasks.inserted, updated: 0, links: tasks.links },
    timeMs: Date.now() - start
  };
}

async function importAllProjects(): Promise<{ inserted: number; skipped: number }> {
  const settings = getProjectsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey || !settings.databaseId) {
    return { inserted: 0, skipped: 0 };
  }

  console.log('[ImportService] Importing ALL projects...');
  
  const db = getDb();
  
  const upsert = db.prepare(`
    INSERT OR IGNORE INTO projects (
      client_id, notion_id, title, status, start_date, end_date, 
      url, last_edited, payload, sync_status, last_modified_local, last_modified_notion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'synced', ?, ?)
  `);

  let inserted = 0, skipped = 0, cursor: string | undefined, page = 0;

  while (true) {
    page++;
    const body: Record<string, unknown> = {
      page_size: PAGE_SIZE,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }]
    };
    if (cursor) body.start_cursor = cursor;

    try {
      const data = await queryNotion(settings.databaseId, apiKey, body);
      
      for (const p of data.results) {
        const props = p.properties || {};
        const title = props[settings.titleProperty || 'Name']?.title?.[0]?.plain_text || 'Untitled';
        const status = props[settings.statusProperty || 'Status']?.status?.name || null;
        const startDate = props[settings.startDateProperty || 'Start Date']?.date?.start || null;
        const endDate = props[settings.endDateProperty || 'Deadline']?.date?.start || null;
        
        const result = upsert.run(
          p.id, p.id, title, status, startDate, endDate, 
          p.url, p.last_edited_time, Date.now(), Date.now()
        );
        
        if (result.changes > 0) {
          inserted++;
        } else {
          skipped++;
        }
      }

      console.log(`[ImportService] Projects page ${page}: ${inserted} inserted, ${skipped} skipped`);

      if (!data.has_more) break;
      cursor = data.next_cursor;
      await new Promise(r => setTimeout(r, DELAY_MS));
      
    } catch (error: any) {
      if (error.message?.includes('503') || error.message?.includes('504')) {
        console.log(`[ImportService] Timeout on page ${page}, retrying...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        page--;
        continue;
      }
      throw error;
    }
  }

  return { inserted, skipped };
}

async function importAllTasks(): Promise<{ inserted: number; skipped: number; links: number }> {
  const settings = getTaskSettings();
  
  if (!settings.apiKey || !settings.databaseId) {
    return { inserted: 0, skipped: 0, links: 0 };
  }

  console.log('[ImportService] Importing ALL tasks...');
  
  const db = getDb();
  
  const upsert = db.prepare(`
    INSERT OR IGNORE INTO tasks (
      client_id, notion_id, payload, sync_status, last_modified_local, last_modified_notion,
      title, status, due_date, due_date_end, url, last_edited,
      urgent, important, hard_deadline, main_entry, session_length_minutes, estimated_length_minutes, body
    ) VALUES (?, ?, ?, 'synced', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_project_links (
      task_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      PRIMARY KEY (task_id, project_id)
    )
  `);
  const linkUpsert = db.prepare('INSERT OR IGNORE INTO task_project_links (task_id, project_id) VALUES (?, ?)');

  let inserted = 0, skipped = 0, links = 0, cursor: string | undefined, page = 0;

  while (true) {
    page++;
    const body: Record<string, unknown> = {
      page_size: PAGE_SIZE,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }]
    };
    if (cursor) body.start_cursor = cursor;

    try {
      const data = await queryNotion(settings.databaseId, settings.apiKey, body);
      
      for (const t of data.results) {
        const props = t.properties || {};
        const title = props[settings.titleProperty || 'Name']?.title?.[0]?.plain_text || 'Untitled';
        const status = props[settings.statusProperty || 'Status']?.status?.name || null;
        const dueDate = props[settings.dateProperty || 'Date']?.date?.start || null;
        const dueDateEnd = props[settings.dateProperty || 'Date']?.date?.end || null;
        const lastEdited = t.last_edited_time || null;
        const taskUrl = t.url || null;
        
        const urgent = isStatusActive(props[settings.urgentProperty], settings.urgentStatusActive) ? 1 : 0;
        const important = isStatusActive(props[settings.importantProperty], settings.importantStatusActive) ? 1 : 0;
        const hardDeadline = isStatusActive(props[settings.deadlineProperty], settings.deadlineHardValue) ? 1 : 0;
        const mainEntry = getRichText(props[settings.mainEntryProperty || '']);
        const sessionLengthMinutes = getNumber(props[settings.sessionLengthProperty || '']);
        const estimatedLengthMinutes = getNumber(props[settings.estimatedLengthProperty || '']);
        const bodyText = getRichText(props[settings.bodyProperty || '']);
        
        const payload = JSON.stringify({ 
          title, status, dueDate, dueDateEnd, url: taskUrl, lastEdited,
          urgent: urgent === 1, important: important === 1, hardDeadline: hardDeadline === 1
        });
        
        const result = upsert.run(
          t.id, t.id, payload, Date.now(), Date.now(),
          title, status, dueDate, dueDateEnd, taskUrl, lastEdited,
          urgent, important, hardDeadline, mainEntry, sessionLengthMinutes, estimatedLengthMinutes, bodyText
        );
        
        if (result.changes > 0) {
          inserted++;
        } else {
          skipped++;
        }

        const projectRelProp = settings.projectRelationProperty || 'Project';
        const projectRel = props[projectRelProp]?.relation || props['Projects']?.relation || [];
        for (const rel of projectRel) {
          if (rel.id) { 
            linkUpsert.run(t.id, rel.id); 
            links++; 
          }
        }
      }

      console.log(`[ImportService] Tasks page ${page}: ${inserted} inserted, ${skipped} skipped`);

      if (!data.has_more) break;
      cursor = data.next_cursor;
      await new Promise(r => setTimeout(r, DELAY_MS));
      
    } catch (error: any) {
      if (error.message?.includes('503') || error.message?.includes('504')) {
        console.log(`[ImportService] Timeout on page ${page}, retrying...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        page--;
        continue;
      }
      throw error;
    }
  }

  return { inserted, skipped, links };
}

// ============================================================================
// DATABASE COUNTS
// ============================================================================

export function getDatabaseCounts(): { projects: number; tasks: number; links: number } {
  const db = getDb();
  
  const projects = (db.prepare('SELECT COUNT(*) as c FROM projects').get() as any)?.c || 0;
  const tasks = (db.prepare('SELECT COUNT(*) as c FROM tasks').get() as any)?.c || 0;
  
  let links = 0;
  try {
    links = (db.prepare('SELECT COUNT(*) as c FROM task_project_links').get() as any)?.c || 0;
  } catch {
    // Table doesn't exist yet
  }
  
  return { projects, tasks, links };
}

export function isDatabaseEmpty(): boolean {
  const counts = getDatabaseCounts();
  return counts.projects === 0 && counts.tasks === 0;
}
