import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@notionhq/client';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));


type WidgetConfig = {
  tasks?: {
    apiKey?: string;
    databaseId?: string;
    titleProperty?: string;
    statusProperty?: string;
    completedStatus?: string;
  };
};

function loadWidgetConfig(): WidgetConfig | null {
  try {
    const appData =
      process.env.APPDATA ||
      (process.platform === 'darwin'
        ? path.join(process.env.HOME ?? '', 'Library/Application Support')
        : path.join(process.env.HOME ?? '', '.config'));
    const configPath = path.join(
      appData,
      'NotionTasksWidget',
      'notion-widget.config.json'
    );
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw) as WidgetConfig;
  } catch (error) {
    console.warn('[sync-test] Unable to read widget config:', error);
    return null;
  }
}

async function main() {
  const config = loadWidgetConfig();

  const apiKey =
    process.env.NOTION_API_KEY ?? config?.tasks?.apiKey ?? undefined;
  const databaseId =
    process.env.NOTION_DATABASE_ID ?? config?.tasks?.databaseId ?? undefined;
  const titleProperty = config?.tasks?.titleProperty ?? 'Name';
  const statusProperty = config?.tasks?.statusProperty ?? 'Status';

  if (!apiKey || !databaseId) {
    throw new Error(
      'Missing NOTION_API_KEY or NOTION_DATABASE_ID. Set them in .env or Control Center.'
    );
  }

  const completedStatus =
    config?.tasks?.completedStatus ??
    process.env.NOTION_COMPLETED_STATUS ??
    '✅';

  const client = new Client({ auth: apiKey });

  console.log('[sync-test] Testing API key...');
  const me = await client.users.me({});
  console.log('[sync-test] ✅ API key is valid');

  console.log('[sync-test] Testing database access:', databaseId);
  const database = await client.databases.retrieve({ database_id: databaseId }) as any;
  console.log('[sync-test] ✅ Database is accessible');
  
  // DIAGNOSTIC: List all properties and their types
  console.log('\n[sync-test] === DATABASE PROPERTIES ===');
  const properties = database.properties || {};
  const propList: { name: string; type: string; slow: boolean }[] = [];
  Object.entries(properties).forEach(([name, prop]: [string, any]) => {
    const type = prop.type;
    const isSlow = type === 'relation' || type === 'rollup' || type === 'formula';
    propList.push({ name, type, slow: isSlow });
  });
  
  // Sort: slow properties first
  propList.sort((a, b) => {
    if (a.slow && !b.slow) return -1;
    if (!a.slow && b.slow) return 1;
    return a.name.localeCompare(b.name);
  });
  
  propList.forEach(({ name, type, slow }) => {
    console.log(`  ${slow ? '⚠️ SLOW' : '✓ OK  '} "${name}": ${type}`);
  });
  console.log('[sync-test] ================================\n');
  
  // Check if Status property exists and what options it has
  const statusProp = properties[statusProperty];
  if (statusProp) {
    console.log(`[sync-test] Status property "${statusProperty}" type: ${statusProp.type}`);
    if (statusProp.type === 'status' && statusProp.status?.options) {
      console.log('[sync-test] Available status options:');
      statusProp.status.options.forEach((opt: any) => {
        const isCompleted = opt.name === completedStatus;
        console.log(`  ${isCompleted ? '→' : ' '} "${opt.name}" (${opt.color})`);
      });
    } else if (statusProp.type === 'select' && statusProp.select?.options) {
      console.log('[sync-test] Available select options:');
      statusProp.select.options.forEach((opt: any) => {
        const isCompleted = opt.name === completedStatus;
        console.log(`  ${isCompleted ? '→' : ' '} "${opt.name}" (${opt.color})`);
      });
    }
    console.log(`[sync-test] Configured completedStatus: "${completedStatus}"\n`);
  } else {
    console.log(`[sync-test] ⚠️ Status property "${statusProperty}" NOT FOUND!\n`);
  }

  // Test 1: Query with NO filter, only Title property
  console.log('[sync-test] Test 1: Querying with ONLY Title property (no filter)...');
  try {
    const test1 = await (client.databases as any).query({
      database_id: databaseId,
      page_size: 1,
      filter_properties: [titleProperty]
    });
    console.log(`[sync-test] ✅ Test 1 passed: Got ${test1.results.length} result(s)\n`);
  } catch (error) {
    console.log(`[sync-test] ❌ Test 1 FAILED: ${(error as any).message}\n`);
  }
  
  // Test 2: Query with Title + Status properties (no filter)
  console.log('[sync-test] Test 2: Querying with Title + Status properties (no filter)...');
  try {
    const test2 = await (client.databases as any).query({
      database_id: databaseId,
      page_size: 1,
      filter_properties: [titleProperty, statusProperty]
    });
    console.log(`[sync-test] ✅ Test 2 passed: Got ${test2.results.length} result(s)\n`);
  } catch (error) {
    console.log(`[sync-test] ❌ Test 2 FAILED: ${(error as any).message}\n`);
  }
  
  // Test 3: Query with status filter
  console.log('[sync-test] Test 3: Querying with status filter (does_not_equal completedStatus)...');
  try {
    const test3 = await (client.databases as any).query({
      database_id: databaseId,
      page_size: 1,
      filter_properties: [titleProperty, statusProperty],
      filter: {
        property: statusProperty,
        status: { does_not_equal: completedStatus }
      }
    });
    console.log(`[sync-test] ✅ Test 3 passed: Got ${test3.results.length} result(s)\n`);
  } catch (error) {
    console.log(`[sync-test] ❌ Test 3 FAILED: ${(error as any).message}\n`);
  }

  console.log('[sync-test] Pulling tasks (with server-side status filter)...');
  let cursor: string | null = null;
  let totalExamined = 0;
  const PAGE_SIZE = 10; // Smaller page size to avoid timeouts on complex databases
  const MAX_EXAMINED = 200; // Check more tasks
  const desiredOpen = 30; // Find more open tasks
  const openTasks: { title: string; status: string }[] = [];

  do {
    const filterProperties = [titleProperty, statusProperty].filter(Boolean);

    const response = await (async () => {
      // Use server-side filter to exclude completed tasks
      const payload = {
        database_id: databaseId,
        page_size: PAGE_SIZE,
        start_cursor: cursor ?? undefined,
        ...(completedStatus && statusProperty
          ? {
              filter: {
                property: statusProperty,
                status: { does_not_equal: completedStatus }
              }
            }
          : {}),
        ...(filterProperties.length ? { filter_properties: filterProperties } : {})
      };

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await (client.databases as any).query(payload);
        } catch (error) {
          const code = (error as { code?: string })?.code;
          if (code === 'notionhq_client_request_timeout' && attempt < 2) {
            console.warn(
              `[sync-test] Query timed out (attempt ${attempt + 1}). Retrying...`
            );
            await delay(750 * (attempt + 1));
            continue;
          }
          throw error;
        }
      }
      throw new Error('Failed to query Notion after multiple retries.');
    })();
    totalExamined += response.results.length;
    response.results.forEach((result) => {
      const props = (result as any).properties ?? {};
      const titleProp =
        props[titleProperty] ??
        props.Name ??
        props.Title ??
        props['Task'] ??
        {};
      const title =
        (titleProp.title as any[] | undefined)?.map((t) => t.plain_text).join('') ??
        '(untitled)';
      const status =
        props[statusProperty]?.status?.name ??
        props.Status?.status?.name ??
        props['Status']?.status?.name ??
        props['Task Status']?.status?.name ??
        '—';
      // Client-side filter: exclude completed
      if (status !== completedStatus) {
        openTasks.push({ title, status });
      }
    });
    cursor = response.has_more ? response.next_cursor ?? null : null;
  } while (
    cursor &&
    totalExamined < MAX_EXAMINED &&
    openTasks.length < desiredOpen
  );

  if (!openTasks.length) {
    console.warn(
      `[sync-test] Checked ${totalExamined} tasks but didn't find any with status != "${completedStatus}"`
    );
  } else {
    console.log(
      `[sync-test] Found ${openTasks.length} open tasks (status != "${completedStatus}"):`
    );
    openTasks.slice(0, desiredOpen).forEach((task, i) => {
      console.log(`  ${i + 1}. ${task.title} [status=${task.status}]`);
    });
  }

  console.log(
    `[sync-test] ✅ Examined ${totalExamined} tasks (open matches: ${openTasks.length}).`
  );
}

main().catch((error) => {
  console.error('[sync-test] ❌ Sync test failed:', error);
  process.exit(1);
});
