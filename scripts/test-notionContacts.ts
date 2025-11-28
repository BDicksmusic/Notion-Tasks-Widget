/**
 * Test Script: Notion Contacts Service
 * 
 * Tests the complete flow:
 * 1. Fetch contacts from Notion
 * 2. Verify configuration
 * 
 * Run: npx ts-node scripts/test-notionContacts.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

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
  const databaseId = config.contacts?.databaseId;

  logSection('TEST: Notion Contacts Service');

  if (!databaseId) {
    logInfo('No contacts database configured');
    logInfo('Configure contacts database in Control Center to enable');
    console.log('\nSkipping Notion API tests...\n');
    
    console.log('='.repeat(60));
    console.log('  TEST SUMMARY');
    console.log('='.repeat(60));
    console.log('\n📊 Results: 0 passed, 0 failed (no tests to run)\n');
    console.log('ℹ️  Contacts feature is optional\n');
    process.exit(0);
  }

  console.log(`📋 Contacts Database ID: ${databaseId.substring(0, 8)}...`);

  const results = {
    passed: 0,
    failed: 0,
    tests: [] as { name: string; passed: boolean; error?: string }[]
  };

  // ============================================================
  // TEST 1: Configuration check
  // ============================================================
  logSection('TEST 1: Configuration Check');
  try {
    const nameProperty = config.contacts?.nameProperty;
    const emailProperty = config.contacts?.emailProperty;
    
    logInfo(`Name property: ${nameProperty || 'Not set (using default)'}`);
    logInfo(`Email property: ${emailProperty || 'Not set (optional)'}`);
    
    results.tests.push({ name: 'Configuration', passed: true });
    results.passed++;
  } catch (error) {
    logError(`Configuration check failed: ${error}`);
    results.tests.push({ name: 'Configuration', passed: false, error: String(error) });
    results.failed++;
  }

  // ============================================================
  // TEST 2: Fetch contacts from Notion
  // ============================================================
  if (apiKey) {
    logSection('TEST 2: Fetch Contacts from Notion API');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      
      const response = await (notion.databases as any).query({
        database_id: databaseId,
        page_size: 10
      });
      
      logSuccess(`Fetched ${response.results.length} contacts from Notion`);
      
      if (response.results.length > 0) {
        const firstContact = response.results[0] as any;
        logInfo(`First contact ID: ${firstContact.id}`);
        
        // Try to extract name
        const nameProp = config.contacts?.nameProperty || 'Name';
        const nameValue = firstContact.properties?.[nameProp];
        let name = 'Unknown';
        
        if (nameValue?.title?.[0]?.plain_text) {
          name = nameValue.title[0].plain_text;
        } else if (nameValue?.rich_text?.[0]?.plain_text) {
          name = nameValue.rich_text[0].plain_text;
        }
        
        logInfo(`First contact name: ${name}`);
      }
      
      results.tests.push({ name: 'Notion contacts fetch', passed: true });
      results.passed++;
    } catch (error) {
      logError(`Notion fetch failed: ${error}`);
      results.tests.push({ name: 'Notion contacts fetch', passed: false, error: String(error) });
      results.failed++;
    }
  } else {
    logError('No API key available');
    results.tests.push({ name: 'API key', passed: false, error: 'Missing' });
    results.failed++;
  }

  // ============================================================
  // TEST 3: Database schema discovery
  // ============================================================
  if (apiKey) {
    logSection('TEST 3: Database Schema Discovery');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      
      const database = await notion.databases.retrieve({
        database_id: databaseId
      });
      
      const properties = Object.keys((database as any).properties);
      logSuccess(`Found ${properties.length} properties in database`);
      logInfo(`Properties: ${properties.slice(0, 5).join(', ')}${properties.length > 5 ? '...' : ''}`);
      
      results.tests.push({ name: 'Schema discovery', passed: true });
      results.passed++;
    } catch (error) {
      logError(`Schema discovery failed: ${error}`);
      results.tests.push({ name: 'Schema discovery', passed: false, error: String(error) });
      results.failed++;
    }
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
 * 1. Fetch contacts from Notion
 * 2. Verify configuration
 * 
 * Run: npx ts-node scripts/test-notionContacts.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

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
  const databaseId = config.contacts?.databaseId;

  logSection('TEST: Notion Contacts Service');

  if (!databaseId) {
    logInfo('No contacts database configured');
    logInfo('Configure contacts database in Control Center to enable');
    console.log('\nSkipping Notion API tests...\n');
    
    console.log('='.repeat(60));
    console.log('  TEST SUMMARY');
    console.log('='.repeat(60));
    console.log('\n📊 Results: 0 passed, 0 failed (no tests to run)\n');
    console.log('ℹ️  Contacts feature is optional\n');
    process.exit(0);
  }

  console.log(`📋 Contacts Database ID: ${databaseId.substring(0, 8)}...`);

  const results = {
    passed: 0,
    failed: 0,
    tests: [] as { name: string; passed: boolean; error?: string }[]
  };

  // ============================================================
  // TEST 1: Configuration check
  // ============================================================
  logSection('TEST 1: Configuration Check');
  try {
    const nameProperty = config.contacts?.nameProperty;
    const emailProperty = config.contacts?.emailProperty;
    
    logInfo(`Name property: ${nameProperty || 'Not set (using default)'}`);
    logInfo(`Email property: ${emailProperty || 'Not set (optional)'}`);
    
    results.tests.push({ name: 'Configuration', passed: true });
    results.passed++;
  } catch (error) {
    logError(`Configuration check failed: ${error}`);
    results.tests.push({ name: 'Configuration', passed: false, error: String(error) });
    results.failed++;
  }

  // ============================================================
  // TEST 2: Fetch contacts from Notion
  // ============================================================
  if (apiKey) {
    logSection('TEST 2: Fetch Contacts from Notion API');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      
      const response = await (notion.databases as any).query({
        database_id: databaseId,
        page_size: 10
      });
      
      logSuccess(`Fetched ${response.results.length} contacts from Notion`);
      
      if (response.results.length > 0) {
        const firstContact = response.results[0] as any;
        logInfo(`First contact ID: ${firstContact.id}`);
        
        // Try to extract name
        const nameProp = config.contacts?.nameProperty || 'Name';
        const nameValue = firstContact.properties?.[nameProp];
        let name = 'Unknown';
        
        if (nameValue?.title?.[0]?.plain_text) {
          name = nameValue.title[0].plain_text;
        } else if (nameValue?.rich_text?.[0]?.plain_text) {
          name = nameValue.rich_text[0].plain_text;
        }
        
        logInfo(`First contact name: ${name}`);
      }
      
      results.tests.push({ name: 'Notion contacts fetch', passed: true });
      results.passed++;
    } catch (error) {
      logError(`Notion fetch failed: ${error}`);
      results.tests.push({ name: 'Notion contacts fetch', passed: false, error: String(error) });
      results.failed++;
    }
  } else {
    logError('No API key available');
    results.tests.push({ name: 'API key', passed: false, error: 'Missing' });
    results.failed++;
  }

  // ============================================================
  // TEST 3: Database schema discovery
  // ============================================================
  if (apiKey) {
    logSection('TEST 3: Database Schema Discovery');
    try {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: apiKey });
      
      const database = await notion.databases.retrieve({
        database_id: databaseId
      });
      
      const properties = Object.keys((database as any).properties);
      logSuccess(`Found ${properties.length} properties in database`);
      logInfo(`Properties: ${properties.slice(0, 5).join(', ')}${properties.length > 5 ? '...' : ''}`);
      
      results.tests.push({ name: 'Schema discovery', passed: true });
      results.passed++;
    } catch (error) {
      logError(`Schema discovery failed: ${error}`);
      results.tests.push({ name: 'Schema discovery', passed: false, error: String(error) });
      results.failed++;
    }
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

