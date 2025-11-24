import { Client } from '@notionhq/client';
import type {
  PageObjectResponse,
  CreatePageParameters
} from '@notionhq/client/build/src/api-endpoints';
import {
  mapPageToTask,
  markdownBlocksToNotion,
  textToRichText
} from '@common/notion';
import type {
  MarkdownBlock,
  MarkdownRichText,
  NotionCreatePayload,
  NotionSettings,
  Task,
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

let notion: Client | null = null;
let settings: NotionSettings;
let writingSettings: WritingSettings | null = null;
let writingClient: Client | null = null;
let timeLogSettings: TimeLogSettings | null = null;
let timeLogClient: Client | null = null;
let cachedDataSourceId: string | null = null;
let cachedStatusOptions: TaskStatusOption[] | null = null;

export function setNotionSettings(next: NotionSettings) {
  settings = next;
  if (!settings.apiKey || !settings.databaseId) {
    throw new Error('Notion settings require API key and Database ID');
  }
  notion = new Client({ auth: settings.apiKey });
  cachedDataSourceId = settings.dataSourceId ?? null;
  cachedStatusOptions = null;
}

export function setWritingSettings(next: WritingSettings) {
  writingSettings = next;
  if (writingSettings?.apiKey && writingSettings.apiKey.trim()) {
    writingClient = new Client({ auth: writingSettings.apiKey });
  } else {
    writingClient = null;
  }
}

export function setTimeLogSettings(next: TimeLogSettings) {
  timeLogSettings = next;
  if (timeLogSettings?.apiKey && timeLogSettings.apiKey.trim()) {
    timeLogClient = new Client({ auth: timeLogSettings.apiKey });
  } else {
    timeLogClient = null;
  }
}

export async function createWritingEntry(
  payload: WritingEntryPayload
): Promise<void> {
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

export async function getTasks(): Promise<Task[]> {
  if (!notion) {
    throw new Error('Notion client not initialized');
  }
  const dbId = getDatabaseId();
  try {
    const dataSourceId = await getDataSourceId(dbId);
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        property: settings.statusProperty,
        status: {
          does_not_equal: settings.completedStatus
        }
      },
      sorts: [
        {
          timestamp: 'last_edited_time',
          direction: 'descending'
        }
      ],
      page_size: 25
    });

    return response.results
      .filter(isPage)
      .map((page) => mapPageToTask(page, settings));
  } catch (error) {
    console.error('Notion query failed', { dbId }, error);
    throw error;
  }
}

export async function addTask(payload: NotionCreatePayload): Promise<Task> {
  if (!notion) {
    throw new Error('Notion client not initialized');
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

  const pageResponse = await notion.pages.create({
    parent: { database_id: getDatabaseId() },
    properties
  } as CreatePageParameters);

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
    throw new Error('Notion client not initialized');
  }

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

  if (!Object.keys(properties).length) {
    throw new Error('No updates specified');
  }

  const response = await notion.pages.update({
    page_id: taskId,
    properties
  });

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
  const filters: any[] = [
    {
      property: timeLogSettings.taskProperty,
      relation: { contains: taskId }
    },
    {
      property: timeLogSettings.statusProperty,
      select: { equals: 'start' }
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

  const databaseApi = (
    timeLogClient as unknown as {
      databases: {
        query: (args: Record<string, any>) => Promise<{
          results: RawQueryResult[];
        }>;
      };
    }
  ).databases;
  const response = await databaseApi.query({
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
  const query: Record<string, any> = {
    database_id: dbId,
    filter: {
      property: timeLogSettings.taskProperty,
      relation: { contains: taskId }
    },
    page_size: 100 // Get up to 100 entries, should be enough for most cases
  };

  const databaseApi = (
    timeLogClient as unknown as {
      databases: {
        query: (args: Record<string, any>) => Promise<{
          results: RawQueryResult[];
          next_cursor?: string | null;
          has_more?: boolean;
        }>;
      };
    }
  ).databases;

  let totalMinutes = 0;
  let cursor: string | null | undefined = undefined;

  do {
    const response = await databaseApi.query({
      ...query,
      start_cursor: cursor
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
  const query: Record<string, any> = {
    database_id: dbId,
    filter: {
      property: timeLogSettings.taskProperty,
      relation: { contains: taskId }
    },
    sorts: [
      {
        timestamp: 'created_time',
        direction: 'descending'
      }
    ],
    page_size: 100
  };

  const databaseApi = (
    timeLogClient as unknown as {
      databases: {
        query: (args: Record<string, any>) => Promise<{
          results: RawQueryResult[];
          next_cursor?: string | null;
          has_more?: boolean;
        }>;
      };
    }
  ).databases;

  const entries: TimeLogEntry[] = [];
  let cursor: string | null | undefined = undefined;

  do {
    const response = await databaseApi.query({
      ...query,
      start_cursor: cursor
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
  if (
    !timeLogClient ||
    !timeLogSettings?.databaseId
  ) {
    return [];
  }

  const dbId = getTimeLogDatabaseId();
  const query: Record<string, any> = {
    database_id: dbId,
    sorts: [
      {
        timestamp: 'created_time',
        direction: 'descending'
      }
    ],
    page_size: 100
  };

  const databaseApi = (
    timeLogClient as unknown as {
      databases: {
        query: (args: Record<string, any>) => Promise<{
          results: RawQueryResult[];
          next_cursor?: string | null;
          has_more?: boolean;
        }>;
      };
    }
  ).databases;

  const entries: TimeLogEntry[] = [];
  let cursor: string | null | undefined = undefined;

  do {
    const response = await databaseApi.query({
      ...query,
      start_cursor: cursor
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

  return entries;
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

export async function getStatusOptions(): Promise<TaskStatusOption[]> {
  if (!notion) {
    throw new Error('Notion client not initialized');
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
): Promise<void> {
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

  // Set status property
  if (timeLogSettings.statusProperty) {
    properties[timeLogSettings.statusProperty] = {
      select: { name: payload.status }
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

  const response = await client.pages.create({
    parent: { database_id: databaseId },
    properties
  });

  if (!isPageResponse(response)) {
    throw new Error('Notion did not return a page for the time log entry');
  }
}

function getTimeLogClient(): Client {
  if (timeLogClient) {
    return timeLogClient;
  }
  if (!notion) {
    throw new Error('Notion client not initialized');
  }
  return notion;
}

function getTimeLogDatabaseId() {
  if (!timeLogSettings?.databaseId) {
    throw new Error('Missing time log database ID');
  }
  const raw = timeLogSettings.databaseId.replace(/-/g, '').trim();
  if (!raw || raw.length !== 32) {
    throw new Error('Time log database ID must be 32 characters');
  }
  return raw;
}

