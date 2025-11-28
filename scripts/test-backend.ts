/**
 * Backend Test Script - Direct API Testing
 * 
 * Tests Notion API connectivity and SQLite storage without SDK quirks.
 * Uses raw fetch for Notion API and verifies SQLite schema/data.
 * 
 * Run: npx ts-node scripts/test-backend.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');

// ============================================================
// CONFIGURATION
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
    console.log(`📂 Config path: ${configPath}`);
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('❌ Failed to load config:', error);
    return null;
  }
}

// Check for both possible database file names
function findDatabase(): Database.Database | null {
  const appData = getAppDataPath();
  const possiblePaths = [
    path.join(appData, 'notion-tasks.db'),
    path.join(appData, 'notion-widget.sqlite'),
  ];
  
  for (const dbPath of possiblePaths) {
    if (fs.existsSync(dbPath)) {
      console.log(`📂 Found database: ${dbPath}`);
      return new Database(dbPath);
    }
  }
  
  console.log(`⚠️  No database found. Tried: ${possiblePaths.join(', ')}`);
  return null;
}

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
    throw new Error(`Notion API error: ${response.status} - ${text}`);
  }
  
  return response.json();
}

async function queryDatabase(apiKey: string, databaseId: string, filter?: any, pageSize = 5) {
  return notionRequest(apiKey, `/databases/${databaseId}/query`, 'POST', {
    page_size: pageSize,
    filter,
  });
}

// ============================================================
// LOGGING
// ============================================================

function logSection(title: string) {
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
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
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       NOTION TASKS WIDGET - BACKEND TESTS                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const config = loadConfig();
  if (!config) {
    console.error('\n❌ No config found. Run the app first to set up Notion.');
    process.exit(1);
  }

  const results: TestResult[] = [];
  const apiKey = process.env.NOTION_API_KEY || config.tasks?.apiKey;

  // ============================================================
  // PHASE 1: NOTION API CONNECTIVITY
  // ============================================================
  logSection('PHASE 1: NOTION API CONNECTIVITY');

  if (!apiKey) {
    logError('No API key found');
    results.push({ name: 'API Key', passed: false, error: 'Missing' });
  } else {
    logSuccess(`API key: ${apiKey.substring(0, 12)}...`);
    results.push({ name: 'API Key', passed: true });

    // Test user endpoint
    try {
      const user = await notionRequest(apiKey, '/users/me');
      logSuccess(`Connected as: ${user.name || user.id}`);
      results.push({ name: 'Notion Connection', passed: true });
    } catch (error) {
      logError(`Connection failed: ${error}`);
      results.push({ name: 'Notion Connection', passed: false, error: String(error) });
    }
  }

  // ============================================================
  // PHASE 2: TASKS DATABASE
  // ============================================================
  logSection('PHASE 2: TASKS DATABASE');

  const tasksDatabaseId = config.tasks?.databaseId;
  if (tasksDatabaseId && apiKey) {
    logInfo(`Database ID: ${tasksDatabaseId.substring(0, 8)}...`);
    
    try {
      const response = await queryDatabase(apiKey, tasksDatabaseId, {
        property: config.tasks?.statusProperty || 'Status',
        status: { does_not_equal: config.tasks?.completedStatus || 'Done' }
      });
      
      logSuccess(`Fetched ${response.results?.length || 0} tasks`);
      
      if (response.results?.length > 0) {
        const task = response.results[0];
        const title = Object.values(task.properties || {})
          .find((p: any) => p.type === 'title') as any;
        const titleText = title?.title?.[0]?.plain_text || 'No title';
        logInfo(`Sample task: "${titleText.substring(0, 40)}..."`);
      }
      
      results.push({ name: 'Tasks: Fetch', passed: true, details: `${response.results?.length} tasks` });
    } catch (error) {
      logError(`Tasks fetch failed: ${error}`);
      results.push({ name: 'Tasks: Fetch', passed: false, error: String(error) });
    }
  } else {
    logWarn('Tasks database not configured');
    results.push({ name: 'Tasks: Config', passed: false, error: 'Not configured' });
  }

  // ============================================================
  // PHASE 3: PROJECTS DATABASE
  // ============================================================
  logSection('PHASE 3: PROJECTS DATABASE');

  const projectsDatabaseId = config.projects?.databaseId;
  if (projectsDatabaseId && apiKey) {
    logInfo(`Database ID: ${projectsDatabaseId.substring(0, 8)}...`);
    
    try {
      const response = await queryDatabase(apiKey, projectsDatabaseId);
      logSuccess(`Fetched ${response.results?.length || 0} projects`);
      results.push({ name: 'Projects: Fetch', passed: true, details: `${response.results?.length} projects` });
    } catch (error) {
      logError(`Projects fetch failed: ${error}`);
      results.push({ name: 'Projects: Fetch', passed: false, error: String(error) });
    }
  } else {
    logInfo('Projects database not configured (optional)');
    results.push({ name: 'Projects: Config', passed: true, details: 'Optional' });
  }

  // ============================================================
  // PHASE 4: TIME LOGS DATABASE
  // ============================================================
  logSection('PHASE 4: TIME LOGS DATABASE');

  const timeLogsDatabaseId = config.timeLog?.databaseId;
  if (timeLogsDatabaseId && apiKey) {
    logInfo(`Database ID: ${timeLogsDatabaseId.substring(0, 8)}...`);
    
    try {
      const response = await queryDatabase(apiKey, timeLogsDatabaseId);
      logSuccess(`Fetched ${response.results?.length || 0} time logs`);
      results.push({ name: 'Time Logs: Fetch', passed: true, details: `${response.results?.length} logs` });
    } catch (error) {
      logError(`Time logs fetch failed: ${error}`);
      results.push({ name: 'Time Logs: Fetch', passed: false, error: String(error) });
    }
  } else {
    logInfo('Time logs database not configured (optional)');
    results.push({ name: 'Time Logs: Config', passed: true, details: 'Optional' });
  }

  // ============================================================
  // PHASE 5: SQLITE DATABASE
  // ============================================================
  logSection('PHASE 5: SQLITE DATABASE');

  const db = findDatabase();
  
  if (db) {
    try {
      const version = db.prepare('SELECT sqlite_version() as v').get() as { v: string };
      logSuccess(`SQLite ${version.v}`);
      results.push({ name: 'SQLite: Connection', passed: true });

      // Check tables
      const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as Array<{ name: string }>;
      
      if (tables.length > 0) {
        logInfo(`Tables found: ${tables.map(t => t.name).join(', ')}`);
      } else {
        logWarn('No tables found in database (run the app to initialize)');
      }
      
      // Check task count
      const tasksTable = tables.find(t => t.name === 'tasks');
      if (tasksTable) {
        const taskCount = db.prepare('SELECT COUNT(*) as c FROM tasks').get() as { c: number };
        logSuccess(`Tasks in SQLite: ${taskCount.c}`);
        results.push({ name: 'SQLite: Tasks', passed: true, details: `${taskCount.c} rows` });
      } else {
        logWarn('Tasks table not found');
        results.push({ name: 'SQLite: Tasks', passed: false, error: 'Table not found' });
      }

      // Check projects
      const projectsTable = tables.find(t => t.name === 'projects');
      if (projectsTable) {
        const projectCount = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
        logSuccess(`Projects in SQLite: ${projectCount.c}`);
        results.push({ name: 'SQLite: Projects', passed: true, details: `${projectCount.c} rows` });
      } else {
        logInfo('Projects table not found (may not be initialized)');
        results.push({ name: 'SQLite: Projects', passed: true, details: 'Not initialized' });
      }

      db.close();
    } catch (error) {
      logError(`SQLite error: ${error}`);
      results.push({ name: 'SQLite: Connection', passed: false, error: String(error) });
    }
  } else {
    logWarn('No SQLite database found - run the app first');
    results.push({ name: 'SQLite: Connection', passed: false, error: 'Database not found' });
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  logSection('TEST SUMMARY');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`\n  📊 Results: ${passed} passed, ${failed} failed\n`);

  results.forEach(r => {
    const icon = r.passed ? '✅' : '❌';
    const detail = r.details ? ` (${r.details})` : r.error ? ` - ${r.error}` : '';
    console.log(`  ${icon} ${r.name}${detail}`);
  });

  console.log('\n' + '═'.repeat(60));
  if (failed > 0) {
    console.log('  ⚠️  SOME TESTS FAILED');
    process.exit(1);
  } else {
    console.log('  🎉 ALL TESTS PASSED!');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});


 * 
 * Tests Notion API connectivity and SQLite storage without SDK quirks.
 * Uses raw fetch for Notion API and verifies SQLite schema/data.
 * 
 * Run: npx ts-node scripts/test-backend.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');

// ============================================================
// CONFIGURATION
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
    console.log(`📂 Config path: ${configPath}`);
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('❌ Failed to load config:', error);
    return null;
  }
}

// Check for both possible database file names
function findDatabase(): Database.Database | null {
  const appData = getAppDataPath();
  const possiblePaths = [
    path.join(appData, 'notion-tasks.db'),
    path.join(appData, 'notion-widget.sqlite'),
  ];
  
  for (const dbPath of possiblePaths) {
    if (fs.existsSync(dbPath)) {
      console.log(`📂 Found database: ${dbPath}`);
      return new Database(dbPath);
    }
  }
  
  console.log(`⚠️  No database found. Tried: ${possiblePaths.join(', ')}`);
  return null;
}

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
    throw new Error(`Notion API error: ${response.status} - ${text}`);
  }
  
  return response.json();
}

async function queryDatabase(apiKey: string, databaseId: string, filter?: any, pageSize = 5) {
  return notionRequest(apiKey, `/databases/${databaseId}/query`, 'POST', {
    page_size: pageSize,
    filter,
  });
}

// ============================================================
// LOGGING
// ============================================================

function logSection(title: string) {
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
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
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       NOTION TASKS WIDGET - BACKEND TESTS                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const config = loadConfig();
  if (!config) {
    console.error('\n❌ No config found. Run the app first to set up Notion.');
    process.exit(1);
  }

  const results: TestResult[] = [];
  const apiKey = process.env.NOTION_API_KEY || config.tasks?.apiKey;

  // ============================================================
  // PHASE 1: NOTION API CONNECTIVITY
  // ============================================================
  logSection('PHASE 1: NOTION API CONNECTIVITY');

  if (!apiKey) {
    logError('No API key found');
    results.push({ name: 'API Key', passed: false, error: 'Missing' });
  } else {
    logSuccess(`API key: ${apiKey.substring(0, 12)}...`);
    results.push({ name: 'API Key', passed: true });

    // Test user endpoint
    try {
      const user = await notionRequest(apiKey, '/users/me');
      logSuccess(`Connected as: ${user.name || user.id}`);
      results.push({ name: 'Notion Connection', passed: true });
    } catch (error) {
      logError(`Connection failed: ${error}`);
      results.push({ name: 'Notion Connection', passed: false, error: String(error) });
    }
  }

  // ============================================================
  // PHASE 2: TASKS DATABASE
  // ============================================================
  logSection('PHASE 2: TASKS DATABASE');

  const tasksDatabaseId = config.tasks?.databaseId;
  if (tasksDatabaseId && apiKey) {
    logInfo(`Database ID: ${tasksDatabaseId.substring(0, 8)}...`);
    
    try {
      const response = await queryDatabase(apiKey, tasksDatabaseId, {
        property: config.tasks?.statusProperty || 'Status',
        status: { does_not_equal: config.tasks?.completedStatus || 'Done' }
      });
      
      logSuccess(`Fetched ${response.results?.length || 0} tasks`);
      
      if (response.results?.length > 0) {
        const task = response.results[0];
        const title = Object.values(task.properties || {})
          .find((p: any) => p.type === 'title') as any;
        const titleText = title?.title?.[0]?.plain_text || 'No title';
        logInfo(`Sample task: "${titleText.substring(0, 40)}..."`);
      }
      
      results.push({ name: 'Tasks: Fetch', passed: true, details: `${response.results?.length} tasks` });
    } catch (error) {
      logError(`Tasks fetch failed: ${error}`);
      results.push({ name: 'Tasks: Fetch', passed: false, error: String(error) });
    }
  } else {
    logWarn('Tasks database not configured');
    results.push({ name: 'Tasks: Config', passed: false, error: 'Not configured' });
  }

  // ============================================================
  // PHASE 3: PROJECTS DATABASE
  // ============================================================
  logSection('PHASE 3: PROJECTS DATABASE');

  const projectsDatabaseId = config.projects?.databaseId;
  if (projectsDatabaseId && apiKey) {
    logInfo(`Database ID: ${projectsDatabaseId.substring(0, 8)}...`);
    
    try {
      const response = await queryDatabase(apiKey, projectsDatabaseId);
      logSuccess(`Fetched ${response.results?.length || 0} projects`);
      results.push({ name: 'Projects: Fetch', passed: true, details: `${response.results?.length} projects` });
    } catch (error) {
      logError(`Projects fetch failed: ${error}`);
      results.push({ name: 'Projects: Fetch', passed: false, error: String(error) });
    }
  } else {
    logInfo('Projects database not configured (optional)');
    results.push({ name: 'Projects: Config', passed: true, details: 'Optional' });
  }

  // ============================================================
  // PHASE 4: TIME LOGS DATABASE
  // ============================================================
  logSection('PHASE 4: TIME LOGS DATABASE');

  const timeLogsDatabaseId = config.timeLog?.databaseId;
  if (timeLogsDatabaseId && apiKey) {
    logInfo(`Database ID: ${timeLogsDatabaseId.substring(0, 8)}...`);
    
    try {
      const response = await queryDatabase(apiKey, timeLogsDatabaseId);
      logSuccess(`Fetched ${response.results?.length || 0} time logs`);
      results.push({ name: 'Time Logs: Fetch', passed: true, details: `${response.results?.length} logs` });
    } catch (error) {
      logError(`Time logs fetch failed: ${error}`);
      results.push({ name: 'Time Logs: Fetch', passed: false, error: String(error) });
    }
  } else {
    logInfo('Time logs database not configured (optional)');
    results.push({ name: 'Time Logs: Config', passed: true, details: 'Optional' });
  }

  // ============================================================
  // PHASE 5: SQLITE DATABASE
  // ============================================================
  logSection('PHASE 5: SQLITE DATABASE');

  const db = findDatabase();
  
  if (db) {
    try {
      const version = db.prepare('SELECT sqlite_version() as v').get() as { v: string };
      logSuccess(`SQLite ${version.v}`);
      results.push({ name: 'SQLite: Connection', passed: true });

      // Check tables
      const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as Array<{ name: string }>;
      
      if (tables.length > 0) {
        logInfo(`Tables found: ${tables.map(t => t.name).join(', ')}`);
      } else {
        logWarn('No tables found in database (run the app to initialize)');
      }
      
      // Check task count
      const tasksTable = tables.find(t => t.name === 'tasks');
      if (tasksTable) {
        const taskCount = db.prepare('SELECT COUNT(*) as c FROM tasks').get() as { c: number };
        logSuccess(`Tasks in SQLite: ${taskCount.c}`);
        results.push({ name: 'SQLite: Tasks', passed: true, details: `${taskCount.c} rows` });
      } else {
        logWarn('Tasks table not found');
        results.push({ name: 'SQLite: Tasks', passed: false, error: 'Table not found' });
      }

      // Check projects
      const projectsTable = tables.find(t => t.name === 'projects');
      if (projectsTable) {
        const projectCount = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
        logSuccess(`Projects in SQLite: ${projectCount.c}`);
        results.push({ name: 'SQLite: Projects', passed: true, details: `${projectCount.c} rows` });
      } else {
        logInfo('Projects table not found (may not be initialized)');
        results.push({ name: 'SQLite: Projects', passed: true, details: 'Not initialized' });
      }

      db.close();
    } catch (error) {
      logError(`SQLite error: ${error}`);
      results.push({ name: 'SQLite: Connection', passed: false, error: String(error) });
    }
  } else {
    logWarn('No SQLite database found - run the app first');
    results.push({ name: 'SQLite: Connection', passed: false, error: 'Database not found' });
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  logSection('TEST SUMMARY');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`\n  📊 Results: ${passed} passed, ${failed} failed\n`);

  results.forEach(r => {
    const icon = r.passed ? '✅' : '❌';
    const detail = r.details ? ` (${r.details})` : r.error ? ` - ${r.error}` : '';
    console.log(`  ${icon} ${r.name}${detail}`);
  });

  console.log('\n' + '═'.repeat(60));
  if (failed > 0) {
    console.log('  ⚠️  SOME TESTS FAILED');
    process.exit(1);
  } else {
    console.log('  🎉 ALL TESTS PASSED!');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});

