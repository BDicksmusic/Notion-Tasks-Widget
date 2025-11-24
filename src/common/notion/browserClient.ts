import type {
  BlockObjectRequest,
  CreatePageParameters,
  PageObjectResponse
} from '@notionhq/client/build/src/api-endpoints';
import { mapPageToTask, markdownBlocksToNotion, textToRichText } from './index';
import type {
  NotionCreatePayload,
  NotionSettings,
  Task,
  TaskStatusOption,
  TaskUpdatePayload,
  TimeLogEntry,
  TimeLogEntryPayload,
  TimeLogSettings,
  WritingEntryPayload,
  WritingSettings
} from '@shared/types';
import { convertMarkdown } from '@shared/markdown';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

type RawQueryResult =
  | PageObjectResponse
  | {
      object: string;
      [key: string]: unknown;
    };

interface QueryResultEnvelope {
  results: RawQueryResult[];
}

function isPage(result: RawQueryResult): result is PageObjectResponse {
  return result.object === 'page';
}

export class BrowserNotionClient {
  private taskSettings: NotionSettings | null = null;
  private writingSettings: WritingSettings | null = null;
  private timeLogSettings: TimeLogSettings | null = null;
  private cachedDataSourceId: string | null = null;
  private cachedStatusOptions: TaskStatusOption[] | null = null;

  configureTasks(settings: NotionSettings) {
    this.taskSettings = settings;
    this.cachedDataSourceId = settings.dataSourceId ?? null;
    this.cachedStatusOptions = null;
  }

  configureWriting(settings: WritingSettings) {
    this.writingSettings = settings;
  }

  configureTimeLog(settings: TimeLogSettings) {
    this.timeLogSettings = settings;
  }

  async getTasks(): Promise<Task[]> {
    const settings = this.assertTaskSettings();
    const dataSourceId = await this.getDataSourceId(settings);
    const response = await this.request<QueryResultEnvelope>(
      settings.apiKey,
      `/data-sources/${dataSourceId}/query`,
      {
        method: 'POST',
        body: {
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
        }
      }
    );

    return response.results
      .filter(isPage)
      .map((page) => mapPageToTask(page, settings));
  }

  async addTask(payload: NotionCreatePayload): Promise<Task> {
    const settings = this.assertTaskSettings();
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

    const response = await this.request<PageObjectResponse>(
      settings.apiKey,
      '/pages',
      {
        method: 'POST',
        body: {
          parent: { database_id: this.getDatabaseId(settings.databaseId) },
          properties
        } as CreatePageParameters
      }
    );

    return mapPageToTask(response, settings);
  }

  async updateTask(taskId: string, updates: TaskUpdatePayload): Promise<Task> {
    const settings = this.assertTaskSettings();
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

    const response = await this.request<PageObjectResponse>(
      settings.apiKey,
      `/pages/${taskId}`,
      {
        method: 'PATCH',
        body: {
          properties
        }
      }
    );

    return mapPageToTask(response, settings);
  }

  async getStatusOptions(): Promise<TaskStatusOption[]> {
    const settings = this.assertTaskSettings();
    if (this.cachedStatusOptions) {
      return this.cachedStatusOptions;
    }

    const database = await this.request<any>(
      settings.apiKey,
      `/databases/${this.getDatabaseId(settings.databaseId)}`,
      { method: 'GET' }
    );
    const property = database.properties?.[settings.statusProperty];
    if (property?.type === 'status') {
      this.cachedStatusOptions = property.status.options.map((option: any) => ({
        id: option.id,
        name: option.name,
        color: option.color
      }));
    } else if (property?.type === 'select') {
      this.cachedStatusOptions = property.select.options.map((option: any) => ({
        id: option.id,
        name: option.name,
        color: option.color
      }));
    } else {
      this.cachedStatusOptions = [];
    }

    return this.cachedStatusOptions ?? [];
  }

  async createWritingEntry(payload: WritingEntryPayload): Promise<void> {
    const settings = this.assertWritingSettings();
    const clientApiKey = settings.apiKey?.trim()
      ? settings.apiKey
      : this.assertTaskSettings().apiKey;
    const databaseId = this.normalizeId(settings.databaseId);
    const safeTitle = payload.title?.trim();
    if (!safeTitle) {
      throw new Error('Writing entries require a title');
    }
    const safeContent = payload.content?.trim();
    if (!safeContent) {
      throw new Error('Writing entries require content');
    }

    const properties: Record<string, any> = {
      [settings.titleProperty]: {
        title: textToRichText(safeTitle)
      }
    };

    if (settings.summaryProperty && payload.summary) {
      properties[settings.summaryProperty] = {
        rich_text: textToRichText(payload.summary)
      };
    }

    if (
      settings.tagsProperty &&
      payload.tags &&
      payload.tags.length > 0
    ) {
      properties[settings.tagsProperty] = {
        multi_select: payload.tags.map((tag) => ({ name: tag }))
      };
    }

    if (settings.statusProperty && payload.status) {
      properties[settings.statusProperty] = {
        status: { name: payload.status }
      };
    }

    let blockSource =
      payload.contentBlocks && payload.contentBlocks.length
        ? payload.contentBlocks
        : undefined;
    if (!blockSource) {
      const conversion = await convertMarkdown(payload.content);
      blockSource = conversion.blocks;
    }
    const children = markdownBlocksToNotion(blockSource);

    await this.request<PageObjectResponse>(clientApiKey, '/pages', {
      method: 'POST',
      body: {
        parent: { database_id: databaseId },
        properties,
        children
      }
    });
  }

  async createTimeLogEntry(payload: TimeLogEntryPayload): Promise<void> {
    const settings = this.assertTimeLogSettings();
    const clientApiKey = settings.apiKey?.trim()
      ? settings.apiKey
      : this.assertTaskSettings().apiKey;
    const databaseId = this.normalizeId(settings.databaseId);
    
    const properties: Record<string, any> = {};

    // Set title property
    if (settings.titleProperty) {
      properties[settings.titleProperty] = {
        title: textToRichText(payload.taskTitle)
      };
    }

    // Set task relation property
    if (settings.taskProperty) {
      properties[settings.taskProperty] = {
        relation: [{ id: payload.taskId }]
      };
    }

    // Set status property
    if (settings.statusProperty) {
      properties[settings.statusProperty] = {
        select: { name: payload.status }
      };
    }

    // Set start time property
    if (settings.startTimeProperty && payload.startTime) {
      if (payload.endTime) {
        // Completed session: use actual end time
        properties[settings.startTimeProperty] = {
          date: {
            start: payload.startTime,
            end: payload.endTime
          }
        };
      } else if (payload.sessionLengthMinutes) {
        // Active session: calculate estimated end time from start + session length
        const startDate = new Date(payload.startTime);
        const estimatedEndDate = new Date(startDate.getTime() + (payload.sessionLengthMinutes * 60 * 1000));
        properties[settings.startTimeProperty] = {
          date: {
            start: payload.startTime,
            end: estimatedEndDate.toISOString()
          }
        };
      } else {
        // Just start time
        properties[settings.startTimeProperty] = {
          date: {
            start: payload.startTime
          }
        };
      }
    }

    // Set end time property (if separate from start time)
    if (settings.endTimeProperty && payload.endTime && !settings.startTimeProperty) {
      properties[settings.endTimeProperty] = {
        date: {
          start: payload.endTime
        }
      };
    }

    await this.request<PageObjectResponse>(clientApiKey, '/pages', {
      method: 'POST',
      body: {
        parent: { database_id: databaseId },
        properties
      }
    });
  }

  async getActiveTimeLogEntry(taskId: string) {
    const settings = this.assertTimeLogSettings();
    if (!settings.taskProperty) {
      return null;
    }
    const clientApiKey = settings.apiKey?.trim()
      ? settings.apiKey
      : this.assertTaskSettings().apiKey;
    const databaseId = this.normalizeId(settings.databaseId);
    const filters: any[] = [
      {
        property: settings.taskProperty,
        relation: { contains: taskId }
      }
    ];
    if (settings.endTimeProperty) {
      filters.push({
        property: settings.endTimeProperty,
        date: { is_empty: true }
      });
    }

    const body: Record<string, any> = {
      page_size: 1,
      sorts: [
        {
          timestamp: 'last_edited_time',
          direction: 'descending'
        }
      ]
    };
    if (filters.length === 1) {
      body.filter = filters[0];
    } else {
      body.filter = { and: filters };
    }

    const response = await this.request<QueryResultEnvelope>(
      clientApiKey,
      `/databases/${databaseId}/query`,
      {
        method: 'POST',
        body
      }
    );

    const page = response.results.find(isPage);
    if (!page) return null;

    const props = page.properties ?? {};
    const startProp =
      (settings.startTimeProperty &&
        props[settings.startTimeProperty]) ||
      undefined;
    const endProp =
      (settings.endTimeProperty && props[settings.endTimeProperty]) ||
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

  async getTotalLoggedTime(taskId: string): Promise<number> {
    const settings = this.assertTimeLogSettings();
    if (!settings.taskProperty) {
      return 0;
    }
    const clientApiKey = settings.apiKey?.trim() || this.taskSettings?.apiKey?.trim();
    if (!clientApiKey) {
      throw new Error('Time log API key not configured');
    }
    const databaseId = settings.databaseId.replace(/-/g, '').trim();
    if (databaseId.length !== 32) {
      throw new Error('Invalid time log database ID');
    }

    const formattedTaskId = taskId.replace(/-/g, '').trim();
    let totalMinutes = 0;
    let cursor: string | null | undefined = undefined;

    do {
      const response: {
        results: RawQueryResult[];
        next_cursor?: string | null;
        has_more?: boolean;
      } = await this.request<{
        results: RawQueryResult[];
        next_cursor?: string | null;
        has_more?: boolean;
      }>(clientApiKey, `/databases/${databaseId}/query`, {
        method: 'POST',
        body: {
          filter: {
            property: settings.taskProperty,
            relation: { contains: formattedTaskId }
          },
          start_cursor: cursor,
          page_size: 100
        }
      });

      for (const result of response.results) {
        if (!isPage(result)) continue;
        const props = result.properties ?? {};
        const startProp =
          (settings.startTimeProperty &&
            props[settings.startTimeProperty]) ||
          undefined;
        const endProp =
          (settings.endTimeProperty && props[settings.endTimeProperty]) ||
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

  async getAllTimeLogEntries(taskId: string) {
    const settings = this.assertTimeLogSettings();
    if (!settings.taskProperty) {
      return [];
    }
    const clientApiKey = settings.apiKey?.trim() || this.taskSettings?.apiKey?.trim();
    if (!clientApiKey) {
      throw new Error('Time log API key not configured');
    }
    const databaseId = settings.databaseId.replace(/-/g, '').trim();
    if (databaseId.length !== 32) {
      throw new Error('Invalid time log database ID');
    }

    const formattedTaskId = taskId.replace(/-/g, '').trim();
    const entries: TimeLogEntry[] = [];
    let cursor: string | null | undefined = undefined;

    do {
      const response: {
        results: RawQueryResult[];
        next_cursor?: string | null;
        has_more?: boolean;
      } = await this.request<{
        results: RawQueryResult[];
        next_cursor?: string | null;
        has_more?: boolean;
      }>(clientApiKey, `/databases/${databaseId}/query`, {
        method: 'POST',
        body: {
          filter: {
            property: settings.taskProperty,
            relation: { contains: formattedTaskId }
          },
          sorts: [
            {
              timestamp: 'created_time',
              direction: 'descending'
            }
          ],
          start_cursor: cursor,
          page_size: 100
        }
      });

      for (const result of response.results) {
        if (!isPage(result)) continue;

        const props = result.properties ?? {};
        const startProp =
          (settings.startTimeProperty &&
            props[settings.startTimeProperty]) ||
          undefined;
        const endProp =
          (settings.endTimeProperty && props[settings.endTimeProperty]) ||
          undefined;
        const titleProp =
          (settings.titleProperty && props[settings.titleProperty]) ||
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

  private assertTaskSettings(): NotionSettings {
    if (!this.taskSettings) {
      throw new Error('Notion settings not configured');
    }
    if (!this.taskSettings.apiKey || !this.taskSettings.databaseId) {
      throw new Error('Notion settings require API key and Database ID');
    }
    return this.taskSettings;
  }

  private assertWritingSettings(): WritingSettings {
    if (!this.writingSettings) {
      throw new Error('Writing widget is not configured yet');
    }
    if (!this.writingSettings.databaseId || !this.writingSettings.titleProperty) {
      throw new Error('Writing settings require database and title property');
    }
    return this.writingSettings;
  }

  private assertTimeLogSettings(): TimeLogSettings {
    if (!this.timeLogSettings) {
      throw new Error('Time log widget is not configured yet');
    }
    if (!this.timeLogSettings.databaseId) {
      throw new Error('Time log settings require database ID');
    }
    return this.timeLogSettings;
  }

  private normalizeId(raw: string) {
    const sanitized = raw?.replace(/-/g, '').trim();
    if (!sanitized || sanitized.length !== 32) {
      throw new Error('Notion IDs must be 32 characters without dashes');
    }
    return sanitized;
  }

  private getDatabaseId(raw: string) {
    return this.normalizeId(raw);
  }

  private async getDataSourceId(settings: NotionSettings): Promise<string> {
    if (this.cachedDataSourceId) return this.cachedDataSourceId;
    if (settings.dataSourceId) {
      this.cachedDataSourceId = settings.dataSourceId;
      return this.cachedDataSourceId;
    }

    const database = await this.request<any>(
      settings.apiKey,
      `/databases/${this.getDatabaseId(settings.databaseId)}`,
      { method: 'GET' }
    );
    const dataSource = database.data_sources?.[0];
    if (!dataSource?.id) {
      throw new Error(
        'Database is missing data source. Provide NOTION_DATA_SOURCE_ID in settings.'
      );
    }

    this.cachedDataSourceId = dataSource.id;
    return dataSource.id;
  }

  private async request<T>(
    apiKey: string,
    path: string,
    options: {
      method?: string;
      body?: unknown;
    } = {}
  ): Promise<T> {
    const response = await fetch(`${NOTION_API_BASE}${path}`, {
      method: options.method ?? 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined
    });

    if (!response.ok) {
      let detail = '';
      try {
        const errorPayload = (await response.json()) as { message?: string } | unknown;
        detail =
          typeof errorPayload === 'object' &&
          errorPayload !== null &&
          'message' in errorPayload &&
          typeof errorPayload.message === 'string'
            ? errorPayload.message
            : JSON.stringify(errorPayload);
      } catch {
        detail = await response.text();
      }
      throw new Error(
        detail
          ? `Notion request failed (${response.status}): ${detail}`
          : `Notion request failed with status ${response.status}`
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

