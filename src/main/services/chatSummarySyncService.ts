/**
 * Chat Summary Notion Sync Service
 * 
 * Handles syncing chat summaries to a Notion database when configured.
 * Uses the existing Notion client infrastructure.
 */

import type { ChatSummary } from '../../shared/types';
import { getChatbotSettings } from '../configStore';
import {
  getPendingSyncSummaries,
  updateChatSummarySyncStatus
} from '../db/repositories/chatSummaryRepository';

// Notion API version - using latest (2025-09-03) for Data Sources API
const NOTION_API_VERSION = '2025-09-03';

// Notion API request helper
async function notionRequest(
  apiKey: string,
  endpoint: string,
  method: 'GET' | 'POST' | 'PATCH' = 'POST',
  body?: unknown
): Promise<unknown> {
  const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': NOTION_API_VERSION,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Notion API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// Cache for data source IDs
const dataSourceIdCache = new Map<string, string>();

/**
 * Get the data_source_id for a database (SDK 5.x / API 2025-09-03)
 */
async function getDataSourceId(apiKey: string, databaseId: string): Promise<string> {
  if (dataSourceIdCache.has(databaseId)) {
    return dataSourceIdCache.get(databaseId)!;
  }
  
  const db = await notionRequest(apiKey, `/databases/${databaseId}`, 'GET') as any;
  const dataSourceId = db.data_sources?.[0]?.id || databaseId;
  dataSourceIdCache.set(databaseId, dataSourceId);
  return dataSourceId;
}

interface NotionPageResponse {
  id: string;
  url: string;
}

/**
 * Create a Notion page for a chat summary
 */
export async function createNotionSummaryPage(
  summary: ChatSummary
): Promise<{ pageId: string; url: string } | null> {
  const settings = getChatbotSettings();
  
  // Check if Notion sync is configured
  if (!settings.summaryDatabaseId || !settings.openaiApiKey) {
    // Use the main Notion API key from task settings if available
    // For now, we'll skip sync if not configured
    console.log('[ChatSummarySync] Notion sync not configured, skipping');
    return null;
  }

  // We need to get an API key - prefer the one from task settings
  // This requires access to the main config, which we'll handle via the caller
  return null;
}

/**
 * Sync a single chat summary to Notion
 */
export async function syncSummaryToNotion(
  summary: ChatSummary,
  notionApiKey: string,
  databaseId: string
): Promise<{ pageId: string; url: string }> {
  // Format actions for display
  const actionsText = summary.actions
    .map((action, index) => {
      switch (action.type) {
        case 'create_task':
          return `${index + 1}. Created task: "${action.task.title}"`;
        case 'update_status':
          return `${index + 1}. Updated status of task ${action.taskId} to "${action.status}"`;
        case 'update_dates':
          return `${index + 1}. Updated dates for task ${action.taskId}`;
        case 'add_notes':
          return `${index + 1}. Added notes to task ${action.taskId}`;
        case 'assign_projects':
          return `${index + 1}. Assigned task ${action.taskId} to projects`;
        case 'log_time':
          return `${index + 1}. Logged ${action.minutes} minutes for task ${action.taskId}`;
        default:
          return `${index + 1}. Unknown action`;
      }
    })
    .join('\n');

  // SDK 5.x: Get data_source_id for parent
  const dataSourceId = await getDataSourceId(notionApiKey, databaseId);
  
  const pageContent = {
    parent: { data_source_id: dataSourceId },
    properties: {
      Name: {
        title: [
          {
            text: {
              content: summary.title
            }
          }
        ]
      }
    },
    children: [
      {
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: 'Transcript' } }]
        }
      },
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: summary.transcript } }]
        }
      },
      {
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: 'Actions Taken' } }]
        }
      },
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: actionsText || 'No actions taken' } }]
        }
      },
      ...(summary.summaryText ? [
        {
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: 'Summary' } }]
          }
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: summary.summaryText } }]
          }
        }
      ] : [])
    ]
  };

  const response = await notionRequest(
    notionApiKey,
    '/pages',
    'POST',
    pageContent
  ) as NotionPageResponse;

  return {
    pageId: response.id,
    url: `https://notion.so/${response.id.replace(/-/g, '')}`
  };
}

/**
 * Process pending chat summary syncs
 * Called periodically by the sync engine
 */
export async function processPendingSummarySyncs(
  notionApiKey: string,
  databaseId: string
): Promise<{ synced: number; failed: number }> {
  const pending = getPendingSyncSummaries();
  let synced = 0;
  let failed = 0;

  for (const summary of pending) {
    try {
      const result = await syncSummaryToNotion(summary, notionApiKey, databaseId);
      updateChatSummarySyncStatus(summary.id, 'synced', result.pageId);
      synced++;
      console.log(`[ChatSummarySync] Synced summary ${summary.id} to Notion page ${result.pageId}`);
    } catch (error) {
      failed++;
      console.error(`[ChatSummarySync] Failed to sync summary ${summary.id}:`, error);
      // Don't mark as failed yet - will retry on next sync
    }
  }

  return { synced, failed };
}

