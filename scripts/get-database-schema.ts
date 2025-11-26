/**
 * Fetch database schema to identify property IDs
 * This helps us use filter_properties for faster queries
 */
import { Client } from '@notionhq/client';
import * as dotenv from 'dotenv';

dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

async function getDatabaseSchema() {
  const databaseId = process.env.NOTION_DATABASE_ID;
  
  if (!databaseId) {
    console.error('❌ NOTION_DATABASE_ID not set in .env');
    return;
  }
  
  console.log('📊 Fetching database schema...\n');
  
  const database = await notion.databases.retrieve({ database_id: databaseId });
  
  const properties = database.properties;
  
  // Categorize properties
  const essential: { name: string; id: string; type: string }[] = [];
  const rollups: { name: string; id: string; type: string }[] = [];
  const formulas: { name: string; id: string; type: string }[] = [];
  const relations: { name: string; id: string; type: string }[] = [];
  const other: { name: string; id: string; type: string }[] = [];
  
  for (const [name, prop] of Object.entries(properties)) {
    const entry = { name, id: (prop as any).id, type: (prop as any).type };
    
    switch ((prop as any).type) {
      case 'rollup':
        rollups.push(entry);
        break;
      case 'formula':
        formulas.push(entry);
        break;
      case 'relation':
        relations.push(entry);
        break;
      case 'title':
      case 'status':
      case 'select':
      case 'multi_select':
      case 'date':
      case 'checkbox':
      case 'number':
      case 'rich_text':
      case 'url':
      case 'email':
      case 'phone_number':
      case 'created_time':
      case 'last_edited_time':
      case 'created_by':
      case 'last_edited_by':
        essential.push(entry);
        break;
      default:
        other.push(entry);
    }
  }
  
  console.log('='.repeat(60));
  console.log('ESSENTIAL PROPERTIES (these we want to fetch)');
  console.log('='.repeat(60));
  for (const p of essential) {
    console.log(`  "${p.name}" => id: "${p.id}" (${p.type})`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('ROLLUPS (skip - we can compute locally)');
  console.log('='.repeat(60));
  for (const p of rollups) {
    console.log(`  "${p.name}" => id: "${p.id}"`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('FORMULAS (skip - we can compute locally)');
  console.log('='.repeat(60));
  for (const p of formulas) {
    console.log(`  "${p.name}" => id: "${p.id}"`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('RELATIONS (skip - cause timeouts)');
  console.log('='.repeat(60));
  for (const p of relations) {
    console.log(`  "${p.name}" => id: "${p.id}"`);
  }
  
  if (other.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('OTHER');
    console.log('='.repeat(60));
    for (const p of other) {
      console.log(`  "${p.name}" => id: "${p.id}" (${p.type})`);
    }
  }
  
  // Output the IDs we should use
  console.log('\n' + '='.repeat(60));
  console.log('FILTER_PROPERTIES ARRAY (copy this):');
  console.log('='.repeat(60));
  const ids = essential.map(p => p.id);
  console.log(JSON.stringify(ids, null, 2));
  
  console.log('\n📊 Summary:');
  console.log(`   Essential: ${essential.length}`);
  console.log(`   Rollups:   ${rollups.length} (skipping)`);
  console.log(`   Formulas:  ${formulas.length} (skipping)`);
  console.log(`   Relations: ${relations.length} (skipping)`);
  console.log(`   Other:     ${other.length}`);
  console.log(`   Total:     ${Object.keys(properties).length}`);
}

getDatabaseSchema().catch(console.error);





