import { useCallback, useEffect, useRef, useState } from 'react';
import type { SavedView } from '@shared/types';
import type { GroupingOption, SortRule } from '../utils/sorting';
import { platformBridge } from '@shared/platform';

// Default icon options for view selection
const ICON_OPTIONS = [
  '📋', '📝', '✅', '🎯', '⚡', '🔥', '⭐', '💡',
  '📊', '📈', '🗂️', '📁', '🏷️', '🔖', '📌', '🎪',
  '🚀', '💪', '🎨', '🔧', '⏰', '📅', '🌟', '✨'
];

interface ViewTabsProps {
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
  /** ID of currently active saved view (if any) */
  activeViewId?: string | null;
  /** Callback to apply a saved view's settings */
  onApplyView: (view: SavedView) => void;
  /** Callback when active view changes */
  onActiveViewChange?: (viewId: string | null) => void;
  /** Callback to reset filters to saved view state */
  onResetFilters?: () => void;
  /** Whether the view tabs should be shown */
  visible?: boolean;
}

const widgetAPI = platformBridge.widgetAPI;

/**
 * Compares current filter state to a saved view to detect changes
 */
const hasFiltersChanged = (
  view: SavedView,
  currentState: {
    dayFilter: string;
    matrixFilter: string;
    deadlineFilter: string;
    statusFilter: string;
    sortRules: SortRule[];
    grouping: string;
  }
): boolean => {
  if (view.dayFilter !== currentState.dayFilter) return true;
  if (view.matrixFilter !== currentState.matrixFilter) return true;
  if (view.deadlineFilter !== currentState.deadlineFilter) return true;
  if (view.statusFilter !== currentState.statusFilter) return true;
  if (view.grouping !== currentState.grouping) return true;
  
  // Compare sort rules
  if (view.sortRules.length !== currentState.sortRules.length) return true;
  for (let i = 0; i < view.sortRules.length; i++) {
    const saved = view.sortRules[i];
    const current = currentState.sortRules[i];
    if (saved.property !== current.property || saved.direction !== current.direction) {
      return true;
    }
  }
  
  return false;
};

export const ViewTabs = ({
  dayFilter,
  matrixFilter,
  deadlineFilter,
  statusFilter,
  sortRules,
  grouping,
  activeWidget,
  activeViewId,
  onApplyView,
  onActiveViewChange,
  onResetFilters,
  visible = true
}: ViewTabsProps) => {
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [isNaming, setIsNaming] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('📋');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [contextMenuViewId, setContextMenuViewId] = useState<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const iconPickerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Load saved views on mount
  useEffect(() => {
    const loadViews = async () => {
      try {
        const views = await widgetAPI.getSavedViews();
        setSavedViews(views);
      } catch (error) {
        if (error instanceof Error && error.message.includes('not available')) {
          return;
        }
        console.error('Failed to load saved views:', error);
      }
    };
    
    loadViews();
  }, []);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (iconPickerRef.current && !iconPickerRef.current.contains(event.target as Node)) {
        setShowIconPicker(false);
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenuViewId(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowIconPicker(false);
        setIsNaming(false);
        setNewViewName('');
        setEditingViewId(null);
        setContextMenuViewId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  // Focus input when naming
  useEffect(() => {
    if (isNaming && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isNaming]);

  // Get the active view object
  const activeView = savedViews.find((v) => v.id === activeViewId);

  // Check if current filters differ from active view
  const isDirty = activeView
    ? hasFiltersChanged(activeView, {
        dayFilter,
        matrixFilter,
        deadlineFilter,
        statusFilter,
        sortRules,
        grouping
      })
    : false;

  const handleSaveView = useCallback(async () => {
    if (!newViewName.trim()) return;

    const viewData = {
      name: newViewName.trim(),
      icon: selectedIcon,
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
      setSelectedIcon('📋');
      onActiveViewChange?.(saved.id);
    } catch (error) {
      console.error('Failed to save view:', error);
    }
  }, [newViewName, selectedIcon, dayFilter, matrixFilter, deadlineFilter, statusFilter, sortRules, grouping, activeWidget, onActiveViewChange]);

  const handleUpdateView = useCallback(async (viewId: string) => {
    const viewToUpdate = savedViews.find((v) => v.id === viewId);
    if (!viewToUpdate) return;

    const viewData = {
      ...viewToUpdate,
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
      activeWidget,
      updatedAt: new Date().toISOString()
    };

    try {
      // Update via API
      await widgetAPI.saveView(viewData);
      // Update local state
      setSavedViews((prev) =>
        prev.map((v) => (v.id === viewId ? viewData : v))
      );
    } catch (error) {
      console.error('Failed to update view:', error);
    }
  }, [savedViews, dayFilter, matrixFilter, deadlineFilter, statusFilter, sortRules, grouping, activeWidget]);

  const handleDeleteView = useCallback(async (viewId: string) => {
    try {
      await widgetAPI.deleteView(viewId);
      setSavedViews((prev) => prev.filter((v) => v.id !== viewId));
      if (activeViewId === viewId) {
        onActiveViewChange?.(null);
      }
      setContextMenuViewId(null);
    } catch (error) {
      console.error('Failed to delete view:', error);
    }
  }, [activeViewId, onActiveViewChange]);

  const handleUpdateViewIcon = useCallback(async (viewId: string, newIcon: string) => {
    const viewToUpdate = savedViews.find((v) => v.id === viewId);
    if (!viewToUpdate) return;

    const updatedView = {
      ...viewToUpdate,
      icon: newIcon,
      updatedAt: new Date().toISOString()
    };

    try {
      await widgetAPI.saveView(updatedView);
      setSavedViews((prev) =>
        prev.map((v) => (v.id === viewId ? updatedView : v))
      );
      setEditingViewId(null);
    } catch (error) {
      console.error('Failed to update view icon:', error);
    }
  }, [savedViews]);

  const handleApplyView = useCallback((view: SavedView) => {
    onApplyView(view);
    onActiveViewChange?.(view.id);
  }, [onApplyView, onActiveViewChange]);

  const handleContextMenu = useCallback((e: React.MouseEvent, viewId: string) => {
    e.preventDefault();
    setContextMenuViewId(viewId);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  }, []);

  const handleAddClick = useCallback(() => {
    setIsNaming(true);
    setSelectedIcon('📋');
  }, []);

  if (!visible) return null;

  return (
    <div className="view-tabs-container" ref={containerRef}>
      <div className="view-tabs">
        {/* Saved view tabs */}
        {savedViews.map((view) => (
          <button
            key={view.id}
            type="button"
            className={`view-tab ${activeViewId === view.id ? 'is-active' : ''}`}
            onClick={() => handleApplyView(view)}
            onContextMenu={(e) => handleContextMenu(e, view.id)}
            title={view.name}
          >
            <span className="view-tab-icon">{view.icon || '📋'}</span>
            <span className="view-tab-name">{view.name}</span>
          </button>
        ))}

        {/* Add new view button */}
        {!isNaming && (
          <button
            type="button"
            className="view-tab view-tab-add"
            onClick={handleAddClick}
            title="Add a view"
          >
            <span className="view-tab-add-icon">+</span>
          </button>
        )}

        {/* Inline naming form */}
        {isNaming && (
          <div className="view-tab-naming">
            <button
              type="button"
              className="view-tab-icon-picker-trigger"
              onClick={() => setShowIconPicker(!showIconPicker)}
              title="Choose icon"
            >
              {selectedIcon}
            </button>
            {showIconPicker && (
              <div className="view-tab-icon-picker" ref={iconPickerRef}>
                {ICON_OPTIONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    className={`icon-option ${selectedIcon === icon ? 'is-selected' : ''}`}
                    onClick={() => {
                      setSelectedIcon(icon);
                      setShowIconPicker(false);
                    }}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            )}
            <input
              ref={inputRef}
              type="text"
              className="view-tab-name-input"
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
              className="view-tab-save-btn"
              onClick={handleSaveView}
              disabled={!newViewName.trim()}
            >
              ✓
            </button>
            <button
              type="button"
              className="view-tab-cancel-btn"
              onClick={() => {
                setIsNaming(false);
                setNewViewName('');
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Reset and Save buttons - show when active view has been modified */}
        {isDirty && activeViewId && (
          <>
            <button
              type="button"
              className="view-tabs-reset"
              onClick={onResetFilters}
              title="Reset to saved view"
            >
              Reset
            </button>
            <button
              type="button"
              className="view-tabs-save-changes"
              onClick={() => handleUpdateView(activeViewId)}
              title="Save current filter changes to this view"
            >
              Save view
            </button>
          </>
        )}
      </div>

      {/* Context menu */}
      {contextMenuViewId && (
        <div
          className="view-tab-context-menu"
          ref={contextMenuRef}
          style={{
            left: contextMenuPosition.x,
            top: contextMenuPosition.y
          }}
        >
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              setEditingViewId(contextMenuViewId);
              setContextMenuViewId(null);
            }}
          >
            <span className="context-menu-icon">🎨</span>
            Change icon
          </button>
          <button
            type="button"
            className="context-menu-item context-menu-item-danger"
            onClick={() => handleDeleteView(contextMenuViewId)}
          >
            <span className="context-menu-icon">🗑️</span>
            Delete view
          </button>
        </div>
      )}

      {/* Icon picker for editing existing view */}
      {editingViewId && (
        <div className="view-tab-icon-picker-overlay">
          <div className="view-tab-icon-picker-modal" ref={iconPickerRef}>
            <div className="icon-picker-header">Choose an icon</div>
            <div className="icon-picker-grid">
              {ICON_OPTIONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  className="icon-option"
                  onClick={() => handleUpdateViewIcon(editingViewId, icon)}
                >
                  {icon}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="icon-picker-close"
              onClick={() => setEditingViewId(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ViewTabs;

