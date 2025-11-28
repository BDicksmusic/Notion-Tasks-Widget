import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');

/**
 * Sync ACTIVE Projects Only (not Done)
 * With timing and persistent retry
 */

const PAGE_SIZE = 20;
const MAX_RETRIES = 5;  // More retries to handle 504s
const RETRY_DELAY_MS = 3000;  // Longer delay

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 503 || response.status === 504 || response.status === 429) {
        if (attempt < retries) {
          const wait = RETRY_DELAY_MS * attempt;
          console.log(`    ⏳ Attempt ${attempt}/${retries}: ${response.status}, waiting ${wait/1000}s...`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
      }
      
      return response;
    } catch (error: any) {
      if (attempt < retries) {
        const wait = RETRY_DELAY_MS * attempt;
        console.log(`    ⏳ Attempt ${attempt}/${retries}: ${error.message}, waiting ${wait/1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

async function syncActiveProjects() {
  const startTime = Date.now();
  
  console.log('=== SYNC ACTIVE PROJECTS ===');
  console.log(`    Started: ${new Date().toLocaleTimeString()}\n`);
  
  const configPath = path.join(process.env.APPDATA || '', 'NotionTasksWidget', 'notion-widget.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const apiKey = config.projects?.apiKey || config.tasks?.apiKey;
  const dbId = config.projects?.databaseId;
  
  const PROPS = {
    title: config.projects?.titleProperty || 'Name',
    status: config.projects?.statusProperty || 'Status',
    startDate: config.projects?.startDateProperty || 'Start Date',
    deadline: config.projects?.endDateProperty || 'Deadline',
    actionsRelation: config.projects?.actionsRelationProperty || 'Actions',
  };
  
  const completedStatus = config.projects?.completedStatus || 'Done';
  
  console.log(`📋 Filter: Status != "${completedStatus}"`);

  const dbPath = 'C:/Users/Brandon/Dropbox/Apps/Notion Tasks Widget/backups/notion-backup.sqlite';
  const db = new Database(dbPath);
  
  db.prepare('DELETE FROM projects').run();
  db.prepare('DELETE FROM task_project_links').run();  // Clear relations too

  const upsert = db.prepare(`
    INSERT INTO projects (
      client_id, notion_id, title, status,
      start_date, end_date, url, last_edited,
      payload, sync_status, last_modified_local, last_modified_notion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)
  `);

  // Insert task→project links (from project's "Actions" relation)
  const insertTaskProjectLink = db.prepare(`
    INSERT OR IGNORE INTO task_project_links (task_id, project_id)
    VALUES (?, ?)
  `);

  const now = Date.now();
  let totalFetched = 0;
  let cursor: string | null = null;
  let pageNum = 0;
  let retryCount = 0;

  console.log('\n📥 Fetching...\n');

  do {
    pageNum++;
    
    const body: any = { 
      page_size: PAGE_SIZE,
      filter: {
        property: PROPS.status,
        status: {
          does_not_equal: completedStatus
        }
      }
    };
    if (cursor) body.start_cursor = cursor;

    const pageStart = Date.now();
    
    try {
      const response = await fetchWithRetry(
        `https://api.notion.com/v1/databases/${dbId}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body)
        }
      );

      const pageTime = ((Date.now() - pageStart) / 1000).toFixed(1);

      if (!response.ok) {
        console.log(`    ❌ Page ${pageNum} failed after ${pageTime}s`);
        break;
      }

      const data = await response.json() as any;
      const results = data.results || [];
      
      console.log(`    ✅ Page ${pageNum}: ${results.length} projects (${pageTime}s)`);

      for (const page of results) {
        const props = page.properties;
        
        const title = props[PROPS.title]?.title?.[0]?.plain_text || 'Untitled';
        const status = props[PROPS.status]?.status?.name || null;
        const startDate = props[PROPS.startDate]?.date?.start || null;
        const deadline = props[PROPS.deadline]?.date?.start || null;
        const lastEdited = page.last_edited_time || null;

        upsert.run(
          page.id, page.id, title, status,
          startDate, deadline, page.url, lastEdited,
          'synced', now, now
        );
        totalFetched++;

        // Extract task relations from "Actions" property
        const actionsRelation = props[PROPS.actionsRelation];
        if (actionsRelation?.type === 'relation' && actionsRelation.relation?.length > 0) {
          for (const rel of actionsRelation.relation) {
            insertTaskProjectLink.run(rel.id, page.id);  // task_id, project_id
          }
        }
      }

      cursor = data.has_more ? data.next_cursor : null;
      
      if (cursor) {
        await new Promise(r => setTimeout(r, 500));
      }
      
    } catch (error: any) {
      console.log(`    ❌ Page ${pageNum} error: ${error.message}`);
      retryCount++;
      if (retryCount > 3) break;  // Give up after too many page failures
    }
    
  } while (cursor);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Results
  console.log('\n' + '═'.repeat(50));
  console.log('📊 SYNC COMPLETE');
  console.log('═'.repeat(50));
  
  const count = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
  const relationCount = db.prepare('SELECT COUNT(*) as c FROM task_project_links').get() as { c: number };
  console.log(`    Total synced: ${count.c} projects`);
  console.log(`    Task↔Project links: ${relationCount.c}`);
  console.log(`    Time elapsed: ${totalTime}s`);

  const breakdown = db.prepare('SELECT status, COUNT(*) as c FROM projects GROUP BY status ORDER BY c DESC').all() as any[];
  console.log('\n    Status breakdown:');
  breakdown.forEach(r => console.log(`      ${r.status || 'NULL'}: ${r.c}`));

  const withDates = db.prepare('SELECT COUNT(*) as c FROM projects WHERE start_date IS NOT NULL OR end_date IS NOT NULL').get() as { c: number };
  console.log(`\n    With dates: ${withDates.c}`);

  console.log('\n📋 Projects by deadline:');
  const sample = db.prepare(`
    SELECT title, status, end_date 
    FROM projects 
    WHERE end_date IS NOT NULL 
    ORDER BY end_date ASC 
    LIMIT 10
  `).all() as any[];
  sample.forEach((p, i) => {
    console.log(`    ${i+1}. [${p.status}] ${p.end_date} - "${p.title?.substring(0, 30)}..."`);
  });

  db.close();
  console.log(`\n✅ Done in ${totalTime}s!`);
}

syncActiveProjects().catch(e => console.error('Error:', e));

import Database = require('better-sqlite3');

/**
 * Sync ACTIVE Projects Only (not Done)
 * With timing and persistent retry
 */

const PAGE_SIZE = 20;
const MAX_RETRIES = 5;  // More retries to handle 504s
const RETRY_DELAY_MS = 3000;  // Longer delay

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 503 || response.status === 504 || response.status === 429) {
        if (attempt < retries) {
          const wait = RETRY_DELAY_MS * attempt;
          console.log(`    ⏳ Attempt ${attempt}/${retries}: ${response.status}, waiting ${wait/1000}s...`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
      }
      
      return response;
    } catch (error: any) {
      if (attempt < retries) {
        const wait = RETRY_DELAY_MS * attempt;
        console.log(`    ⏳ Attempt ${attempt}/${retries}: ${error.message}, waiting ${wait/1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

async function syncActiveProjects() {
  const startTime = Date.now();
  
  console.log('=== SYNC ACTIVE PROJECTS ===');
  console.log(`    Started: ${new Date().toLocaleTimeString()}\n`);
  
  const configPath = path.join(process.env.APPDATA || '', 'NotionTasksWidget', 'notion-widget.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const apiKey = config.projects?.apiKey || config.tasks?.apiKey;
  const dbId = config.projects?.databaseId;
  
  const PROPS = {
    title: config.projects?.titleProperty || 'Name',
    status: config.projects?.statusProperty || 'Status',
    startDate: config.projects?.startDateProperty || 'Start Date',
    deadline: config.projects?.endDateProperty || 'Deadline',
    actionsRelation: config.projects?.actionsRelationProperty || 'Actions',
  };
  
  const completedStatus = config.projects?.completedStatus || 'Done';
  
  console.log(`📋 Filter: Status != "${completedStatus}"`);

  const dbPath = 'C:/Users/Brandon/Dropbox/Apps/Notion Tasks Widget/backups/notion-backup.sqlite';
  const db = new Database(dbPath);
  
  db.prepare('DELETE FROM projects').run();
  db.prepare('DELETE FROM task_project_links').run();  // Clear relations too

  const upsert = db.prepare(`
    INSERT INTO projects (
      client_id, notion_id, title, status,
      start_date, end_date, url, last_edited,
      payload, sync_status, last_modified_local, last_modified_notion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)
  `);

  // Insert task→project links (from project's "Actions" relation)
  const insertTaskProjectLink = db.prepare(`
    INSERT OR IGNORE INTO task_project_links (task_id, project_id)
    VALUES (?, ?)
  `);

  const now = Date.now();
  let totalFetched = 0;
  let cursor: string | null = null;
  let pageNum = 0;
  let retryCount = 0;

  console.log('\n📥 Fetching...\n');

  do {
    pageNum++;
    
    const body: any = { 
      page_size: PAGE_SIZE,
      filter: {
        property: PROPS.status,
        status: {
          does_not_equal: completedStatus
        }
      }
    };
    if (cursor) body.start_cursor = cursor;

    const pageStart = Date.now();
    
    try {
      const response = await fetchWithRetry(
        `https://api.notion.com/v1/databases/${dbId}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body)
        }
      );

      const pageTime = ((Date.now() - pageStart) / 1000).toFixed(1);

      if (!response.ok) {
        console.log(`    ❌ Page ${pageNum} failed after ${pageTime}s`);
        break;
      }

      const data = await response.json() as any;
      const results = data.results || [];
      
      console.log(`    ✅ Page ${pageNum}: ${results.length} projects (${pageTime}s)`);

      for (const page of results) {
        const props = page.properties;
        
        const title = props[PROPS.title]?.title?.[0]?.plain_text || 'Untitled';
        const status = props[PROPS.status]?.status?.name || null;
        const startDate = props[PROPS.startDate]?.date?.start || null;
        const deadline = props[PROPS.deadline]?.date?.start || null;
        const lastEdited = page.last_edited_time || null;

        upsert.run(
          page.id, page.id, title, status,
          startDate, deadline, page.url, lastEdited,
          'synced', now, now
        );
        totalFetched++;

        // Extract task relations from "Actions" property
        const actionsRelation = props[PROPS.actionsRelation];
        if (actionsRelation?.type === 'relation' && actionsRelation.relation?.length > 0) {
          for (const rel of actionsRelation.relation) {
            insertTaskProjectLink.run(rel.id, page.id);  // task_id, project_id
          }
        }
      }

      cursor = data.has_more ? data.next_cursor : null;
      
      if (cursor) {
        await new Promise(r => setTimeout(r, 500));
      }
      
    } catch (error: any) {
      console.log(`    ❌ Page ${pageNum} error: ${error.message}`);
      retryCount++;
      if (retryCount > 3) break;  // Give up after too many page failures
    }
    
  } while (cursor);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Results
  console.log('\n' + '═'.repeat(50));
  console.log('📊 SYNC COMPLETE');
  console.log('═'.repeat(50));
  
  const count = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
  const relationCount = db.prepare('SELECT COUNT(*) as c FROM task_project_links').get() as { c: number };
  console.log(`    Total synced: ${count.c} projects`);
  console.log(`    Task↔Project links: ${relationCount.c}`);
  console.log(`    Time elapsed: ${totalTime}s`);

  const breakdown = db.prepare('SELECT status, COUNT(*) as c FROM projects GROUP BY status ORDER BY c DESC').all() as any[];
  console.log('\n    Status breakdown:');
  breakdown.forEach(r => console.log(`      ${r.status || 'NULL'}: ${r.c}`));

  const withDates = db.prepare('SELECT COUNT(*) as c FROM projects WHERE start_date IS NOT NULL OR end_date IS NOT NULL').get() as { c: number };
  console.log(`\n    With dates: ${withDates.c}`);

  console.log('\n📋 Projects by deadline:');
  const sample = db.prepare(`
    SELECT title, status, end_date 
    FROM projects 
    WHERE end_date IS NOT NULL 
    ORDER BY end_date ASC 
    LIMIT 10
  `).all() as any[];
  sample.forEach((p, i) => {
    console.log(`    ${i+1}. [${p.status}] ${p.end_date} - "${p.title?.substring(0, 30)}..."`);
  });

  db.close();
  console.log(`\n✅ Done in ${totalTime}s!`);
}

syncActiveProjects().catch(e => console.error('Error:', e));
