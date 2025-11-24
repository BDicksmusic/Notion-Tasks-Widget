import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import type { NotionSettings, Task } from '@shared/types';
import { mapStatusToFilterValue } from '@shared/statusFilters';

type TaskProperty = PageObjectResponse['properties'][string];

export function mapPageToTask(
  page: PageObjectResponse,
  settings: NotionSettings
): Task {
  const properties = page.properties ?? {};
  const title = extractTitle(properties[settings.titleProperty]);
  const status = extractStatus(properties[settings.statusProperty]);
  const normalizedStatus =
    mapStatusToFilterValue(status) ?? status?.trim().toLowerCase();
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

  return {
    id: page.id,
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
    estimatedLengthMinutes: extractNumber(estimatedLengthProperty)
  };
}

function extractTitle(property: TaskProperty) {
  if (!property || property.type !== 'title') return '';
  return property.title.map((segment) => segment.plain_text).join('');
}

function extractStatus(property: TaskProperty) {
  if (!property) return undefined;

  if (property.type === 'status') {
    return property.status?.name ?? undefined;
  }

  if (property.type === 'select') {
    return property.select?.name ?? undefined;
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

