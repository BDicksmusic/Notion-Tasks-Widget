import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import type { NotionSettings, Task } from '@shared/types';
import { mapStatusToFilterValue } from '@shared/statusFilters';

type TaskProperty = PageObjectResponse['properties'][string];

// Debug logging flag - enable via --debug-status flag or DEBUG_STATUS env var
const DEBUG_STATUS_EXTRACTION = 
  (typeof process !== 'undefined' && (
    process.argv?.includes('--debug-status') || 
    process.env?.DEBUG_STATUS === 'true'
  )) ?? false;

export function mapPageToTask(
  page: PageObjectResponse,
  settings: NotionSettings
): Task {
  const properties = page.properties ?? {};
  const title = extractTitle(properties[settings.titleProperty]);
  
  // Enhanced status extraction with debugging
  const statusProp = properties[settings.statusProperty];
  const status = extractStatus(statusProp, settings.statusProperty, DEBUG_STATUS_EXTRACTION);
  const normalizedStatus = mapStatusToFilterValue(status);
  const { start: dueDate, end: dueDateEnd } = extractDateRange(
    properties[settings.dateProperty]
  );
  const deadlineProperty = properties[settings.deadlineProperty];
  const urgentProperty = properties[settings.urgentProperty];
  const importantProperty = properties[settings.importantProperty];
  const mainEntryProperty = settings.mainEntryProperty
    ? properties[settings.mainEntryProperty]
    : properties['Main Entry'];
  const sessionLengthProperty = settings.sessionLengthProperty
    ? properties[settings.sessionLengthProperty]
    : undefined;
  const estimatedLengthProperty = settings.estimatedLengthProperty
    ? properties[settings.estimatedLengthProperty]
    : undefined;
  const projectRelationProperty = settings.projectRelationProperty
    ? properties[settings.projectRelationProperty]
    : undefined;
  const orderPropertyName = settings.orderProperty?.trim();
  const orderProperty = orderPropertyName
    ? properties[orderPropertyName]
    : undefined;
  const orderSelect = extractSelectOption(orderProperty);

  // Extract recurrence (multi-select weekdays)
  const recurrenceProperty = settings.recurrenceProperty
    ? properties[settings.recurrenceProperty]
    : undefined;
  const recurrence = extractMultiSelect(recurrenceProperty);

  // Extract parent task relation (for subtasks)
  const parentTaskProperty = settings.parentTaskProperty
    ? properties[settings.parentTaskProperty]
    : undefined;
  const parentTaskIds = extractRelationIds(parentTaskProperty);
  const parentTaskId = parentTaskIds && parentTaskIds.length > 0 ? parentTaskIds[0] : undefined;

  // Extract unique ID for deduplication (e.g., "ACTION-123")
  const idProperty = settings.idProperty
    ? properties[settings.idProperty]
    : undefined;
  const uniqueId = extractUniqueId(idProperty);

  return {
    id: page.id,
    uniqueId,
    title: title || 'Untitled',
    status,
    normalizedStatus,
    dueDate,
    dueDateEnd: dueDateEnd ?? undefined,
    url: page.url,
    hardDeadline: isStatusMatch(deadlineProperty, settings.deadlineHardValue),
    urgent: extractBooleanFlag(urgentProperty, settings.urgentStatusActive),
    important: extractBooleanFlag(
      importantProperty,
      settings.importantStatusActive
    ),
    mainEntry: extractRichText(mainEntryProperty),
    sessionLengthMinutes: extractNumber(sessionLengthProperty),
    estimatedLengthMinutes: extractNumber(estimatedLengthProperty),
    orderValue: orderSelect?.name ?? null,
    orderColor: orderSelect?.color ?? null,
    projectIds: extractRelationIds(projectRelationProperty),
    // Recurring task fields
    recurrence: recurrence && recurrence.length > 0 ? recurrence : undefined,
    // Subtask fields
    parentTaskId
  };
}

function extractTitle(property: TaskProperty) {
  if (!property || property.type !== 'title') return '';
  return property.title.map((segment) => segment.plain_text).join('');
}

function extractStatus(
  property: TaskProperty,
  propertyName?: string,
  debug = false
): string | undefined {
  if (!property) {
    if (debug) {
      console.log(`[TaskMapper] Status property "${propertyName}" not found in page properties`);
    }
    return undefined;
  }

  if (debug) {
    console.log(`[TaskMapper] Status property "${propertyName}" type: ${property.type}`, 
      JSON.stringify(property).substring(0, 200));
  }

  if (property.type === 'status') {
    const statusValue = property.status?.name ?? undefined;
    if (debug && !statusValue) {
      console.log(`[TaskMapper] Status property is 'status' type but value is null/undefined`);
    }
    return statusValue;
  }

  if (property.type === 'select') {
    const selectValue = property.select?.name ?? undefined;
    if (debug && !selectValue) {
      console.log(`[TaskMapper] Status property is 'select' type but value is null/undefined`);
    }
    return selectValue;
  }

  // Handle unexpected property types
  if (debug) {
    console.warn(`[TaskMapper] Status property "${propertyName}" has unexpected type: ${property.type}`);
  }
  
  return undefined;
}

function extractDateRange(property: TaskProperty) {
  if (!property || property.type !== 'date') {
    return { start: undefined, end: undefined };
  }
  return {
    start: property.date?.start ?? undefined,
    end: property.date?.end ?? undefined
  };
}

function extractRichText(property: TaskProperty | undefined) {
  if (!property || property.type !== 'rich_text') return undefined;
  return property.rich_text.map((segment) => segment.plain_text).join('');
}

function isStatusMatch(property: TaskProperty | undefined, expected: string) {
  if (!property || !expected) return false;
  if (property.type === 'status') {
    return property.status?.name === expected;
  }
  if (property.type === 'select') {
    return property.select?.name === expected;
  }
  return false;
}

function extractBooleanFlag(property: TaskProperty | undefined, activeLabel: string) {
  if (!property) return false;
  if (property.type === 'checkbox') {
    return Boolean(property.checkbox);
  }
  return isStatusMatch(property, activeLabel);
}

function extractNumber(property: TaskProperty | undefined) {
  if (!property) return undefined;
  if (property.type === 'number') {
    return typeof property.number === 'number' ? property.number : undefined;
  }
  if (property.type === 'formula') {
    const value = property.formula;
    if ('number' in value && typeof value.number === 'number') {
      return value.number;
    }
    return undefined;
  }
  return undefined;
}

function extractRelationIds(property: TaskProperty | undefined) {
  if (!property || property.type !== 'relation') {
    return null;
  }
  return property.relation.map((entry) => entry.id);
}

function extractSelectOption(property: TaskProperty | undefined) {
  if (!property) return null;
  if (property.type === 'select') {
    return property.select;
  }
  if (property.type === 'status') {
    return property.status;
  }
  return null;
}

function extractMultiSelect(property: TaskProperty | undefined): string[] | null {
  if (!property || property.type !== 'multi_select') {
    return null;
  }
  return property.multi_select.map((option) => option.name);
}

/**
 * Extract unique_id property value (e.g., "ACTION-123", "PRJ-45")
 * Notion's unique_id property returns { prefix: string, number: number }
 */
function extractUniqueId(property: TaskProperty | undefined): string | undefined {
  if (!property || property.type !== 'unique_id') {
    return undefined;
  }
  const uniqueId = (property as any).unique_id;
  if (uniqueId && typeof uniqueId.number === 'number') {
    const prefix = uniqueId.prefix || '';
    return prefix ? `${prefix}-${uniqueId.number}` : String(uniqueId.number);
  }
  return undefined;
}


