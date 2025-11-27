/**
 * Direct Tasks Import Script - Uses the same working API as our test
 * SDK 5.x / API 2025-09-03
 */
import { Client } from '@notionhq/client';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// Load config from AppData
const configPath = path.join(
  process.env.APPDATA || '',
  'NotionTasksWidget',
  'notion-widget.config.json'
);

const dbPath = path.join(
  process.env.APPDATA || '',
  'NotionTasksWidget',
  'notion-widget.sqlite'
);

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  Direct Tasks Import - SDK 5.x / API 2025-09-03              ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

console.log(`Config: ${configPath}`);
console.log(`Database: ${dbPath}\n`);

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const API_KEY = config.tasks?.apiKey;
const DB_ID = config.tasks?.databaseId?.replace(/-/g, '');
const COMPLETED_STATUS = config.tasks?.completedStatus || '✅';
const STATUS_PROPERTY = config.tasks?.statusProperty || 'Status';

if (!API_KEY || !DB_ID) {
  console.error('Missing API key or database ID in config');
  process.exit(1);
}

const client = new Client({ 
  auth: API_KEY,
  timeoutMs: 120000 // 2 minute timeout
});
const db = new Database(dbPath);

// Initialize schema if needed
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    unique_id TEXT,
    title TEXT,
    status TEXT,
    normalized_status TEXT,
    due_date TEXT,
    due_date_end TEXT,
    url TEXT,
    hard_deadline INTEGER DEFAULT 0,
    urgent INTEGER DEFAULT 0,
    important INTEGER DEFAULT 0,
    main_entry TEXT,
    session_length_minutes INTEGER,
    estimated_length_minutes INTEGER,
    order_value TEXT,
    order_color TEXT,
    project_ids TEXT,
    parent_task_id TEXT,
    recurrence TEXT,
    payload TEXT,
    local_status TEXT DEFAULT 'synced',
    synced_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
  CREATE INDEX IF NOT EXISTS idx_tasks_local_status ON tasks(local_status);
`);
console.log('Schema initialized');

// Cache for data source ID
let cachedDataSourceId: string | null = null;

async function getDataSourceId(): Promise<string> {
  if (cachedDataSourceId) return cachedDataSourceId;
  
  console.log('Getting data source ID...');
  const database = await client.databases.retrieve({ database_id: DB_ID });
  const dataSources = (database as any).data_sources;
  
  if (dataSources && dataSources.length > 0) {
    cachedDataSourceId = dataSources[0].id;
    console.log(`Data source ID: ${cachedDataSourceId?.substring(0, 8)}...`);
  } else {
    cachedDataSourceId = DB_ID;
    console.log('Using database ID as fallback');
  }
  
  return cachedDataSourceId!;
}

function extractTitle(props: any): string {
  for (const [key, value] of Object.entries(props)) {
    if ((value as any).type === 'title') {
      const titleArr = (value as any).title || [];
      return titleArr.map((t: any) => t.plain_text).join('') || 'Untitled';
    }
  }
  return 'Untitled';
}

function extractStatus(props: any, statusProp: string): string | null {
  const prop = props[statusProp];
  if (!prop) return null;
  
  if (prop.type === 'status') {
    return prop.status?.name || null;
  }
  if (prop.type === 'select') {
    return prop.select?.name || null;
  }
  return null;
}

function extractDate(props: any, dateProp: string): string | null {
  const prop = props[dateProp];
  if (!prop || prop.type !== 'date') return null;
  return prop.date?.start || null;
}

async function importTasks() {
  const dataSourceId = await getDataSourceId();
  
  // NO FILTER - import everything
  console.log(`\nImporting ALL tasks (no filter)...\n`);
  
  let cursor: string | undefined;
  let totalImported = 0;
  let batchNum = 0;
  const BATCH_SIZE = 10; // Same as working test
  
  // Prepare upsert statement
  const upsertStmt = db.prepare(`
    INSERT INTO tasks (id, title, status, due_date, url, payload, synced_at, updated_at, local_status)
    VALUES (@id, @title, @status, @due_date, @url, @payload, @synced_at, @updated_at, 'synced')
    ON CONFLICT(id) DO UPDATE SET
      title = @title,
      status = @status,
      due_date = @due_date,
      url = @url,
      payload = @payload,
      synced_at = @synced_at,
      updated_at = @updated_at,
      local_status = 'synced'
  `);
  
  const timestamp = new Date().toISOString();
  
  do {
    batchNum++;
    console.log(`Batch ${batchNum}: Querying...`);
    
    // Query with SORT BY STATUS - no filter
    // This puts active tasks first, completed last
    const response = await (client as any).dataSources.query({
      data_source_id: dataSourceId,
      page_size: BATCH_SIZE,
      start_cursor: cursor,
      sorts: [
        { property: STATUS_PROPERTY, direction: 'ascending' }
      ]
    });
    
    const pageIds = response.results.map((r: any) => r.id);
    console.log(`Batch ${batchNum}: Got ${pageIds.length} page IDs`);
    
    if (pageIds.length === 0) break;
    
    // Retrieve each page
    for (let i = 0; i < pageIds.length; i++) {
      const pageId = pageIds[i];
      
      try {
        const page = await client.pages.retrieve({ page_id: pageId }) as any;
        const props = page.properties || {};
        
        const title = extractTitle(props);
        const status = extractStatus(props, STATUS_PROPERTY);
        const dueDate = extractDate(props, config.tasks?.dateProperty || 'Date');
        
        // Upsert into database
        upsertStmt.run({
          id: pageId,
          title,
          status,
          due_date: dueDate,
          url: page.url || null,
          payload: JSON.stringify(props),
          synced_at: timestamp,
          updated_at: timestamp
        });
        
        totalImported++;
        
        if (totalImported % 50 === 0) {
          console.log(`  Progress: ${totalImported} tasks imported...`);
        }
      } catch (err: any) {
        console.warn(`  Failed to retrieve ${pageId}: ${err.message}`);
      }
      
      // Small delay every 10 pages
      if (i > 0 && i % 10 === 0) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    cursor = response.has_more ? response.next_cursor : undefined;
    
    // Delay between batches
    if (cursor) {
      await new Promise(r => setTimeout(r, 300));
    }
    
  } while (cursor);
  
  console.log(`\n✅ Import complete: ${totalImported} active tasks imported`);
  
  // Show count in DB
  const count = db.prepare('SELECT COUNT(*) as count FROM tasks').get() as any;
  console.log(`Total tasks in database: ${count.count}`);
}

async function main() {
  try {
    await importTasks();
  } catch (err) {
    console.error('Import failed:', err);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();

