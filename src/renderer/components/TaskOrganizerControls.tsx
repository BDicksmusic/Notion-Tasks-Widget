import { ReactNode, useMemo } from 'react';
import {
  createSortRule,
  getGroupingLabel,
  getSortPropertyLabel,
  type GroupingOption,
  type SortDirection,
  type SortProperty,
  type SortRule
} from '../utils/sorting';

const SORT_PROPERTY_OPTIONS: { value: SortProperty; label: string }[] = [
  { value: 'dueDate', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' }
];

const DIRECTION_OPTIONS: { value: SortDirection; label: string }[] = [
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' }
];

const GROUPING_OPTIONS: { value: GroupingOption; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'dueDate', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'project', label: 'Project' }
];

const iconProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
};

export const FilterIcon = () => (
  <svg {...iconProps}>
    <path d="M3 5h14" />
    <path d="M6 10h8" />
    <path d="M9 15h2" />
  </svg>
);

export const SortIcon = () => (
  <svg {...iconProps}>
    <path d="M6 4v12" />
    <path d="M3.5 7.5 6 5l2.5 2.5" />
    <path d="M14 16V4" />
    <path d="M11.5 12.5 14 15l2.5-2.5" />
  </svg>
);

export const GroupIcon = () => (
  <svg {...iconProps}>
    <rect x="4" y="4" width="5" height="5" rx="1.2" />
    <rect x="11" y="4" width="5" height="5" rx="1.2" />
    <rect x="4" y="11" width="5" height="5" rx="1.2" />
    <rect x="11" y="11" width="5" height="5" rx="1.2" />
  </svg>
);

interface OrganizerIconButtonProps {
  label: string;
  icon: ReactNode;
  pressed: boolean;
  highlighted?: boolean;
  onClick(): void;
  ariaControls?: string;
  title?: string;
}

export const OrganizerIconButton = ({
  label,
  icon,
  pressed,
  highlighted = pressed,
  onClick,
  ariaControls,
  title
}: OrganizerIconButtonProps) => {
  const classes = ['task-organizer-icon'];
  if (highlighted) classes.push('is-active');
  if (pressed) classes.push('is-open');
  return (
    <button
      type="button"
      className={classes.join(' ')}
      onClick={onClick}
      aria-pressed={pressed}
      aria-expanded={pressed}
      aria-controls={ariaControls}
      title={title ?? label}
    >
      <span className="task-organizer-icon-inner" aria-hidden="true">
        {icon}
      </span>
      <span className="sr-only">{label}</span>
    </button>
  );
};

const formatSortSummary = (rule: SortRule) => {
  const label = getSortPropertyLabel(rule.property);
  return rule.direction === 'asc' ? `↑ ${label}` : `${label} ↓`;
};

const buildSortSummary = (rules: SortRule[]) =>
  rules.length
    ? rules.map((rule) => formatSortSummary(rule)).join(', ')
    : 'Default order';

interface SortButtonProps {
  sortRules: SortRule[];
  isOpen: boolean;
  onToggle(): void;
  ariaControls?: string;
}

export const SortButton = ({
  sortRules,
  isOpen,
  onToggle,
  ariaControls
}: SortButtonProps) => {
  const sortSummary = useMemo(
    () => buildSortSummary(sortRules),
    [sortRules]
  );

  return (
    <div className="task-organizer">
      <OrganizerIconButton
        label="Sort"
        icon={<SortIcon />}
        pressed={isOpen}
        highlighted={isOpen}
        onClick={onToggle}
        ariaControls={ariaControls}
        title={`Sort: ${sortSummary}`}
      />
    </div>
  );
};

interface GroupButtonProps {
  grouping: GroupingOption;
  isOpen: boolean;
  onToggle(): void;
  ariaControls?: string;
}

export const GroupButton = ({
  grouping,
  isOpen,
  onToggle,
  ariaControls
}: GroupButtonProps) => {
  const groupSummary = useMemo(() => getGroupingLabel(grouping), [grouping]);

  return (
    <div className="task-organizer">
      <OrganizerIconButton
        label="Group"
        icon={<GroupIcon />}
        pressed={isOpen}
        highlighted={isOpen}
        onClick={onToggle}
        ariaControls={ariaControls}
        title={`Group: ${groupSummary}`}
      />
    </div>
  );
};

interface SortPanelProps {
  sortRules: SortRule[];
  onSortRulesChange(next: SortRule[]): void;
  onClose?(): void;
}

export const SortPanel = ({
  sortRules,
  onSortRulesChange,
  onClose
}: SortPanelProps) => {
  const handleRulePropertyChange = (ruleId: string, property: SortProperty) => {
    onSortRulesChange(
      sortRules.map((rule) =>
        rule.id === ruleId ? { ...rule, property } : rule
      )
    );
  };

  const handleRuleDirectionChange = (
    ruleId: string,
    direction: SortDirection
  ) => {
    onSortRulesChange(
      sortRules.map((rule) =>
        rule.id === ruleId ? { ...rule, direction } : rule
      )
    );
  };

  const handleRemoveRule = (ruleId: string) => {
    onSortRulesChange(sortRules.filter((rule) => rule.id !== ruleId));
  };

  const moveRule = (ruleId: string, direction: 'up' | 'down') => {
    const index = sortRules.findIndex((rule) => rule.id === ruleId);
    if (index === -1) return;
    const delta = direction === 'up' ? -1 : 1;
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= sortRules.length) return;
    const next = [...sortRules];
    const [removed] = next.splice(index, 1);
    next.splice(targetIndex, 0, removed);
    onSortRulesChange(next);
  };

  const nextProperty = useMemo(() => {
    const used = new Set(sortRules.map((rule) => rule.property));
    const available = SORT_PROPERTY_OPTIONS.find(
      (option) => !used.has(option.value)
    );
    return available?.value ?? SORT_PROPERTY_OPTIONS[0].value;
  }, [sortRules]);

  const handleAddRule = () => {
    onSortRulesChange([...sortRules, createSortRule(nextProperty)]);
  };

  const canAddRule = sortRules.length < SORT_PROPERTY_OPTIONS.length;

  return (
    <div className="task-organizer-panel" role="group" aria-label="Task sorting controls">
      <div className="task-organizer-section">
        {sortRules.length ? (
          <div className="task-organizer-rule-list">
            {sortRules.map((rule, index) => {
              const isFirst = index === 0;
              const isLast = index === sortRules.length - 1;
              return (
                <div key={rule.id} className="sort-rule-row">
                  <select
                    value={rule.property}
                    onChange={(event) =>
                      handleRulePropertyChange(
                        rule.id,
                        event.target.value as SortProperty
                      )
                    }
                  >
                    {SORT_PROPERTY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={rule.direction}
                    onChange={(event) =>
                      handleRuleDirectionChange(
                        rule.id,
                        event.target.value as SortDirection
                      )
                    }
                  >
                    {DIRECTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <div className="task-organizer-order">
                    <button
                      type="button"
                      className="task-organizer-order-button"
                      onClick={() => moveRule(rule.id, 'up')}
                      disabled={isFirst}
                      aria-label="Move sort rule up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="task-organizer-order-button"
                      onClick={() => moveRule(rule.id, 'down')}
                      disabled={isLast}
                      aria-label="Move sort rule down"
                    >
                      ↓
                    </button>
                  </div>
                  <button
                    type="button"
                    className="task-organizer-remove"
                    onClick={() => handleRemoveRule(rule.id)}
                    aria-label="Remove sort rule"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="task-organizer-empty">No active sorts</p>
        )}
        <div className="task-organizer-section-footer">
          <p className="task-organizer-section-title">
            <span className="task-organizer-arrow" aria-hidden="true">
              ↑
            </span>
            Sorting
          </p>
          <div className="task-organizer-section-actions">
            <button
              type="button"
              className="task-organizer-link"
              onClick={handleAddRule}
              disabled={!canAddRule}
            >
              + Add sort
            </button>
            {onClose && (
              <button
                type="button"
                className="task-organizer-close"
                onClick={onClose}
                aria-label="Collapse organizer panel"
              >
                ↖
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface GroupPanelProps {
  grouping: GroupingOption;
  onGroupingChange(next: GroupingOption): void;
  onClose?(): void;
}

export const GroupPanel = ({
  grouping,
  onGroupingChange,
  onClose
}: GroupPanelProps) => (
  <div className="task-organizer-panel" role="group" aria-label="Task grouping controls">
    <div className="task-organizer-section task-organizer-group-section">
      <div className="task-organizer-group-grid">
        {GROUPING_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`task-organizer-group-pill ${
              grouping === option.value ? 'is-active' : ''
            }`}
            onClick={() => onGroupingChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="task-organizer-section-footer">
        <p className="task-organizer-section-title">Grouping</p>
        {onClose && (
          <div className="task-organizer-section-actions">
            <button
              type="button"
              className="task-organizer-close"
              onClick={onClose}
              aria-label="Collapse organizer panel"
            >
              ↖
            </button>
          </div>
        )}
      </div>
    </div>
  </div>
);

