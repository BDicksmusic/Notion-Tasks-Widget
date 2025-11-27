/**
 * Notion Time Logs Service
 * 
 * Simple, direct API operations for time logs.
 * No timers, no queues, no hidden automation.
 */

import { Client } from '@notionhq/client';
import type { TimeLogEntry, TimeLogEntryPayload, TimeLogSettings } from '../../shared/types';
import { createNotionClient, withRetry } from './notionApi';
import { getTimeLogSettings, getTaskSettings } from '../configStore';

// Cache the client
let client: Client | null = null;
let cachedApiKey: string | null = null;

/**
 * Get or create the Notion client
 */
function getClient(): Client {
  const timeLogSettings = getTimeLogSettings();
  const taskSettings = getTaskSettings();
  const apiKey = timeLogSettings.apiKey || taskSettings.apiKey;
  
  if (!client || apiKey !== cachedApiKey) {
    if (!apiKey) {
      throw new Error('Notion API key not configured');
    }
    client = createNotionClient(apiKey);
    cachedApiKey = apiKey;
  }
  
  return client;
}

/**
 * Parse a Notion page into a TimeLogEntry object
 */
function parseNotionPage(page: any, settings: TimeLogSettings): TimeLogEntry {
  const props = page.properties || {};
  
  const getText = (propName?: string): string | null => {
    if (!propName) return null;
    const prop = props[propName];
    if (!prop) return null;
    
    if (prop.type === 'title') {
      return prop.title?.[0]?.plain_text ?? null;
    }
    if (prop.type === 'rich_text') {
      return prop.rich_text?.[0]?.plain_text ?? null;
    }
    return null;
  };
  
  const getDate = (propName?: string): string | null => {
    if (!propName) return null;
    const prop = props[propName];
    if (!prop || prop.type !== 'date' || !prop.date) return null;
    return prop.date.start ?? null;
  };
  
  const getStatus = (propName?: string): string | null => {
    if (!propName) return null;
    const prop = props[propName];
    if (!prop) return null;
    
    if (prop.type === 'status') {
      return prop.status?.name ?? null;
    }
    if (prop.type === 'select') {
      return prop.select?.name ?? null;
    }
    return null;
  };
  
  const getRelationId = (propName?: string): string | null => {
    if (!propName) return null;
    const prop = props[propName];
    if (!prop || prop.type !== 'relation') return null;
    return prop.relation?.[0]?.id ?? null;
  };
  
  const getUniqueId = (): string | undefined => {
    if (!settings.idProperty) return undefined;
    const prop = props[settings.idProperty];
    if (!prop || prop.type !== 'unique_id') return undefined;
    const prefix = prop.unique_id?.prefix ?? '';
    const number = prop.unique_id?.number;
    if (number === undefined) return undefined;
    return prefix ? `${prefix}-${number}` : String(number);
  };
  
  // Calculate duration if we have both start and end times
  const startTime = getDate(settings.startTimeProperty);
  const endTime = getDate(settings.endTimeProperty);
  let durationMinutes: number | null = null;
  
  if (startTime && endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  }
  
  return {
    id: page.id,
    uniqueId: getUniqueId(),
    startTime,
    endTime,
    durationMinutes,
    title: getText(settings.titleProperty),
    taskId: getRelationId(settings.taskProperty),
    status: getStatus(settings.statusProperty),
    syncStatus: 'synced',
    localOnly: false
  };
}

/**
 * Fetch time logs from Notion
 */
export async function fetchTimeLogs(limit: number = 100): Promise<TimeLogEntry[]> {
  const settings = getTimeLogSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey || !settings.databaseId) {
    console.warn('[NotionTimeLogs] Cannot fetch - no settings configured');
    return [];
  }
  
  console.log('[NotionTimeLogs] Fetching time logs...');
  
  const notionClient = getClient();
  const timeLogs: TimeLogEntry[] = [];
  let cursor: string | undefined;
  let fetched = 0;
  
  do {
    const response: any = await withRetry(
      notionClient,
      () => (notionClient.databases as any).query({
        database_id: settings.databaseId,
        page_size: Math.min(100, limit - fetched),
        start_cursor: cursor,
        sorts: settings.startTimeProperty ? [
          { property: settings.startTimeProperty, direction: 'descending' }
        ] : undefined
      }),
      'Fetch time logs'
    );
    
    for (const page of response.results) {
      try {
        timeLogs.push(parseNotionPage(page, settings));
        fetched++;
        if (fetched >= limit) break;
      } catch (err) {
        console.warn('[NotionTimeLogs] Failed to parse page:', page.id, err);
      }
    }
    
    cursor = response.has_more && fetched < limit ? response.next_cursor : undefined;
  } while (cursor);
  
  console.log(`[NotionTimeLogs] Fetched ${timeLogs.length} time logs`);
  return timeLogs;
}

/**
 * Create a new time log entry in Notion
 */
export async function createTimeLog(payload: TimeLogEntryPayload): Promise<TimeLogEntry | null> {
  const settings = getTimeLogSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey || !settings.databaseId) {
    throw new Error('Time log settings not configured');
  }
  
  console.log('[NotionTimeLogs] Creating time log for task:', payload.taskTitle);
  
  const properties: any = {};
  
  // Title
  if (settings.titleProperty) {
    properties[settings.titleProperty] = {
      title: [{ text: { content: payload.taskTitle || 'Time Log' } }]
    };
  }
  
  // Task relation
  if (settings.taskProperty && payload.taskId) {
    properties[settings.taskProperty] = {
      relation: [{ id: payload.taskId }]
    };
  }
  
  // Status
  if (settings.statusProperty && payload.status) {
    properties[settings.statusProperty] = {
      status: { name: payload.status }
    };
  }
  
  // Start time
  if (settings.startTimeProperty && payload.startTime) {
    properties[settings.startTimeProperty] = {
      date: { start: payload.startTime }
    };
  }
  
  // End time
  if (settings.endTimeProperty && payload.endTime) {
    properties[settings.endTimeProperty] = {
      date: { start: payload.endTime }
    };
  }
  
  const notionClient = getClient();
  const page = await withRetry(
    notionClient,
    () => notionClient.pages.create({
      parent: { database_id: settings.databaseId },
      properties
    }),
    'Create time log'
  );
  
  console.log('[NotionTimeLogs] Created time log:', page.id);
  return parseNotionPage(page, settings);
}

/**
 * Update a time log entry in Notion
 */
export async function updateTimeLog(
  timeLogId: string,
  updates: { startTime?: string; endTime?: string; status?: string }
): Promise<TimeLogEntry | null> {
  const settings = getTimeLogSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey) {
    throw new Error('Notion not configured');
  }
  
  console.log('[NotionTimeLogs] Updating time log:', timeLogId.substring(0, 8));
  
  const properties: any = {};
  
  // Start time
  if (updates.startTime !== undefined && settings.startTimeProperty) {
    properties[settings.startTimeProperty] = {
      date: updates.startTime ? { start: updates.startTime } : null
    };
  }
  
  // End time
  if (updates.endTime !== undefined && settings.endTimeProperty) {
    properties[settings.endTimeProperty] = {
      date: updates.endTime ? { start: updates.endTime } : null
    };
  }
  
  // Status
  if (updates.status !== undefined && settings.statusProperty) {
    properties[settings.statusProperty] = {
      status: { name: updates.status }
    };
  }
  
  const notionClient = getClient();
  const page = await withRetry(
    notionClient,
    () => notionClient.pages.update({
      page_id: timeLogId,
      properties
    }),
    'Update time log'
  );
  
  console.log('[NotionTimeLogs] Updated time log:', timeLogId.substring(0, 8));
  return parseNotionPage(page, settings);
}

/**
 * Check if time logs are configured
 */
export function isConfigured(): boolean {
  const settings = getTimeLogSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  return Boolean(apiKey && settings.databaseId);
}

