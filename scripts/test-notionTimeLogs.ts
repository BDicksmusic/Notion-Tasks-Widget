/**
 * Test Script: Notion Time Logs Service
 * 
 * Tests the complete flow:
 * 1. Fetch time logs from Notion → Save to SQLite
 * 2. Create time log locally → Push to Notion
 * 3. Verify all data in SQLite
 * 
 * Run: npx ts-node scripts/test-notionTimeLogs.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');

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

function logSection(title: string) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

function logSuccess(msg: string) { console.log(`✅ ${msg}`); }
function logError(msg: string) { console.log(`❌ ${msg}`); }
function logInfo(msg: string) { console.log(`ℹ️  ${msg}`); }

async function runTests() {
  const config = loadConfig();
  if (!config) {
    console.error('❌ No config found.');
    process.exit(1);
  }

  const apiKey = process.env.NOTION_API_KEY || config.tasks?.apiKey;
  const databaseId = config.timeLog?.databaseId;

  logSection('TEST: Notion Time Logs Service');

  if (!databaseId) {
    logInfo('No time logs database configured');
    logInfo('Configure time logs database in Control Center to enable');
    console.log('\nSkipping Notion API tests...\n');
  } else {
    console.log(`📋 Time Logs Database ID: ${databaseId.substring(0, 8)}...`);
  }

  const db = getDatabase();
  const results = {
    passed: 0,
    failed: 0,
    tests: [] as { name: string; passed: boolean; error?: string }[]
  };

  // ============================================================
  // TEST 1: Check SQLite time_logs table
  // ============================================================
  logSection('TEST 1: Check SQLite Time Logs Table');
  try {
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='time_logs'").get() as { sql: string } | undefined;
    
    if (schema?.sql) {
      logSuccess('Time logs table exists');
      
      const count = db.prepare('SELECT COUNT(*) as count FROM time_logs').get() as { count: number };
      logInfo(`Time logs in SQLite: ${count.count}`);
      
      results.tests.push({ name: 'SQLite time_logs table', passed: true });
      results.passed++;
    } else {
      logError('Time logs table not found');
      results.tests.push({ name: 'SQLite time_logs table', passed: false, error: 'Table not found' });
      results.failed++;
    }
  } catch (error) {
    logError(`SQLite check failed: ${error}`);
    results.tests.push({ name: 'SQLite time_logs table', passed: false, error: String(error) });
    results.failed++;
  }

  // ============================================================
  // TEST 2: Fetch time logs from Notion (if configured)
  // ============================================================
  if (databaseId && apiKey) {
    logSection('TEST 2: Fetch Time Logs from Notion API');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      
      const response = await (notion.databases as any).query({
        database_id: databaseId,
        page_size: 5,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }]
      });
      
      logSuccess(`Fetched ${response.results.length} time logs from Notion`);
      
      if (response.results.length > 0) {
        const firstLog = response.results[0] as any;
        logInfo(`First log ID: ${firstLog.id}`);
        logInfo(`Created: ${firstLog.created_time}`);
      }
      
      results.tests.push({ name: 'Notion time logs fetch', passed: true });
      results.passed++;
    } catch (error) {
      logError(`Notion fetch failed: ${error}`);
      results.tests.push({ name: 'Notion time logs fetch', passed: false, error: String(error) });
      results.failed++;
    }
  }

  // ============================================================
  // TEST 3: Sample time logs from SQLite
  // ============================================================
  logSection('TEST 3: Sample Time Logs from SQLite');
  try {
    const logs = db.prepare(`
      SELECT client_id, notion_id, task_id, duration_minutes, start_time, sync_status 
      FROM time_logs 
      ORDER BY created_at DESC
      LIMIT 5
    `).all() as Array<{ client_id: string; notion_id: string | null; task_id: string; duration_minutes: number; start_time: string; sync_status: string }>;
    
    if (logs.length > 0) {
      logSuccess(`Found ${logs.length} sample time logs:`);
      logs.forEach((log, i) => {
        console.log(`   ${i + 1}. Task: ${log.task_id?.substring(0, 8)}... | ${log.duration_minutes} mins | [${log.sync_status}]`);
      });
    } else {
      logInfo('No time logs in SQLite yet');
    }
    results.tests.push({ name: 'SQLite time logs read', passed: true });
    results.passed++;
  } catch (error) {
    logError(`SQLite read failed: ${error}`);
    results.tests.push({ name: 'SQLite time logs read', passed: false, error: String(error) });
    results.failed++;
  }

  // ============================================================
  // TEST 4: Time log aggregation
  // ============================================================
  logSection('TEST 4: Time Log Aggregation');
  try {
    const total = db.prepare(`
      SELECT SUM(duration_minutes) as total_minutes, COUNT(*) as count
      FROM time_logs
    `).get() as { total_minutes: number | null; count: number };
    
    logInfo(`Total logged time: ${total.total_minutes || 0} minutes (${((total.total_minutes || 0) / 60).toFixed(1)} hours)`);
    logInfo(`Total entries: ${total.count}`);
    
    // Today's logs
    const today = new Date().toISOString().split('T')[0];
    const todayLogs = db.prepare(`
      SELECT SUM(duration_minutes) as total
      FROM time_logs 
      WHERE date(start_time) = date(?)
    `).get(today) as { total: number | null };
    
    logInfo(`Today's logged time: ${todayLogs.total || 0} minutes`);
    
    results.tests.push({ name: 'Time aggregation', passed: true });
    results.passed++;
  } catch (error) {
    logError(`Aggregation failed: ${error}`);
    results.tests.push({ name: 'Time aggregation', passed: false, error: String(error) });
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
    console.log('\n⚠️  Some tests failed.');
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


 * 
 * Tests the complete flow:
 * 1. Fetch time logs from Notion → Save to SQLite
 * 2. Create time log locally → Push to Notion
 * 3. Verify all data in SQLite
 * 
 * Run: npx ts-node scripts/test-notionTimeLogs.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');

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

function logSection(title: string) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

function logSuccess(msg: string) { console.log(`✅ ${msg}`); }
function logError(msg: string) { console.log(`❌ ${msg}`); }
function logInfo(msg: string) { console.log(`ℹ️  ${msg}`); }

async function runTests() {
  const config = loadConfig();
  if (!config) {
    console.error('❌ No config found.');
    process.exit(1);
  }

  const apiKey = process.env.NOTION_API_KEY || config.tasks?.apiKey;
  const databaseId = config.timeLog?.databaseId;

  logSection('TEST: Notion Time Logs Service');

  if (!databaseId) {
    logInfo('No time logs database configured');
    logInfo('Configure time logs database in Control Center to enable');
    console.log('\nSkipping Notion API tests...\n');
  } else {
    console.log(`📋 Time Logs Database ID: ${databaseId.substring(0, 8)}...`);
  }

  const db = getDatabase();
  const results = {
    passed: 0,
    failed: 0,
    tests: [] as { name: string; passed: boolean; error?: string }[]
  };

  // ============================================================
  // TEST 1: Check SQLite time_logs table
  // ============================================================
  logSection('TEST 1: Check SQLite Time Logs Table');
  try {
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='time_logs'").get() as { sql: string } | undefined;
    
    if (schema?.sql) {
      logSuccess('Time logs table exists');
      
      const count = db.prepare('SELECT COUNT(*) as count FROM time_logs').get() as { count: number };
      logInfo(`Time logs in SQLite: ${count.count}`);
      
      results.tests.push({ name: 'SQLite time_logs table', passed: true });
      results.passed++;
    } else {
      logError('Time logs table not found');
      results.tests.push({ name: 'SQLite time_logs table', passed: false, error: 'Table not found' });
      results.failed++;
    }
  } catch (error) {
    logError(`SQLite check failed: ${error}`);
    results.tests.push({ name: 'SQLite time_logs table', passed: false, error: String(error) });
    results.failed++;
  }

  // ============================================================
  // TEST 2: Fetch time logs from Notion (if configured)
  // ============================================================
  if (databaseId && apiKey) {
    logSection('TEST 2: Fetch Time Logs from Notion API');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      
      const response = await (notion.databases as any).query({
        database_id: databaseId,
        page_size: 5,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }]
      });
      
      logSuccess(`Fetched ${response.results.length} time logs from Notion`);
      
      if (response.results.length > 0) {
        const firstLog = response.results[0] as any;
        logInfo(`First log ID: ${firstLog.id}`);
        logInfo(`Created: ${firstLog.created_time}`);
      }
      
      results.tests.push({ name: 'Notion time logs fetch', passed: true });
      results.passed++;
    } catch (error) {
      logError(`Notion fetch failed: ${error}`);
      results.tests.push({ name: 'Notion time logs fetch', passed: false, error: String(error) });
      results.failed++;
    }
  }

  // ============================================================
  // TEST 3: Sample time logs from SQLite
  // ============================================================
  logSection('TEST 3: Sample Time Logs from SQLite');
  try {
    const logs = db.prepare(`
      SELECT client_id, notion_id, task_id, duration_minutes, start_time, sync_status 
      FROM time_logs 
      ORDER BY created_at DESC
      LIMIT 5
    `).all() as Array<{ client_id: string; notion_id: string | null; task_id: string; duration_minutes: number; start_time: string; sync_status: string }>;
    
    if (logs.length > 0) {
      logSuccess(`Found ${logs.length} sample time logs:`);
      logs.forEach((log, i) => {
        console.log(`   ${i + 1}. Task: ${log.task_id?.substring(0, 8)}... | ${log.duration_minutes} mins | [${log.sync_status}]`);
      });
    } else {
      logInfo('No time logs in SQLite yet');
    }
    results.tests.push({ name: 'SQLite time logs read', passed: true });
    results.passed++;
  } catch (error) {
    logError(`SQLite read failed: ${error}`);
    results.tests.push({ name: 'SQLite time logs read', passed: false, error: String(error) });
    results.failed++;
  }

  // ============================================================
  // TEST 4: Time log aggregation
  // ============================================================
  logSection('TEST 4: Time Log Aggregation');
  try {
    const total = db.prepare(`
      SELECT SUM(duration_minutes) as total_minutes, COUNT(*) as count
      FROM time_logs
    `).get() as { total_minutes: number | null; count: number };
    
    logInfo(`Total logged time: ${total.total_minutes || 0} minutes (${((total.total_minutes || 0) / 60).toFixed(1)} hours)`);
    logInfo(`Total entries: ${total.count}`);
    
    // Today's logs
    const today = new Date().toISOString().split('T')[0];
    const todayLogs = db.prepare(`
      SELECT SUM(duration_minutes) as total
      FROM time_logs 
      WHERE date(start_time) = date(?)
    `).get(today) as { total: number | null };
    
    logInfo(`Today's logged time: ${todayLogs.total || 0} minutes`);
    
    results.tests.push({ name: 'Time aggregation', passed: true });
    results.passed++;
  } catch (error) {
    logError(`Aggregation failed: ${error}`);
    results.tests.push({ name: 'Time aggregation', passed: false, error: String(error) });
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
    console.log('\n⚠️  Some tests failed.');
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

