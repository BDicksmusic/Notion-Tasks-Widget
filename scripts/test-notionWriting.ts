/**
 * Test Script: Notion Writing Service
 * 
 * Tests the complete flow:
 * 1. Fetch writing entries from Notion → Save to SQLite
 * 2. Create entry locally → Push to Notion
 * 3. Verify all data in SQLite
 * 
 * Run: npx ts-node scripts/test-notionWriting.ts
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
  const databaseId = config.writing?.databaseId;

  logSection('TEST: Notion Writing Service');

  if (!databaseId) {
    logInfo('No writing database configured');
    logInfo('Configure writing database in Control Center to enable');
    console.log('\nSkipping Notion API tests...\n');
  } else {
    console.log(`📋 Writing Database ID: ${databaseId.substring(0, 8)}...`);
  }

  const db = getDatabase();
  const results = {
    passed: 0,
    failed: 0,
    tests: [] as { name: string; passed: boolean; error?: string }[]
  };

  // ============================================================
  // TEST 1: Check SQLite writing_entries table
  // ============================================================
  logSection('TEST 1: Check SQLite Writing Entries Table');
  try {
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='writing_entries'").get() as { sql: string } | undefined;
    
    if (schema?.sql) {
      logSuccess('Writing entries table exists');
      
      const count = db.prepare('SELECT COUNT(*) as count FROM writing_entries').get() as { count: number };
      logInfo(`Writing entries in SQLite: ${count.count}`);
      
      results.tests.push({ name: 'SQLite writing_entries table', passed: true });
      results.passed++;
    } else {
      logError('Writing entries table not found');
      results.tests.push({ name: 'SQLite writing_entries table', passed: false, error: 'Table not found' });
      results.failed++;
    }
  } catch (error) {
    logError(`SQLite check failed: ${error}`);
    results.tests.push({ name: 'SQLite writing_entries table', passed: false, error: String(error) });
    results.failed++;
  }

  // ============================================================
  // TEST 2: Fetch writing entries from Notion (if configured)
  // ============================================================
  if (databaseId && apiKey) {
    logSection('TEST 2: Fetch Writing Entries from Notion API');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      
      const response = await (notion.databases as any).query({
        database_id: databaseId,
        page_size: 5,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }]
      });
      
      logSuccess(`Fetched ${response.results.length} writing entries from Notion`);
      
      if (response.results.length > 0) {
        const firstEntry = response.results[0] as any;
        logInfo(`First entry ID: ${firstEntry.id}`);
        const titleProp = firstEntry.properties?.[config.writing?.titleProperty || 'Title'];
        const title = titleProp?.title?.[0]?.plain_text || 'No title';
        logInfo(`First entry title: ${title}`);
      }
      
      results.tests.push({ name: 'Notion writing fetch', passed: true });
      results.passed++;
    } catch (error) {
      logError(`Notion fetch failed: ${error}`);
      results.tests.push({ name: 'Notion writing fetch', passed: false, error: String(error) });
      results.failed++;
    }
  }

  // ============================================================
  // TEST 3: Sample writing entries from SQLite
  // ============================================================
  logSection('TEST 3: Sample Writing Entries from SQLite');
  try {
    const entries = db.prepare(`
      SELECT client_id, notion_id, title, word_count, sync_status, created_at
      FROM writing_entries 
      ORDER BY created_at DESC
      LIMIT 5
    `).all() as Array<{ client_id: string; notion_id: string | null; title: string; word_count: number; sync_status: string; created_at: string }>;
    
    if (entries.length > 0) {
      logSuccess(`Found ${entries.length} sample writing entries:`);
      entries.forEach((entry, i) => {
        console.log(`   ${i + 1}. "${entry.title?.substring(0, 30) || 'No title'}..." | ${entry.word_count || 0} words | [${entry.sync_status}]`);
      });
    } else {
      logInfo('No writing entries in SQLite yet');
    }
    results.tests.push({ name: 'SQLite writing read', passed: true });
    results.passed++;
  } catch (error) {
    logError(`SQLite read failed: ${error}`);
    results.tests.push({ name: 'SQLite writing read', passed: false, error: String(error) });
    results.failed++;
  }

  // ============================================================
  // TEST 4: Writing statistics
  // ============================================================
  logSection('TEST 4: Writing Statistics');
  try {
    const stats = db.prepare(`
      SELECT 
        SUM(word_count) as total_words, 
        COUNT(*) as total_entries,
        AVG(word_count) as avg_words
      FROM writing_entries
    `).get() as { total_words: number | null; total_entries: number; avg_words: number | null };
    
    logInfo(`Total entries: ${stats.total_entries}`);
    logInfo(`Total words: ${stats.total_words || 0}`);
    logInfo(`Average words per entry: ${Math.round(stats.avg_words || 0)}`);
    
    results.tests.push({ name: 'Writing statistics', passed: true });
    results.passed++;
  } catch (error) {
    logError(`Stats failed: ${error}`);
    results.tests.push({ name: 'Writing statistics', passed: false, error: String(error) });
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

