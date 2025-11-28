import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');

interface ProjectSettings {
  apiKey?: string;
  databaseId?: string;
  titleProperty?: string;
  statusProperty?: string;
  startDateProperty?: string;
  endDateProperty?: string;
  completedStatus?: string;
}

interface AppConfig {
  projects?: ProjectSettings;
  tasks?: { apiKey?: string };
}

const CURSOR_FILE = path.join('backups', 'project-sync-cursor.txt');
const PROPERTY_CACHE = path.join('backups', 'project-property-ids.json');
const DB_PATH = path.join('backups', 'notion-backup.sqlite');
const PAGE_SIZES = [20, 10, 6, 3, 2, 1];
const HYDRATE_DELAY_MS = 200;

function loadConfig(): ProjectSettings & { fallbackKey?: string } {
  const configPath = path.join(
    process.env.APPDATA || '',
    'NotionTasksWidget',
    'notion-widget.config.json',
  );

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found at ${configPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as AppConfig;
  return {
    ...(raw.projects || {}),
    fallbackKey: raw.tasks?.apiKey,
  };
}

async function fetchSchema(apiKey: string, dbId: string) {
  const response = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch schema: ${response.status} ${text}`);
  }

  return response.json() as Promise<{ properties: Record<string, any> }>;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  retries = 3,
  backoffMs = 1500,
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url, init);
    if (response.status === 503 || response.status === 504 || response.status === 429) {
      if (attempt === retries) return response;
      const wait = backoffMs * attempt;
      console.log(`    ⏳ ${response.status}, waiting ${wait / 1000}s before retry...`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    return response;
  }
  throw new Error('fetchJson exhausted retries');
}

function loadPropertyCache(): Array<{ name: string; id: string }> | null {
  if (!fs.existsSync(PROPERTY_CACHE)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(PROPERTY_CACHE, 'utf8'));
  } catch {
    return null;
  }
}

function buildPropertyIdMap(properties: Record<string, any>) {
  return Object.entries(properties).reduce<Record<string, string>>((acc, [name, def]) => {
    acc[name] = def.id;
    return acc;
  }, {});
}

async function hydrateAndStore(
  ids: Array<{ id: string; titlePreview: string | null }>,
  apiKey: string,
  propertyIds: Record<string, string>,
  propNames: { title: string; status: string; startDate: string; endDate: string },
  db: Database.Database,
  now: number,
) {
  if (!ids.length) return;

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO projects (
      client_id, notion_id, title, status,
      start_date, end_date, url, last_edited,
      payload, sync_status, last_modified_local, last_modified_notion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'synced', ?, ?)
  `);

  console.log(`  🔧 Hydrating ${ids.length} pages...`);

  for (const entry of ids) {
    const params = new URLSearchParams();
    [propNames.title, propNames.status, propNames.startDate, propNames.endDate]
      .map((name) => propertyIds[name])
      .filter(Boolean)
      .forEach((pid) => params.append('filter_properties', pid));

    const response = await fetchJson(
      `https://api.notion.com/v1/pages/${entry.id}?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Notion-Version': '2022-06-28',
        },
      },
      3,
      1200,
    );

    if (!response.ok) {
      console.log(`    ⚠️ Hydrate failed for ${entry.id}: ${response.status}`);
      continue;
    }

    const page = (await response.json()) as any;
    const props = page.properties || {};

    const titleProp = props[propNames.title];
    const statusProp = props[propNames.status];
    const startProp = props[propNames.startDate];
    const endProp = props[propNames.endDate];

    const title = titleProp?.title?.[0]?.plain_text || entry.titlePreview || 'Untitled';
    const status = statusProp?.status?.name || null;
    const startDate = startProp?.date?.start || null;
    const endDate = endProp?.date?.start || null;
    const lastEdited = page.last_edited_time || null;

    upsert.run(
      page.id,
      page.id,
      title,
      status,
      startDate,
      endDate,
      page.url,
      lastEdited,
      now,
      now,
    );

    console.log(`    ✅ ${title.substring(0, 40)}... [${status || 'No Status'}]`);
    await new Promise((resolve) => setTimeout(resolve, HYDRATE_DELAY_MS));
  }
}

async function main() {
  console.log('=== Mixed Project Sync (ID + Hydrate batches) ===\n');

  const config = loadConfig();
  const apiKey = config.apiKey || config.fallbackKey;
  const dbId = config.databaseId;

  if (!apiKey || !dbId) {
    throw new Error('Missing Notion API key or database ID in config (projects section).');
  }

  const propNames = {
    title: config.titleProperty || 'Name',
    status: config.statusProperty || 'Status',
    startDate: config.startDateProperty || 'Start Date',
    endDate: config.endDateProperty || 'Deadline',
  };
  const completedStatus = config.completedStatus || 'Done';

  let propertyIds: Record<string, string>;
  const cached = loadPropertyCache();
  if (cached) {
    propertyIds = cached.reduce<Record<string, string>>((acc, item) => {
      acc[item.name] = item.id;
      return acc;
    }, {});
  } else {
    console.log('Fetching schema to discover property IDs...');
    const schema = await fetchSchema(apiKey, dbId);
    propertyIds = buildPropertyIdMap(schema.properties || {});
    fs.writeFileSync(PROPERTY_CACHE, JSON.stringify(
      Object.entries(propertyIds).map(([name, id]) => ({ name, id })),
      null,
      2,
    ));
  }

  const queryParams = new URLSearchParams();
  const titlePropId = propertyIds[propNames.title];
  if (titlePropId) {
    queryParams.append('filter_properties', titlePropId);
  }
  const queryBase = `https://api.notion.com/v1/databases/${dbId}/query?${queryParams.toString()}`;

  const db = new Database(DB_PATH);
  const now = Date.now();

  let cursor: string | undefined;
  if (fs.existsSync(CURSOR_FILE)) {
    const stored = fs.readFileSync(CURSOR_FILE, 'utf8').trim();
    if (stored) {
      cursor = stored;
      console.log(`Resuming from cursor: ${cursor.slice(0, 10)}...\n`);
    }
  } else {
    // Fresh run, clear projects table to avoid duplicates
    db.prepare('DELETE FROM projects').run();
  }

  let totalBatches = 0;
  let totalRows = 0;
  let hasMore = true;

  while (hasMore) {
    let response: Response | undefined;
    let usedSize = PAGE_SIZES[0];

    for (const size of PAGE_SIZES) {
      const body: Record<string, any> = {
        page_size: size,
        filter: {
          property: propNames.status,
          status: { does_not_equal: completedStatus },
        },
      };
      if (cursor) body.start_cursor = cursor;

      console.log(`Requesting page (size=${size})...`);
      response = await fetchJson(
        queryBase,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
        3,
        2000,
      );

      if (response.status === 200) {
        usedSize = size;
        break;
      }

      console.log(`  ⚠️ query failed with ${response.status}, trying smaller batch...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!response || response.status !== 200) {
      console.log('Unable to get a successful page. Saving cursor and exiting.');
      if (cursor) fs.writeFileSync(CURSOR_FILE, cursor);
      break;
    }

    const data = await response.json();
    const results: Array<any> = data.results || [];
    console.log(`  ✅ Retrieved ${results.length} rows (page_size=${usedSize})`);

    const batch = results.map((item) => ({
      id: item.id,
      titlePreview:
        item.properties?.[propNames.title]?.title?.[0]?.plain_text || null,
    }));

    await hydrateAndStore(batch, apiKey, propertyIds, propNames, db, now);
    totalBatches += 1;
    totalRows += batch.length;

    hasMore = !!data.has_more;
    if (hasMore) {
      cursor = data.next_cursor;
      if (cursor) {
        fs.writeFileSync(CURSOR_FILE, cursor, 'utf8');
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    } else {
      cursor = undefined;
      if (fs.existsSync(CURSOR_FILE)) {
        fs.unlinkSync(CURSOR_FILE);
      }
      console.log('\n🎉 Reached end of database.');
    }
  }

  const count = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
  db.close();

  console.log('\n===== SUMMARY =====');
  console.log(`Batches processed : ${totalBatches}`);
  console.log(`Rows hydrated     : ${totalRows}`);
  console.log(`Projects in SQLite: ${count.c}`);
  console.log('===================\n');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exitCode = 1;
});


import Database = require('better-sqlite3');

interface ProjectSettings {
  apiKey?: string;
  databaseId?: string;
  titleProperty?: string;
  statusProperty?: string;
  startDateProperty?: string;
  endDateProperty?: string;
  completedStatus?: string;
}

interface AppConfig {
  projects?: ProjectSettings;
  tasks?: { apiKey?: string };
}

const CURSOR_FILE = path.join('backups', 'project-sync-cursor.txt');
const PROPERTY_CACHE = path.join('backups', 'project-property-ids.json');
const DB_PATH = path.join('backups', 'notion-backup.sqlite');
const PAGE_SIZES = [20, 10, 6, 3, 2, 1];
const HYDRATE_DELAY_MS = 200;

function loadConfig(): ProjectSettings & { fallbackKey?: string } {
  const configPath = path.join(
    process.env.APPDATA || '',
    'NotionTasksWidget',
    'notion-widget.config.json',
  );

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found at ${configPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as AppConfig;
  return {
    ...(raw.projects || {}),
    fallbackKey: raw.tasks?.apiKey,
  };
}

async function fetchSchema(apiKey: string, dbId: string) {
  const response = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch schema: ${response.status} ${text}`);
  }

  return response.json() as Promise<{ properties: Record<string, any> }>;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  retries = 3,
  backoffMs = 1500,
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url, init);
    if (response.status === 503 || response.status === 504 || response.status === 429) {
      if (attempt === retries) return response;
      const wait = backoffMs * attempt;
      console.log(`    ⏳ ${response.status}, waiting ${wait / 1000}s before retry...`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    return response;
  }
  throw new Error('fetchJson exhausted retries');
}

function loadPropertyCache(): Array<{ name: string; id: string }> | null {
  if (!fs.existsSync(PROPERTY_CACHE)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(PROPERTY_CACHE, 'utf8'));
  } catch {
    return null;
  }
}

function buildPropertyIdMap(properties: Record<string, any>) {
  return Object.entries(properties).reduce<Record<string, string>>((acc, [name, def]) => {
    acc[name] = def.id;
    return acc;
  }, {});
}

async function hydrateAndStore(
  ids: Array<{ id: string; titlePreview: string | null }>,
  apiKey: string,
  propertyIds: Record<string, string>,
  propNames: { title: string; status: string; startDate: string; endDate: string },
  db: Database.Database,
  now: number,
) {
  if (!ids.length) return;

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO projects (
      client_id, notion_id, title, status,
      start_date, end_date, url, last_edited,
      payload, sync_status, last_modified_local, last_modified_notion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'synced', ?, ?)
  `);

  console.log(`  🔧 Hydrating ${ids.length} pages...`);

  for (const entry of ids) {
    const params = new URLSearchParams();
    [propNames.title, propNames.status, propNames.startDate, propNames.endDate]
      .map((name) => propertyIds[name])
      .filter(Boolean)
      .forEach((pid) => params.append('filter_properties', pid));

    const response = await fetchJson(
      `https://api.notion.com/v1/pages/${entry.id}?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Notion-Version': '2022-06-28',
        },
      },
      3,
      1200,
    );

    if (!response.ok) {
      console.log(`    ⚠️ Hydrate failed for ${entry.id}: ${response.status}`);
      continue;
    }

    const page = (await response.json()) as any;
    const props = page.properties || {};

    const titleProp = props[propNames.title];
    const statusProp = props[propNames.status];
    const startProp = props[propNames.startDate];
    const endProp = props[propNames.endDate];

    const title = titleProp?.title?.[0]?.plain_text || entry.titlePreview || 'Untitled';
    const status = statusProp?.status?.name || null;
    const startDate = startProp?.date?.start || null;
    const endDate = endProp?.date?.start || null;
    const lastEdited = page.last_edited_time || null;

    upsert.run(
      page.id,
      page.id,
      title,
      status,
      startDate,
      endDate,
      page.url,
      lastEdited,
      now,
      now,
    );

    console.log(`    ✅ ${title.substring(0, 40)}... [${status || 'No Status'}]`);
    await new Promise((resolve) => setTimeout(resolve, HYDRATE_DELAY_MS));
  }
}

async function main() {
  console.log('=== Mixed Project Sync (ID + Hydrate batches) ===\n');

  const config = loadConfig();
  const apiKey = config.apiKey || config.fallbackKey;
  const dbId = config.databaseId;

  if (!apiKey || !dbId) {
    throw new Error('Missing Notion API key or database ID in config (projects section).');
  }

  const propNames = {
    title: config.titleProperty || 'Name',
    status: config.statusProperty || 'Status',
    startDate: config.startDateProperty || 'Start Date',
    endDate: config.endDateProperty || 'Deadline',
  };
  const completedStatus = config.completedStatus || 'Done';

  let propertyIds: Record<string, string>;
  const cached = loadPropertyCache();
  if (cached) {
    propertyIds = cached.reduce<Record<string, string>>((acc, item) => {
      acc[item.name] = item.id;
      return acc;
    }, {});
  } else {
    console.log('Fetching schema to discover property IDs...');
    const schema = await fetchSchema(apiKey, dbId);
    propertyIds = buildPropertyIdMap(schema.properties || {});
    fs.writeFileSync(PROPERTY_CACHE, JSON.stringify(
      Object.entries(propertyIds).map(([name, id]) => ({ name, id })),
      null,
      2,
    ));
  }

  const queryParams = new URLSearchParams();
  const titlePropId = propertyIds[propNames.title];
  if (titlePropId) {
    queryParams.append('filter_properties', titlePropId);
  }
  const queryBase = `https://api.notion.com/v1/databases/${dbId}/query?${queryParams.toString()}`;

  const db = new Database(DB_PATH);
  const now = Date.now();

  let cursor: string | undefined;
  if (fs.existsSync(CURSOR_FILE)) {
    const stored = fs.readFileSync(CURSOR_FILE, 'utf8').trim();
    if (stored) {
      cursor = stored;
      console.log(`Resuming from cursor: ${cursor.slice(0, 10)}...\n`);
    }
  } else {
    // Fresh run, clear projects table to avoid duplicates
    db.prepare('DELETE FROM projects').run();
  }

  let totalBatches = 0;
  let totalRows = 0;
  let hasMore = true;

  while (hasMore) {
    let response: Response | undefined;
    let usedSize = PAGE_SIZES[0];

    for (const size of PAGE_SIZES) {
      const body: Record<string, any> = {
        page_size: size,
        filter: {
          property: propNames.status,
          status: { does_not_equal: completedStatus },
        },
      };
      if (cursor) body.start_cursor = cursor;

      console.log(`Requesting page (size=${size})...`);
      response = await fetchJson(
        queryBase,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
        3,
        2000,
      );

      if (response.status === 200) {
        usedSize = size;
        break;
      }

      console.log(`  ⚠️ query failed with ${response.status}, trying smaller batch...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!response || response.status !== 200) {
      console.log('Unable to get a successful page. Saving cursor and exiting.');
      if (cursor) fs.writeFileSync(CURSOR_FILE, cursor);
      break;
    }

    const data = await response.json();
    const results: Array<any> = data.results || [];
    console.log(`  ✅ Retrieved ${results.length} rows (page_size=${usedSize})`);

    const batch = results.map((item) => ({
      id: item.id,
      titlePreview:
        item.properties?.[propNames.title]?.title?.[0]?.plain_text || null,
    }));

    await hydrateAndStore(batch, apiKey, propertyIds, propNames, db, now);
    totalBatches += 1;
    totalRows += batch.length;

    hasMore = !!data.has_more;
    if (hasMore) {
      cursor = data.next_cursor;
      if (cursor) {
        fs.writeFileSync(CURSOR_FILE, cursor, 'utf8');
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    } else {
      cursor = undefined;
      if (fs.existsSync(CURSOR_FILE)) {
        fs.unlinkSync(CURSOR_FILE);
      }
      console.log('\n🎉 Reached end of database.');
    }
  }

  const count = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
  db.close();

  console.log('\n===== SUMMARY =====');
  console.log(`Batches processed : ${totalBatches}`);
  console.log(`Rows hydrated     : ${totalRows}`);
  console.log(`Projects in SQLite: ${count.c}`);
  console.log('===================\n');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exitCode = 1;
});

