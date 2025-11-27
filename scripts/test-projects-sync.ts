/**
 * Test Script: Projects Sync Flow
 * 
 * Uses the backup database to test:
 * 1. Current state of projects in SQLite
 * 2. Fetch projects from Notion
 * 3. Store/update them in SQLite
 * 4. Verify the sync worked
 * 
 * Run: npx ts-node scripts/test-projects-sync.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');

// ============================================================
// CONFIGURATION - Use backup database for testing
// ============================================================

const BACKUP_DB_PATH = path.join(__dirname, '..', 'backups', 'notion-backup.sqlite');
const CONFIG_PATH = path.join(
  process.env.APPDATA || '',
  'NotionTasksWidget',
  'notion-widget.config.json'
);

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('❌ Failed to load config:', error);
    return null;
  }
}

function logSection(title: string) {
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function logSuccess(msg: string) { console.log(`  ✅ ${msg}`); }
function logError(msg: string) { console.log(`  ❌ ${msg}`); }
function logInfo(msg: string) { console.log(`  ℹ️  ${msg}`); }

// ============================================================
// NOTION API (Direct HTTP)
// ============================================================

async function notionRequest(apiKey: string, endpoint: string, method = 'GET', body?: any) {
  const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Notion API error: ${response.status} - ${text.substring(0, 200)}`);
  }
  
  return response.json();
}

// ============================================================
// MAIN TEST
// ============================================================

async function runTest() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           PROJECTS SYNC TEST                               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // Load config
  const config = loadConfig();
  if (!config) {
    console.error('\n❌ No config found');
    process.exit(1);
  }

  const apiKey = process.env.NOTION_API_KEY || config.tasks?.apiKey;
  const projectsDatabaseId = config.projects?.databaseId;

  if (!apiKey) {
    console.error('❌ No API key found');
    process.exit(1);
  }

  if (!projectsDatabaseId) {
    console.error('❌ No projects database configured');
    process.exit(1);
  }

  // ============================================================
  // PHASE 1: CHECK BACKUP DATABASE
  // ============================================================
  logSection('PHASE 1: CHECK BACKUP DATABASE');
  
  console.log(`  📂 Backup path: ${BACKUP_DB_PATH}`);
  
  if (!fs.existsSync(BACKUP_DB_PATH)) {
    logError('Backup database not found!');
    process.exit(1);
  }
  
  const db = new Database(BACKUP_DB_PATH);
  logSuccess('Connected to backup database');

  // Check current projects count
  const beforeCount = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
  logInfo(`Projects in SQLite BEFORE: ${beforeCount.c}`);

  // Sample existing projects
  const existingProjects = db.prepare(`
    SELECT client_id, notion_id, title, status, sync_status 
    FROM projects 
    ORDER BY last_modified_local DESC
    LIMIT 5
  `).all() as Array<{ client_id: string; notion_id: string; title: string; status: string; sync_status: string }>;

  if (existingProjects.length > 0) {
    logInfo('Current projects in SQLite:');
    existingProjects.forEach((p, i) => {
      console.log(`    ${i + 1}. "${p.title?.substring(0, 35) || 'No title'}..." [${p.status || 'no status'}] - ${p.sync_status}`);
    });
  }

  // ============================================================
  // PHASE 2: FETCH FROM NOTION
  // ============================================================
  logSection('PHASE 2: FETCH FROM NOTION');
  
  logInfo(`Projects database: ${projectsDatabaseId.substring(0, 8)}...`);

  let notionProjects: any[] = [];
  try {
    const response = await notionRequest(apiKey, `/databases/${projectsDatabaseId}/query`, 'POST', {
      page_size: 100
    });
    
    notionProjects = response.results || [];
    logSuccess(`Fetched ${notionProjects.length} projects from Notion`);

    if (notionProjects.length > 0) {
      logInfo('Sample from Notion:');
      notionProjects.slice(0, 3).forEach((p: any, i: number) => {
        const title = Object.values(p.properties || {})
          .find((prop: any) => prop.type === 'title') as any;
        const titleText = title?.title?.[0]?.plain_text || 'No title';
        console.log(`    ${i + 1}. "${titleText.substring(0, 35)}..."`);
      });
    }
  } catch (error) {
    logError(`Notion fetch failed: ${error}`);
    db.close();
    process.exit(1);
  }

  // ============================================================
  // PHASE 3: UPSERT TO SQLITE
  // ============================================================
  logSection('PHASE 3: UPSERT TO SQLITE');

  // Prepare upsert statement
  const upsertStmt = db.prepare(`
    INSERT INTO projects (client_id, notion_id, title, status, payload, sync_status, last_modified_local, last_modified_notion)
    VALUES (@client_id, @notion_id, @title, @status, @payload, 'synced', @timestamp, @timestamp)
    ON CONFLICT(client_id) DO UPDATE SET
      notion_id = @notion_id,
      title = @title,
      status = @status,
      payload = @payload,
      sync_status = 'synced',
      last_modified_notion = @timestamp
  `);

  const timestamp = Date.now();
  let upsertedCount = 0;
  let errors: string[] = [];

  const upsertTransaction = db.transaction(() => {
    for (const page of notionProjects) {
      try {
        // Extract properties
        const props = page.properties || {};
        
        // Find title property
        const titleProp = Object.values(props).find((p: any) => p.type === 'title') as any;
        const title = titleProp?.title?.[0]?.plain_text || 'Untitled';
        
        // Find status property (could be status or select type)
        const statusProp = Object.values(props).find((p: any) => 
          p.type === 'status' || (p.type === 'select' && p.select)
        ) as any;
        const status = statusProp?.status?.name || statusProp?.select?.name || null;

        // Use notion_id as client_id for remote-sourced projects
        const notionId = page.id;
        const clientId = notionId; // For projects fetched from Notion, client_id = notion_id

        upsertStmt.run({
          client_id: clientId,
          notion_id: notionId,
          title: title,
          status: status,
          payload: JSON.stringify({
            id: notionId,
            title: title,
            status: status,
            url: page.url,
            lastEdited: page.last_edited_time,
            createdTime: page.created_time,
            properties: props
          }),
          timestamp: timestamp
        });
        
        upsertedCount++;
      } catch (error) {
        errors.push(`${page.id}: ${error}`);
      }
    }
  });

  try {
    upsertTransaction();
    logSuccess(`Upserted ${upsertedCount} projects to SQLite`);
    
    if (errors.length > 0) {
      logError(`${errors.length} errors during upsert`);
      errors.slice(0, 3).forEach(e => console.log(`    - ${e}`));
    }
  } catch (error) {
    logError(`Transaction failed: ${error}`);
  }

  // ============================================================
  // PHASE 4: VERIFY
  // ============================================================
  logSection('PHASE 4: VERIFY');

  const afterCount = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
  logInfo(`Projects in SQLite AFTER: ${afterCount.c}`);
  logInfo(`Change: ${afterCount.c - beforeCount.c >= 0 ? '+' : ''}${afterCount.c - beforeCount.c}`);

  // Check sync status breakdown
  const breakdown = db.prepare(`
    SELECT sync_status, COUNT(*) as count 
    FROM projects 
    GROUP BY sync_status
  `).all() as Array<{ sync_status: string; count: number }>;

  logInfo('Sync status breakdown:');
  breakdown.forEach(row => {
    console.log(`    ${row.sync_status}: ${row.count}`);
  });

  // Sample recently synced
  const recentlySynced = db.prepare(`
    SELECT client_id, notion_id, title, status, sync_status
    FROM projects 
    WHERE last_modified_notion = ?
    LIMIT 5
  `).all(timestamp) as Array<any>;

  if (recentlySynced.length > 0) {
    logSuccess(`Just synced ${recentlySynced.length} projects:`);
    recentlySynced.forEach((p, i) => {
      console.log(`    ${i + 1}. "${p.title?.substring(0, 35) || 'No title'}..." [${p.status || '-'}]`);
    });
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  logSection('SUMMARY');

  const success = upsertedCount > 0 && errors.length === 0;
  
  if (success) {
    console.log('  🎉 PROJECTS SYNC TEST PASSED!');
    console.log(`  📊 Synced ${upsertedCount} projects from Notion to SQLite`);
  } else {
    console.log('  ⚠️  Test completed with issues');
  }

  db.close();
  console.log('\n' + '═'.repeat(60) + '\n');
}

runTest().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});

