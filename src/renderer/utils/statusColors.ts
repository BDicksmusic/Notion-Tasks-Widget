const STATUS_COLOR_MAP: Record<string, string> = {
  inbox: 'status-inbox',
  'inbox tasks': 'status-inbox',
  'to-do': 'status-todo',
  todo: 'status-todo',
  'to do': 'status-todo',
  active: 'status-active',
  waiting: 'status-waiting'
};

export const getStatusColorClass = (value?: string | null) => {
  if (!value) return '';
  const normalized = value.trim().toLowerCase();
  return STATUS_COLOR_MAP[normalized] ?? '';
};










