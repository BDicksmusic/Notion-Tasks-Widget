/**
 * Import a single task directly by its Notion page ID
 * Usage: node scripts/import-single-task.js <page-id>
 */
require('dotenv').config();
const { Client } = require('@notionhq/client');

const pageId = process.argv[2] || '2af8cc9f-36f1-802c-a8e1-e27c32330e4e';

async function main() {
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  
  console.log('=== Fetching Task from Notion ===');
  console.log('Page ID:', pageId);
  
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    
    console.log('\n✓ Task found in Notion:');
    console.log('  Title:', page.properties?.Name?.title?.[0]?.plain_text || 'N/A');
    console.log('  Status:', page.properties?.Status?.status?.name || 'N/A');
    console.log('  Date:', page.properties?.Date?.date?.start || 'N/A');
    console.log('  ID:', page.id);
    console.log('  Last edited:', page.last_edited_time);
    
    // Output in format that can be used to manually add to DB
    console.log('\n=== Task Data for Import ===');
    const taskData = {
      id: page.id,
      name: page.properties?.Name?.title?.[0]?.plain_text || '',
      status: page.properties?.Status?.status?.name || '',
      dueDate: page.properties?.Date?.date?.start || null,
      urgent: page.properties?.Urgent?.status?.name || null,
      important: page.properties?.Important?.status?.name || null,
      mainEntry: page.properties?.['Main Entry']?.rich_text?.[0]?.plain_text || null,
      lastEditedTime: page.last_edited_time
    };
    console.log(JSON.stringify(taskData, null, 2));
    
    console.log('\n✅ To add this task to your local database:');
    console.log('   1. Open Settings in the app');
    console.log('   2. Click "Reset" to clear import state');
    console.log('   3. The next import will fetch all tasks fresh');
    
  } catch (err) {
    console.log('✗ Failed to fetch task:', err.message);
  }
}

main().catch(console.error);





