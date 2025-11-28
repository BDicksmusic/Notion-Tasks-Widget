import * as fs from 'fs';
import * as path from 'path';
import * as Database from 'better-sqlite3';

interface TaskConfig {
  apiKey?: string;
  databaseId?: string;
  titleProperty?: string;
  statusProperty?: string;
  dueDateProperty?: string;
  priorityProperty?: string;
  projectRelationProperty?: string;
}

interface AppConfig {
  tasks?: TaskConfig;
}

const OUTPUT_FILE = path.join('backups', 'task-lightweight-scan.json');
const CURSOR_FILE = path.join('backups', 'task-lightweight-cursor.txt');
const PROPERTY_CACHE = path.join('backups', 'task-property-ids.json');
const DB_PATH = path.join('backups', 'notion-backup.sqlite');

const HYDRATE_DELAY_MS = 200;
const PAGE_SIZE = 20; // Sweet spot - fast hydration, fewer 503s

function loadConfig(): TaskConfig {
  const configPath = path.join(
    process.env.APPDATA || '',
    'NotionTasksWidget',
    'notion-widget.config.json',
  );

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found at ${configPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as AppConfig;
  return raw.tasks || {};
}

async function fetchDatabaseSchema(apiKey: string, dbId: string) {
  // Use 2025-09-03 API to get data_sources
  const response = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': '2025-09-03',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch schema (${response.status}): ${text}`);
  }

  return response.json() as Promise<any>;
}

async function getDataSourceId(apiKey: string, dbId: string): Promise<string> {
  const schema = await fetchDatabaseSchema(apiKey, dbId);
  const dataSources = schema.data_sources || [];
  if (dataSources.length === 0) {
    throw new Error('No data sources found for database');
  }
  console.log(`Found ${dataSources.length} data source(s): ${dataSources.map((ds: any) => ds.name).join(', ')}`);
  return dataSources[0].id; // Use first data source
}

function loadPropertyMap(): Record<string, string> | null {
  if (!fs.existsSync(PROPERTY_CACHE)) return null;
  try {
    const entries = JSON.parse(fs.readFileSync(PROPERTY_CACHE, 'utf8')) as Array<{
      name: string;
      id: string;
    }>;
    return entries.reduce<Record<string, string>>((acc, entry) => {
      acc[entry.name] = entry.id;
      return acc;
    }, {});
  } catch {
    return null;
  }
}

function savePropertyMap(map: Record<string, string>) {
  const entries = Object.entries(map).map(([name, id]) => ({ name, id }));
  fs.writeFileSync(PROPERTY_CACHE, JSON.stringify(entries, null, 2));
}

async function hydrateBatch(
  ids: Array<{ id: string; title: string | null }>,
  apiKey: string,
  propertyIds: Record<string, string>,
  props: { title: string; status: string; dueDate: string; priority: string; projectRelation: string },
  upsert: Database.Statement,
  insertTaskProjectLink: Database.Statement,
) {
  if (!ids.length) return 0;

  const propIds = [props.title, props.status, props.dueDate, props.priority, props.projectRelation]
    .map((name) => propertyIds[name])
    .filter(Boolean);

  const query = new URLSearchParams();
  propIds.forEach((pid) => query.append('filter_properties', pid));

  console.log(`    🔧 Hydrating ${ids.length} tasks...`);

  let successCount = 0;
  for (const entry of ids) {
    const response = await fetch(
      `https://api.notion.com/v1/pages/${entry.id}?${query.toString()}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Notion-Version': '2025-09-03',
        },
      },
    );

    if (!response.ok) {
      console.log(`      ⚠️ Hydrate failed (${response.status}) for ${entry.id}`);
      continue;
    }

    const page = await response.json();
    const pageProps = page.properties || {};
    
    const title = pageProps[props.title]?.title?.[0]?.plain_text || entry.title || 'Untitled';
    const status = pageProps[props.status]?.status?.name || null;
    const dueDate = pageProps[props.dueDate]?.date?.start || null;
    const priority = pageProps[props.priority]?.select?.name || null;
    const lastEdited = page.last_edited_time || null;

    // Build payload JSON
    const payload = JSON.stringify({
      title,
      status,
      due_date: dueDate,
      priority,
      url: page.url,
      last_edited: lastEdited,
      notion_id: page.id,
    });

    // Insert task
    upsert.run(
      page.id,           // client_id
      page.id,           // notion_id
      payload,           // payload (JSON)
      Date.now(),        // last_modified_local
      Date.now(),        // last_modified_notion
    );

    // Extract project relations
    const projectRelation = pageProps[props.projectRelation];
    if (projectRelation?.type === 'relation' && projectRelation.relation?.length > 0) {
      for (const rel of projectRelation.relation) {
        insertTaskProjectLink.run(page.id, rel.id);  // task_id, project_id
      }
    }

    successCount++;
    console.log(`      ✅ ${title.substring(0, 35)}... [${status || 'No Status'}]`);
    await new Promise((resolve) => setTimeout(resolve, HYDRATE_DELAY_MS));
  }
  return successCount;
}

async function main() {
  console.log('=== Tasks Lightweight Sync + Hydrate ===\n');

  const config = loadConfig();
  const apiKey = config.apiKey;
  const dbId = config.databaseId;

  if (!apiKey || !dbId) {
    throw new Error('Missing Notion API key or database ID in config (tasks section).');
  }

  const props = {
    title: config.titleProperty || 'Task',
    status: config.statusProperty || 'Status',
    dueDate: config.dueDateProperty || 'Due',
    priority: config.priorityProperty || 'Priority',
    projectRelation: config.projectRelationProperty || 'Projects',
  };

  console.log(`Database: ${dbId}`);
  console.log(`Properties: title="${props.title}", status="${props.status}", due="${props.dueDate}"`);

  // Get data_source_id (new 2025-09-03 API requirement)
  console.log('\nFetching data source ID...');
  const dataSourceId = await getDataSourceId(apiKey, dbId);
  console.log(`Data Source ID: ${dataSourceId}`);

  let propertyIds = loadPropertyMap();
  if (!propertyIds) {
    console.log('\nProperty cache missing – fetching schema...');
    const schema = await fetchDatabaseSchema(apiKey, dbId);
    propertyIds = Object.entries(schema.properties || {}).reduce<Record<string, string>>(
      (acc, [name, def]) => {
        acc[name] = (def as any).id;
        return acc;
      },
      {},
    );
    savePropertyMap(propertyIds);
    console.log(`Saved ${Object.keys(propertyIds).length} properties to cache`);
  }

  // Use data_sources endpoint (2025-09-03 API)
  const url = `https://api.notion.com/v1/data_sources/${dataSourceId}/query`;

  const ids: Array<{ id: string; lastEdited: string; title: string | null }> = [];
  let cursor: string | undefined;
  let resumed = false;

  if (fs.existsSync(CURSOR_FILE)) {
    const stored = fs.readFileSync(CURSOR_FILE, 'utf8').trim();
    if (stored) {
      cursor = stored;
      resumed = true;
      console.log(`\nResuming from stored cursor: ${cursor.slice(0, 12)}...`);
    }
  }

  let page = 0;
  const pageSize = PAGE_SIZE;

  console.log('\nFetching tasks...\n');

  const db = new Database(DB_PATH);
  
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO tasks (
      client_id, notion_id, payload,
      sync_status, last_modified_local, last_modified_notion
    ) VALUES (?, ?, ?, 'synced', ?, ?)
  `);

  const insertTaskProjectLink = db.prepare(`
    INSERT OR IGNORE INTO task_project_links (task_id, project_id)
    VALUES (?, ?)
  `);

  if (!cursor) {
    db.prepare('DELETE FROM tasks').run();
    db.prepare('DELETE FROM task_project_links').run();
    console.log('Cleared existing tasks and links\n');
  }

  let hasMore = true;
  
  while (hasMore) {
    page += 1;
    const body: Record<string, any> = {
      page_size: pageSize,
      // Sort by last_edited descending - recently active tasks first
      sorts: [
        {
          timestamp: 'last_edited_time',
          direction: 'descending',
        },
      ],
    };

    if (cursor) {
      body.start_cursor = cursor;
    }

    const started = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const elapsedMs = Date.now() - started;
    const elapsed = (elapsedMs / 1000).toFixed(2);
    console.log(`Page ${page}: status ${response.status} (${elapsed}s, page_size=${pageSize})`);

    if (response.status === 503 || response.status === 504) {
      console.log('  ⚠️ Timeout/Service unavailable, waiting 5s and retrying...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
      page -= 1; // retry same page
      continue;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Query failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    const results: any[] = data.results || [];

    const batch = results.map((pageData) => {
      const prop = pageData.properties?.[props.title];
      const title = prop?.title?.[0]?.plain_text || null;
      const lastEdited = pageData.last_edited_time;
      const entry = { id: pageData.id, lastEdited, title };
      ids.push(entry);
      return entry;
    });

    const hydratedCount = await hydrateBatch(batch, apiKey, propertyIds, props, upsert, insertTaskProjectLink);
    console.log(`    ✅ Hydrated ${hydratedCount}/${batch.length} to SQLite`);

    hasMore = data.has_more === true;
    cursor = data.next_cursor;

    if (cursor) {
      fs.writeFileSync(CURSOR_FILE, cursor, 'utf8');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  // Get final counts
  const taskCount = db.prepare('SELECT COUNT(*) as c FROM tasks').get() as { c: number };
  const linkCount = db.prepare('SELECT COUNT(*) as c FROM task_project_links').get() as { c: number };
  
  const statusBreakdown = db.prepare('SELECT status, COUNT(*) as c FROM tasks GROUP BY status ORDER BY c DESC').all() as any[];

  db.close();

  if (fs.existsSync(CURSOR_FILE)) {
    fs.unlinkSync(CURSOR_FILE);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(ids, null, 2));

  console.log('\n=== Summary ===');
  console.log(`Tasks synced         : ${taskCount.c}`);
  console.log(`Task↔Project links   : ${linkCount.c}`);
  console.log(`\nStatus breakdown:`);
  statusBreakdown.forEach((r: any) => console.log(`  ${r.status || 'NULL'}: ${r.c}`));
  
  if (resumed) {
    console.log('\nResumed run finished – cursor file cleared.');
  }
  console.log('\n✅ Tasks sync complete!\n');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exitCode = 1;
});


import * as Database from 'better-sqlite3';

interface TaskConfig {
  apiKey?: string;
  databaseId?: string;
  titleProperty?: string;
  statusProperty?: string;
  dueDateProperty?: string;
  priorityProperty?: string;
  projectRelationProperty?: string;
}

interface AppConfig {
  tasks?: TaskConfig;
}

const OUTPUT_FILE = path.join('backups', 'task-lightweight-scan.json');
const CURSOR_FILE = path.join('backups', 'task-lightweight-cursor.txt');
const PROPERTY_CACHE = path.join('backups', 'task-property-ids.json');
const DB_PATH = path.join('backups', 'notion-backup.sqlite');

const HYDRATE_DELAY_MS = 200;
const PAGE_SIZE = 20; // Sweet spot - fast hydration, fewer 503s

function loadConfig(): TaskConfig {
  const configPath = path.join(
    process.env.APPDATA || '',
    'NotionTasksWidget',
    'notion-widget.config.json',
  );

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found at ${configPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as AppConfig;
  return raw.tasks || {};
}

async function fetchDatabaseSchema(apiKey: string, dbId: string) {
  // Use 2025-09-03 API to get data_sources
  const response = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': '2025-09-03',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch schema (${response.status}): ${text}`);
  }

  return response.json() as Promise<any>;
}

async function getDataSourceId(apiKey: string, dbId: string): Promise<string> {
  const schema = await fetchDatabaseSchema(apiKey, dbId);
  const dataSources = schema.data_sources || [];
  if (dataSources.length === 0) {
    throw new Error('No data sources found for database');
  }
  console.log(`Found ${dataSources.length} data source(s): ${dataSources.map((ds: any) => ds.name).join(', ')}`);
  return dataSources[0].id; // Use first data source
}

function loadPropertyMap(): Record<string, string> | null {
  if (!fs.existsSync(PROPERTY_CACHE)) return null;
  try {
    const entries = JSON.parse(fs.readFileSync(PROPERTY_CACHE, 'utf8')) as Array<{
      name: string;
      id: string;
    }>;
    return entries.reduce<Record<string, string>>((acc, entry) => {
      acc[entry.name] = entry.id;
      return acc;
    }, {});
  } catch {
    return null;
  }
}

function savePropertyMap(map: Record<string, string>) {
  const entries = Object.entries(map).map(([name, id]) => ({ name, id }));
  fs.writeFileSync(PROPERTY_CACHE, JSON.stringify(entries, null, 2));
}

async function hydrateBatch(
  ids: Array<{ id: string; title: string | null }>,
  apiKey: string,
  propertyIds: Record<string, string>,
  props: { title: string; status: string; dueDate: string; priority: string; projectRelation: string },
  upsert: Database.Statement,
  insertTaskProjectLink: Database.Statement,
) {
  if (!ids.length) return 0;

  const propIds = [props.title, props.status, props.dueDate, props.priority, props.projectRelation]
    .map((name) => propertyIds[name])
    .filter(Boolean);

  const query = new URLSearchParams();
  propIds.forEach((pid) => query.append('filter_properties', pid));

  console.log(`    🔧 Hydrating ${ids.length} tasks...`);

  let successCount = 0;
  for (const entry of ids) {
    const response = await fetch(
      `https://api.notion.com/v1/pages/${entry.id}?${query.toString()}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Notion-Version': '2025-09-03',
        },
      },
    );

    if (!response.ok) {
      console.log(`      ⚠️ Hydrate failed (${response.status}) for ${entry.id}`);
      continue;
    }

    const page = await response.json();
    const pageProps = page.properties || {};
    
    const title = pageProps[props.title]?.title?.[0]?.plain_text || entry.title || 'Untitled';
    const status = pageProps[props.status]?.status?.name || null;
    const dueDate = pageProps[props.dueDate]?.date?.start || null;
    const priority = pageProps[props.priority]?.select?.name || null;
    const lastEdited = page.last_edited_time || null;

    // Build payload JSON
    const payload = JSON.stringify({
      title,
      status,
      due_date: dueDate,
      priority,
      url: page.url,
      last_edited: lastEdited,
      notion_id: page.id,
    });

    // Insert task
    upsert.run(
      page.id,           // client_id
      page.id,           // notion_id
      payload,           // payload (JSON)
      Date.now(),        // last_modified_local
      Date.now(),        // last_modified_notion
    );

    // Extract project relations
    const projectRelation = pageProps[props.projectRelation];
    if (projectRelation?.type === 'relation' && projectRelation.relation?.length > 0) {
      for (const rel of projectRelation.relation) {
        insertTaskProjectLink.run(page.id, rel.id);  // task_id, project_id
      }
    }

    successCount++;
    console.log(`      ✅ ${title.substring(0, 35)}... [${status || 'No Status'}]`);
    await new Promise((resolve) => setTimeout(resolve, HYDRATE_DELAY_MS));
  }
  return successCount;
}

async function main() {
  console.log('=== Tasks Lightweight Sync + Hydrate ===\n');

  const config = loadConfig();
  const apiKey = config.apiKey;
  const dbId = config.databaseId;

  if (!apiKey || !dbId) {
    throw new Error('Missing Notion API key or database ID in config (tasks section).');
  }

  const props = {
    title: config.titleProperty || 'Task',
    status: config.statusProperty || 'Status',
    dueDate: config.dueDateProperty || 'Due',
    priority: config.priorityProperty || 'Priority',
    projectRelation: config.projectRelationProperty || 'Projects',
  };

  console.log(`Database: ${dbId}`);
  console.log(`Properties: title="${props.title}", status="${props.status}", due="${props.dueDate}"`);

  // Get data_source_id (new 2025-09-03 API requirement)
  console.log('\nFetching data source ID...');
  const dataSourceId = await getDataSourceId(apiKey, dbId);
  console.log(`Data Source ID: ${dataSourceId}`);

  let propertyIds = loadPropertyMap();
  if (!propertyIds) {
    console.log('\nProperty cache missing – fetching schema...');
    const schema = await fetchDatabaseSchema(apiKey, dbId);
    propertyIds = Object.entries(schema.properties || {}).reduce<Record<string, string>>(
      (acc, [name, def]) => {
        acc[name] = (def as any).id;
        return acc;
      },
      {},
    );
    savePropertyMap(propertyIds);
    console.log(`Saved ${Object.keys(propertyIds).length} properties to cache`);
  }

  // Use data_sources endpoint (2025-09-03 API)
  const url = `https://api.notion.com/v1/data_sources/${dataSourceId}/query`;

  const ids: Array<{ id: string; lastEdited: string; title: string | null }> = [];
  let cursor: string | undefined;
  let resumed = false;

  if (fs.existsSync(CURSOR_FILE)) {
    const stored = fs.readFileSync(CURSOR_FILE, 'utf8').trim();
    if (stored) {
      cursor = stored;
      resumed = true;
      console.log(`\nResuming from stored cursor: ${cursor.slice(0, 12)}...`);
    }
  }

  let page = 0;
  const pageSize = PAGE_SIZE;

  console.log('\nFetching tasks...\n');

  const db = new Database(DB_PATH);
  
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO tasks (
      client_id, notion_id, payload,
      sync_status, last_modified_local, last_modified_notion
    ) VALUES (?, ?, ?, 'synced', ?, ?)
  `);

  const insertTaskProjectLink = db.prepare(`
    INSERT OR IGNORE INTO task_project_links (task_id, project_id)
    VALUES (?, ?)
  `);

  if (!cursor) {
    db.prepare('DELETE FROM tasks').run();
    db.prepare('DELETE FROM task_project_links').run();
    console.log('Cleared existing tasks and links\n');
  }

  let hasMore = true;
  
  while (hasMore) {
    page += 1;
    const body: Record<string, any> = {
      page_size: pageSize,
      // Sort by last_edited descending - recently active tasks first
      sorts: [
        {
          timestamp: 'last_edited_time',
          direction: 'descending',
        },
      ],
    };

    if (cursor) {
      body.start_cursor = cursor;
    }

    const started = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const elapsedMs = Date.now() - started;
    const elapsed = (elapsedMs / 1000).toFixed(2);
    console.log(`Page ${page}: status ${response.status} (${elapsed}s, page_size=${pageSize})`);

    if (response.status === 503 || response.status === 504) {
      console.log('  ⚠️ Timeout/Service unavailable, waiting 5s and retrying...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
      page -= 1; // retry same page
      continue;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Query failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    const results: any[] = data.results || [];

    const batch = results.map((pageData) => {
      const prop = pageData.properties?.[props.title];
      const title = prop?.title?.[0]?.plain_text || null;
      const lastEdited = pageData.last_edited_time;
      const entry = { id: pageData.id, lastEdited, title };
      ids.push(entry);
      return entry;
    });

    const hydratedCount = await hydrateBatch(batch, apiKey, propertyIds, props, upsert, insertTaskProjectLink);
    console.log(`    ✅ Hydrated ${hydratedCount}/${batch.length} to SQLite`);

    hasMore = data.has_more === true;
    cursor = data.next_cursor;

    if (cursor) {
      fs.writeFileSync(CURSOR_FILE, cursor, 'utf8');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  // Get final counts
  const taskCount = db.prepare('SELECT COUNT(*) as c FROM tasks').get() as { c: number };
  const linkCount = db.prepare('SELECT COUNT(*) as c FROM task_project_links').get() as { c: number };
  
  const statusBreakdown = db.prepare('SELECT status, COUNT(*) as c FROM tasks GROUP BY status ORDER BY c DESC').all() as any[];

  db.close();

  if (fs.existsSync(CURSOR_FILE)) {
    fs.unlinkSync(CURSOR_FILE);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(ids, null, 2));

  console.log('\n=== Summary ===');
  console.log(`Tasks synced         : ${taskCount.c}`);
  console.log(`Task↔Project links   : ${linkCount.c}`);
  console.log(`\nStatus breakdown:`);
  statusBreakdown.forEach((r: any) => console.log(`  ${r.status || 'NULL'}: ${r.c}`));
  
  if (resumed) {
    console.log('\nResumed run finished – cursor file cleared.');
  }
  console.log('\n✅ Tasks sync complete!\n');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exitCode = 1;
});

