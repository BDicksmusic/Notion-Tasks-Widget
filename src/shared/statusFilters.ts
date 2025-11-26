export type StatusFilterValue =
  | 'all'
  | 'inbox'
  | 'to do'
  | 'active'
  | 'waiting'
  | 'done';

export interface StatusFilterDefinition {
  value: StatusFilterValue;
  emoji?: string;
  label: string;
}

export const STATUS_FILTERS: StatusFilterDefinition[] = [
  { value: 'inbox', emoji: '📥', label: 'Inbox' },
  { value: 'to do', emoji: '📋', label: 'To-Do' },
  { value: 'active', emoji: '⌚', label: 'Active' },
  { value: 'waiting', emoji: '⌛', label: 'Waiting' },
  { value: 'done', emoji: '✅', label: 'Done' },
  { value: 'all', label: 'All' }
];

const STATUS_FILTER_ALIAS: Record<string, StatusFilterValue> = {
  inbox: 'inbox',
  '📥': 'inbox',
  boxes: 'inbox',
  backlog: 'inbox',
  queue: 'inbox',
  capture: 'inbox',
  'to do': 'to do',
  todo: 'to do',
  'to-do': 'to do',
  '📋': 'to do',
  task: 'to do',
  active: 'active',
  'in progress': 'active',
  progress: 'active',
  doing: 'active',
  working: 'active',
  started: 'active',
  focus: 'active',
  '⌚': 'active',
  waiting: 'waiting',
  'on hold': 'waiting',
  hold: 'waiting',
  blocked: 'waiting',
  '⌛': 'waiting',
  done: 'done',
  finished: 'done',
  complete: 'done',
  completed: 'done',
  shipped: 'done',
  '✅': 'done',
  '✔️': 'done',
  archive: 'done',
  archived: 'done'
};

const warnedStatuses = new Set<string>();
const shouldLogUnknownStatuses =
  typeof console !== 'undefined' &&
  (typeof process === 'undefined' || process.env?.NODE_ENV !== 'production');

function logUnknownStatus(value: string) {
  if (!shouldLogUnknownStatuses) return;
  const key = value.toLowerCase();
  if (warnedStatuses.has(key)) {
    return;
  }
  warnedStatuses.add(key);
  console.warn(`[StatusFilters] Unknown status alias: ${value}`);
}

export const mapStatusToFilterValue = (
  value?: string | null
): StatusFilterValue | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  const direct =
    STATUS_FILTER_ALIAS[trimmed] ??
    STATUS_FILTER_ALIAS[lower];
  if (direct) {
    return direct;
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  for (const token of [tokens[0], tokens[tokens.length - 1]]) {
    if (!token) continue;
    const normalizedToken =
      STATUS_FILTER_ALIAS[token] ??
      STATUS_FILTER_ALIAS[token.toLowerCase()];
    if (normalizedToken) {
      return normalizedToken;
    }
  }

  logUnknownStatus(trimmed);
  return undefined;
};





