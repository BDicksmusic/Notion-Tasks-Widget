/**
 * Test Notion pagination using the same approach as your working dual-sync script
 */
import { Client } from '@notionhq/client';
import * as dotenv from 'dotenv';

dotenv.config();

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

if (!NOTION_API_KEY || !DATABASE_ID) {
  console.error('Missing NOTION_API_KEY or NOTION_DATABASE_ID in .env');
  process.exit(1);
}

// Simple client like yours - no timeout override
const notion = new Client({
  auth: NOTION_API_KEY,
});

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Your retry logic - handles 429 and 5xx with exponential backoff
async function retryNotion<T>(fn: () => Promise<T>, label = 'notion'): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status || err?.code || 0;
      const retryAfter = err?.body?.retry_after ? err.body.retry_after * 1000 : 0;
      
      if (status === 429 || (typeof status === 'number' && status >= 500)) {
        const backoff = retryAfter || Math.min(8000, 500 * Math.pow(2, attempt)) + Math.floor(Math.random() * 200);
        attempt++;
        console.log(`⏳ Retry ${attempt} (${label}) in ${backoff}ms due to ${status}`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
}

// Your fetchDatabaseAll approach
async function fetchDatabaseAll(databaseId: string) {
  let results: any[] = [];
  let cursor: string | undefined = undefined;
  let pageNum = 0;
  
  do {
    pageNum++;
    const startTime = Date.now();
    console.log(`\n--- Page ${pageNum} ---`);
    console.log(`Cursor: ${cursor ? cursor.substring(0, 12) + '...' : 'START'}`);
    
    const resp = await retryNotion(() => notion.databases.query({
      database_id: databaseId,
      page_size: 100,  // Max size like your script
      start_cursor: cursor,
    }), 'db.query');
    
    const duration = Date.now() - startTime;
    results = results.concat(resp.results || []);
    cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
    
    console.log(`Results: ${resp.results.length}`);
    console.log(`Has more: ${resp.has_more}`);
    console.log(`Duration: ${duration}ms`);
    console.log(`Total so far: ${results.length}`);
    
    // 350ms delay like your script
    if (cursor) {
      console.log('Waiting 350ms before next request...');
      await sleep(350);
    }
  } while (cursor);
  
  return results;
}

async function main() {
  console.log('=== TESTING NOTION API (YOUR APPROACH) ===');
  console.log(`Database ID: ${DATABASE_ID}`);
  console.log('Using: page_size=100, 350ms delay, infinite retry on 5xx');
  console.log('');
  
  try {
    const allResults = await fetchDatabaseAll(DATABASE_ID!);
    console.log('\n=== SUCCESS ===');
    console.log(`Total results: ${allResults.length}`);
  } catch (error) {
    console.error('\n=== ERROR ===');
    console.error('Error:', error);
  }
}

main();





