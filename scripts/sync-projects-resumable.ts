import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');

/**
 * RESUMABLE Projects Sync
 * 
 * Strategy:
 * 1. First pass: Get all project IDs (lightweight)
 * 2. Second pass: Fetch each project individually
 * 3. Save progress to SQLite after each item
 * 4. On 504: Stop and save position - can resume later
 */

const PROGRESS_FILE = 'C:/Users/Brandon/Dropbox/Apps/Notion Tasks Widget/backups/sync-progress.json';

interface SyncProgress {
  projectIds: string[];
  lastSyncedIndex: number;
  lastSyncedAt: string;
  completed: boolean;
}

function loadProgress(): SyncProgress | null {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch (e) {}
  return null;
}

function saveProgress(progress: SyncProgress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function fetchProjectIds(apiKey: string, dbId: string, statusProp: string, completedStatus: string): Promise<string[]> {
  console.log('📋 Phase 1: Fetching all project IDs...\n');
  
  const ids: string[] = [];
  let cursor: string | undefined;
  let pageNum = 0;

  do {
    pageNum++;
    console.log(`  Page ${pageNum}...`);

    const body: any = {
      page_size: 100,
      filter: {
        property: statusProp,
        status: { does_not_equal: completedStatus }
      }
      // Note: Can't filter properties in query, but we only extract IDs anyway
    };
    if (cursor) body.start_cursor = cursor;

    const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      if (response.status === 504 || response.status === 503) {
        console.log(`  ⚠️ Got ${response.status}, waiting 5s and retrying...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as any;
    const pageIds = (data.results || []).map((r: any) => r.id);
    ids.push(...pageIds);
    
    console.log(`  Got ${pageIds.length} IDs (total: ${ids.length})`);

    cursor = data.has_more ? data.next_cursor : undefined;
    
    if (cursor) {
      await new Promise(r => setTimeout(r, 300));
    }

  } while (cursor);

  console.log(`\n✅ Found ${ids.length} active project IDs\n`);
  return ids;
}

async function fetchSingleProject(apiKey: string, projectId: string): Promise<any | null> {
  const response = await fetch(`https://api.notion.com/v1/pages/${projectId}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
    }
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function sync() {
  const startTime = Date.now();
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   RESUMABLE PROJECTS SYNC                        ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const configPath = path.join(process.env.APPDATA || '', 'NotionTasksWidget', 'notion-widget.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const apiKey = config.projects?.apiKey || config.tasks?.apiKey;
  const dbId = config.projects?.databaseId;

  const PROPS = {
    title: config.projects?.titleProperty || 'Name',
    status: config.projects?.statusProperty || 'Status',
    startDate: config.projects?.startDateProperty || 'Start Date',
    deadline: config.projects?.endDateProperty || 'Deadline',
  };
  const completedStatus = config.projects?.completedStatus || 'Done';

  const dbPath = 'C:/Users/Brandon/Dropbox/Apps/Notion Tasks Widget/backups/notion-backup.sqlite';
  const db = new Database(dbPath);

  // Check for existing progress
  let progress = loadProgress();
  let projectIds: string[];
  let startIndex = 0;

  if (progress && !progress.completed && progress.projectIds.length > 0) {
    console.log('📂 Found saved progress!');
    console.log(`    Last synced: ${progress.lastSyncedIndex + 1}/${progress.projectIds.length}`);
    console.log(`    Resuming from index ${progress.lastSyncedIndex + 1}\n`);
    
    projectIds = progress.projectIds;
    startIndex = progress.lastSyncedIndex + 1;
  } else {
    // Fresh start - clear and get IDs
    db.prepare('DELETE FROM projects').run();
    console.log('🗑️ Cleared existing projects\n');
    
    projectIds = await fetchProjectIds(apiKey, dbId, PROPS.status, completedStatus);
    
    progress = {
      projectIds,
      lastSyncedIndex: -1,
      lastSyncedAt: new Date().toISOString(),
      completed: false
    };
    saveProgress(progress);
  }

  // Phase 2: Fetch each project individually
  console.log('📥 Phase 2: Fetching individual projects...\n');

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO projects (
      client_id, notion_id, title, status,
      start_date, end_date, url, last_edited,
      payload, sync_status, last_modified_local, last_modified_notion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'synced', ?, ?)
  `);

  const now = Date.now();
  let successCount = 0;
  let failCount = 0;

  for (let i = startIndex; i < projectIds.length; i++) {
    const projectId = projectIds[i];
    console.log(`  [${i + 1}/${projectIds.length}] Fetching ${projectId.substring(0, 8)}...`);

    try {
      const page = await fetchSingleProject(apiKey, projectId);
      
      if (!page) {
        console.log(`    ⚠️ Failed to fetch, skipping`);
        failCount++;
        continue;
      }

      const props = page.properties || {};
      const title = props[PROPS.title]?.title?.[0]?.plain_text || 'Untitled';
      const status = props[PROPS.status]?.status?.name || null;
      const startDate = props[PROPS.startDate]?.date?.start || null;
      const deadline = props[PROPS.deadline]?.date?.start || null;

      upsert.run(
        page.id, page.id, title, status,
        startDate, deadline, page.url, page.last_edited_time,
        now, now
      );

      console.log(`    ✅ "${title.substring(0, 30)}..." [${status}]`);
      successCount++;

      // Save progress after each successful sync
      progress.lastSyncedIndex = i;
      progress.lastSyncedAt = new Date().toISOString();
      saveProgress(progress);

      // Small delay
      await new Promise(r => setTimeout(r, 200));

    } catch (error: any) {
      console.log(`    ❌ Error: ${error.message}`);
      
      if (error.message.includes('504') || error.message.includes('503')) {
        console.log('\n⚠️ HIT 504/503 - SAVING PROGRESS AND STOPPING');
        console.log(`    Progress saved at index ${i}`);
        console.log('    Run this script again to resume!\n');
        break;
      }
      
      failCount++;
    }
  }

  // Check if complete
  if (progress.lastSyncedIndex >= projectIds.length - 1) {
    progress.completed = true;
    saveProgress(progress);
    console.log('\n🎉 All projects synced!');
    
    // Clean up progress file
    if (fs.existsSync(PROGRESS_FILE)) {
      fs.unlinkSync(PROGRESS_FILE);
      console.log('🗑️ Cleaned up progress file');
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Summary
  console.log('\n' + '═'.repeat(45));
  const count = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
  console.log(`📊 Projects in DB: ${count.c}`);
  console.log(`    Synced this run: ${successCount}`);
  console.log(`    Failed: ${failCount}`);
  console.log(`    Time: ${elapsed}s`);

  if (!progress.completed) {
    console.log(`\n⚠️ Sync incomplete. Run again to continue from ${progress.lastSyncedIndex + 2}/${projectIds.length}`);
  }

  const breakdown = db.prepare('SELECT status, COUNT(*) as c FROM projects GROUP BY status ORDER BY c DESC').all() as any[];
  console.log('\n📋 Status breakdown:');
  breakdown.forEach((r: any) => console.log(`    ${r.status}: ${r.c}`));

  db.close();
  console.log('\n✅ Done!');
}

sync().catch(e => console.error('Error:', e));


import Database = require('better-sqlite3');

/**
 * RESUMABLE Projects Sync
 * 
 * Strategy:
 * 1. First pass: Get all project IDs (lightweight)
 * 2. Second pass: Fetch each project individually
 * 3. Save progress to SQLite after each item
 * 4. On 504: Stop and save position - can resume later
 */

const PROGRESS_FILE = 'C:/Users/Brandon/Dropbox/Apps/Notion Tasks Widget/backups/sync-progress.json';

interface SyncProgress {
  projectIds: string[];
  lastSyncedIndex: number;
  lastSyncedAt: string;
  completed: boolean;
}

function loadProgress(): SyncProgress | null {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch (e) {}
  return null;
}

function saveProgress(progress: SyncProgress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function fetchProjectIds(apiKey: string, dbId: string, statusProp: string, completedStatus: string): Promise<string[]> {
  console.log('📋 Phase 1: Fetching all project IDs...\n');
  
  const ids: string[] = [];
  let cursor: string | undefined;
  let pageNum = 0;

  do {
    pageNum++;
    console.log(`  Page ${pageNum}...`);

    const body: any = {
      page_size: 100,
      filter: {
        property: statusProp,
        status: { does_not_equal: completedStatus }
      }
      // Note: Can't filter properties in query, but we only extract IDs anyway
    };
    if (cursor) body.start_cursor = cursor;

    const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      if (response.status === 504 || response.status === 503) {
        console.log(`  ⚠️ Got ${response.status}, waiting 5s and retrying...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as any;
    const pageIds = (data.results || []).map((r: any) => r.id);
    ids.push(...pageIds);
    
    console.log(`  Got ${pageIds.length} IDs (total: ${ids.length})`);

    cursor = data.has_more ? data.next_cursor : undefined;
    
    if (cursor) {
      await new Promise(r => setTimeout(r, 300));
    }

  } while (cursor);

  console.log(`\n✅ Found ${ids.length} active project IDs\n`);
  return ids;
}

async function fetchSingleProject(apiKey: string, projectId: string): Promise<any | null> {
  const response = await fetch(`https://api.notion.com/v1/pages/${projectId}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
    }
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function sync() {
  const startTime = Date.now();
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   RESUMABLE PROJECTS SYNC                        ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const configPath = path.join(process.env.APPDATA || '', 'NotionTasksWidget', 'notion-widget.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const apiKey = config.projects?.apiKey || config.tasks?.apiKey;
  const dbId = config.projects?.databaseId;

  const PROPS = {
    title: config.projects?.titleProperty || 'Name',
    status: config.projects?.statusProperty || 'Status',
    startDate: config.projects?.startDateProperty || 'Start Date',
    deadline: config.projects?.endDateProperty || 'Deadline',
  };
  const completedStatus = config.projects?.completedStatus || 'Done';

  const dbPath = 'C:/Users/Brandon/Dropbox/Apps/Notion Tasks Widget/backups/notion-backup.sqlite';
  const db = new Database(dbPath);

  // Check for existing progress
  let progress = loadProgress();
  let projectIds: string[];
  let startIndex = 0;

  if (progress && !progress.completed && progress.projectIds.length > 0) {
    console.log('📂 Found saved progress!');
    console.log(`    Last synced: ${progress.lastSyncedIndex + 1}/${progress.projectIds.length}`);
    console.log(`    Resuming from index ${progress.lastSyncedIndex + 1}\n`);
    
    projectIds = progress.projectIds;
    startIndex = progress.lastSyncedIndex + 1;
  } else {
    // Fresh start - clear and get IDs
    db.prepare('DELETE FROM projects').run();
    console.log('🗑️ Cleared existing projects\n');
    
    projectIds = await fetchProjectIds(apiKey, dbId, PROPS.status, completedStatus);
    
    progress = {
      projectIds,
      lastSyncedIndex: -1,
      lastSyncedAt: new Date().toISOString(),
      completed: false
    };
    saveProgress(progress);
  }

  // Phase 2: Fetch each project individually
  console.log('📥 Phase 2: Fetching individual projects...\n');

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO projects (
      client_id, notion_id, title, status,
      start_date, end_date, url, last_edited,
      payload, sync_status, last_modified_local, last_modified_notion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'synced', ?, ?)
  `);

  const now = Date.now();
  let successCount = 0;
  let failCount = 0;

  for (let i = startIndex; i < projectIds.length; i++) {
    const projectId = projectIds[i];
    console.log(`  [${i + 1}/${projectIds.length}] Fetching ${projectId.substring(0, 8)}...`);

    try {
      const page = await fetchSingleProject(apiKey, projectId);
      
      if (!page) {
        console.log(`    ⚠️ Failed to fetch, skipping`);
        failCount++;
        continue;
      }

      const props = page.properties || {};
      const title = props[PROPS.title]?.title?.[0]?.plain_text || 'Untitled';
      const status = props[PROPS.status]?.status?.name || null;
      const startDate = props[PROPS.startDate]?.date?.start || null;
      const deadline = props[PROPS.deadline]?.date?.start || null;

      upsert.run(
        page.id, page.id, title, status,
        startDate, deadline, page.url, page.last_edited_time,
        now, now
      );

      console.log(`    ✅ "${title.substring(0, 30)}..." [${status}]`);
      successCount++;

      // Save progress after each successful sync
      progress.lastSyncedIndex = i;
      progress.lastSyncedAt = new Date().toISOString();
      saveProgress(progress);

      // Small delay
      await new Promise(r => setTimeout(r, 200));

    } catch (error: any) {
      console.log(`    ❌ Error: ${error.message}`);
      
      if (error.message.includes('504') || error.message.includes('503')) {
        console.log('\n⚠️ HIT 504/503 - SAVING PROGRESS AND STOPPING');
        console.log(`    Progress saved at index ${i}`);
        console.log('    Run this script again to resume!\n');
        break;
      }
      
      failCount++;
    }
  }

  // Check if complete
  if (progress.lastSyncedIndex >= projectIds.length - 1) {
    progress.completed = true;
    saveProgress(progress);
    console.log('\n🎉 All projects synced!');
    
    // Clean up progress file
    if (fs.existsSync(PROGRESS_FILE)) {
      fs.unlinkSync(PROGRESS_FILE);
      console.log('🗑️ Cleaned up progress file');
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Summary
  console.log('\n' + '═'.repeat(45));
  const count = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
  console.log(`📊 Projects in DB: ${count.c}`);
  console.log(`    Synced this run: ${successCount}`);
  console.log(`    Failed: ${failCount}`);
  console.log(`    Time: ${elapsed}s`);

  if (!progress.completed) {
    console.log(`\n⚠️ Sync incomplete. Run again to continue from ${progress.lastSyncedIndex + 2}/${projectIds.length}`);
  }

  const breakdown = db.prepare('SELECT status, COUNT(*) as c FROM projects GROUP BY status ORDER BY c DESC').all() as any[];
  console.log('\n📋 Status breakdown:');
  breakdown.forEach((r: any) => console.log(`    ${r.status}: ${r.c}`));

  db.close();
  console.log('\n✅ Done!');
}

sync().catch(e => console.error('Error:', e));

