import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');

/**
 * Sync ACTIVE Tasks Only (not Done/Completed)
 * Also captures task→project relations into entity_relations table
 */

const PAGE_SIZE = 15;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

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

async function syncActiveTasks() {
  const startTime = Date.now();
  
  console.log('=== SYNC ACTIVE TASKS ===');
  console.log(`    Started: ${new Date().toLocaleTimeString()}\n`);
  
  const configPath = path.join(process.env.APPDATA || '', 'NotionTasksWidget', 'notion-widget.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const apiKey = config.tasks?.apiKey;
  const dbId = config.tasks?.databaseId;
  
  // Property names from config
  const PROPS = {
    title: config.tasks?.titleProperty || 'Name',
    status: config.tasks?.statusProperty || 'Status',
    dueDate: config.tasks?.dateProperty || 'Date',
    projectRelation: config.tasks?.projectRelationProperty || 'Projects',
  };
  
  const completedStatus = config.tasks?.completedStatus || 'Done';
  
  console.log(`📋 Config:`);
  console.log(`    Title: "${PROPS.title}"`);
  console.log(`    Status: "${PROPS.status}"`);
  console.log(`    Due Date: "${PROPS.dueDate}"`);
  console.log(`    Project Relation: "${PROPS.projectRelation}"`);
  console.log(`    Completed Status: "${completedStatus}"`);
  console.log(`    Filter: Status != "${completedStatus}"`);

  const dbPath = 'C:/Users/Brandon/Dropbox/Apps/Notion Tasks Widget/backups/notion-backup.sqlite';
  const db = new Database(dbPath);
  
  // Clear existing tasks (we're doing a full refresh of active tasks)
  db.prepare('DELETE FROM tasks').run();
  // Clear task→project relations too
  db.prepare('DELETE FROM task_project_links').run();

  const upsertTask = db.prepare(`
    INSERT INTO tasks (
      client_id, notion_id, title, status,
      due_date, url, last_edited,
      payload, sync_status, last_modified_local, last_modified_notion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)
  `);

  // Use specific relation table instead of generic
  const insertTaskProjectLink = db.prepare(`
    INSERT OR IGNORE INTO task_project_links (task_id, project_id)
    VALUES (?, ?)
  `);

  const now = Date.now();
  let totalTasks = 0;
  let totalRelations = 0;
  let cursor: string | null = null;
  let pageNum = 0;

  console.log('\n📥 Fetching active tasks...\n');

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
        const text = await response.text();
        console.log(`    ❌ Page ${pageNum} failed: ${response.status}`);
        if (text.length < 200) console.log(`       ${text}`);
        break;
      }

      const data = await response.json() as any;
      const results = data.results || [];
      
      console.log(`    ✅ Page ${pageNum}: ${results.length} tasks (${pageTime}s)`);

      for (const page of results) {
        const props = page.properties;
        
        const title = props[PROPS.title]?.title?.[0]?.plain_text || 'Untitled';
        const status = props[PROPS.status]?.status?.name || null;
        const dueDate = props[PROPS.dueDate]?.date?.start || null;
        const lastEdited = page.last_edited_time || null;

        // Insert task
        upsertTask.run(
          page.id, page.id, title, status,
          dueDate, page.url, lastEdited,
          'synced', now, now
        );
        totalTasks++;

        // Extract and store project relations (into task_project_links)
        const projectRelation = props[PROPS.projectRelation];
        if (projectRelation?.type === 'relation' && projectRelation.relation?.length > 0) {
          for (const rel of projectRelation.relation) {
            insertTaskProjectLink.run(page.id, rel.id);
            totalRelations++;
          }
        }
      }

      cursor = data.has_more ? data.next_cursor : null;
      
      if (cursor) {
        await new Promise(r => setTimeout(r, 500));
      }
      
    } catch (error: any) {
      console.log(`    ❌ Page ${pageNum} error: ${error.message}`);
      break;
    }
    
  } while (cursor);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Results
  console.log('\n' + '═'.repeat(50));
  console.log('📊 SYNC COMPLETE');
  console.log('═'.repeat(50));
  
  const taskCount = db.prepare('SELECT COUNT(*) as c FROM tasks').get() as { c: number };
  const relationCount = db.prepare('SELECT COUNT(*) as c FROM task_project_links').get() as { c: number };
  
  console.log(`    Tasks synced: ${taskCount.c}`);
  console.log(`    Task→Project relations: ${relationCount.c}`);
  console.log(`    Time elapsed: ${totalTime}s`);

  const breakdown = db.prepare('SELECT status, COUNT(*) as c FROM tasks GROUP BY status ORDER BY c DESC').all() as any[];
  console.log('\n    Status breakdown:');
  breakdown.forEach(r => console.log(`      ${r.status || 'NULL'}: ${r.c}`));

  console.log('\n📋 Tasks by due date:');
  const sample = db.prepare(`
    SELECT title, status, due_date 
    FROM tasks 
    WHERE due_date IS NOT NULL 
    ORDER BY due_date ASC 
    LIMIT 10
  `).all() as any[];
  sample.forEach((t, i) => {
    console.log(`    ${i+1}. [${t.status}] ${t.due_date} - "${t.title?.substring(0, 30)}..."`);
  });

  // Show tasks with project relations
  const tasksWithProjects = db.prepare(`
    SELECT t.title, COUNT(tpl.id) as project_count
    FROM tasks t
    JOIN task_project_links tpl ON tpl.task_id = t.client_id
    GROUP BY t.client_id
    ORDER BY project_count DESC
    LIMIT 5
  `).all() as any[];
  
  if (tasksWithProjects.length > 0) {
    console.log('\n📎 Tasks with project relations:');
    tasksWithProjects.forEach((t, i) => {
      console.log(`    ${i+1}. "${t.title?.substring(0, 30)}..." → ${t.project_count} project(s)`);
    });
  }

  db.close();
  console.log(`\n✅ Done in ${totalTime}s!`);
}

syncActiveTasks().catch(e => console.error('Error:', e));


import Database = require('better-sqlite3');

/**
 * Sync ACTIVE Tasks Only (not Done/Completed)
 * Also captures task→project relations into entity_relations table
 */

const PAGE_SIZE = 15;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

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

async function syncActiveTasks() {
  const startTime = Date.now();
  
  console.log('=== SYNC ACTIVE TASKS ===');
  console.log(`    Started: ${new Date().toLocaleTimeString()}\n`);
  
  const configPath = path.join(process.env.APPDATA || '', 'NotionTasksWidget', 'notion-widget.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const apiKey = config.tasks?.apiKey;
  const dbId = config.tasks?.databaseId;
  
  // Property names from config
  const PROPS = {
    title: config.tasks?.titleProperty || 'Name',
    status: config.tasks?.statusProperty || 'Status',
    dueDate: config.tasks?.dateProperty || 'Date',
    projectRelation: config.tasks?.projectRelationProperty || 'Projects',
  };
  
  const completedStatus = config.tasks?.completedStatus || 'Done';
  
  console.log(`📋 Config:`);
  console.log(`    Title: "${PROPS.title}"`);
  console.log(`    Status: "${PROPS.status}"`);
  console.log(`    Due Date: "${PROPS.dueDate}"`);
  console.log(`    Project Relation: "${PROPS.projectRelation}"`);
  console.log(`    Completed Status: "${completedStatus}"`);
  console.log(`    Filter: Status != "${completedStatus}"`);

  const dbPath = 'C:/Users/Brandon/Dropbox/Apps/Notion Tasks Widget/backups/notion-backup.sqlite';
  const db = new Database(dbPath);
  
  // Clear existing tasks (we're doing a full refresh of active tasks)
  db.prepare('DELETE FROM tasks').run();
  // Clear task→project relations too
  db.prepare('DELETE FROM task_project_links').run();

  const upsertTask = db.prepare(`
    INSERT INTO tasks (
      client_id, notion_id, title, status,
      due_date, url, last_edited,
      payload, sync_status, last_modified_local, last_modified_notion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)
  `);

  // Use specific relation table instead of generic
  const insertTaskProjectLink = db.prepare(`
    INSERT OR IGNORE INTO task_project_links (task_id, project_id)
    VALUES (?, ?)
  `);

  const now = Date.now();
  let totalTasks = 0;
  let totalRelations = 0;
  let cursor: string | null = null;
  let pageNum = 0;

  console.log('\n📥 Fetching active tasks...\n');

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
        const text = await response.text();
        console.log(`    ❌ Page ${pageNum} failed: ${response.status}`);
        if (text.length < 200) console.log(`       ${text}`);
        break;
      }

      const data = await response.json() as any;
      const results = data.results || [];
      
      console.log(`    ✅ Page ${pageNum}: ${results.length} tasks (${pageTime}s)`);

      for (const page of results) {
        const props = page.properties;
        
        const title = props[PROPS.title]?.title?.[0]?.plain_text || 'Untitled';
        const status = props[PROPS.status]?.status?.name || null;
        const dueDate = props[PROPS.dueDate]?.date?.start || null;
        const lastEdited = page.last_edited_time || null;

        // Insert task
        upsertTask.run(
          page.id, page.id, title, status,
          dueDate, page.url, lastEdited,
          'synced', now, now
        );
        totalTasks++;

        // Extract and store project relations (into task_project_links)
        const projectRelation = props[PROPS.projectRelation];
        if (projectRelation?.type === 'relation' && projectRelation.relation?.length > 0) {
          for (const rel of projectRelation.relation) {
            insertTaskProjectLink.run(page.id, rel.id);
            totalRelations++;
          }
        }
      }

      cursor = data.has_more ? data.next_cursor : null;
      
      if (cursor) {
        await new Promise(r => setTimeout(r, 500));
      }
      
    } catch (error: any) {
      console.log(`    ❌ Page ${pageNum} error: ${error.message}`);
      break;
    }
    
  } while (cursor);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Results
  console.log('\n' + '═'.repeat(50));
  console.log('📊 SYNC COMPLETE');
  console.log('═'.repeat(50));
  
  const taskCount = db.prepare('SELECT COUNT(*) as c FROM tasks').get() as { c: number };
  const relationCount = db.prepare('SELECT COUNT(*) as c FROM task_project_links').get() as { c: number };
  
  console.log(`    Tasks synced: ${taskCount.c}`);
  console.log(`    Task→Project relations: ${relationCount.c}`);
  console.log(`    Time elapsed: ${totalTime}s`);

  const breakdown = db.prepare('SELECT status, COUNT(*) as c FROM tasks GROUP BY status ORDER BY c DESC').all() as any[];
  console.log('\n    Status breakdown:');
  breakdown.forEach(r => console.log(`      ${r.status || 'NULL'}: ${r.c}`));

  console.log('\n📋 Tasks by due date:');
  const sample = db.prepare(`
    SELECT title, status, due_date 
    FROM tasks 
    WHERE due_date IS NOT NULL 
    ORDER BY due_date ASC 
    LIMIT 10
  `).all() as any[];
  sample.forEach((t, i) => {
    console.log(`    ${i+1}. [${t.status}] ${t.due_date} - "${t.title?.substring(0, 30)}..."`);
  });

  // Show tasks with project relations
  const tasksWithProjects = db.prepare(`
    SELECT t.title, COUNT(tpl.id) as project_count
    FROM tasks t
    JOIN task_project_links tpl ON tpl.task_id = t.client_id
    GROUP BY t.client_id
    ORDER BY project_count DESC
    LIMIT 5
  `).all() as any[];
  
  if (tasksWithProjects.length > 0) {
    console.log('\n📎 Tasks with project relations:');
    tasksWithProjects.forEach((t, i) => {
      console.log(`    ${i+1}. "${t.title?.substring(0, 30)}..." → ${t.project_count} project(s)`);
    });
  }

  db.close();
  console.log(`\n✅ Done in ${totalTime}s!`);
}

syncActiveTasks().catch(e => console.error('Error:', e));

