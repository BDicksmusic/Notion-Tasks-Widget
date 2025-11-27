/**
 * Schema Sync Service
 * 
 * Fetches database schema from Notion and stores it in the local
 * notion_database_schema table. This enables:
 * 
 * - Auto-discovery of available properties
 * - Property ID-based sync (survives property renames)
 * - Caching of select/status options
 * - Validation of user configuration
 */

import { Client } from '@notionhq/client';
import type {
  GetDatabaseResponse
} from '@notionhq/client/build/src/api-endpoints';
import {
  bulkUpsertProperties,
  autoMapProperties,
  getPropertiesForDatabase,
  getSchemaStats,
  type DatabaseType,
  type NotionPropertyType,
  type PropertyOptions,
  type SelectOption
} from '../db/repositories/schemaRepository';
import {
  getSettings,
  getTimeLogSettings,
  getProjectsSettings,
  getWritingSettings,
  getContactsSettings
} from '../configStore';

// ============================================================================
// TYPES
// ============================================================================

interface DatabaseConfig {
  databaseId: string;
  databaseType: DatabaseType;
  apiKey?: string;
}

interface SchemaSyncResult {
  success: boolean;
  databaseId: string;
  databaseType: DatabaseType;
  propertiesFound: number;
  propertiesAutoMapped: number;
  error?: string;
}

// ============================================================================
// PROPERTY PARSING
// ============================================================================

/**
 * Map Notion's property type to our simplified type
 */
function mapNotionPropertyType(notionType: string): NotionPropertyType {
  const typeMap: Record<string, NotionPropertyType> = {
    title: 'title',
    rich_text: 'rich_text',
    number: 'number',
    select: 'select',
    multi_select: 'multi_select',
    status: 'status',
    date: 'date',
    people: 'people',
    files: 'files',
    checkbox: 'checkbox',
    url: 'url',
    email: 'email',
    phone_number: 'phone_number',
    formula: 'formula',
    relation: 'relation',
    rollup: 'rollup',
    created_time: 'created_time',
    created_by: 'created_by',
    last_edited_time: 'last_edited_time',
    last_edited_by: 'last_edited_by',
    unique_id: 'unique_id'
  };
  return typeMap[notionType] ?? 'rich_text';
}

/**
 * Extract select/status options from a property
 */
function extractSelectOptions(propertyConfig: any): SelectOption[] | undefined {
  const options = propertyConfig?.options || propertyConfig?.groups?.flatMap((g: any) => g.options) || [];
  if (!Array.isArray(options) || options.length === 0) {
    return undefined;
  }
  return options.map((opt: any) => ({
    id: opt.id,
    name: opt.name,
    color: opt.color
  }));
}

/**
 * Extract relation configuration from a property
 */
function extractRelationConfig(propertyConfig: any): PropertyOptions['relation_config'] | undefined {
  if (!propertyConfig?.database_id) {
    return undefined;
  }
  return {
    database_id: propertyConfig.database_id,
    synced_property_name: propertyConfig.synced_property_name,
    synced_property_id: propertyConfig.synced_property_id
  };
}

/**
 * Extract unique_id prefix
 */
function extractUniqueIdPrefix(propertyConfig: any): string | undefined {
  return propertyConfig?.prefix;
}

/**
 * Parse a Notion database response into our property format
 */
function parseNotionProperties(
  database: GetDatabaseResponse
): Array<{
  name: string;
  id: string;
  type: NotionPropertyType;
  options?: PropertyOptions;
}> {
  const properties: Array<{
    name: string;
    id: string;
    type: NotionPropertyType;
    options?: PropertyOptions;
  }> = [];

  const props = (database as any).properties || {};

  for (const [name, propConfig] of Object.entries(props)) {
    const config = propConfig as any;
    const type = mapNotionPropertyType(config.type);

    const propertyOptions: PropertyOptions = {};

    // Extract select/status options
    if (type === 'select' || type === 'multi_select') {
      const selectOpts = extractSelectOptions(config.select || config.multi_select);
      if (selectOpts) {
        propertyOptions.select_options = selectOpts;
      }
    } else if (type === 'status') {
      const statusOpts = extractSelectOptions(config.status);
      if (statusOpts) {
        propertyOptions.select_options = statusOpts;
      }
    }

    // Extract relation config
    if (type === 'relation') {
      const relationConfig = extractRelationConfig(config.relation);
      if (relationConfig) {
        propertyOptions.relation_config = relationConfig;
      }
    }

    // Extract unique_id prefix
    if (type === 'unique_id') {
      const prefix = extractUniqueIdPrefix(config.unique_id);
      if (prefix) {
        propertyOptions.unique_id_prefix = prefix;
      }
    }

    // Extract formula expression
    if (type === 'formula' && config.formula?.expression) {
      propertyOptions.formula_expression = config.formula.expression;
    }

    properties.push({
      name,
      id: config.id,
      type,
      options: Object.keys(propertyOptions).length > 0 ? propertyOptions : undefined
    });
  }

  return properties;
}

// ============================================================================
// SYNC FUNCTIONS
// ============================================================================

/**
 * Sync schema for a single database
 */
async function syncDatabaseSchema(config: DatabaseConfig): Promise<SchemaSyncResult> {
  const { databaseId, databaseType, apiKey } = config;

  if (!databaseId) {
    return {
      success: false,
      databaseId: '',
      databaseType,
      propertiesFound: 0,
      propertiesAutoMapped: 0,
      error: 'No database ID configured'
    };
  }

  // Use provided API key or fall back to tasks API key
  const taskSettings = getSettings();
  const key = apiKey || taskSettings.apiKey;

  if (!key) {
    return {
      success: false,
      databaseId,
      databaseType,
      propertiesFound: 0,
      propertiesAutoMapped: 0,
      error: 'No API key configured'
    };
  }

  try {
    const client = new Client({ auth: key });
    
    console.log(`[SchemaSync] Fetching schema for ${databaseType} database: ${databaseId.slice(0, 8)}...`);
    
    const database = await client.databases.retrieve({ database_id: databaseId });
    const properties = parseNotionProperties(database);

    console.log(`[SchemaSync] Found ${properties.length} properties in ${databaseType} database`);

    // Bulk upsert all properties
    const upsertCount = bulkUpsertProperties(databaseId, databaseType, properties);

    // Auto-map common property patterns
    const autoMapped = autoMapProperties(databaseId);

    console.log(`[SchemaSync] ${databaseType}: ${upsertCount} properties synced, ${autoMapped} auto-mapped`);

    return {
      success: true,
      databaseId,
      databaseType,
      propertiesFound: upsertCount,
      propertiesAutoMapped: autoMapped
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[SchemaSync] Failed to sync ${databaseType} schema:`, errorMessage);
    return {
      success: false,
      databaseId,
      databaseType,
      propertiesFound: 0,
      propertiesAutoMapped: 0,
      error: errorMessage
    };
  }
}

/**
 * Sync schema for all configured databases
 */
export async function syncAllDatabaseSchemas(): Promise<{
  results: SchemaSyncResult[];
  stats: ReturnType<typeof getSchemaStats>;
}> {
  console.log('[SchemaSync] Starting full schema sync...');

  const results: SchemaSyncResult[] = [];
  const databases: DatabaseConfig[] = [];

  // Gather all configured databases
  const taskSettings = getSettings();
  if (taskSettings.databaseId) {
    databases.push({
      databaseId: taskSettings.databaseId,
      databaseType: 'tasks',
      apiKey: taskSettings.apiKey
    });
  }

  const projectSettings = getProjectsSettings();
  if (projectSettings.databaseId) {
    databases.push({
      databaseId: projectSettings.databaseId,
      databaseType: 'projects',
      apiKey: projectSettings.apiKey || taskSettings.apiKey
    });
  }

  const timeLogSettings = getTimeLogSettings();
  if (timeLogSettings.databaseId) {
    databases.push({
      databaseId: timeLogSettings.databaseId,
      databaseType: 'time_logs',
      apiKey: timeLogSettings.apiKey || taskSettings.apiKey
    });
  }

  const writingSettings = getWritingSettings();
  if (writingSettings.databaseId) {
    databases.push({
      databaseId: writingSettings.databaseId,
      databaseType: 'writing',
      apiKey: writingSettings.apiKey || taskSettings.apiKey
    });
  }

  const contactSettings = getContactsSettings();
  if (contactSettings.databaseId) {
    databases.push({
      databaseId: contactSettings.databaseId,
      databaseType: 'contacts',
      apiKey: contactSettings.apiKey || taskSettings.apiKey
    });
  }

  // Sync each database
  for (const config of databases) {
    const result = await syncDatabaseSchema(config);
    results.push(result);
  }

  const stats = getSchemaStats();
  
  console.log(`[SchemaSync] Complete: ${stats.totalProperties} properties across ${stats.databaseCount} databases`);
  
  return { results, stats };
}

/**
 * Sync schema for a specific database type
 */
export async function syncDatabaseSchemaByType(databaseType: DatabaseType): Promise<SchemaSyncResult> {
  let config: DatabaseConfig | null = null;
  const taskSettings = getSettings();

  switch (databaseType) {
    case 'tasks': {
      if (taskSettings.databaseId) {
        config = {
          databaseId: taskSettings.databaseId,
          databaseType: 'tasks',
          apiKey: taskSettings.apiKey
        };
      }
      break;
    }
    case 'projects': {
      const settings = getProjectsSettings();
      if (settings.databaseId) {
        config = {
          databaseId: settings.databaseId,
          databaseType: 'projects',
          apiKey: settings.apiKey || taskSettings.apiKey
        };
      }
      break;
    }
    case 'time_logs': {
      const settings = getTimeLogSettings();
      if (settings.databaseId) {
        config = {
          databaseId: settings.databaseId,
          databaseType: 'time_logs',
          apiKey: settings.apiKey || taskSettings.apiKey
        };
      }
      break;
    }
    case 'writing': {
      const settings = getWritingSettings();
      if (settings.databaseId) {
        config = {
          databaseId: settings.databaseId,
          databaseType: 'writing',
          apiKey: settings.apiKey || taskSettings.apiKey
        };
      }
      break;
    }
    case 'contacts': {
      const settings = getContactsSettings();
      if (settings.databaseId) {
        config = {
          databaseId: settings.databaseId,
          databaseType: 'contacts',
          apiKey: settings.apiKey || taskSettings.apiKey
        };
      }
      break;
    }
  }

  if (!config) {
    return {
      success: false,
      databaseId: '',
      databaseType,
      propertiesFound: 0,
      propertiesAutoMapped: 0,
      error: `No ${databaseType} database configured`
    };
  }

  return syncDatabaseSchema(config);
}

/**
 * Get cached schema for a database (doesn't call Notion API)
 */
export function getCachedSchema(databaseId: string) {
  return getPropertiesForDatabase(databaseId);
}

/**
 * Get select options for a property from cached schema
 */
export function getCachedSelectOptions(databaseId: string, propertyName: string): SelectOption[] {
  const properties = getPropertiesForDatabase(databaseId);
  const property = properties.find(p => p.propertyName === propertyName);
  return property?.propertyOptions?.select_options ?? [];
}

/**
 * Validate that required properties exist in a database schema
 */
export function validateDatabaseSchema(
  databaseId: string,
  requiredProperties: string[]
): { valid: boolean; missing: string[] } {
  const properties = getPropertiesForDatabase(databaseId);
  const propertyNames = new Set(properties.map(p => p.propertyName.toLowerCase()));

  const missing: string[] = [];
  for (const required of requiredProperties) {
    if (!propertyNames.has(required.toLowerCase())) {
      missing.push(required);
    }
  }

  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Get property ID by name (for stable sync)
 */
export function getPropertyIdByName(databaseId: string, propertyName: string): string | null {
  const properties = getPropertiesForDatabase(databaseId);
  const property = properties.find(
    p => p.propertyName.toLowerCase() === propertyName.toLowerCase()
  );
  return property?.propertyId ?? null;
}

/**
 * Get all property names for a database (for settings dropdowns)
 */
export function getPropertyNames(databaseId: string): string[] {
  const properties = getPropertiesForDatabase(databaseId);
  return properties.map(p => p.propertyName).sort();
}

/**
 * Get properties of a specific type (e.g., all 'select' properties)
 */
export function getPropertiesByType(databaseId: string, propertyType: NotionPropertyType): string[] {
  const properties = getPropertiesForDatabase(databaseId);
  return properties
    .filter(p => p.propertyType === propertyType)
    .map(p => p.propertyName)
    .sort();
}

