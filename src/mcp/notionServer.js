import 'dotenv/config';
import { Client } from '@notionhq/client';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadWidgetConfig } from './config';
const server = new McpServer({
    name: 'notion-tasks-widget-mcp',
    version: '0.1.0'
}, {
    capabilities: {
        logging: {},
        resources: {
            subscribe: false
        }
    }
});
const storedConfig = loadWidgetConfig();
const tasksSettings = storedConfig?.tasks ?? null;
const timeLogSettings = storedConfig?.timeLog ?? null;
const projectsSettings = storedConfig?.projects ?? null;
const clean = (value) => (value ? value.trim() : null);
const tasksDatabaseId = clean(tasksSettings?.databaseId) ?? clean(process.env.NOTION_DATABASE_ID);
const timeLogDatabaseId = clean(timeLogSettings?.databaseId) ??
    clean(process.env.NOTION_TIME_LOG_DATABASE_ID);
const projectsDatabaseId = clean(projectsSettings?.databaseId) ??
    clean(process.env.NOTION_PROJECTS_DATABASE_ID);
const taskStatusProperty = clean(tasksSettings?.statusProperty) ??
    process.env.NOTION_TASK_STATUS_PROP ??
    'Status';
const timeLogTaskProperty = clean(timeLogSettings?.taskProperty) ??
    process.env.NOTION_TIME_LOG_TASK_PROP ??
    'Task';
const timeLogStatusProperty = clean(timeLogSettings?.statusProperty) ??
    process.env.NOTION_TIME_LOG_STATUS_PROP ??
    'Status';
const timeLogStartTimeProperty = clean(timeLogSettings?.startTimeProperty) ??
    process.env.NOTION_TIME_LOG_START_TIME_PROP ??
    'Start Time';
const timeLogEndTimeProperty = clean(timeLogSettings?.endTimeProperty) ??
    process.env.NOTION_TIME_LOG_END_TIME_PROP ??
    'End Time';
const timeLogTitleProperty = clean(timeLogSettings?.titleProperty) ??
    process.env.NOTION_TIME_LOG_TITLE_PROP ??
    'Name';
const projectsStatusProperty = clean(projectsSettings?.statusProperty) ??
    process.env.NOTION_PROJECTS_STATUS_PROP ??
    'Status';
const notionApiFallback = clean(timeLogSettings?.apiKey) ??
    clean(projectsSettings?.apiKey) ??
    clean(tasksSettings?.apiKey) ??
    clean(process.env.NOTION_API_KEY);
const clientCache = new Map();
function getNotionClient(preferredKey) {
    const key = clean(preferredKey) ?? notionApiFallback;
    if (!key) {
        throw new Error('Missing Notion API key. Configure one in Control Center or set NOTION_API_KEY.');
    }
    if (!clientCache.has(key)) {
        clientCache.set(key, new Client({ auth: key }));
    }
    return clientCache.get(key);
}
function formatTaskId(taskId) {
    return taskId ? taskId.replace(/-/g, '').trim() : '';
}
// Cache for data source IDs (SDK 5.x / API 2025-09-03)
const dataSourceIdCache = new Map();
async function getDataSourceId(client, databaseId) {
    if (dataSourceIdCache.has(databaseId)) {
        return dataSourceIdCache.get(databaseId);
    }
    const database = await client.databases.retrieve({ database_id: databaseId });
    const dataSources = database.data_sources;
    let dataSourceId;
    if (dataSources && dataSources.length > 0) {
        dataSourceId = dataSources[0].id;
    } else {
        dataSourceId = databaseId;
    }
    dataSourceIdCache.set(databaseId, dataSourceId);
    return dataSourceId;
}
async function fetchPages(client, databaseId, params = {}) {
    const pages = [];
    let cursor;
    const dataSourceId = await getDataSourceId(client, databaseId);
    do {
        const response = await client.dataSources.query({
            data_source_id: dataSourceId,
            start_cursor: cursor,
            page_size: 50,
            ...params
        });
        pages.push(...response.results);
        cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);
    return pages;
}
function summarizeProperty(property) {
    if (!property)
        return null;
    switch (property.type) {
        case 'title':
            return property.title.map((entry) => entry.plain_text).join('');
        case 'rich_text':
            return property.rich_text.map((entry) => entry.plain_text).join('');
        case 'select':
            return property.select?.name ?? null;
        case 'multi_select':
            return property.multi_select?.map((entry) => entry.name) ?? [];
        case 'status':
            return property.status?.name ?? null;
        case 'number':
            return property.number;
        case 'checkbox':
            return property.checkbox;
        case 'date':
            return property.date;
        case 'url':
            return property.url;
        case 'people':
            return property.people?.map((person) => person.name || person.id);
        case 'relation':
            return property.relation?.map((rel) => rel.id) ?? [];
        default:
            return null;
    }
}
function simplifyPage(page) {
    const properties = {};
    const rawProps = page.properties ?? {};
    Object.keys(rawProps).forEach((key) => {
        properties[key] = summarizeProperty(rawProps[key]);
    });
    return {
        id: page.id,
        url: page.url,
        createdTime: page.created_time,
        lastEditedTime: page.last_edited_time,
        properties
    };
}
const textContent = (text) => ({
    type: 'text',
    text
});
async function readJsonResource(label, fetcher) {
    const payload = await fetcher();
    const text = JSON.stringify({
        source: label,
        timestamp: new Date().toISOString(),
        data: payload
    }, null, 2);
    return {
        contents: [
            {
                uri: `notion://${label}`,
                mimeType: 'application/json',
                text
            }
        ]
    };
}
const listTasksArgsShape = {
    status: z
        .string()
        .describe('Optional status value to filter on (uses NOTION_TASK_STATUS_PROP)')
        .optional(),
    limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .describe('Maximum number of results to return')
        .optional()
};
const listTasksArgsSchema = z.object(listTasksArgsShape).strip();
const listTimeLogsArgsShape = {
    taskId: z
        .string()
        .describe('Optional task ID to filter by')
        .optional(),
    status: z
        .string()
        .describe('Optional status value to filter on (uses NOTION_TIME_LOG_STATUS_PROP)')
        .optional(),
    limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
};
const listTimeLogsArgsSchema = z.object(listTimeLogsArgsShape).strip();
const listProjectsArgsShape = {
    status: z
        .string()
        .describe('Optional status value to filter on (uses NOTION_PROJECTS_STATUS_PROP)')
        .optional(),
    limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
};
const listProjectsArgsSchema = z.object(listProjectsArgsShape).strip();
const describeArgsShape = {};
const describeArgsSchema = z.object(describeArgsShape).strip();
server.registerResource('tasks-database', 'notion://tasks', {
    mimeType: 'application/json',
    description: 'All tasks from the configured Notion tasks database.'
}, async () => {
    if (!tasksDatabaseId) {
        return {
            contents: [
                {
                    uri: 'notion://tasks',
                    mimeType: 'application/json',
                    text: JSON.stringify({ error: 'NOTION_DATABASE_ID is not configured' }, null, 2)
                }
            ]
        };
    }
    return readJsonResource('tasks', async () => {
        const client = getNotionClient(tasksSettings?.apiKey);
        const pages = await fetchPages(client, tasksDatabaseId);
        return {
            count: pages.length,
            tasks: pages.map(simplifyPage)
        };
    });
});
server.registerResource('time-log-database', 'notion://time-logs', {
    mimeType: 'application/json',
    description: 'All entries from the configured Notion time log database.'
}, async () => {
    if (!timeLogDatabaseId) {
        return {
            contents: [
                {
                    uri: 'notion://time-logs',
                    mimeType: 'application/json',
                    text: JSON.stringify({ error: 'NOTION_TIME_LOG_DATABASE_ID is not configured' }, null, 2)
                }
            ]
        };
    }
    return readJsonResource('time-logs', async () => {
        const client = getNotionClient(timeLogSettings?.apiKey);
        const pages = await fetchPages(client, timeLogDatabaseId);
        return {
            count: pages.length,
            entries: pages.map(simplifyPage)
        };
    });
});
server.registerResource('projects-database', 'notion://projects', {
    mimeType: 'application/json',
    description: 'All entries from the configured Notion projects database.'
}, async () => {
    if (!projectsDatabaseId) {
        return {
            contents: [
                {
                    uri: 'notion://projects',
                    mimeType: 'application/json',
                    text: JSON.stringify({ error: 'NOTION_PROJECTS_DATABASE_ID is not configured' }, null, 2)
                }
            ]
        };
    }
    return readJsonResource('projects', async () => {
        const client = getNotionClient(projectsSettings?.apiKey);
        const pages = await fetchPages(client, projectsDatabaseId);
        return {
            count: pages.length,
            projects: pages.map(simplifyPage)
        };
    });
});
server.registerTool('list-tasks', {
    title: 'List tasks',
    description: 'Fetch tasks from the configured Notion tasks database. Optionally filter by status or limit the results.'
}, async (rawArgs, _extra) => {
    const { status, limit } = listTasksArgsSchema.parse(rawArgs ?? {});
    if (!tasksDatabaseId) {
        throw new Error('NOTION_DATABASE_ID is not configured.');
    }
    const filter = status && taskStatusProperty
        ? {
            property: taskStatusProperty,
            status: { equals: status }
        }
        : undefined;
    const client = getNotionClient(tasksSettings?.apiKey);
    const pages = await fetchPages(client, tasksDatabaseId, {
        filter,
        sorts: [
            {
                timestamp: 'last_edited_time',
                direction: 'descending'
            }
        ]
    });
    const sliced = limit ? pages.slice(0, limit) : pages;
    const simplified = sliced.map(simplifyPage);
    const text = JSON.stringify({
        count: simplified.length,
        tasks: simplified
    }, null, 2);
    return {
        content: [textContent(text)]
    };
});
server.registerTool('list-time-logs', {
    title: 'List time logs',
    description: 'Fetch time log entries. Optionally filter by related task ID or status.'
}, async (rawArgs, _extra) => {
    const { taskId, status, limit } = listTimeLogsArgsSchema.parse(rawArgs ?? {});
    if (!timeLogDatabaseId) {
        throw new Error('NOTION_TIME_LOG_DATABASE_ID is not configured.');
    }
    const filters = [];
    const formattedTaskId = formatTaskId(taskId);
    if (formattedTaskId && timeLogTaskProperty) {
        filters.push({
            property: timeLogTaskProperty,
            relation: { contains: formattedTaskId }
        });
    }
    if (status && timeLogStatusProperty) {
        filters.push({
            property: timeLogStatusProperty,
            select: { equals: status }
        });
    }
    let filter;
    if (filters.length === 1) {
        filter = filters[0];
    }
    else if (filters.length > 1) {
        filter = { and: filters };
    }
    const client = getNotionClient(timeLogSettings?.apiKey);
    const pages = await fetchPages(client, timeLogDatabaseId, {
        filter,
        sorts: [
            {
                timestamp: 'created_time',
                direction: 'descending'
            }
        ]
    });
    const sliced = limit ? pages.slice(0, limit) : pages;
    const simplified = sliced.map(simplifyPage);
    const text = JSON.stringify({
        count: simplified.length,
        entries: simplified
    }, null, 2);
    return {
        content: [textContent(text)]
    };
});
server.registerTool('list-projects', {
    title: 'List projects',
    description: 'Fetch entries from the configured projects database, optionally filtering by status.'
}, async (rawArgs, _extra) => {
    const { status, limit } = listProjectsArgsSchema.parse(rawArgs ?? {});
    if (!projectsDatabaseId) {
        throw new Error('NOTION_PROJECTS_DATABASE_ID is not configured.');
    }
    const filter = status && projectsStatusProperty
        ? {
            property: projectsStatusProperty,
            status: { equals: status }
        }
        : undefined;
    const client = getNotionClient(projectsSettings?.apiKey);
    const pages = await fetchPages(client, projectsDatabaseId, {
        filter,
        sorts: [
            {
                timestamp: 'last_edited_time',
                direction: 'descending'
            }
        ]
    });
    const sliced = limit ? pages.slice(0, limit) : pages;
    const simplified = sliced.map(simplifyPage);
    const text = JSON.stringify({
        count: simplified.length,
        projects: simplified
    }, null, 2);
    return {
        content: [textContent(text)]
    };
});
server.registerTool('describe-configured-databases', {
    title: 'Describe configured databases',
    description: 'Returns the database IDs and property names currently loaded from the saved settings (or environment fallbacks).'
}, async (rawArgs, _extra) => {
    describeArgsSchema.parse(rawArgs ?? {});
    const payload = {
        source: storedConfig ? 'control-center-config' : 'env',
        tasks: {
            databaseId: tasksDatabaseId ?? null,
            statusProperty: taskStatusProperty,
            apiKeySource: tasksSettings?.apiKey
                ? 'config'
                : process.env.NOTION_API_KEY
                    ? 'env'
                    : 'missing'
        },
        timeLogs: {
            databaseId: timeLogDatabaseId ?? null,
            taskProperty: timeLogTaskProperty,
            statusProperty: timeLogStatusProperty,
            startTimeProperty: timeLogStartTimeProperty,
            endTimeProperty: timeLogEndTimeProperty,
            titleProperty: timeLogTitleProperty,
            apiKeySource: timeLogSettings?.apiKey
                ? 'config'
                : process.env.NOTION_API_KEY
                    ? 'env'
                    : 'missing'
        },
        projects: {
            databaseId: projectsDatabaseId ?? null,
            statusProperty: projectsStatusProperty,
            apiKeySource: projectsSettings?.apiKey
                ? 'config'
                : process.env.NOTION_API_KEY
                    ? 'env'
                    : 'missing'
        },
        timestamp: new Date().toISOString()
    };
    const text = JSON.stringify(payload, null, 2);
    return {
        content: [textContent(text)]
    };
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log('Notion MCP server started over stdio');
}
main().catch((error) => {
    console.error('Failed to start the Notion MCP server', error);
    process.exit(1);
});
process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
});
