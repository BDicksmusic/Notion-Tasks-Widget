import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const RECURRENCE_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const REMINDER_OPTIONS = [
  { key: 'none', label: 'None' },
  { key: 'dueDate', label: 'On day of event (9:00 AM)' },
  { key: '1dayBefore', label: '1 day before (9:00 AM)' },
  { key: '2daysBefore', label: '2 days before (9:00 AM)' },
  { key: '1weekBefore', label: '1 week before (9:00 AM)' },
] as const;

const REPEAT_OPTIONS = [
  { key: 'none', label: 'None' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekdays', label: 'Every weekday' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'biweekly', label: 'Every 2 weeks' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
] as const;

// Recurrence pattern types for smarter scheduling
type RecurrenceType = 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'custom' | 'everyXDays';

interface RecurrencePattern {
  type: RecurrenceType;
  days?: string[]; // For weekly/custom: specific days
  interval?: number; // For everyXDays: number of days
  dayOfMonth?: number; // For monthly: day of the month
}

interface Props {
  value?: string | null;
  endValue?: string | null;
  allowRange?: boolean;
  allowTime?: boolean;
  onChange(start: string | null, end?: string | null): void;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  ariaLabel?: string;
  // Recurrence props
  recurrence?: string[];
  onRecurrenceChange?: (recurrence: string[] | null) => void;
  // Reminder props
  reminderAt?: string | null;
  onReminderChange?: (reminderAt: string | null) => void;
}

type CalendarCell = {
  date: Date;
  iso: string;
  inMonth: boolean;
};

type PendingRange = {
  start: string | null;
  end: string | null;
};

type TimeState = {
  startEnabled: boolean;
  startValue: string;
  endEnabled: boolean;
  endValue: string;
};

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DEFAULT_START_TIME = '09:00';
const DEFAULT_END_TIME = '17:00';
const TIME_HINT_REGEX = /(\d{1,2}:\d{2})|(\d{1,2}\s*(?:am|pm))|noon|midnight/i;
const RANGE_SPLIT_REGEX = /\s(?:to|through|until)\s|(?:\s[-–—]\s)/i;
const KEYWORD_DATE_OFFSETS: Record<string, number> = {
  today: 0,
  tomorrow: 1,
  yesterday: -1
};
const MONTH_NAME_MAP: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
};

// Parse time segment to hours/minutes object
function parseTimeSegment(segment?: string): { hours: number; minutes: number } | null {
  if (!segment) return null;
  const normalized = segment
    .trim()
    .replace(/^at\s+/i, '')
    .toLowerCase();
  if (!normalized) return null;
  if (normalized === 'noon') {
    return { hours: 12, minutes: 0 };
  }
  if (normalized === 'midnight') {
    return { hours: 0, minutes: 0 };
  }
  const match = normalized.match(
    /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/
  );
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours > 24 ||
    minutes > 59
  ) {
    return null;
  }
  if (meridiem === 'am') {
    if (hours === 12) hours = 0;
  } else if (meridiem === 'pm') {
    if (hours < 12) hours += 12;
  }
  return { hours, minutes };
}

// Parse time from natural text input and return "HH:MM" format
function parseTimeFromText(text: string): string | null {
  if (!text?.trim()) return null;
  
  const result = parseTimeSegment(text);
  if (!result) return null;
  return `${result.hours.toString().padStart(2, '0')}:${result.minutes.toString().padStart(2, '0')}`;
}

const DateField = ({
  value,
  endValue,
  allowRange,
  allowTime,
  onChange,
  disabled,
  className,
  inputClassName,
  placeholder = 'Select date',
  ariaLabel,
  recurrence,
  onRecurrenceChange,
  reminderAt,
  onReminderChange
}: Props) => {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState<Date>(() =>
    deriveVisibleMonth(value, allowRange ? endValue : null)
  );
  const [textValue, setTextValue] = useState(
    formatTextValue(value, allowRange ? endValue : null)
  );
  const [pendingRange, setPendingRange] = useState<PendingRange>({
    start: value ?? null,
    end: allowRange ? endValue ?? null : null
  });
  const [timeState, setTimeState] = useState<TimeState>(() =>
    deriveTimeState(value, allowRange ? endValue : null)
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [submenuPosition, setSubmenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  
  // Secondary panel state for recurrence/reminder
  const [activePanel, setActivePanel] = useState<'none' | 'repeat' | 'reminder'>('none');
  const [repeatType, setRepeatType] = useState<RecurrenceType>(() => 
    deriveRepeatType(recurrence)
  );
  const [everyXDays, setEveryXDays] = useState(2);

  useEffect(() => {
    setTextValue(formatTextValue(value, allowRange ? endValue : null));
    setPendingRange({
      start: value ?? null,
      end: allowRange ? endValue ?? null : null
    });
    setVisibleMonth(deriveVisibleMonth(value, allowRange ? endValue : null));
    setTimeState(deriveTimeState(value, allowRange ? endValue : null));
  }, [value, endValue, allowRange]);


  const updatePopoverPosition = () => {
    const wrapper = wrapperRef.current;
    const popover = popoverRef.current;
    if (!wrapper) return;
    
    const rect = wrapper.getBoundingClientRect();
    const viewportHeight = window.innerHeight || 0;
    const viewportWidth = window.innerWidth || 0;
    const popoverHeight = popover?.offsetHeight ?? 400;
    const popoverWidth = popover?.offsetWidth ?? 240;
    
    // Calculate vertical position
    const spaceBelow = viewportHeight - rect.bottom - 10;
    const spaceAbove = rect.top - 10;
    
    let top: number;
    if (spaceBelow >= popoverHeight || spaceBelow > spaceAbove) {
      // Position below
      top = rect.bottom + 6;
    } else {
      // Position above
      top = rect.top - popoverHeight - 6;
    }
    
    // Keep within viewport vertically
    top = Math.max(10, Math.min(top, viewportHeight - popoverHeight - 10));
    
    // Calculate horizontal position - align to left of input but keep in viewport
    let left = rect.left;
    if (left + popoverWidth > viewportWidth - 10) {
      left = viewportWidth - popoverWidth - 10;
    }
    left = Math.max(10, left);
    
    setPopoverPosition({ top, left });
  };

  const updateSubmenuPosition = (rowElement?: HTMLElement | null) => {
    const popover = popoverRef.current;
    if (!popover) return;
    
    const popoverRect = popover.getBoundingClientRect();
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    const submenuWidth = 220;
    const submenuHeight = 250; // Approximate height
    
    // Position to the right of the popover
    let left = popoverRect.right + 4;
    
    // If not enough space on right, position to the left
    if (left + submenuWidth > viewportWidth - 10) {
      left = popoverRect.left - submenuWidth - 4;
    }
    
    // Align first menu item with the clicked row
    // Offset by submenu padding (4px) + first item padding (8px) to align text
    let top: number;
    if (rowElement) {
      const rowRect = rowElement.getBoundingClientRect();
      // Offset so the first option text aligns with the row
      top = rowRect.top - 4 - 8; // submenu padding + option padding
    } else {
      top = popoverRect.top + popoverRect.height / 2;
    }
    
    // Keep submenu within viewport
    if (top + submenuHeight > viewportHeight - 10) {
      top = viewportHeight - submenuHeight - 10;
    }
    top = Math.max(10, top);
    
    setSubmenuPosition({ top, left: Math.max(10, left) });
  };

  useEffect(() => {
    if (!open) return;
    
    // Initial position calculation
    updatePopoverPosition();
    
    // Recalculate after a frame to get accurate popover dimensions
    // and focus the start date input
    requestAnimationFrame(() => {
      updatePopoverPosition();
      // Focus the start date input when popover opens
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Check if click is on popover, trigger button, wrapper, or any submenu
      const isOnPopover = popoverRef.current?.contains(target) || target.closest('.date-field-popover');
      const isOnWrapper = wrapperRef.current?.contains(target);
      const isOnSubmenu = target.closest('.date-field-submenu');
      
      if (!isOnPopover && !isOnWrapper && !isOnSubmenu) {
        setOpen(false);
        setActivePanel('none');
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (activePanel !== 'none') {
          setActivePanel('none');
        } else {
          setOpen(false);
        }
      }
    };
    const handleScroll = () => {
      updatePopoverPosition();
    };
    const handleResize = () => {
      updatePopoverPosition();
    };
    
    window.addEventListener('mousedown', handlePointer);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);
    
    return () => {
      window.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, activePanel]);

  const calendarCells = useMemo(
    () => buildCalendarCells(visibleMonth),
    [visibleMonth]
  );

  const commitRangeChange = (nextStart: string | null, nextEnd?: string | null) => {
    const normalizedEnd = allowRange ? nextEnd ?? null : null;
    setPendingRange({ start: nextStart, end: normalizedEnd });
    setTextValue(formatTextValue(nextStart, normalizedEnd));
    if (nextStart) {
      const parsed = parseIsoToDate(nextStart);
      if (parsed) {
        setVisibleMonth(parsed);
      }
    }
    onChange(nextStart, allowRange ? normalizedEnd : undefined);
  };

  const handleSelectDate = (iso: string) => {
    // Always update the start date when clicking on calendar
    // End date is only set via the toggle or by typing
    const nextStart = allowTime
      ? applyTimePreference(iso, timeState.startEnabled, timeState.startValue)
      : iso;
    
    // Keep existing end date if we have one, but adjust if needed
    let nextEnd = pendingRange.end;
    if (nextEnd && new Date(nextStart) > new Date(nextEnd)) {
      // If new start is after end, clear end date
      nextEnd = null;
    }
    
    commitRangeChange(nextStart, nextEnd);
    // Don't close the window - let user make more changes
  };

  const handleManualCommit = () => {
    if (!textValue.trim()) {
      handleClear();
      return;
    }
    if (allowRange) {
      const parsed = parseRangeInput(textValue);
      if (parsed.start) {
        setTimeState(deriveTimeState(parsed.start, parsed.end ?? null));
        commitRangeChange(parsed.start, parsed.end ?? null);
      } else {
        setTextValue(formatTextValue(value, allowRange ? endValue : null));
      }
      return;
    }
    const parsed = parseDateInput(textValue);
    if (parsed) {
      setTimeState(deriveTimeState(parsed, null));
      commitRangeChange(parsed, null);
    } else {
      setTextValue(formatTextValue(value, null));
    }
  };

  const handleClear = () => {
    setTimeState({
      startEnabled: false,
      startValue: DEFAULT_START_TIME,
      endEnabled: false,
      endValue: DEFAULT_END_TIME
    });
    commitRangeChange(null, null);
  };

  const toggleStartTime = (enabled: boolean) => {
    setTimeState((prev) => ({ ...prev, startEnabled: enabled }));
    if (!pendingRange.start || !allowTime) return;
    const nextStart = applyTimePreference(
      pendingRange.start,
      enabled,
      timeState.startValue
    );
    commitRangeChange(nextStart, pendingRange.end);
  };

  const toggleEndTime = (enabled: boolean) => {
    setTimeState((prev) => ({ ...prev, endEnabled: enabled }));
    if (!pendingRange.end || !allowRange || !allowTime) return;
    const nextEnd = applyTimePreference(
      pendingRange.end,
      enabled,
      timeState.endValue
    );
    commitRangeChange(pendingRange.start, nextEnd);
  };

  const handleStartTimeChange = (next: string) => {
    const safe = next || DEFAULT_START_TIME;
    setTimeState((prev) => ({ ...prev, startValue: safe }));
    if (!pendingRange.start || !allowTime || !timeState.startEnabled) return;
    const nextStart = applyTimePreference(pendingRange.start, true, safe);
    commitRangeChange(nextStart, pendingRange.end);
  };

  const handleEndTimeChange = (next: string) => {
    const safe = next || DEFAULT_END_TIME;
    setTimeState((prev) => ({ ...prev, endValue: safe }));
    if (!pendingRange.end || !allowRange || !allowTime || !timeState.endEnabled) {
      return;
    }
    const nextEnd = applyTimePreference(pendingRange.end, true, safe);
    commitRangeChange(pendingRange.start, nextEnd);
  };

  const rootClassName = [
    'date-field',
    open ? 'is-open' : '',
    className ?? ''
  ]
    .filter(Boolean)
    .join(' ');

  const hasActiveReminder = reminderAt && new Date(reminderAt) > new Date();
  const hasValue = Boolean(textValue);
  
  // Format reminder tooltip text
  const reminderTooltip = hasActiveReminder 
    ? `Reminder: ${new Date(reminderAt!).toLocaleString(undefined, { 
        month: 'short', 
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })}`
    : undefined;

  // Text input states for natural language parsing
  const [startDateText, setStartDateText] = useState(() => {
    if (!value) return '';
    const date = parseIsoToDate(value);
    return date ? date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' }) : '';
  });
  const [startTimeText, setStartTimeText] = useState(() => {
    if (!value || !hasTimeComponent(value)) return '';
    const date = parseIsoToDate(value);
    return date ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
  });
  const [endDateText, setEndDateText] = useState(() => {
    if (!endValue) return '';
    const date = parseIsoToDate(endValue);
    return date ? date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' }) : '';
  });
  const [endTimeText, setEndTimeText] = useState(() => {
    if (!endValue || !hasTimeComponent(endValue)) return '';
    const date = parseIsoToDate(endValue);
    return date ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
  });

  // Sync text inputs when values change externally
  useEffect(() => {
    if (value) {
      const date = parseIsoToDate(value);
      if (date) {
        setStartDateText(date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' }));
        if (hasTimeComponent(value)) {
          setStartTimeText(date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
        }
      }
    } else {
      setStartDateText('');
      setStartTimeText('');
    }
  }, [value]);

  useEffect(() => {
    if (endValue) {
      const date = parseIsoToDate(endValue);
      if (date) {
        setEndDateText(date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' }));
        if (hasTimeComponent(endValue)) {
          setEndTimeText(date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
        }
      }
    } else {
      setEndDateText('');
      setEndTimeText('');
    }
  }, [endValue]);

  // Parse and commit start date from text
  const commitStartDate = () => {
    if (!startDateText.trim()) return;
    const parsed = parseDateInput(startDateText);
    if (parsed) {
      let nextStart = parsed;
      // If time is enabled and we have a time, apply it
      if (timeState.startEnabled && startTimeText) {
        const timeParsed = parseTimeFromText(startTimeText);
        if (timeParsed) {
          nextStart = applyTimePreference(parsed, true, timeParsed);
        }
      }
      commitRangeChange(nextStart, pendingRange.end);
    }
  };

  // Parse and commit start time from text
  const commitStartTime = () => {
    if (!startTimeText.trim() || !pendingRange.start) return;
    const timeParsed = parseTimeFromText(startTimeText);
    if (timeParsed) {
      const nextStart = applyTimePreference(stripTimeComponent(pendingRange.start), true, timeParsed);
      commitRangeChange(nextStart, pendingRange.end);
    }
  };

  // Parse and commit end date from text
  const commitEndDate = () => {
    if (!endDateText.trim()) return;
    const parsed = parseDateInput(endDateText);
    if (parsed) {
      let nextEnd = parsed;
      // If time is enabled and we have a time, apply it
      if (timeState.endEnabled && endTimeText) {
        const timeParsed = parseTimeFromText(endTimeText);
        if (timeParsed) {
          nextEnd = applyTimePreference(parsed, true, timeParsed);
        }
      }
      commitRangeChange(pendingRange.start, nextEnd);
    }
  };

  // Parse and commit end time from text
  const commitEndTime = () => {
    if (!endTimeText.trim() || !pendingRange.end) return;
    const timeParsed = parseTimeFromText(endTimeText);
    if (timeParsed) {
      const nextEnd = applyTimePreference(stripTimeComponent(pendingRange.end), true, timeParsed);
      commitRangeChange(pendingRange.start, nextEnd);
    }
  };

  // Determine if we should use stacked layout (two rows)
  const useStackedLayout = allowRange && pendingRange.end && allowTime && timeState.startEnabled;

  // Popover content - rendered via portal to escape stacking contexts
  const popoverContent = open ? (
    <div 
      className="date-field-popover" 
      ref={popoverRef}
      style={{
        top: popoverPosition.top,
        left: popoverPosition.left
      }}
      onClick={(e) => e.stopPropagation()}
    >
          {/* Notion-style date inputs at top */}
          <div className={`date-field-inputs-row ${useStackedLayout ? 'stacked' : ''}`}>
            <div className="date-input-group">
              <input
                ref={inputRef}
                type="text"
                value={startDateText}
                onChange={(e) => setStartDateText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitStartDate();
                    e.preventDefault();
                  }
                }}
                onBlur={commitStartDate}
                placeholder="e.g. next Friday, Dec 25"
                className="date-field-date-input"
                autoFocus
              />
              {allowTime && timeState.startEnabled && (
                <input
                  type="text"
                  value={startTimeText}
                  onChange={(e) => setStartTimeText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitStartTime();
                      e.preventDefault();
                    }
                  }}
                  onBlur={commitStartTime}
                  placeholder="e.g. 3pm, noon"
                  className="date-field-time-input"
                />
              )}
            </div>
            
            {allowRange && pendingRange.end && (
              <div className="date-input-group">
                <input
                  type="text"
                  value={endDateText}
                  onChange={(e) => setEndDateText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitEndDate();
                      e.preventDefault();
                    }
                  }}
                  onBlur={commitEndDate}
                  placeholder="e.g. in 2 weeks"
                  className="date-field-date-input"
                />
                {allowTime && timeState.endEnabled && (
                  <input
                    type="text"
                    value={endTimeText}
                    onChange={(e) => setEndTimeText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        commitEndTime();
                        e.preventDefault();
                      }
                    }}
                    onBlur={commitEndTime}
                    placeholder="e.g. 5pm"
                    className="date-field-time-input"
                  />
                )}
              </div>
            )}
          </div>

          {/* Month header with navigation */}
          <header className="date-field-header">
            <p>{formatMonthLabel(visibleMonth)}</p>
            <button
              type="button"
              className="date-field-today-btn"
              onClick={() => setVisibleMonth(new Date())}
            >
              Today
            </button>
            <div className="date-field-nav">
              <button
                type="button"
                onClick={() => setVisibleMonth(addMonths(visibleMonth, -1))}
                aria-label="Previous month"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setVisibleMonth(addMonths(visibleMonth, 1))}
                aria-label="Next month"
              >
                ›
              </button>
            </div>
          </header>

          {/* Calendar grid */}
          <div className="date-field-weekdays">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="date-field-grid">
            {calendarCells.map((cell) => {
              const isSelected =
                pendingRange.start === cell.iso ||
                pendingRange.end === cell.iso;
              const isInRange =
                allowRange &&
                pendingRange.start &&
                pendingRange.end &&
                cell.iso > pendingRange.start &&
                cell.iso < pendingRange.end;
              const isToday = isSameDay(cell.date, new Date());
              return (
                <button
                  key={cell.iso}
                  type="button"
                  className={[
                    'date-field-cell',
                    cell.inMonth ? '' : 'is-muted',
                    isSelected ? 'is-selected' : '',
                    isInRange ? 'is-range' : '',
                    isToday ? 'is-today' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => handleSelectDate(cell.iso)}
                >
                  {cell.date.getDate()}
                </button>
              );
            })}
          </div>

          {/* Options section */}
          <div className="date-field-options">
            {allowRange && (
              <div className="date-field-option-row">
                <span className="option-label">End date</span>
                <button
                  type="button"
                  className={`option-toggle ${pendingRange.end ? 'is-on' : ''}`}
                  onClick={() => {
                    if (pendingRange.end) {
                      // Clear end date
                      setPendingRange(prev => ({ ...prev, end: null }));
                      commitRangeChange(pendingRange.start, null);
                    } else if (pendingRange.start) {
                      // Enable end date - default to same as start
                      const endDate = pendingRange.start;
                      setPendingRange(prev => ({ ...prev, end: endDate }));
                      commitRangeChange(pendingRange.start, endDate);
                    }
                  }}
                >
                  <span className="toggle-track">
                    <span className="toggle-thumb" />
                  </span>
                </button>
              </div>
            )}
            
            {allowTime && (
              <div className="date-field-option-row">
                <span className="option-label">Include time</span>
                <button
                  type="button"
                  className={`option-toggle ${timeState.startEnabled ? 'is-on' : ''}`}
                  onClick={() => {
                    toggleStartTime(!timeState.startEnabled);
                    // Also toggle end time if we have an end date
                    if (pendingRange.end) {
                      toggleEndTime(!timeState.endEnabled);
                    }
                  }}
                >
                  <span className="toggle-track">
                    <span className="toggle-thumb" />
                  </span>
                </button>
              </div>
            )}

            {onRecurrenceChange && (
              <div className="date-field-option-row-wrapper">
                <button
                  type="button"
                  className={`date-field-option-row clickable ${activePanel === 'repeat' ? 'is-active' : ''}`}
                  onClick={(e) => {
                    const newPanel = activePanel === 'repeat' ? 'none' : 'repeat';
                    setActivePanel(newPanel);
                    if (newPanel !== 'none') {
                      requestAnimationFrame(() => updateSubmenuPosition(e.currentTarget));
                    }
                  }}
                >
                  <span className="option-label">Repeat</span>
                  <span className="option-value-text">
                    {recurrence && recurrence.length > 0 
                      ? formatRecurrenceLabel(recurrence)
                      : 'None'}
                    <span className="option-chevron">›</span>
                  </span>
                </button>
                
                {/* Repeat Submenu - rendered via portal */}
                {activePanel === 'repeat' && createPortal(
                  <div 
                    className="date-field-submenu"
                    style={{ top: submenuPosition.top, left: submenuPosition.left }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {REPEAT_OPTIONS.map((opt) => {
                      const isSelected = opt.key === 'none' 
                        ? (!recurrence || recurrence.length === 0)
                        : repeatType === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          className={`submenu-option ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => {
                            if (opt.key === 'none') {
                              onRecurrenceChange(null);
                              setRepeatType('custom');
                            } else if (opt.key === 'daily') {
                              setRepeatType('daily');
                              onRecurrenceChange([...RECURRENCE_WEEKDAYS]);
                            } else if (opt.key === 'weekdays') {
                              setRepeatType('weekdays');
                              onRecurrenceChange(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
                            } else if (opt.key === 'weekly') {
                              setRepeatType('weekly');
                              const todayName = RECURRENCE_WEEKDAYS[new Date().getDay()];
                              onRecurrenceChange([todayName]);
                            } else if (opt.key === 'biweekly') {
                              setRepeatType('biweekly');
                              const todayName = RECURRENCE_WEEKDAYS[new Date().getDay()];
                              onRecurrenceChange([`biweekly:${todayName}`]);
                            } else if (opt.key === 'monthly') {
                              setRepeatType('monthly');
                              const dayOfMonth = new Date().getDate();
                              onRecurrenceChange([`monthly:${dayOfMonth}`]);
                            } else if (opt.key === 'yearly') {
                              setRepeatType('monthly');
                              onRecurrenceChange([`yearly:${new Date().getMonth() + 1}-${new Date().getDate()}`]);
                            }
                            setActivePanel('none');
                          }}
                        >
                          <span className="submenu-label">{opt.label}</span>
                          {isSelected && <span className="submenu-check">✓</span>}
                        </button>
                      );
                    })}
                  </div>,
                  document.body
                )}
              </div>
            )}

            {onReminderChange && (
              <div className="date-field-option-row-wrapper">
                <button
                  type="button"
                  className={`date-field-option-row clickable ${activePanel === 'reminder' ? 'is-active' : ''}`}
                  onClick={(e) => {
                    const newPanel = activePanel === 'reminder' ? 'none' : 'reminder';
                    setActivePanel(newPanel);
                    if (newPanel !== 'none') {
                      requestAnimationFrame(() => updateSubmenuPosition(e.currentTarget));
                    }
                  }}
                >
                  <span className="option-label">Remind</span>
                  <span className="option-value-text">
                    {reminderAt && new Date(reminderAt) > new Date()
                      ? formatReminderLabel(reminderAt)
                      : 'None'}
                    <span className="option-chevron">›</span>
                  </span>
                </button>
                
                {/* Reminder Submenu - rendered via portal */}
                {activePanel === 'reminder' && createPortal(
                  <div 
                    className="date-field-submenu"
                    style={{ top: submenuPosition.top, left: submenuPosition.left }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {REMINDER_OPTIONS.map((opt) => {
                      const isSelected = opt.key === 'none' 
                        ? (!reminderAt || new Date(reminderAt) <= new Date())
                        : false; // We'd need more logic to detect which is selected
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          className={`submenu-option ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => {
                            if (opt.key === 'none') {
                              onReminderChange(null);
                            } else {
                              const reminderTime = calculateReminderTime(opt.key, value);
                              onReminderChange(reminderTime);
                            }
                            setActivePanel('none');
                          }}
                        >
                          <span className="submenu-label">{opt.label}</span>
                          {isSelected && <span className="submenu-check">✓</span>}
                        </button>
                      );
                    })}
                  </div>,
                  document.body
                )}
              </div>
            )}
          </div>

          {/* Clear button */}
          <button type="button" className="date-field-clear-btn" onClick={handleClear}>
            Clear
          </button>
        </div>
      ) : null;

      // Structured date display for foam mode support
      const renderStructuredDate = () => {
        if (!value) {
          return <span className="date-field-placeholder">{placeholder}</span>;
        }
        
        const startDate = parseIsoToDate(value);
        const endDate = endValue ? parseIsoToDate(endValue) : null;
        
        if (!startDate) {
          return <span className="date-field-placeholder">{placeholder}</span>;
        }
        
        const startDateLabel = startDate.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric'
        });
        
        const startHasTime = hasTimeComponent(value);
        const startTimeLabel = startHasTime ? startDate.toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit'
        }) : null;
        
        // Single date (no range)
        if (!endDate || !endValue || endValue === value) {
          return (
            <span className="date-field-structured">
              <span className="date-part">{startDateLabel}</span>
              {startTimeLabel && (
                <span className="time-part">{startTimeLabel}</span>
              )}
            </span>
          );
        }
        
        // Range: check if same day
        const isSameDayRange = isSameDay(startDate, endDate);
        const endHasTime = hasTimeComponent(endValue);
        
        const endDateLabel = endDate.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric'
        });
        
        const endTimeLabel = endHasTime ? endDate.toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit'
        }) : null;
        
        if (isSameDayRange && startHasTime && endHasTime) {
          // Same day with times: "Nov 27" with times stacked below
          return (
            <span className="date-field-structured same-day-range">
              <span className="date-part">{startDateLabel}</span>
              <span className="time-range-part">
                <span className="time-part start">{startTimeLabel}</span>
                <span className="time-separator">–</span>
                <span className="time-part end">{endTimeLabel}</span>
              </span>
            </span>
          );
        }
        
        // Different days range
        return (
          <span className="date-field-structured date-range">
            <span className="range-start">
              <span className="date-part">{startDateLabel}</span>
              {startTimeLabel && <span className="time-part">{startTimeLabel}</span>}
            </span>
            <span className="date-separator">–</span>
            <span className="range-end">
              <span className="date-part">{endDateLabel}</span>
              {endTimeLabel && <span className="time-part">{endTimeLabel}</span>}
            </span>
          </span>
        );
      };

      return (
        <div className={rootClassName} ref={wrapperRef}>
          {/* Clickable date trigger - clean text style */}
          <button
            type="button"
            ref={buttonRef}
            className={`date-field-trigger ${inputClassName ?? ''} ${hasActiveReminder ? 'has-reminder' : ''} ${hasValue ? 'has-value' : ''}`}
            onClick={() => setOpen((prev) => !prev)}
            disabled={disabled}
            aria-label={ariaLabel ?? 'Select date'}
            title={reminderTooltip}
          >
            <span className="date-field-text">{renderStructuredDate()}</span>
          </button>
          
          {popoverContent && createPortal(popoverContent, document.body)}
        </div>
      );
};

const deriveVisibleMonth = (start?: string | null, end?: string | null) => {
  const candidate = parseIsoToDate(start) ?? parseIsoToDate(end);
  return candidate ?? new Date();
};

const formatTextValue = (start?: string | null, end?: string | null) => {
  if (start && end && end !== start) {
    const startDate = parseIsoToDate(start);
    const endDate = parseIsoToDate(end);
    
    // Check if same day - show compact time range format
    if (startDate && endDate && isSameDay(startDate, endDate)) {
      const dateLabel = startDate.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
      });
      
      // If both have times, show "Nov 27 · 12:00 PM - 3:00 PM"
      if (hasTimeComponent(start) && hasTimeComponent(end)) {
        const startTime = startDate.toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit'
        });
        const endTime = endDate.toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit'
        });
        return `${dateLabel} · ${startTime} - ${endTime}`;
      }
      
      // Just one has time
      if (hasTimeComponent(start)) {
        return formatDisplayDate(start);
      }
      return dateLabel;
    }
    
    // Different days - show full range
    return `${formatDisplayDate(start)} – ${formatDisplayDate(end)}`;
  }
  if (start) return formatDisplayDate(start);
  return '';
};

const formatDisplayDate = (iso: string) => {
  const date = parseIsoToDate(iso);
  if (!date) return '';
  const dateLabel = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  });
  if (!hasTimeComponent(iso)) {
    return dateLabel;
  }
  const timeLabel = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });
  return `${dateLabel} · ${timeLabel}`;
};

const formatMonthLabel = (date: Date) =>
  date.toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric'
  });

const addMonths = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
};

const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const buildCalendarCells = (monthDate: Date): CalendarCell[] => {
  const cells: CalendarCell[] = [];
  const firstOfMonth = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth(),
    1
  );
  const startDay = firstOfMonth.getDay();
  const daysInMonth = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth() + 1,
    0
  ).getDate();
  const totalCells = Math.ceil((startDay + daysInMonth) / 7) * 7;

  for (let index = 0; index < totalCells; index += 1) {
    const dayOffset = index - startDay + 1;
    const date = new Date(
      monthDate.getFullYear(),
      monthDate.getMonth(),
      dayOffset
    );
    cells.push({
      date,
      iso: formatDateOnly(date),
      inMonth: date.getMonth() === monthDate.getMonth()
    });
  }
  return cells;
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const parseIsoToDate = (iso?: string | null) => {
  if (!iso) return null;
  if (!iso.includes('T')) {
    const [year, month, day] = iso.split('-').map((part) => Number(part));
    if (
      [year, month, day].some((part) => Number.isNaN(part)) ||
      month < 1 ||
      month > 12
    ) {
      return null;
    }
    return new Date(year, month - 1, day);
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateOnly = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatLocalDateTime = (date: Date) => {
  const datePart = formatDateOnly(date);
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetHours = `${Math.trunc(Math.abs(offsetMinutes) / 60)}`.padStart(2, '0');
  const offsetMins = `${Math.abs(offsetMinutes) % 60}`.padStart(2, '0');
  return `${datePart}T${hours}:${minutes}:00${sign}${offsetHours}:${offsetMins}`;
};

const hasTimeComponent = (iso?: string | null) => Boolean(iso && iso.includes('T'));

const extractTimeInputValue = (iso?: string | null) => {
  if (!iso || !hasTimeComponent(iso)) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
};

const deriveTimeState = (start?: string | null, end?: string | null): TimeState => ({
  startEnabled: hasTimeComponent(start),
  startValue: extractTimeInputValue(start) ?? DEFAULT_START_TIME,
  endEnabled: hasTimeComponent(end),
  endValue: extractTimeInputValue(end) ?? DEFAULT_END_TIME
});

const stripTimeComponent = (iso: string) => iso.split('T')[0];

const applyTimeToIso = (dateOnly: string, timeValue: string) => {
  const [year, month, day] = dateOnly.split('-').map((part) => Number(part));
  const [hours, minutes] = timeValue.split(':').map((part) => Number(part));
  if (
    [year, month, day, hours, minutes].some((part) => Number.isNaN(part)) ||
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes)
  ) {
    return dateOnly;
  }
  const next = new Date(year, month - 1, day, hours, minutes);
  return formatLocalDateTime(next);
};

const applyTimePreference = (iso: string, enabled: boolean, timeValue: string) => {
  if (!enabled) {
    return stripTimeComponent(iso);
  }
  const base = stripTimeComponent(iso);
  return applyTimeToIso(base, timeValue || DEFAULT_START_TIME);
};

const includesTimeHint = (value: string) =>
  TIME_HINT_REGEX.test(value) || value.includes('T');

const parseDateInput = (text: string): string | null => {
  if (!text?.trim()) return null;
  
  const normalized = text.trim().toLowerCase();
  const now = new Date();
  let resultDate: Date | null = null;
  let hasTime = false;
  
  // Extract time component if present (e.g., "at 3pm", "9:30 AM")
  const timeMatch = normalized.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?|noon|midnight/i);
  let hours = 0;
  let minutes = 0;
  
  if (timeMatch) {
    hasTime = true;
    if (timeMatch[0].toLowerCase() === 'noon') {
      hours = 12;
    } else if (timeMatch[0].toLowerCase() === 'midnight') {
      hours = 0;
    } else {
      hours = parseInt(timeMatch[1]);
      minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const meridiem = timeMatch[3]?.toLowerCase();
      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
    }
  }
  
  // Day names
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayAbbrev = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  
  // Check for relative patterns
  if (/^today/.test(normalized)) {
    resultDate = new Date(now);
  } else if (/^tomorrow/.test(normalized)) {
    resultDate = addDays(now, 1);
  } else if (/^yesterday/.test(normalized)) {
    resultDate = addDays(now, -1);
  }
  // "in X days/weeks/months"
  else if (/^in\s+(\d+)\s*(day|days|week|weeks|month|months)/.test(normalized)) {
    const match = normalized.match(/^in\s+(\d+)\s*(day|days|week|weeks|month|months)/);
    if (match) {
      const amount = parseInt(match[1]);
      const unit = match[2];
      if (unit.startsWith('day')) {
        resultDate = addDays(now, amount);
      } else if (unit.startsWith('week')) {
        resultDate = addDays(now, amount * 7);
      } else if (unit.startsWith('month')) {
        resultDate = addMonths(now, amount);
      }
    }
  }
  // "X days/weeks from now"
  else if (/(\d+)\s*(day|days|week|weeks|month|months)\s+from\s+now/.test(normalized)) {
    const match = normalized.match(/(\d+)\s*(day|days|week|weeks|month|months)\s+from\s+now/);
    if (match) {
      const amount = parseInt(match[1]);
      const unit = match[2];
      if (unit.startsWith('day')) {
        resultDate = addDays(now, amount);
      } else if (unit.startsWith('week')) {
        resultDate = addDays(now, amount * 7);
      } else if (unit.startsWith('month')) {
        resultDate = addMonths(now, amount);
      }
    }
  }
  // "next week/month"
  else if (/^next\s+week/.test(normalized)) {
    resultDate = addDays(now, 7);
  } else if (/^next\s+month/.test(normalized)) {
    resultDate = addMonths(now, 1);
  }
  // "next Thursday", "this Friday"
  else if (/^(next|this)\s+(\w+)/.test(normalized)) {
    const match = normalized.match(/^(next|this)\s+(\w+)/);
    if (match) {
      const modifier = match[1];
      const dayName = match[2];
      let targetDay = dayNames.indexOf(dayName);
      if (targetDay === -1) targetDay = dayAbbrev.indexOf(dayName.substring(0, 3));
      
      if (targetDay !== -1) {
        const currentDay = now.getDay();
        let daysUntil = targetDay - currentDay;
        if (daysUntil <= 0) daysUntil += 7;
        if (modifier === 'next' && daysUntil < 7) daysUntil += 7;
        resultDate = addDays(now, daysUntil);
      }
    }
  }
  // Just a day name "Thursday", "Friday"
  else {
    for (let i = 0; i < dayNames.length; i++) {
      if (normalized.startsWith(dayNames[i]) || normalized.startsWith(dayAbbrev[i])) {
        const currentDay = now.getDay();
        let daysUntil = i - currentDay;
        if (daysUntil <= 0) daysUntil += 7; // Always forward
        resultDate = addDays(now, daysUntil);
        break;
      }
    }
  }
  
  // If we got a date from relative parsing
  if (resultDate) {
    if (hasTime) {
      resultDate.setHours(hours, minutes, 0, 0);
      return formatLocalDateTime(resultDate);
    }
    return formatDateOnly(resultDate);
  }
  
  // Try standard date formats
  const normalizedText = normalizeDateText(text);
  if (!normalizedText) return null;
  
  // Numeric formats (12/25, 03/02, etc.)
  const numericMatch = parseNumericDate(normalizedText);
  if (numericMatch) return numericMatch;
  
  // Month name formats (December 25, Dec 7)
  const monthTextMatch = parseMonthTextDate(normalizedText);
  if (monthTextMatch) return monthTextMatch;
  
  // Try native Date parsing as last resort
  const parsed = new Date(normalizedText);
  if (!Number.isNaN(parsed.getTime())) {
    return includesTimeHint(normalizedText)
      ? formatLocalDateTime(parsed)
      : formatDateOnly(parsed);
  }
  
  return null;
};

const parseRangeInput = (text: string) => {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return { start: null, end: null };
  const parts = cleaned.split(RANGE_SPLIT_REGEX);
  if (parts.length >= 2) {
    const start = parseDateInput(parts[0]);
    const end = parseDateInput(parts[1]);
    if (start && end) {
      if (new Date(end) < new Date(start)) {
        return { start: end, end: start };
      }
      return { start, end };
    }
    return { start, end: null };
  }
  return { start: parseDateInput(cleaned), end: null };
};

const normalizeDateText = (text: string) => {
  if (!text) return '';
  return text
    .trim()
    .replace(/[()]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/(\d)\.(\d)/g, '$1/$2')
    .replace(/,+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/([A-Za-z]{3,})(\d{1,2})/g, '$1 $2')
    .replace(/([A-Za-z]{3,})-(\d{1,2})/g, '$1 $2');
};

const parseNumericDate = (input: string) => {
  const match = input.match(
    /^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?(?:\s+(.*))?$/
  );
  if (!match) return null;
  const [, monthStr, dayStr, yearStr, remainder] = match;
  let year = yearStr ? Number(yearStr) : new Date().getFullYear();
  if (Number.isNaN(year)) return null;
  if (yearStr && yearStr.length === 2) {
    year += year >= 70 ? 1900 : 2000;
  }
  const month = Number(monthStr) - 1;
  const day = Number(dayStr);
  if (
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    month < 0 ||
    month > 11 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  return buildDateIso(year, month, day, remainder?.trim());
};

const parseMonthTextDate = (input: string) => {
  const match = input.match(
    /^([A-Za-z]+)\s+(\d{1,2})(?:[,\s]+(\d{2,4}))?(?:\s+(.*))?$/
  );
  if (!match) return null;
  const [, rawMonth, dayStr, yearStr, remainder] = match;
  const monthKey = rawMonth.toLowerCase();
  if (MONTH_NAME_MAP[monthKey] === undefined) return null;
  const month = MONTH_NAME_MAP[monthKey];
  let year = yearStr ? Number(yearStr) : new Date().getFullYear();
  if (Number.isNaN(year)) return null;
  if (yearStr && yearStr.length === 2) {
    year += year >= 70 ? 1900 : 2000;
  }
  const day = Number(dayStr);
  if (Number.isNaN(day) || day < 1 || day > 31) return null;
  return buildDateIso(year, month, day, remainder?.trim());
};

const buildDateIso = (
  year: number,
  month: number,
  day: number,
  timeSegment?: string
) => {
  const date = new Date(year, month, day);
  if (Number.isNaN(date.getTime())) return null;
  if (!timeSegment) {
    return formatDateOnly(date);
  }
  const time = parseTimeSegment(timeSegment);
  if (!time) {
    return formatDateOnly(date);
  }
  date.setHours(time.hours, time.minutes, 0, 0);
  return formatLocalDateTime(date);
};

// Reminder helper functions
const calculateReminderTime = (option: string, dueDate?: string | null): string => {
  // Get due date or default to today
  const dueDateObj = dueDate ? new Date(dueDate) : new Date();
  
  switch (option) {
    case 'dueDate': {
      // On day of event at 9 AM
      const reminder = new Date(dueDateObj);
      reminder.setHours(9, 0, 0, 0);
      return reminder.toISOString();
    }
    case '1dayBefore': {
      const reminder = new Date(dueDateObj);
      reminder.setDate(reminder.getDate() - 1);
      reminder.setHours(9, 0, 0, 0);
      return reminder.toISOString();
    }
    case '2daysBefore': {
      const reminder = new Date(dueDateObj);
      reminder.setDate(reminder.getDate() - 2);
      reminder.setHours(9, 0, 0, 0);
      return reminder.toISOString();
    }
    case '1weekBefore': {
      const reminder = new Date(dueDateObj);
      reminder.setDate(reminder.getDate() - 7);
      reminder.setHours(9, 0, 0, 0);
      return reminder.toISOString();
    }
    default:
      return new Date(dueDateObj.getTime()).toISOString();
  }
};

const formatReminderLabel = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffMs < 0) {
    return 'Passed';
  }
  if (diffHours < 1) {
    const mins = Math.round(diffMs / (1000 * 60));
    return `In ${mins}m`;
  }
  if (diffHours < 24) {
    const hours = Math.round(diffHours);
    if (hours === 1) return 'In 1 hour';
    return `In ${hours}hrs`;
  }
  if (diffDays < 2) {
    return `Tomorrow ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
};

// Recurrence helper functions
const deriveRepeatType = (recurrence?: string[]): RecurrenceType => {
  if (!recurrence || recurrence.length === 0) return 'custom';
  
  // Check for special patterns
  const first = recurrence[0];
  if (first.startsWith('every:')) return 'everyXDays';
  if (first.startsWith('monthly:')) return 'monthly';
  if (first.startsWith('biweekly:')) return 'biweekly';
  
  // Check for preset patterns
  if (recurrence.length === 7) return 'daily';
  if (recurrence.length === 5 && 
      !recurrence.includes('Sat') && 
      !recurrence.includes('Sun')) return 'weekdays';
  if (recurrence.length === 1 && RECURRENCE_WEEKDAYS.includes(recurrence[0] as typeof RECURRENCE_WEEKDAYS[number])) return 'weekly';
  
  return 'custom';
};

const formatRecurrenceLabel = (recurrence?: string[]): string => {
  if (!recurrence || recurrence.length === 0) return 'Repeat';
  
  const first = recurrence[0];
  
  // Handle special patterns
  if (first.startsWith('every:')) {
    const days = parseInt(first.split(':')[1]);
    return `Every ${days} days`;
  }
  if (first.startsWith('monthly:')) {
    const day = parseInt(first.split(':')[1]);
    return `Monthly (${day}${getOrdinalSuffix(day)})`;
  }
  if (first.startsWith('biweekly:')) {
    const day = first.split(':')[1];
    return `Bi-weekly (${day})`;
  }
  
  // Handle preset patterns
  if (recurrence.length === 7) return 'Daily';
  if (recurrence.length === 5 && 
      !recurrence.includes('Sat') && 
      !recurrence.includes('Sun')) return 'Weekdays';
  if (recurrence.length === 1) return `Weekly (${recurrence[0]})`;
  if (recurrence.length === 2) return recurrence.join(', ');
  
  return `${recurrence.length} days`;
};

const getOrdinalSuffix = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
};

export default DateField;

