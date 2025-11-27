/**
 * Schema Repository
 * 
 * Manages the notion_database_schema table which stores
 * property definitions from Notion databases.
 * 
 * This enables:
 * - Auto-discovery of available properties
 * - Stable sync using property_id (survives renames in Notion)
 * - Caching of select/status options
 * - Smart property mapping suggestions
 */

import { getDb } from '../database';

const TABLE = 'notion_database_schema';

// ============================================================================
// TYPES
// ============================================================================

export type NotionPropertyType = 
  | 'title'
  | 'rich_text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'people'
  | 'files'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone_number'
  | 'formula'
  | 'relation'
  | 'rollup'
  | 'created_time'
  | 'created_by'
  | 'last_edited_time'
  | 'last_edited_by'
  | 'unique_id';

export type DatabaseType = 'tasks' | 'projects' | 'time_logs' | 'writing' | 'contacts';

export interface SelectOption {
  id: string;
  name: string;
  color?: string;
}

export interface RelationConfig {
  database_id: string;
  synced_property_name?: string;
  synced_property_id?: string;
}

export interface PropertyOptions {
  select_options?: SelectOption[];
  relation_config?: RelationConfig;
  unique_id_prefix?: string;
  formula_expression?: string;
}

export interface NotionPropertySchema {
  id: number;
  databaseId: string;
  databaseType: DatabaseType;
  propertyName: string;
  propertyId: string | null;
  propertyType: NotionPropertyType;
  propertyOptions: PropertyOptions | null;
  localColumn: string | null;
  isMapped: boolean;
  isRequired: boolean;
  lastSyncedAt: string | null;
  createdAt: number;
  updatedAt: number;
}

type SchemaRow = {
  id: number;
  database_id: string;
  database_type: string;
  property_name: string;
  property_id: string | null;
  property_type: string;
  property_options: string | null;
  local_column: string | null;
  is_mapped: number;
  is_required: number;
  last_synced_at: string | null;
  created_at: number;
  updated_at: number;
};

// ============================================================================
// MAPPING FUNCTIONS
// ============================================================================

function mapRowToSchema(row: SchemaRow): NotionPropertySchema {
  let propertyOptions: PropertyOptions | null = null;
  if (row.property_options) {
    try {
      propertyOptions = JSON.parse(row.property_options);
    } catch {
      // ignore parse errors
    }
  }

  return {
    id: row.id,
    databaseId: row.database_id,
    databaseType: row.database_type as DatabaseType,
    propertyName: row.property_name,
    propertyId: row.property_id,
    propertyType: row.property_type as NotionPropertyType,
    propertyOptions,
    localColumn: row.local_column,
    isMapped: row.is_mapped === 1,
    isRequired: row.is_required === 1,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * Get all properties for a specific database
 */
export function getPropertiesForDatabase(databaseId: string): NotionPropertySchema[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} WHERE database_id = ? ORDER BY property_name ASC`
  ).all(databaseId) as SchemaRow[];
  return rows.map(mapRowToSchema);
}

/**
 * Get all properties for a database type (e.g., all 'tasks' databases)
 */
export function getPropertiesByDatabaseType(databaseType: DatabaseType): NotionPropertySchema[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} WHERE database_type = ? ORDER BY database_id, property_name ASC`
  ).all(databaseType) as SchemaRow[];
  return rows.map(mapRowToSchema);
}

/**
 * Get a property by its Notion property ID (stable across renames)
 */
export function getPropertyByNotionId(databaseId: string, propertyId: string): NotionPropertySchema | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM ${TABLE} WHERE database_id = ? AND property_id = ? LIMIT 1`
  ).get(databaseId, propertyId) as SchemaRow | undefined;
  return row ? mapRowToSchema(row) : null;
}

/**
 * Get a property by name
 */
export function getPropertyByName(databaseId: string, propertyName: string): NotionPropertySchema | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM ${TABLE} WHERE database_id = ? AND property_name = ? LIMIT 1`
  ).get(databaseId, propertyName) as SchemaRow | undefined;
  return row ? mapRowToSchema(row) : null;
}

/**
 * Get a property by its local column mapping
 */
export function getPropertyByLocalColumn(databaseId: string, localColumn: string): NotionPropertySchema | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM ${TABLE} WHERE database_id = ? AND local_column = ? LIMIT 1`
  ).get(databaseId, localColumn) as SchemaRow | undefined;
  return row ? mapRowToSchema(row) : null;
}

/**
 * Get all mapped properties for a database
 */
export function getMappedProperties(databaseId: string): NotionPropertySchema[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} WHERE database_id = ? AND is_mapped = 1 ORDER BY property_name ASC`
  ).all(databaseId) as SchemaRow[];
  return rows.map(mapRowToSchema);
}

/**
 * Get select/status options for a property
 */
export function getSelectOptions(databaseId: string, propertyName: string): SelectOption[] {
  const property = getPropertyByName(databaseId, propertyName);
  return property?.propertyOptions?.select_options ?? [];
}

/**
 * Upsert a property schema (insert or update)
 */
export function upsertPropertySchema(
  databaseId: string,
  databaseType: DatabaseType,
  propertyName: string,
  propertyType: NotionPropertyType,
  options: {
    propertyId?: string | null;
    propertyOptions?: PropertyOptions | null;
    localColumn?: string | null;
    isMapped?: boolean;
    isRequired?: boolean;
  } = {}
): NotionPropertySchema {
  const db = getDb();
  const now = Date.now();
  const lastSyncedAt = new Date().toISOString();

  const {
    propertyId = null,
    propertyOptions = null,
    localColumn = null,
    isMapped = false,
    isRequired = false
  } = options;

  const optionsJson = propertyOptions ? JSON.stringify(propertyOptions) : null;

  db.prepare(
    `INSERT INTO ${TABLE} (
      database_id,
      database_type,
      property_name,
      property_id,
      property_type,
      property_options,
      local_column,
      is_mapped,
      is_required,
      last_synced_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(database_id, property_name) DO UPDATE SET
      property_id = excluded.property_id,
      property_type = excluded.property_type,
      property_options = excluded.property_options,
      local_column = COALESCE(excluded.local_column, local_column),
      is_mapped = CASE WHEN excluded.local_column IS NOT NULL THEN 1 ELSE is_mapped END,
      is_required = excluded.is_required,
      last_synced_at = excluded.last_synced_at,
      updated_at = excluded.updated_at`
  ).run(
    databaseId,
    databaseType,
    propertyName,
    propertyId,
    propertyType,
    optionsJson,
    localColumn,
    isMapped ? 1 : 0,
    isRequired ? 1 : 0,
    lastSyncedAt,
    now,
    now
  );

  return getPropertyByName(databaseId, propertyName)!;
}

/**
 * Update the local column mapping for a property
 */
export function mapPropertyToColumn(
  databaseId: string,
  propertyName: string,
  localColumn: string | null,
  isRequired = false
): boolean {
  const db = getDb();
  const result = db.prepare(
    `UPDATE ${TABLE} SET 
      local_column = ?,
      is_mapped = ?,
      is_required = ?,
      updated_at = ?
     WHERE database_id = ? AND property_name = ?`
  ).run(
    localColumn,
    localColumn ? 1 : 0,
    isRequired ? 1 : 0,
    Date.now(),
    databaseId,
    propertyName
  );
  return result.changes > 0;
}

/**
 * Bulk upsert properties for a database (used when syncing schema from Notion)
 */
export function bulkUpsertProperties(
  databaseId: string,
  databaseType: DatabaseType,
  properties: Array<{
    name: string;
    id: string;
    type: NotionPropertyType;
    options?: PropertyOptions;
  }>
): number {
  const db = getDb();
  const now = Date.now();
  const lastSyncedAt = new Date().toISOString();

  const upsert = db.prepare(
    `INSERT INTO ${TABLE} (
      database_id,
      database_type,
      property_name,
      property_id,
      property_type,
      property_options,
      last_synced_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(database_id, property_name) DO UPDATE SET
      property_id = excluded.property_id,
      property_type = excluded.property_type,
      property_options = excluded.property_options,
      last_synced_at = excluded.last_synced_at,
      updated_at = excluded.updated_at`
  );

  let count = 0;
  const transaction = db.transaction(() => {
    for (const prop of properties) {
      upsert.run(
        databaseId,
        databaseType,
        prop.name,
        prop.id,
        prop.type,
        prop.options ? JSON.stringify(prop.options) : null,
        lastSyncedAt,
        now,
        now
      );
      count++;
    }
  });

  transaction();
  console.log(`[SchemaRepo] Upserted ${count} properties for database ${databaseId}`);
  return count;
}

/**
 * Delete all properties for a database
 */
export function clearDatabaseSchema(databaseId: string): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM ${TABLE} WHERE database_id = ?`).run(databaseId);
  console.log(`[SchemaRepo] Cleared ${result.changes} properties for database ${databaseId}`);
  return result.changes;
}

/**
 * Clear all schema data
 */
export function clearAllSchemas(): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM ${TABLE}`).run();
  console.log(`[SchemaRepo] Cleared all ${result.changes} schema entries`);
  return result.changes;
}

/**
 * Get schema statistics
 */
export function getSchemaStats(): {
  totalProperties: number;
  mappedProperties: number;
  databaseCount: number;
  byType: Record<string, number>;
} {
  const db = getDb();

  const total = db.prepare(`SELECT COUNT(*) as count FROM ${TABLE}`).get() as { count: number };
  const mapped = db.prepare(`SELECT COUNT(*) as count FROM ${TABLE} WHERE is_mapped = 1`).get() as { count: number };
  const databases = db.prepare(`SELECT COUNT(DISTINCT database_id) as count FROM ${TABLE}`).get() as { count: number };
  
  const byTypeRows = db.prepare(
    `SELECT database_type, COUNT(*) as count FROM ${TABLE} GROUP BY database_type`
  ).all() as { database_type: string; count: number }[];

  const byType: Record<string, number> = {};
  for (const row of byTypeRows) {
    byType[row.database_type] = row.count;
  }

  return {
    totalProperties: total.count,
    mappedProperties: mapped.count,
    databaseCount: databases.count,
    byType
  };
}

// ============================================================================
// AUTO-MAPPING HELPERS
// ============================================================================

/**
 * Common property name patterns for auto-mapping
 */
const AUTO_MAP_PATTERNS: Record<string, { patterns: RegExp[]; localColumn: string; isRequired: boolean }> = {
  title: {
    patterns: [/^title$/i, /^name$/i, /^task\s*name$/i, /^project\s*name$/i],
    localColumn: 'title',
    isRequired: true
  },
  status: {
    patterns: [/^status$/i, /^state$/i, /^task\s*status$/i],
    localColumn: 'status',
    isRequired: false
  },
  due_date: {
    patterns: [/^due\s*date$/i, /^deadline$/i, /^date$/i, /^due$/i],
    localColumn: 'due_date',
    isRequired: false
  },
  start_date: {
    patterns: [/^start\s*date$/i, /^start$/i, /^begin$/i],
    localColumn: 'start_date',
    isRequired: false
  },
  end_date: {
    patterns: [/^end\s*date$/i, /^end$/i, /^finish$/i],
    localColumn: 'end_date',
    isRequired: false
  },
  description: {
    patterns: [/^description$/i, /^notes$/i, /^details$/i, /^summary$/i],
    localColumn: 'description',
    isRequired: false
  },
  urgent: {
    patterns: [/^urgent$/i, /^urgency$/i, /^priority$/i],
    localColumn: 'urgent',
    isRequired: false
  },
  important: {
    patterns: [/^important$/i, /^importance$/i],
    localColumn: 'important',
    isRequired: false
  },
  tags: {
    patterns: [/^tags$/i, /^labels$/i, /^categories$/i],
    localColumn: 'tags',
    isRequired: false
  }
};

/**
 * Suggest a local column mapping for a property name
 */
export function suggestLocalColumn(propertyName: string, propertyType: NotionPropertyType): string | null {
  // First check if it's a title type - always map to 'title'
  if (propertyType === 'title') {
    return 'title';
  }

  // Check against patterns
  for (const [, config] of Object.entries(AUTO_MAP_PATTERNS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(propertyName)) {
        return config.localColumn;
      }
    }
  }

  return null;
}

/**
 * Auto-map properties for a database based on common patterns
 */
export function autoMapProperties(databaseId: string): number {
  const properties = getPropertiesForDatabase(databaseId);
  let mapped = 0;

  for (const prop of properties) {
    if (prop.isMapped) continue; // Already mapped

    const suggestion = suggestLocalColumn(prop.propertyName, prop.propertyType);
    if (suggestion) {
      // Check if this column is already mapped to another property
      const existing = getPropertyByLocalColumn(databaseId, suggestion);
      if (!existing) {
        const isRequired = AUTO_MAP_PATTERNS[suggestion]?.isRequired ?? false;
        mapPropertyToColumn(databaseId, prop.propertyName, suggestion, isRequired);
        mapped++;
        console.log(`[SchemaRepo] Auto-mapped "${prop.propertyName}" → ${suggestion}`);
      }
    }
  }

  return mapped;
}

/**
 * Get unmapped properties that could be useful
 */
export function getUnmappedProperties(databaseId: string): NotionPropertySchema[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM ${TABLE} 
     WHERE database_id = ? AND is_mapped = 0 
     AND property_type NOT IN ('formula', 'rollup', 'created_by', 'last_edited_by')
     ORDER BY property_name ASC`
  ).all(databaseId) as SchemaRow[];
  return rows.map(mapRowToSchema);
}

