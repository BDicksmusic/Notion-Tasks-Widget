/**
 * Database Verification Service
 * 
 * Verifies that configured property names actually exist in Notion databases.
 * This helps users identify configuration problems before they cause import failures.
 */

import { Client } from '@notionhq/client';
import { createNotionClient, withRetry } from './notionApi';
import type { 
  NotionSettings, 
  ProjectsSettings, 
  ContactsSettings, 
  TimeLogSettings, 
  WritingSettings 
} from '../../shared/types';

/**
 * Result of verifying a single property
 */
export interface PropertyVerificationResult {
  propertyName: string;
  configuredValue: string;
  exists: boolean;
  actualType?: string;
  expectedType?: string;
  isRequired: boolean;
  suggestion?: string;
}

/**
 * Result of verifying an entire database configuration
 */
export interface DatabaseVerificationResult {
  databaseId: string;
  databaseName?: string;
  connected: boolean;
  error?: string;
  properties: PropertyVerificationResult[];
  availableProperties: Array<{ name: string; type: string }>;
}

/**
 * Overall verification result for all databases
 */
export interface FullVerificationResult {
  tasks?: DatabaseVerificationResult;
  projects?: DatabaseVerificationResult;
  contacts?: DatabaseVerificationResult;
  timeLogs?: DatabaseVerificationResult;
  writing?: DatabaseVerificationResult;
}

/**
 * Fetch database schema and return available properties
 * SDK 5.x: Use dataSources.retrieve to get properties (databases.retrieve doesn't return them)
 */
async function fetchDatabaseSchema(
  client: Client,
  databaseId: string
): Promise<{ name: string; properties: Map<string, { type: string; id: string }> } | null> {
  try {
    const cleanId = databaseId.replace(/-/g, '').trim();
    if (cleanId.length !== 32) {
      return null;
    }

    // First get the database to find its data_source_id
    const database = await withRetry(
      client,
      () => client.databases.retrieve({ database_id: cleanId }),
      'Retrieve database'
    ) as any;

    // Get database name from title
    const titleArray = database.title || [];
    const dbName = titleArray.map((t: any) => t.plain_text).join('') || 'Untitled Database';

    // SDK 5.x: Get properties from data source
    const dataSourceId = database.data_sources?.[0]?.id;
    
    let dbProps: Record<string, any> = {};
    
    if (dataSourceId) {
      // Use dataSources.retrieve to get properties
      const dataSource = await withRetry(
        client,
        () => (client as any).dataSources.retrieve({ data_source_id: dataSourceId }),
        'Retrieve data source schema'
      ) as any;
      dbProps = dataSource.properties || {};
    } else {
      // Fallback: try to get properties from database response (older API)
      dbProps = database.properties || {};
    }

    const props = new Map<string, { type: string; id: string }>();
    
    for (const [name, prop] of Object.entries(dbProps)) {
      const propObj = prop as any;
      props.set(name, { type: propObj.type, id: propObj.id });
    }

    return { name: dbName, properties: props };
  } catch (error) {
    console.error('[Verification] Failed to fetch database schema:', error);
    return null;
  }
}

/**
 * Verify a single property exists in the database
 */
function verifyProperty(
  schemaProps: Map<string, { type: string; id: string }>,
  configuredName: string,
  isRequired: boolean,
  expectedTypes?: string[]
): PropertyVerificationResult {
  if (!configuredName || configuredName.trim() === '') {
    return {
      propertyName: '(not configured)',
      configuredValue: '',
      exists: !isRequired, // Not required = OK to be empty
      isRequired,
      suggestion: isRequired ? 'This property is required' : undefined
    };
  }

  const propInfo = schemaProps.get(configuredName);
  
  if (!propInfo) {
    // Try case-insensitive match
    let found: { name: string; type: string; id: string } | null = null;
    for (const [name, info] of schemaProps) {
      if (name.toLowerCase() === configuredName.toLowerCase()) {
        found = { name, ...info };
        break;
      }
    }

    if (found) {
      return {
        propertyName: configuredName,
        configuredValue: configuredName,
        exists: false,
        isRequired,
        suggestion: `Did you mean "${found.name}"? (case mismatch)`
      };
    }

    // Try finding similar names
    const similar = findSimilarProperty(schemaProps, configuredName);
    
    return {
      propertyName: configuredName,
      configuredValue: configuredName,
      exists: false,
      isRequired,
      suggestion: similar ? `Property not found. Did you mean "${similar}"?` : 'Property not found in database'
    };
  }

  // Check type match if expected types are specified
  if (expectedTypes && expectedTypes.length > 0) {
    const typeMatch = expectedTypes.includes(propInfo.type);
    if (!typeMatch) {
      return {
        propertyName: configuredName,
        configuredValue: configuredName,
        exists: true,
        actualType: propInfo.type,
        expectedType: expectedTypes.join(' or '),
        isRequired,
        suggestion: `Property exists but is type "${propInfo.type}", expected ${expectedTypes.join(' or ')}`
      };
    }
  }

  return {
    propertyName: configuredName,
    configuredValue: configuredName,
    exists: true,
    actualType: propInfo.type,
    isRequired
  };
}

/**
 * Find a similar property name (simple Levenshtein-like matching)
 */
function findSimilarProperty(
  schemaProps: Map<string, { type: string; id: string }>,
  target: string
): string | null {
  const targetLower = target.toLowerCase();
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const name of schemaProps.keys()) {
    const nameLower = name.toLowerCase();
    
    // Check if one contains the other
    if (nameLower.includes(targetLower) || targetLower.includes(nameLower)) {
      const score = Math.min(name.length, target.length) / Math.max(name.length, target.length);
      if (score > bestScore && score > 0.5) {
        bestScore = score;
        bestMatch = name;
      }
    }
    
    // Check prefix match
    if (nameLower.startsWith(targetLower.substring(0, 3)) || 
        targetLower.startsWith(nameLower.substring(0, 3))) {
      const score = 0.4;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = name;
      }
    }
  }

  return bestMatch;
}

/**
 * Verify Tasks database configuration
 */
export async function verifyTasksDatabase(
  settings: NotionSettings
): Promise<DatabaseVerificationResult> {
  if (!settings.apiKey?.trim()) {
    return {
      databaseId: settings.databaseId || '',
      connected: false,
      error: 'API key not configured',
      properties: [],
      availableProperties: []
    };
  }

  if (!settings.databaseId?.trim()) {
    return {
      databaseId: '',
      connected: false,
      error: 'Database ID not configured',
      properties: [],
      availableProperties: []
    };
  }

  try {
    const client = createNotionClient(settings.apiKey);
    const schema = await fetchDatabaseSchema(client, settings.databaseId);

    if (!schema) {
      return {
        databaseId: settings.databaseId,
        connected: false,
        error: 'Could not connect to database. Check your API key and database ID, and ensure the integration has access.',
        properties: [],
        availableProperties: []
      };
    }

    const properties: PropertyVerificationResult[] = [
      verifyProperty(schema.properties, settings.titleProperty, true, ['title']),
      verifyProperty(schema.properties, settings.statusProperty, true, ['status', 'select']),
      verifyProperty(schema.properties, settings.dateProperty, true, ['date']),
      verifyProperty(schema.properties, settings.deadlineProperty, false, ['status', 'select', 'checkbox']),
      verifyProperty(schema.properties, settings.urgentProperty || '', false, ['status', 'select', 'checkbox']),
      verifyProperty(schema.properties, settings.importantProperty || '', false, ['status', 'select', 'checkbox']),
      verifyProperty(schema.properties, settings.mainEntryProperty || '', false, ['rich_text']),
      verifyProperty(schema.properties, settings.sessionLengthProperty || '', false, ['number']),
      verifyProperty(schema.properties, settings.estimatedLengthProperty || '', false, ['number']),
      verifyProperty(schema.properties, settings.orderProperty || '', false, ['status', 'select']),
      verifyProperty(schema.properties, settings.projectRelationProperty || '', false, ['relation']),
      verifyProperty(schema.properties, settings.parentTaskProperty || '', false, ['relation']),
      verifyProperty(schema.properties, settings.recurrenceProperty || '', false, ['multi_select']),
      verifyProperty(schema.properties, settings.widgetLinkProperty || '', false, ['date']),
    ];

    // Filter out unconfigured optional properties
    const filteredProperties = properties.filter(p => p.configuredValue !== '' || p.isRequired);

    return {
      databaseId: settings.databaseId,
      databaseName: schema.name,
      connected: true,
      properties: filteredProperties,
      availableProperties: Array.from(schema.properties.entries()).map(([name, info]) => ({
        name,
        type: info.type
      }))
    };
  } catch (error) {
    return {
      databaseId: settings.databaseId,
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      properties: [],
      availableProperties: []
    };
  }
}

/**
 * Verify Projects database configuration
 */
export async function verifyProjectsDatabase(
  settings: ProjectsSettings,
  apiKey?: string
): Promise<DatabaseVerificationResult> {
  const effectiveApiKey = settings.apiKey?.trim() || apiKey?.trim();
  
  if (!effectiveApiKey) {
    return {
      databaseId: settings.databaseId || '',
      connected: false,
      error: 'API key not configured (uses Tasks API key if not set separately)',
      properties: [],
      availableProperties: []
    };
  }

  if (!settings.databaseId?.trim()) {
    return {
      databaseId: '',
      connected: false,
      error: 'Database ID not configured',
      properties: [],
      availableProperties: []
    };
  }

  try {
    const client = createNotionClient(effectiveApiKey);
    const schema = await fetchDatabaseSchema(client, settings.databaseId);

    if (!schema) {
      return {
        databaseId: settings.databaseId,
        connected: false,
        error: 'Could not connect to database. Check the database ID and ensure the integration has access.',
        properties: [],
        availableProperties: []
      };
    }

    const properties: PropertyVerificationResult[] = [
      verifyProperty(schema.properties, settings.titleProperty || 'Name', true, ['title']),
      verifyProperty(schema.properties, settings.statusProperty || 'Status', false, ['status', 'select']),
      verifyProperty(schema.properties, settings.descriptionProperty || '', false, ['rich_text']),
      verifyProperty(schema.properties, settings.startDateProperty || '', false, ['date']),
      verifyProperty(schema.properties, settings.endDateProperty || '', false, ['date']),
      verifyProperty(schema.properties, settings.tagsProperty || '', false, ['multi_select']),
      verifyProperty(schema.properties, settings.actionsRelationProperty || '', false, ['relation']),
    ];

    const filteredProperties = properties.filter(p => p.configuredValue !== '' || p.isRequired);

    return {
      databaseId: settings.databaseId,
      databaseName: schema.name,
      connected: true,
      properties: filteredProperties,
      availableProperties: Array.from(schema.properties.entries()).map(([name, info]) => ({
        name,
        type: info.type
      }))
    };
  } catch (error) {
    return {
      databaseId: settings.databaseId,
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      properties: [],
      availableProperties: []
    };
  }
}

/**
 * Verify Contacts database configuration
 */
export async function verifyContactsDatabase(
  settings: ContactsSettings,
  apiKey?: string
): Promise<DatabaseVerificationResult> {
  const effectiveApiKey = settings.apiKey?.trim() || apiKey?.trim();
  
  if (!effectiveApiKey) {
    return {
      databaseId: settings.databaseId || '',
      connected: false,
      error: 'API key not configured',
      properties: [],
      availableProperties: []
    };
  }

  if (!settings.databaseId?.trim()) {
    return {
      databaseId: '',
      connected: false,
      error: 'Database ID not configured',
      properties: [],
      availableProperties: []
    };
  }

  try {
    const client = createNotionClient(effectiveApiKey);
    const schema = await fetchDatabaseSchema(client, settings.databaseId);

    if (!schema) {
      return {
        databaseId: settings.databaseId,
        connected: false,
        error: 'Could not connect to database',
        properties: [],
        availableProperties: []
      };
    }

    const properties: PropertyVerificationResult[] = [
      verifyProperty(schema.properties, settings.nameProperty || 'Name', true, ['title']),
      verifyProperty(schema.properties, settings.emailProperty || '', false, ['email', 'rich_text']),
      verifyProperty(schema.properties, settings.phoneProperty || '', false, ['phone_number', 'rich_text']),
      verifyProperty(schema.properties, settings.companyProperty || '', false, ['rich_text', 'select']),
      verifyProperty(schema.properties, settings.roleProperty || '', false, ['rich_text', 'select']),
      verifyProperty(schema.properties, settings.notesProperty || '', false, ['rich_text']),
      verifyProperty(schema.properties, settings.projectsRelationProperty || '', false, ['relation']),
    ];

    const filteredProperties = properties.filter(p => p.configuredValue !== '' || p.isRequired);

    return {
      databaseId: settings.databaseId,
      databaseName: schema.name,
      connected: true,
      properties: filteredProperties,
      availableProperties: Array.from(schema.properties.entries()).map(([name, info]) => ({
        name,
        type: info.type
      }))
    };
  } catch (error) {
    return {
      databaseId: settings.databaseId,
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      properties: [],
      availableProperties: []
    };
  }
}

/**
 * Verify Time Log database configuration
 */
export async function verifyTimeLogDatabase(
  settings: TimeLogSettings,
  apiKey?: string
): Promise<DatabaseVerificationResult> {
  const effectiveApiKey = settings.apiKey?.trim() || apiKey?.trim();
  
  if (!effectiveApiKey) {
    return {
      databaseId: settings.databaseId || '',
      connected: false,
      error: 'API key not configured',
      properties: [],
      availableProperties: []
    };
  }

  if (!settings.databaseId?.trim()) {
    return {
      databaseId: '',
      connected: false,
      error: 'Database ID not configured',
      properties: [],
      availableProperties: []
    };
  }

  try {
    const client = createNotionClient(effectiveApiKey);
    const schema = await fetchDatabaseSchema(client, settings.databaseId);

    if (!schema) {
      return {
        databaseId: settings.databaseId,
        connected: false,
        error: 'Could not connect to database',
        properties: [],
        availableProperties: []
      };
    }

    const properties: PropertyVerificationResult[] = [
      verifyProperty(schema.properties, settings.titleProperty || '', false, ['title']),
      verifyProperty(schema.properties, settings.taskProperty || '', true, ['relation']),
      verifyProperty(schema.properties, settings.statusProperty || '', false, ['status', 'select']),
      verifyProperty(schema.properties, settings.startTimeProperty || '', true, ['date']),
      verifyProperty(schema.properties, settings.endTimeProperty || '', false, ['date']),
    ];

    const filteredProperties = properties.filter(p => p.configuredValue !== '' || p.isRequired);

    return {
      databaseId: settings.databaseId,
      databaseName: schema.name,
      connected: true,
      properties: filteredProperties,
      availableProperties: Array.from(schema.properties.entries()).map(([name, info]) => ({
        name,
        type: info.type
      }))
    };
  } catch (error) {
    return {
      databaseId: settings.databaseId,
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      properties: [],
      availableProperties: []
    };
  }
}

/**
 * Verify Writing database configuration
 */
export async function verifyWritingDatabase(
  settings: WritingSettings,
  apiKey?: string
): Promise<DatabaseVerificationResult> {
  const effectiveApiKey = settings.apiKey?.trim() || apiKey?.trim();
  
  if (!effectiveApiKey) {
    return {
      databaseId: settings.databaseId || '',
      connected: false,
      error: 'API key not configured',
      properties: [],
      availableProperties: []
    };
  }

  if (!settings.databaseId?.trim()) {
    return {
      databaseId: '',
      connected: false,
      error: 'Database ID not configured',
      properties: [],
      availableProperties: []
    };
  }

  try {
    const client = createNotionClient(effectiveApiKey);
    const schema = await fetchDatabaseSchema(client, settings.databaseId);

    if (!schema) {
      return {
        databaseId: settings.databaseId,
        connected: false,
        error: 'Could not connect to database',
        properties: [],
        availableProperties: []
      };
    }

    const properties: PropertyVerificationResult[] = [
      verifyProperty(schema.properties, settings.titleProperty || '', true, ['title']),
      verifyProperty(schema.properties, settings.summaryProperty || '', false, ['rich_text']),
      verifyProperty(schema.properties, settings.tagsProperty || '', false, ['multi_select']),
      verifyProperty(schema.properties, settings.statusProperty || '', false, ['status', 'select']),
    ];

    const filteredProperties = properties.filter(p => p.configuredValue !== '' || p.isRequired);

    return {
      databaseId: settings.databaseId,
      databaseName: schema.name,
      connected: true,
      properties: filteredProperties,
      availableProperties: Array.from(schema.properties.entries()).map(([name, info]) => ({
        name,
        type: info.type
      }))
    };
  } catch (error) {
    return {
      databaseId: settings.databaseId,
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      properties: [],
      availableProperties: []
    };
  }
}

/**
 * Verify all configured databases
 */
export async function verifyAllDatabases(options: {
  taskSettings?: NotionSettings;
  projectsSettings?: ProjectsSettings;
  contactsSettings?: ContactsSettings;
  timeLogSettings?: TimeLogSettings;
  writingSettings?: WritingSettings;
}): Promise<FullVerificationResult> {
  const result: FullVerificationResult = {};
  const primaryApiKey = options.taskSettings?.apiKey;

  // Run verifications in parallel for speed
  const [tasks, projects, contacts, timeLogs, writing] = await Promise.all([
    options.taskSettings ? verifyTasksDatabase(options.taskSettings) : Promise.resolve(undefined),
    options.projectsSettings ? verifyProjectsDatabase(options.projectsSettings, primaryApiKey) : Promise.resolve(undefined),
    options.contactsSettings ? verifyContactsDatabase(options.contactsSettings, primaryApiKey) : Promise.resolve(undefined),
    options.timeLogSettings ? verifyTimeLogDatabase(options.timeLogSettings, primaryApiKey) : Promise.resolve(undefined),
    options.writingSettings ? verifyWritingDatabase(options.writingSettings, primaryApiKey) : Promise.resolve(undefined),
  ]);

  if (tasks) result.tasks = tasks;
  if (projects) result.projects = projects;
  if (contacts) result.contacts = contacts;
  if (timeLogs) result.timeLogs = timeLogs;
  if (writing) result.writing = writing;

  return result;
}

