/**
 * Test Notion Search API as alternative to database.query
 * Search API might handle complex databases better
 */
require('dotenv').config();
const { Client } = require('@notionhq/client');

async function main() {
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  const dbId = process.env.NOTION_DATABASE_ID;
  
  console.log('=== Testing Notion Search API ===\n');
  
  // Test 1: Search API with database filter
  console.log('Test 1: Search API with database filter...');
  try {
    const start = Date.now();
    const results = await notion.search({
      filter: {
        property: 'object',
        value: 'page'
      },
      page_size: 20
    });
    console.log(`  ✓ Success in ${Date.now() - start}ms`);
    console.log(`  Got ${results.results.length} pages, has_more: ${results.has_more}`);
    
    // Check how many are from our database
    const fromOurDb = results.results.filter(p => 
      p.parent?.database_id?.replace(/-/g, '') === dbId.replace(/-/g, '')
    );
    console.log(`  ${fromOurDb.length} from our tasks database`);
  } catch (e) {
    console.log(`  ✗ Failed: ${e.message}`);
  }
  
  // Test 2: Search with query text
  console.log('\nTest 2: Search for "Band Book"...');
  try {
    const start = Date.now();
    const results = await notion.search({
      query: 'Band Book',
      filter: {
        property: 'object',
        value: 'page'
      },
      page_size: 10
    });
    console.log(`  ✓ Success in ${Date.now() - start}ms`);
    console.log(`  Got ${results.results.length} results`);
    results.results.forEach(p => {
      const title = p.properties?.Name?.title?.[0]?.plain_text || 
                    p.properties?.title?.title?.[0]?.plain_text ||
                    'No title';
      console.log(`  - ${title}`);
    });
  } catch (e) {
    console.log(`  ✗ Failed: ${e.message}`);
  }
  
  // Test 3: Paginate through search results
  console.log('\nTest 3: Paginate through 100 results (5 pages of 20)...');
  try {
    let cursor = undefined;
    let totalPages = 0;
    let totalResults = 0;
    const startTotal = Date.now();
    
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      const results = await notion.search({
        filter: {
          property: 'object',
          value: 'page'
        },
        page_size: 20,
        start_cursor: cursor
      });
      
      totalPages++;
      totalResults += results.results.length;
      cursor = results.next_cursor;
      
      console.log(`  Page ${i + 1}: ${results.results.length} results in ${Date.now() - start}ms`);
      
      if (!results.has_more) {
        console.log(`  (No more results)`);
        break;
      }
      
      // Small delay
      await new Promise(r => setTimeout(r, 300));
    }
    
    console.log(`  Total: ${totalResults} results in ${totalPages} pages (${Date.now() - startTotal}ms)`);
  } catch (e) {
    console.log(`  ✗ Failed at some point: ${e.message}`);
  }
  
  console.log('\n=== Done ===');
}

main().catch(console.error);





