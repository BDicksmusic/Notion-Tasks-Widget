import { useCallback, useEffect, useRef, useState } from 'react';
import type { SavedView } from '@shared/types';
import type { GroupingOption, SortRule } from '../utils/sorting';
import { widgetBridge, platformBridge } from '@shared/platform';

interface ViewSelectorProps {
  /** Current day filter value */
  dayFilter: 'all' | 'today' | 'week';
  /** Current matrix/priority filter */
  matrixFilter: 'all' | 'do-now' | 'deep-work' | 'delegate' | 'trash';
  /** Current deadline filter */
  deadlineFilter: 'all' | 'hard';
  /** Current status filter */
  statusFilter: string;
  /** Current sort rules */
  sortRules: SortRule[];
  /** Current grouping option */
  grouping: GroupingOption;
  /** Current active widget tab */
  activeWidget: 'tasks' | 'writing' | 'timelog' | 'projects';
  /** Callback to apply a saved view's settings */
  onApplyView: (view: SavedView) => void;
}

// Use platformBridge directly to ensure we get the correct API (mobile or desktop)
const widgetAPI = platformBridge.widgetAPI;

export const ViewSelector = ({
  dayFilter,
  matrixFilter,
  deadlineFilter,
  statusFilter,
  sortRules,
  grouping,
  activeWidget,
  onApplyView
}: ViewSelectorProps) => {
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isNaming, setIsNaming] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load saved views on mount
  useEffect(() => {
    const loadViews = async () => {
      try {
        // Try to get saved views - this works on both desktop and mobile
        const views = await widgetAPI.getSavedViews();
        setSavedViews(views);
      } catch (error) {
        // Silently ignore "not available" errors (happens if bridge isn't initialized yet)
        // The error message format is: "[platform] widgetAPI.getSavedViews is not available on the mobile runtime"
        if (error instanceof Error && error.message.includes('not available')) {
          // On mobile, the bridge should be initialized, but if it's not ready yet,
          // we'll just skip loading views for now
          return;
        }
        console.error('Failed to load saved views:', error);
      }
    };
    
    loadViews();
  }, []);

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    if (!dropdownOpen) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
        setIsNaming(false);
        setNewViewName('');
      }
    };
    
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDropdownOpen(false);
        setIsNaming(false);
        setNewViewName('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [dropdownOpen]);

  // Focus input when naming
  useEffect(() => {
    if (isNaming && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isNaming]);

  const handleSaveView = useCallback(async () => {
    if (!newViewName.trim()) return;

    const viewData = {
      name: newViewName.trim(),
      dayFilter,
      matrixFilter,
      deadlineFilter,
      statusFilter,
      sortRules: sortRules.map((rule) => ({
        id: rule.id,
        property: rule.property,
        direction: rule.direction
      })),
      grouping,
      activeWidget
    };

    try {
      const saved = await widgetAPI.saveView(viewData);
      setSavedViews((prev) => [...prev, saved]);
      setIsNaming(false);
      setNewViewName('');
      setDropdownOpen(false);
    } catch (error) {
      console.error('Failed to save view:', error);
    }
  }, [newViewName, dayFilter, matrixFilter, deadlineFilter, statusFilter, sortRules, grouping, activeWidget]);

  const handleDeleteView = useCallback(async (viewId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await widgetAPI.deleteView(viewId);
      setSavedViews((prev) => prev.filter((v) => v.id !== viewId));
    } catch (error) {
      console.error('Failed to delete view:', error);
    }
  }, []);

  const handleOpenInNewWindow = useCallback(async (view: SavedView, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await widgetAPI.openViewWindow(view);
    } catch (error) {
      console.error('Failed to open view window:', error);
    }
  }, []);

  const handleOpenCurrentInNewWindow = useCallback(async () => {
    const viewData: SavedView = {
      id: `temp-${Date.now()}`,
      name: 'Current View',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dayFilter,
      matrixFilter,
      deadlineFilter,
      statusFilter,
      sortRules: sortRules.map((rule) => ({
        id: rule.id,
        property: rule.property,
        direction: rule.direction
      })),
      grouping,
      activeWidget
    };

    try {
      await widgetAPI.openViewWindow(viewData);
      setDropdownOpen(false);
    } catch (error) {
      console.error('Failed to open view window:', error);
    }
  }, [dayFilter, matrixFilter, deadlineFilter, statusFilter, sortRules, grouping, activeWidget]);

  const handleApplyView = useCallback((view: SavedView) => {
    onApplyView(view);
    setDropdownOpen(false);
  }, [onApplyView]);

  return (
    <div className="view-selector" ref={dropdownRef}>
      <button
        type="button"
        className="view-selector-trigger"
        onClick={() => setDropdownOpen(!dropdownOpen)}
        title="Views"
      >
        <span className="view-selector-icon">👁</span>
        <span className="view-selector-chevron">{dropdownOpen ? '▴' : '▾'}</span>
      </button>

      {dropdownOpen && (
        <div className="view-selector-dropdown">
          <div className="view-selector-header">
            <span>Saved Views</span>
            {platformBridge.hasWindowControls && (
              <button
                type="button"
                className="view-selector-new-window"
                onClick={handleOpenCurrentInNewWindow}
                title="Open current view in new window"
              >
                +
              </button>
            )}
          </div>

          <div className="view-selector-list">
            {savedViews.length === 0 && !isNaming && (
              <div className="view-selector-empty">
                No saved views yet
              </div>
            )}

            {savedViews.map((view) => (
              <div
                key={view.id}
                className="view-selector-item"
                onClick={() => handleApplyView(view)}
              >
                <span className="view-selector-item-name">{view.name}</span>
                <div className="view-selector-item-actions">
                  {platformBridge.hasWindowControls && (
                    <button
                      type="button"
                      className="view-selector-item-action"
                      onClick={(e) => handleOpenInNewWindow(view, e)}
                      title="Open in new window"
                    >
                      ⧉
                    </button>
                  )}
                  <button
                    type="button"
                    className="view-selector-item-action view-selector-item-delete"
                    onClick={(e) => handleDeleteView(view.id, e)}
                    title="Delete view"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}

            {isNaming ? (
              <div className="view-selector-naming">
                <input
                  ref={inputRef}
                  type="text"
                  className="view-selector-name-input"
                  placeholder="View name..."
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveView();
                    if (e.key === 'Escape') {
                      setIsNaming(false);
                      setNewViewName('');
                    }
                  }}
                />
                <button
                  type="button"
                  className="view-selector-save-btn"
                  onClick={handleSaveView}
                  disabled={!newViewName.trim()}
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="view-selector-capture"
                onClick={() => setIsNaming(true)}
              >
                📷 Capture current view
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ViewSelector;


