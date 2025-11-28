import * as fs from 'fs';
import * as path from 'path';

/**
 * Test Notion pagination WITHOUT SQLite
 * Just fetch and count - nothing else
 */

async function test() {
  console.log('=== NOTION FETCH TEST (No SQLite) ===\n');

  const configPath = path.join(process.env.APPDATA || '', 'NotionTasksWidget', 'notion-widget.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const apiKey = config.projects?.apiKey || config.tasks?.apiKey;
  const dbId = config.projects?.databaseId;
  const statusProp = config.projects?.statusProperty || 'Status';
  const completedStatus = config.projects?.completedStatus || 'Done';

  const PAGE_SIZE = 3;  // Small pages
  const MAX_TOTAL = 100;  // Stop after 100

  console.log(`Database: ${dbId?.substring(0, 8)}...`);
  console.log(`Filter: ${statusProp} != "${completedStatus}"`);
  console.log(`Page size: ${PAGE_SIZE} (fetching up to ${MAX_TOTAL})\n`);

  let cursor: string | undefined;
  let pageNum = 0;
  let total = 0;
  const startTime = Date.now();

  do {
    pageNum++;
    console.log(`Page ${pageNum}...`);

    const body: any = {
      page_size: PAGE_SIZE,
      filter: {
        property: statusProp,
        status: { does_not_equal: completedStatus }
      }
    };
    if (cursor) body.start_cursor = cursor;

    const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)
    });

    console.log(`  Status: ${response.status}`);

    if (!response.ok) {
      const text = await response.text();
      console.log(`  Error: ${text.substring(0, 200)}`);
      break;
    }

    const data = await response.json() as any;
    const count = data.results?.length || 0;
    total += count;

    console.log(`  Got: ${count} results`);
    console.log(`  Total so far: ${total}`);
    console.log(`  Has more: ${data.has_more}`);

    cursor = data.has_more ? data.next_cursor : undefined;

    if (total >= MAX_TOTAL) {
      console.log(`  Reached ${MAX_TOTAL} limit, stopping.\n`);
      break;
    }

    if (cursor) {
      console.log(`  Waiting 500ms...\n`);
      await new Promise(r => setTimeout(r, 500));
    }

  } while (cursor);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Done! Total: ${total} in ${elapsed}s`);
}

test().catch(e => console.error('Error:', e));



/**
 * Test Notion pagination WITHOUT SQLite
 * Just fetch and count - nothing else
 */

async function test() {
  console.log('=== NOTION FETCH TEST (No SQLite) ===\n');

  const configPath = path.join(process.env.APPDATA || '', 'NotionTasksWidget', 'notion-widget.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const apiKey = config.projects?.apiKey || config.tasks?.apiKey;
  const dbId = config.projects?.databaseId;
  const statusProp = config.projects?.statusProperty || 'Status';
  const completedStatus = config.projects?.completedStatus || 'Done';

  const PAGE_SIZE = 3;  // Small pages
  const MAX_TOTAL = 100;  // Stop after 100

  console.log(`Database: ${dbId?.substring(0, 8)}...`);
  console.log(`Filter: ${statusProp} != "${completedStatus}"`);
  console.log(`Page size: ${PAGE_SIZE} (fetching up to ${MAX_TOTAL})\n`);

  let cursor: string | undefined;
  let pageNum = 0;
  let total = 0;
  const startTime = Date.now();

  do {
    pageNum++;
    console.log(`Page ${pageNum}...`);

    const body: any = {
      page_size: PAGE_SIZE,
      filter: {
        property: statusProp,
        status: { does_not_equal: completedStatus }
      }
    };
    if (cursor) body.start_cursor = cursor;

    const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)
    });

    console.log(`  Status: ${response.status}`);

    if (!response.ok) {
      const text = await response.text();
      console.log(`  Error: ${text.substring(0, 200)}`);
      break;
    }

    const data = await response.json() as any;
    const count = data.results?.length || 0;
    total += count;

    console.log(`  Got: ${count} results`);
    console.log(`  Total so far: ${total}`);
    console.log(`  Has more: ${data.has_more}`);

    cursor = data.has_more ? data.next_cursor : undefined;

    if (total >= MAX_TOTAL) {
      console.log(`  Reached ${MAX_TOTAL} limit, stopping.\n`);
      break;
    }

    if (cursor) {
      console.log(`  Waiting 500ms...\n`);
      await new Promise(r => setTimeout(r, 500));
    }

  } while (cursor);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Done! Total: ${total} in ${elapsed}s`);
}

test().catch(e => console.error('Error:', e));

