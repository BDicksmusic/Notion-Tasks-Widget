/**
 * Fetch Projects database schema to identify property names
 * This helps configure the Projects widget correctly
 */
import { Client } from '@notionhq/client';
import * as dotenv from 'dotenv';

dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_PROJECTS_API_KEY || process.env.NOTION_API_KEY,
});

async function getProjectsSchema() {
  // Use the projects database ID from env, or fall back to the default
  const databaseId = process.env.NOTION_PROJECTS_DATABASE_ID || 'e78e95ea6b7c456caa88b5b2a7cbd74f';
  
  if (!databaseId) {
    console.error('❌ NOTION_PROJECTS_DATABASE_ID not set in .env');
    return;
  }
  
  console.log('📊 Fetching Projects database schema...');
  console.log(`   Database ID: ${databaseId}\n`);
  
  try {
    const database = await notion.databases.retrieve({ database_id: databaseId });
    
    const properties = database.properties;
    
    console.log('='.repeat(60));
    console.log('ALL PROPERTIES');
    console.log('='.repeat(60));
    
    const statusProps: string[] = [];
    const selectProps: string[] = [];
    
    for (const [name, prop] of Object.entries(properties)) {
      const type = (prop as any).type;
      const id = (prop as any).id;
      
      console.log(`  "${name}" => type: ${type}, id: "${id}"`);
      
      // Track status and select properties
      if (type === 'status') {
        statusProps.push(name);
        // Show status options
        const options = (prop as any).status?.options || [];
        if (options.length > 0) {
          console.log(`      └─ Options: ${options.map((o: any) => o.name).join(', ')}`);
        }
      } else if (type === 'select') {
        selectProps.push(name);
        // Show select options
        const options = (prop as any).select?.options || [];
        if (options.length > 0) {
          console.log(`      └─ Options: ${options.map((o: any) => o.name).join(', ')}`);
        }
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('RECOMMENDED CONFIGURATION');
    console.log('='.repeat(60));
    
    // Find title property
    const titleProp = Object.entries(properties).find(([_, p]) => (p as any).type === 'title');
    if (titleProp) {
      console.log(`  Title Property:       "${titleProp[0]}"`);
    }
    
    // Suggest status property
    if (statusProps.length > 0) {
      console.log(`  Status Property:      "${statusProps[0]}" (type: status)`);
    } else if (selectProps.length > 0) {
      console.log(`  Status Property:      "${selectProps[0]}" (type: select) - consider using this for status`);
    } else {
      console.log(`  Status Property:      ⚠️ No status or select property found!`);
    }
    
    // Find date properties
    const dateProps = Object.entries(properties)
      .filter(([_, p]) => (p as any).type === 'date')
      .map(([name]) => name);
    if (dateProps.length > 0) {
      console.log(`  Date Properties:      ${dateProps.join(', ')}`);
    }
    
    // Find rich_text for description
    const textProps = Object.entries(properties)
      .filter(([_, p]) => (p as any).type === 'rich_text')
      .map(([name]) => name);
    if (textProps.length > 0) {
      console.log(`  Description Property: "${textProps[0]}" (or choose from: ${textProps.join(', ')})`);
    }
    
    // Find multi_select for tags
    const multiSelectProps = Object.entries(properties)
      .filter(([_, p]) => (p as any).type === 'multi_select')
      .map(([name]) => name);
    if (multiSelectProps.length > 0) {
      console.log(`  Tags Property:        "${multiSelectProps[0]}" (or choose from: ${multiSelectProps.join(', ')})`);
    }
    
    console.log('\n📋 Copy these values to Control Center → Projects section');
    
  } catch (error: any) {
    if (error.code === 'object_not_found') {
      console.error('❌ Database not found. Check your NOTION_PROJECTS_DATABASE_ID');
    } else if (error.code === 'unauthorized') {
      console.error('❌ Unauthorized. Check your API key has access to this database');
    } else {
      console.error('❌ Error:', error.message);
    }
  }
}

getProjectsSchema().catch(console.error);



