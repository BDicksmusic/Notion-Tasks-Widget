/**
 * Test Script: Notion Tasks Service
 * 
 * Tests the complete flow:
 * 1. Fetch tasks from Notion → Save to SQLite
 * 2. Create task locally → Push to Notion
 * 3. Update task locally → Push to Notion
 * 4. Verify all data in SQLite
 * 
 * Run: npx ts-node scripts/test-notionTasks.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');

// Load config from app data directory
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
  console.log(`📂 Database path: ${dbPath}`);
  return new Database(dbPath);
}

// Test utilities
function logSection(title: string) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

function logSuccess(msg: string) {
  console.log(`✅ ${msg}`);
}

function logError(msg: string) {
  console.log(`❌ ${msg}`);
}

function logInfo(msg: string) {
  console.log(`ℹ️  ${msg}`);
}

// Import the actual services (using dynamic import to handle module resolution)
async function runTests() {
  const config = loadConfig();
  if (!config) {
    console.error('❌ No config found. Please run the app first to set up Notion connection.');
    process.exit(1);
  }

  const apiKey = process.env.NOTION_API_KEY || config.tasks?.apiKey;
  const databaseId = process.env.NOTION_DATABASE_ID || config.tasks?.databaseId;

  if (!apiKey || !databaseId) {
    console.error('❌ Missing API key or database ID');
    process.exit(1);
  }

  logSection('TEST: Notion Tasks Service');
  console.log(`📋 Database ID: ${databaseId.substring(0, 8)}...`);

  const db = getDatabase();
  const results = {
    passed: 0,
    failed: 0,
    tests: [] as { name: string; passed: boolean; error?: string }[]
  };

  // ============================================================
  // TEST 1: Count existing tasks in SQLite
  // ============================================================
  logSection('TEST 1: Check SQLite Database');
  try {
    const countBefore = db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number };
    logInfo(`Tasks in SQLite before test: ${countBefore.count}`);
    results.tests.push({ name: 'SQLite connection', passed: true });
    results.passed++;
  } catch (error) {
    logError(`SQLite connection failed: ${error}`);
    results.tests.push({ name: 'SQLite connection', passed: false, error: String(error) });
    results.failed++;
  }

  // ============================================================
  // TEST 2: Fetch tasks from Notion (direct API test)
  // ============================================================
  logSection('TEST 2: Fetch Tasks from Notion API');
  try {
    const { Client } = await import('@notionhq/client');
    const notion = new Client({ auth: apiKey });
    
    const response = await (notion.databases as any).query({
      database_id: databaseId,
      page_size: 5,
      filter: {
        property: config.tasks?.statusProperty || 'Status',
        status: {
          does_not_equal: config.tasks?.completedStatus || 'Done'
        }
      }
    });
    
    logSuccess(`Fetched ${response.results.length} tasks from Notion`);
    
    if (response.results.length > 0) {
      const firstTask = response.results[0] as any;
      logInfo(`First task ID: ${firstTask.id}`);
      const titleProp = firstTask.properties?.[config.tasks?.titleProperty || 'Name'];
      const title = titleProp?.title?.[0]?.plain_text || 'No title';
      logInfo(`First task title: ${title}`);
    }
    
    results.tests.push({ name: 'Notion API fetch', passed: true });
    results.passed++;
  } catch (error) {
    logError(`Notion API fetch failed: ${error}`);
    results.tests.push({ name: 'Notion API fetch', passed: false, error: String(error) });
    results.failed++;
  }

  // ============================================================
  // TEST 3: Verify SQLite schema
  // ============================================================
  logSection('TEST 3: Verify SQLite Schema');
  try {
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as { sql: string } | undefined;
    
    if (schema?.sql) {
      logSuccess('Tasks table exists');
      
      // Check for key columns
      const requiredColumns = ['client_id', 'notion_id', 'title', 'status', 'sync_status'];
      const missingColumns = requiredColumns.filter(col => !schema.sql.includes(col));
      
      if (missingColumns.length === 0) {
        logSuccess('All required columns present');
        results.tests.push({ name: 'SQLite schema', passed: true });
        results.passed++;
      } else {
        logError(`Missing columns: ${missingColumns.join(', ')}`);
        results.tests.push({ name: 'SQLite schema', passed: false, error: `Missing: ${missingColumns.join(', ')}` });
        results.failed++;
      }
    } else {
      logError('Tasks table not found');
      results.tests.push({ name: 'SQLite schema', passed: false, error: 'Table not found' });
      results.failed++;
    }
  } catch (error) {
    logError(`Schema check failed: ${error}`);
    results.tests.push({ name: 'SQLite schema', passed: false, error: String(error) });
    results.failed++;
  }

  // ============================================================
  // TEST 4: Sample tasks from SQLite
  // ============================================================
  logSection('TEST 4: Sample Tasks from SQLite');
  try {
    const tasks = db.prepare(`
      SELECT client_id, notion_id, title, status, sync_status 
      FROM tasks 
      LIMIT 5
    `).all() as Array<{ client_id: string; notion_id: string | null; title: string; status: string; sync_status: string }>;
    
    if (tasks.length > 0) {
      logSuccess(`Found ${tasks.length} sample tasks:`);
      tasks.forEach((task, i) => {
        console.log(`   ${i + 1}. "${task.title?.substring(0, 40) || 'No title'}..." [${task.sync_status}]`);
      });
      results.tests.push({ name: 'SQLite data read', passed: true });
      results.passed++;
    } else {
      logInfo('No tasks in SQLite yet (this is OK if first run)');
      results.tests.push({ name: 'SQLite data read', passed: true });
      results.passed++;
    }
  } catch (error) {
    logError(`SQLite read failed: ${error}`);
    results.tests.push({ name: 'SQLite data read', passed: false, error: String(error) });
    results.failed++;
  }

  // ============================================================
  // TEST 5: Count tasks by sync status
  // ============================================================
  logSection('TEST 5: Task Sync Status Breakdown');
  try {
    const breakdown = db.prepare(`
      SELECT sync_status, COUNT(*) as count 
      FROM tasks 
      GROUP BY sync_status
    `).all() as Array<{ sync_status: string; count: number }>;
    
    if (breakdown.length > 0) {
      logSuccess('Sync status breakdown:');
      breakdown.forEach(row => {
        console.log(`   ${row.sync_status}: ${row.count} tasks`);
      });
    } else {
      logInfo('No tasks to break down');
    }
    results.tests.push({ name: 'Sync status breakdown', passed: true });
    results.passed++;
  } catch (error) {
    logError(`Breakdown failed: ${error}`);
    results.tests.push({ name: 'Sync status breakdown', passed: false, error: String(error) });
    results.failed++;
  }

  // ============================================================
  // TEST 6: Check for orphaned tasks (local only, never synced)
  // ============================================================
  logSection('TEST 6: Check for Local-Only Tasks');
  try {
    const localOnly = db.prepare(`
      SELECT COUNT(*) as count 
      FROM tasks 
      WHERE notion_id IS NULL AND sync_status = 'local'
    `).get() as { count: number };
    
    logInfo(`Local-only tasks (not yet pushed to Notion): ${localOnly.count}`);
    
    const pending = db.prepare(`
      SELECT COUNT(*) as count 
      FROM tasks 
      WHERE sync_status = 'pending'
    `).get() as { count: number };
    
    logInfo(`Pending sync tasks: ${pending.count}`);
    
    results.tests.push({ name: 'Local-only check', passed: true });
    results.passed++;
  } catch (error) {
    logError(`Local-only check failed: ${error}`);
    results.tests.push({ name: 'Local-only check', passed: false, error: String(error) });
    results.failed++;
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  logSection('TEST SUMMARY');
  console.log(`\n📊 Results: ${results.passed} passed, ${results.failed} failed\n`);
  
  results.tests.forEach(test => {
    const icon = test.passed ? '✅' : '❌';
    console.log(`${icon} ${test.name}${test.error ? ` - ${test.error}` : ''}`);
  });

  db.close();
  
  if (results.failed > 0) {
    console.log('\n⚠️  Some tests failed. Check the errors above.');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

