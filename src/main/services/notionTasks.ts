/**
 * Notion Tasks Service
 * 
 * Simple, direct API operations for tasks.
 * No timers, no queues, no hidden automation.
 * Call these functions when YOU want to sync.
 */

import { Client } from '@notionhq/client';
import type { 
  Task, 
  NotionCreatePayload, 
  TaskUpdatePayload,
  TaskStatusOption,
  NotionSettings 
} from '../../shared/types';
import { createNotionClient, withRetry } from './notionApi';
import { getTaskSettings } from '../configStore';

// Cache the client to avoid recreating it
let client: Client | null = null;
let cachedSettings: NotionSettings | null = null;

/**
 * Get or create the Notion client
 */
function getClient(): Client {
  const settings = getTaskSettings();
  
  // Recreate client if settings changed
  if (!client || settings.apiKey !== cachedSettings?.apiKey) {
    if (!settings.apiKey) {
      throw new Error('Notion API key not configured');
    }
    client = createNotionClient(settings.apiKey);
    cachedSettings = settings;
  }
  
  return client;
}

/**
 * Test the connection to Notion
 */
export async function testConnection(): Promise<boolean> {
  try {
    const settings = getTaskSettings();
    if (!settings.apiKey || !settings.databaseId) {
      return false;
    }
    
    const notionClient = getClient();
    await withRetry(
      notionClient,
      () => notionClient.databases.retrieve({ database_id: settings.databaseId }),
      'Test connection'
    );
    return true;
  } catch (error) {
    console.error('[NotionTasks] Connection test failed:', error);
    return false;
  }
}

/**
 * Fetch status options from the database schema
 */
export async function fetchStatusOptions(): Promise<TaskStatusOption[]> {
  const settings = getTaskSettings();
  if (!settings.apiKey || !settings.databaseId) {
    return [];
  }
  
  try {
    const notionClient = getClient();
    const db = await withRetry(
      notionClient,
      () => notionClient.databases.retrieve({ database_id: settings.databaseId }),
      'Fetch database schema'
    );
    
    const statusProp = (db as any).properties?.[settings.statusProperty];
    if (!statusProp || statusProp.type !== 'status') {
      return [];
    }
    
    const options: TaskStatusOption[] = [];
    for (const opt of statusProp.status?.options ?? []) {
      options.push({
        id: opt.id,
        name: opt.name,
        color: opt.color
      });
    }
    
    return options;
  } catch (error) {
    console.error('[NotionTasks] Failed to fetch status options:', error);
    return [];
  }
}

/**
 * Parse a Notion page into a Task object
 */
function parseNotionPage(page: any, settings: NotionSettings): Task {
  const props = page.properties || {};
  
  // Helper to get property value
  const getText = (propName: string): string | undefined => {
    const prop = props[propName];
    if (!prop) return undefined;
    
    if (prop.type === 'title') {
      return prop.title?.[0]?.plain_text;
    }
    if (prop.type === 'rich_text') {
      return prop.rich_text?.[0]?.plain_text;
    }
    return undefined;
  };
  
  const getStatus = (propName: string): string | undefined => {
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
  
  const getDate = (propName: string): { start?: string; end?: string } => {
    const prop = props[propName];
    if (!prop || prop.type !== 'date' || !prop.date) {
      return {};
    }
    return {
      start: prop.date.start,
      end: prop.date.end ?? undefined
    };
  };
  
  const getCheckbox = (propName: string, activeValue?: string): boolean => {
    const prop = props[propName];
    if (!prop) return false;
    
    if (prop.type === 'checkbox') {
      return prop.checkbox === true;
    }
    if (prop.type === 'status') {
      return prop.status?.name === activeValue;
    }
    if (prop.type === 'select') {
      return prop.select?.name === activeValue;
    }
    return false;
  };
  
  const getNumber = (propName: string): number | undefined => {
    const prop = props[propName];
    if (!prop || prop.type !== 'number') return undefined;
    return prop.number ?? undefined;
  };
  
  const getSelect = (propName: string): { name: string; color?: string } | undefined => {
    const prop = props[propName];
    if (!prop || prop.type !== 'select' || !prop.select) return undefined;
    return { name: prop.select.name, color: prop.select.color };
  };
  
  const getRelationIds = (propName: string): string[] | undefined => {
    const prop = props[propName];
    if (!prop || prop.type !== 'relation') return undefined;
    return prop.relation?.map((r: any) => r.id) ?? [];
  };
  
  const getMultiSelect = (propName: string): string[] | undefined => {
    const prop = props[propName];
    if (!prop || prop.type !== 'multi_select') return undefined;
    return prop.multi_select?.map((s: any) => s.name) ?? [];
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
  
  // Parse the date property
  const dateInfo = getDate(settings.dateProperty);
  
  // Parse order property
  const orderSelect = settings.orderProperty ? getSelect(settings.orderProperty) : undefined;
  
  // Determine deadline type
  const deadlineProp = props[settings.deadlineProperty];
  let hardDeadline = false;
  if (deadlineProp) {
    if (deadlineProp.type === 'select') {
      hardDeadline = deadlineProp.select?.name === settings.deadlineHardValue;
    } else if (deadlineProp.type === 'status') {
      hardDeadline = deadlineProp.status?.name === settings.deadlineHardValue;
    }
  }
  
  return {
    id: page.id,
    uniqueId: getUniqueId(),
    title: getText(settings.titleProperty) ?? 'Untitled',
    status: getStatus(settings.statusProperty),
    dueDate: dateInfo.start,
    dueDateEnd: dateInfo.end,
    url: page.url,
    lastEdited: page.last_edited_time,
    hardDeadline,
    urgent: getCheckbox(settings.urgentProperty, settings.urgentStatusActive),
    important: getCheckbox(settings.importantProperty, settings.importantStatusActive),
    mainEntry: settings.mainEntryProperty ? getText(settings.mainEntryProperty) : undefined,
    sessionLengthMinutes: settings.sessionLengthProperty ? getNumber(settings.sessionLengthProperty) : undefined,
    estimatedLengthMinutes: settings.estimatedLengthProperty ? getNumber(settings.estimatedLengthProperty) : undefined,
    orderValue: orderSelect?.name,
    orderColor: orderSelect?.color,
    projectIds: settings.projectRelationProperty ? getRelationIds(settings.projectRelationProperty) : undefined,
    recurrence: settings.recurrenceProperty ? getMultiSelect(settings.recurrenceProperty) : undefined,
    parentTaskId: settings.parentTaskProperty ? getRelationIds(settings.parentTaskProperty)?.[0] : undefined,
    syncStatus: 'synced',
    localOnly: false
  };
}

/**
 * Fetch active tasks from Notion
 * Active = not completed status
 */
export async function fetchActiveTasks(): Promise<Task[]> {
  const settings = getTaskSettings();
  if (!settings.apiKey || !settings.databaseId) {
    console.warn('[NotionTasks] Cannot fetch - no settings configured');
    return [];
  }
  
  console.log('[NotionTasks] Fetching active tasks...');
  
  const notionClient = getClient();
  const tasks: Task[] = [];
  let cursor: string | undefined;
  
  do {
    const response: any = await withRetry(
      notionClient,
      () => (notionClient.databases as any).query({
        database_id: settings.databaseId,
        filter: {
          property: settings.statusProperty,
          status: {
            does_not_equal: settings.completedStatus
          }
        },
        page_size: 100,
        start_cursor: cursor
      }),
      'Fetch active tasks'
    );
    
    for (const page of response.results) {
      try {
        tasks.push(parseNotionPage(page, settings));
      } catch (err) {
        console.warn('[NotionTasks] Failed to parse page:', page.id, err);
      }
    }
    
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  
  console.log(`[NotionTasks] Fetched ${tasks.length} active tasks`);
  return tasks;
}

/**
 * Fetch a single task by ID
 */
export async function fetchTask(taskId: string): Promise<Task | null> {
  const settings = getTaskSettings();
  if (!settings.apiKey) {
    return null;
  }
  
  try {
    const notionClient = getClient();
    const page = await withRetry(
      notionClient,
      () => notionClient.pages.retrieve({ page_id: taskId }),
      `Fetch task ${taskId.substring(0, 8)}`
    );
    
    return parseNotionPage(page, settings);
  } catch (error) {
    console.error('[NotionTasks] Failed to fetch task:', taskId, error);
    return null;
  }
}

/**
 * Create a new task in Notion
 */
export async function createTask(payload: NotionCreatePayload): Promise<Task | null> {
  const settings = getTaskSettings();
  if (!settings.apiKey || !settings.databaseId) {
    throw new Error('Notion not configured');
  }
  
  console.log('[NotionTasks] Creating task:', payload.title);
  
  const properties: any = {
    [settings.titleProperty]: {
      title: [{ text: { content: payload.title } }]
    }
  };
  
  // Status
  if (payload.status) {
    properties[settings.statusProperty] = {
      status: { name: payload.status }
    };
  }
  
  // Date
  if (payload.date) {
    properties[settings.dateProperty] = {
      date: {
        start: payload.date,
        end: payload.dateEnd ?? undefined
      }
    };
  }
  
  // Deadline type
  if (payload.hardDeadline !== undefined) {
    properties[settings.deadlineProperty] = {
      select: { 
        name: payload.hardDeadline ? settings.deadlineHardValue : settings.deadlineSoftValue 
      }
    };
  }
  
  // Urgent
  if (payload.urgent !== undefined) {
    properties[settings.urgentProperty] = {
      status: { 
        name: payload.urgent ? settings.urgentStatusActive : settings.urgentStatusInactive 
      }
    };
  }
  
  // Important
  if (payload.important !== undefined) {
    properties[settings.importantProperty] = {
      status: { 
        name: payload.important ? settings.importantStatusActive : settings.importantStatusInactive 
      }
    };
  }
  
  // Main entry
  if (payload.mainEntry && settings.mainEntryProperty) {
    properties[settings.mainEntryProperty] = {
      rich_text: [{ text: { content: payload.mainEntry } }]
    };
  }
  
  // Projects
  if (payload.projectIds && settings.projectRelationProperty) {
    properties[settings.projectRelationProperty] = {
      relation: payload.projectIds.map(id => ({ id }))
    };
  }
  
  // Parent task (for subtasks)
  if (payload.parentTaskId && settings.parentTaskProperty) {
    properties[settings.parentTaskProperty] = {
      relation: [{ id: payload.parentTaskId }]
    };
  }
  
  const notionClient = getClient();
  const page = await withRetry(
    notionClient,
    () => notionClient.pages.create({
      parent: { database_id: settings.databaseId },
      properties
    }),
    'Create task'
  );
  
  console.log('[NotionTasks] Created task:', page.id);
  return parseNotionPage(page, settings);
}

/**
 * Update a task in Notion
 */
export async function updateTask(taskId: string, updates: TaskUpdatePayload): Promise<Task | null> {
  const settings = getTaskSettings();
  if (!settings.apiKey) {
    throw new Error('Notion not configured');
  }
  
  console.log('[NotionTasks] Updating task:', taskId.substring(0, 8));
  
  const properties: any = {};
  
  // Title
  if (updates.title !== undefined) {
    properties[settings.titleProperty] = {
      title: [{ text: { content: updates.title } }]
    };
  }
  
  // Status
  if (updates.status !== undefined) {
    properties[settings.statusProperty] = {
      status: { name: updates.status }
    };
  }
  
  // Date
  if (updates.dueDate !== undefined) {
    if (updates.dueDate === null) {
      properties[settings.dateProperty] = { date: null };
    } else {
      properties[settings.dateProperty] = {
        date: {
          start: updates.dueDate,
          end: updates.dueDateEnd ?? undefined
        }
      };
    }
  }
  
  // Deadline type
  if (updates.hardDeadline !== undefined) {
    properties[settings.deadlineProperty] = {
      select: { 
        name: updates.hardDeadline ? settings.deadlineHardValue : settings.deadlineSoftValue 
      }
    };
  }
  
  // Urgent
  if (updates.urgent !== undefined) {
    properties[settings.urgentProperty] = {
      status: { 
        name: updates.urgent ? settings.urgentStatusActive : settings.urgentStatusInactive 
      }
    };
  }
  
  // Important
  if (updates.important !== undefined) {
    properties[settings.importantProperty] = {
      status: { 
        name: updates.important ? settings.importantStatusActive : settings.importantStatusInactive 
      }
    };
  }
  
  // Main entry
  if (updates.mainEntry !== undefined && settings.mainEntryProperty) {
    if (updates.mainEntry === null) {
      properties[settings.mainEntryProperty] = { rich_text: [] };
    } else {
      properties[settings.mainEntryProperty] = {
        rich_text: [{ text: { content: updates.mainEntry } }]
      };
    }
  }
  
  // Session length
  if (updates.sessionLengthMinutes !== undefined && settings.sessionLengthProperty) {
    properties[settings.sessionLengthProperty] = {
      number: updates.sessionLengthMinutes
    };
  }
  
  // Estimated length
  if (updates.estimatedLengthMinutes !== undefined && settings.estimatedLengthProperty) {
    properties[settings.estimatedLengthProperty] = {
      number: updates.estimatedLengthMinutes
    };
  }
  
  // Order
  if (updates.orderValue !== undefined && settings.orderProperty) {
    if (updates.orderValue === null) {
      properties[settings.orderProperty] = { select: null };
    } else {
      properties[settings.orderProperty] = {
        select: { name: updates.orderValue }
      };
    }
  }
  
  // Projects
  if (updates.projectIds !== undefined && settings.projectRelationProperty) {
    if (updates.projectIds === null || updates.projectIds.length === 0) {
      properties[settings.projectRelationProperty] = { relation: [] };
    } else {
      properties[settings.projectRelationProperty] = {
        relation: updates.projectIds.map(id => ({ id }))
      };
    }
  }
  
  // Recurrence
  if (updates.recurrence !== undefined && settings.recurrenceProperty) {
    if (updates.recurrence === null || updates.recurrence.length === 0) {
      properties[settings.recurrenceProperty] = { multi_select: [] };
    } else {
      properties[settings.recurrenceProperty] = {
        multi_select: updates.recurrence.map(name => ({ name }))
      };
    }
  }
  
  const notionClient = getClient();
  const page = await withRetry(
    notionClient,
    () => notionClient.pages.update({
      page_id: taskId,
      properties
    }),
    'Update task'
  );
  
  console.log('[NotionTasks] Updated task:', taskId.substring(0, 8));
  return parseNotionPage(page, settings);
}

/**
 * Archive (soft delete) a task in Notion
 */
export async function archiveTask(taskId: string): Promise<boolean> {
  const settings = getTaskSettings();
  if (!settings.apiKey) {
    throw new Error('Notion not configured');
  }
  
  console.log('[NotionTasks] Archiving task:', taskId.substring(0, 8));
  
  const notionClient = getClient();
  await withRetry(
    notionClient,
    () => notionClient.pages.update({
      page_id: taskId,
      archived: true
    }),
    'Archive task'
  );
  
  console.log('[NotionTasks] Archived task:', taskId.substring(0, 8));
  return true;
}

/**
 * Check if Notion is properly configured
 */
export function isConfigured(): boolean {
  const settings = getTaskSettings();
  return Boolean(settings.apiKey && settings.databaseId);
}

/**
 * Get current settings snapshot (for diagnostics)
 */
export function getSettingsSnapshot(): Partial<NotionSettings> {
  const settings = getTaskSettings();
  return {
    databaseId: settings.databaseId,
    titleProperty: settings.titleProperty,
    statusProperty: settings.statusProperty,
    dateProperty: settings.dateProperty,
    completedStatus: settings.completedStatus
    // Don't expose API key
  };
}

