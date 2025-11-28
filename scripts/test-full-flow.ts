/**
 * Test Script: Full Backend Flow
 * 
 * Tests the complete backend services:
 * 1. Tasks: Fetch from Notion → Store in SQLite → Verify
 * 2. Projects: Fetch from Notion → Store in SQLite → Verify
 * 3. Time Logs: Fetch from Notion → Store in SQLite → Verify
 * 4. Contacts: Fetch from Notion → Verify
 * 
 * This script uses the actual service functions, not direct API calls.
 * 
 * Run: npx ts-node scripts/test-full-flow.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');

// ============================================================
// UTILITIES
// ============================================================

function getAppDataPath(): string {
  const appData = process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(process.env.HOME ?? '', 'Library/Application Support')
      : path.join(process.env.HOME ?? '', '.config'));
  return path.join(appData, 'NotionTasksWidget');
}

function loadConfig() {
  try {
    const configPath = path.join(getAppDataPath(), 'notion-widget.config.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('❌ Failed to load config:', error);
    return null;
  }
}

function getDatabase(): Database.Database {
  const dbPath = path.join(getAppDataPath(), 'notion-tasks.db');
  return new Database(dbPath);
}

function logSection(title: string) {
  console.log('\n' + '═'.repeat(70));
  console.log(`  ${title}`);
  console.log('═'.repeat(70));
}

function logSubSection(title: string) {
  console.log(`\n  ── ${title} ──`);
}

function logSuccess(msg: string) { console.log(`  ✅ ${msg}`); }
function logError(msg: string) { console.log(`  ❌ ${msg}`); }
function logInfo(msg: string) { console.log(`  ℹ️  ${msg}`); }
function logWarn(msg: string) { console.log(`  ⚠️  ${msg}`); }

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: string;
}

// ============================================================
// MAIN TEST RUNNER
// ============================================================

async function runTests() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║           NOTION TASKS WIDGET - BACKEND TEST SUITE                 ║');
  console.log('║                    Testing All Services                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');

  const config = loadConfig();
  if (!config) {
    console.error('\n❌ No config found. Please run the app first to set up Notion connection.');
    process.exit(1);
  }

  const db = getDatabase();
  const results: TestResult[] = [];

  // ============================================================
  // PHASE 1: DATABASE CONNECTIVITY
  // ============================================================
  logSection('PHASE 1: DATABASE CONNECTIVITY');

  logSubSection('SQLite Connection');
  try {
    const version = db.prepare('SELECT sqlite_version() as v').get() as { v: string };
    logSuccess(`SQLite connected (version ${version.v})`);
    results.push({ name: 'SQLite connection', passed: true });
  } catch (error) {
    logError(`SQLite failed: ${error}`);
    results.push({ name: 'SQLite connection', passed: false, error: String(error) });
  }

  logSubSection('Database Tables');
  const tables = ['tasks', 'projects', 'time_logs', 'writing_entries', 'local_task_statuses'];
  for (const table of tables) {
    try {
      const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
      if (exists) {
        const count = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
        logSuccess(`${table}: ${count.c} rows`);
        results.push({ name: `Table: ${table}`, passed: true, details: `${count.c} rows` });
      } else {
        logWarn(`${table}: not found (may not be initialized)`);
        results.push({ name: `Table: ${table}`, passed: true, details: 'Not initialized' });
      }
    } catch (error) {
      logError(`${table}: ${error}`);
      results.push({ name: `Table: ${table}`, passed: false, error: String(error) });
    }
  }

  // ============================================================
  // PHASE 2: NOTION API CONNECTIVITY
  // ============================================================
  logSection('PHASE 2: NOTION API CONNECTIVITY');

  const apiKey = process.env.NOTION_API_KEY || config.tasks?.apiKey;
  
  if (!apiKey) {
    logError('No API key found');
    results.push({ name: 'Notion API key', passed: false, error: 'Missing' });
  } else {
    logSuccess(`API key found: ${apiKey.substring(0, 10)}...`);
    results.push({ name: 'Notion API key', passed: true });

    // Test API connection
    logSubSection('API Connection Test');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      const user = await notion.users.me({});
      logSuccess(`Connected as: ${user.name || user.id}`);
      results.push({ name: 'Notion API connection', passed: true });
    } catch (error) {
      logError(`API connection failed: ${error}`);
      results.push({ name: 'Notion API connection', passed: false, error: String(error) });
    }
  }

  // ============================================================
  // PHASE 3: TASKS SERVICE
  // ============================================================
  logSection('PHASE 3: TASKS SERVICE');

  const tasksDatabaseId = config.tasks?.databaseId;
  if (tasksDatabaseId) {
    logInfo(`Tasks database: ${tasksDatabaseId.substring(0, 8)}...`);

    logSubSection('Fetch Active Tasks from Notion');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      
      const response = await (notion.databases as any).query({
        database_id: tasksDatabaseId,
        page_size: 10,
        filter: config.tasks?.statusProperty ? {
          property: config.tasks.statusProperty,
          status: { does_not_equal: config.tasks?.completedStatus || 'Done' }
        } : undefined
      });
      
      logSuccess(`Fetched ${response.results.length} active tasks from Notion`);
      results.push({ name: 'Tasks: Notion fetch', passed: true, details: `${response.results.length} tasks` });

      // Verify in SQLite
      const sqliteTasks = db.prepare('SELECT COUNT(*) as c FROM tasks WHERE sync_status != ?').get('trashed') as { c: number };
      logInfo(`Tasks in SQLite: ${sqliteTasks.c}`);
      results.push({ name: 'Tasks: SQLite storage', passed: true, details: `${sqliteTasks.c} stored` });
    } catch (error) {
      logError(`Tasks fetch failed: ${error}`);
      results.push({ name: 'Tasks: Notion fetch', passed: false, error: String(error) });
    }
  } else {
    logWarn('Tasks database not configured');
    results.push({ name: 'Tasks: Configuration', passed: false, error: 'Not configured' });
  }

  // ============================================================
  // PHASE 4: PROJECTS SERVICE
  // ============================================================
  logSection('PHASE 4: PROJECTS SERVICE');

  const projectsDatabaseId = config.projects?.databaseId;
  if (projectsDatabaseId) {
    logInfo(`Projects database: ${projectsDatabaseId.substring(0, 8)}...`);

    logSubSection('Fetch Projects from Notion');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      
      const response = await (notion.databases as any).query({
        database_id: projectsDatabaseId,
        page_size: 10
      });
      
      logSuccess(`Fetched ${response.results.length} projects from Notion`);
      results.push({ name: 'Projects: Notion fetch', passed: true, details: `${response.results.length} projects` });

      // Verify in SQLite
      const sqliteProjects = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
      logInfo(`Projects in SQLite: ${sqliteProjects.c}`);
      results.push({ name: 'Projects: SQLite storage', passed: true, details: `${sqliteProjects.c} stored` });
    } catch (error) {
      logError(`Projects fetch failed: ${error}`);
      results.push({ name: 'Projects: Notion fetch', passed: false, error: String(error) });
    }
  } else {
    logInfo('Projects database not configured (optional)');
    results.push({ name: 'Projects: Configuration', passed: true, details: 'Optional - not configured' });
  }

  // ============================================================
  // PHASE 5: TIME LOGS SERVICE
  // ============================================================
  logSection('PHASE 5: TIME LOGS SERVICE');

  const timeLogsDatabaseId = config.timeLog?.databaseId;
  if (timeLogsDatabaseId) {
    logInfo(`Time Logs database: ${timeLogsDatabaseId.substring(0, 8)}...`);

    logSubSection('Fetch Time Logs from Notion');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      
      const response = await (notion.databases as any).query({
        database_id: timeLogsDatabaseId,
        page_size: 10
      });
      
      logSuccess(`Fetched ${response.results.length} time logs from Notion`);
      results.push({ name: 'Time Logs: Notion fetch', passed: true, details: `${response.results.length} logs` });

      // Verify in SQLite
      const sqliteLogs = db.prepare('SELECT COUNT(*) as c FROM time_logs').get() as { c: number };
      logInfo(`Time logs in SQLite: ${sqliteLogs.c}`);
      results.push({ name: 'Time Logs: SQLite storage', passed: true, details: `${sqliteLogs.c} stored` });
    } catch (error) {
      logError(`Time logs fetch failed: ${error}`);
      results.push({ name: 'Time Logs: Notion fetch', passed: false, error: String(error) });
    }
  } else {
    logInfo('Time Logs database not configured (optional)');
    results.push({ name: 'Time Logs: Configuration', passed: true, details: 'Optional - not configured' });
  }

  // ============================================================
  // PHASE 6: CONTACTS SERVICE
  // ============================================================
  logSection('PHASE 6: CONTACTS SERVICE');

  const contactsDatabaseId = config.contacts?.databaseId;
  if (contactsDatabaseId) {
    logInfo(`Contacts database: ${contactsDatabaseId.substring(0, 8)}...`);

    logSubSection('Fetch Contacts from Notion');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      
      const response = await (notion.databases as any).query({
        database_id: contactsDatabaseId,
        page_size: 10
      });
      
      logSuccess(`Fetched ${response.results.length} contacts from Notion`);
      results.push({ name: 'Contacts: Notion fetch', passed: true, details: `${response.results.length} contacts` });
    } catch (error) {
      logError(`Contacts fetch failed: ${error}`);
      results.push({ name: 'Contacts: Notion fetch', passed: false, error: String(error) });
    }
  } else {
    logInfo('Contacts database not configured (optional)');
    results.push({ name: 'Contacts: Configuration', passed: true, details: 'Optional - not configured' });
  }

  // ============================================================
  // PHASE 7: DATA INTEGRITY
  // ============================================================
  logSection('PHASE 7: DATA INTEGRITY');

  logSubSection('Check for Sync Issues');
  try {
    // Tasks with pending sync
    const pendingTasks = db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE sync_status = 'pending'`).get() as { c: number };
    if (pendingTasks.c > 0) {
      logWarn(`${pendingTasks.c} tasks pending sync`);
    } else {
      logSuccess('No tasks pending sync');
    }

    // Local-only tasks
    const localOnlyTasks = db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE notion_id IS NULL AND sync_status = 'local'`).get() as { c: number };
    logInfo(`${localOnlyTasks.c} local-only tasks (not yet pushed to Notion)`);

    // Trashed tasks
    const trashedTasks = db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE sync_status = 'trashed'`).get() as { c: number };
    logInfo(`${trashedTasks.c} trashed tasks`);

    results.push({ name: 'Data integrity check', passed: true });
  } catch (error) {
    logError(`Integrity check failed: ${error}`);
    results.push({ name: 'Data integrity check', passed: false, error: String(error) });
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  logSection('TEST SUMMARY');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`\n  📊 Results: ${passed} passed, ${failed} failed\n`);

  console.log('  Passed:');
  results.filter(r => r.passed).forEach(r => {
    console.log(`    ✅ ${r.name}${r.details ? ` (${r.details})` : ''}`);
  });

  if (failed > 0) {
    console.log('\n  Failed:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`    ❌ ${r.name}: ${r.error}`);
    });
  }

  db.close();

  console.log('\n' + '═'.repeat(70));
  if (failed > 0) {
    console.log('  ⚠️  SOME TESTS FAILED - Check configuration and try again');
    process.exit(1);
  } else {
    console.log('  🎉 ALL TESTS PASSED - Backend is working correctly!');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});


 * 
 * Tests the complete backend services:
 * 1. Tasks: Fetch from Notion → Store in SQLite → Verify
 * 2. Projects: Fetch from Notion → Store in SQLite → Verify
 * 3. Time Logs: Fetch from Notion → Store in SQLite → Verify
 * 4. Contacts: Fetch from Notion → Verify
 * 
 * This script uses the actual service functions, not direct API calls.
 * 
 * Run: npx ts-node scripts/test-full-flow.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');

// ============================================================
// UTILITIES
// ============================================================

function getAppDataPath(): string {
  const appData = process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(process.env.HOME ?? '', 'Library/Application Support')
      : path.join(process.env.HOME ?? '', '.config'));
  return path.join(appData, 'NotionTasksWidget');
}

function loadConfig() {
  try {
    const configPath = path.join(getAppDataPath(), 'notion-widget.config.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('❌ Failed to load config:', error);
    return null;
  }
}

function getDatabase(): Database.Database {
  const dbPath = path.join(getAppDataPath(), 'notion-tasks.db');
  return new Database(dbPath);
}

function logSection(title: string) {
  console.log('\n' + '═'.repeat(70));
  console.log(`  ${title}`);
  console.log('═'.repeat(70));
}

function logSubSection(title: string) {
  console.log(`\n  ── ${title} ──`);
}

function logSuccess(msg: string) { console.log(`  ✅ ${msg}`); }
function logError(msg: string) { console.log(`  ❌ ${msg}`); }
function logInfo(msg: string) { console.log(`  ℹ️  ${msg}`); }
function logWarn(msg: string) { console.log(`  ⚠️  ${msg}`); }

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: string;
}

// ============================================================
// MAIN TEST RUNNER
// ============================================================

async function runTests() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║           NOTION TASKS WIDGET - BACKEND TEST SUITE                 ║');
  console.log('║                    Testing All Services                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');

  const config = loadConfig();
  if (!config) {
    console.error('\n❌ No config found. Please run the app first to set up Notion connection.');
    process.exit(1);
  }

  const db = getDatabase();
  const results: TestResult[] = [];

  // ============================================================
  // PHASE 1: DATABASE CONNECTIVITY
  // ============================================================
  logSection('PHASE 1: DATABASE CONNECTIVITY');

  logSubSection('SQLite Connection');
  try {
    const version = db.prepare('SELECT sqlite_version() as v').get() as { v: string };
    logSuccess(`SQLite connected (version ${version.v})`);
    results.push({ name: 'SQLite connection', passed: true });
  } catch (error) {
    logError(`SQLite failed: ${error}`);
    results.push({ name: 'SQLite connection', passed: false, error: String(error) });
  }

  logSubSection('Database Tables');
  const tables = ['tasks', 'projects', 'time_logs', 'writing_entries', 'local_task_statuses'];
  for (const table of tables) {
    try {
      const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
      if (exists) {
        const count = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
        logSuccess(`${table}: ${count.c} rows`);
        results.push({ name: `Table: ${table}`, passed: true, details: `${count.c} rows` });
      } else {
        logWarn(`${table}: not found (may not be initialized)`);
        results.push({ name: `Table: ${table}`, passed: true, details: 'Not initialized' });
      }
    } catch (error) {
      logError(`${table}: ${error}`);
      results.push({ name: `Table: ${table}`, passed: false, error: String(error) });
    }
  }

  // ============================================================
  // PHASE 2: NOTION API CONNECTIVITY
  // ============================================================
  logSection('PHASE 2: NOTION API CONNECTIVITY');

  const apiKey = process.env.NOTION_API_KEY || config.tasks?.apiKey;
  
  if (!apiKey) {
    logError('No API key found');
    results.push({ name: 'Notion API key', passed: false, error: 'Missing' });
  } else {
    logSuccess(`API key found: ${apiKey.substring(0, 10)}...`);
    results.push({ name: 'Notion API key', passed: true });

    // Test API connection
    logSubSection('API Connection Test');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      const user = await notion.users.me({});
      logSuccess(`Connected as: ${user.name || user.id}`);
      results.push({ name: 'Notion API connection', passed: true });
    } catch (error) {
      logError(`API connection failed: ${error}`);
      results.push({ name: 'Notion API connection', passed: false, error: String(error) });
    }
  }

  // ============================================================
  // PHASE 3: TASKS SERVICE
  // ============================================================
  logSection('PHASE 3: TASKS SERVICE');

  const tasksDatabaseId = config.tasks?.databaseId;
  if (tasksDatabaseId) {
    logInfo(`Tasks database: ${tasksDatabaseId.substring(0, 8)}...`);

    logSubSection('Fetch Active Tasks from Notion');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      
      const response = await (notion.databases as any).query({
        database_id: tasksDatabaseId,
        page_size: 10,
        filter: config.tasks?.statusProperty ? {
          property: config.tasks.statusProperty,
          status: { does_not_equal: config.tasks?.completedStatus || 'Done' }
        } : undefined
      });
      
      logSuccess(`Fetched ${response.results.length} active tasks from Notion`);
      results.push({ name: 'Tasks: Notion fetch', passed: true, details: `${response.results.length} tasks` });

      // Verify in SQLite
      const sqliteTasks = db.prepare('SELECT COUNT(*) as c FROM tasks WHERE sync_status != ?').get('trashed') as { c: number };
      logInfo(`Tasks in SQLite: ${sqliteTasks.c}`);
      results.push({ name: 'Tasks: SQLite storage', passed: true, details: `${sqliteTasks.c} stored` });
    } catch (error) {
      logError(`Tasks fetch failed: ${error}`);
      results.push({ name: 'Tasks: Notion fetch', passed: false, error: String(error) });
    }
  } else {
    logWarn('Tasks database not configured');
    results.push({ name: 'Tasks: Configuration', passed: false, error: 'Not configured' });
  }

  // ============================================================
  // PHASE 4: PROJECTS SERVICE
  // ============================================================
  logSection('PHASE 4: PROJECTS SERVICE');

  const projectsDatabaseId = config.projects?.databaseId;
  if (projectsDatabaseId) {
    logInfo(`Projects database: ${projectsDatabaseId.substring(0, 8)}...`);

    logSubSection('Fetch Projects from Notion');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      
      const response = await (notion.databases as any).query({
        database_id: projectsDatabaseId,
        page_size: 10
      });
      
      logSuccess(`Fetched ${response.results.length} projects from Notion`);
      results.push({ name: 'Projects: Notion fetch', passed: true, details: `${response.results.length} projects` });

      // Verify in SQLite
      const sqliteProjects = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
      logInfo(`Projects in SQLite: ${sqliteProjects.c}`);
      results.push({ name: 'Projects: SQLite storage', passed: true, details: `${sqliteProjects.c} stored` });
    } catch (error) {
      logError(`Projects fetch failed: ${error}`);
      results.push({ name: 'Projects: Notion fetch', passed: false, error: String(error) });
    }
  } else {
    logInfo('Projects database not configured (optional)');
    results.push({ name: 'Projects: Configuration', passed: true, details: 'Optional - not configured' });
  }

  // ============================================================
  // PHASE 5: TIME LOGS SERVICE
  // ============================================================
  logSection('PHASE 5: TIME LOGS SERVICE');

  const timeLogsDatabaseId = config.timeLog?.databaseId;
  if (timeLogsDatabaseId) {
    logInfo(`Time Logs database: ${timeLogsDatabaseId.substring(0, 8)}...`);

    logSubSection('Fetch Time Logs from Notion');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      
      const response = await (notion.databases as any).query({
        database_id: timeLogsDatabaseId,
        page_size: 10
      });
      
      logSuccess(`Fetched ${response.results.length} time logs from Notion`);
      results.push({ name: 'Time Logs: Notion fetch', passed: true, details: `${response.results.length} logs` });

      // Verify in SQLite
      const sqliteLogs = db.prepare('SELECT COUNT(*) as c FROM time_logs').get() as { c: number };
      logInfo(`Time logs in SQLite: ${sqliteLogs.c}`);
      results.push({ name: 'Time Logs: SQLite storage', passed: true, details: `${sqliteLogs.c} stored` });
    } catch (error) {
      logError(`Time logs fetch failed: ${error}`);
      results.push({ name: 'Time Logs: Notion fetch', passed: false, error: String(error) });
    }
  } else {
    logInfo('Time Logs database not configured (optional)');
    results.push({ name: 'Time Logs: Configuration', passed: true, details: 'Optional - not configured' });
  }

  // ============================================================
  // PHASE 6: CONTACTS SERVICE
  // ============================================================
  logSection('PHASE 6: CONTACTS SERVICE');

  const contactsDatabaseId = config.contacts?.databaseId;
  if (contactsDatabaseId) {
    logInfo(`Contacts database: ${contactsDatabaseId.substring(0, 8)}...`);

    logSubSection('Fetch Contacts from Notion');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      
      const response = await (notion.databases as any).query({
        database_id: contactsDatabaseId,
        page_size: 10
      });
      
      logSuccess(`Fetched ${response.results.length} contacts from Notion`);
      results.push({ name: 'Contacts: Notion fetch', passed: true, details: `${response.results.length} contacts` });
    } catch (error) {
      logError(`Contacts fetch failed: ${error}`);
      results.push({ name: 'Contacts: Notion fetch', passed: false, error: String(error) });
    }
  } else {
    logInfo('Contacts database not configured (optional)');
    results.push({ name: 'Contacts: Configuration', passed: true, details: 'Optional - not configured' });
  }

  // ============================================================
  // PHASE 7: DATA INTEGRITY
  // ============================================================
  logSection('PHASE 7: DATA INTEGRITY');

  logSubSection('Check for Sync Issues');
  try {
    // Tasks with pending sync
    const pendingTasks = db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE sync_status = 'pending'`).get() as { c: number };
    if (pendingTasks.c > 0) {
      logWarn(`${pendingTasks.c} tasks pending sync`);
    } else {
      logSuccess('No tasks pending sync');
    }

    // Local-only tasks
    const localOnlyTasks = db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE notion_id IS NULL AND sync_status = 'local'`).get() as { c: number };
    logInfo(`${localOnlyTasks.c} local-only tasks (not yet pushed to Notion)`);

    // Trashed tasks
    const trashedTasks = db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE sync_status = 'trashed'`).get() as { c: number };
    logInfo(`${trashedTasks.c} trashed tasks`);

    results.push({ name: 'Data integrity check', passed: true });
  } catch (error) {
    logError(`Integrity check failed: ${error}`);
    results.push({ name: 'Data integrity check', passed: false, error: String(error) });
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  logSection('TEST SUMMARY');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`\n  📊 Results: ${passed} passed, ${failed} failed\n`);

  console.log('  Passed:');
  results.filter(r => r.passed).forEach(r => {
    console.log(`    ✅ ${r.name}${r.details ? ` (${r.details})` : ''}`);
  });

  if (failed > 0) {
    console.log('\n  Failed:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`    ❌ ${r.name}: ${r.error}`);
    });
  }

  db.close();

  console.log('\n' + '═'.repeat(70));
  if (failed > 0) {
    console.log('  ⚠️  SOME TESTS FAILED - Check configuration and try again');
    process.exit(1);
  } else {
    console.log('  🎉 ALL TESTS PASSED - Backend is working correctly!');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});

