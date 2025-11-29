import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TaskStatusOption } from '@shared/types';
import { STATUS_FILTERS, type StatusFilterValue } from '@shared/statusFilters';

// Filter types that can be shown/hidden
export type FilterType = 'date' | 'deadline' | 'status' | 'priority' | 'project' | 'area';

// Extended day filter type
export type DayFilterValue = 'all' | 'today' | 'tomorrow' | 'week' | 'overdue' | 'has-date' | 'no-date';

// Filter condition types
type FilterCondition = 'is' | 'is-not' | 'contains' | 'does-not-contain';

interface FilterPillsToolbarProps {
  dayFilter: DayFilterValue;
  deadlineFilter: 'all' | 'hard' | 'soft';
  statusFilter: StatusFilterValue;
  matrixFilter: 'all' | 'do-now' | 'deep-work' | 'delegate' | 'trash';
  onDayFilterChange: (value: DayFilterValue) => void;
  onDeadlineFilterChange: (value: 'all' | 'hard' | 'soft') => void;
  onStatusFilterChange: (value: StatusFilterValue) => void;
  onMatrixFilterChange: (value: 'all' | 'do-now' | 'deep-work' | 'delegate' | 'trash') => void;
  visibleFilters?: FilterType[];
  statusOptions?: TaskStatusOption[];
  sortCount?: number;
  ruleCount?: number;
  onSortClick?: () => void;
  onRulesClick?: () => void;
  onAddFilter?: () => void;
}

// Chevron icon
const ChevronIcon = ({ className }: { className?: string }) => (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className={className} style={{ opacity: 0.5 }}>
    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Condition dropdown component - Notion style
const ConditionDropdown = ({
  condition,
  onConditionChange,
  conditions = ['is', 'is-not']
}: {
  condition: FilterCondition;
  onConditionChange: (condition: FilterCondition) => void;
  conditions?: FilterCondition[];
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  const conditionLabels: Record<FilterCondition, string> = {
    'is': 'is',
    'is-not': 'is not',
    'contains': 'contains',
    'does-not-contain': 'does not contain'
  };

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 2, left: rect.left });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!triggerRef.current?.contains(e.target as Node) && 
          !menuRef.current?.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="condition-dropdown">
      <button
        ref={triggerRef}
        type="button"
        className="condition-dropdown-trigger"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{conditionLabels[condition]}</span>
        <ChevronIcon />
      </button>
      {isOpen && createPortal(
        <div 
          ref={menuRef}
          className="condition-dropdown-menu"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {conditions.map(c => (
            <button
              key={c}
              type="button"
              className={`condition-dropdown-option ${condition === c ? 'is-active' : ''}`}
              onClick={() => { onConditionChange(c); setIsOpen(false); }}
            >
              {conditionLabels[c]}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};

// Filter pill with condition dropdown - Notion style
const NotionFilterPill = ({
  icon,
  label,
  condition,
  onConditionChange,
  conditions,
  options,
  selectedValues,
  onSelectionChange,
  searchPlaceholder = 'Search...',
  isOpen,
  onToggle
}: {
  icon?: React.ReactNode;
  label: string;
  condition: FilterCondition;
  onConditionChange: (condition: FilterCondition) => void;
  conditions?: FilterCondition[];
  options: { value: string; label: string; icon?: React.ReactNode; color?: string }[];
  selectedValues: string[];
  onSelectionChange: (values: string[]) => void;
  searchPlaceholder?: string;
  isOpen: boolean;
  onToggle: () => void;
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  const conditionLabels: Record<FilterCondition, string> = {
    'is': 'is',
    'is-not': 'is not',
    'contains': 'contains',
    'does-not-contain': 'does not contain'
  };

  // Filter options by search
  const filteredOptions = options.filter(opt => 
    opt.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 280;
      const menuHeight = 400;
      const padding = 8;
      
      let top = rect.bottom + 4;
      let left = rect.left;
      
      if (left + menuWidth > window.innerWidth - padding) {
        left = window.innerWidth - menuWidth - padding;
      }
      if (left < padding) left = padding;
      if (top + menuHeight > window.innerHeight - padding) {
        top = rect.top - menuHeight - 4;
        if (top < padding) top = padding;
      }
      
      setMenuPos({ top, left });
      // Focus search input when opening
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  const toggleOption = (value: string) => {
    if (selectedValues.includes(value)) {
      onSelectionChange(selectedValues.filter(v => v !== value));
    } else {
      onSelectionChange([...selectedValues, value]);
    }
  };

  const displayValue = selectedValues.length > 0
    ? options.filter(o => selectedValues.includes(o.value)).map(o => o.label).join(', ')
    : '';

  return (
    <div className={`notion-filter-pill ${isOpen ? 'is-open' : ''} ${selectedValues.length > 0 ? 'has-value' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="notion-filter-pill-trigger"
        onClick={onToggle}
      >
        {icon && <span className="filter-pill-icon">{icon}</span>}
        <span className="filter-pill-label">{label}</span>
        <span className="filter-pill-condition">{conditionLabels[condition]}</span>
        {displayValue && (
          <>
            <span className="filter-pill-separator">:</span>
            <span className="filter-pill-value">{displayValue}</span>
          </>
        )}
        <ChevronIcon />
      </button>

      {isOpen && createPortal(
        <div 
          ref={menuRef}
          className="notion-filter-menu"
          style={{ top: menuPos.top, left: menuPos.left }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header with condition dropdown */}
          <div className="notion-filter-menu-header">
            <span className="filter-menu-field-name">{label}</span>
            <ConditionDropdown
              condition={condition}
              onConditionChange={onConditionChange}
              conditions={conditions}
            />
            <button type="button" className="filter-menu-more">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
              </svg>
            </button>
          </div>

          {/* Search input */}
          <div className="notion-filter-search">
            <input
              ref={searchInputRef}
              type="text"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="notion-filter-search-input"
            />
          </div>

          {/* Options list with checkboxes */}
          <div className="notion-filter-options">
            <div className="notion-filter-options-hint">Select one or more options</div>
            {filteredOptions.map(option => (
              <button
                key={option.value}
                type="button"
                className={`notion-filter-option ${selectedValues.includes(option.value) ? 'is-selected' : ''}`}
                onClick={() => toggleOption(option.value)}
              >
                <span className={`option-checkbox ${selectedValues.includes(option.value) ? 'is-checked' : ''}`}>
                  {selectedValues.includes(option.value) && (
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M6.5 12.5L2 8l1.5-1.5L6.5 9.5 12.5 3.5 14 5z"/>
                    </svg>
                  )}
                </span>
                {option.icon && <span className="option-icon">{option.icon}</span>}
                {option.color && <span className="option-color" style={{ background: option.color }} />}
                <span className="option-label">{option.label}</span>
              </button>
            ))}
          </div>

          {/* Clear selection */}
          {selectedValues.length > 0 && (
            <div className="notion-filter-footer">
              <button
                type="button"
                className="notion-filter-clear"
                onClick={() => onSelectionChange([])}
              >
                Clear selection
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

// Simple filter pill dropdown for date/deadline
const SimpleFilterPill = ({
  icon,
  label,
  displayValue,
  isOpen,
  onToggle,
  hasValue,
  children
}: {
  icon?: React.ReactNode;
  label: string;
  displayValue: string;
  isOpen: boolean;
  onToggle: () => void;
  hasValue: boolean;
  children: React.ReactNode;
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 220;
      const menuHeight = 320;
      const padding = 8;
      
      let top = rect.bottom + 4;
      let left = rect.left;
      
      if (left + menuWidth > window.innerWidth - padding) {
        left = window.innerWidth - menuWidth - padding;
      }
      if (left < padding) left = padding;
      if (top + menuHeight > window.innerHeight - padding) {
        top = rect.top - menuHeight - 4;
        if (top < padding) top = padding;
      }
      
      setMenuPos({ top, left });
    }
  }, [isOpen]);

  return (
    <div className={`notion-filter-pill ${isOpen ? 'is-open' : ''} ${hasValue ? 'has-value' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="notion-filter-pill-trigger"
        onClick={onToggle}
      >
        {icon && <span className="filter-pill-icon">{icon}</span>}
        <span className="filter-pill-label">{label}</span>
        {hasValue && (
          <>
            <span className="filter-pill-separator">:</span>
            <span className="filter-pill-value">{displayValue}</span>
          </>
        )}
        <ChevronIcon />
      </button>

      {isOpen && createPortal(
        <div 
          ref={menuRef}
          className="notion-filter-menu simple"
          style={{ top: menuPos.top, left: menuPos.left }}
          onClick={e => e.stopPropagation()}
        >
          {children}
        </div>,
        document.body
      )}
    </div>
  );
};

export const FilterPillsToolbar = ({
  dayFilter,
  deadlineFilter,
  statusFilter,
  matrixFilter,
  onDayFilterChange,
  onDeadlineFilterChange,
  onStatusFilterChange,
  onMatrixFilterChange,
  visibleFilters = ['date', 'deadline', 'status', 'priority'],
  statusOptions = [],
  sortCount = 0,
  ruleCount = 0,
  onSortClick,
  onRulesClick,
  onAddFilter
}: FilterPillsToolbarProps) => {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [statusCondition, setStatusCondition] = useState<FilterCondition>('is');
  const [priorityCondition, setPriorityCondition] = useState<FilterCondition>('is');
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const isInToolbar = toolbarRef.current?.contains(e.target as Node);
      const isInMenu = (e.target as Element)?.closest('.notion-filter-menu, .condition-dropdown-menu');
      if (!isInToolbar && !isInMenu) {
        setOpenDropdown(null);
      }
    };
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openDropdown) {
        setOpenDropdown(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openDropdown]);

  const toggleDropdown = (id: string) => {
    setOpenDropdown(openDropdown === id ? null : id);
  };

  // Display values
  const getDateDisplayValue = () => {
    switch (dayFilter) {
      case 'today': return 'Today';
      case 'tomorrow': return 'Tomorrow';
      case 'week': return 'This week';
      case 'overdue': return 'Overdue';
      case 'has-date': return 'Has a date';
      case 'no-date': return 'No date';
      default: return '';
    }
  };

  const getDeadlineDisplayValue = () => {
    switch (deadlineFilter) {
      case 'hard': return 'Hard only';
      case 'soft': return 'Soft only';
      default: return '';
    }
  };

  // Status options
  const statusCheckboxOptions = STATUS_FILTERS.filter(o => o.value !== 'all').map(opt => ({
    value: opt.value,
    label: opt.label,
    icon: opt.emoji
  }));

  // Priority options
  const priorityOptions = [
    { value: 'do-now', label: 'Do Now', color: 'hsl(139, 21%, 38%)' },
    { value: 'deep-work', label: 'Deep Work', color: 'hsl(214, 35%, 44%)' },
    { value: 'delegate', label: 'Delegate', color: 'hsl(43, 64%, 31%)' },
    { value: 'trash', label: 'Eliminate', color: 'hsl(26, 44%, 39%)' }
  ];

  // Calendar icon
  const CalendarIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );

  // Clock icon
  const ClockIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );

  // Circle icon
  const CircleIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
      <circle cx="12" cy="12" r="10"/>
    </svg>
  );

  // Priority icon
  const PriorityIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  );

  return (
    <div className="filter-pills-toolbar" ref={toolbarRef}>
      {/* Sort indicator */}
      {sortCount > 0 && (
        <button 
          type="button" 
          className="filter-toolbar-chip"
          onClick={onSortClick}
        >
          <span className="chip-label">{sortCount} sort{sortCount !== 1 ? 's' : ''}</span>
        </button>
      )}

      {/* Rules indicator */}
      {ruleCount > 0 && (
        <button 
          type="button" 
          className="filter-toolbar-chip"
          onClick={onRulesClick}
        >
          <span className="chip-label">{ruleCount} rule{ruleCount !== 1 ? 's' : ''}</span>
        </button>
      )}

      {/* Date filter */}
      {visibleFilters.includes('date') && (
        <SimpleFilterPill
          icon={<CalendarIcon />}
          label="Date"
          displayValue={getDateDisplayValue()}
          isOpen={openDropdown === 'date'}
          onToggle={() => toggleDropdown('date')}
          hasValue={dayFilter !== 'all'}
        >
          <div className="filter-menu-section">
            <div className="filter-menu-label">Quick filters</div>
            <button type="button" className={`filter-menu-option ${dayFilter === 'today' ? 'is-active' : ''}`} onClick={() => { onDayFilterChange('today'); setOpenDropdown(null); }}>Today</button>
            <button type="button" className={`filter-menu-option ${dayFilter === 'tomorrow' ? 'is-active' : ''}`} onClick={() => { onDayFilterChange('tomorrow'); setOpenDropdown(null); }}>Tomorrow</button>
            <button type="button" className={`filter-menu-option ${dayFilter === 'week' ? 'is-active' : ''}`} onClick={() => { onDayFilterChange('week'); setOpenDropdown(null); }}>This week</button>
            <button type="button" className={`filter-menu-option ${dayFilter === 'overdue' ? 'is-active' : ''}`} onClick={() => { onDayFilterChange('overdue'); setOpenDropdown(null); }}>Overdue</button>
            <div className="filter-menu-divider" />
            <button type="button" className={`filter-menu-option ${dayFilter === 'has-date' ? 'is-active' : ''}`} onClick={() => { onDayFilterChange('has-date'); setOpenDropdown(null); }}>Has a date</button>
            <button type="button" className={`filter-menu-option ${dayFilter === 'no-date' ? 'is-active' : ''}`} onClick={() => { onDayFilterChange('no-date'); setOpenDropdown(null); }}>No date</button>
            {dayFilter !== 'all' && (
              <>
                <div className="filter-menu-divider" />
                <button type="button" className="filter-menu-clear" onClick={() => { onDayFilterChange('all'); setOpenDropdown(null); }}>Clear selection</button>
              </>
            )}
          </div>
        </SimpleFilterPill>
      )}

      {/* Deadline filter */}
      {visibleFilters.includes('deadline') && (
        <SimpleFilterPill
          icon={<ClockIcon />}
          label="Hard Deadline?"
          displayValue={getDeadlineDisplayValue()}
          isOpen={openDropdown === 'deadline'}
          onToggle={() => toggleDropdown('deadline')}
          hasValue={deadlineFilter !== 'all'}
        >
          <div className="filter-menu-section">
            <button type="button" className={`filter-menu-option ${deadlineFilter === 'hard' ? 'is-active' : ''}`} onClick={() => { onDeadlineFilterChange('hard'); setOpenDropdown(null); }}>Hard only</button>
            <button type="button" className={`filter-menu-option ${deadlineFilter === 'soft' ? 'is-active' : ''}`} onClick={() => { onDeadlineFilterChange('soft'); setOpenDropdown(null); }}>Soft only</button>
            {deadlineFilter !== 'all' && (
              <>
                <div className="filter-menu-divider" />
                <button type="button" className="filter-menu-clear" onClick={() => { onDeadlineFilterChange('all'); setOpenDropdown(null); }}>Clear selection</button>
              </>
            )}
          </div>
        </SimpleFilterPill>
      )}

      {/* Status filter - Notion style with condition dropdown */}
      {visibleFilters.includes('status') && (
        <NotionFilterPill
          icon={<CircleIcon />}
          label="Status"
          condition={statusCondition}
          onConditionChange={setStatusCondition}
          conditions={['is', 'is-not']}
          options={statusCheckboxOptions}
          selectedValues={statusFilter !== 'all' ? [statusFilter] : []}
          onSelectionChange={(values) => {
            if (values.length === 0) {
              onStatusFilterChange('all');
            } else {
              onStatusFilterChange(values[values.length - 1] as StatusFilterValue);
            }
          }}
          searchPlaceholder="Search statuses..."
          isOpen={openDropdown === 'status'}
          onToggle={() => toggleDropdown('status')}
        />
      )}

      {/* Priority filter - Notion style with condition dropdown */}
      {visibleFilters.includes('priority') && (
        <NotionFilterPill
          icon={<PriorityIcon />}
          label="Priority"
          condition={priorityCondition}
          onConditionChange={setPriorityCondition}
          conditions={['is', 'is-not']}
          options={priorityOptions}
          selectedValues={matrixFilter !== 'all' ? [matrixFilter] : []}
          onSelectionChange={(values) => {
            if (values.length === 0) {
              onMatrixFilterChange('all');
            } else {
              onMatrixFilterChange(values[values.length - 1] as any);
            }
          }}
          searchPlaceholder="Search priorities..."
          isOpen={openDropdown === 'priority'}
          onToggle={() => toggleDropdown('priority')}
        />
      )}

      {/* Add filter button */}
      {onAddFilter && (
        <button 
          type="button" 
          className="filter-add-btn"
          onClick={onAddFilter}
        >
          + Filter
        </button>
      )}
    </div>
  );
};

export default FilterPillsToolbar;
