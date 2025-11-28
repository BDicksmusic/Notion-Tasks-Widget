import * as fs from 'fs';
import * as path from 'path';
import * as Database from 'better-sqlite3';

interface ProjectConfig {
  apiKey?: string;
  databaseId?: string;
  titleProperty?: string;
  statusProperty?: string;
  startDateProperty?: string;
  endDateProperty?: string;
  completedStatus?: string;
}

interface AppConfig {
  projects?: ProjectConfig;
  tasks?: ProjectConfig;
}

const OUTPUT_FILE = path.join('backups', 'project-lightweight-scan.json');
const CURSOR_FILE = path.join('backups', 'project-lightweight-cursor.txt');
const PROPERTY_CACHE = path.join('backups', 'project-property-ids.json');
const DB_PATH = path.join('backups', 'notion-backup.sqlite');

const HYDRATE_DELAY_MS = 100; // Faster now that time logs are removed
const PAGE_SIZE = 100; // Big pages - time log bottleneck is gone!

function loadConfig(): ProjectConfig & { fallbackApiKey?: string } {
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
    fallbackApiKey: raw.tasks?.apiKey,
  };
}

async function fetchDatabaseSchema(apiKey: string, dbId: string) {
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
  return dataSources[0].id;
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
  props: { title: string; status: string; startDate: string; endDate: string },
  upsert: Database.Statement,
  checkExists: Database.Statement,
): Promise<{ inserted: number; skipped: number }> {
  if (!ids.length) return { inserted: 0, skipped: 0 };

  const propIds = [props.title, props.status, props.startDate, props.endDate]
    .map((name) => propertyIds[name])
    .filter(Boolean);

  const query = new URLSearchParams();
  propIds.forEach((pid) => query.append('filter_properties', pid));

  let inserted = 0;
  let skipped = 0;

  for (const entry of ids) {
    // Check if this entry already exists in DB BEFORE making API call
    const existing = checkExists.get(entry.id) as { c: number } | undefined;
    if (existing && existing.c > 0) {
      skipped++;
      continue; // Skip this entry - no API call needed!
    }

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
    const startDate = pageProps[props.startDate]?.date?.start || null;
    const endDate = pageProps[props.endDate]?.date?.start || null;
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
      Date.now(),
      Date.now(),
    );

    inserted++;
    console.log(`      ✅ ${title.substring(0, 35)}... [${status || 'No Status'}]`);
    await new Promise((resolve) => setTimeout(resolve, HYDRATE_DELAY_MS));
  }
  return { inserted, skipped };
}

async function main() {
  console.log('=== Phase 1: Lightweight Project Scan + Hydrate ===\n');

  const config = loadConfig();
  const apiKey = config.apiKey || config.fallbackApiKey;
  const dbId = config.databaseId;

  if (!apiKey || !dbId) {
    throw new Error('Missing Notion API key or database ID in config (projects section).');
  }

  const props = {
    title: config.titleProperty || 'Name',
    status: config.statusProperty || 'Status',
    startDate: config.startDateProperty || 'Start Date',
    endDate: config.endDateProperty || 'Deadline',
  };
  const completedStatusName = config.completedStatus || 'Done';

  // Get data_source_id (new 2025-09-03 API requirement)
  console.log('Fetching data source ID...');
  const dataSourceId = await getDataSourceId(apiKey, dbId);
  console.log(`Data Source ID: ${dataSourceId}\n`);

  let propertyIds = loadPropertyMap();
  if (!propertyIds) {
    console.log('Property cache missing – fetching schema...');
    const schema = await fetchDatabaseSchema(apiKey, dbId);
    propertyIds = Object.entries(schema.properties || {}).reduce<Record<string, string>>(
      (acc, [name, def]) => {
        acc[name] = (def as any).id;
        return acc;
      },
      {},
    );
    savePropertyMap(propertyIds);
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
      console.log(`Resuming from stored cursor: ${cursor.slice(0, 12)}...\n`);
    }
  }

  let page = 0;
  const pageSize = PAGE_SIZE;

  console.log('\nFetching IDs with minimal payload...\n');

  const db = new Database(DB_PATH);
  // Use INSERT OR IGNORE so we skip entries we already have
  const upsert = db.prepare(`
    INSERT OR IGNORE INTO projects (
      client_id, notion_id, title, status,
      start_date, end_date, url, last_edited,
      payload, sync_status, last_modified_local, last_modified_notion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'synced', ?, ?)
  `);
  
  // Check if entry already exists (used to skip API calls)
  const checkExists = db.prepare('SELECT COUNT(*) as c FROM projects WHERE client_id = ?');
  
  const existingCount = (db.prepare('SELECT COUNT(*) as c FROM projects').get() as {c: number}).c;
  console.log(`Existing projects in DB: ${existingCount}\n`);
  
  let totalInserted = 0;
  let totalSkipped = 0;
  let consecutiveAllSkipped = 0; // Track pages where ALL entries were skipped
  // For FULL sync, we need to go through all pages (old entries are at the end)
  // Set to very high number to effectively disable early stop
  const EARLY_STOP_THRESHOLD = 999; // Disable early stop for full sync

  let hasMore = true;
  let currentPageSize = pageSize;
  let inRecoveryMode = false; // true = we're at page_size=1 looking for problems
  let retriesAtOne = 0; // count retries when at page_size=1
  const skippedCursors: string[] = [];
  const SLOW_THRESHOLD_MS = 30000; // 30 seconds = too slow, drop to 1
  
  while (hasMore) {
    page += 1;
    const body: Record<string, any> = {
      page_size: currentPageSize,
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
    
    // Race between fetch and timeout
    const fetchPromise = fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    
    const timeoutPromise = new Promise<'timeout'>((resolve) => 
      setTimeout(() => resolve('timeout'), SLOW_THRESHOLD_MS)
    );
    
    const result = await Promise.race([fetchPromise, timeoutPromise]);
    
    const elapsedMs = Date.now() - started;
    const elapsed = (elapsedMs / 1000).toFixed(2);
    
    if (result === 'timeout') {
      console.log(`Page ${page}: TIMEOUT after ${elapsed}s (>30s, page_size=${currentPageSize})`);
      // Treat as 504
      if (currentPageSize === 1) {
        retriesAtOne++;
        console.log(`  ❌ PROBLEM at cursor (attempt ${retriesAtOne}/3): ${cursor?.slice(0, 12) || 'start'}...`);
        if (retriesAtOne >= 3) {
          console.log(`  ⚠️ Skipping after 3 fails...`);
          skippedCursors.push(cursor || 'start');
          retriesAtOne = 0;
        }
      } else {
        console.log(`  ⚠️ Timeout - dropping to page_size=1`);
        currentPageSize = 1;
        inRecoveryMode = true;
        retriesAtOne = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      page -= 1;
      continue;
    }
    
    const response = result;
    console.log(`Page ${page}: status ${response.status} (${elapsed}s, page_size=${currentPageSize})`);
    
    // If we were in recovery mode and got a successful fast response, restore normal page_size
    if (inRecoveryMode && currentPageSize === 1 && elapsedMs < 5000) {
      console.log(`  ✅ Fast response - restoring page_size to ${pageSize}`);
      currentPageSize = pageSize;
      inRecoveryMode = false;
    }

    // Check for 504/503 OR slow response
    const isTimeout = response.status === 503 || response.status === 504;
    const isSlow = elapsedMs > SLOW_THRESHOLD_MS && response.ok;

    if (isTimeout) {
      if (currentPageSize === 1) {
        // At page_size=1 and still failing - log and retry
        retriesAtOne++;
        console.log(`  ❌ PROBLEM at cursor (attempt ${retriesAtOne}/3): ${cursor?.slice(0, 12) || 'start'}...`);
        
        if (retriesAtOne >= 3) {
          // Tried 3 times - log problem and keep going
          console.log(`  ⚠️ Skipping this cursor after 3 fails. Continuing...`);
          skippedCursors.push(cursor || 'start');
          retriesAtOne = 0;
          // Can't skip without next_cursor - wait and retry one more time
          await new Promise((resolve) => setTimeout(resolve, 5000));
          page -= 1;
          continue;
        }
        
        console.log(`  ⏳ Waiting 3s...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        page -= 1;
        continue;
      } else {
        // First 504 at normal page_size - enter recovery mode
        console.log(`  ⚠️ 504 hit - dropping to page_size=1`);
        currentPageSize = 1;
        inRecoveryMode = true;
        retriesAtOne = 0;
        page -= 1;
        continue;
      }
    }
    
    // Success - reset retry counter
    retriesAtOne = 0;

    if (isSlow && !inRecoveryMode) {
      // Request was slow (>30s) - enter recovery mode for safety
      console.log(`  ⚠️ Slow response (${elapsed}s) - entering recovery mode (page_size=1)`);
      currentPageSize = 1;
      inRecoveryMode = true;
      // Don't retry, process this result and continue at page_size=1
    }

    // If we're in recovery mode and got a 504 at page_size=1, we already handled above
    // Otherwise we got a successful response - process it

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

    const { inserted, skipped } = await hydrateBatch(batch, apiKey, propertyIds, props, upsert, checkExists);
    totalInserted += inserted;
    totalSkipped += skipped;
    
    console.log(`    📊 Page ${page}: ${inserted} new, ${skipped} skipped (Total: ${totalInserted} new, ${totalSkipped} skipped)`);

    // Check for early termination - if ALL entries in this page were skipped, we've caught up
    if (inserted === 0 && skipped === batch.length && batch.length > 0) {
      consecutiveAllSkipped++;
      console.log(`    ℹ️ All ${batch.length} entries already exist (${consecutiveAllSkipped}/${EARLY_STOP_THRESHOLD} consecutive)`);
      
      if (consecutiveAllSkipped >= EARLY_STOP_THRESHOLD) {
        console.log(`\n🎉 Early stop: ${EARLY_STOP_THRESHOLD} consecutive pages with all entries already in DB. Caught up!`);
        hasMore = false;
        break;
      }
    } else {
      consecutiveAllSkipped = 0; // Reset counter if we found new entries
    }

    hasMore = data.has_more === true;
    cursor = data.next_cursor;

    if (cursor) {
      fs.writeFileSync(CURSOR_FILE, cursor, 'utf8');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  // Get final count BEFORE closing DB
  const finalCount = (db.prepare('SELECT COUNT(*) as c FROM projects').get() as {c: number}).c;
  
  db.close();

  if (fs.existsSync(CURSOR_FILE)) {
    fs.unlinkSync(CURSOR_FILE);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(ids, null, 2));

  console.log('\n=== Summary ===');
  console.log(`Pages scanned             : ${ids.length}`);
  console.log(`New entries inserted      : ${totalInserted}`);
  console.log(`Existing entries skipped  : ${totalSkipped}`);
  console.log(`Total in DB now           : ${finalCount}`);
  console.log(`Saved scan to             : ${OUTPUT_FILE}`);
  if (resumed) {
    console.log('\nResumed run finished – cursor file cleared.');
  }
  console.log('\nSync complete.\n');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exitCode = 1;
});

