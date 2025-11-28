/**
 * Unified Fast Sync - Projects + Tasks + Relations
 * 
 * Architecture:
 * 1. Fetch Projects (page_size=100)
 * 2. Fetch Tasks (page_size=100)
 * 3. Relations captured during task sync
 * 4. All use INSERT OR IGNORE to prevent duplicates
 * 5. Skip existing entries (no wasted API calls)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as Database from 'better-sqlite3';

const DB_PATH = path.join('backups', 'notion-backup.sqlite');
const PAGE_SIZE = 100;
const DELAY_MS = 50;

interface Config {
  apiKey: string;
  projects: { databaseId: string; titleProperty: string; statusProperty: string; startDateProperty: string; endDateProperty: string };
  tasks: { databaseId: string; titleProperty: string; statusProperty: string; dueDateProperty: string; priorityProperty: string };
}

function loadConfig(): Config {
  const configPath = path.join(process.env.APPDATA || '', 'NotionTasksWidget', 'notion-widget.config.json');
  if (!fs.existsSync(configPath)) throw new Error(`Config not found at ${configPath}`);
  
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return {
    apiKey: raw.tasks?.apiKey || raw.projects?.apiKey,
    projects: {
      databaseId: raw.projects?.databaseId || '',
      titleProperty: raw.projects?.titleProperty || 'Name',
      statusProperty: raw.projects?.statusProperty || 'Status',
      startDateProperty: raw.projects?.startDateProperty || 'Start Date',
      endDateProperty: raw.projects?.endDateProperty || 'Deadline',
    },
    tasks: {
      databaseId: raw.tasks?.databaseId || '',
      titleProperty: raw.tasks?.titleProperty || 'Name',
      statusProperty: raw.tasks?.statusProperty || 'Status',
      dueDateProperty: raw.tasks?.dueDateProperty || 'Due Date',
      priorityProperty: raw.tasks?.priorityProperty || 'Priority',
    },
  };
}

async function getDataSourceId(apiKey: string, dbId: string): Promise<string> {
  const response = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Notion-Version': '2025-09-03' },
  });
  if (!response.ok) throw new Error(`Failed to get data source: ${response.status}`);
  const schema = await response.json();
  return schema.data_sources?.[0]?.id || '';
}

async function syncProjects(db: Database.Database, config: Config): Promise<{ inserted: number; skipped: number; time: number }> {
  const start = Date.now();
  console.log('\n📁 Syncing Projects...');
  
  if (!config.projects.databaseId) {
    console.log('  ⚠️ No projects database configured');
    return { inserted: 0, skipped: 0, time: 0 };
  }

  const dataSourceId = await getDataSourceId(config.apiKey, config.projects.databaseId);
  const url = `https://api.notion.com/v1/data_sources/${dataSourceId}/query`;
  
  const upsert = db.prepare(`
    INSERT OR IGNORE INTO projects (client_id, notion_id, title, status, start_date, end_date, url, last_edited, payload, sync_status, last_modified_local, last_modified_notion)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'synced', ?, ?)
  `);
  const checkExists = db.prepare('SELECT 1 FROM projects WHERE client_id = ?');

  let inserted = 0, skipped = 0, cursor: string | undefined, page = 0;

  while (true) {
    page++;
    const body: any = { page_size: PAGE_SIZE, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] };
    if (cursor) body.start_cursor = cursor;

    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      if (response.status === 504 || response.status === 503) {
        console.log(`  ⚠️ Timeout on page ${page}, retrying...`);
        await new Promise(r => setTimeout(r, 3000));
        page--;
        continue;
      }
      throw new Error(`Projects query failed: ${response.status}`);
    }

    const data = await response.json();
    const results = data.results || [];

    for (const p of results) {
      if (checkExists.get(p.id)) { skipped++; continue; }
      
      const props = p.properties || {};
      const title = props[config.projects.titleProperty]?.title?.[0]?.plain_text || 'Untitled';
      const status = props[config.projects.statusProperty]?.status?.name || null;
      const startDate = props[config.projects.startDateProperty]?.date?.start || null;
      const endDate = props[config.projects.endDateProperty]?.date?.start || null;
      
      upsert.run(p.id, p.id, title, status, startDate, endDate, p.url, p.last_edited_time, Date.now(), Date.now());
      inserted++;
    }

    console.log(`  Page ${page}: ${results.length} fetched, ${inserted} total new`);

    if (!data.has_more) break;
    cursor = data.next_cursor;
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  return { inserted, skipped, time: Date.now() - start };
}

async function syncTasks(db: Database.Database, config: Config): Promise<{ inserted: number; skipped: number; links: number; time: number }> {
  const start = Date.now();
  console.log('\n📋 Syncing Tasks...');
  
  if (!config.tasks.databaseId) {
    console.log('  ⚠️ No tasks database configured');
    return { inserted: 0, skipped: 0, links: 0, time: 0 };
  }

  const dataSourceId = await getDataSourceId(config.apiKey, config.tasks.databaseId);
  const url = `https://api.notion.com/v1/data_sources/${dataSourceId}/query`;
  
  const upsert = db.prepare(`
    INSERT OR IGNORE INTO tasks (client_id, notion_id, payload, sync_status, last_modified_local, last_modified_notion)
    VALUES (?, ?, ?, 'synced', ?, ?)
  `);
  const checkExists = db.prepare('SELECT 1 FROM tasks WHERE client_id = ?');
  const linkUpsert = db.prepare('INSERT OR IGNORE INTO task_project_links (task_id, project_id) VALUES (?, ?)');

  let inserted = 0, skipped = 0, links = 0, cursor: string | undefined, page = 0;

  while (true) {
    page++;
    const body: any = { page_size: PAGE_SIZE, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] };
    if (cursor) body.start_cursor = cursor;

    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      if (response.status === 504 || response.status === 503) {
        console.log(`  ⚠️ Timeout on page ${page}, retrying...`);
        await new Promise(r => setTimeout(r, 3000));
        page--;
        continue;
      }
      throw new Error(`Tasks query failed: ${response.status}`);
    }

    const data = await response.json();
    const results = data.results || [];

    for (const t of results) {
      if (checkExists.get(t.id)) { skipped++; continue; }
      
      const props = t.properties || {};
      const title = props[config.tasks.titleProperty]?.title?.[0]?.plain_text || 'Untitled';
      const status = props[config.tasks.statusProperty]?.status?.name || null;
      const dueDate = props[config.tasks.dueDateProperty]?.date?.start || null;
      const priority = props[config.tasks.priorityProperty]?.select?.name || null;
      
      const payload = JSON.stringify({ title, status, dueDate, priority, url: t.url, lastEdited: t.last_edited_time });
      upsert.run(t.id, t.id, payload, Date.now(), Date.now());
      inserted++;

      // Capture project relations
      const projectRel = props['Project']?.relation || props['Projects']?.relation || [];
      for (const rel of projectRel) {
        if (rel.id) { linkUpsert.run(t.id, rel.id); links++; }
      }
    }

    console.log(`  Page ${page}: ${results.length} fetched, ${inserted} total new`);

    if (!data.has_more) break;
    cursor = data.next_cursor;
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  return { inserted, skipped, links, time: Date.now() - start };
}

async function main() {
  const totalStart = Date.now();
  console.log('╔══════════════════════════════════════╗');
  console.log('║       UNIFIED FAST SYNC v1.0         ║');
  console.log('╚══════════════════════════════════════╝');

  const config = loadConfig();
  const db = new Database(DB_PATH);

  // Get initial counts
  const initialProjects = (db.prepare('SELECT COUNT(*) as c FROM projects').get() as any).c;
  const initialTasks = (db.prepare('SELECT COUNT(*) as c FROM tasks').get() as any).c;
  console.log(`\nStarting state: ${initialProjects} projects, ${initialTasks} tasks`);

  // Sync in order
  const projectsResult = await syncProjects(db, config);
  const tasksResult = await syncTasks(db, config);

  // Final counts
  const finalProjects = (db.prepare('SELECT COUNT(*) as c FROM projects').get() as any).c;
  const finalTasks = (db.prepare('SELECT COUNT(*) as c FROM tasks').get() as any).c;
  const totalLinks = (db.prepare('SELECT COUNT(*) as c FROM task_project_links').get() as any).c;

  db.close();

  const totalTime = ((Date.now() - totalStart) / 1000).toFixed(1);

  console.log('\n╔══════════════════════════════════════╗');
  console.log('║             SYNC COMPLETE            ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║ Projects: ${finalProjects.toString().padStart(5)} (${projectsResult.inserted} new, ${projectsResult.skipped} skip)`);
  console.log(`║ Tasks:    ${finalTasks.toString().padStart(5)} (${tasksResult.inserted} new, ${tasksResult.skipped} skip)`);
  console.log(`║ Links:    ${totalLinks.toString().padStart(5)} task-project relations`);
  console.log('╠══════════════════════════════════════╣');
  console.log(`║ Total time: ${totalTime}s`);
  console.log('╚══════════════════════════════════════╝\n');
}

main().catch(err => {
  console.error('❌ Sync failed:', err.message);
  process.exitCode = 1;
});

