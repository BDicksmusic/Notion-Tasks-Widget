/**
 * Sync Tasks from Notion to PostgreSQL
 * Uses the same proven approach as dual-sync.js
 */
import { Client as NotionClient } from '@notionhq/client';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Notion client with extended timeout
const notion = new NotionClient({
  auth: process.env.NOTION_API_KEY,
  timeoutMs: 120000, // 2 minute timeout
});

// Postgres pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'notion_tasks',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Rate-limit friendly helpers (from your dual-sync)
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryNotion<T>(fn: () => Promise<T>, label = 'notion'): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status || err?.code || 0;
      const isTimeout = err?.code === 'notionhq_client_request_timeout' || err?.code === 'ETIMEDOUT';
      const retryAfter = err?.body?.retry_after ? err.body.retry_after * 1000 : 0;
      
      if (status === 429 || isTimeout || (typeof status === 'number' && status >= 500)) {
        const backoff = retryAfter || Math.min(15000, 1000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 500);
        attempt++;
        console.log(`⏳ Retry ${attempt} (${label}) in ${Math.round(backoff/1000)}s due to ${isTimeout ? 'timeout' : status}`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
}

// Fetch all pages with pagination (your proven approach)
async function fetchDatabaseAll(databaseId: string, opts: Record<string, any> = {}) {
  let results: any[] = [];
  let cursor: string | undefined = undefined;
  let pageNum = 0;
  
  do {
    pageNum++;
    console.log(`  📄 Fetching page ${pageNum}...`);
    
    const resp = await retryNotion(() => notion.databases.query({
      database_id: databaseId,
      page_size: 100,
      start_cursor: cursor,
      ...opts
    }), 'db.query');
    
    results = results.concat(resp.results || []);
    cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
    
    console.log(`     Got ${resp.results.length} results (total: ${results.length})`);
    
    // 350ms delay between requests (like your dual-sync)
    if (cursor) await sleep(350);
  } while (cursor);
  
  return results;
}

// Helper to extract text from rich_text
function getTextFromRichText(richText: any): string {
  if (!richText?.rich_text) return '';
  return richText.rich_text.map((t: any) => t.plain_text).join('');
}

// Get Notion settings from env
function getNotionSettings() {
  return {
    titleProperty: process.env.NOTION_TITLE_PROPERTY || 'Name',
    statusProperty: process.env.NOTION_STATUS_PROPERTY || 'Status',
    dateProperty: process.env.NOTION_DATE_PROPERTY || 'Date',
    deadlineProperty: process.env.NOTION_DEADLINE_PROPERTY || 'Hard Deadline?',
    urgentProperty: process.env.NOTION_URGENT_PROPERTY || 'Urgent',
    importantProperty: process.env.NOTION_IMPORTANT_PROPERTY || 'Important',
    mainEntryProperty: process.env.NOTION_MAIN_ENTRY_PROPERTY || 'Main Entry',
    sessionLengthProperty: process.env.NOTION_SESSION_LENGTH_PROPERTY || 'Sess. Length',
    estimatedLengthProperty: process.env.NOTION_ESTIMATED_LENGTH_PROPERTY || 'Est. Length',
    orderProperty: process.env.NOTION_ORDER_PROPERTY || 'Order',
  };
}

// Map a Notion page to a Task object
function mapPageToTask(page: any, settings: ReturnType<typeof getNotionSettings>) {
  const props = page.properties || {};
  
  // Get title
  const titleProp = props[settings.titleProperty];
  const title = titleProp?.title?.[0]?.plain_text || '';
  
  // Get status
  const statusProp = props[settings.statusProperty];
  const status = statusProp?.status?.name || statusProp?.select?.name || '';
  
  // Get date
  const dateProp = props[settings.dateProperty];
  const dueDate = dateProp?.date?.start || null;
  const dueDateEnd = dateProp?.date?.end || null;
  
  // Get deadline
  const deadlineProp = props[settings.deadlineProperty];
  const hardDeadline = deadlineProp?.status?.name || deadlineProp?.select?.name || null;
  
  // Get urgent
  const urgentProp = props[settings.urgentProperty];
  const urgent = urgentProp?.status?.name || urgentProp?.select?.name || null;
  
  // Get important
  const importantProp = props[settings.importantProperty];
  const important = importantProp?.status?.name || importantProp?.select?.name || null;
  
  // Get main entry (rich text)
  const mainEntry = getTextFromRichText(props[settings.mainEntryProperty]);
  
  // Get session length
  const sessionLengthProp = props[settings.sessionLengthProperty];
  const sessionLengthMinutes = sessionLengthProp?.number ?? null;
  
  // Get estimated length
  const estimatedLengthProp = props[settings.estimatedLengthProperty];
  const estimatedLengthMinutes = estimatedLengthProp?.number ?? null;
  
  // Get order
  const orderProp = props[settings.orderProperty];
  const orderValue = orderProp?.number ?? null;
  
  return {
    id: page.id,
    title,
    status,
    normalizedStatus: status?.toLowerCase() || null,
    dueDate,
    dueDateEnd,
    hardDeadline,
    urgent,
    important,
    mainEntry,
    sessionLengthMinutes,
    estimatedLengthMinutes,
    orderValue,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
    syncStatus: 'synced' as const,
    localOnly: false,
  };
}

async function ensureTablesExist() {
  console.log('🔧 Ensuring database tables exist...');
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        client_id VARCHAR(255) PRIMARY KEY,
        notion_id VARCHAR(255) UNIQUE,
        payload JSONB NOT NULL,
        sync_status VARCHAR(50) DEFAULT 'synced',
        last_modified_local BIGINT DEFAULT 0,
        last_modified_notion BIGINT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_notion_id ON tasks(notion_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_sync_status ON tasks(sync_status);
      
      CREATE TABLE IF NOT EXISTS sync_state (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT,
        updated_at BIGINT
      );
    `);
    console.log('✅ Tables ready');
  } finally {
    client.release();
  }
}

async function syncTasks() {
  console.log('\n📋 Syncing Tasks from Notion to PostgreSQL...');
  
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) {
    console.error('❌ NOTION_DATABASE_ID is not set in .env');
    return;
  }
  
  const settings = getNotionSettings();
  const pages = await fetchDatabaseAll(databaseId);
  console.log(`\n✅ Found ${pages.length} tasks in Notion`);
  
  const client = await pool.connect();
  let synced = 0;
  let errors = 0;
  
  try {
    for (const page of pages) {
      try {
        const task = mapPageToTask(page, settings);
        
        // Upsert to Postgres
        await client.query(`
          INSERT INTO tasks (client_id, notion_id, payload, sync_status, last_modified_notion)
          VALUES ($1, $2, $3, 'synced', $4)
          ON CONFLICT (client_id) DO UPDATE SET
            notion_id = EXCLUDED.notion_id,
            payload = EXCLUDED.payload,
            sync_status = 'synced',
            last_modified_notion = EXCLUDED.last_modified_notion
        `, [
          task.id,
          task.id,
          JSON.stringify(task),
          Date.now()
        ]);
        
        synced++;
        if (synced % 50 === 0) {
          console.log(`  ✅ Synced ${synced}/${pages.length} tasks...`);
        }
      } catch (err: any) {
        errors++;
        console.error(`  ❌ Error syncing task ${page.id}: ${err.message}`);
      }
    }
    
    console.log(`\n🎉 Sync complete!`);
    console.log(`   ✅ Synced: ${synced}`);
    if (errors > 0) {
      console.log(`   ❌ Errors: ${errors}`);
    }
    
    // Update sync state
    await client.query(`
      INSERT INTO sync_state (key, value, updated_at)
      VALUES ('tasks_last_sync', $1, $2)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at
    `, [new Date().toISOString(), Date.now()]);
    
  } finally {
    client.release();
  }
}

async function main() {
  console.log('🚀 Notion → PostgreSQL Task Sync');
  console.log('=================================\n');
  
  // Test Postgres connection and ensure tables exist
  try {
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL');
    client.release();
    
    // Create tables if they don't exist
    await ensureTablesExist();
    
    // Show existing count
    const countClient = await pool.connect();
    const result = await countClient.query('SELECT COUNT(*) FROM tasks');
    console.log(`📊 Existing tasks in database: ${result.rows[0].count}`);
    countClient.release();
  } catch (err: any) {
    console.error('❌ Failed to connect to PostgreSQL:', err.message);
    console.log('\n💡 Check your .env file has correct DB_* settings');
    process.exit(1);
  }
  
  // Test Notion connection
  try {
    await notion.users.me({});
    console.log('✅ Connected to Notion API');
  } catch (err: any) {
    console.error('❌ Failed to connect to Notion:', err.message);
    process.exit(1);
  }
  
  await syncTasks();
  
  await pool.end();
  console.log('\n🔌 Database connection closed');
}

main().catch(console.error);

