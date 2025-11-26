import type { Task, Project } from '@shared/types';
import {
  STATUS_FILTERS,
  mapStatusToFilterValue,
  type StatusFilterValue
} from '@shared/statusFilters';
import {
  matrixOptions,
  type MatrixOptionId
} from '../constants/matrix';

export type SortProperty = 'dueDate' | 'status' | 'priority';
export type SortDirection = 'asc' | 'desc';

export type GroupingOption = 'none' | 'dueDate' | 'status' | 'priority' | 'project';

export interface SortRule {
  id: string;
  property: SortProperty;
  direction: SortDirection;
}

export interface StoredSortRule {
  property: SortProperty;
  direction: SortDirection;
}

export interface TaskGroup {
  id: string;
  label: string;
  description?: string;
  tasks: Task[];
}

const PRIORITY_ORDER: MatrixOptionId[] = [
  'do-now',
  'deep-work',
  'delegate',
  'trash'
];

const STATUS_ORDER = STATUS_FILTERS.map((option) => option.value).filter(
  (value) => value !== 'all'
);

const toSortableStatus = (value?: string | StatusFilterValue | null) => {
  if (!value) return undefined;
  const normalized = mapStatusToFilterValue(value);
  if (normalized && normalized !== 'all') {
    return normalized;
  }
  return undefined;
};

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric'
});

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric'
});

const RULE_ID_PREFIX = 'sort-';

export const DEFAULT_SORT_BLUEPRINT: StoredSortRule[] = [
  { property: 'dueDate', direction: 'asc' },
  { property: 'priority', direction: 'asc' }
];

export const createSortRule = (
  property: SortProperty,
  direction: SortDirection = 'asc'
): SortRule => ({
  id: `${RULE_ID_PREFIX}${Math.random().toString(36).slice(2, 9)}`,
  property,
  direction
});

export const deserializeSortRules = (
  stored?: StoredSortRule[] | null
): SortRule[] => {
  if (!stored || !Array.isArray(stored) || stored.length === 0) {
    return DEFAULT_SORT_BLUEPRINT.map((rule) =>
      createSortRule(rule.property, rule.direction)
    );
  }
  return stored.map((rule) =>
    createSortRule(rule.property, rule.direction)
  );
};

export const serializeSortRules = (rules: SortRule[]): StoredSortRule[] =>
  rules.map((rule) => ({
    property: rule.property,
    direction: rule.direction
  }));

export const getSortPropertyLabel = (property: SortProperty) => {
  switch (property) {
    case 'dueDate':
      return 'Due date';
    case 'status':
      return 'Status';
    case 'priority':
      return 'Priority';
    default:
      return property;
  }
};

export const getGroupingLabel = (grouping: GroupingOption) => {
  switch (grouping) {
    case 'dueDate':
      return 'Due date';
    case 'status':
      return 'Status';
    case 'priority':
      return 'Priority';
    case 'project':
      return 'Project';
    case 'none':
    default:
      return 'No grouping';
  }
};

export const sortTasks = (tasks: Task[], rules: SortRule[]): Task[] => {
  if (!rules.length) return tasks;

  const indexed = tasks.map((task, index) => ({ task, index }));

  indexed.sort((a, b) => {
    for (const rule of rules) {
      const result = compareByRule(a.task, b.task, rule);
      if (result !== 0) return result;
    }
    return a.index - b.index;
  });

  return indexed.map((entry) => entry.task);
};

export const groupTasks = (
  tasks: Task[],
  grouping: GroupingOption,
  projects?: Project[]
): TaskGroup[] => {
  if (grouping === 'none') {
    return [];
  }

  // Special handling for project grouping
  if (grouping === 'project') {
    const projectMap = new Map<string, Project>();
    projects?.forEach(p => projectMap.set(p.id, p));
    
    const map = new Map<string, TaskGroup>();
    
    // Create groups for each project that has tasks
    tasks.forEach((task) => {
      const projectIds = task.projectIds ?? [];
      
      if (projectIds.length === 0) {
        // Task has no project
        if (!map.has('no-project')) {
          map.set('no-project', {
            id: 'no-project',
            label: 'No Project',
            tasks: []
          });
        }
        map.get('no-project')!.tasks.push(task);
      } else {
        // Task can belong to multiple projects - add to each
        projectIds.forEach(projectId => {
          const project = projectMap.get(projectId);
          const label = project?.title || 'Unknown Project';
          
          if (!map.has(projectId)) {
            map.set(projectId, {
              id: projectId,
              label,
              tasks: []
            });
          }
          map.get(projectId)!.tasks.push(task);
        });
      }
    });
    
    // Sort groups alphabetically, with "No Project" at the end
    const groups = Array.from(map.values());
    groups.sort((a, b) => {
      if (a.id === 'no-project') return 1;
      if (b.id === 'no-project') return -1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    });
    
    return groups;
  }

  const map = new Map<string, TaskGroup>();

  tasks.forEach((task) => {
    const key = getGroupKey(task, grouping);
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        label: getGroupLabel(key, grouping),
        description: getGroupDescription(key, grouping),
        tasks: []
      });
    }
    map.get(key)!.tasks.push(task);
  });

  const groups = Array.from(map.values());

  const getOrderValue = (group: TaskGroup) => {
    switch (grouping) {
      case 'dueDate': {
        if (group.id === 'no-date') return Number.POSITIVE_INFINITY;
        return toMidnightTimestamp(group.id) ?? Number.POSITIVE_INFINITY;
      }
      case 'status': {
        const normalizedId = toSortableStatus(group.id);
        const index = normalizedId ? STATUS_ORDER.indexOf(normalizedId) : -1;
        return index === -1 ? Number.POSITIVE_INFINITY : index;
      }
      case 'priority': {
        const index = PRIORITY_ORDER.indexOf(group.id as MatrixOptionId);
        return index === -1 ? PRIORITY_ORDER.length : index;
      }
      default:
        return 0;
    }
  };

  groups.sort((a, b) => {
    const orderA = getOrderValue(a);
    const orderB = getOrderValue(b);
    if (orderA === Number.POSITIVE_INFINITY && orderB === Number.POSITIVE_INFINITY) {
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    }
    if (orderA === Number.POSITIVE_INFINITY) return 1;
    if (orderB === Number.POSITIVE_INFINITY) return -1;
    const orderDiff = orderA - orderB;
    if (orderDiff !== 0) return orderDiff;
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });

  return groups;
};

const compareByRule = (a: Task, b: Task, rule: SortRule) => {
  let result = 0;
  switch (rule.property) {
    case 'dueDate':
      result = compareNumbers(getDueDateSortValue(a), getDueDateSortValue(b));
      if (result === 0) {
        result = compareBooleans(a.hardDeadline ?? false, b.hardDeadline ?? false);
      }
      break;
    case 'priority':
      result = compareNumbers(getPriorityRank(a), getPriorityRank(b));
      break;
    case 'status':
      result = compareNumbers(getStatusRank(a), getStatusRank(b));
      if (result === 0) {
        result = compareStrings(a.status ?? '', b.status ?? '');
      }
      break;
    default:
      result = 0;
  }

  return rule.direction === 'asc' ? result : -result;
};

const getPriorityRank = (task: Task) => {
  const target = matrixOptions.find(
    (option) =>
      Boolean(option.urgent) === Boolean(task.urgent) &&
      Boolean(option.important) === Boolean(task.important)
  );
  if (!target) return PRIORITY_ORDER.length;
  return PRIORITY_ORDER.indexOf(target.id);
};

const getStatusRank = (task: Task) => {
  const normalized =
    toSortableStatus(task.normalizedStatus) ??
    toSortableStatus(task.status);
  if (!normalized) {
    return Number.POSITIVE_INFINITY;
  }
  const index = STATUS_ORDER.indexOf(normalized);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
};

const getDueDateSortValue = (task: Task) => {
  const dateKey = extractDateKey(task.dueDate);
  return dateKey ? toMidnightTimestamp(dateKey) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
};

const compareNumbers = (a: number, b: number) => {
  if (a === b) return 0;
  if (Number.isNaN(a)) return 1;
  if (Number.isNaN(b)) return -1;
  return a < b ? -1 : 1;
};

const compareBooleans = (a: boolean, b: boolean) => {
  if (a === b) return 0;
  return a ? -1 : 1;
};

const compareStrings = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' });

const extractDateKey = (value?: string | null) => {
  if (!value) return null;
  return value.slice(0, 10);
};

const toMidnightTimestamp = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const getGroupKey = (task: Task, grouping: GroupingOption) => {
  switch (grouping) {
    case 'dueDate': {
      const key = extractDateKey(task.dueDate);
      return key ?? 'no-date';
    }
    case 'status': {
      const normalized =
        task.normalizedStatus ?? mapStatusToFilterValue(task.status);
      return normalized ?? (task.status?.trim().toLowerCase() || 'no-status');
    }
    case 'priority':
      return getPriorityId(task);
    default:
      return 'default';
  }
};

const getPriorityId = (task: Task): MatrixOptionId => {
  if (task.urgent && task.important) return 'do-now';
  if (!task.urgent && task.important) return 'deep-work';
  if (task.urgent && !task.important) return 'delegate';
  return 'trash';
};

const getGroupLabel = (key: string, grouping: GroupingOption) => {
  switch (grouping) {
    case 'dueDate':
      return formatDateLabel(key);
    case 'status':
      return key === 'no-status' ? 'No status' : formatStatusLabel(key);
    case 'priority':
      return formatPriorityLabel(key as MatrixOptionId);
    default:
      return key;
  }
};

const getGroupDescription = (key: string, grouping: GroupingOption) => {
  if (grouping !== 'dueDate' || key === 'no-date') return undefined;
  const timestamp = toMidnightTimestamp(key);
  if (!timestamp) return undefined;
  return SHORT_DATE_FORMATTER.format(timestamp);
};

const formatDateLabel = (key: string) => {
  if (key === 'no-date') return 'No due date';
  const todayKey = getTodayKey();
  const tomorrowKey = addDays(todayKey, 1);
  const yesterdayKey = addDays(todayKey, -1);
  if (key === todayKey) return 'Today';
  if (key === tomorrowKey) return 'Tomorrow';
  if (key === yesterdayKey) return 'Yesterday';
  const timestamp = toMidnightTimestamp(key);
  if (!timestamp) return key;
  return DATE_FORMATTER.format(timestamp);
};

const formatStatusLabel = (key: string) => {
  const normalized = mapStatusToFilterValue(key);
  const match = STATUS_FILTERS.find((option) => option.value === normalized);
  if (match) {
    return match.emoji ? `${match.emoji} ${match.label}` : match.label;
  }
  if (!key || key === 'no-status') return 'No status';
  return key
    .split(' ')
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
};

const formatPriorityLabel = (key: MatrixOptionId) => {
  const match = matrixOptions.find((option) => option.id === key);
  return match ? match.label : 'Priority';
};

const getTodayKey = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

const addDays = (dateKey: string, days: number) => {
  const timestamp = toMidnightTimestamp(dateKey);
  if (!timestamp) return dateKey;
  const next = new Date(timestamp);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
};

export const isGroupingOption = (value: unknown): value is GroupingOption =>
  value === 'none' ||
  value === 'dueDate' ||
  value === 'status' ||
  value === 'priority' ||
  value === 'project';

