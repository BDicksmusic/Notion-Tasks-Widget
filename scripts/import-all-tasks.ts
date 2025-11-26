/**
 * Manual Import Script - Imports ALL tasks from Notion
 * 
 * Usage: npm run import:tasks
 * 
 * This script:
 * 1. Connects directly to Notion API with extended timeout
 * 2. Fetches tasks in small batches with retry logic
 * 3. SAVES PROGRESS after each page (so you don't lose work)
 * 4. Can be run multiple times - it will continue from where it left off
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@notionhq/client';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Configuration - ultra conservative
const PAGE_SIZE = 3; // Very small page size
const MAX_RETRIES = 3; // Fewer retries per page, but we save progress
const RETRY_DELAY_MS = 5000; // 5 second delay between retries
const BASE_RATE_LIMIT_DELAY_MS = 1000; // Base delay between requests
const NOTION_TIMEOUT_MS = 120000; // 2 minute timeout for Notion client
const CLIENT_REFRESH_INTERVAL = 50; // Refresh the Notion client every N pages to avoid stale connections

interface WidgetConfig {
  tasks?: {
    apiKey?: string;
    databaseId?: string;
    titleProperty?: string;
    statusProperty?: string;
    dateProperty?: string;
    deadlineProperty?: string;
    urgentProperty?: string;
    importantProperty?: string;
    mainEntryProperty?: string;
    sessionLengthProperty?: string;
    estimatedLengthProperty?: string;
    completedStatus?: string;
    deadlineHardValue?: string;
    urgentStatusActive?: string;
    importantStatusActive?: string;
  };
}

interface TaskData {
  id: string;
  title: string;
  status: string | null;
  normalizedStatus: string | null;
  dueDate: string | null;
  dueDateEnd: string | null;
  hardDeadline: boolean;
  urgent: boolean;
  important: boolean;
  mainEntry: string | null;
  sessionLengthMinutes: number | null;
  estimatedLengthMinutes: number | null;
  url: string | null;
}

interface ImportProgress {
  lastCursor: string | null;
  totalImported: number;
  tasks: TaskData[];
  lastUpdated: string;
}

function getAppDataPath(): string {
  return process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(process.env.HOME ?? '', 'Library/Application Support')
      : path.join(process.env.HOME ?? '', '.config'));
}

function loadWidgetConfig(): WidgetConfig | null {
  try {
    const configPath = path.join(getAppDataPath(), 'NotionTasksWidget', 'notion-widget.config.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw) as WidgetConfig;
  } catch (error) {
    console.error('[import] Unable to read widget config:', error);
    return null;
  }
}

function getProgressPath(): string {
  return path.join(getAppDataPath(), 'NotionTasksWidget', 'import-progress.json');
}

function getOutputPath(): string {
  return path.join(getAppDataPath(), 'NotionTasksWidget', 'imported-tasks.json');
}

function loadProgress(): ImportProgress | null {
  try {
    const progressPath = getProgressPath();
    if (fs.existsSync(progressPath)) {
      const raw = fs.readFileSync(progressPath, 'utf8');
      return JSON.parse(raw) as ImportProgress;
    }
  } catch (error) {
    console.warn('[import] Could not load progress:', error);
  }
  return null;
}

function saveProgress(progress: ImportProgress): void {
  const progressPath = getProgressPath();
  const dir = path.dirname(progressPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
}

function extractText(richTextArray: any[]): string {
  if (!Array.isArray(richTextArray)) return '';
  return richTextArray.map((t: any) => t.plain_text ?? '').join('');
}

function mapPageToTask(page: any, config: WidgetConfig['tasks']): TaskData | null {
  if (!config) return null;
  
  const props = page.properties ?? {};
  
  // Get title - try configured property first, then search for any title type
  let title = '';
  const titleProp = props[config.titleProperty ?? 'Name'];
  if (titleProp?.title) {
    title = extractText(titleProp.title);
  } else {
    for (const [, value] of Object.entries(props)) {
      if ((value as any)?.type === 'title' && (value as any)?.title) {
        title = extractText((value as any).title);
        break;
      }
    }
  }
  if (!title.trim()) return null;
  
  // Get status
  const statusProp = props[config.statusProperty ?? 'Status'];
  const status = statusProp?.status?.name ?? statusProp?.select?.name ?? null;
  
  // Get date
  const dateProp = props[config.dateProperty ?? 'Date'];
  const dueDate = dateProp?.date?.start ?? null;
  const dueDateEnd = dateProp?.date?.end ?? null;
  
  // Get deadline type
  const deadlineProp = props[config.deadlineProperty ?? 'Hard Deadline?'];
  const deadlineValue = deadlineProp?.status?.name ?? deadlineProp?.select?.name ?? '';
  const hardDeadline = deadlineValue === config.deadlineHardValue;
  
  // Get urgent
  const urgentProp = props[config.urgentProperty ?? 'Urgent'];
  const urgentValue = urgentProp?.status?.name ?? urgentProp?.select?.name ?? '';
  const urgent = urgentValue === config.urgentStatusActive;
  
  // Get important
  const importantProp = props[config.importantProperty ?? 'Important'];
  const importantValue = importantProp?.status?.name ?? importantProp?.select?.name ?? '';
  const important = importantValue === config.importantStatusActive;
  
  // Get main entry
  const mainEntryProp = props[config.mainEntryProperty ?? 'Main Entry'];
  const mainEntry = mainEntryProp?.rich_text ? extractText(mainEntryProp.rich_text) : null;
  
  // Get session length
  const sessLengthProp = props[config.sessionLengthProperty ?? 'Sess. Length'];
  const sessionLengthMinutes = sessLengthProp?.number ?? null;
  
  // Get estimated length
  const estLengthProp = props[config.estimatedLengthProperty ?? 'Est. Length'];
  const estimatedLengthMinutes = estLengthProp?.number ?? null;
  
  return {
    id: page.id,
    title,
    status,
    normalizedStatus: status,
    dueDate,
    dueDateEnd,
    hardDeadline,
    urgent,
    important,
    mainEntry,
    sessionLengthMinutes,
    estimatedLengthMinutes,
    url: page.url ?? null
  };
}

async function fetchWithRetry(
  client: Client,
  payload: any,
  attempt: number = 1
): Promise<any> {
  try {
    return await (client.databases as any).query(payload);
  } catch (error: any) {
    const code = error?.code;
    const message = error?.message ?? '';
    const isTimeout = code === 'notionhq_client_request_timeout' || message.includes('timed out');
    const isServerError = message.includes('504') || message.includes('502') || message.includes('503') || message.includes('ECONNRESET');
    const isRateLimit = code === 'rate_limited';
    
    if ((isTimeout || isServerError || isRateLimit) && attempt < MAX_RETRIES) {
      const waitTime = RETRY_DELAY_MS * attempt;
      const reason = isTimeout ? 'Timeout' : isServerError ? 'Server error' : 'Rate limited';
      console.log(`  ⚠️  ${reason} (attempt ${attempt}/${MAX_RETRIES}). Waiting ${(waitTime/1000).toFixed(0)}s...`);
      await delay(waitTime);
      return fetchWithRetry(client, payload, attempt + 1);
    }
    throw error;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           Notion Tasks Widget - Full Import Script           ║');
  console.log('║                  (with progress saving)                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  
  // Load config
  const config = loadWidgetConfig();
  if (!config?.tasks?.apiKey || !config?.tasks?.databaseId) {
    console.error('❌ Missing API key or database ID in config');
    process.exit(1);
  }
  
  const taskConfig = config.tasks;
  
  console.log('📋 Configuration:');
  console.log(`   Database ID: ${taskConfig.databaseId}`);
  console.log(`   Page Size: ${PAGE_SIZE}`);
  console.log(`   Timeout: ${NOTION_TIMEOUT_MS / 1000}s`);
  console.log(`   Client refresh: every ${CLIENT_REFRESH_INTERVAL} pages`);
  console.log(`   Dynamic delay: yes (increases every 50 pages)`);
  console.log('');
  
  // Check for existing progress
  let progress = loadProgress();
  let startingCursor: string | null = null;
  let allTasks: TaskData[] = [];
  
  if (progress && progress.tasks.length > 0) {
    console.log(`📂 Found existing progress: ${progress.totalImported} tasks already imported`);
    console.log(`   Last updated: ${progress.lastUpdated}`);
    
    // Ask to continue or restart
    const continueImport = process.argv.includes('--continue') || !process.argv.includes('--restart');
    
    if (continueImport && progress.lastCursor) {
      console.log('   Continuing from where we left off...');
      startingCursor = progress.lastCursor;
      allTasks = progress.tasks;
    } else {
      console.log('   Starting fresh import...');
    }
  }
  console.log('');
  
  // Initialize Notion client with extended timeout
  // We'll refresh this periodically to avoid stale connections
  let client = new Client({ 
    auth: taskConfig.apiKey,
    timeoutMs: NOTION_TIMEOUT_MS
  });
  
  const refreshClient = () => {
    client = new Client({ 
      auth: taskConfig.apiKey,
      timeoutMs: NOTION_TIMEOUT_MS
    });
    console.log('   🔄 Refreshed Notion client connection');
  };
  
  // Test connection
  console.log('🔌 Testing Notion connection...');
  try {
    await client.users.me({});
    console.log('   ✅ API key valid');
  } catch (error) {
    console.error('   ❌ API key invalid:', error);
    process.exit(1);
  }
  console.log('');
  
  // Fetch all tasks
  console.log('🚀 Starting import...');
  console.log('   (Progress is saved after each page - safe to interrupt)');
  console.log('');
  
  let cursor: string | null = startingCursor;
  let pageNumber = Math.floor(allTasks.length / PAGE_SIZE);
  const startTime = Date.now();
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;
  
  do {
    pageNumber++;
    
    const payload: any = {
      database_id: taskConfig.databaseId,
      page_size: PAGE_SIZE,
      ...(cursor && { start_cursor: cursor })
      // No filter_properties - fetch all to ensure we get titles
    };
    
    try {
      const response = await fetchWithRetry(client, payload);
      consecutiveErrors = 0; // Reset error counter on success
      
      // Process results
      let pageImported = 0;
      let pageSkipped = 0;
      
      for (const page of response.results) {
        const task = mapPageToTask(page, taskConfig);
        
        if (!task) {
          pageSkipped++;
          continue;
        }
        
        // Check if task already exists (by ID)
        const existingIndex = allTasks.findIndex(t => t.id === task.id);
        if (existingIndex >= 0) {
          allTasks[existingIndex] = task; // Update existing
        } else {
          allTasks.push(task);
          pageImported++;
        }
      }
      
      cursor = response.has_more ? response.next_cursor : null;
      
      // Save progress after each page
      const progressData: ImportProgress = {
        lastCursor: cursor,
        totalImported: allTasks.length,
        tasks: allTasks,
        lastUpdated: new Date().toISOString()
      };
      saveProgress(progressData);
      
      // Progress update
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`   Page ${pageNumber}: +${pageImported} tasks (${pageSkipped} skipped) | Total: ${allTasks.length} | ${elapsed}s`);
      
      // Refresh client periodically to avoid stale connections
      if (cursor && pageNumber % CLIENT_REFRESH_INTERVAL === 0) {
        refreshClient();
      }
      
      // Dynamic rate limiting - increase delay as we paginate deeper
      // This helps avoid timeouts with deep pagination
      if (cursor) {
        const depthFactor = Math.floor(pageNumber / 50); // Increase delay every 50 pages
        const dynamicDelay = BASE_RATE_LIMIT_DELAY_MS + (depthFactor * 500); // +500ms per 50 pages
        if (depthFactor > 0 && pageNumber % 50 === 0) {
          console.log(`   ⏳ Increasing delay to ${dynamicDelay}ms for deeper pagination`);
        }
        await delay(dynamicDelay);
      }
      
    } catch (error: any) {
      consecutiveErrors++;
      console.error(`   ❌ Error on page ${pageNumber}:`, error.message);
      
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.log('');
        console.log(`   ⛔ Too many consecutive errors (${consecutiveErrors}). Stopping.`);
        console.log(`   💾 Progress saved! Run again with --continue to resume.`);
        break;
      }
      
      // Refresh the client on errors - stale connection might be the cause
      refreshClient();
      
      // Save progress even on error
      const progressData: ImportProgress = {
        lastCursor: cursor,
        totalImported: allTasks.length,
        tasks: allTasks,
        lastUpdated: new Date().toISOString()
      };
      saveProgress(progressData);
      
      console.log(`   💾 Progress saved (${allTasks.length} tasks). Waiting before retry...`);
      await delay(RETRY_DELAY_MS * 2);
    }
    
  } while (cursor);
  
  // Save final output
  const outputPath = getOutputPath();
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, JSON.stringify({
    importedAt: new Date().toISOString(),
    totalTasks: allTasks.length,
    tasks: allTasks
  }, null, 2));
  
  // Final stats
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                      Import Complete!                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`   ✅ Tasks imported: ${allTasks.length}`);
  console.log(`   ⏱️  Total time: ${totalTime}s`);
  console.log(`   💾 Saved to: ${outputPath}`);
  console.log('');
  
  // Clean up progress file if complete
  if (!cursor) {
    const progressPath = getProgressPath();
    if (fs.existsSync(progressPath)) {
      fs.unlinkSync(progressPath);
      console.log('   🧹 Cleaned up progress file (import complete)');
    }
  } else {
    console.log('   ⚠️  Import incomplete - run again with --continue to resume');
  }
  
  console.log('');
  console.log('✅ Done! Restart the widget to see your tasks.');
}

main().catch((error) => {
  console.error('❌ Import failed:', error);
  process.exit(1);
});
