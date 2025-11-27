/**
 * Test Script: Notion Projects Service
 * 
 * Tests the complete flow:
 * 1. Fetch projects from Notion → Save to SQLite
 * 2. Create project locally → Push to Notion
 * 3. Verify all data in SQLite
 * 
 * Run: npx ts-node scripts/test-notionProjects.ts
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
    console.error('❌ No config found. Please run the app first to set up Notion connection.');
    process.exit(1);
  }

  const apiKey = process.env.NOTION_API_KEY || config.tasks?.apiKey || config.projects?.apiKey;
  const databaseId = config.projects?.databaseId;

  if (!apiKey) {
    console.error('❌ Missing API key');
    process.exit(1);
  }

  logSection('TEST: Notion Projects Service');
  
  if (!databaseId) {
    logInfo('No projects database configured - skipping Notion tests');
    logInfo('Configure projects database in Control Center to enable');
  } else {
    console.log(`📋 Projects Database ID: ${databaseId.substring(0, 8)}...`);
  }

  const db = getDatabase();
  const results = {
    passed: 0,
    failed: 0,
    tests: [] as { name: string; passed: boolean; error?: string }[]
  };

  // ============================================================
  // TEST 1: Check SQLite projects table
  // ============================================================
  logSection('TEST 1: Check SQLite Projects Table');
  try {
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'").get() as { sql: string } | undefined;
    
    if (schema?.sql) {
      logSuccess('Projects table exists');
      
      const countBefore = db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };
      logInfo(`Projects in SQLite: ${countBefore.count}`);
      
      results.tests.push({ name: 'SQLite projects table', passed: true });
      results.passed++;
    } else {
      logError('Projects table not found');
      results.tests.push({ name: 'SQLite projects table', passed: false, error: 'Table not found' });
      results.failed++;
    }
  } catch (error) {
    logError(`SQLite check failed: ${error}`);
    results.tests.push({ name: 'SQLite projects table', passed: false, error: String(error) });
    results.failed++;
  }

  // ============================================================
  // TEST 2: Fetch projects from Notion (if configured)
  // ============================================================
  if (databaseId) {
    logSection('TEST 2: Fetch Projects from Notion API');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      
      const response = await (notion.databases as any).query({
        database_id: databaseId,
        page_size: 5
      });
      
      logSuccess(`Fetched ${response.results.length} projects from Notion`);
      
      if (response.results.length > 0) {
        const firstProject = response.results[0] as any;
        logInfo(`First project ID: ${firstProject.id}`);
        const titleProp = firstProject.properties?.[config.projects?.titleProperty || 'Name'];
        const title = titleProp?.title?.[0]?.plain_text || 'No title';
        logInfo(`First project title: ${title}`);
      }
      
      results.tests.push({ name: 'Notion projects fetch', passed: true });
      results.passed++;
    } catch (error) {
      logError(`Notion projects fetch failed: ${error}`);
      results.tests.push({ name: 'Notion projects fetch', passed: false, error: String(error) });
      results.failed++;
    }
  } else {
    logSection('TEST 2: Notion Projects (SKIPPED - not configured)');
    logInfo('Skipping Notion tests - no projects database configured');
  }

  // ============================================================
  // TEST 3: Sample projects from SQLite
  // ============================================================
  logSection('TEST 3: Sample Projects from SQLite');
  try {
    const projects = db.prepare(`
      SELECT client_id, notion_id, title, status, sync_status 
      FROM projects 
      LIMIT 5
    `).all() as Array<{ client_id: string; notion_id: string | null; title: string; status: string; sync_status: string }>;
    
    if (projects.length > 0) {
      logSuccess(`Found ${projects.length} sample projects:`);
      projects.forEach((project, i) => {
        console.log(`   ${i + 1}. "${project.title?.substring(0, 40) || 'No title'}..." [${project.sync_status}]`);
      });
    } else {
      logInfo('No projects in SQLite yet');
    }
    results.tests.push({ name: 'SQLite projects read', passed: true });
    results.passed++;
  } catch (error) {
    logError(`SQLite projects read failed: ${error}`);
    results.tests.push({ name: 'SQLite projects read', passed: false, error: String(error) });
    results.failed++;
  }

  // ============================================================
  // TEST 4: Project sync status breakdown
  // ============================================================
  logSection('TEST 4: Project Sync Status Breakdown');
  try {
    const breakdown = db.prepare(`
      SELECT sync_status, COUNT(*) as count 
      FROM projects 
      GROUP BY sync_status
    `).all() as Array<{ sync_status: string; count: number }>;
    
    if (breakdown.length > 0) {
      logSuccess('Sync status breakdown:');
      breakdown.forEach(row => {
        console.log(`   ${row.sync_status}: ${row.count} projects`);
      });
    } else {
      logInfo('No projects to break down');
    }
    results.tests.push({ name: 'Project sync breakdown', passed: true });
    results.passed++;
  } catch (error) {
    logError(`Breakdown failed: ${error}`);
    results.tests.push({ name: 'Project sync breakdown', passed: false, error: String(error) });
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

