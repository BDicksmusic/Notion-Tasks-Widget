import { useEffect, useMemo, useRef, useState } from 'react';

const RECURRENCE_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const REMINDER_OPTIONS = [
  { key: '15min', label: 'In 15 minutes', icon: '⏱️' },
  { key: '30min', label: 'In 30 minutes', icon: '⏱️' },
  { key: '1hr', label: 'In 1 hour', icon: '🕐' },
  { key: '3hr', label: 'In 3 hours', icon: '🕒' },
  { key: 'tomorrow9am', label: 'Tomorrow 9 AM', icon: '🌅' },
  { key: 'tomorrow6pm', label: 'Tomorrow 6 PM', icon: '🌆' },
  { key: 'nextWeek', label: 'Next week', icon: '📅' },
  { key: 'dueDate', label: 'At due date/time', icon: '📌' },
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

  useEffect(() => {
    if (!open) return;
    
    // Initial position calculation
    updatePopoverPosition();
    
    // Recalculate after a frame to get accurate popover dimensions
    requestAnimationFrame(() => {
      updatePopoverPosition();
    });
    
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !popoverRef.current?.contains(target) &&
        !inputRef.current?.contains(target) &&
        !buttonRef.current?.contains(target)
      ) {
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
    if (!allowRange) {
      const nextStart = allowTime
        ? applyTimePreference(iso, timeState.startEnabled, timeState.startValue)
        : iso;
      commitRangeChange(nextStart, null);
      setOpen(false);
      return;
    }
    const { start, end } = pendingRange;
    if (!start || end) {
      const nextStart = allowTime
        ? applyTimePreference(iso, timeState.startEnabled, timeState.startValue)
        : iso;
      setPendingRange({ start: nextStart, end: null });
      setTextValue(formatTextValue(nextStart, null));
      return;
    }
    let nextStart = start;
    let nextEnd = allowTime
      ? applyTimePreference(iso, timeState.endEnabled, timeState.endValue)
      : iso;
    let nextTimeState = { ...timeState };

    if (new Date(nextEnd) < new Date(nextStart)) {
      [nextStart, nextEnd] = [nextEnd, nextStart];
      nextTimeState = {
        startEnabled: timeState.endEnabled,
        startValue: timeState.endValue,
        endEnabled: timeState.startEnabled,
        endValue: timeState.startValue
      };
      setTimeState(nextTimeState);
    }
    commitRangeChange(nextStart, nextEnd);
    setOpen(false);
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

  return (
    <div className={rootClassName} ref={wrapperRef}>
      <div className={`date-field-input-wrapper ${inputClassName ?? ''}`}>
        <button
          type="button"
          ref={buttonRef}
          className="date-field-calendar"
          onClick={() => setOpen((prev) => !prev)}
          disabled={disabled}
          aria-label="Open calendar"
        >
          📅
        </button>
        <input
          ref={inputRef}
          type="text"
          value={textValue}
          onChange={(event) => setTextValue(event.target.value)}
          onBlur={handleManualCommit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              handleManualCommit();
              inputRef.current?.blur();
            }
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          disabled={disabled}
          className="date-field-input"
        />
      </div>
      {open && (
        <div 
          className="date-field-popover" 
          ref={popoverRef}
          style={{
            top: popoverPosition.top,
            left: popoverPosition.left
          }}
        >
          <header className="date-field-header">
            <button
              type="button"
              onClick={() => setVisibleMonth(addMonths(visibleMonth, -1))}
              aria-label="Previous month"
            >
              ‹
            </button>
            <p>{formatMonthLabel(visibleMonth)}</p>
            <button
              type="button"
              onClick={() => setVisibleMonth(addMonths(visibleMonth, 1))}
              aria-label="Next month"
            >
              ›
            </button>
          </header>
          <div className="date-field-weekdays">
            {WEEKDAY_LABELS.map((label) => (
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
          {allowTime && (
            <div className="date-field-time">
              <div className="date-field-time-row">
                <label>
                  <input
                    type="checkbox"
                    checked={timeState.startEnabled}
                    onChange={(event) => toggleStartTime(event.target.checked)}
                  />
                  Include time
                </label>
                {timeState.startEnabled && (
                  <input
                    type="time"
                    value={timeState.startValue}
                    onChange={(event) => handleStartTimeChange(event.target.value)}
                  />
                )}
              </div>
              {allowRange && (
                <div className="date-field-time-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={timeState.endEnabled}
                      onChange={(event) => toggleEndTime(event.target.checked)}
                    />
                    End time
                  </label>
                  {timeState.endEnabled && (
                    <input
                      type="time"
                      value={timeState.endValue}
                      onChange={(event) => handleEndTimeChange(event.target.value)}
                    />
                  )}
                </div>
              )}
            </div>
          )}
          
          {/* Action buttons bar */}
          <div className="date-field-actions">
            {onRecurrenceChange && (
              <button
                type="button"
                className={`date-field-action-btn ${recurrence && recurrence.length > 0 ? 'is-active' : ''}`}
                onClick={() => setActivePanel(activePanel === 'repeat' ? 'none' : 'repeat')}
              >
                <span className="action-icon">🔄</span>
                <span className="action-label">
                  {recurrence && recurrence.length > 0 
                    ? formatRecurrenceLabel(recurrence)
                    : 'Repeat'}
                </span>
                <span className="action-chevron">{activePanel === 'repeat' ? '▾' : '▸'}</span>
              </button>
            )}
            {onReminderChange && (
              <button
                type="button"
                className={`date-field-action-btn ${reminderAt && new Date(reminderAt) > new Date() ? 'is-active' : ''}`}
                onClick={() => setActivePanel(activePanel === 'reminder' ? 'none' : 'reminder')}
              >
                <span className="action-icon">🔔</span>
                <span className="action-label">
                  {reminderAt && new Date(reminderAt) > new Date()
                    ? formatReminderLabel(reminderAt)
                    : 'Remind me'}
                </span>
                <span className="action-chevron">{activePanel === 'reminder' ? '▾' : '▸'}</span>
              </button>
            )}
            <button type="button" className="date-field-clear-btn" onClick={handleClear}>
              Clear
            </button>
          </div>

          {/* Repeat Panel */}
          {activePanel === 'repeat' && onRecurrenceChange && (
            <div className="date-field-panel repeat-panel">
              <div className="panel-header">
                <span>Repeat Schedule</span>
                <button type="button" className="panel-close" onClick={() => setActivePanel('none')}>✕</button>
              </div>
              
              {/* Preset options */}
              <div className="repeat-presets">
                <button
                  type="button"
                  className={`repeat-preset ${repeatType === 'daily' ? 'is-selected' : ''}`}
                  onClick={() => {
                    setRepeatType('daily');
                    onRecurrenceChange([...RECURRENCE_WEEKDAYS]);
                  }}
                >
                  <span className="preset-icon">📅</span>
                  <span>Daily</span>
                </button>
                <button
                  type="button"
                  className={`repeat-preset ${repeatType === 'weekdays' ? 'is-selected' : ''}`}
                  onClick={() => {
                    setRepeatType('weekdays');
                    onRecurrenceChange(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
                  }}
                >
                  <span className="preset-icon">💼</span>
                  <span>Weekdays</span>
                </button>
                <button
                  type="button"
                  className={`repeat-preset ${repeatType === 'weekly' ? 'is-selected' : ''}`}
                  onClick={() => {
                    setRepeatType('weekly');
                    const todayName = RECURRENCE_WEEKDAYS[new Date().getDay()];
                    onRecurrenceChange([todayName]);
                  }}
                >
                  <span className="preset-icon">🗓️</span>
                  <span>Weekly</span>
                </button>
                <button
                  type="button"
                  className={`repeat-preset ${repeatType === 'biweekly' ? 'is-selected' : ''}`}
                  onClick={() => {
                    setRepeatType('biweekly');
                    const todayName = RECURRENCE_WEEKDAYS[new Date().getDay()];
                    onRecurrenceChange([`biweekly:${todayName}`]);
                  }}
                >
                  <span className="preset-icon">📆</span>
                  <span>Bi-weekly</span>
                </button>
                <button
                  type="button"
                  className={`repeat-preset ${repeatType === 'monthly' ? 'is-selected' : ''}`}
                  onClick={() => {
                    setRepeatType('monthly');
                    const dayOfMonth = new Date().getDate();
                    onRecurrenceChange([`monthly:${dayOfMonth}`]);
                  }}
                >
                  <span className="preset-icon">📅</span>
                  <span>Monthly</span>
                </button>
                <button
                  type="button"
                  className={`repeat-preset ${repeatType === 'everyXDays' ? 'is-selected' : ''}`}
                  onClick={() => {
                    setRepeatType('everyXDays');
                    onRecurrenceChange([`every:${everyXDays}`]);
                  }}
                >
                  <span className="preset-icon">🔢</span>
                  <span>Every X days</span>
                </button>
              </div>

              {/* Every X days input */}
              {repeatType === 'everyXDays' && (
                <div className="repeat-interval">
                  <span>Every</span>
                  <input
                    type="number"
                    min="2"
                    max="365"
                    value={everyXDays}
                    onChange={(e) => {
                      const val = Math.max(2, Math.min(365, parseInt(e.target.value) || 2));
                      setEveryXDays(val);
                      onRecurrenceChange([`every:${val}`]);
                    }}
                    className="interval-input"
                  />
                  <span>days</span>
                </div>
              )}

              {/* Custom weekday picker */}
              {(repeatType === 'weekly' || repeatType === 'custom') && (
                <div className="repeat-custom">
                  <div className="custom-label">Select days:</div>
                  <div className="weekday-picker">
                    {RECURRENCE_WEEKDAYS.map((day) => {
                      const isSelected = recurrence?.includes(day) ?? false;
                      return (
                        <button
                          key={day}
                          type="button"
                          className={`weekday-btn ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => {
                            setRepeatType('custom');
                            const current = recurrence?.filter(d => !d.includes(':')) ?? [];
                            const next = isSelected
                              ? current.filter((d) => d !== day)
                              : [...current, day];
                            onRecurrenceChange(next.length > 0 ? next : null);
                          }}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Clear button */}
              {recurrence && recurrence.length > 0 && (
                <button
                  type="button"
                  className="repeat-clear"
                  onClick={() => {
                    setRepeatType('custom');
                    onRecurrenceChange(null);
                  }}
                >
                  <span>❌</span>
                  <span>Remove repeat</span>
                </button>
              )}
            </div>
          )}

          {/* Reminder Panel */}
          {activePanel === 'reminder' && onReminderChange && (
            <div className="date-field-panel reminder-panel">
              <div className="panel-header">
                <span>🔔 Set Reminder</span>
                <button type="button" className="panel-close" onClick={() => setActivePanel('none')}>✕</button>
              </div>
              
              <div className="reminder-options">
                {REMINDER_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    className="reminder-option"
                    onClick={() => {
                      const reminderTime = calculateReminderTime(opt.key, value);
                      onReminderChange(reminderTime);
                      setActivePanel('none');
                    }}
                  >
                    <span className="reminder-icon">{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>

              {reminderAt && new Date(reminderAt) > new Date() && (
                <button
                  type="button"
                  className="reminder-clear"
                  onClick={() => {
                    onReminderChange(null);
                    setActivePanel('none');
                  }}
                >
                  <span>❌</span>
                  <span>Remove reminder</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
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
    month: 'long',
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

const parseDateInput = (text: string) => {
  const normalized = normalizeDateText(text);
  if (!normalized) return null;
  const keyword = normalized.toLowerCase();
  if (KEYWORD_DATE_OFFSETS[keyword] !== undefined) {
    const offset = KEYWORD_DATE_OFFSETS[keyword];
    return formatDateOnly(addDays(new Date(), offset));
  }

  const numericMatch = parseNumericDate(normalized);
  if (numericMatch) return numericMatch;

  const monthTextMatch = parseMonthTextDate(normalized);
  if (monthTextMatch) return monthTextMatch;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return includesTimeHint(normalized)
    ? formatLocalDateTime(parsed)
    : formatDateOnly(parsed);
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

const parseTimeSegment = (segment?: string) => {
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
};

// Reminder helper functions
const calculateReminderTime = (option: string, dueDate?: string | null): string => {
  const now = new Date();
  switch (option) {
    case '15min':
      return new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    case '30min':
      return new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    case '1hr':
      return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    case '3hr':
      return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
    case 'tomorrow9am': {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      return tomorrow.toISOString();
    }
    case 'tomorrow6pm': {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(18, 0, 0, 0);
      return tomorrow.toISOString();
    }
    case 'nextWeek': {
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + 7);
      nextWeek.setHours(9, 0, 0, 0);
      return nextWeek.toISOString();
    }
    case 'dueDate': {
      // Use the task's due date if available, otherwise default to 1 hour from now
      if (dueDate) {
        return dueDate;
      }
      return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    }
    default:
      return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
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

