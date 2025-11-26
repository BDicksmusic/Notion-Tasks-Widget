/**
 * Utility functions for recurring task logic
 */

// Map weekday abbreviations to their day indices (0 = Sunday, 6 = Saturday)
const WEEKDAY_MAP: Record<string, number> = {
  'Sun': 0,
  'Mon': 1,
  'Tue': 2,
  'Wed': 3,
  'Thu': 4,
  'Fri': 5,
  'Sat': 6
};

// Full weekday names for display
export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Calculate the next occurrence date based on a recurrence pattern.
 * 
 * @param currentDate - The current due date (or today if none)
 * @param recurrence - Array of weekday abbreviations (e.g., ['Mon', 'Wed', 'Fri'])
 * @returns ISO date string for the next occurrence, or null if no valid recurrence
 */
export function calculateNextOccurrence(
  currentDate: string | null | undefined,
  recurrence: string[]
): string | null {
  if (!recurrence || recurrence.length === 0) {
    return null;
  }

  // Convert recurrence days to day indices
  const targetDays = recurrence
    .map(day => WEEKDAY_MAP[day])
    .filter(dayIndex => dayIndex !== undefined)
    .sort((a, b) => a - b);

  if (targetDays.length === 0) {
    return null;
  }

  // Start from current date or today
  const startDate = currentDate ? new Date(currentDate) : new Date();
  
  // If the current date is invalid, use today
  if (isNaN(startDate.getTime())) {
    startDate.setTime(Date.now());
  }

  // Set to start of day to avoid time zone issues
  startDate.setHours(12, 0, 0, 0);

  // Move to tomorrow to find the NEXT occurrence (not current day)
  const searchDate = new Date(startDate);
  searchDate.setDate(searchDate.getDate() + 1);

  // Search up to 8 days ahead (covers full week plus buffer)
  for (let i = 0; i < 8; i++) {
    const dayOfWeek = searchDate.getDay();
    
    if (targetDays.includes(dayOfWeek)) {
      // Found a matching day - return as ISO date string (date only, no time)
      const year = searchDate.getFullYear();
      const month = String(searchDate.getMonth() + 1).padStart(2, '0');
      const day = String(searchDate.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    
    // Move to next day
    searchDate.setDate(searchDate.getDate() + 1);
  }

  // Fallback: shouldn't happen if recurrence has valid days
  return null;
}

/**
 * Check if a task is a recurring task
 */
export function isRecurringTask(recurrence: string[] | undefined): boolean {
  return Boolean(recurrence && recurrence.length > 0);
}

/**
 * Get a human-readable label for a recurrence pattern
 */
export function getRecurrenceLabel(recurrence: string[] | undefined): string {
  if (!recurrence || recurrence.length === 0) {
    return 'Not recurring';
  }

  // Check for common patterns
  const days = new Set(recurrence);
  
  // Daily (all 7 days)
  if (days.size === 7) {
    return 'Daily';
  }
  
  // Weekdays (Mon-Fri)
  if (
    days.size === 5 &&
    days.has('Mon') &&
    days.has('Tue') &&
    days.has('Wed') &&
    days.has('Thu') &&
    days.has('Fri') &&
    !days.has('Sat') &&
    !days.has('Sun')
  ) {
    return 'Weekdays';
  }
  
  // Weekends (Sat-Sun)
  if (
    days.size === 2 &&
    days.has('Sat') &&
    days.has('Sun')
  ) {
    return 'Weekends';
  }
  
  // Single day = Weekly on that day
  if (days.size === 1) {
    const day = recurrence[0];
    return `Weekly on ${day}`;
  }
  
  // Custom pattern - list the days
  return recurrence.join(', ');
}

/**
 * Parse a recurrence preset into weekday array
 */
export function parseRecurrencePreset(preset: string): string[] {
  switch (preset.toLowerCase()) {
    case 'daily':
      return [...WEEKDAY_NAMES];
    case 'weekdays':
      return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    case 'weekends':
      return ['Sat', 'Sun'];
    case 'weekly': {
      // Get current day of week
      const today = new Date();
      return [WEEKDAY_NAMES[today.getDay()]];
    }
    default:
      return [];
  }
}




