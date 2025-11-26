import { Client } from '@notionhq/client';
import type {
  PageObjectResponse,
  CreatePageParameters
} from '@notionhq/client/build/src/api-endpoints';
import {
  mapPageToTask,
  markdownBlocksToNotion,
  textToRichText
} from '../../common/notion';
import type {
  Contact,
  ContactsSettings,
  MarkdownBlock,
  MarkdownRichText,
  NotionCreatePayload,
  NotionSettings,
  Project,
  ProjectsSettings,
  Task,
  TaskOrderOption,
  TaskStatusOption,
  TaskUpdatePayload,
  TimeLogEntryPayload,
  TimeLogEntry,
  TimeLogSettings,
  TimeLogUpdatePayload,
  WritingEntryPayload,
  WritingSettings
} from '../../shared/types';
import { convertMarkdown } from '../../shared/markdown';
import { createNotionClient, withRetry, andFilters, classifyError, getErrorMessage } from './notionApi';

let notion: Client | null = null;
let settings: NotionSettings;
let writingSettings: WritingSettings | null = null;
let writingClient: Client | null = null;
let timeLogSettings: TimeLogSettings | null = null;
let timeLogClient: Client | null = null;
let projectsSettings: ProjectsSettings | null = null;
let projectsClient: Client | null = null;
let contactsSettings: ContactsSettings | null = null;
let contactsClient: Client | null = null;
let cachedDataSourceId: string | null = null;
let cachedStatusOptions: TaskStatusOption[] | null = null;
let cachedOrderOptions: TaskOrderOption[] | null = null;
let cachedOrderPropertyType: 'select' | 'status' | null = null;
let cachedStatusPropertyType: 'select' | 'status' | null = null;
let cachedProjectStatusOptions: TaskStatusOption[] | null = null;
let cachedProjectPropertyIds: Map<string, string> | null = null;
let cachedContactPropertyIds: Map<string, string> | null = null;
let cachedContacts: Contact[] | null = null;
let contactsFetchedAt: number | null = null;

// Cache for property name -> ID mapping (filter_properties requires IDs, not names)
let cachedPropertyIds: Map<string, string> | null = null;

// Notion SDK v2 types don't fully export query method types, so we define the response shape
interface QueryDatabaseResult {
  results: Array<PageObjectResponse | { object: string; [key: string]: unknown }>;
  next_cursor: string | null;
  has_more: boolean;
}

export function setNotionSettings(next: NotionSettings) {
  settings = next;
  
  // Gracefully handle missing API key - Notion is optional
  if (!settings.apiKey?.trim()) {
    console.log('[Notion] No API key configured - running in local-only mode');
    notion = null;
    cachedDataSourceId = null;
    cachedStatusOptions = null;
    cachedOrderOptions = null;
    cachedOrderPropertyType = null;
    cachedStatusPropertyType = null;
    cachedPropertyIds = null;
    return;
  }
  
  if (!settings.databaseId?.trim()) {
    console.log('[Notion] API key set but no database ID - Notion features limited');
  }
  
  notion = createNotionClient(settings.apiKey);
  cachedDataSourceId = settings.dataSourceId ?? null;
  cachedStatusOptions = null;
  cachedOrderOptions = null;
  cachedOrderPropertyType = null;
  cachedStatusPropertyType = null;
  cachedPropertyIds = null; // Clear property ID cache when settings change
}

/**
 * Fetch and cache property IDs from the database schema.
 * filter_properties requires property IDs, not names.
 * This only needs to run once per session.
 */
async function getPropertyIds(): Promise<Map<string, string>> {
  if (cachedPropertyIds) {
    return cachedPropertyIds;
  }
  
  if (!notion) {
    throw new Error('Notion client not initialized');
  }
  
  const dbId = getDatabaseId();
  console.log('[Notion] Fetching database schema for property IDs...');
  
  try {
    const database = await withRetry(
      notion,
      () => notion!.databases.retrieve({ database_id: dbId }),
      'Retrieve database schema'
    );
    
    cachedPropertyIds = new Map();
    const props = (database as any).properties || {};
    
    for (const [name, prop] of Object.entries(props)) {
      const propObj = prop as any;
      cachedPropertyIds.set(name, propObj.id);
    }
    
    console.log(`[Notion] Cached ${cachedPropertyIds.size} property IDs`);
    return cachedPropertyIds;
  } catch (err) {
    console.error('[Notion] Failed to fetch property IDs:', err);
    // Return empty map - will fallback to fetching all properties
    return new Map();
  }
}

/**
 * Convert property names to IDs for filter_properties.
 * Skips rollup/formula properties to avoid timeouts.
 */
async function getFilterPropertyIds(propertyNames: string[]): Promise<string[]> {
  const idMap = await getPropertyIds();
  
  if (idMap.size === 0) {
    // Fallback: don't use filter_properties if we can't get IDs
    console.log('[Notion] No property ID mapping available, skipping filter_properties');
    return [];
  }
  
  const ids: string[] = [];
  for (const name of propertyNames) {
    if (!name?.trim()) continue;
    const id = idMap.get(name);
    if (id) {
      ids.push(id);
    } else {
      console.log(`[Notion] Property "${name}" not found in schema, skipping`);
    }
  }
  
  return ids;
}

export function getNotionSettingsSnapshot(): NotionSettings | null {
  return settings ?? null;
}

export function setWritingSettings(next: WritingSettings) {
  writingSettings = next;
  if (writingSettings?.apiKey && writingSettings.apiKey.trim()) {
    writingClient = createNotionClient(writingSettings.apiKey);
  } else {
    writingClient = null;
  }
}

export function setTimeLogSettings(next: TimeLogSettings) {
  timeLogSettings = next;
  if (timeLogSettings?.apiKey && timeLogSettings.apiKey.trim()) {
    timeLogClient = createNotionClient(timeLogSettings.apiKey);
  } else {
    timeLogClient = null;
  }
}

export function setProjectsSettings(next: ProjectsSettings) {
  projectsSettings = next;
  cachedProjectStatusOptions = null; // Clear cache when settings change
  cachedProjectPropertyIds = null; // Clear property ID cache when settings change
  if (projectsSettings?.apiKey && projectsSettings.apiKey.trim()) {
    projectsClient = createNotionClient(projectsSettings.apiKey);
  } else {
    projectsClient = null;
  }
}

export function setContactsSettings(next: ContactsSettings) {
  contactsSettings = next;
  cachedContacts = null;
  contactsFetchedAt = null;
  cachedContactPropertyIds = null;
  if (contactsSettings?.apiKey && contactsSettings.apiKey.trim()) {
    contactsClient = createNotionClient(contactsSettings.apiKey);
  } else {
    contactsClient = null;
  }
}

function bindDatabaseQuery(client: Client) {
  if (!client) {
    throw new Error('Notion client is null or undefined');
  }
  // Cast to any to access query method (SDK v2 types don't fully expose it)
  return (client.databases as any).query.bind(client.databases) as (
    args: Record<string, unknown>
  ) => Promise<QueryDatabaseResult>;
}

export async function createWritingEntry(
  payload: WritingEntryPayload
): Promise<string> {
  if (!writingSettings) {
    throw new Error('Writing widget is not configured yet');
  }

  const client = getWritingClient();
  const databaseId = getWritingDatabaseId();

  const safeTitle = payload.title?.trim();
  if (!safeTitle) {
    throw new Error('Writing entries require a title');
  }

  const safeContent = payload.content?.trim();
  if (!safeContent) {
    throw new Error('Writing entries require content');
  }

  const properties: Record<string, any> = {
    [writingSettings.titleProperty]: {
      title: textToRichText(safeTitle)
    }
  };

  if (writingSettings.summaryProperty && payload.summary) {
    properties[writingSettings.summaryProperty] = {
      rich_text: textToRichText(payload.summary)
    };
  }

  if (
    writingSettings.tagsProperty &&
    payload.tags &&
    payload.tags.length > 0
  ) {
    properties[writingSettings.tagsProperty] = {
      multi_select: payload.tags.map((tag) => ({ name: tag }))
    };
  }

  if (writingSettings.statusProperty && payload.status) {
    properties[writingSettings.statusProperty] = {
      status: { name: payload.status }
    };
  }

  let blockSource: MarkdownBlock[] | undefined =
    payload.contentBlocks && payload.contentBlocks.length
      ? payload.contentBlocks
      : undefined;
  if (!blockSource) {
    const conversion = await convertMarkdown(payload.content);
    blockSource = conversion.blocks;
  }
  const children = markdownBlocksToNotion(blockSource);

  const response = await client.pages.create({
    parent: { database_id: databaseId },
    properties,
    children
  });

  if (!isPageResponse(response)) {
    throw new Error('Notion did not return a page for the writing entry');
  }

  return response.id;
}

type RawQueryResult =
  | PageObjectResponse
  | {
      object: string;
      [key: string]: unknown;
    };

function isPage(result: RawQueryResult): result is PageObjectResponse {
  return result.object === 'page';
}

/**
 * Fetch tasks from Notion with retry logic and optional incremental sync.
 * @param since - ISO timestamp to only fetch tasks modified after this time (optional)
 * @param includeCompleted - Whether to include completed tasks (for full sync)
 */
export interface DateFilter {
  // Filter tasks by date property
  on_or_after?: string;  // ISO date string
  on_or_before?: string; // ISO date string
  is_empty?: boolean;    // Tasks with no date set
  is_not_empty?: boolean; // Tasks with any date set
}

export interface StatusFilter {
  // Filter tasks by status property
  equals?: string;        // Exact status match (e.g., '📋' for To-Do)
  does_not_equal?: string; // Exclude this status
}

export interface TaskPageOptions {
  since?: string | null;
  includeCompleted?: boolean;
  pageSize?: number;
  cursor?: string | null;
  dateFilter?: DateFilter;   // Optional date range filter
  statusFilter?: StatusFilter; // Optional status filter for partitioned imports
}

export interface TaskPageResult {
  tasks: Task[];
  nextCursor?: string | null;
}

export async function getTasksPage(options: TaskPageOptions = {}): Promise<TaskPageResult> {
  if (!notion) {
    // Return empty result when Notion isn't configured (local-only mode)
    return { tasks: [], nextCursor: null };
  }
  const dbId = getDatabaseId();
  const client = notion;

  const {
    since = null,
    includeCompleted = false,
    pageSize = 25, // Balanced page size - not too small, not too large
    cursor = null,
    dateFilter = undefined,
    statusFilter: partitionStatusFilter = undefined
  } = options;

  // Build status filter for partitioned imports (explicit status targeting)
  // This takes priority over the includeCompleted flag
  let statusPropertyFilter: Record<string, unknown> | undefined;
  if (partitionStatusFilter && settings.statusProperty) {
    if (partitionStatusFilter.equals) {
      statusPropertyFilter = {
        property: settings.statusProperty,
        status: { equals: partitionStatusFilter.equals }
      };
    } else if (partitionStatusFilter.does_not_equal) {
      statusPropertyFilter = {
        property: settings.statusProperty,
        status: { does_not_equal: partitionStatusFilter.does_not_equal }
      };
    }
  }

  // Fallback to completed status filter if no explicit partition filter
  // Exclude completed status directly in the Notion query whenever possible.
  const completedStatusName = settings.completedStatus?.trim();
  const shouldFilterCompleted = !includeCompleted && !partitionStatusFilter;
  
  const defaultStatusFilter = shouldFilterCompleted && completedStatusName && settings.statusProperty
    ? { property: settings.statusProperty, status: { does_not_equal: completedStatusName } }
    : undefined;

  const incrementalFilter = since
    ? {
        timestamp: 'last_edited_time' as const,
        last_edited_time: {
          on_or_after: since
        }
      }
    : undefined;

  // Build date filter for partitioned imports
  let datePropertyFilter: Record<string, unknown> | undefined;
  if (dateFilter && settings.dateProperty) {
    if (dateFilter.is_empty) {
      datePropertyFilter = {
        property: settings.dateProperty,
        date: { is_empty: true }
      };
    } else if (dateFilter.is_not_empty) {
      datePropertyFilter = {
        property: settings.dateProperty,
        date: { is_not_empty: true }
      };
    } else if (dateFilter.on_or_after || dateFilter.on_or_before) {
      const dateCondition: Record<string, string> = {};
      if (dateFilter.on_or_after) dateCondition.on_or_after = dateFilter.on_or_after;
      if (dateFilter.on_or_before) dateCondition.on_or_before = dateFilter.on_or_before;
      datePropertyFilter = {
        property: settings.dateProperty,
        date: dateCondition
      };
    }
  }

  // Combine filters: partition status OR default status, plus incremental + date
  const effectiveStatusFilter = statusPropertyFilter || defaultStatusFilter;
  const filter = andFilters(effectiveStatusFilter, incrementalFilter, datePropertyFilter);

  // Build filter_properties with MINIMAL set to reduce API load
  // For very complex databases, only request the absolute essentials
  // Other properties can be fetched separately when viewing individual tasks
  const essentialPropertyNames = [
    settings.titleProperty,   // Name - required
    settings.statusProperty,  // Status - required for filtering
    settings.dateProperty     // Date - required for scheduling
  ];
  
  // Additional properties ONLY if they're simple types (not relations/rollups)
  // These add some value but can be skipped if causing issues
  const additionalPropertyNames = [
    settings.urgentProperty,
    settings.importantProperty
  ].filter((prop): prop is string => Boolean(prop?.trim()));
  
  const allPropertyNames = Array.from(
    new Set([...essentialPropertyNames, ...additionalPropertyNames])
  ).filter((prop): prop is string => Boolean(prop?.trim()));

  // Convert property names to IDs (API requires IDs for filter_properties)
  const filterPropertyIds = await getFilterPropertyIds(allPropertyNames);

  const queryPayload: Record<string, unknown> = {
    database_id: dbId,
    page_size: pageSize,
    ...(cursor && { start_cursor: cursor }),
    ...(filter && { filter }),
    ...(filterPropertyIds.length && { filter_properties: filterPropertyIds })
  };

  // Verify status property is included
  const statusPropName = settings.statusProperty;
  const statusPropIncluded = allPropertyNames.includes(statusPropName);
  
  console.log('[Notion] Query payload:', {
    database_id: dbId,
    page_size: pageSize,
    filter_properties_count: filterPropertyIds.length,
    property_names: allPropertyNames,
    statusProperty: statusPropName,
    statusPropertyIncluded: statusPropIncluded,
    has_filter: !!filter,
    has_cursor: !!cursor
  });
  
  // CRITICAL: If status property isn't included, the status will ALWAYS be null!
  if (!statusPropIncluded) {
    console.warn(`[Notion] ⚠️ STATUS PROPERTY "${statusPropName}" NOT INCLUDED IN QUERY! Status will be null.`);
  }

  const queryDatabase = bindDatabaseQuery(client);
  const queryStart = Date.now();
  
  const response = (await withRetry(
    client,
    () => queryDatabase(queryPayload),
    'Query tasks'
  )) as QueryDatabaseResult;

  const queryTime = Date.now() - queryStart;
  console.log(`[Notion] Query completed in ${queryTime}ms, results: ${response.results.length}, has_more: ${response.has_more}, next_cursor: ${response.next_cursor ? 'yes' : 'no'}`);

  const pageTasks = response.results
    .filter(isPage)
    .map((page: PageObjectResponse) => mapPageToTask(page, settings));
  
  // Log status extraction summary
  const withStatus = pageTasks.filter(t => t.status).length;
  const withoutStatus = pageTasks.filter(t => !t.status).length;
  console.log(`[Notion] Mapped ${pageTasks.length} tasks from page (${withStatus} with status, ${withoutStatus} without)`);
  
  // Log first task without status for debugging (if any)
  if (withoutStatus > 0) {
    const noStatusTask = pageTasks.find(t => !t.status);
    if (noStatusTask) {
      console.log(`[Notion] Example task without status: "${noStatusTask.title}" (id: ${noStatusTask.id.substring(0, 8)}...)`);
    }
  }

  return {
    tasks: pageTasks,
    nextCursor: response.next_cursor ?? null
  };
}

export async function getTasks(
  since?: string | null,
  includeCompleted = false
): Promise<Task[]> {
  const allTasks: Task[] = [];
  let cursor: string | null | undefined = undefined;

  do {
    const { tasks, nextCursor } = await getTasksPage({
      since,
      includeCompleted,
      pageSize: 25, // Balanced page size
      cursor
    });
    allTasks.push(...tasks);
    cursor = nextCursor ?? null;
  } while (cursor);

  return allTasks;
}

/**
 * RELIABLE import strategy for complex databases that timeout
 * 
 * Strategy:
 * 1. Use small page_size queries to collect page IDs (reliable)
 * 2. Use pages.retrieve to fetch each page individually (fast, never times out)
 * 3. Retrieve pages in parallel for speed (2-3 at a time)
 * 
 * This is GUARANTEED to work even on databases with 50+ relations/rollups
 */
export interface ReliableImportResult {
  tasks: Task[];
  pageIds: string[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface TimeWindowFilter {
  // Filter by last_edited_time timestamp
  on_or_after?: string;  // ISO timestamp
  on_or_before?: string; // ISO timestamp
}

export async function getTasksBatchReliably(
  cursor?: string | null,
  batchSize: number = 5,
  timeWindow?: TimeWindowFilter
): Promise<ReliableImportResult> {
  if (!notion) {
    // Return empty result when Notion isn't configured (local-only mode)
    return { tasks: [], pageIds: [], nextCursor: null, hasMore: false };
  }
  const dbId = getDatabaseId();
  const client = notion;

  // Build time window filter if provided
  let filter: Record<string, unknown> | undefined;
  if (timeWindow) {
    const conditions: Record<string, unknown> = {};
    if (timeWindow.on_or_after) conditions.on_or_after = timeWindow.on_or_after;
    if (timeWindow.on_or_before) conditions.on_or_before = timeWindow.on_or_before;
    
    if (Object.keys(conditions).length > 0) {
      filter = {
        timestamp: 'last_edited_time',
        last_edited_time: conditions
      };
    }
  }

  // Step 1: Get multiple page IDs using small batch query
  const queryPayload: Record<string, unknown> = {
    database_id: dbId,
    page_size: batchSize,
    ...(cursor && { start_cursor: cursor }),
    ...(filter && { filter }),
    // Sort by last_edited_time descending to get most recent first
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }]
  };

  const queryStart = Date.now();
  const response = (await withRetry(
    client,
    () => client.databases.query(queryPayload as Parameters<typeof client.databases.query>[0]),
    'Get page IDs'
  )) as QueryDatabaseResult;

  console.log(`[Notion] Got ${response.results.length} page IDs in ${Date.now() - queryStart}ms`);

  if (response.results.length === 0) {
    return {
      tasks: [],
      pageIds: [],
      nextCursor: null,
      hasMore: false
    };
  }

  const pageIds = response.results.map(r => (r as PageObjectResponse).id);
  const nextCursor: string | null = response.next_cursor ?? null;
  const hasMore = response.has_more;

  // Step 2: Fetch pages in parallel (all at once since batch is small)
  const PARALLEL_LIMIT = batchSize;
  const tasks: Task[] = [];
  
  for (let i = 0; i < pageIds.length; i += PARALLEL_LIMIT) {
    const batch = pageIds.slice(i, i + PARALLEL_LIMIT);
    const retrieveStart = Date.now();
    
    const pages = await Promise.all(
      batch.map(async (pageId) => {
        try {
          const page = await withRetry(
            client,
            () => client.pages.retrieve({ page_id: pageId }),
            `Retrieve page ${pageId.substring(0, 8)}`
          ) as PageObjectResponse;
          return page;
        } catch (error) {
          console.error(`[Notion] Failed to retrieve page ${pageId}:`, error);
          return null;
        }
      })
    );
    
    console.log(`[Notion] Retrieved ${batch.length} pages in ${Date.now() - retrieveStart}ms`);
    
    // Map successful pages to tasks
    for (const page of pages) {
      if (page) {
        const task = mapPageToTask(page, settings);
        tasks.push(task);
        
        // Log task status for debugging
        if (!task.status) {
          console.log(`[Notion] Task without status: "${task.title}" (checking property "${settings.statusProperty}")`);
          // Debug: log available properties on this page
          const propNames = Object.keys(page.properties || {});
          console.log(`[Notion] Available properties: ${propNames.join(', ')}`);
        }
      }
    }
  }
  
  // Summary logging
  const withStatus = tasks.filter(t => t.status).length;
  console.log(`[Notion] Reliable batch complete: ${tasks.length} tasks (${withStatus} with status)`);

  return {
    tasks,
    pageIds,
    nextCursor,
    hasMore
  };
}

export async function addTask(payload: NotionCreatePayload): Promise<Task> {
  if (!notion) {
    throw new Error('Notion not connected. Configure your API key in Settings to sync tasks.');
  }
  const safeTitle = payload.title.trim();
  if (!safeTitle) {
    throw new Error('Task title cannot be empty');
  }

  const properties: Record<string, any> = {
    [settings.titleProperty]: {
      title: [
        {
          text: { content: safeTitle }
        }
      ]
    }
  };

  if (payload.status && settings.statusProperty) {
    properties[settings.statusProperty] = {
      status: { name: payload.status }
    };
  }

  if (payload.date || payload.dateEnd) {
    const start = payload.date ?? payload.dateEnd ?? null;
    properties[settings.dateProperty] = {
      date: {
        start: start ?? undefined,
        end: payload.dateEnd ?? undefined
      }
    };
  }

  properties[settings.deadlineProperty] = {
    status: {
      name: payload.hardDeadline
        ? settings.deadlineHardValue
        : settings.deadlineSoftValue
    }
  };

  if (settings.urgentProperty) {
    const urgentName = payload.urgent
      ? settings.urgentStatusActive
      : settings.urgentStatusInactive;
    properties[settings.urgentProperty] = {
      status: urgentName ? { name: urgentName } : null
    };
  }

  if (settings.importantProperty) {
    const importantName = payload.important
      ? settings.importantStatusActive
      : settings.importantStatusInactive;
    properties[settings.importantProperty] = {
      status: importantName ? { name: importantName } : null
    };
  }

  if (payload.mainEntry) {
    const propName = settings.mainEntryProperty || 'Main Entry';
    properties[propName] = {
      rich_text: textToRichText(payload.mainEntry)
    };
  }

  if (payload.projectIds && payload.projectIds.length > 0 && settings.projectRelationProperty) {
    properties[settings.projectRelationProperty] = {
      relation: payload.projectIds.map((id) => ({ id }))
    };
  }

  // Set parent task relation for subtasks
  if (payload.parentTaskId && settings.parentTaskProperty) {
    properties[settings.parentTaskProperty] = {
      relation: [{ id: payload.parentTaskId }]
    };
  }

  const client = notion;
  const pageResponse = await withRetry(
    client,
    () => client.pages.create({
      parent: { database_id: getDatabaseId() },
      properties
    } as CreatePageParameters),
    'Create task'
  );

  if (!isPageResponse(pageResponse)) {
    throw new Error('Notion did not return a page for the new task');
  }

  return mapPageToTask(pageResponse, settings);
}

export async function updateTask(
  taskId: string,
  updates: TaskUpdatePayload
): Promise<Task> {
  if (!notion) {
    throw new Error('Notion not connected. Configure your API key in Settings to sync task updates.');
  }
  const client = notion;

  const properties: Record<string, any> = {};

  if (updates.status !== undefined) {
    properties[settings.statusProperty] = updates.status
      ? { status: { name: updates.status } }
      : { status: null };
  }

  if (updates.title !== undefined) {
    const trimmed = updates.title?.trim();
    if (trimmed) {
      properties[settings.titleProperty] = {
        title: textToRichText(trimmed)
      };
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(updates, 'dueDate') ||
    Object.prototype.hasOwnProperty.call(updates, 'dueDateEnd')
  ) {
    const start =
      updates.dueDate !== undefined ? updates.dueDate : null;
    const end =
      updates.dueDateEnd !== undefined ? updates.dueDateEnd : null;
    properties[settings.dateProperty] =
      start || end
        ? {
            date: {
              start: start ?? end ?? undefined,
              end: end ?? undefined
            }
          }
        : { date: null };
  }

  if (updates.hardDeadline !== undefined) {
    properties[settings.deadlineProperty] = {
      status: {
        name: updates.hardDeadline
          ? settings.deadlineHardValue
          : settings.deadlineSoftValue
      }
    };
  }

  if (updates.urgent !== undefined && settings.urgentProperty) {
    properties[settings.urgentProperty] = {
      status: {
        name: updates.urgent
          ? settings.urgentStatusActive
          : settings.urgentStatusInactive
      }
    };
  }

  if (updates.important !== undefined && settings.importantProperty) {
    properties[settings.importantProperty] = {
      status: {
        name: updates.important
          ? settings.importantStatusActive
          : settings.importantStatusInactive
      }
    };
  }

  if (updates.mainEntry !== undefined) {
    const propName = settings.mainEntryProperty || 'Main Entry';
    properties[propName] = {
      rich_text: updates.mainEntry ? textToRichText(updates.mainEntry) : []
    };
  }

  if (
    Object.prototype.hasOwnProperty.call(updates, 'sessionLengthMinutes') &&
    settings.sessionLengthProperty
  ) {
    properties[settings.sessionLengthProperty] = {
      number:
        updates.sessionLengthMinutes === null
          ? null
          : Number(updates.sessionLengthMinutes)
    };
  }

  if (
    Object.prototype.hasOwnProperty.call(updates, 'estimatedLengthMinutes') &&
    settings.estimatedLengthProperty
  ) {
    properties[settings.estimatedLengthProperty] = {
      number:
        updates.estimatedLengthMinutes === null
          ? null
          : Number(updates.estimatedLengthMinutes)
    };
  }

  if (
    Object.prototype.hasOwnProperty.call(updates, 'orderValue') &&
    settings.orderProperty
  ) {
    const metadata = await getOrderPropertyMetadata();
    if (metadata?.type === 'select') {
      properties[settings.orderProperty] = updates.orderValue
        ? { select: { name: updates.orderValue } }
        : { select: null };
    } else if (metadata?.type === 'status') {
      properties[settings.orderProperty] = updates.orderValue
        ? { status: { name: updates.orderValue } }
        : { status: null };
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(updates, 'projectIds') &&
    settings.projectRelationProperty
  ) {
    const relationProperty = settings.projectRelationProperty;
    const ids = (updates.projectIds ?? []).filter(
      (value): value is string => Boolean(value)
    );
    properties[relationProperty] = {
      relation: ids.map((id) => ({ id }))
    };
  }

  // Handle recurrence property updates (multi-select weekdays)
  if (
    Object.prototype.hasOwnProperty.call(updates, 'recurrence') &&
    settings.recurrenceProperty
  ) {
    const recurrenceValues = updates.recurrence ?? [];
    properties[settings.recurrenceProperty] = {
      multi_select: recurrenceValues.map((day: string) => ({ name: day }))
    };
  }

  if (!Object.keys(properties).length) {
    throw new Error('No updates specified');
  }

  const response = await withRetry(
    client,
    () => client.pages.update({
      page_id: taskId,
      properties
    }),
    `Update task ${taskId}`
  );

  if (!isPageResponse(response)) {
    throw new Error('Notion did not return a page for the updated task');
  }

  return mapPageToTask(response, settings);
}

export async function getActiveTimeLogEntry(taskId: string) {
  if (
    !timeLogClient ||
    !timeLogSettings?.databaseId ||
    !timeLogSettings.taskProperty ||
    !timeLogSettings.statusProperty
  ) {
    return null;
  }

  const dbId = getTimeLogDatabaseId();
  // Format taskId to remove dashes (Notion expects 32-char hex string for relations)
  const formattedTaskId = taskId.replace(/-/g, '').trim();
  const filters: any[] = [
    {
      property: timeLogSettings.taskProperty,
      relation: { contains: formattedTaskId }
    },
    {
      property: timeLogSettings.statusProperty,
      status: { equals: timeLogSettings.startStatusValue ?? 'Start' }
    }
  ];

  const query: Record<string, any> = {
    database_id: dbId,
    page_size: 1,
    sorts: [
      {
        timestamp: 'last_edited_time',
        direction: 'descending'
      }
    ]
  };

  if (filters.length === 1) {
    query.filter = filters[0];
  } else {
    query.filter = { and: filters };
  }

  const queryDatabase = bindDatabaseQuery(getTimeLogClient());
  const response = await queryDatabase({
    ...query,
    database_id: dbId
  });
  const page = response.results.find(isPageResponse);
  if (!page) return null;

  const props = page.properties ?? {};
  const startProp =
    (timeLogSettings.startTimeProperty &&
      props[timeLogSettings.startTimeProperty]) ||
    undefined;
  const endProp =
    (timeLogSettings.endTimeProperty &&
      props[timeLogSettings.endTimeProperty]) ||
    undefined;

  const startTime =
    startProp?.type === 'date' ? startProp.date?.start ?? null : null;
  let endTime =
    endProp?.type === 'date' ? endProp.date?.start ?? null : null;
  if (!endTime && startProp?.type === 'date') {
    endTime = startProp.date?.end ?? null;
  }
  
  // Calculate duration from start and end times (in minutes)
  let durationMinutes: number | null = null;
  if (startTime && endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    durationMinutes = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
  } else if (startTime) {
    // Active session: calculate from start to now
    const start = new Date(startTime);
    const now = new Date();
    durationMinutes = Math.round((now.getTime() - start.getTime()) / (1000 * 60));
  }

  return {
    id: page.id,
    startTime,
    endTime,
    durationMinutes
  };
}

export async function getTotalLoggedTime(taskId: string): Promise<number> {
  if (
    !timeLogClient ||
    !timeLogSettings?.databaseId ||
    !timeLogSettings.taskProperty
  ) {
    return 0;
  }

  const dbId = getTimeLogDatabaseId();
  // Format taskId to remove dashes (Notion expects 32-char hex string for relations)
  const formattedTaskId = taskId.replace(/-/g, '').trim();

  let totalMinutes = 0;
  let cursor: string | null | undefined = undefined;

  const queryDatabase = bindDatabaseQuery(getTimeLogClient());

  do {
    const response = await queryDatabase({
      database_id: dbId,
      filter: {
        property: timeLogSettings.taskProperty,
        relation: { contains: formattedTaskId }
      },
      page_size: 100,
      start_cursor: cursor ?? undefined
    });

    for (const result of response.results) {
      if (!isPageResponse(result)) continue;

      const props = result.properties ?? {};
      const startProp =
        (timeLogSettings.startTimeProperty &&
          props[timeLogSettings.startTimeProperty]) ||
        undefined;
      const endProp =
        (timeLogSettings.endTimeProperty &&
          props[timeLogSettings.endTimeProperty]) ||
        undefined;

      const startTime =
        startProp?.type === 'date' ? startProp.date?.start ?? null : null;
      let endTime =
        endProp?.type === 'date' ? endProp.date?.start ?? null : null;
      if (!endTime && startProp?.type === 'date') {
        endTime = startProp.date?.end ?? null;
      }

      // Calculate duration from start and end times
      if (startTime && endTime) {
        const start = new Date(startTime);
        const end = new Date(endTime);
        const durationMinutes = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
        totalMinutes += durationMinutes;
      } else if (startTime) {
        // Active session: calculate from start to now
        const start = new Date(startTime);
        const now = new Date();
        const durationMinutes = Math.round((now.getTime() - start.getTime()) / (1000 * 60));
        totalMinutes += durationMinutes;
      }
    }

    cursor = response.next_cursor ?? null;
  } while (cursor);

  return totalMinutes;
}

export async function getAllTimeLogEntries(taskId: string): Promise<TimeLogEntry[]> {
  if (
    !timeLogClient ||
    !timeLogSettings?.databaseId ||
    !timeLogSettings.taskProperty
  ) {
    return [];
  }

  const dbId = getTimeLogDatabaseId();
  // Format taskId to remove dashes (Notion expects 32-char hex string for relations)
  const formattedTaskId = taskId.replace(/-/g, '').trim();

  const entries: TimeLogEntry[] = [];
  let cursor: string | null | undefined = undefined;

  const queryDatabase = bindDatabaseQuery(getTimeLogClient());

  do {
    const response = await queryDatabase({
      database_id: dbId,
      filter: {
        property: timeLogSettings.taskProperty,
        relation: { contains: formattedTaskId }
      },
      sorts: [
        {
          timestamp: 'created_time',
          direction: 'descending'
        }
      ],
      page_size: 100,
      start_cursor: cursor ?? undefined
    });

    for (const result of response.results) {
      if (!isPageResponse(result)) continue;

      const props = result.properties ?? {};
      const startProp =
        (timeLogSettings.startTimeProperty &&
          props[timeLogSettings.startTimeProperty]) ||
        undefined;
      const endProp =
        (timeLogSettings.endTimeProperty &&
          props[timeLogSettings.endTimeProperty]) ||
        undefined;
      const titleProp =
        (timeLogSettings.titleProperty &&
          props[timeLogSettings.titleProperty]) ||
        undefined;

      const startTime =
        startProp?.type === 'date' ? startProp.date?.start ?? null : null;
      let endTime =
        endProp?.type === 'date' ? endProp.date?.start ?? null : null;
      if (!endTime && startProp?.type === 'date') {
        endTime = startProp.date?.end ?? null;
      }
      
      // Calculate duration from start and end times (in minutes)
      let durationMinutes: number | null = null;
      if (startTime && endTime) {
        const start = new Date(startTime);
        const end = new Date(endTime);
        durationMinutes = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
      } else if (startTime) {
        // Active session: calculate from start to now
        const start = new Date(startTime);
        const now = new Date();
        durationMinutes = Math.round((now.getTime() - start.getTime()) / (1000 * 60));
      }
      const title =
        titleProp?.type === 'title'
          ? titleProp.title.map((t: any) => t.plain_text).join('')
          : null;

      entries.push({
        id: result.id,
        startTime,
        endTime,
        durationMinutes,
        title
      });
    }

    cursor = response.next_cursor ?? null;
  } while (cursor);

  return entries;
}

export async function getAllTimeLogs(): Promise<TimeLogEntry[]> {
  if (!timeLogSettings?.databaseId) {
    console.warn('Time log database ID not configured');
    return [];
  }

  try {
    const client = getTimeLogClient();
    const dbId = getTimeLogDatabaseId();

    const entries: TimeLogEntry[] = [];
    let cursor: string | null | undefined = undefined;

    const queryDatabase = bindDatabaseQuery(client);

    // Filter to only get time logs from the last 2 days
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoISO = twoDaysAgo.toISOString();

    // Build filter based on startTimeProperty if configured
    const filter = timeLogSettings.startTimeProperty
      ? {
          property: timeLogSettings.startTimeProperty,
          date: { on_or_after: twoDaysAgoISO }
        }
      : undefined;

    do {
      const response = await queryDatabase({
        database_id: dbId,
        ...(filter && { filter }),
        sorts: [
          {
            timestamp: 'created_time',
            direction: 'descending'
          }
        ],
        page_size: 50,
        start_cursor: cursor ?? undefined
      });

      for (const result of response.results) {
      if (!isPageResponse(result)) continue;

      const props = result.properties ?? {};
      const startProp =
        (timeLogSettings.startTimeProperty &&
          props[timeLogSettings.startTimeProperty]) ||
        undefined;
      const endProp =
        (timeLogSettings.endTimeProperty &&
          props[timeLogSettings.endTimeProperty]) ||
        undefined;
      const titleProp =
        (timeLogSettings.titleProperty &&
          props[timeLogSettings.titleProperty]) ||
        undefined;
      const taskProp =
        (timeLogSettings.taskProperty &&
          props[timeLogSettings.taskProperty]) ||
        undefined;

      const startTime =
        startProp?.type === 'date' ? startProp.date?.start ?? null : null;
      let endTime =
        endProp?.type === 'date' ? endProp.date?.start ?? null : null;
      if (!endTime && startProp?.type === 'date') {
        endTime = startProp.date?.end ?? null;
      }
      
      // Calculate duration from start and end times (in minutes)
      let durationMinutes: number | null = null;
      if (startTime && endTime) {
        const start = new Date(startTime);
        const end = new Date(endTime);
        durationMinutes = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
      } else if (startTime) {
        // Active session: calculate from start to now
        const start = new Date(startTime);
        const now = new Date();
        durationMinutes = Math.round((now.getTime() - start.getTime()) / (1000 * 60));
      }
      
      const title =
        titleProp?.type === 'title'
          ? titleProp.title.map((t: any) => t.plain_text).join('')
          : null;

      // Extract task relation if available
      let taskId: string | null = null;
      let taskTitle: string | null = null;
      if (taskProp?.type === 'relation' && taskProp.relation.length > 0) {
        taskId = taskProp.relation[0].id;
        // Note: We'd need to fetch the task page to get the title, but for now we'll leave it null
        // and can enhance later if needed
      }

      entries.push({
        id: result.id,
        startTime,
        endTime,
        durationMinutes,
        title,
        taskId,
        taskTitle
      });
      }

      cursor = response.next_cursor ?? null;
    } while (cursor);

    console.log(`Fetched ${entries.length} time log entries`);
    return entries;
  } catch (error: any) {
    console.error('Failed to fetch time logs', {
      databaseId: timeLogSettings.databaseId,
      error: error.message,
      code: error.code
    });
    // Return empty array on error to prevent UI crash
    if (error.message?.includes('Could not find database')) {
      console.error(
        `Time log database not found. Please ensure:\n` +
        `1. Database ID is correct: ${timeLogSettings.databaseId}\n` +
        `2. Database is shared with your Notion integration\n` +
        `3. API key has access to this database`
      );
    }
    return [];
  }
}

export async function updateTimeLogEntry(
  entryId: string,
  updates: TimeLogUpdatePayload
): Promise<TimeLogEntry> {
  if (!timeLogClient || !timeLogSettings?.databaseId) {
    throw new Error('Time log widget is not configured yet');
  }

  const client = getTimeLogClient();
  const properties: Record<string, any> = {};

  if (updates.startTime !== undefined) {
    if (timeLogSettings.startTimeProperty) {
      if (updates.startTime && updates.endTime) {
        properties[timeLogSettings.startTimeProperty] = {
          date: {
            start: updates.startTime,
            end: updates.endTime
          }
        };
      } else if (updates.startTime) {
        properties[timeLogSettings.startTimeProperty] = {
          date: {
            start: updates.startTime
          }
        };
      } else {
        properties[timeLogSettings.startTimeProperty] = {
          date: null
        };
      }
    }
  }

  if (updates.endTime !== undefined && timeLogSettings.endTimeProperty) {
    if (updates.endTime) {
      properties[timeLogSettings.endTimeProperty] = {
        date: {
          start: updates.endTime
        }
      };
    } else {
      properties[timeLogSettings.endTimeProperty] = {
        date: null
      };
    }
  }

  if (updates.title !== undefined && timeLogSettings.titleProperty) {
    if (updates.title) {
      properties[timeLogSettings.titleProperty] = {
        title: textToRichText(updates.title)
      };
    } else {
      properties[timeLogSettings.titleProperty] = {
        title: []
      };
    }
  }

  if (!Object.keys(properties).length) {
    throw new Error('No updates specified');
  }

  const formattedEntryId = entryId.replace(/-/g, '').trim();
  const response = await client.pages.update({
    page_id: formattedEntryId,
    properties
  });

  if (!isPageResponse(response)) {
    throw new Error('Notion did not return a page for the updated time log entry');
  }

  // Re-fetch to get the updated entry with calculated duration
  const props = response.properties ?? {};
  const startProp =
    (timeLogSettings.startTimeProperty &&
      props[timeLogSettings.startTimeProperty]) ||
    undefined;
  const endProp =
    (timeLogSettings.endTimeProperty &&
      props[timeLogSettings.endTimeProperty]) ||
    undefined;
  const titleProp =
    (timeLogSettings.titleProperty &&
      props[timeLogSettings.titleProperty]) ||
    undefined;

  const startTime =
    startProp?.type === 'date' ? startProp.date?.start ?? null : null;
  let endTime =
    endProp?.type === 'date' ? endProp.date?.start ?? null : null;
  if (!endTime && startProp?.type === 'date') {
    endTime = startProp.date?.end ?? null;
  }
  
  let durationMinutes: number | null = null;
  if (startTime && endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    durationMinutes = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
  } else if (startTime) {
    const start = new Date(startTime);
    const now = new Date();
    durationMinutes = Math.round((now.getTime() - start.getTime()) / (1000 * 60));
  }
  
  const title =
    titleProp?.type === 'title'
      ? titleProp.title.map((t: any) => t.plain_text).join('')
      : null;

  return {
    id: response.id,
    startTime,
    endTime,
    durationMinutes,
    title
  };
}

export async function deleteTimeLogEntry(entryId: string): Promise<void> {
  if (!timeLogClient) {
    throw new Error('Time log widget is not configured yet');
  }

  const client = getTimeLogClient();
  const formattedEntryId = entryId.replace(/-/g, '').trim();
  
  await client.pages.update({
    page_id: formattedEntryId,
    archived: true
  });
}

function getProjectsClient(): Client {
  // Prefer dedicated projects client if available
  if (projectsClient) {
    return projectsClient;
  }
  // Fall back to main notion client if projects has no separate API key
  if (notion) {
    return notion;
  }
  throw new Error(
    'No Notion client available for projects. ' +
    'Please configure either a Projects API key in the Control Center, ' +
    'or ensure the main Tasks API key is configured.'
  );
}

function getProjectsDatabaseId() {
  if (!projectsSettings?.databaseId) {
    throw new Error('Missing projects database ID');
  }
  const raw = projectsSettings.databaseId.replace(/-/g, '').trim();
  if (!raw || raw.length !== 32) {
    throw new Error('Projects database ID must be 32 characters');
  }
  return raw;
}

async function getProjectPropertyIds(): Promise<Map<string, string>> {
  if (cachedProjectPropertyIds) {
    return cachedProjectPropertyIds;
  }
  
  const client = getProjectsClient();
  const dbId = getProjectsDatabaseId();
  
  console.log('[Notion] Fetching projects database schema for property IDs...');
  
  try {
    const database = await withRetry(
      client,
      () => client.databases.retrieve({ database_id: dbId }),
      'Retrieve projects database schema'
    ) as any;
    
    cachedProjectPropertyIds = new Map();
    for (const [name, prop] of Object.entries(database.properties)) {
      cachedProjectPropertyIds.set(name, (prop as any).id);
    }
    
    console.log(`[Notion] Cached ${cachedProjectPropertyIds.size} project property IDs`);
    return cachedProjectPropertyIds;
  } catch (error) {
    console.error('[Notion] Failed to fetch project property IDs:', error);
    return new Map();
  }
}

function getContactsClient(): Client {
  if (contactsClient) {
    return contactsClient;
  }
  if (contactsSettings?.apiKey && contactsSettings.apiKey.trim()) {
    contactsClient = createNotionClient(contactsSettings.apiKey);
    return contactsClient;
  }
  if (notion) {
    return notion;
  }
  throw new Error('Contacts Notion client not initialized');
}

function getContactsDatabaseId() {
  if (!contactsSettings?.databaseId) {
    throw new Error('Missing contacts database ID');
  }
  const raw = contactsSettings.databaseId.replace(/-/g, '').trim();
  if (!raw || raw.length !== 32) {
    throw new Error('Contacts database ID must be 32 characters');
  }
  return raw;
}

async function getContactPropertyIds(): Promise<Map<string, string>> {
  if (cachedContactPropertyIds) {
    return cachedContactPropertyIds;
  }

  const client = getContactsClient();
  const dbId = getContactsDatabaseId();

  try {
    const database = await withRetry(
      client,
      () => client.databases.retrieve({ database_id: dbId }),
      'Retrieve contacts database schema'
    ) as any;

    cachedContactPropertyIds = new Map();
    for (const [name, prop] of Object.entries(database.properties)) {
      cachedContactPropertyIds.set(name, (prop as any).id);
    }
    return cachedContactPropertyIds;
  } catch (error) {
    console.error('[Notion] Failed to fetch contact property IDs:', error);
    return new Map();
  }
}

export async function getProjects(): Promise<Project[]> {
  if (!projectsSettings?.databaseId) {
    return [];
  }

  const client = getProjectsClient();
  const dbId = getProjectsDatabaseId();

  try {
    const projects: Project[] = [];
    let cursor: string | null | undefined = undefined;

    const queryDatabase = bindDatabaseQuery(client);

    // ULTRA-MINIMAL QUERY: No filter, only title property, small page size
    // This is the fastest possible query for complex databases
    
    // Get property IDs for filter_properties optimization
    const propertyIds = await getProjectPropertyIds();
    
    // Find the title property ID - that's all we absolutely need
    const titlePropName = projectsSettings.titleProperty || 'Name';
    const titlePropId = propertyIds.get(titlePropName);
    
    // Get status property ID - try configured property first, then common fallbacks
    const statusPropertyName = projectsSettings.statusProperty || 'Status';
    let statusPropId = propertyIds.get(statusPropertyName);
    
    // If configured status property not found, try common fallback names
    if (!statusPropId) {
      const fallbackNames = ['Status', 'Statuses', 'State', 'Project Status'];
      for (const name of fallbackNames) {
        statusPropId = propertyIds.get(name);
        if (statusPropId) {
          console.log(`[Notion] Using fallback status property: "${name}"`);
          break;
        }
      }
    }
    
    const filterPropertyIds = [titlePropId, statusPropId].filter(Boolean) as string[];
    
    console.log(`[Notion] Projects ULTRA-MINIMAL query - ${filterPropertyIds.length} properties only, page_size=10`);

    do {
      const response = await withRetry(
        client,
        () => queryDatabase({
          database_id: dbId,
          // NO filter, NO sort - absolute minimum query
          ...(filterPropertyIds.length > 0 && { filter_properties: filterPropertyIds }),
          page_size: 10, // Very small page size
          start_cursor: cursor ?? undefined
        }),
        'Query projects database'
      );

      for (const result of response.results) {
        if (!isPageResponse(result)) continue;

        const props = result.properties ?? {};
        
        // Debug: log available properties for first result
        if (projects.length === 0) {
          console.log('Projects - Available properties:', Object.keys(props));
          console.log('Projects - Looking for titleProperty:', projectsSettings.titleProperty);
          console.log('Projects - Looking for statusProperty:', projectsSettings.statusProperty);
        }
        
        // Try configured title property first, then fall back to finding any title property
        let titleProp =
          (projectsSettings.titleProperty &&
            props[projectsSettings.titleProperty]) ||
          undefined;
        
        // Fallback: find any property of type 'title' if configured one doesn't exist
        if (!titleProp) {
          for (const [key, value] of Object.entries(props)) {
            if ((value as any)?.type === 'title') {
              console.log('Projects - Found title property at:', key);
              titleProp = value as any;
              break;
            }
          }
        }
        
        // Try configured status property first, then fall back to common names
        let statusProp =
          (projectsSettings.statusProperty &&
            props[projectsSettings.statusProperty]) ||
          undefined;
        
        // Fallback: try common status property names if not configured or not found
        if (!statusProp) {
          const commonStatusNames = ['Status', 'Statuses', 'State', 'Project Status'];
          for (const name of commonStatusNames) {
            const prop = props[name];
            if (prop && ((prop as any)?.type === 'status' || (prop as any)?.type === 'select')) {
              if (projects.length === 0) {
                console.log('Projects - Found status property at:', name, 'type:', (prop as any)?.type);
              }
              statusProp = prop as any;
              break;
            }
          }
        }
        const descriptionProp =
          (projectsSettings.descriptionProperty &&
            props[projectsSettings.descriptionProperty]) ||
          undefined;
        const startDateProp =
          (projectsSettings.startDateProperty &&
            props[projectsSettings.startDateProperty]) ||
          undefined;
        const endDateProp =
          (projectsSettings.endDateProperty &&
            props[projectsSettings.endDateProperty]) ||
          undefined;
        const tagsProp =
          (projectsSettings.tagsProperty &&
            props[projectsSettings.tagsProperty]) ||
          undefined;

        const title =
          titleProp?.type === 'title'
            ? titleProp.title.map((t: any) => t.plain_text).join('')
            : null;

        const status =
          statusProp?.type === 'status'
            ? statusProp.status?.name ?? null
            : statusProp?.type === 'select'
              ? statusProp.select?.name ?? null
              : null;

        const description =
          descriptionProp?.type === 'rich_text'
            ? descriptionProp.rich_text
                .map((t: any) => t.plain_text)
                .join('')
            : null;

        const startDate =
          startDateProp?.type === 'date'
            ? startDateProp.date?.start ?? null
            : null;

        const endDate =
          endDateProp?.type === 'date'
            ? endDateProp.date?.start ?? null
            : null;

        const tags =
          tagsProp?.type === 'multi_select'
            ? tagsProp.multi_select.map((t: any) => t.name)
            : null;

        const url = result.url ?? null;

        const project: Project = {
          id: result.id,
          title,
          status,
          description,
          startDate,
          endDate,
          tags,
          url
        };
        
        projects.push(project);
        
        // Log first few projects to verify status extraction
        if (projects.length <= 3) {
          console.log(`[Notion] Project ${projects.length}: "${title}" → status="${status}"`);
        }
      }

      cursor = response.next_cursor ?? null;
    } while (cursor);

    console.log(`[Notion] Fetched ${projects.length} projects from Notion`);
    const withStatus = projects.filter(p => p.status).length;
    console.log(`[Notion] Projects with status: ${withStatus}/${projects.length}`);
    
    return projects;
  } catch (error) {
    console.error('Notion projects query failed', { dbId }, error);
    throw error;
  }
}

export async function getContacts(forceRefresh = false): Promise<Contact[]> {
  if (!contactsSettings?.databaseId) {
    return [];
  }

  const cacheValid =
    !forceRefresh &&
    cachedContacts &&
    contactsFetchedAt &&
    Date.now() - contactsFetchedAt < 5 * 60 * 1000;

  if (cacheValid) {
    return cachedContacts!;
  }

  const contacts = await fetchContactsFromNotion();
  cachedContacts = contacts;
  contactsFetchedAt = Date.now();
  return contacts;
}

export async function refreshContacts(): Promise<Contact[]> {
  cachedContacts = null;
  contactsFetchedAt = null;
  return getContacts(true);
}

async function fetchContactsFromNotion(): Promise<Contact[]> {
  if (!contactsSettings?.databaseId) {
    return [];
  }

  const client = getContactsClient();
  const dbId = getContactsDatabaseId();
  const queryDatabase = bindDatabaseQuery(client);

  const propertyNames = [
    contactsSettings.nameProperty,
    contactsSettings.emailProperty,
    contactsSettings.phoneProperty,
    contactsSettings.companyProperty,
    contactsSettings.roleProperty,
    contactsSettings.notesProperty,
    contactsSettings.projectsRelationProperty
  ].filter(Boolean) as string[];

  const propertyIds = await getContactPropertyIds();
  const filterPropertyIds = propertyNames
    .map((name) => propertyIds.get(name))
    .filter(Boolean) as string[];

  const contacts: Contact[] = [];
  let cursor: string | null | undefined = undefined;

  do {
    const response = await withRetry(
      client,
      () =>
        queryDatabase({
          database_id: dbId,
          page_size: 25,
          start_cursor: cursor ?? undefined,
          ...(filterPropertyIds.length > 0 && {
            filter_properties: filterPropertyIds
          })
        }),
      'Query contacts database'
    );

    for (const result of response.results) {
      if (!isPageResponse(result)) continue;
      const props = result.properties ?? {};

      const nameProp =
        (contactsSettings.nameProperty &&
          props[contactsSettings.nameProperty]) ||
        undefined;
      const resolvedNameProp =
        nameProp && nameProp.type === 'title'
          ? nameProp
          : Object.values(props).find((prop: any) => prop?.type === 'title');
      const name = extractPlainText(resolvedNameProp);

      const emailProp =
        (contactsSettings.emailProperty &&
          props[contactsSettings.emailProperty]) ||
        undefined;
      const email =
        emailProp?.type === 'email'
          ? emailProp.email ?? null
          : extractPlainText(emailProp);

      const phoneProp =
        (contactsSettings.phoneProperty &&
          props[contactsSettings.phoneProperty]) ||
        undefined;
      const phone =
        phoneProp?.type === 'phone_number'
          ? phoneProp.phone_number ?? null
          : extractPlainText(phoneProp);

      const companyProp =
        (contactsSettings.companyProperty &&
          props[contactsSettings.companyProperty]) ||
        undefined;
      const company = extractPlainText(companyProp);

      const roleProp =
        (contactsSettings.roleProperty &&
          props[contactsSettings.roleProperty]) ||
        undefined;
      const role = extractPlainText(roleProp);

      const notesProp =
        (contactsSettings.notesProperty &&
          props[contactsSettings.notesProperty]) ||
        undefined;
      const notes = extractPlainText(notesProp);

      const relationProp =
        (contactsSettings.projectsRelationProperty &&
          props[contactsSettings.projectsRelationProperty]) ||
        undefined;
      const projectIds =
        relationProp?.type === 'relation'
          ? relationProp.relation?.map((rel: any) => rel.id) ?? []
          : null;

      contacts.push({
        id: result.id,
        name,
        email,
        phone,
        company,
        role,
        notes,
        projectIds,
        url: result.url ?? null
      });
    }

    cursor = response.next_cursor ?? null;
  } while (cursor);

  return contacts;
}

function extractPlainText(prop: any): string | null {
  if (!prop) return null;
  if (prop.type === 'title') {
    const text = prop.title?.map((t: any) => t.plain_text).join('') ?? '';
    return text.trim() || null;
  }
  if (prop.type === 'rich_text') {
    const text = prop.rich_text?.map((t: any) => t.plain_text).join('') ?? '';
    return text.trim() || null;
  }
  if (prop.type === 'people') {
    const text = prop.people
      ?.map((person: any) => person?.name || person?.person?.email)
      .filter(Boolean)
      .join(', ');
    return text?.trim() || null;
  }
  if (typeof prop === 'string') {
    return prop.trim() || null;
  }
  return null;
}

function isPageResponse(response: any): response is PageObjectResponse {
  return response.object === 'page';
}

function getDatabaseId() {
  const raw = settings.databaseId?.replace(/-/g, '').trim();
  if (!raw || raw.length !== 32) {
    throw new Error('Missing NOTION_DATABASE_ID');
  }
  return raw;
}

async function getDataSourceId(dbId: string): Promise<string> {
  if (!notion) {
    throw new Error('Notion client not initialized');
  }
  if (cachedDataSourceId) return cachedDataSourceId;
  if (settings.dataSourceId) {
    cachedDataSourceId = settings.dataSourceId;
    return cachedDataSourceId!;
  }

  const database = await notion.databases.retrieve({
    database_id: dbId
  });

  const dataSource = (database as any).data_sources?.[0];
  if (!dataSource?.id) {
    throw new Error(
      'Database is missing data source. Provide NOTION_DATA_SOURCE_ID in .env.'
    );
  }

  cachedDataSourceId = dataSource.id;
  return cachedDataSourceId!;
}

async function getOrderPropertyMetadata(): Promise<{
  type: 'select' | 'status';
  options: TaskOrderOption[];
} | null> {
  if (!notion) {
    throw new Error('Notion client not initialized');
  }
  if (!settings.orderProperty) {
    return null;
  }
  if (cachedOrderOptions && cachedOrderPropertyType) {
    return {
      type: cachedOrderPropertyType,
      options: cachedOrderOptions ?? []
    };
  }

  const database = (await notion.databases.retrieve({
    database_id: getDatabaseId()
  })) as any;
  const property = database.properties?.[settings.orderProperty];

  if (property?.type === 'select') {
    const options: TaskOrderOption[] = property.select.options.map(
      (option: any) => ({
        id: option.id,
        name: option.name,
        color: option.color
      })
    );
    cachedOrderOptions = options;
    cachedOrderPropertyType = 'select';
    return {
      type: 'select',
      options
    };
  }

  if (property?.type === 'status') {
    const options: TaskOrderOption[] = property.status.options.map(
      (option: any) => ({
        id: option.id,
        name: option.name,
        color: option.color
      })
    );
    cachedOrderOptions = options;
    cachedOrderPropertyType = 'status';
    return {
      type: 'status',
      options
    };
  }

  cachedOrderOptions = [];
  cachedOrderPropertyType = null;
  return null;
}

export async function getStatusOptions(): Promise<TaskStatusOption[]> {
  // When Notion isn't connected, return local statuses
  if (!notion) {
    const { listLocalTaskStatuses } = await import('../db/repositories/localStatusRepository');
    return listLocalTaskStatuses();
  }

  if (cachedStatusOptions) {
    return cachedStatusOptions;
  }

  const database = (await notion.databases.retrieve({
    database_id: getDatabaseId()
  })) as any;

  const property = database.properties?.[settings.statusProperty];
  if (property?.type === 'status') {
    cachedStatusOptions = property.status.options.map((option: any) => ({
      id: option.id,
      name: option.name,
      color: option.color
    }));
  } else if (property?.type === 'select') {
    cachedStatusOptions = property.select.options.map((option: any) => ({
      id: option.id,
      name: option.name,
      color: option.color
    }));
  } else {
    cachedStatusOptions = [];
  }

  return cachedStatusOptions ?? [];
}

export async function getOrderOptions(): Promise<TaskOrderOption[]> {
  const metadata = await getOrderPropertyMetadata();
  return metadata?.options ?? [];
}

/**
 * Get project status options - combines Notion options with local defaults.
 * Priority: 1) In-memory cache 2) Persisted cache in settings 3) Local DB defaults
 * Use fetchProjectStatusOptionsFromNotion() to refresh from Notion.
 */
export async function getProjectStatusOptions(): Promise<TaskStatusOption[]> {
  // Import lazily to avoid circular dependencies
  const { listLocalProjectStatuses } = await import('../db/repositories/localStatusRepository');
  
  // Get local project statuses as the baseline (these include defaults)
  const localStatuses = listLocalProjectStatuses();
  
  // 1. Check in-memory cache first
  if (cachedProjectStatusOptions && cachedProjectStatusOptions.length > 0) {
    // Merge: Notion options first, then add any local-only options
    return mergeStatusOptions(cachedProjectStatusOptions, localStatuses);
  }
  
  // 2. Check persisted cache in settings
  if (projectsSettings?.cachedStatusOptions && projectsSettings.cachedStatusOptions.length > 0) {
    cachedProjectStatusOptions = projectsSettings.cachedStatusOptions;
    return mergeStatusOptions(cachedProjectStatusOptions, localStatuses);
  }
  
  // 3. Fall back to presets (merged with local)
  if (projectsSettings?.statusPresets && projectsSettings.statusPresets.length > 0) {
    const presetOptions = projectsSettings.statusPresets.map((name, idx) => ({
      id: `preset-${idx}`,
      name,
      color: undefined
    }));
    return mergeStatusOptions(presetOptions, localStatuses);
  }
  
  // 4. Return local statuses (which have defaults like Planning, Plotted, etc.)
  if (localStatuses.length > 0) {
    return localStatuses;
  }
  
  // 5. Ultimate fallback
  return [
    { id: 'default-1', name: 'Not started', color: undefined },
    { id: 'default-2', name: 'In progress', color: undefined },
    { id: 'default-3', name: 'Done', color: undefined }
  ];
}

/**
 * Merge two lists of status options, avoiding duplicates by name (case-insensitive).
 * Primary options take precedence over secondary.
 */
function mergeStatusOptions(
  primary: TaskStatusOption[],
  secondary: TaskStatusOption[]
): TaskStatusOption[] {
  const result = [...primary];
  const existingNames = new Set(primary.map(o => o.name.toLowerCase().trim()));
  
  for (const opt of secondary) {
    const normalizedName = opt.name.toLowerCase().trim();
    if (!existingNames.has(normalizedName)) {
      result.push(opt);
      existingNames.add(normalizedName);
    }
  }
  
  return result;
}

/**
 * Fetch project status options directly from Notion API.
 * This should be called during initial setup or when user explicitly refreshes.
 * Returns the options for saving to settings.
 */
export async function fetchProjectStatusOptionsFromNotion(): Promise<TaskStatusOption[]> {
  if (!projectsSettings?.databaseId || !projectsSettings.statusProperty) {
    console.log('[Notion] Cannot fetch project status options: missing databaseId or statusProperty');
    return [];
  }

  const client = getProjectsClient();
  const dbId = getProjectsDatabaseId();

  try {
    console.log('[Notion] Fetching project status options from database schema...');
    const database = (await withRetry(
      client,
      () => client.databases.retrieve({ database_id: dbId }),
      'Retrieve projects database schema'
    )) as any;

    const property = database.properties?.[projectsSettings.statusProperty];

    let options: TaskStatusOption[] = [];
    
    if (property?.type === 'status') {
      options = property.status.options.map((option: any) => ({
        id: option.id,
        name: option.name,
        color: option.color
      }));
      console.log(`[Notion] Found ${options.length} status options (type: status)`);
    } else if (property?.type === 'select') {
      options = property.select.options.map((option: any) => ({
        id: option.id,
        name: option.name,
        color: option.color
      }));
      console.log(`[Notion] Found ${options.length} status options (type: select)`);
    } else {
      console.log(`[Notion] Status property "${projectsSettings.statusProperty}" not found or not status/select type`);
    }

    // Cache in memory
    cachedProjectStatusOptions = options;
    
    return options;
  } catch (error) {
    console.error('[Notion] Failed to fetch project status options:', error);
    return [];
  }
}

function getWritingClient(): Client {
  if (writingClient) {
    return writingClient;
  }
  if (!notion) {
    throw new Error('Notion client not initialized');
  }
  return notion;
}

function getWritingDatabaseId() {
  if (!writingSettings?.databaseId) {
    throw new Error('Missing writing database ID');
  }
  const raw = writingSettings.databaseId.replace(/-/g, '').trim();
  if (!raw || raw.length !== 32) {
    throw new Error('Writing database ID must be 32 characters');
  }
  return raw;
}

export async function createTimeLogEntry(
  payload: TimeLogEntryPayload
): Promise<TimeLogEntry> {
  if (!timeLogSettings) {
    throw new Error('Time log widget is not configured yet');
  }

  const client = getTimeLogClient();
  const databaseId = getTimeLogDatabaseId();

  const properties: Record<string, any> = {};

  // Set title property
  if (timeLogSettings.titleProperty) {
    properties[timeLogSettings.titleProperty] = {
      title: textToRichText(payload.taskTitle)
    };
  }

  // Set task relation property
  if (timeLogSettings.taskProperty) {
    // Format taskId to remove dashes (Notion expects 32-char hex string)
    const formattedTaskId = payload.taskId.replace(/-/g, '').trim();
    if (formattedTaskId.length === 32) {
      properties[timeLogSettings.taskProperty] = {
        relation: [{ id: formattedTaskId }]
      };
    } else {
      console.warn(`Invalid taskId format for relation: ${payload.taskId}`);
    }
  }

  // Set status property (using 'status' type)
  // Transform legacy "completed" status to configured end status value
  if (timeLogSettings.statusProperty) {
    let statusValue = payload.status;
    if (statusValue === 'completed') {
      statusValue = timeLogSettings.endStatusValue ?? 'End';
    }
    properties[timeLogSettings.statusProperty] = {
      status: { name: statusValue }
    };
  }

  // Set start time property
  if (timeLogSettings.startTimeProperty && payload.startTime) {
    properties[timeLogSettings.startTimeProperty] = {
      date: {
        start: payload.startTime
      }
    };
  }

  // Set end time property
  if (timeLogSettings.endTimeProperty && payload.endTime) {
    properties[timeLogSettings.endTimeProperty] = {
      date: {
        start: payload.endTime
      }
    };
  }

  // If we have both start and end time, we can also set a date range
  // Otherwise, if we only have start time and session length, set estimated end time
  if (
    timeLogSettings.startTimeProperty &&
    payload.startTime
  ) {
    if (payload.endTime) {
      // Completed session: use actual end time
      properties[timeLogSettings.startTimeProperty] = {
        date: {
          start: payload.startTime,
          end: payload.endTime
        }
      };
    } else if (payload.sessionLengthMinutes) {
      // Active session: calculate estimated end time from start + session length
      const startDate = new Date(payload.startTime);
      const estimatedEndDate = new Date(startDate.getTime() + (payload.sessionLengthMinutes * 60 * 1000));
      properties[timeLogSettings.startTimeProperty] = {
        date: {
          start: payload.startTime,
          end: estimatedEndDate.toISOString()
        }
      };
    } else {
      // Just start time
      properties[timeLogSettings.startTimeProperty] = {
        date: {
          start: payload.startTime
        }
      };
    }
  }

  try {
    const response = await client.pages.create({
      parent: { database_id: databaseId },
      properties
    });

    if (!isPageResponse(response)) {
      throw new Error('Notion did not return a page for the time log entry');
    }

    let durationMinutes =
      payload.sessionLengthMinutes ?? null;
    if (!durationMinutes && payload.startTime && payload.endTime) {
      const start = new Date(payload.startTime).getTime();
      const end = new Date(payload.endTime).getTime();
      if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
        durationMinutes = Math.round((end - start) / (1000 * 60));
      }
    }

    return {
      id: response.id,
      startTime: payload.startTime ?? null,
      endTime: payload.endTime ?? null,
      durationMinutes,
      title: payload.taskTitle ?? null,
      taskId: payload.taskId,
      taskTitle: payload.taskTitle ?? null,
      status: payload.status ?? null
    };
  } catch (error: any) {
    console.error('Failed to create time log entry', {
      databaseId,
      error: error.message,
      code: error.code
    });
    if (error.message?.includes('Could not find database')) {
      throw new Error(
        `Could not find time log database with ID: ${databaseId}. ` +
        `Please ensure:\n` +
        `1. The database ID is correct (32 characters, no dashes)\n` +
        `2. The database is shared with your Notion integration\n` +
        `3. Your API key has access to this database`
      );
    }
    throw error;
  }
}

function getTimeLogClient(): Client {
  // Prefer dedicated time log client if available
  if (timeLogClient) {
    return timeLogClient;
  }
  // Fall back to main client if time log has no separate API key
  if (timeLogSettings?.apiKey && timeLogSettings.apiKey.trim()) {
    // Should have been set in setTimeLogSettings, but initialize if needed
    timeLogClient = new Client({ auth: timeLogSettings.apiKey });
    return timeLogClient;
  }
  if (!notion) {
    throw new Error('Notion client not initialized. Please configure your Notion API key.');
  }
  return notion;
}

function getTimeLogDatabaseId() {
  if (!timeLogSettings?.databaseId) {
    throw new Error('Missing time log database ID. Please configure the time log database in settings.');
  }
  // Remove all dashes and spaces, then trim
  const raw = timeLogSettings.databaseId.replace(/[-\s]/g, '').trim();
  if (!raw || raw.length !== 32) {
    throw new Error(
      `Time log database ID must be 32 characters (got ${raw.length}): ${raw}. ` +
      `Please check your database ID configuration. The ID should be 32 hex characters without dashes.`
    );
  }
  console.log('Time log database ID formatted:', raw);
  return raw;
}

/**
 * Check if Notion is connected (has valid client)
 */
export function isNotionConnected(): boolean {
  return notion !== null;
}

/**
 * Test connection to Notion API - verifies both API key AND database access
 */
export async function testConnection(): Promise<{
  success: boolean;
  message: string;
  latencyMs?: number;
}> {
  if (!notion) {
    return { 
      success: false, 
      message: 'Notion not connected. The app is running in local-only mode. Configure your API key in Settings to enable Notion sync.' 
    };
  }
  
  const startTime = Date.now();
  
  try {
    const client = notion;
    const dbId = getDatabaseId();
    
    // Step 1: Verify API key
    console.log('[Notion] Testing API key...');
    await withRetry(
      client,
      () => client.users.me({}),
      'Test API key'
    );
    console.log('[Notion] ✓ API key valid');
    
    // Step 2: Verify database access and inspect properties
    console.log(`[Notion] Testing database access (ID: ${dbId})...`);
    const database = await withRetry(
      client,
      () => client.databases.retrieve({ database_id: dbId }),
      'Test database access'
    ) as any;
    console.log('[Notion] ✓ Database access granted');
    
    // Step 3: Log all properties and their types
    console.log('\n[Notion] === DATABASE PROPERTY ANALYSIS ===');
    const properties = database.properties || {};
    Object.entries(properties).forEach(([name, prop]: [string, any]) => {
      const type = prop.type;
      const isRelation = type === 'relation';
      const isRollup = type === 'rollup';
      const isSlow = isRelation || isRollup;
      console.log(`  ${isSlow ? '⚠️ ' : '✓ '} "${name}": ${type}${isSlow ? ' (SLOW - relation/rollup)' : ''}`);
    });
    console.log('[Notion] ========================================\n');
    
    const latencyMs = Date.now() - startTime;
    console.log(`[Notion] Connection test successful (${latencyMs}ms)`);
    
    return {
      success: true,
      message: `Connected successfully (${latencyMs}ms)`,
      latencyMs
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorType = classifyError(error);
    let message = getErrorMessage(error, errorType);
    
    // Add helpful context for common issues
    if (message.includes('Could not find database') || message.includes('object_not_found')) {
      message += ' - Check that your integration has been added to this database in Notion.';
    }
    
    console.error(`[Notion] Connection test failed (${latencyMs}ms):`, message);
    console.error('[Notion] Error details:', error);
    
    return {
      success: false,
      message,
      latencyMs
    };
  }
}

