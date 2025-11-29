// Map status names to CSS classes (fallback when no Notion color is provided)
const STATUS_NAME_MAP: Record<string, string> = {
  inbox: 'status-gray',
  'inbox tasks': 'status-gray',
  'to-do': 'status-orange',
  todo: 'status-orange',
  'to do': 'status-orange',
  active: 'status-blue',
  'in progress': 'status-blue',
  waiting: 'status-yellow',
  done: 'status-green',
  complete: 'status-green',
  completed: 'status-green'
};

// Map Notion color names to CSS classes
const NOTION_COLOR_MAP: Record<string, string> = {
  default: 'status-gray',
  gray: 'status-gray',
  brown: 'status-brown',
  orange: 'status-orange',
  yellow: 'status-yellow',
  green: 'status-green',
  blue: 'status-blue',
  purple: 'status-purple',
  pink: 'status-pink',
  red: 'status-red'
};

// Get CSS class from Notion color name
export const getStatusColorClassFromNotionColor = (color?: string | null) => {
  if (!color) return '';
  return NOTION_COLOR_MAP[color.toLowerCase()] ?? '';
};

// Get CSS class from status name (fallback)
export const getStatusColorClass = (value?: string | null) => {
  if (!value) return '';
  const normalized = value.trim().toLowerCase();
  return STATUS_NAME_MAP[normalized] ?? '';
};

// Combined function: prefer Notion color, fallback to status name mapping
export const getStatusColorClassWithFallback = (
  statusName?: string | null,
  notionColor?: string | null
) => {
  // First try Notion color
  if (notionColor) {
    const colorClass = getStatusColorClassFromNotionColor(notionColor);
    if (colorClass) return colorClass;
  }
  // Fallback to status name mapping
  return getStatusColorClass(statusName);
};











