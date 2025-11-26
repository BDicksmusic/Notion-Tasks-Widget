require('dotenv').config();
const { Client } = require('@notionhq/client');

const TARGET_PAGE_ID = '2af8cc9f-36f1-802c-a8e1-e27c32330e4e';

async function main() {
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  
  console.log('=== Testing Different Query Strategies ===\n');
  
  // Strategy 1: Search for "Work on"
  console.log('1. Searching for "Work on":');
  try {
    const r1 = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID,
      filter: { property: 'Name', title: { contains: 'Work on' } },
      page_size: 5
    });
    console.log(`   Found ${r1.results.length} results`);
    r1.results.slice(0, 3).forEach(p => {
      console.log(`   - "${p.properties?.Name?.title?.[0]?.plain_text}"`);
    });
  } catch (e) { console.log('   Error:', e.message); }

  // Strategy 2: Search for "Band Book" (no Master)
  console.log('\n2. Searching for "Band Book":');
  try {
    const r2 = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID,
      filter: { property: 'Name', title: { contains: 'Band Book' } },
      page_size: 5
    });
    console.log(`   Found ${r2.results.length} results`);
    r2.results.forEach(p => {
      console.log(`   - [${p.id}] "${p.properties?.Name?.title?.[0]?.plain_text}"`);
    });
  } catch (e) { console.log('   Error:', e.message); }

  // Strategy 3: Get first page of unfiltered results
  console.log('\n3. First page of ALL tasks (no filter):');
  try {
    const r3 = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID,
      page_size: 100
    });
    console.log(`   Got ${r3.results.length} tasks, has_more: ${r3.has_more}`);
    
    // Check if our target is in the first page
    const found = r3.results.find(p => p.id === TARGET_PAGE_ID);
    console.log(`   Target page in first 100: ${found ? 'YES!' : 'No'}`);
  } catch (e) { console.log('   Error:', e.message); }

  // Strategy 4: Filter by today's date
  console.log('\n4. Tasks with date = 2025-11-24:');
  try {
    const r4 = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID,
      filter: { property: 'Date', date: { equals: '2025-11-24' } },
      page_size: 50
    });
    console.log(`   Found ${r4.results.length} tasks for today`);
    
    const found = r4.results.find(p => p.id === TARGET_PAGE_ID);
    console.log(`   Target page in today's tasks: ${found ? 'YES!' : 'No'}`);
    
    if (found) {
      console.log(`   - "${found.properties?.Name?.title?.[0]?.plain_text}"`);
    }
  } catch (e) { console.log('   Error:', e.message); }

  // Strategy 5: Tasks with To-Do status
  console.log('\n5. Tasks with Status = 📋 (To-Do):');
  try {
    const r5 = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID,
      filter: { property: 'Status', status: { equals: '📋' } },
      page_size: 100
    });
    console.log(`   Found ${r5.results.length} To-Do tasks`);
    
    const found = r5.results.find(p => p.id === TARGET_PAGE_ID);
    console.log(`   Target page in To-Do tasks: ${found ? 'YES!' : 'No'}`);
  } catch (e) { console.log('   Error:', e.message); }
}

main().catch(console.error);
