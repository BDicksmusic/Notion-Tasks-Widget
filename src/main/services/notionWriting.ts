/**
 * Notion Writing Service
 * 
 * Simple, direct API operations for writing entries.
 * No timers, no queues, no hidden automation.
 */

import { Client } from '@notionhq/client';
import type { WritingEntryPayload, WritingSettings } from '../../shared/types';
import { createNotionClient, withRetry } from './notionApi';
import { getWritingSettings, getTaskSettings } from '../configStore';

// Cache the client
let client: Client | null = null;
let cachedApiKey: string | null = null;

interface WritingEntry extends WritingEntryPayload {
  id: string;
  uniqueId?: string;
  url?: string;
  lastEdited?: string;
}

/**
 * Get or create the Notion client
 */
function getClient(): Client {
  const writingSettings = getWritingSettings();
  const taskSettings = getTaskSettings();
  const apiKey = writingSettings.apiKey || taskSettings.apiKey;
  
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
 * Parse a Notion page into a WritingEntry object
 */
function parseNotionPage(page: any, settings: WritingSettings): WritingEntry {
  const props = page.properties || {};
  
  const getText = (propName?: string): string | undefined => {
    if (!propName) return undefined;
    const prop = props[propName];
    if (!prop) return undefined;
    
    if (prop.type === 'title') {
      return prop.title?.[0]?.plain_text;
    }
    if (prop.type === 'rich_text') {
      return prop.rich_text?.map((t: any) => t.plain_text).join('') ?? undefined;
    }
    return undefined;
  };
  
  const getMultiSelect = (propName?: string): string[] | undefined => {
    if (!propName) return undefined;
    const prop = props[propName];
    if (!prop || prop.type !== 'multi_select') return undefined;
    return prop.multi_select?.map((s: any) => s.name);
  };
  
  const getStatus = (propName?: string): string | undefined => {
    if (!propName) return undefined;
    const prop = props[propName];
    if (!prop) return undefined;
    
    if (prop.type === 'status') {
      return prop.status?.name;
    }
    if (prop.type === 'select') {
      return prop.select?.name;
    }
    return undefined;
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
  
  return {
    id: page.id,
    uniqueId: getUniqueId(),
    title: getText(settings.titleProperty) ?? 'Untitled',
    content: '', // Content is in page blocks, not properties
    summary: getText(settings.summaryProperty),
    tags: getMultiSelect(settings.tagsProperty),
    status: getStatus(settings.statusProperty),
    url: page.url,
    lastEdited: page.last_edited_time
  };
}

/**
 * Fetch writing entries from Notion
 */
export async function fetchWritingEntries(limit: number = 50): Promise<WritingEntry[]> {
  const settings = getWritingSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey || !settings.databaseId) {
    console.warn('[NotionWriting] Cannot fetch - no settings configured');
    return [];
  }
  
  console.log('[NotionWriting] Fetching writing entries...');
  
  const notionClient = getClient();
  const entries: WritingEntry[] = [];
  let cursor: string | undefined;
  let fetched = 0;
  
  do {
    const response: any = await withRetry(
      notionClient,
      () => (notionClient.databases as any).query({
        database_id: settings.databaseId,
        page_size: Math.min(100, limit - fetched),
        start_cursor: cursor
      }),
      'Fetch writing entries'
    );
    
    for (const page of response.results) {
      try {
        entries.push(parseNotionPage(page, settings));
        fetched++;
        if (fetched >= limit) break;
      } catch (err) {
        console.warn('[NotionWriting] Failed to parse page:', page.id, err);
      }
    }
    
    cursor = response.has_more && fetched < limit ? response.next_cursor : undefined;
  } while (cursor);
  
  console.log(`[NotionWriting] Fetched ${entries.length} writing entries`);
  return entries;
}

/**
 * Create a new writing entry in Notion
 */
export async function createWritingEntry(payload: WritingEntryPayload): Promise<WritingEntry | null> {
  const settings = getWritingSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey || !settings.databaseId) {
    throw new Error('Writing settings not configured');
  }
  
  console.log('[NotionWriting] Creating writing entry:', payload.title);
  
  const properties: any = {
    [settings.titleProperty]: {
      title: [{ text: { content: payload.title } }]
    }
  };
  
  // Summary
  if (settings.summaryProperty && payload.summary) {
    properties[settings.summaryProperty] = {
      rich_text: [{ text: { content: payload.summary } }]
    };
  }
  
  // Tags
  if (settings.tagsProperty && payload.tags?.length) {
    properties[settings.tagsProperty] = {
      multi_select: payload.tags.map(name => ({ name }))
    };
  }
  
  // Status
  if (settings.statusProperty && payload.status) {
    properties[settings.statusProperty] = {
      status: { name: payload.status }
    };
  }
  
  const notionClient = getClient();
  
  // Create the page
  const page = await withRetry(
    notionClient,
    () => notionClient.pages.create({
      parent: { database_id: settings.databaseId },
      properties
    }),
    'Create writing entry'
  );
  
  // Add content as blocks if provided
  if (payload.content) {
    try {
      await withRetry(
        notionClient,
        () => notionClient.blocks.children.append({
          block_id: page.id,
          children: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ type: 'text', text: { content: payload.content } }]
              }
            }
          ]
        }),
        'Add writing content'
      );
    } catch (err) {
      console.warn('[NotionWriting] Failed to add content blocks:', err);
    }
  }
  
  console.log('[NotionWriting] Created writing entry:', page.id);
  return parseNotionPage(page, settings);
}

/**
 * Update a writing entry in Notion
 */
export async function updateWritingEntry(
  entryId: string,
  updates: Partial<WritingEntryPayload>
): Promise<WritingEntry | null> {
  const settings = getWritingSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey) {
    throw new Error('Notion not configured');
  }
  
  console.log('[NotionWriting] Updating writing entry:', entryId.substring(0, 8));
  
  const properties: any = {};
  
  // Title
  if (updates.title !== undefined) {
    properties[settings.titleProperty] = {
      title: [{ text: { content: updates.title } }]
    };
  }
  
  // Summary
  if (updates.summary !== undefined && settings.summaryProperty) {
    properties[settings.summaryProperty] = {
      rich_text: updates.summary ? [{ text: { content: updates.summary } }] : []
    };
  }
  
  // Tags
  if (updates.tags !== undefined && settings.tagsProperty) {
    properties[settings.tagsProperty] = {
      multi_select: (updates.tags ?? []).map(name => ({ name }))
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
      page_id: entryId,
      properties
    }),
    'Update writing entry'
  );
  
  console.log('[NotionWriting] Updated writing entry:', entryId.substring(0, 8));
  return parseNotionPage(page, settings);
}

/**
 * Check if writing is configured
 */
export function isConfigured(): boolean {
  const settings = getWritingSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  return Boolean(apiKey && settings.databaseId);
}

