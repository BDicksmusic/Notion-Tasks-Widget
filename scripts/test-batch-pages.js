/**
 * Test fetching pages individually by ID
 * If this works reliably, we can use it as the import strategy
 */
require('dotenv').config();
const { Client } = require('@notionhq/client');

async function main() {
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  const dbId = process.env.NOTION_DATABASE_ID;
  
  console.log('=== Testing Individual Page Fetches ===\n');
  
  // First, get a list of page IDs using a minimal query
  console.log('Step 1: Get page IDs with minimal query (page_size=1, multiple times)...');
  const pageIds = [];
  let cursor = undefined;
  
  for (let i = 0; i < 10; i++) {
    try {
      const start = Date.now();
      const result = await notion.databases.query({
        database_id: dbId,
        page_size: 1,  // Absolute minimum
        start_cursor: cursor
      });
      
      if (result.results.length > 0) {
        pageIds.push(result.results[0].id);
        console.log(`  Query ${i + 1}: got ID ${result.results[0].id.substring(0, 8)}... in ${Date.now() - start}ms`);
      }
      
      cursor = result.next_cursor;
      if (!cursor) break;
      
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.log(`  Query ${i + 1} failed: ${e.message}`);
      break;
    }
  }
  
  console.log(`\nCollected ${pageIds.length} page IDs\n`);
  
  // Now fetch each page individually
  console.log('Step 2: Fetch each page individually using pages.retrieve...');
  let successCount = 0;
  let failCount = 0;
  const tasks = [];
  
  for (const pageId of pageIds) {
    try {
      const start = Date.now();
      const page = await notion.pages.retrieve({ page_id: pageId });
      
      const title = page.properties?.Name?.title?.[0]?.plain_text || 'No title';
      const status = page.properties?.Status?.status?.name || 'N/A';
      
      tasks.push({ id: pageId, title, status });
      successCount++;
      console.log(`  ✓ ${pageId.substring(0, 8)}: "${title.substring(0, 30)}" (${Date.now() - start}ms)`);
      
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      failCount++;
      console.log(`  ✗ ${pageId.substring(0, 8)}: ${e.message}`);
    }
  }
  
  console.log(`\n=== Results ===`);
  console.log(`Success: ${successCount}, Failed: ${failCount}`);
  console.log(`\nThis approach ${successCount === pageIds.length ? 'WORKS' : 'has issues'}!`);
  
  if (successCount > 0) {
    console.log(`\nSample tasks fetched:`);
    tasks.slice(0, 5).forEach(t => {
      console.log(`  - ${t.title} (${t.status})`);
    });
  }
}

main().catch(console.error);





