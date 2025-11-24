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
  'to do': 'to do',
  todo: 'to do',
  '📋': 'to do',
  active: 'active',
  '⌚': 'active',
  waiting: 'waiting',
  '⌛': 'waiting',
  done: 'done',
  completed: 'done',
  '✅': 'done'
};

export const mapStatusToFilterValue = (
  value?: string | null
): StatusFilterValue | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  return (
    STATUS_FILTER_ALIAS[trimmed] ??
    STATUS_FILTER_ALIAS[lower] ??
    undefined
  );
};





