/**
 * Test the absolute minimum Notion query to see if it works
 */
require('dotenv').config();
const { Client } = require('@notionhq/client');

async function main() {
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  const dbId = process.env.NOTION_DATABASE_ID;
  
  console.log('=== Minimal Query Test ===\n');
  
  // Test 1: Absolute minimum - page_size 1, no filters
  console.log('Test 1: page_size=1, no filter...');
  try {
    const start = Date.now();
    const r1 = await notion.databases.query({
      database_id: dbId,
      page_size: 1
    });
    console.log(`  ✓ Success in ${Date.now() - start}ms, got ${r1.results.length} result`);
  } catch (e) {
    console.log(`  ✗ Failed: ${e.message}`);
  }
  
  // Test 2: page_size 10, no filter
  console.log('\nTest 2: page_size=10, no filter...');
  try {
    const start = Date.now();
    const r2 = await notion.databases.query({
      database_id: dbId,
      page_size: 10
    });
    console.log(`  ✓ Success in ${Date.now() - start}ms, got ${r2.results.length} results`);
  } catch (e) {
    console.log(`  ✗ Failed: ${e.message}`);
  }
  
  // Test 3: page_size 10 WITH status filter
  console.log('\nTest 3: page_size=10 with status=📋 filter...');
  try {
    const start = Date.now();
    const r3 = await notion.databases.query({
      database_id: dbId,
      page_size: 10,
      filter: {
        property: 'Status',
        status: { equals: '📋' }
      }
    });
    console.log(`  ✓ Success in ${Date.now() - start}ms, got ${r3.results.length} results`);
  } catch (e) {
    console.log(`  ✗ Failed: ${e.message}`);
  }
  
  // Test 4: page_size 10 with filter_properties (minimal)
  console.log('\nTest 4: page_size=10, filter_properties=[title only]...');
  try {
    // First get the title property ID
    const schema = await notion.databases.retrieve({ database_id: dbId });
    const titlePropId = Object.entries(schema.properties).find(
      ([, prop]) => prop.type === 'title'
    )?.[1]?.id;
    
    const start = Date.now();
    const r4 = await notion.databases.query({
      database_id: dbId,
      page_size: 10,
      filter_properties: titlePropId ? [titlePropId] : undefined
    });
    console.log(`  ✓ Success in ${Date.now() - start}ms, got ${r4.results.length} results`);
  } catch (e) {
    console.log(`  ✗ Failed: ${e.message}`);
  }
  
  console.log('\n=== Done ===');
}

main().catch(console.error);





