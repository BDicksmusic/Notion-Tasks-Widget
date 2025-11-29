import { useCallback, useState, useEffect, useRef } from 'react';
import type { FC } from 'react';
import type { TaskStatusOption, TaskUpdatePayload } from '@shared/types';
import { matrixOptions, type MatrixOptionId } from '../constants/matrix';
import DateField from './DateField';

export interface MassEditToolbarProps {
  selectedCount: number;
  statusOptions: TaskStatusOption[];
  onMassUpdate: (updates: TaskUpdatePayload) => Promise<void>;
  onClearSelection: () => void;
  onSelectAll?: () => void;
  totalCount?: number;
}

const MassEditToolbar: FC<MassEditToolbarProps> = ({
  selectedCount,
  statusOptions,
  onMassUpdate,
  onClearSelection,
  onSelectAll,
  totalCount
}) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) {
        setShowDatePicker(false);
        setShowStatusPicker(false);
        setShowPriorityPicker(false);
      }
    };
    
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (showDatePicker || showStatusPicker || showPriorityPicker)) {
        setShowDatePicker(false);
        setShowStatusPicker(false);
        setShowPriorityPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showDatePicker, showStatusPicker, showPriorityPicker]);

  const handleUpdate = useCallback(async (updates: TaskUpdatePayload) => {
    setIsUpdating(true);
    try {
      await onMassUpdate(updates);
    } finally {
      setIsUpdating(false);
      setShowDatePicker(false);
      setShowStatusPicker(false);
      setShowPriorityPicker(false);
    }
  }, [onMassUpdate]);

  const handleDateChange = useCallback((date: string | null) => {
    void handleUpdate({ dueDate: date });
  }, [handleUpdate]);

  const handleStatusChange = useCallback((status: string | null) => {
    void handleUpdate({ status });
  }, [handleUpdate]);

  const handlePriorityChange = useCallback((optionId: MatrixOptionId) => {
    const option = matrixOptions.find(o => o.id === optionId);
    if (option) {
      void handleUpdate({ urgent: option.urgent, important: option.important });
    }
  }, [handleUpdate]);

  const handleDeadlineToggle = useCallback((hard: boolean) => {
    void handleUpdate({ hardDeadline: hard });
  }, [handleUpdate]);

  const handleClearDate = useCallback(() => {
    void handleUpdate({ dueDate: null });
  }, [handleUpdate]);

  const hasSelection = selectedCount > 0;

  return (
    <div className="mass-edit-toolbar" ref={toolbarRef}>
      <div className="mass-edit-left">
        <div className="mass-edit-count">
          <span className="mass-edit-checkbox">
            <input
              type="checkbox"
              checked={selectedCount > 0}
              onChange={() => {
                if (selectedCount > 0) {
                  onClearSelection();
                } else if (onSelectAll) {
                  onSelectAll();
                }
              }}
              title={selectedCount > 0 ? 'Clear selection' : 'Select all'}
            />
          </span>
          <span className="mass-edit-label">
            {selectedCount > 0 ? (
              <>
                {selectedCount} selected
                {totalCount ? ` of ${totalCount}` : ''}
              </>
            ) : (
              <span className="mass-edit-hint">
                Use Shift+↑↓ to select, Esc to exit
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="mass-edit-actions">
        {/* Date picker */}
        <div className="mass-edit-dropdown-container">
          <button
            type="button"
            className="mass-edit-btn"
            onClick={() => {
              setShowDatePicker(!showDatePicker);
              setShowStatusPicker(false);
              setShowPriorityPicker(false);
            }}
            disabled={isUpdating || !hasSelection}
            title={hasSelection ? "Set due date" : "Select tasks first"}
          >
            📅 Date
          </button>
          {showDatePicker && (
            <div className="mass-edit-dropdown">
              <div className="mass-edit-dropdown-header">Set Due Date</div>
              <div className="mass-edit-dropdown-content">
                <DateField
                  value={null}
                  onChange={handleDateChange}
                  placeholder="Pick a date..."
                  ariaLabel="Mass edit due date"
                  allowTime
                />
                <button
                  type="button"
                  className="mass-edit-dropdown-action clear"
                  onClick={handleClearDate}
                >
                  Clear date
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Status picker */}
        <div className="mass-edit-dropdown-container">
          <button
            type="button"
            className="mass-edit-btn"
            onClick={() => {
              setShowStatusPicker(!showStatusPicker);
              setShowDatePicker(false);
              setShowPriorityPicker(false);
            }}
            disabled={isUpdating || !hasSelection}
            title={hasSelection ? "Set status" : "Select tasks first"}
          >
            🏷️ Status
          </button>
          {showStatusPicker && (
            <div className="mass-edit-dropdown">
              <div className="mass-edit-dropdown-header">Set Status</div>
              <div className="mass-edit-dropdown-content">
                {statusOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="mass-edit-dropdown-option"
                    onClick={() => handleStatusChange(option.name)}
                  >
                    {option.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Priority picker */}
        <div className="mass-edit-dropdown-container">
          <button
            type="button"
            className="mass-edit-btn"
            onClick={() => {
              setShowPriorityPicker(!showPriorityPicker);
              setShowDatePicker(false);
              setShowStatusPicker(false);
            }}
            disabled={isUpdating || !hasSelection}
            title={hasSelection ? "Set priority" : "Select tasks first"}
          >
            🎯 Priority
          </button>
          {showPriorityPicker && (
            <div className="mass-edit-dropdown priority-dropdown">
              <div className="mass-edit-dropdown-header">Set Priority</div>
              <div className="mass-edit-dropdown-content priority-grid">
                {matrixOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`mass-edit-priority-option matrix-${option.id}`}
                    onClick={() => handlePriorityChange(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Deadline type */}
        <div className="mass-edit-deadline-toggle">
          <button
            type="button"
            className="mass-edit-btn deadline-hard"
            onClick={() => handleDeadlineToggle(true)}
            disabled={isUpdating || !hasSelection}
            title={hasSelection ? "Set hard deadline" : "Select tasks first"}
          >
            🔴 Hard
          </button>
          <button
            type="button"
            className="mass-edit-btn deadline-soft"
            onClick={() => handleDeadlineToggle(false)}
            disabled={isUpdating || !hasSelection}
            title={hasSelection ? "Set soft deadline" : "Select tasks first"}
          >
            🔵 Soft
          </button>
        </div>

        {/* Clear selection */}
        <button
          type="button"
          className="mass-edit-btn mass-edit-clear"
          onClick={onClearSelection}
          disabled={isUpdating}
          title="Clear selection (Escape)"
        >
          ✕
        </button>
      </div>

      {isUpdating && selectedCount > 0 && (
        <div className="mass-edit-loading">
          Updating {selectedCount} task{selectedCount !== 1 ? 's' : ''}...
        </div>
      )}
    </div>
  );
};

export default MassEditToolbar;

