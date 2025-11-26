/**
 * Simple test script to verify basic Notion API pagination works.
 * This bypasses all our wrapper logic to isolate the issue.
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

const client = new Client({ 
  auth: NOTION_API_KEY,
  timeoutMs: 60000 // 60 second timeout
});

async function testSimplePagination() {
  console.log('=== SIMPLE NOTION API PAGINATION TEST ===');
  console.log(`Database ID: ${DATABASE_ID}`);
  console.log('');

  let cursor: string | undefined = undefined;
  let pageCount = 0;
  let totalResults = 0;
  const PAGE_SIZE = 100; // Maximum allowed by Notion
  const DELAY_BETWEEN_REQUESTS = 500; // 500ms between requests (well under 3/sec limit)

  try {
    do {
      pageCount++;
      console.log(`\n--- Page ${pageCount} ---`);
      console.log(`Cursor: ${cursor ? cursor.substring(0, 12) + '...' : 'START'}`);
      
      const startTime = Date.now();
      
      // Simple query - NO filter_properties, NO filters, just basic pagination
      const response = await client.databases.query({
        database_id: DATABASE_ID,
        page_size: PAGE_SIZE,
        ...(cursor && { start_cursor: cursor })
      });
      
      const duration = Date.now() - startTime;
      totalResults += response.results.length;
      
      console.log(`Results: ${response.results.length}`);
      console.log(`Has more: ${response.has_more}`);
      console.log(`Next cursor: ${response.next_cursor ? 'yes' : 'no'}`);
      console.log(`Duration: ${duration}ms`);
      console.log(`Total so far: ${totalResults}`);
      
      cursor = response.next_cursor ?? undefined;
      
      // Wait between requests to avoid rate limits
      if (cursor) {
        console.log(`Waiting ${DELAY_BETWEEN_REQUESTS}ms before next request...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
      }
      
    } while (cursor);
    
    console.log('\n=== SUCCESS ===');
    console.log(`Total pages fetched: ${pageCount}`);
    console.log(`Total results: ${totalResults}`);
    
  } catch (error) {
    console.error('\n=== ERROR ===');
    console.error(`Failed on page ${pageCount}`);
    console.error(`Total results before failure: ${totalResults}`);
    console.error('Error:', error);
  }
}

testSimplePagination();





