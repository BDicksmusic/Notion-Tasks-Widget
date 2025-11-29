import { useState } from 'react';

type FilterLayout = 'collapsible' | 'horizontal';

interface FilterOption {
  id: string;
  label: string;
  icon?: string;
}

interface FilterBarProps {
  // Date filter
  dateFilter: string;
  dateOptions: FilterOption[];
  onDateChange: (value: string) => void;
  
  // Deadline filter
  deadlineFilter: string;
  deadlineOptions: FilterOption[];
  onDeadlineChange: (value: string) => void;
  
  // Status filter
  statusFilter: string;
  statusOptions: FilterOption[];
  onStatusChange: (value: string) => void;
  
  // Priority/Matrix filter
  priorityFilter: string;
  priorityOptions: FilterOption[];
  onPriorityChange: (value: string) => void;
  
  // Layout preference
  layout?: FilterLayout;
  onLayoutChange?: (layout: FilterLayout) => void;
  
  // Task count
  taskCount?: number;
  
  // Summary text
  filterSummary?: string;
}

// Collapsible section component
const FilterSection = ({
  label,
  icon,
  isExpanded,
  onToggle,
  children,
  activeLabel
}: {
  label: string;
  icon?: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  activeLabel?: string;
}) => (
  <div className={`filter-section ${isExpanded ? 'is-expanded' : ''}`}>
    <button 
      type="button" 
      className="filter-section-header"
      onClick={onToggle}
    >
      <span className="filter-section-icon">{icon}</span>
      <span className="filter-section-label">{label}</span>
      {!isExpanded && activeLabel && (
        <span className="filter-section-active">{activeLabel}</span>
      )}
      <span className="filter-section-chevron">{isExpanded ? '▾' : '▸'}</span>
    </button>
    {isExpanded && (
      <div className="filter-section-content">
        {children}
      </div>
    )}
  </div>
);

// Pill toggle group component
const PillGroup = ({
  options,
  value,
  onChange,
  showAllButton = true
}: {
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
  showAllButton?: boolean;
}) => (
  <div className="filter-pill-group">
    {showAllButton && (
      <button
        type="button"
        className={`filter-pill ${value === 'all' || value === '' ? 'is-active' : ''}`}
        onClick={() => onChange('all')}
      >
        All
      </button>
    )}
    {options.map((option) => (
      <button
        key={option.id}
        type="button"
        className={`filter-pill ${value === option.id ? 'is-active' : ''}`}
        onClick={() => onChange(option.id)}
      >
        {option.icon && <span className="filter-pill-icon">{option.icon}</span>}
        {option.label}
      </button>
    ))}
  </div>
);

export const FilterBar = ({
  dateFilter,
  dateOptions,
  onDateChange,
  deadlineFilter,
  deadlineOptions,
  onDeadlineChange,
  statusFilter,
  statusOptions,
  onStatusChange,
  priorityFilter,
  priorityOptions,
  onPriorityChange,
  layout = 'collapsible',
  onLayoutChange,
  taskCount,
  filterSummary
}: FilterBarProps) => {
  // Track which sections are expanded (for collapsible mode)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    date: false,
    deadline: false,
    status: true, // Status open by default
    priority: false
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Get active label for collapsed state
  const getActiveLabel = (filter: string, options: FilterOption[]) => {
    if (!filter || filter === 'all') return 'All';
    const option = options.find(o => o.id === filter);
    return option?.label ?? filter;
  };

  // Horizontal (Notion-style) layout
  if (layout === 'horizontal') {
    return (
      <div className="filter-bar filter-bar-horizontal">
        {/* Toolbar row */}
        <div className="filter-toolbar">
          <div className="filter-toolbar-left">
            <button 
              type="button" 
              className={`filter-toolbar-btn ${layout === 'horizontal' ? 'is-active' : ''}`}
              onClick={() => onLayoutChange?.('collapsible')}
              title="Switch to collapsible view"
            >
              ☰
            </button>
            <button type="button" className="filter-toolbar-btn" title="Sort">
              ↕
            </button>
            <button type="button" className="filter-toolbar-btn" title="Search">
              🔍
            </button>
          </div>
          <div className="filter-toolbar-right">
            {taskCount !== undefined && (
              <span className="filter-task-count">≡ {taskCount}</span>
            )}
          </div>
        </div>

        {/* Date filters row */}
        <div className="filter-row">
          <PillGroup
            options={dateOptions}
            value={dateFilter}
            onChange={onDateChange}
          />
        </div>

        {/* Deadline filters row */}
        <div className="filter-row">
          <PillGroup
            options={deadlineOptions}
            value={deadlineFilter}
            onChange={onDeadlineChange}
          />
        </div>

        {/* Status filters row */}
        <div className="filter-row">
          <PillGroup
            options={statusOptions}
            value={statusFilter}
            onChange={onStatusChange}
          />
        </div>

        {/* Priority filters row */}
        <div className="filter-row">
          <PillGroup
            options={priorityOptions}
            value={priorityFilter}
            onChange={onPriorityChange}
          />
        </div>

        {/* Summary row */}
        {filterSummary && (
          <div className="filter-summary-row">
            <span className="filter-summary-label">FILTERS</span>
            <span className="filter-summary-text">{filterSummary}</span>
          </div>
        )}
      </div>
    );
  }

  // Collapsible layout (default)
  return (
    <div className="filter-bar filter-bar-collapsible">
      {/* Toolbar row */}
      <div className="filter-toolbar">
        <div className="filter-toolbar-left">
          <button 
            type="button" 
            className={`filter-toolbar-btn ${layout === 'collapsible' ? 'is-active' : ''}`}
            onClick={() => onLayoutChange?.('horizontal')}
            title="Switch to horizontal view"
          >
            ⊟
          </button>
          <span className="filter-toolbar-title">Filters</span>
        </div>
        <div className="filter-toolbar-right">
          {taskCount !== undefined && (
            <span className="filter-task-count">{taskCount} tasks</span>
          )}
        </div>
      </div>

      {/* Collapsible sections */}
      <div className="filter-sections">
        <FilterSection
          label="Date"
          icon="📅"
          isExpanded={expandedSections.date}
          onToggle={() => toggleSection('date')}
          activeLabel={getActiveLabel(dateFilter, dateOptions)}
        >
          <PillGroup
            options={dateOptions}
            value={dateFilter}
            onChange={onDateChange}
          />
        </FilterSection>

        <FilterSection
          label="Deadline"
          icon="⏰"
          isExpanded={expandedSections.deadline}
          onToggle={() => toggleSection('deadline')}
          activeLabel={getActiveLabel(deadlineFilter, deadlineOptions)}
        >
          <PillGroup
            options={deadlineOptions}
            value={deadlineFilter}
            onChange={onDeadlineChange}
          />
        </FilterSection>

        <FilterSection
          label="Status"
          icon="📋"
          isExpanded={expandedSections.status}
          onToggle={() => toggleSection('status')}
          activeLabel={getActiveLabel(statusFilter, statusOptions)}
        >
          <PillGroup
            options={statusOptions}
            value={statusFilter}
            onChange={onStatusChange}
          />
        </FilterSection>

        <FilterSection
          label="Priority"
          icon="🎯"
          isExpanded={expandedSections.priority}
          onToggle={() => toggleSection('priority')}
          activeLabel={getActiveLabel(priorityFilter, priorityOptions)}
        >
          <PillGroup
            options={priorityOptions}
            value={priorityFilter}
            onChange={onPriorityChange}
          />
        </FilterSection>
      </div>
    </div>
  );
};

export default FilterBar;

