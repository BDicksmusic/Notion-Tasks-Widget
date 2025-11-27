/**
 * Notion Projects Service
 * 
 * Simple, direct API operations for projects.
 * No timers, no queues, no hidden automation.
 */

import { Client } from '@notionhq/client';
import type { Project, ProjectsSettings } from '../../shared/types';
import { createNotionClient, withRetry } from './notionApi';
import { getProjectsSettings, getTaskSettings } from '../configStore';

// Cache the client
let client: Client | null = null;
let cachedApiKey: string | null = null;

/**
 * Get or create the Notion client (uses task API key if projects doesn't have one)
 */
function getClient(): Client {
  const projectSettings = getProjectsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = projectSettings.apiKey || taskSettings.apiKey;
  
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
 * Parse a Notion page into a Project object
 */
function parseNotionPage(page: any, settings: ProjectsSettings): Project {
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
  
  const getDate = (propName?: string): string | null => {
    if (!propName) return null;
    const prop = props[propName];
    if (!prop || prop.type !== 'date' || !prop.date) return null;
    return prop.date.start ?? null;
  };
  
  const getMultiSelect = (propName?: string): string[] | null => {
    if (!propName) return null;
    const prop = props[propName];
    if (!prop || prop.type !== 'multi_select') return null;
    return prop.multi_select?.map((s: any) => s.name) ?? null;
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
  
  // Get icon
  let emoji: string | null = null;
  let iconUrl: string | null = null;
  if (page.icon) {
    if (page.icon.type === 'emoji') {
      emoji = page.icon.emoji;
    } else if (page.icon.type === 'external') {
      iconUrl = page.icon.external?.url ?? null;
    } else if (page.icon.type === 'file') {
      iconUrl = page.icon.file?.url ?? null;
    }
  }
  
  return {
    id: page.id,
    uniqueId: getUniqueId(),
    title: getText(settings.titleProperty),
    status: getStatus(settings.statusProperty),
    description: getText(settings.descriptionProperty),
    startDate: getDate(settings.startDateProperty),
    endDate: getDate(settings.endDateProperty),
    tags: getMultiSelect(settings.tagsProperty),
    url: page.url,
    emoji,
    iconUrl,
    lastEdited: page.last_edited_time
  };
}

/**
 * Fetch all projects from Notion
 */
export async function fetchProjects(): Promise<Project[]> {
  const settings = getProjectsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey || !settings.databaseId) {
    console.warn('[NotionProjects] Cannot fetch - no settings configured');
    return [];
  }
  
  console.log('[NotionProjects] Fetching projects...');
  
  const notionClient = getClient();
  const projects: Project[] = [];
  let cursor: string | undefined;
  
  do {
    const response: any = await withRetry(
      notionClient,
      () => (notionClient.databases as any).query({
        database_id: settings.databaseId,
        page_size: 100,
        start_cursor: cursor
      }),
      'Fetch projects'
    );
    
    for (const page of response.results) {
      try {
        projects.push(parseNotionPage(page, settings));
      } catch (err) {
        console.warn('[NotionProjects] Failed to parse page:', page.id, err);
      }
    }
    
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  
  console.log(`[NotionProjects] Fetched ${projects.length} projects`);
  return projects;
}

/**
 * Fetch active projects (not completed)
 */
export async function fetchActiveProjects(): Promise<Project[]> {
  const settings = getProjectsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey || !settings.databaseId) {
    return [];
  }
  
  // If no completed status defined, fetch all
  if (!settings.completedStatus || !settings.statusProperty) {
    return fetchProjects();
  }
  
  console.log('[NotionProjects] Fetching active projects...');
  
  const notionClient = getClient();
  const projects: Project[] = [];
  let cursor: string | undefined;
  
  do {
    const response: any = await withRetry(
      notionClient,
      () => (notionClient.databases as any).query({
        database_id: settings.databaseId,
        filter: {
          property: settings.statusProperty!,
          status: {
            does_not_equal: settings.completedStatus!
          }
        },
        page_size: 100,
        start_cursor: cursor
      }),
      'Fetch active projects'
    );
    
    for (const page of response.results) {
      try {
        projects.push(parseNotionPage(page, settings));
      } catch (err) {
        console.warn('[NotionProjects] Failed to parse page:', page.id, err);
      }
    }
    
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  
  console.log(`[NotionProjects] Fetched ${projects.length} active projects`);
  return projects;
}

/**
 * Fetch a single project by ID
 */
export async function fetchProject(projectId: string): Promise<Project | null> {
  const settings = getProjectsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey) {
    return null;
  }
  
  try {
    const notionClient = getClient();
    const page = await withRetry(
      notionClient,
      () => notionClient.pages.retrieve({ page_id: projectId }),
      `Fetch project ${projectId.substring(0, 8)}`
    );
    
    return parseNotionPage(page, settings);
  } catch (error) {
    console.error('[NotionProjects] Failed to fetch project:', projectId, error);
    return null;
  }
}

/**
 * Create a new project in Notion
 */
export async function createProject(payload: {
  title: string;
  status?: string | null;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  tags?: string[] | null;
}): Promise<Project | null> {
  const settings = getProjectsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey || !settings.databaseId) {
    throw new Error('Projects settings not configured');
  }
  
  console.log('[NotionProjects] Creating project:', payload.title);
  
  const properties: any = {};
  
  // Title
  if (settings.titleProperty) {
    properties[settings.titleProperty] = {
      title: [{ text: { content: payload.title } }]
    };
  }
  
  // Status
  if (settings.statusProperty && payload.status) {
    properties[settings.statusProperty] = {
      status: { name: payload.status }
    };
  }
  
  // Description
  if (settings.descriptionProperty && payload.description) {
    properties[settings.descriptionProperty] = {
      rich_text: [{ text: { content: payload.description } }]
    };
  }
  
  // Start date
  if (settings.startDateProperty && payload.startDate) {
    properties[settings.startDateProperty] = {
      date: { start: payload.startDate }
    };
  }
  
  // End date
  if (settings.endDateProperty && payload.endDate) {
    properties[settings.endDateProperty] = {
      date: { start: payload.endDate }
    };
  }
  
  // Tags
  if (settings.tagsProperty && payload.tags?.length) {
    properties[settings.tagsProperty] = {
      multi_select: payload.tags.map(name => ({ name }))
    };
  }
  
  const notionClient = getClient();
  const page = await withRetry(
    notionClient,
    () => notionClient.pages.create({
      parent: { database_id: settings.databaseId },
      properties
    }),
    'Create project'
  );
  
  console.log('[NotionProjects] Created project:', page.id);
  return parseNotionPage(page, settings);
}

/**
 * Update a project in Notion
 */
export async function updateProject(
  projectId: string,
  updates: {
    title?: string;
    status?: string | null;
    description?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    tags?: string[] | null;
  }
): Promise<Project | null> {
  const settings = getProjectsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey) {
    throw new Error('Notion not configured');
  }
  
  console.log('[NotionProjects] Updating project:', projectId.substring(0, 8));
  
  const properties: any = {};
  
  // Title
  if (updates.title !== undefined && settings.titleProperty) {
    properties[settings.titleProperty] = {
      title: [{ text: { content: updates.title } }]
    };
  }
  
  // Status
  if (updates.status !== undefined && settings.statusProperty) {
    if (updates.status === null) {
      properties[settings.statusProperty] = { status: null };
    } else {
      properties[settings.statusProperty] = {
        status: { name: updates.status }
      };
    }
  }
  
  // Description
  if (updates.description !== undefined && settings.descriptionProperty) {
    if (updates.description === null) {
      properties[settings.descriptionProperty] = { rich_text: [] };
    } else {
      properties[settings.descriptionProperty] = {
        rich_text: [{ text: { content: updates.description } }]
      };
    }
  }
  
  // Start date
  if (updates.startDate !== undefined && settings.startDateProperty) {
    properties[settings.startDateProperty] = {
      date: updates.startDate ? { start: updates.startDate } : null
    };
  }
  
  // End date
  if (updates.endDate !== undefined && settings.endDateProperty) {
    properties[settings.endDateProperty] = {
      date: updates.endDate ? { start: updates.endDate } : null
    };
  }
  
  // Tags
  if (updates.tags !== undefined && settings.tagsProperty) {
    properties[settings.tagsProperty] = {
      multi_select: (updates.tags ?? []).map(name => ({ name }))
    };
  }
  
  const notionClient = getClient();
  const page = await withRetry(
    notionClient,
    () => notionClient.pages.update({
      page_id: projectId,
      properties
    }),
    'Update project'
  );
  
  console.log('[NotionProjects] Updated project:', projectId.substring(0, 8));
  return parseNotionPage(page, settings);
}

/**
 * Archive (soft delete) a project in Notion
 */
export async function archiveProject(projectId: string): Promise<boolean> {
  const settings = getProjectsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey) {
    throw new Error('Notion not configured');
  }
  
  console.log('[NotionProjects] Archiving project:', projectId.substring(0, 8));
  
  const notionClient = getClient();
  await withRetry(
    notionClient,
    () => notionClient.pages.update({
      page_id: projectId,
      archived: true
    }),
    'Archive project'
  );
  
  console.log('[NotionProjects] Archived project:', projectId.substring(0, 8));
  return true;
}

/**
 * Check if projects are configured
 */
export function isConfigured(): boolean {
  const settings = getProjectsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  return Boolean(apiKey && settings.databaseId);
}

