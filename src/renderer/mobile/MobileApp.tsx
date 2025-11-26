import React, {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react';
import type {
  AppPreferences,
  Task,
  TaskStatusOption,
  TaskUpdatePayload,
  NotionCreatePayload,
  NotionSettings,
  TimeLogEntryPayload,
  TimeLogSettings,
  WritingEntryPayload,
  WritingSettings,
  Project,
  TaskOrderOption
} from '@shared/types';
import MobileTaskList from './MobileTaskList';
import QuickAdd from '../components/QuickAdd';
import SearchInput from '../components/SearchInput';
import {
  STATUS_FILTERS,
  type StatusFilterValue,
  mapStatusToFilterValue
} from '@shared/statusFilters';
import { platformBridge } from '@shared/platform';
import {
  type SortRule,
  type GroupingOption,
  sortTasks,
  groupTasks,
  deserializeSortRules,
  isGroupingOption
} from '../utils/sorting';
// import { useCountdownTimer } from '../utils/useCountdownTimer'; // Not used yet
import { matrixOptions } from '../constants/matrix';
import './MobileApp.css';

// Mobile view modes
type MobileViewMode = 'tasks' | 'kanban' | 'matrix' | 'calendar' | 'projects' | 'writing' | 'settings';

const SORT_RULES_STORAGE_KEY = 'widget.sort.rules';
const GROUPING_STORAGE_KEY = 'widget.group.option';
const MOBILE_VIEW_MODE_KEY = 'mobile.viewMode';

// Helper function to search task text
const taskMatchesSearch = (task: Task, query: string): boolean => {
  if (!query.trim()) return true;
  const lowerQuery = query.toLowerCase().trim();
  const searchFields = [
    task.title,
    task.status,
    task.mainEntry,
    task.normalizedStatus
  ].filter(Boolean);
  return searchFields.some((field) =>
    field!.toLowerCase().includes(lowerQuery)
  );
};

const getTodayKey = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

const extractDateKey = (value?: string | null) => {
  if (!value) return null;
  return value.slice(0, 10);
};

const toMidnightTimestamp = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

// Access widgetAPI through platformBridge
const getWidgetAPI = () => platformBridge.widgetAPI;

const MobileApp: React.FC = () => {
  // Menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<MobileViewMode>('tasks');
  
  // Task state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusOptions, setStatusOptions] = useState<TaskStatusOption[]>([]);
  const [orderOptions, setOrderOptions] = useState<TaskOrderOption[]>([]);
  const [notionSettings, setNotionSettings] = useState<NotionSettings | null>(null);
  const [appPreferences, setAppPreferences] = useState<AppPreferences | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  
  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('active');
  const [dayFilter, setDayFilter] = useState<'all' | 'today' | 'week'>('all');
  const [matrixFilter, setMatrixFilter] = useState<'all' | 'do-now' | 'deep-work' | 'delegate' | 'trash'>('all');
  
  // Sorting & grouping
  const [sortRules, setSortRules] = useState<SortRule[]>(() => {
    try {
      const stored = localStorage.getItem(SORT_RULES_STORAGE_KEY);
      if (!stored) return deserializeSortRules();
      const parsed = JSON.parse(stored);
      return deserializeSortRules(parsed);
    } catch {
      return deserializeSortRules();
    }
  });
  const [grouping, setGrouping] = useState<GroupingOption>(() => {
    try {
      const stored = localStorage.getItem(GROUPING_STORAGE_KEY);
      return stored && isGroupingOption(stored) ? stored : 'none';
    } catch {
      return 'none';
    }
  });

  // Quick add state
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  
  // Filter panel expanded state
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  
  // Deadline filter
  const [deadlineFilter, setDeadlineFilter] = useState<'all' | 'hard' | 'soft'>('all');
  
  // Timer hook - removed: not currently used in mobile view
  // If countdown timer is needed, pass: useCountdownTimer(tasks, handleUpdateTask, handleCreateTimeLog)

  // Load initial view mode
  useEffect(() => {
    try {
      const stored = localStorage.getItem(MOBILE_VIEW_MODE_KEY);
      if (stored && ['tasks', 'kanban', 'matrix', 'calendar', 'projects', 'writing', 'settings'].includes(stored)) {
        setViewMode(stored as MobileViewMode);
      }
    } catch {
      // Ignore
    }
  }, []);

  // Handle widget actions (when app is opened from home screen widget)
  useEffect(() => {
    const checkWidgetAction = () => {
      const action = (window as any).__WIDGET_ACTION__;
      if (action) {
        console.log('[MobileApp] Widget action received:', action);
        delete (window as any).__WIDGET_ACTION__;
        
        if (action === 'quick_task' || action === 'add_task') {
          setViewMode('tasks');
          setQuickAddOpen(true);
        } else if (action === 'quick_writing') {
          setViewMode('writing');
          // Could open writing modal here when implemented
        }
      }
    };
    
    // Check immediately and also after a short delay (for initial load)
    checkWidgetAction();
    const timer = setTimeout(checkWidgetAction, 500);
    
    return () => clearTimeout(timer);
  }, []);

  // Save view mode
  useEffect(() => {
    try {
      localStorage.setItem(MOBILE_VIEW_MODE_KEY, viewMode);
    } catch {
      // Ignore
    }
  }, [viewMode]);

  const widgetAPI = getWidgetAPI();

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await widgetAPI.getTasks();
      setTasks(data || []);
      setError(null);
    } catch (err) {
      // Silently handle "not available" errors - just show empty state
      if (err instanceof Error && (
        err.message.includes('not available') ||
        err.message.includes('not configured') ||
        err.message.includes('API key')
      )) {
        setTasks([]);
        setError(null);
      } else {
        console.error('[MobileApp] Failed to fetch tasks:', err);
        setError(err instanceof Error ? err.message : 'Unable to load tasks');
      }
    } finally {
      setLoading(false);
    }
  }, [widgetAPI]);

  // Load status options
  const loadStatusOptions = useCallback(async () => {
    try {
      const options = await widgetAPI.getStatusOptions();
      setStatusOptions(options || []);
    } catch (err) {
      // Silently fail - status options are optional
      console.log('[MobileApp] Status options not available');
      setStatusOptions([]);
    }
  }, [widgetAPI]);

  // Load settings
  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      try {
        const [settings, prefs] = await Promise.all([
          widgetAPI.getSettings().catch(() => null),
          widgetAPI.getAppPreferences().catch(() => null)
        ]);
        
        if (!cancelled) {
          if (settings) setNotionSettings(settings);
          if (prefs) setAppPreferences(prefs);
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    };

    fetchTasks();
    loadStatusOptions();
    loadData();

    return () => {
      cancelled = true;
    };
  }, [fetchTasks, loadStatusOptions, widgetAPI]);

  // Handle add task
  const handleAddTask = useCallback(async (payload: NotionCreatePayload) => {
    try {
      const task = await widgetAPI.addTask(payload);
      setTasks((prev) => [task, ...prev]);
      setQuickAddOpen(false);
      return task;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add task';
      // Show user-friendly message for common errors
      if (message.includes('API key') || message.includes('configure')) {
        alert('Please configure your Notion API key in Settings to add tasks.');
      } else {
        setError(message);
      }
      throw err;
    }
  }, [widgetAPI]);

  // Handle update task
  const handleUpdateTask = useCallback(async (taskId: string, updates: TaskUpdatePayload) => {
    try {
      const updated = await widgetAPI.updateTask(taskId, updates);
      setTasks((prev) =>
        prev.map((task) => (task.id === taskId ? updated : task))
      );
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update task';
      // Show user-friendly message for common errors
      if (message.includes('API key') || message.includes('configure')) {
        alert('Please configure your Notion API key in Settings to update tasks.');
      } else {
        console.error('[MobileApp] Failed to update task:', err);
        setError(message);
      }
      throw err;
    }
  }, [widgetAPI]);

  // Handle stop session
  const handleStopSession = useCallback(async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    
    // Update task status
    await handleUpdateTask(taskId, { status: notionSettings?.completedStatus });
  }, [tasks, handleUpdateTask, notionSettings]);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    const todayKey = getTodayKey();
    const todayTimestamp = toMidnightTimestamp(todayKey)!;
    const endOfWeek = new Date(todayTimestamp);
    endOfWeek.setDate(endOfWeek.getDate() + 7);
    const endOfWeekTimestamp = endOfWeek.getTime();

    return tasks.filter((task) => {
      // Search filter
      if (searchQuery && !taskMatchesSearch(task, searchQuery)) {
        return false;
      }

      // Filter out subtasks from main list
      if (task.parentTaskId) {
        return false;
      }

      // Status filter
      const normalizedStatus =
        mapStatusToFilterValue(task.status) ??
        mapStatusToFilterValue(task.normalizedStatus) ??
        (task.normalizedStatus as StatusFilterValue | undefined);

      const completedStatusString = notionSettings?.completedStatus;
      const isCompleted =
        (completedStatusString &&
          task.status?.toLowerCase() === completedStatusString.toLowerCase());

      if (isCompleted && statusFilter !== 'done' && statusFilter !== 'all') {
        return false;
      }

      if (statusFilter !== 'all' && statusFilter !== 'done') {
        if (normalizedStatus && normalizedStatus !== statusFilter) {
          return false;
        }
      }

      // Day filter
      const dueDateKey = extractDateKey(task.dueDate);
      const dueDateTimestamp = dueDateKey ? toMidnightTimestamp(dueDateKey) : null;

      if (dayFilter === 'today') {
        if (dueDateTimestamp === null || dueDateTimestamp > todayTimestamp) {
          return false;
        }
      } else if (dayFilter === 'week') {
        if (dueDateTimestamp === null || dueDateTimestamp > endOfWeekTimestamp) {
          return false;
        }
      }

      // Matrix filter
      if (matrixFilter !== 'all') {
        const option = matrixOptions.find((o) => o.id === matrixFilter);
        if (option) {
          const isUrgent = Boolean(task.urgent);
          const isImportant = Boolean(task.important);
          if (option.urgent !== undefined && isUrgent !== option.urgent) return false;
          if (option.important !== undefined && isImportant !== option.important) return false;
        }
      }

      // Deadline type filter
      if (deadlineFilter !== 'all') {
        const isHardDeadline = Boolean(task.hardDeadline);
        if (deadlineFilter === 'hard' && !isHardDeadline) return false;
        if (deadlineFilter === 'soft' && isHardDeadline) return false;
      }

      return true;
    });
  }, [tasks, searchQuery, statusFilter, dayFilter, matrixFilter, deadlineFilter, notionSettings]);

  // Sort and group tasks
  const sortedTasks = useMemo(() => {
    return sortTasks(filteredTasks, sortRules);
  }, [filteredTasks, sortRules]);

  const groupedTasks = useMemo(() => {
    if (grouping === 'none') return null;
    return groupTasks(sortedTasks, grouping);
  }, [sortedTasks, grouping]);

  // Navigate to view
  const navigateTo = useCallback((view: MobileViewMode) => {
    setViewMode(view);
    setMenuOpen(false);
  }, []);

  // Open settings - navigate to settings view instead of opening window
  const handleOpenSettings = useCallback(() => {
    setViewMode('settings');
    setMenuOpen(false);
  }, []);

  // Menu items
  const menuItems: { id: MobileViewMode; label: string; icon: string }[] = [
    { id: 'tasks', label: 'Tasks', icon: '📋' },
    { id: 'kanban', label: 'Kanban', icon: '📊' },
    { id: 'matrix', label: 'Matrix', icon: '⬛' },
    { id: 'projects', label: 'Projects', icon: '📁' },
    { id: 'calendar', label: 'Calendar', icon: '📅' },
    { id: 'writing', label: 'Writing', icon: '✍️' },
    { id: 'settings', label: 'Settings', icon: '⚙️' }
  ];

  // Get view title
  const viewTitle = menuItems.find((item) => item.id === viewMode)?.label || 'Tasks';

  // Render Kanban (vertical mobile-optimized)
  const renderKanban = () => {
    // Group by status for kanban
    const statusGroups = new Map<string, Task[]>();
    
    sortedTasks.forEach((task) => {
      const status = task.status || 'No Status';
      if (!statusGroups.has(status)) {
        statusGroups.set(status, []);
      }
      statusGroups.get(status)!.push(task);
    });

    return (
      <div className="mobile-kanban">
        {Array.from(statusGroups.entries()).map(([status, tasks]) => (
          <div key={status} className="mobile-kanban-column">
            <div className="mobile-kanban-header">
              <span className="mobile-kanban-status">{status}</span>
              <span className="mobile-kanban-count">{tasks.length}</span>
            </div>
            <div className="mobile-kanban-tasks">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="mobile-kanban-card"
                  onClick={() => {
                    // Could open task detail view
                  }}
                >
                  <div className="mobile-kanban-card-title">{task.title}</div>
                  {task.dueDate && (
                    <div className="mobile-kanban-card-date">
                      📅 {new Date(task.dueDate).toLocaleDateString()}
                    </div>
                  )}
                  {(task.urgent || task.important) && (
                    <div className="mobile-kanban-card-badges">
                      {task.urgent && <span className="badge urgent">Urgent</span>}
                      {task.important && <span className="badge important">Important</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {statusGroups.size === 0 && (
          <div className="mobile-empty-state">
            <p>No tasks to display</p>
            <p className="mobile-empty-hint">Add tasks to see them here</p>
          </div>
        )}
      </div>
    );
  };

  // Render Matrix (Eisenhower)
  const renderMatrix = () => {
    const quadrants = [
      { id: 'do-now', label: 'Do Now', urgent: true, important: true, color: '#ef4444' },
      { id: 'schedule', label: 'Schedule', urgent: false, important: true, color: '#3b82f6' },
      { id: 'delegate', label: 'Delegate', urgent: true, important: false, color: '#f59e0b' },
      { id: 'eliminate', label: 'Eliminate', urgent: false, important: false, color: '#6b7280' }
    ];

    return (
      <div className="mobile-matrix">
        {quadrants.map((quad) => {
          const quadrantTasks = sortedTasks.filter((task) => {
            const isUrgent = Boolean(task.urgent);
            const isImportant = Boolean(task.important);
            return isUrgent === quad.urgent && isImportant === quad.important;
          });

          return (
            <div
              key={quad.id}
              className="mobile-matrix-quadrant"
              style={{ borderColor: quad.color }}
            >
              <div className="mobile-matrix-header" style={{ backgroundColor: quad.color }}>
                <span>{quad.label}</span>
                <span className="mobile-matrix-count">{quadrantTasks.length}</span>
              </div>
              <div className="mobile-matrix-tasks">
                {quadrantTasks.slice(0, 5).map((task) => (
                  <div key={task.id} className="mobile-matrix-task">
                    <span className="mobile-matrix-task-title">{task.title}</span>
                  </div>
                ))}
                {quadrantTasks.length > 5 && (
                  <div className="mobile-matrix-more">
                    +{quadrantTasks.length - 5} more
                  </div>
                )}
                {quadrantTasks.length === 0 && (
                  <div className="mobile-matrix-empty">No tasks</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Render Projects placeholder
  const renderProjects = () => (
    <div className="mobile-placeholder">
      <div className="mobile-placeholder-icon">📁</div>
      <h2>Projects</h2>
      <p>Coming soon to mobile</p>
    </div>
  );

  // Render Calendar placeholder
  const renderCalendar = () => (
    <div className="mobile-placeholder">
      <div className="mobile-placeholder-icon">📅</div>
      <h2>Calendar</h2>
      <p>Coming soon to mobile</p>
    </div>
  );

  // Render Writing placeholder
  const renderWriting = () => (
    <div className="mobile-placeholder">
      <div className="mobile-placeholder-icon">✍️</div>
      <h2>Writing</h2>
      <p>Coming soon to mobile</p>
    </div>
  );


  // Settings state for inline editing
  const [settingsEditing, setSettingsEditing] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  const [tempDatabaseId, setTempDatabaseId] = useState('');
  const [tempCompletedStatus, setTempCompletedStatus] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Initialize temp settings when editing starts
  useEffect(() => {
    if (settingsEditing && notionSettings) {
      setTempApiKey(notionSettings.apiKey || '');
      setTempDatabaseId(notionSettings.databaseId || '');
      setTempCompletedStatus(notionSettings.completedStatus || '');
    }
  }, [settingsEditing, notionSettings]);

  // Handle save settings
  const handleSaveSettings = async () => {
    if (!notionSettings) return;
    
    try {
      setSettingsSaving(true);
      setSettingsMessage(null);
      
      const updated = await widgetAPI.updateSettings({
        ...notionSettings,
        apiKey: tempApiKey,
        databaseId: tempDatabaseId,
        completedStatus: tempCompletedStatus
      });
      
      setNotionSettings(updated);
      setSettingsEditing(false);
      setSettingsMessage({ type: 'success', text: 'Settings saved!' });
      
      // Refresh tasks to pick up new settings
      setTimeout(() => {
        fetchTasks();
        setSettingsMessage(null);
      }, 1500);
    } catch (err) {
      setSettingsMessage({ 
        type: 'error', 
        text: err instanceof Error ? err.message : 'Failed to save settings' 
      });
    } finally {
      setSettingsSaving(false);
    }
  };

  // Render Settings
  const renderSettings = () => {
    const isNotionConnected = Boolean(notionSettings?.apiKey && notionSettings?.databaseId);
    
    return (
      <div className="mobile-settings">
        <div className="mobile-settings-section">
          <h3>Storage Mode</h3>
          <p className="mobile-settings-status">
            {isNotionConnected 
              ? '☁️ Syncing with Notion' 
              : '📱 Local Storage (Offline)'}
          </p>
          <p className="mobile-settings-hint">
            {isNotionConnected 
              ? 'Your tasks sync to your Notion database'
              : 'Tasks are stored on your device. Add Notion to sync across devices.'}
          </p>
        </div>
        
        <div className="mobile-settings-section">
          <div className="mobile-settings-section-header">
            <h3>Notion Sync (Optional)</h3>
            {!settingsEditing && (
              <button 
                className="mobile-settings-edit-btn"
                onClick={() => setSettingsEditing(true)}
              >
                {isNotionConnected ? 'Edit' : 'Setup'}
              </button>
            )}
          </div>
          
          {settingsMessage && (
            <p className={`mobile-settings-message ${settingsMessage.type}`}>
              {settingsMessage.text}
            </p>
          )}
          
          {settingsEditing ? (
            <div className="mobile-settings-form">
              <label className="mobile-settings-field">
                <span>API Key</span>
                <input
                  type="password"
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  placeholder="secret_..."
                  autoComplete="off"
                />
                <span className="mobile-settings-field-hint">
                  Get from notion.so/my-integrations
                </span>
              </label>
              
              <label className="mobile-settings-field">
                <span>Database ID or URL</span>
                <input
                  type="text"
                  value={tempDatabaseId}
                  onChange={(e) => setTempDatabaseId(e.target.value)}
                  placeholder="Paste database URL or ID"
                />
              </label>
              
              <label className="mobile-settings-field">
                <span>Completed Status Value</span>
                <input
                  type="text"
                  value={tempCompletedStatus}
                  onChange={(e) => setTempCompletedStatus(e.target.value)}
                  placeholder="Done"
                />
                <span className="mobile-settings-field-hint">
                  Status value that marks tasks complete
                </span>
              </label>
              
              <div className="mobile-settings-form-actions">
                <button
                  className="mobile-settings-button secondary"
                  onClick={() => {
                    setSettingsEditing(false);
                    setSettingsMessage(null);
                  }}
                  disabled={settingsSaving}
                >
                  Cancel
                </button>
                <button
                  className="mobile-settings-button"
                  onClick={handleSaveSettings}
                  disabled={settingsSaving}
                >
                  {settingsSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mobile-settings-info">
              <p>{isNotionConnected ? '✅ Connected' : '❌ Not configured'}</p>
              {isNotionConnected && (
                <p className="mobile-settings-detail">
                  Database: {notionSettings?.databaseId?.slice(0, 8)}...
                </p>
              )}
            </div>
          )}
        </div>
        
        <div className="mobile-settings-section">
          <h3>Default Filters</h3>
          <div className="mobile-settings-filters">
            <div className="mobile-settings-filter-row">
              <span>Day Filter</span>
              <select 
                value={dayFilter} 
                onChange={(e) => setDayFilter(e.target.value as 'all' | 'today' | 'week')}
                className="mobile-settings-select"
              >
                <option value="all">All</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
              </select>
            </div>
          </div>
        </div>
        
        <div className="mobile-settings-section">
          <h3>About</h3>
          <p>Tasks Widget</p>
          <p className="mobile-settings-version">Mobile Version 1.0</p>
        </div>
        
        <div className="mobile-settings-section">
          <button
            className="mobile-settings-button secondary"
            onClick={fetchTasks}
          >
            Refresh Tasks
          </button>
        </div>
      </div>
    );
  };

  // Render main content
  const renderContent = () => {
    if (loading && tasks.length === 0) {
      return (
        <div className="mobile-loading">
          <div className="mobile-loading-spinner" />
          <p>Loading...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="mobile-error">
          <p>{error}</p>
          <button onClick={fetchTasks}>Retry</button>
        </div>
      );
    }

    switch (viewMode) {
      case 'kanban':
        return renderKanban();
      case 'matrix':
        return renderMatrix();
      case 'projects':
        return renderProjects();
      case 'calendar':
        return renderCalendar();
      case 'writing':
        return renderWriting();
      case 'settings':
        return renderSettings();
      case 'tasks':
      default:
        return (
          <div className="mobile-tasks">
            <MobileTaskList
              tasks={groupedTasks ? [] : sortedTasks}
              loading={loading}
              error={error}
              statusOptions={statusOptions}
              completedStatus={notionSettings?.completedStatus}
              onUpdateTask={handleUpdateTask}
              emptyMessage={
                tasks.length === 0
                  ? 'No tasks yet. Tap + to add one!'
                  : 'No tasks match your filters'
              }
              grouping={grouping}
              groups={groupedTasks ?? undefined}
            />
          </div>
        );
    }
  };

  return (
    <div className="mobile-app">
      {/* Header */}
      <header className="mobile-header">
        <button
          className="mobile-menu-button"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          <span className="mobile-hamburger">
            <span />
            <span />
            <span />
          </span>
        </button>
        
        <h1 className="mobile-title">{viewTitle}</h1>
        
        <button
          className="mobile-refresh-button"
          onClick={fetchTasks}
          aria-label="Refresh"
        >
          ⟳
        </button>
      </header>

      {/* Slide-out Menu */}
      <div className={`mobile-menu-overlay ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} />
      <nav className={`mobile-menu ${menuOpen ? 'open' : ''}`}>
        <div className="mobile-menu-header">
          <h2>Menu</h2>
          <button className="mobile-menu-close" onClick={() => setMenuOpen(false)}>✕</button>
        </div>
        
        <ul className="mobile-menu-items">
          {menuItems.map((item) => (
            <li key={item.id}>
              <button
                className={`mobile-menu-item ${viewMode === item.id ? 'active' : ''}`}
                onClick={() => navigateTo(item.id)}
              >
                <span className="mobile-menu-icon">{item.icon}</span>
                <span className="mobile-menu-label">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Filter Bar (for tasks view) */}
      {viewMode === 'tasks' && (
        <div className="mobile-filters">
          <div className="mobile-filter-row">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search tasks..."
            />
            <button
              className={`mobile-filter-toggle ${filterPanelOpen ? 'active' : ''}`}
              onClick={() => setFilterPanelOpen(!filterPanelOpen)}
              aria-label="Toggle filters"
            >
              <span className="filter-icon">⚙</span>
              {(statusFilter !== 'active' || matrixFilter !== 'all' || deadlineFilter !== 'all' || grouping !== 'none') && (
                <span className="filter-badge" />
              )}
            </button>
          </div>
          
          {/* Quick Day Filter Chips - Always visible */}
          <div className="mobile-filter-chips">
            <button
              className={`mobile-chip ${dayFilter === 'all' ? 'active' : ''}`}
              onClick={() => setDayFilter('all')}
            >
              All Dates
            </button>
            <button
              className={`mobile-chip ${dayFilter === 'today' ? 'active' : ''}`}
              onClick={() => setDayFilter('today')}
            >
              📅 Today
            </button>
            <button
              className={`mobile-chip ${dayFilter === 'week' ? 'active' : ''}`}
              onClick={() => setDayFilter('week')}
            >
              📆 Week
            </button>
          </div>
          
          {/* Expanded Filter Panel */}
          {filterPanelOpen && (
            <div className="mobile-filter-panel">
              {/* Status Filter */}
              <div className="mobile-filter-section">
                <span className="mobile-filter-label">Status</span>
                <div className="mobile-filter-options">
                  {STATUS_FILTERS.map((filter) => (
                    <button
                      key={filter.value}
                      className={`mobile-chip ${statusFilter === filter.value ? 'active' : ''}`}
                      onClick={() => setStatusFilter(filter.value)}
                    >
                      {filter.emoji ? `${filter.emoji} ` : ''}{filter.label}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Priority/Matrix Filter */}
              <div className="mobile-filter-section">
                <span className="mobile-filter-label">Priority (Eisenhower)</span>
                <div className="mobile-filter-options">
                  <button
                    className={`mobile-chip ${matrixFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setMatrixFilter('all')}
                  >
                    All
                  </button>
                  <button
                    className={`mobile-chip matrix-do-now ${matrixFilter === 'do-now' ? 'active' : ''}`}
                    onClick={() => setMatrixFilter('do-now')}
                  >
                    🔥 Do Now
                  </button>
                  <button
                    className={`mobile-chip matrix-deep-work ${matrixFilter === 'deep-work' ? 'active' : ''}`}
                    onClick={() => setMatrixFilter('deep-work')}
                  >
                    🧠 Deep Work
                  </button>
                  <button
                    className={`mobile-chip matrix-delegate ${matrixFilter === 'delegate' ? 'active' : ''}`}
                    onClick={() => setMatrixFilter('delegate')}
                  >
                    👋 Delegate
                  </button>
                  <button
                    className={`mobile-chip matrix-trash ${matrixFilter === 'trash' ? 'active' : ''}`}
                    onClick={() => setMatrixFilter('trash')}
                  >
                    🗑 Eliminate
                  </button>
                </div>
              </div>
              
              {/* Deadline Type Filter */}
              <div className="mobile-filter-section">
                <span className="mobile-filter-label">Deadline Type</span>
                <div className="mobile-filter-options">
                  <button
                    className={`mobile-chip ${deadlineFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setDeadlineFilter('all')}
                  >
                    All
                  </button>
                  <button
                    className={`mobile-chip ${deadlineFilter === 'hard' ? 'active' : ''}`}
                    onClick={() => setDeadlineFilter('hard')}
                  >
                    ⚠️ Hard Deadline
                  </button>
                  <button
                    className={`mobile-chip ${deadlineFilter === 'soft' ? 'active' : ''}`}
                    onClick={() => setDeadlineFilter('soft')}
                  >
                    📌 Soft Deadline
                  </button>
                </div>
              </div>
              
              {/* Sorting */}
              <div className="mobile-filter-section">
                <span className="mobile-filter-label">Sort By</span>
                <div className="mobile-filter-options">
                  <select
                    className="mobile-filter-select"
                    value={sortRules[0]?.property ?? 'dueDate'}
                    onChange={(e) => {
                      const property = e.target.value as 'dueDate' | 'status' | 'priority';
                      const newRules = sortRules.length > 0
                        ? [{ ...sortRules[0], property }, ...sortRules.slice(1)]
                        : [{ id: 'sort-1', property, direction: 'asc' as const }];
                      setSortRules(newRules);
                      localStorage.setItem(SORT_RULES_STORAGE_KEY, JSON.stringify(newRules.map(r => ({ property: r.property, direction: r.direction }))));
                    }}
                  >
                    <option value="dueDate">Due Date</option>
                    <option value="priority">Priority</option>
                    <option value="status">Status</option>
                  </select>
                  <button
                    className="mobile-chip"
                    onClick={() => {
                      const newDirection = sortRules[0]?.direction === 'asc' ? 'desc' : 'asc';
                      const newRules = sortRules.length > 0
                        ? [{ ...sortRules[0], direction: newDirection as 'asc' | 'desc' }, ...sortRules.slice(1)]
                        : [{ id: 'sort-1', property: 'dueDate' as const, direction: newDirection as 'asc' | 'desc' }];
                      setSortRules(newRules);
                      localStorage.setItem(SORT_RULES_STORAGE_KEY, JSON.stringify(newRules.map(r => ({ property: r.property, direction: r.direction }))));
                    }}
                  >
                    {sortRules[0]?.direction === 'asc' ? '↑ Ascending' : '↓ Descending'}
                  </button>
                </div>
              </div>
              
              {/* Grouping */}
              <div className="mobile-filter-section">
                <span className="mobile-filter-label">Group By</span>
                <div className="mobile-filter-options">
                  <button
                    className={`mobile-chip ${grouping === 'none' ? 'active' : ''}`}
                    onClick={() => {
                      setGrouping('none');
                      localStorage.setItem(GROUPING_STORAGE_KEY, 'none');
                    }}
                  >
                    None
                  </button>
                  <button
                    className={`mobile-chip ${grouping === 'dueDate' ? 'active' : ''}`}
                    onClick={() => {
                      setGrouping('dueDate');
                      localStorage.setItem(GROUPING_STORAGE_KEY, 'dueDate');
                    }}
                  >
                    📅 Date
                  </button>
                  <button
                    className={`mobile-chip ${grouping === 'status' ? 'active' : ''}`}
                    onClick={() => {
                      setGrouping('status');
                      localStorage.setItem(GROUPING_STORAGE_KEY, 'status');
                    }}
                  >
                    📋 Status
                  </button>
                  <button
                    className={`mobile-chip ${grouping === 'priority' ? 'active' : ''}`}
                    onClick={() => {
                      setGrouping('priority');
                      localStorage.setItem(GROUPING_STORAGE_KEY, 'priority');
                    }}
                  >
                    ⚡ Priority
                  </button>
                </div>
              </div>
              
              {/* Reset Filters Button */}
              <button
                className="mobile-reset-filters"
                onClick={() => {
                  setStatusFilter('active');
                  setDayFilter('all');
                  setMatrixFilter('all');
                  setDeadlineFilter('all');
                  setGrouping('none');
                  localStorage.setItem(GROUPING_STORAGE_KEY, 'none');
                }}
              >
                Reset All Filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Content */}
      <main className="mobile-content">
        {renderContent()}
      </main>

      {/* FAB for adding tasks */}
      {viewMode === 'tasks' && (
        <button
          className="mobile-fab"
          onClick={() => setQuickAddOpen(true)}
          aria-label="Add task"
        >
          +
        </button>
      )}

      {/* Quick Add Modal */}
      {quickAddOpen && (
        <div className="mobile-modal-overlay" onClick={() => setQuickAddOpen(false)}>
          <div className="mobile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-modal-header">
              <h2>Add Task</h2>
              <button onClick={() => setQuickAddOpen(false)}>✕</button>
            </div>
            <div className="mobile-modal-content">
              <QuickAdd
                onAdd={async (payload) => { await handleAddTask(payload); }}
                statusOptions={statusOptions}
                manualStatuses={[]}
                completedStatus={notionSettings?.completedStatus}
                isCollapsed={false}
                onCollapseToggle={() => {}}
                projects={projects}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileApp;

