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
import { 
  createNotionClient, 
  withRetry, 
  andFilters, 
  classifyError, 
  getErrorMessage, 
  is504Error, 
  searchPagesInDatabase, 
  retrievePagesById,
  retrievePagesWithSpecificProperties,
  type PropertyItemValue
} from './notionApi';

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

const MAX_STATUS_WARNINGS = 5;
let missingStatusWarnings = 0;
const MAX_TITLE_WARNINGS = 3;
let missingTitleWarnings = 0;

// Notion SDK v2 types don't fully export query method types, so we define the response shape
interface QueryDatabaseResult {
  results: Array<PageObjectResponse | { object: string; [key: string]: unknown }>;
  next_cursor: string | null;
  has_more: boolean;
}

// Query arguments for database query
interface QueryDatabaseArgs {
  database_id: string;
  page_size?: number;
  start_cursor?: string;
  filter?: object;
  sorts?: Array<Record<string, unknown>>;
  filter_properties?: string[];
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
// Cache for data source IDs (SDK 5.x requires data_source_id for queries)
const dataSourceIdCache = new Map<string, string>();

/**
 * Get the data_source_id for any database (required for SDK 5.x)
 * The data_source_id is different from database_id in the new API
 */
async function getDataSourceIdForDatabase(client: Client, databaseId: string): Promise<string> {
  // Check cache first
  if (dataSourceIdCache.has(databaseId)) {
    return dataSourceIdCache.get(databaseId)!;
  }
  
  console.log(`[Notion] Getting data source ID for database ${databaseId.substring(0, 8)}...`);
  
  const database = await withRetry(
    client,
    () => client.databases.retrieve({ database_id: databaseId }),
    'Get data source ID'
  );
  
  // SDK 5.x: databases.retrieve returns data_sources array
  const dataSources = (database as any).data_sources;
  let dataSourceId: string;
  
  if (dataSources && dataSources.length > 0) {
    dataSourceId = dataSources[0].id;
    console.log(`[Notion] Got data source ID: ${dataSourceId.substring(0, 8)}...`);
  } else {
    // Fallback to database ID for older API versions
    dataSourceId = databaseId;
    console.log(`[Notion] No data_sources array, using database ID as fallback`);
  }
  
  dataSourceIdCache.set(databaseId, dataSourceId);
  return dataSourceId;
}

/**
 * Get the data_source_id for the tasks database
 */
async function getDataSourceId(): Promise<string> {
  if (cachedDataSourceId) {
    return cachedDataSourceId;
  }
  
  if (!notion) {
    throw new Error('Notion client not initialized');
  }
  
  cachedDataSourceId = await getDataSourceIdForDatabase(notion, getDatabaseId());
  return cachedDataSourceId;
}

/**
 * Query a database using the best available method:
 * 1. Try dataSources.query (SDK 5.x) 
 * 2. Fall back to raw fetch to databases/query endpoint
 * 
 * This ensures compatibility across different API versions.
 */
async function queryDatabaseReliably(
  client: Client,
  databaseId: string,
  options: {
    pageSize?: number;
    startCursor?: string;
    filter?: any;
    sorts?: any[];
  } = {}
): Promise<{ results: any[]; has_more: boolean; next_cursor: string | null }> {
  const { pageSize = 50, startCursor, filter, sorts } = options;
  
  // Get data source ID and use dataSources.query (SDK 5.x / API 2025)
  const dataSourceId = await getDataSourceIdForDatabase(client, databaseId);
  
  const response = await withRetry(
    client,
    () => (client as any).dataSources.query({
      data_source_id: dataSourceId,
      page_size: pageSize,
      start_cursor: startCursor ?? undefined,
      ...(filter && { filter }),
      ...(sorts && { sorts })
    }),
    'Query data source'
  );
  
  return {
    results: (response as any).results as PageObjectResponse[],
    has_more: (response as any).has_more,
    next_cursor: (response as any).next_cursor ?? null
  };
}

async function getPropertyIds(): Promise<Map<string, string>> {
  if (cachedPropertyIds) {
    return cachedPropertyIds;
  }
  
  if (!notion) {
    throw new Error('Notion client not initialized');
  }
  
  // SDK 5.x: Use dataSources.retrieve to get properties
  const dataSourceId = await getDataSourceId();
  console.log('[Notion] Fetching data source schema for property IDs...');
  
  try {
    // Use dataSources.retrieve (SDK 5.x)
    const dataSource = await withRetry(
      notion,
      () => (notion as any).dataSources.retrieve({ data_source_id: dataSourceId }),
      'Retrieve data source schema'
    );
    
    cachedPropertyIds = new Map();
    const props = (dataSource as any).properties || {};
    
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

function withAbortSignal<T>(
  promise: Promise<T>,
  abortSignal?: AbortSignal,
  label = 'operation'
): Promise<T> {
  if (!abortSignal) {
    return promise;
  }
  
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      abortSignal.removeEventListener('abort', onAbort);
      reject(new Error(`${label} was cancelled`));
    };
    
    if (abortSignal.aborted) {
      onAbort();
      return;
    }
    
    abortSignal.addEventListener('abort', onAbort);
    
    promise
      .then((result) => {
        abortSignal.removeEventListener('abort', onAbort);
        resolve(result);
      })
      .catch((error) => {
        abortSignal.removeEventListener('abort', onAbort);
        reject(error);
      });
  });
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
  
  // SDK 5.x: Use dataSources.query via queryDatabaseReliably
  // This returns a function that matches the old databases.query interface
  return async (args: QueryDatabaseArgs): Promise<QueryDatabaseResult> => {
    const databaseId = args.database_id;
    
    const response = await queryDatabaseReliably(client, databaseId, {
      pageSize: args.page_size,
      startCursor: args.start_cursor,
      filter: args.filter,
      sorts: args.sorts
    });
    
    return {
      results: response.results,
      has_more: response.has_more,
      next_cursor: response.next_cursor
    };
  };
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

  // SDK 5.x: Use data_source_id as parent instead of database_id
  const dataSourceId = await getDataSourceIdForDatabase(client, databaseId);
  const response = await client.pages.create({
    parent: { data_source_id: dataSourceId } as any,
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

  const queryPayload: QueryDatabaseArgs = {
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
 * 1. Try small page_size query first
 * 2. If that times out (504), fall back to Search API + pages.retrieve
 * 3. pages.retrieve NEVER times out because it only fetches one page
 * 
 * This is GUARANTEED to work even on databases with 50+ relations/rollups
 */
export interface ReliableImportResult {
  tasks: Task[];
  pageIds: string[];
  nextCursor: string | null;
  hasMore: boolean;
}

// Track cursor for search-based import
let searchImportCursor: string | undefined = undefined;

/**
 * Reset the search import state (call when starting a new import)
 */
export function resetSearchFallbackState(): void {
  searchImportCursor = undefined;
}

/**
 * IMPORT STRATEGY: Use Search API + Property-Specific Retrieval as PRIMARY
 * 
 * Why this is the best approach for IMPORT:
 * 1. Search API never times out (doesn't compute rollups/relations)
 * 2. Property-specific retrieval fetches ONLY what we need (8 props, not 200)
 * 3. Import is a one-time operation - reliability > speed
 * 4. Guaranteed to work even on databases with 200+ properties
 * 
 * For SYNC (incremental updates), we use databases.query with `since` filter
 * because it returns a small subset (recently edited items only).
 */
export async function getTasksBatchReliably(
  cursor?: string | null,
  batchSize: number = 5,
  abortSignal?: AbortSignal
): Promise<ReliableImportResult> {
  if (!notion) {
    return { tasks: [], pageIds: [], nextCursor: null, hasMore: false };
  }
  
  // SDK 5.x: Use data_source_id instead of database_id
  const dataSourceId = await getDataSourceId();
  const client = notion;
  
  console.log(`[Notion] IMPORT: Using dataSources.query with filter_properties (SDK 5.x)`);
  
  // Get property IDs for filter_properties - only fetch what we need
  const propertyIds = await getPropertyIds();
  
  // Define ONLY the properties we need for import
  const requiredPropertyNames = [
    settings.titleProperty,
    settings.statusProperty,
    settings.dateProperty,
    settings.deadlineProperty,
    settings.urgentProperty,
    settings.importantProperty,
    settings.mainEntryProperty,
    settings.sessionLengthProperty,
    settings.estimatedLengthProperty,
    settings.orderProperty,
    settings.projectRelationProperty,
    settings.parentTaskProperty,
    settings.recurrenceProperty,
    settings.idProperty
  ].filter((p): p is string => Boolean(p?.trim()));
  
  // Convert to property IDs
  const filterPropertyIds = requiredPropertyNames
    .map(name => propertyIds.get(name))
    .filter((id): id is string => Boolean(id));
  
  console.log(`[Notion] Requesting ${filterPropertyIds.length} properties (of ${propertyIds.size} total)`);
  
  try {
    // Check abort before API call
    if (abortSignal?.aborted) {
      throw new Error('Import was cancelled');
    }
    
    // NO FILTER - filters cause timeouts on complex databases
    // Instead, we fetch ALL tasks and sort so active ones come first
    // Sort by last_edited_time so recently worked-on tasks come first
    console.log(`[Notion] Importing all tasks (no filter, sorted by last edited)`);
    
    // STEP 1: Query data source to get page IDs (fast, minimal data)
    console.log(`[Notion] Step 1: Querying for page IDs...`);
    const queryPromise = withRetry(
      client,
      () => (client as any).dataSources.query({
        data_source_id: dataSourceId,
        page_size: batchSize,
        start_cursor: cursor ?? undefined
        // NO filter - causes timeouts
        // NO sorts - keep it simple for reliability
      }),
      'Query page IDs'
    );
    
    const response = await withAbortSignal(queryPromise, abortSignal, 'Query batch') as QueryDatabaseResult;
    const pageIds = response.results.map((r) => (r as PageObjectResponse).id);
    
    console.log(`[Notion] Found ${pageIds.length} page IDs, hasMore: ${response.has_more}`);
    
    if (pageIds.length === 0) {
      return {
        tasks: [],
        pageIds: [],
        nextCursor: response.next_cursor ?? null,
        hasMore: response.has_more
      };
    }
    
    // STEP 2: Retrieve each page individually for full properties
    console.log(`[Notion] Step 2: Retrieving ${pageIds.length} pages...`);
    const tasks: Task[] = [];
    
    for (const pageId of pageIds) {
      if (abortSignal?.aborted) {
        throw new Error('Import was cancelled');
      }
      
      try {
        const pagePromise = withRetry(
          client,
          () => client.pages.retrieve({ page_id: pageId }),
          `Retrieve page ${pageId.substring(0, 8)}`
        );
        
        const page = await withAbortSignal(pagePromise, abortSignal, 'Retrieve page') as PageObjectResponse;
        const task = mapPageToTask(page, settings);
        tasks.push(task);
      } catch (pageError) {
        console.warn(`[Notion] Failed to retrieve page ${pageId}:`, pageError);
        // Continue with other pages
      }
    }
    
    console.log(`[Notion] IMPORT batch: ${tasks.length} tasks retrieved`);
    
    // Debug: Log first task details
    if (tasks.length > 0) {
      const sample = tasks[0];
      console.log(`[Notion] Sample task: title="${sample.title}", status="${sample.status}", dueDate="${sample.dueDate}"`);
    }
    
    return {
      tasks,
      pageIds,
      nextCursor: response.next_cursor ?? null,
      hasMore: response.has_more
    };
  } catch (error) {
    if (abortSignal?.aborted) {
      throw new Error('Import was cancelled');
    }
    throw error;
  }
}

/**
 * DATE-CHUNK IMPORT - Bypasses cursor pagination which causes 504 errors
 * 
 * This is the ONLY reliable approach for complex databases (200+ properties):
 * - Uses date filters instead of cursor pagination
 * - Each chunk is independent (no cursor = no 504 errors)
 * - Gets ~50 tasks per chunk using last_edited_time ranges
 * 
 * @param targetCount - Maximum number of tasks to import
 * @param onProgress - Callback for progress updates
 * @param abortSignal - Signal to cancel the import
 */
export async function importTasksWithDateChunks(
  targetCount: number = 500,
  onProgress?: (imported: number, chunk: string) => void,
  abortSignal?: AbortSignal
): Promise<Task[]> {
  if (!notion) {
    return [];
  }
  
  const dataSourceId = await getDataSourceId();
  const client = notion;
  
  // Helper to format date as YYYY-MM-DD (required format for Notion)
  const formatDate = (daysAgo: number): string => {
    const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
  };
  
  // Date ranges - last_edited_time (most reliable for active tasks)
  const dateRanges: [number, number][] = [
    [0, 7],       // Last week
    [7, 14],      
    [14, 30],     
    [30, 60],     
    [60, 90],     
    [90, 120],    
    [120, 180],   // Up to 6 months
  ];
  
  const allTasks: Task[] = [];
  
  console.log(`[Notion] DATE-CHUNK IMPORT: Fetching up to ${targetCount} tasks`);
  
  for (const [startDays, endDays] of dateRanges) {
    if (abortSignal?.aborted) {
      throw new Error('Import was cancelled');
    }
    
    if (allTasks.length >= targetCount) {
      break;
    }
    
    const afterDate = formatDate(endDays);
    const beforeDate = formatDate(startDays);
    const chunkName = `${startDays}-${endDays} days`;
    
    console.log(`[Notion] Chunk: ${chunkName} (${afterDate} to ${beforeDate})`);
    onProgress?.(allTasks.length, chunkName);
    
    try {
      // Query with date filter (no cursor pagination = no 504!)
      const response = await withRetry(
        client,
        () => (client as any).dataSources.query({
          data_source_id: dataSourceId,
          page_size: 50,
          filter: {
            and: [
              { timestamp: 'last_edited_time', last_edited_time: { after: afterDate } },
              { timestamp: 'last_edited_time', last_edited_time: { on_or_before: beforeDate } }
            ]
          }
        }),
        `Query chunk ${chunkName}`
      ) as { results: any[]; has_more: boolean; next_cursor: string | null };
      
      const pageIds = response.results.map((r: any) => r.id);
      console.log(`[Notion] Chunk ${chunkName}: ${pageIds.length} page IDs`);
      
      // Retrieve full pages
      for (const pageId of pageIds) {
        if (abortSignal?.aborted) {
          throw new Error('Import was cancelled');
        }
        
        if (allTasks.length >= targetCount) {
          break;
        }
        
        try {
          const page = await withRetry(
            client,
            () => client.pages.retrieve({ page_id: pageId }),
            `Retrieve page`
          ) as PageObjectResponse;
          
          const task = mapPageToTask(page, settings);
          allTasks.push(task);
        } catch (pageErr) {
          console.warn(`[Notion] Failed to retrieve page ${pageId.substring(0, 8)}`);
        }
      }
      
      console.log(`[Notion] Chunk ${chunkName}: Total ${allTasks.length} tasks`);
      onProgress?.(allTasks.length, chunkName);
      
    } catch (chunkErr: any) {
      // Skip failed chunks and continue
      console.warn(`[Notion] Chunk ${chunkName} failed: ${chunkErr.message?.substring(0, 50)}`);
    }
    
    // Small delay between chunks
    await new Promise(r => setTimeout(r, 300));
  }
  
  console.log(`[Notion] DATE-CHUNK IMPORT complete: ${allTasks.length} tasks`);
  return allTasks;
}

/**
 * PRIMARY IMPORT STRATEGY: Search API + Property-Specific Retrieval
 * 
 * This is the OPTIMAL approach for importing from databases with many properties:
 * - Search API finds pages WITHOUT computing rollups/relations
 * - Property-specific endpoint fetches ONLY the ~10 properties we need
 * - Guaranteed to work even on databases with 200+ properties
 * 
 * Performance comparison for 200-property database:
 * - databases.query: Computes 200 properties → often times out (504)
 * - pages.retrieve: Returns 200 properties → slow
 * - This method: Fetches 10 properties → ~20x faster, never times out
 */
async function getTasksBatchViaSearch(
  client: Client,
  dbId: string,
  cursor: string | undefined,
  batchSize: number,
  abortSignal?: AbortSignal
): Promise<ReliableImportResult> {
  console.log(`[Notion] IMPORT: Search + Property-Specific (cursor: ${cursor ? 'yes' : 'no'})`);
  
  // For complex databases (200+ properties), use very small page sizes
  // to avoid Notion API timeouts
  const effectivePageSize = Math.max(1, Math.min(batchSize, 3)); // Cap at 3
  
  const searchResult = await withAbortSignal(
    searchPagesInDatabase(
      client,
      dbId,
      '', // Empty query = all pages
      effectivePageSize,
      cursor
    ),
    abortSignal,
    'Search tasks'
  );
  
  // Track cursor for next batch
  searchImportCursor = searchResult.nextCursor ?? undefined;
  
  if (searchResult.pageIds.length === 0) {
    return {
      tasks: [],
      pageIds: [],
      nextCursor: searchResult.nextCursor,
      hasMore: searchResult.hasMore
    };
  }
  
  // Get property ID mapping (cached after first call)
  const propertyIds = await getPropertyIds();
  if (abortSignal?.aborted) {
    throw new Error('Import was cancelled');
  }
  
  if (propertyIds.size === 0) {
    // Fallback to full page retrieval if schema fetch failed
    console.warn('[Notion] No property IDs cached, using full page retrieval');
    const tasks = await withAbortSignal(
      fetchTasksFromPageIds(client, searchResult.pageIds),
      abortSignal,
      'Fetch tasks from page IDs'
    );
    return {
      tasks,
      pageIds: searchResult.pageIds,
      nextCursor: searchResult.nextCursor,
      hasMore: searchResult.hasMore
    };
  }
  
  // Define ONLY the properties we actually need for the app
  // This is the key optimization - we skip 190+ properties we don't use
  const requiredProperties = [
    settings.titleProperty,      // Task name
    settings.statusProperty,     // Status (To-Do, In Progress, Done)
    settings.dateProperty,       // Due date
    settings.deadlineProperty,   // Hard/soft deadline
    settings.urgentProperty,     // Urgent flag
    settings.importantProperty,  // Important flag
    settings.mainEntryProperty,  // Main entry text
    settings.sessionLengthProperty,    // Session length in minutes
    settings.estimatedLengthProperty,  // Estimated length
    settings.orderProperty,      // Priority/order
    settings.projectRelationProperty,  // Project relation
    settings.parentTaskProperty, // Parent task (for subtasks)
    settings.recurrenceProperty, // Recurrence pattern
    settings.idProperty          // Unique ID for deduplication (e.g., "ACTION-123")
  ].filter((p): p is string => Boolean(p?.trim()));
  
  console.log(`[Notion] Fetching ${requiredProperties.length} properties per task (skipping ${propertyIds.size - requiredProperties.length} unused properties)`);
  
  // Use optimized property-specific retrieval
  const pageData = await withAbortSignal(
    retrievePagesWithSpecificProperties(
      client,
      searchResult.pageIds,
      propertyIds,
      requiredProperties,
      3 // 3 pages in parallel (each page fetches ~10 properties)
    ),
    abortSignal,
    'Retrieve task properties'
  );
  
  // Map to tasks
  const tasks: Task[] = [];
  for (const { id, url, properties } of pageData) {
    if (abortSignal?.aborted) {
      throw new Error('Import was cancelled');
    }
    const task = mapPropertiesToTask(id, url, properties);
    tasks.push(task);
  }
  
  const withStatus = tasks.filter(t => t.status).length;
  console.log(`[Notion] IMPORT batch: ${tasks.length} tasks (${withStatus} with status)`);
  if (tasks.length === 0) {
    console.warn('[Notion] IMPORT batch returned 0 tasks - possible stale cursor or empty database');
  }
  
  return {
    tasks,
    pageIds: searchResult.pageIds,
    nextCursor: searchResult.nextCursor,
    hasMore: searchResult.hasMore
  };
}

/**
 * Map property values to a Task object (used with property-specific retrieval)
 */
function mapPropertiesToTask(
  pageId: string,
  url: string,
  properties: Map<string, PropertyItemValue>
): Task {
  const rawTitle = extractTitleFromPropertyItem(properties.get(settings.titleProperty));
  if (!rawTitle && missingTitleWarnings < MAX_TITLE_WARNINGS) {
    missingTitleWarnings++;
    console.warn(`[Notion] Task ${pageId} missing title (property "${settings.titleProperty}")`);
  }
  const title = rawTitle || 'Untitled';
  
  const status = extractStatusFromPropertyItem(properties.get(settings.statusProperty));
  if (!status && missingStatusWarnings < MAX_STATUS_WARNINGS) {
    missingStatusWarnings++;
    console.warn(`[Notion] Task "${title}" missing status (property "${settings.statusProperty}")`);
  }
  const uniqueId = settings.idProperty 
    ? extractUniqueIdFromPropertyItem(properties.get(settings.idProperty))
    : null;
  const { start: dueDate, end: dueDateEnd } = extractDateRangeFromPropertyItem(properties.get(settings.dateProperty));
  
  const hardDeadline = settings.deadlineProperty 
    ? isStatusMatchFromPropertyItem(properties.get(settings.deadlineProperty), settings.deadlineHardValue)
    : false;
  
  const urgent = settings.urgentProperty
    ? extractBooleanFromPropertyItem(properties.get(settings.urgentProperty), settings.urgentStatusActive)
    : false;
    
  const important = settings.importantProperty
    ? extractBooleanFromPropertyItem(properties.get(settings.importantProperty), settings.importantStatusActive)
    : false;
  
  const mainEntry = settings.mainEntryProperty
    ? extractRichTextFromPropertyItem(properties.get(settings.mainEntryProperty))
    : undefined;
  
  const sessionLengthMinutes = settings.sessionLengthProperty
    ? extractNumberFromPropertyItem(properties.get(settings.sessionLengthProperty))
    : undefined;
    
  const estimatedLengthMinutes = settings.estimatedLengthProperty
    ? extractNumberFromPropertyItem(properties.get(settings.estimatedLengthProperty))
    : undefined;
  
  const orderSelect = settings.orderProperty
    ? extractSelectFromPropertyItem(properties.get(settings.orderProperty))
    : null;
  
  const projectIds = settings.projectRelationProperty
    ? extractRelationIdsFromPropertyItem(properties.get(settings.projectRelationProperty))
    : null;
    
  const parentTaskIds = settings.parentTaskProperty
    ? extractRelationIdsFromPropertyItem(properties.get(settings.parentTaskProperty))
    : null;
  const parentTaskId = parentTaskIds && parentTaskIds.length > 0 ? parentTaskIds[0] : undefined;
  
  const recurrence = settings.recurrenceProperty
    ? extractMultiSelectFromPropertyItem(properties.get(settings.recurrenceProperty))
    : null;
  
  // Import status filter mapping
  const { mapStatusToFilterValue } = require('@shared/statusFilters');
  const normalizedStatus = mapStatusToFilterValue(status);
  
  return {
    id: pageId,
    uniqueId: uniqueId ?? undefined,
    title,
    status: status ?? undefined,
    normalizedStatus,
    dueDate,
    dueDateEnd: dueDateEnd ?? undefined,
    url,
    hardDeadline,
    urgent,
    important,
    mainEntry: mainEntry ?? undefined,
    sessionLengthMinutes,
    estimatedLengthMinutes,
    orderValue: orderSelect?.name ?? null,
    orderColor: orderSelect?.color ?? null,
    projectIds,
    recurrence: recurrence && recurrence.length > 0 ? recurrence : undefined,
    parentTaskId
  };
}

// Additional property extractors for tasks
function extractDateRangeFromPropertyItem(prop: PropertyItemValue | undefined): { start?: string; end?: string } {
  if (!prop || prop.type !== 'date') {
    return {};
  }
  return {
    start: prop.date?.start ?? undefined,
    end: prop.date?.end ?? undefined
  };
}

function isStatusMatchFromPropertyItem(prop: PropertyItemValue | undefined, expected: string): boolean {
  if (!prop || !expected) return false;
  if (prop.type === 'status') {
    return prop.status?.name === expected;
  }
  if (prop.type === 'select') {
    return prop.select?.name === expected;
  }
  return false;
}

function extractBooleanFromPropertyItem(prop: PropertyItemValue | undefined, activeLabel: string): boolean {
  if (!prop) return false;
  if (prop.type === 'checkbox') {
    return Boolean(prop.checkbox);
  }
  return isStatusMatchFromPropertyItem(prop, activeLabel);
}

function extractNumberFromPropertyItem(prop: PropertyItemValue | undefined): number | undefined {
  if (!prop) return undefined;
  if (prop.type === 'number') {
    return typeof prop.number === 'number' ? prop.number : undefined;
  }
  if (prop.type === 'formula') {
    const value = prop.formula;
    if (value && 'number' in value && typeof value.number === 'number') {
      return value.number;
    }
  }
  return undefined;
}

function extractSelectFromPropertyItem(prop: PropertyItemValue | undefined): { name: string; color?: string } | null {
  if (!prop) return null;
  if (prop.type === 'select' && prop.select) {
    return { name: prop.select.name, color: prop.select.color };
  }
  if (prop.type === 'status' && prop.status) {
    return { name: prop.status.name, color: prop.status.color };
  }
  return null;
}

function extractRelationIdsFromPropertyItem(prop: PropertyItemValue | undefined): string[] | null {
  if (!prop) return null;
  
  // Relation properties return a paginated list
  if (prop.type === 'relation') {
    const relations = prop.relation || prop.results;
    if (Array.isArray(relations)) {
      return relations.map((r: any) => r.id);
    }
  }
  
  // Handle paginated response format
  if (prop.type === 'property_item' && Array.isArray((prop as any).results)) {
    return (prop as any).results.map((r: any) => r.relation?.id || r.id).filter(Boolean);
  }
  
  return null;
}

/**
 * Fetch tasks from a list of page IDs using pages.retrieve
 */
async function fetchTasksFromPageIds(client: Client, pageIds: string[]): Promise<Task[]> {
  const tasks: Task[] = [];
  const PARALLEL_LIMIT = 3; // Conservative parallelism
  
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
        
        // Log task status for debugging (only first few without status)
        if (!task.status && tasks.filter(t => !t.status).length <= 3) {
          console.log(`[Notion] Task without status: "${task.title}" (checking property "${settings.statusProperty}")`);
          const propNames = Object.keys(page.properties || {});
          console.log(`[Notion] Available properties: ${propNames.join(', ')}`);
        }
      }
    }
  }
  
  return tasks;
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

  // Set Widget Link date property - marks this task as synced to the widget
  if (settings.widgetLinkProperty) {
    properties[settings.widgetLinkProperty] = {
      date: { start: new Date().toISOString() }
    };
  }

  const client = notion;
  // SDK 5.x: Use data_source_id as parent instead of database_id
  const dataSourceId = await getDataSourceId();
  const pageResponse = await withRetry(
    client,
    () => client.pages.create({
      parent: { data_source_id: dataSourceId } as any,
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

  // Always update Widget Link date property when syncing - marks last sync time
  if (settings.widgetLinkProperty) {
    properties[settings.widgetLinkProperty] = {
      date: { start: new Date().toISOString() }
    };
  }

  // If only widgetLinkProperty was set and nothing else, that's still valid
  const hasRealUpdates = Object.keys(properties).filter(k => k !== settings.widgetLinkProperty).length > 0;
  if (!hasRealUpdates && !settings.widgetLinkProperty) {
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
      
      // Extract unique ID for deduplication (e.g., "TIME-LOG-123")
      const uniqueId = extractUniqueIdFromPageProperty(props, timeLogSettings?.idProperty);

      entries.push({
        id: result.id,
        uniqueId: uniqueId ?? undefined,
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

    console.log(`[Notion] Starting time logs IMPORT from database: ${dbId.substring(0, 8)}...`);
    
    // SDK 5.x: Use two-step approach - query for IDs, then retrieve each page
    return await getTimeLogsReliably(client, dbId);
  } catch (error: any) {
    console.error('Failed to fetch time logs', {
      databaseId: timeLogSettings.databaseId,
      error: error.message,
      code: error.code
    });
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

/**
 * SDK 5.x Reliable Time Logs Import
 * Two-step approach: Query data source for page IDs, then retrieve each page individually
 */
async function getTimeLogsReliably(client: Client, dbId: string): Promise<TimeLogEntry[]> {
  console.log('[Notion] Using reliable two-step import for time logs...');
  
  // Filter to only get time logs from the last 2 days
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const twoDaysAgoISO = twoDaysAgo.toISOString();
  
  const filter = timeLogSettings?.startTimeProperty
    ? {
        property: timeLogSettings.startTimeProperty,
        date: { on_or_after: twoDaysAgoISO }
      }
    : undefined;
  
  const entries: TimeLogEntry[] = [];
  let cursor: string | null = null;
  let batchNum = 0;
  const MAX_BATCHES = 10;
  
  // Temporarily set timeLogSettings apiKey for fallback query
  const originalApiKey = settings.apiKey;
  if (timeLogSettings?.apiKey) {
    settings.apiKey = timeLogSettings.apiKey;
  }
  
  try {
    while (batchNum < MAX_BATCHES) {
      batchNum++;
      
      // STEP 1: Query for page IDs using reliable method
      console.log(`[Notion] Time logs batch ${batchNum}: Querying page IDs...`);
      const response = await queryDatabaseReliably(client, dbId, {
        pageSize: 50,
        startCursor: cursor ?? undefined,
        filter,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }]
      });
      
      const pageIds = response.results.map((r: any) => r.id);
      console.log(`[Notion] Time logs batch ${batchNum}: Found ${pageIds.length} page IDs`);
      
      if (pageIds.length === 0) {
        break;
      }
      
      // STEP 2: Retrieve each page individually
      for (const pageId of pageIds) {
        try {
          const page = await withRetry(
            client,
            () => client.pages.retrieve({ page_id: pageId }),
            `Retrieve time log ${pageId.substring(0, 8)}`
          ) as PageObjectResponse;
          
          const entry = mapPageToTimeLogEntry(page);
          if (entry) {
            entries.push(entry);
          }
        } catch (pageError) {
          console.warn(`[Notion] Failed to retrieve time log ${pageId}:`, pageError);
        }
      }
      
      if (!response.has_more) {
        break;
      }
      
      cursor = response.next_cursor;
    }
  } finally {
    settings.apiKey = originalApiKey;
  }
  
  console.log(`[Notion] Time logs import complete: ${entries.length} entries`);
  return entries;
}

/**
 * DATE-CHUNK IMPORT for Time Logs - Bypasses cursor pagination
 * Uses date filters instead of cursor to avoid 504 errors on complex databases
 */
export async function importTimeLogsWithDateChunks(
  daysBack: number = 30,
  onProgress?: (imported: number, chunk: string) => void
): Promise<TimeLogEntry[]> {
  const client = getTimeLogClient();
  const dbId = getTimeLogDatabaseId();
  
  if (!client || !dbId) {
    console.warn('[Notion] Time logs not configured');
    return [];
  }
  
  const dataSourceId = await getDataSourceIdForDatabase(client, dbId);
  
  // Helper to format date as YYYY-MM-DD
  const formatDate = (daysAgo: number): string => {
    const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
  };
  
  // Date ranges for time logs (smaller ranges, more recent focus)
  const allRanges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 7], [7, 14], [14, 30]
  ];
  const dateRanges = allRanges.filter(([_, end]) => end <= daysBack);
  
  const allEntries: TimeLogEntry[] = [];
  
  console.log(`[Notion] DATE-CHUNK IMPORT: Fetching time logs (last ${daysBack} days)`);
  
  for (const [startDays, endDays] of dateRanges) {
    const afterDate = formatDate(endDays);
    const beforeDate = formatDate(startDays);
    const chunkName = `${startDays}-${endDays} days`;
    
    console.log(`[Notion] Time logs chunk: ${chunkName}`);
    onProgress?.(allEntries.length, chunkName);
    
    try {
      const response = await withRetry(
        client,
        () => (client as any).dataSources.query({
          data_source_id: dataSourceId,
          page_size: 50,
          filter: {
            and: [
              { timestamp: 'created_time', created_time: { after: afterDate } },
              { timestamp: 'created_time', created_time: { on_or_before: beforeDate } }
            ]
          }
        }),
        `Query time logs chunk ${chunkName}`
      ) as { results: any[]; has_more: boolean; next_cursor: string | null };
      
      const pageIds = response.results.map((r: any) => r.id);
      
      for (const pageId of pageIds) {
        try {
          const page = await withRetry(
            client,
            () => client.pages.retrieve({ page_id: pageId }),
            'Retrieve time log'
          ) as PageObjectResponse;
          
          const entry = mapPageToTimeLogEntry(page);
          if (entry) {
            allEntries.push(entry);
          }
        } catch (err) {
          // Skip failed pages
        }
      }
      
      onProgress?.(allEntries.length, chunkName);
    } catch (chunkErr: any) {
      console.warn(`[Notion] Time logs chunk ${chunkName} failed`);
    }
    
    await new Promise(r => setTimeout(r, 300));
  }
  
  console.log(`[Notion] DATE-CHUNK IMPORT complete: ${allEntries.length} time logs`);
  return allEntries;
}

/**
 * Map a Notion page to a TimeLogEntry
 */
function mapPageToTimeLogEntry(page: PageObjectResponse): TimeLogEntry | null {
  const props = page.properties ?? {};
  
  const startProp =
    (timeLogSettings?.startTimeProperty &&
      props[timeLogSettings.startTimeProperty]) ||
    undefined;
  const endProp =
    (timeLogSettings?.endTimeProperty &&
      props[timeLogSettings.endTimeProperty]) ||
    undefined;
  const titleProp =
    (timeLogSettings?.titleProperty &&
      props[timeLogSettings.titleProperty]) ||
    undefined;
  const taskProp =
    (timeLogSettings?.taskProperty &&
      props[timeLogSettings.taskProperty]) ||
    undefined;

  const startTime =
    (startProp as any)?.type === 'date' ? (startProp as any).date?.start ?? null : null;
  let endTime =
    (endProp as any)?.type === 'date' ? (endProp as any).date?.start ?? null : null;
  if (!endTime && (startProp as any)?.type === 'date') {
    endTime = (startProp as any).date?.end ?? null;
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
    (titleProp as any)?.type === 'title'
      ? (titleProp as any).title.map((t: any) => t.plain_text).join('')
      : null;

  // Extract task relation if available
  let taskId: string | null = null;
  let taskTitle: string | null = null;
  if ((taskProp as any)?.type === 'relation' && (taskProp as any).relation.length > 0) {
    taskId = (taskProp as any).relation[0].id;
  }
  
  // Extract unique ID for deduplication
  const uniqueId = extractUniqueIdFromPageProperty(props, timeLogSettings?.idProperty);

  return {
    id: page.id,
    uniqueId: uniqueId ?? undefined,
    startTime,
    endTime,
    durationMinutes,
    title,
    taskId,
    taskTitle
  };
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
    console.warn('[Notion] Projects database ID not configured - returning empty array');
    console.warn('[Notion] Configure the Projects database in Control Center > Projects Settings');
    return [];
  }

  let client: Client;
  let dbId: string;
  
  try {
    client = getProjectsClient();
  } catch (error) {
    console.error('[Notion] Failed to get projects client:', error);
    throw new Error('Projects API not configured. Please add your Notion API key in Control Center.');
  }
  
  try {
    dbId = getProjectsDatabaseId();
  } catch (error) {
    console.error('[Notion] Failed to get projects database ID:', error);
    throw new Error('Projects database ID is invalid. Please check your database ID in Control Center.');
  }
  
  console.log(`[Notion] Starting projects IMPORT from database: ${dbId.substring(0, 8)}...`);

  // SDK 5.x: Use two-step approach - query for IDs, then retrieve each page
  return await getProjectsReliably(client, dbId);
}

/**
 * SDK 5.x Reliable Projects Import
 * Two-step approach: Query data source for page IDs, then retrieve each page individually
 */
async function getProjectsReliably(client: Client, dbId: string): Promise<Project[]> {
  console.log('[Notion] Using reliable two-step import for projects...');
  
  const projects: Project[] = [];
  let cursor: string | null = null;
  let batchNum = 0;
  const MAX_BATCHES = 20;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 3;
  
  // Temporarily set projectsSettings apiKey for fallback query
  const originalApiKey = settings.apiKey;
  if (projectsSettings?.apiKey) {
    settings.apiKey = projectsSettings.apiKey;
  }
  
  try {
    while (batchNum < MAX_BATCHES) {
      batchNum++;
      
      // STEP 1: Query for page IDs using reliable method
      console.log(`[Notion] Projects batch ${batchNum}: Querying page IDs...`);
      
      let response;
      try {
        response = await queryDatabaseReliably(client, dbId, {
          pageSize: 25, // Smaller batch to avoid rate limits
          startCursor: cursor ?? undefined
        });
        consecutiveErrors = 0; // Reset on success
      } catch (queryError: any) {
        consecutiveErrors++;
        const errorMsg = queryError?.message || String(queryError);
        console.warn(`[Notion] Projects query error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${errorMsg}`);
        
        if (errorMsg.includes('temporarily unavailable') || errorMsg.includes('rate_limited')) {
          // Rate limited - wait longer and retry
          console.log('[Notion] Rate limited, waiting 5 seconds...');
          await new Promise(r => setTimeout(r, 5000));
          if (consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
            batchNum--; // Retry this batch
            continue;
          }
        }
        
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.error('[Notion] Too many errors, stopping projects import');
          break;
        }
        continue;
      }
      
      const pageIds = response.results.map((r: any) => r.id);
      console.log(`[Notion] Projects batch ${batchNum}: Found ${pageIds.length} page IDs`);
      
      if (pageIds.length === 0) {
        break;
      }
      
      // STEP 2: Retrieve each page individually with delays
      for (let i = 0; i < pageIds.length; i++) {
        const pageId = pageIds[i];
        try {
          // Small delay between page retrievals to avoid rate limits
          if (i > 0 && i % 5 === 0) {
            await new Promise(r => setTimeout(r, 200));
          }
          
          const page = await withRetry(
            client,
            () => client.pages.retrieve({ page_id: pageId }),
            `Retrieve project ${pageId.substring(0, 8)}`
          ) as PageObjectResponse;
          
          const project = mapPageToProject(page, projects.length === 0);
          
          // Validate: skip if no ID or name
          if (!project.id || !project.title) {
            console.warn(`[Notion] Skipping invalid project (no ID or name): ${pageId}`);
            continue;
          }
          
          projects.push(project);
        } catch (pageError: any) {
          const errorMsg = pageError?.message || String(pageError);
          if (errorMsg.includes('temporarily unavailable') || errorMsg.includes('rate_limited')) {
            console.log('[Notion] Rate limited on page retrieve, waiting 3 seconds...');
            await new Promise(r => setTimeout(r, 3000));
          }
          console.warn(`[Notion] Failed to retrieve project ${pageId}:`, pageError);
        }
      }
      
      if (!response.has_more) {
        break;
      }
      
      // Delay between batches to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
      
      cursor = response.next_cursor;
    }
  } finally {
    // Restore original API key
    settings.apiKey = originalApiKey;
  }
  
  console.log(`[Notion] Projects import complete: ${projects.length} projects`);
  return projects;
}

/**
 * DATE-CHUNK IMPORT for Projects - Bypasses cursor pagination
 * Uses date filters instead of cursor to avoid 504 errors on complex databases
 */
export async function importProjectsWithDateChunks(
  targetCount: number = 200,
  onProgress?: (imported: number, chunk: string) => void
): Promise<Project[]> {
  const client = getProjectsClient();
  const dbId = getProjectsDatabaseId();
  
  if (!client || !dbId) {
    console.warn('[Notion] Projects not configured');
    return [];
  }
  
  const dataSourceId = await getDataSourceIdForDatabase(client, dbId);
  
  // Helper to format date as YYYY-MM-DD
  const formatDate = (daysAgo: number): string => {
    const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
  };
  
  // Date ranges
  const dateRanges: [number, number][] = [
    [0, 30], [30, 60], [60, 90], [90, 180], [180, 365], [365, 730]
  ];
  
  const allProjects: Project[] = [];
  
  console.log(`[Notion] DATE-CHUNK IMPORT: Fetching up to ${targetCount} projects`);
  
  for (const [startDays, endDays] of dateRanges) {
    if (allProjects.length >= targetCount) break;
    
    const afterDate = formatDate(endDays);
    const beforeDate = formatDate(startDays);
    const chunkName = `${startDays}-${endDays} days`;
    
    console.log(`[Notion] Projects chunk: ${chunkName}`);
    onProgress?.(allProjects.length, chunkName);
    
    try {
      const response = await withRetry(
        client,
        () => (client as any).dataSources.query({
          data_source_id: dataSourceId,
          page_size: 50,
          filter: {
            and: [
              { timestamp: 'last_edited_time', last_edited_time: { after: afterDate } },
              { timestamp: 'last_edited_time', last_edited_time: { on_or_before: beforeDate } }
            ]
          }
        }),
        `Query projects chunk ${chunkName}`
      ) as { results: any[]; has_more: boolean; next_cursor: string | null };
      
      const pageIds = response.results.map((r: any) => r.id);
      
      for (const pageId of pageIds) {
        if (allProjects.length >= targetCount) break;
        
        try {
          const page = await withRetry(
            client,
            () => client.pages.retrieve({ page_id: pageId }),
            'Retrieve project'
          ) as PageObjectResponse;
          
          const project = mapPageToProject(page, allProjects.length === 0);
          if (project.id && project.title) {
            allProjects.push(project);
          }
        } catch (err) {
          // Skip failed pages
        }
      }
      
      onProgress?.(allProjects.length, chunkName);
    } catch (chunkErr: any) {
      console.warn(`[Notion] Projects chunk ${chunkName} failed`);
    }
    
    await new Promise(r => setTimeout(r, 300));
  }
  
  console.log(`[Notion] DATE-CHUNK IMPORT complete: ${allProjects.length} projects`);
  return allProjects;
}

/**
 * Standard approach: Use database.query with minimal properties
 */
async function getProjectsViaQuery(client: Client, dbId: string): Promise<Project[]> {
  const projects: Project[] = [];
  let cursor: string | null | undefined = undefined;

  const queryDatabase = bindDatabaseQuery(client);

  // ULTRA-MINIMAL QUERY: No filter, only title property, small page size
  // This is the fastest possible query for complex databases
  
  // Get property IDs for filter_properties optimization
  const propertyIds = await getProjectPropertyIds();
  
  // Find the title property ID - that's all we absolutely need
  const titlePropName = projectsSettings!.titleProperty || 'Name';
  const titlePropId = propertyIds.get(titlePropName);
  
  // Get status property ID - try configured property first, then common fallbacks
  const statusPropertyName = projectsSettings!.statusProperty || 'Status';
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
  
  console.log(`[Notion] Projects query - ${filterPropertyIds.length} properties, page_size=5`);

  do {
    const response = await withRetry(
      client,
      () => queryDatabase({
        database_id: dbId,
        // NO filter, NO sort - absolute minimum query
        ...(filterPropertyIds.length > 0 && { filter_properties: filterPropertyIds }),
        page_size: 5, // Even smaller page size for reliability
        start_cursor: cursor ?? undefined
      }),
      'Query projects database'
    );

    for (const result of response.results) {
      if (!isPageResponse(result)) continue;
      const project = mapPageToProject(result, projects.length === 0);
      projects.push(project);
    }

    cursor = response.next_cursor ?? null;
  } while (cursor);

  console.log(`[Notion] Fetched ${projects.length} projects via query`);
  const withStatus = projects.filter(p => p.status).length;
  console.log(`[Notion] Projects with status: ${withStatus}/${projects.length}`);
  
  return projects;
}

/**
 * Fallback approach: Use Search API + property-specific retrieval
 * 
 * OPTIMIZED for databases with many properties (50+):
 * - Instead of pages.retrieve (fetches ALL properties), we use
 * - pages/{page_id}/properties/{property_id} (fetches ONE property)
 * 
 * For a database with 200 properties where we only need 5:
 * - pages.retrieve: computes 200 properties → slow, may timeout
 * - This method: computes 5 properties → 40x faster
 */
async function getProjectsViaSearch(client: Client, dbId: string): Promise<Project[]> {
  console.log('[Notion] Using OPTIMIZED Search API fallback for projects (property-specific retrieval)...');
  
  // Get property ID mapping first
  const propertyIds = await getProjectPropertyIds();
  
  if (propertyIds.size === 0) {
    console.warn('[Notion] No property IDs available, falling back to full page retrieval');
    return getProjectsViaSearchFullPages(client, dbId);
  }
  
  // Define the ONLY properties we need for projects
  const requiredProperties = [
    projectsSettings?.titleProperty || 'Name',
    projectsSettings?.statusProperty || 'Status',
    projectsSettings?.descriptionProperty,
    projectsSettings?.startDateProperty,
    projectsSettings?.endDateProperty,
    projectsSettings?.tagsProperty,
    projectsSettings?.idProperty  // Unique ID for deduplication (e.g., "PRJ-123")
  ].filter((p): p is string => Boolean(p?.trim()));
  
  console.log(`[Notion] Will fetch only ${requiredProperties.length} properties per page: ${requiredProperties.join(', ')}`);
  
  const projects: Project[] = [];
  let cursor: string | undefined = undefined;
  let totalPagesFound = 0;
  let emptySearchCount = 0;
  const MAX_EMPTY_SEARCHES = 5;
  
  while (emptySearchCount < MAX_EMPTY_SEARCHES) {
    const searchResult = await searchPagesInDatabase(
      client,
      dbId,
      '',
      20,
      cursor
    );
    
    if (searchResult.pageIds.length === 0) {
      emptySearchCount++;
      if (!searchResult.hasMore) break;
      cursor = searchResult.nextCursor ?? undefined;
      continue;
    }
    
    emptySearchCount = 0;
    totalPagesFound += searchResult.pageIds.length;
    
    console.log(`[Notion] Found ${searchResult.pageIds.length} project pages, fetching specific properties...`);
    
    // Use optimized property-specific retrieval
    const pageData = await retrievePagesWithSpecificProperties(
      client,
      searchResult.pageIds,
      propertyIds,
      requiredProperties,
      2 // 2 pages in parallel (each page fetches multiple properties)
    );
    
    for (const { id, url, properties } of pageData) {
      const project = mapPropertiesToProject(id, url, properties, projects.length === 0);
      projects.push(project);
    }
    
    if (!searchResult.hasMore) break;
    cursor = searchResult.nextCursor ?? undefined;
    
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  console.log(`[Notion] Fetched ${projects.length} projects via OPTIMIZED Search API (total pages found: ${totalPagesFound})`);
  const withStatus = projects.filter(p => p.status).length;
  console.log(`[Notion] Projects with status: ${withStatus}/${projects.length}`);
  
  return projects;
}

/**
 * Legacy fallback - uses full page retrieval (for when property IDs aren't available)
 */
async function getProjectsViaSearchFullPages(client: Client, dbId: string): Promise<Project[]> {
  console.log('[Notion] Using Search API fallback with full page retrieval...');
  
  const projects: Project[] = [];
  let cursor: string | undefined = undefined;
  let emptySearchCount = 0;
  const MAX_EMPTY_SEARCHES = 5;
  
  while (emptySearchCount < MAX_EMPTY_SEARCHES) {
    const searchResult = await searchPagesInDatabase(client, dbId, '', 20, cursor);
    
    if (searchResult.pageIds.length === 0) {
      emptySearchCount++;
      if (!searchResult.hasMore) break;
      cursor = searchResult.nextCursor ?? undefined;
      continue;
    }
    
    emptySearchCount = 0;
    
    const pages = await retrievePagesById<PageObjectResponse>(client, searchResult.pageIds, 3);
    
    for (const page of pages) {
      projects.push(mapPageToProject(page, projects.length === 0));
    }
    
    if (!searchResult.hasMore) break;
    cursor = searchResult.nextCursor ?? undefined;
    
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  return projects;
}

/**
 * Map property values to a Project object (used with property-specific retrieval)
 */
function mapPropertiesToProject(
  pageId: string, 
  url: string, 
  properties: Map<string, PropertyItemValue>,
  logDebug: boolean = false
): Project {
  if (logDebug) {
    console.log('Projects - Retrieved properties:', Array.from(properties.keys()).join(', '));
  }
  
  // Extract values from property items
  const titlePropName = projectsSettings?.titleProperty || 'Name';
  const statusPropName = projectsSettings?.statusProperty || 'Status';
  
  const title = extractTitleFromPropertyItem(properties.get(titlePropName));
  const status = extractStatusFromPropertyItem(properties.get(statusPropName));
  const description = extractRichTextFromPropertyItem(properties.get(projectsSettings?.descriptionProperty || ''));
  const startDate = extractDateFromPropertyItem(properties.get(projectsSettings?.startDateProperty || ''));
  const endDate = extractDateFromPropertyItem(properties.get(projectsSettings?.endDateProperty || ''));
  const tags = extractMultiSelectFromPropertyItem(properties.get(projectsSettings?.tagsProperty || ''));
  const uniqueId = projectsSettings?.idProperty
    ? extractUniqueIdFromPropertyItem(properties.get(projectsSettings.idProperty))
    : null;
  
  if (logDebug) {
    console.log(`[Notion] Project: "${title}" → status="${status}", uniqueId="${uniqueId}"`);
  }
  
  return {
    id: pageId,
    uniqueId: uniqueId ?? undefined,
    title,
    status,
    description,
    startDate,
    endDate,
    tags,
    url
  };
}

// Property item extractors for the property-specific API response format
function extractTitleFromPropertyItem(prop: PropertyItemValue | undefined): string | null {
  if (!prop) return null;
  
  // Property item response has different structure than page property
  if (prop.type === 'title') {
    const titleArray = prop.title || prop.results;
    if (Array.isArray(titleArray)) {
      return titleArray.map((t: any) => t.plain_text || '').join('') || null;
    }
  }
  
  // Handle paginated title responses
  if (prop.type === 'property_item' && (prop as any).property_item?.type === 'title') {
    const results = (prop as any).results;
    if (Array.isArray(results)) {
      return results.map((t: any) => t.title?.plain_text || '').join('') || null;
    }
  }
  
  return null;
}

function extractStatusFromPropertyItem(prop: PropertyItemValue | undefined): string | null {
  if (!prop) return null;
  
  if (prop.type === 'status') {
    return prop.status?.name ?? null;
  }
  if (prop.type === 'select') {
    return prop.select?.name ?? null;
  }
  
  return null;
}

function extractRichTextFromPropertyItem(prop: PropertyItemValue | undefined): string | null {
  if (!prop) return null;
  
  if (prop.type === 'rich_text') {
    const textArray = prop.rich_text || prop.results;
    if (Array.isArray(textArray)) {
      return textArray.map((t: any) => t.plain_text || '').join('') || null;
    }
  }
  
  return null;
}

function extractDateFromPropertyItem(prop: PropertyItemValue | undefined): string | null {
  if (!prop) return null;
  
  if (prop.type === 'date') {
    return prop.date?.start ?? null;
  }
  
  return null;
}

function extractMultiSelectFromPropertyItem(prop: PropertyItemValue | undefined): string[] | null {
  if (!prop) return null;
  
  if (prop.type === 'multi_select') {
    const options = prop.multi_select;
    if (Array.isArray(options)) {
      return options.map((o: any) => o.name);
    }
  }
  
  return null;
}

/**
 * Extract unique_id property value (e.g., "PRJ-123", "TIME-LOG-456")
 * Notion's unique_id property returns { prefix: string, number: number }
 */
function extractUniqueIdFromPropertyItem(prop: PropertyItemValue | undefined): string | null {
  if (!prop) return null;
  
  if (prop.type === 'unique_id') {
    const uniqueId = (prop as any).unique_id;
    if (uniqueId && typeof uniqueId.number === 'number') {
      const prefix = uniqueId.prefix || '';
      return prefix ? `${prefix}-${uniqueId.number}` : String(uniqueId.number);
    }
  }
  
  return null;
}

/**
 * Extract unique_id from page properties (full page response format)
 */
function extractUniqueIdFromPageProperty(props: any, propertyName: string | undefined): string | null {
  if (!propertyName || !props) return null;
  
  const prop = props[propertyName];
  if (!prop) return null;
  
  if (prop.type === 'unique_id') {
    const uniqueId = prop.unique_id;
    if (uniqueId && typeof uniqueId.number === 'number') {
      const prefix = uniqueId.prefix || '';
      return prefix ? `${prefix}-${uniqueId.number}` : String(uniqueId.number);
    }
  }
  
  return null;
}

/**
 * Map a Notion page response to a Project object
 */
function mapPageToProject(result: PageObjectResponse, logDebug: boolean = false): Project {
  const props = result.properties ?? {};
  
  // Debug: log available properties for first result
  if (logDebug) {
    console.log('Projects - Available properties:', Object.keys(props));
    console.log('Projects - Looking for titleProperty:', projectsSettings?.titleProperty);
    console.log('Projects - Looking for statusProperty:', projectsSettings?.statusProperty);
  }
  
  // Try configured title property first, then fall back to finding any title property
  let titleProp =
    (projectsSettings?.titleProperty &&
      props[projectsSettings.titleProperty]) ||
    undefined;
  
  // Fallback: find any property of type 'title' if configured one doesn't exist
  if (!titleProp) {
    for (const [key, value] of Object.entries(props)) {
      if ((value as any)?.type === 'title') {
        if (logDebug) console.log('Projects - Found title property at:', key);
        titleProp = value as any;
        break;
      }
    }
  }
  
  // Try configured status property first, then fall back to common names
  let statusProp =
    (projectsSettings?.statusProperty &&
      props[projectsSettings.statusProperty]) ||
    undefined;
  
  // Fallback: try common status property names if not configured or not found
  if (!statusProp) {
    const commonStatusNames = ['Status', 'Statuses', 'State', 'Project Status'];
    for (const name of commonStatusNames) {
      const prop = props[name];
      if (prop && ((prop as any)?.type === 'status' || (prop as any)?.type === 'select')) {
        if (logDebug) {
          console.log('Projects - Found status property at:', name, 'type:', (prop as any)?.type);
        }
        statusProp = prop as any;
        break;
      }
    }
  }
  
  const descriptionProp =
    (projectsSettings?.descriptionProperty &&
      props[projectsSettings.descriptionProperty]) ||
    undefined;
  const startDateProp =
    (projectsSettings?.startDateProperty &&
      props[projectsSettings.startDateProperty]) ||
    undefined;
  const endDateProp =
    (projectsSettings?.endDateProperty &&
      props[projectsSettings.endDateProperty]) ||
    undefined;
  const tagsProp =
    (projectsSettings?.tagsProperty &&
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
  
  // Extract unique ID if configured
  const uniqueId = extractUniqueIdFromPageProperty(props, projectsSettings?.idProperty);

  return {
    id: result.id,
    uniqueId: uniqueId ?? undefined,
    title,
    status,
    description,
    startDate,
    endDate,
    tags,
    url
  };
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

  console.log(`[Notion] Starting contacts IMPORT from database: ${dbId.substring(0, 8)}...`);
  
  // SDK 5.x: Use two-step approach - query for IDs, then retrieve each page
  return await getContactsReliably(client, dbId);
}

/**
 * SDK 5.x Reliable Contacts Import
 * Two-step approach: Query data source for page IDs, then retrieve each page individually
 */
async function getContactsReliably(client: Client, dbId: string): Promise<Contact[]> {
  console.log('[Notion] Using reliable two-step import for contacts...');
  
  const contacts: Contact[] = [];
  let cursor: string | null = null;
  let batchNum = 0;
  const MAX_BATCHES = 10;
  
  // Temporarily set contactsSettings apiKey for fallback query
  const originalApiKey = settings.apiKey;
  if (contactsSettings?.apiKey) {
    settings.apiKey = contactsSettings.apiKey;
  }
  
  try {
    while (batchNum < MAX_BATCHES) {
      batchNum++;
      
      // STEP 1: Query for page IDs using reliable method
      console.log(`[Notion] Contacts batch ${batchNum}: Querying page IDs...`);
      const response = await queryDatabaseReliably(client, dbId, {
        pageSize: 50,
        startCursor: cursor ?? undefined
      });
      
      const pageIds = response.results.map((r: any) => r.id);
      console.log(`[Notion] Contacts batch ${batchNum}: Found ${pageIds.length} page IDs`);
      
      if (pageIds.length === 0) {
        break;
      }
      
      // STEP 2: Retrieve each page individually
      for (const pageId of pageIds) {
        try {
          const page = await withRetry(
            client,
            () => client.pages.retrieve({ page_id: pageId }),
            `Retrieve contact ${pageId.substring(0, 8)}`
          ) as PageObjectResponse;
          
          const contact = mapPageToContact(page);
          if (contact && contact.name) {
            contacts.push(contact);
          }
        } catch (pageError) {
          console.warn(`[Notion] Failed to retrieve contact ${pageId}:`, pageError);
        }
      }
      
      if (!response.has_more) {
        break;
      }
      
      cursor = response.next_cursor;
    }
  } finally {
    settings.apiKey = originalApiKey;
  }
  
  console.log(`[Notion] Contacts import complete: ${contacts.length} contacts`);
  return contacts;
}

/**
 * Map a Notion page to a Contact
 */
function mapPageToContact(page: PageObjectResponse): Contact | null {
  const props = page.properties ?? {};

  const nameProp =
    (contactsSettings?.nameProperty &&
      props[contactsSettings.nameProperty]) ||
    undefined;
  const resolvedNameProp =
    nameProp && (nameProp as any).type === 'title'
      ? nameProp
      : Object.values(props).find((prop: any) => prop?.type === 'title');
  const name = extractPlainText(resolvedNameProp);

  const emailProp =
    (contactsSettings?.emailProperty &&
      props[contactsSettings.emailProperty]) ||
    undefined;
  const email =
    (emailProp as any)?.type === 'email'
      ? (emailProp as any).email ?? null
      : extractPlainText(emailProp);

  const phoneProp =
    (contactsSettings?.phoneProperty &&
      props[contactsSettings.phoneProperty]) ||
    undefined;
  const phone =
    (phoneProp as any)?.type === 'phone_number'
      ? (phoneProp as any).phone_number ?? null
      : extractPlainText(phoneProp);

  const companyProp =
    (contactsSettings?.companyProperty &&
      props[contactsSettings.companyProperty]) ||
    undefined;
  const company = extractPlainText(companyProp);

  const roleProp =
    (contactsSettings?.roleProperty &&
      props[contactsSettings.roleProperty]) ||
    undefined;
  const role = extractPlainText(roleProp);

  const notesProp =
    (contactsSettings?.notesProperty &&
      props[contactsSettings.notesProperty]) ||
    undefined;
  const notes = extractPlainText(notesProp);

  const relationProp =
    (contactsSettings?.projectsRelationProperty &&
      props[contactsSettings.projectsRelationProperty]) ||
    undefined;
  const projectIds =
    (relationProp as any)?.type === 'relation'
      ? (relationProp as any).relation?.map((rel: any) => rel.id) ?? []
      : null;

  return {
    id: page.id,
    name,
    email,
    phone,
    company,
    role,
    notes,
    projectIds,
    url: (page as any).url ?? null
  };
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

// getDataSourceId moved to top of file (SDK 5.x support)

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

  try {
    // SDK 5.x: Use dataSources.retrieve to get full property options
    const dataSourceId = await getDataSourceId();
    const dataSource = await withRetry(
      notion,
      () => (notion as any).dataSources.retrieve({ data_source_id: dataSourceId }),
      'Retrieve data source for order options'
    ) as any;
    
    const property = dataSource.properties?.[settings.orderProperty];

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
  } catch (error) {
    console.warn('[Notion] Failed to fetch order property metadata:', error);
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

  try {
    // SDK 5.x: Use dataSources.retrieve to get full property options
    const dataSourceId = await getDataSourceId();
    const dataSource = await withRetry(
      notion,
      () => (notion as any).dataSources.retrieve({ data_source_id: dataSourceId }),
      'Retrieve data source for status options'
    ) as any;

    const property = dataSource.properties?.[settings.statusProperty];
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
  } catch (error) {
    console.warn('[Notion] Failed to fetch status options from data source:', error);
    // Fallback to local statuses
    const { listLocalTaskStatuses } = await import('../db/repositories/localStatusRepository');
    return listLocalTaskStatuses();
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
    console.log('[Notion] Fetching project status options from data source...');
    
    // SDK 5.x: First get database to find data_source_id, then retrieve data source for full properties
    const database = await withRetry(
      client,
      () => client.databases.retrieve({ database_id: dbId }),
      'Retrieve projects database'
    ) as any;
    
    const dataSources = database.data_sources || [];
    let property: any = null;
    
    if (dataSources.length > 0) {
      // Use dataSources.retrieve to get full property options
      const dataSourceId = dataSources[0].data_source_id;
      const dataSource = await withRetry(
        client,
        () => (client as any).dataSources.retrieve({ data_source_id: dataSourceId }),
        'Retrieve projects data source'
      ) as any;
      property = dataSource.properties?.[projectsSettings.statusProperty];
    } else {
      // Fallback: try from database response (older API)
      property = database.properties?.[projectsSettings.statusProperty];
    }

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
    // SDK 5.x: Use data_source_id as parent instead of database_id
    const dataSourceId = await getDataSourceIdForDatabase(client, databaseId);
    const response = await client.pages.create({
      parent: { data_source_id: dataSourceId } as any,
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

/**
 * Sync only active (non-completed) tasks on startup.
 * Queries for tasks not in completed statuses and updates local DB.
 * Much faster than full import - only touches active tasks.
 */
export async function syncActiveTasksOnly(
  completedStatuses: string[] = ['✅', 'done', 'Done', 'Completed']
): Promise<{ updated: number; errors: number }> {
  if (!notion) {
    return { updated: 0, errors: 0 };
  }
  
  const client = notion;
  const dbId = getDatabaseId();
  let updated = 0;
  let errors = 0;
  
  try {
    console.log(`[Notion] Syncing tasks (no filter - fetching all)...`);
    
    // NO FILTER - filters cause timeouts on complex databases
    // Query ALL tasks using reliable method
    let cursor: string | null = null;
    let batchNum = 0;
    const MAX_BATCHES = 20;
    
    while (batchNum < MAX_BATCHES) {
      batchNum++;
      
      console.log(`[Notion] Tasks sync batch ${batchNum}: Querying...`);
      const response = await queryDatabaseReliably(client, dbId, {
        pageSize: 50,
        startCursor: cursor ?? undefined
        // NO filter - causes timeouts
      });
      
      const pageIds = response.results.map((r: any) => r.id);
      console.log(`[Notion] Active sync batch ${batchNum}: ${pageIds.length} tasks`);
      
      if (pageIds.length === 0) {
        break;
      }
      
      // Retrieve and update each page
      const { upsertRemoteTask, permanentlyDeleteTask } = await import('../db/repositories/taskRepository');
      
      for (const pageId of pageIds) {
        try {
          const page = await withRetry(
            client,
            () => client.pages.retrieve({ page_id: pageId }),
            `Retrieve ${pageId.substring(0, 8)}`
          ) as PageObjectResponse;
          
          const task = mapPageToTask(page, settings);
          
          // Validate: if task has no ID or no title, it's invalid - delete it
          if (!task.id || !task.title) {
            console.warn(`[Notion] Invalid task (no ID or title), deleting: ${pageId}`);
            permanentlyDeleteTask(pageId);
            errors++;
            continue;
          }
          
          upsertRemoteTask(task, task.id, new Date().toISOString());
          updated++;
        } catch (pageError) {
          console.warn(`[Notion] Failed to sync page ${pageId}:`, pageError);
          errors++;
        }
      }
      
      if (!response.has_more) {
        break;
      }
      
      cursor = response.next_cursor;
    }
    
    console.log(`[Notion] Active sync complete: ${updated} updated, ${errors} errors`);
    return { updated, errors };
    
  } catch (error) {
    console.error('[Notion] Active sync failed:', error);
    return { updated, errors: errors + 1 };
  }
}

/**
 * Sync only active (non-completed) projects on startup.
 * Queries for projects not in completed statuses and updates local DB.
 * Much faster than full import - only touches active projects.
 */
export async function syncActiveProjectsOnly(
  completedStatuses: string[] = ['✅', 'done', 'Done', 'Completed', 'Complete', 'Archived']
): Promise<{ updated: number; errors: number }> {
  if (!projectsSettings?.databaseId) {
    console.log('[Notion] Projects not configured, skipping active projects sync');
    return { updated: 0, errors: 0 };
  }
  
  let client: Client;
  let dbId: string;
  
  try {
    client = getProjectsClient();
    dbId = getProjectsDatabaseId();
  } catch (error) {
    console.warn('[Notion] Projects client not available:', error);
    return { updated: 0, errors: 0 };
  }
  
  let updated = 0;
  let errors = 0;
  
  // Temporarily set projectsSettings apiKey for fallback query
  const originalApiKey = settings.apiKey;
  if (projectsSettings?.apiKey) {
    settings.apiKey = projectsSettings.apiKey;
  }
  
  try {
    const statusProperty = projectsSettings?.statusProperty || 'Status';
    console.log(`[Notion] Syncing active projects (excluding: ${completedStatuses.join(', ')})...`);
    
    // Build filter to exclude completed statuses
    const statusFilters = completedStatuses.map(status => ({
      property: statusProperty,
      status: { does_not_equal: status }
    }));
    
    // Query for active projects only using reliable method
    let cursor: string | null = null;
    let batchNum = 0;
    const MAX_BATCHES = 10;
    
    while (batchNum < MAX_BATCHES) {
      batchNum++;
      
      console.log(`[Notion] Active projects batch ${batchNum}: Querying...`);
      const response = await queryDatabaseReliably(client, dbId, {
        pageSize: 50,
        startCursor: cursor ?? undefined,
        filter: statusFilters.length > 0 ? { and: statusFilters } : undefined
      });
      
      const pageIds = response.results.map((r: any) => r.id);
      console.log(`[Notion] Active projects batch ${batchNum}: ${pageIds.length} projects`);
      
      if (pageIds.length === 0) {
        break;
      }
      
      // Retrieve and update each page
      const { upsertProject, deleteLocalProject } = await import('../db/repositories/projectRepository');
      
      for (const pageId of pageIds) {
        try {
          const page = await withRetry(
            client,
            () => client.pages.retrieve({ page_id: pageId }),
            `Retrieve project ${pageId.substring(0, 8)}`
          ) as PageObjectResponse;
          
          const project = mapPageToProject(page, false);
          
          // Validate: if project has no ID or no name, it's invalid - delete it
          if (!project.id || !project.title) {
            console.warn(`[Notion] Invalid project (no ID or name), deleting: ${pageId}`);
            deleteLocalProject(pageId);
            errors++;
            continue;
          }
          
          upsertProject(project, new Date().toISOString());
          updated++;
        } catch (pageError) {
          console.warn(`[Notion] Failed to sync project ${pageId}:`, pageError);
          errors++;
        }
      }
      
      if (!response.has_more) {
        break;
      }
      
      cursor = response.next_cursor;
    }
    
    console.log(`[Notion] Active projects sync complete: ${updated} updated, ${errors} errors`);
    return { updated, errors };
    
  } catch (error) {
    console.error('[Notion] Active projects sync failed:', error);
    return { updated, errors: errors + 1 };
  } finally {
    settings.apiKey = originalApiKey;
  }
}

