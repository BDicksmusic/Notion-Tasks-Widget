import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');

async function syncProjects() {
  console.log('=== PROJECT SYNC v2 ===\n');
  
  const configPath = path.join(process.env.APPDATA || '', 'NotionTasksWidget', 'notion-widget.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const apiKey = config.projects?.apiKey || config.tasks?.apiKey;
  const dbId = config.projects?.databaseId;
  
  // Known property names from schema discovery
  const PROPS = {
    title: 'Name',
    status: 'Status',
    startDate: 'Start Date',
    deadline: 'Deadline',
  };

  console.log('📥 Fetching projects...');
  console.log('  API Key:', apiKey?.substring(0, 15) + '...');
  console.log('  Database:', dbId);
  
  const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 100 })
  });

  console.log('  Response status:', response.status);
  
  const data = await response.json() as any;
  
  if (data.object === 'error') {
    console.log('  ❌ ERROR:', data.message);
  }
  
  console.log(`✅ Fetched ${data.results?.length || 0} projects\n`);

  // Connect to SQLite
  const dbPath = 'C:/Users/Brandon/Dropbox/Apps/Notion Tasks Widget/backups/notion-backup.sqlite';
  const db = new Database(dbPath);
  
  db.prepare('DELETE FROM projects').run();

  const upsert = db.prepare(`
    INSERT INTO projects (
      client_id, notion_id, title, status,
      start_date, end_date, url, last_edited,
      payload, sync_status, last_modified_local, last_modified_notion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = Date.now();

  for (const page of data.results || []) {
    const props = page.properties;
    
    // Extract by known property names
    const title = props[PROPS.title]?.title?.[0]?.plain_text || 'Untitled';
    const status = props[PROPS.status]?.status?.name || null;
    const startDate = props[PROPS.startDate]?.date?.start || null;
    const deadline = props[PROPS.deadline]?.date?.start || null;
    const lastEdited = page.last_edited_time || null;

    upsert.run(
      page.id, page.id, title, status,
      startDate, deadline, page.url, lastEdited,
      JSON.stringify({ id: page.id, title, status, startDate, deadline, url: page.url }),
      'synced', now, now
    );
  }

  // Verify
  const count = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
  const breakdown = db.prepare('SELECT status, COUNT(*) as c FROM projects GROUP BY status ORDER BY c DESC').all() as any[];
  const withDates = db.prepare('SELECT COUNT(*) as c FROM projects WHERE start_date IS NOT NULL').get() as { c: number };
  const withEdited = db.prepare('SELECT COUNT(*) as c FROM projects WHERE last_edited IS NOT NULL').get() as { c: number };

  console.log(`📊 Results:`);
  console.log(`  Total: ${count.c} projects`);
  console.log(`  With start_date: ${withDates.c}`);
  console.log(`  With last_edited: ${withEdited.c}`);
  console.log(`\n  Status breakdown:`);
  breakdown.forEach(r => console.log(`    ${r.status || 'NULL'}: ${r.c}`));

  console.log('\n📋 Sample:');
  const sample = db.prepare('SELECT title, status, start_date, end_date, last_edited FROM projects LIMIT 5').all() as any[];
  sample.forEach((p, i) => {
    console.log(`  ${i+1}. "${p.title?.substring(0, 35)}..."`);
    console.log(`     Status: ${p.status} | Start: ${p.start_date || '-'} | End: ${p.end_date || '-'}`);
    console.log(`     Last edited: ${p.last_edited}`);
  });

  db.close();
  console.log('\n✅ Done!');
}

syncProjects().catch(e => console.error('Error:', e));


import Database = require('better-sqlite3');

async function syncProjects() {
  console.log('=== PROJECT SYNC v2 ===\n');
  
  const configPath = path.join(process.env.APPDATA || '', 'NotionTasksWidget', 'notion-widget.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const apiKey = config.projects?.apiKey || config.tasks?.apiKey;
  const dbId = config.projects?.databaseId;
  
  // Known property names from schema discovery
  const PROPS = {
    title: 'Name',
    status: 'Status',
    startDate: 'Start Date',
    deadline: 'Deadline',
  };

  console.log('📥 Fetching projects...');
  console.log('  API Key:', apiKey?.substring(0, 15) + '...');
  console.log('  Database:', dbId);
  
  const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 100 })
  });

  console.log('  Response status:', response.status);
  
  const data = await response.json() as any;
  
  if (data.object === 'error') {
    console.log('  ❌ ERROR:', data.message);
  }
  
  console.log(`✅ Fetched ${data.results?.length || 0} projects\n`);

  // Connect to SQLite
  const dbPath = 'C:/Users/Brandon/Dropbox/Apps/Notion Tasks Widget/backups/notion-backup.sqlite';
  const db = new Database(dbPath);
  
  db.prepare('DELETE FROM projects').run();

  const upsert = db.prepare(`
    INSERT INTO projects (
      client_id, notion_id, title, status,
      start_date, end_date, url, last_edited,
      payload, sync_status, last_modified_local, last_modified_notion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = Date.now();

  for (const page of data.results || []) {
    const props = page.properties;
    
    // Extract by known property names
    const title = props[PROPS.title]?.title?.[0]?.plain_text || 'Untitled';
    const status = props[PROPS.status]?.status?.name || null;
    const startDate = props[PROPS.startDate]?.date?.start || null;
    const deadline = props[PROPS.deadline]?.date?.start || null;
    const lastEdited = page.last_edited_time || null;

    upsert.run(
      page.id, page.id, title, status,
      startDate, deadline, page.url, lastEdited,
      JSON.stringify({ id: page.id, title, status, startDate, deadline, url: page.url }),
      'synced', now, now
    );
  }

  // Verify
  const count = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
  const breakdown = db.prepare('SELECT status, COUNT(*) as c FROM projects GROUP BY status ORDER BY c DESC').all() as any[];
  const withDates = db.prepare('SELECT COUNT(*) as c FROM projects WHERE start_date IS NOT NULL').get() as { c: number };
  const withEdited = db.prepare('SELECT COUNT(*) as c FROM projects WHERE last_edited IS NOT NULL').get() as { c: number };

  console.log(`📊 Results:`);
  console.log(`  Total: ${count.c} projects`);
  console.log(`  With start_date: ${withDates.c}`);
  console.log(`  With last_edited: ${withEdited.c}`);
  console.log(`\n  Status breakdown:`);
  breakdown.forEach(r => console.log(`    ${r.status || 'NULL'}: ${r.c}`));

  console.log('\n📋 Sample:');
  const sample = db.prepare('SELECT title, status, start_date, end_date, last_edited FROM projects LIMIT 5').all() as any[];
  sample.forEach((p, i) => {
    console.log(`  ${i+1}. "${p.title?.substring(0, 35)}..."`);
    console.log(`     Status: ${p.status} | Start: ${p.start_date || '-'} | End: ${p.end_date || '-'}`);
    console.log(`     Last edited: ${p.last_edited}`);
  });

  db.close();
  console.log('\n✅ Done!');
}

syncProjects().catch(e => console.error('Error:', e));

