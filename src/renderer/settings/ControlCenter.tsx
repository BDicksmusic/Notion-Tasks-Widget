import { useCallback, useEffect, useMemo, useState } from 'react';
import { isDesktopRuntime, platformBridge, settingsBridge, widgetBridge } from '@shared/platform';
import type {
  AppPreferences,
  ContactsSettings,
  DockEdge,
  DockState,
  FeatureToggles,
  ImportProgress,
  NotionSettings,
  ProjectsSettings,
  StatusBreakdown,
  StatusDiagnostics,
  TimeLogSettings,
  UpdateInfo,
  UpdateStatus,
  WritingSettings
} from '@shared/types';
import { extractDatabaseId } from '@shared/utils/notionUrl';
import { DatabaseVerification, VerifyAllDatabases } from '../components/DatabaseVerification';

type Feedback = {
  kind: 'success' | 'error';
  message: string;
};

type Section =
  | 'setup'
  | 'general'
  | 'api'
  | 'features'
  | 'tasks'
  | 'writing'
  | 'timelog'
  | 'projects'
  | 'widget'
  | 'import'
  | 'mcp'
  | 'shortcuts'
  | 'about';

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'setup', label: 'Setup & Status', icon: '🚀' },
  { id: 'general', label: 'General', icon: '⚙️' },
  { id: 'api', label: 'API & Credentials', icon: '🔑' },
  { id: 'features', label: 'Features', icon: '🎛️' },
  { id: 'tasks', label: 'Tasks', icon: '✓' },
  { id: 'writing', label: 'Writing', icon: '✍️' },
  { id: 'timelog', label: 'Time Tracking', icon: '⏱️' },
  { id: 'projects', label: 'Projects', icon: '📁' },
  { id: 'widget', label: 'Widget', icon: '🪟' },
  { id: 'import', label: 'Import & Sync', icon: '📥' },
  { id: 'mcp', label: 'MCP Servers', icon: '🔌' },
  { id: 'shortcuts', label: 'Shortcuts', icon: '⌨️' },
  { id: 'about', label: 'About', icon: 'ℹ️' }
];

const TASK_SHORTCUTS = [
  { keys: '↑ / ↓', description: 'Move selection in task list' },
  { keys: 'Enter', description: 'Toggle focus on selected task' },
  { keys: 'Shift + Enter', description: 'Complete/undo selected task' },
  { keys: 'Cmd/Ctrl + O', description: 'Open selected task in Notion' },
  { keys: 'Cmd/Ctrl + Shift + P', description: 'Pop selected task into a floating window' }
];

const FULLSCREEN_SHORTCUTS = [
  { keys: 'Cmd/Ctrl + \\', description: 'Toggle navigation sidebar' },
  { keys: 'Cmd/Ctrl + Shift + \\', description: 'Toggle header visibility' },
  { keys: 'Cmd/Ctrl + 1-4', description: 'Switch to Tasks / Projects / Calendar / Writing' },
  { keys: 'Alt + 1-4', description: 'Toggle panels in current view (based on order)' },
  { keys: '[ / ]', description: 'Navigate to previous / next view' },
  { keys: 'H', description: 'Toggle header' },
  { keys: 'B', description: 'Toggle sidebar' },
  { keys: 'F', description: 'Toggle filters panel' },
  { keys: 'S', description: 'Toggle sort panel' },
  { keys: 'G', description: 'Toggle grouping panel' },
  { keys: 'N', description: 'Toggle notes panel' },
  { keys: 'Q', description: 'Toggle quick add panel' },
  { keys: 'D', description: 'Cycle day filter (All → Today → Week)' },
  { keys: 'T', description: 'Jump to today (in Calendar view)' },
  { keys: 'P', description: 'Exit project workspace' },
  { keys: '← / →', description: 'Navigate calendar (in Calendar view)' },
  { keys: 'Escape', description: 'Close panels / exit modes' },
  { keys: 'Cmd/Ctrl + R', description: 'Refresh tasks' },
  { keys: 'Cmd/Ctrl + N', description: 'New task (focus quick add)' },
  { keys: 'Cmd/Ctrl + F', description: 'Focus search' },
  { keys: 'Cmd/Ctrl + ,', description: 'Open settings' }
];

const DEFAULT_PREFERENCES: AppPreferences = {
  launchOnStartup: false,
  enableNotifications: true,
  enableSounds: true,
  alwaysOnTop: true,
  pinWidget: false,
  autoRefreshTasks: false,
  expandMode: 'hover',
  autoCollapse: true,
  preventMinimalDuringSession: true
};

const DEFAULT_FEATURE_TOGGLES: FeatureToggles = {
  // Core modules
  enableTimeTracking: true,
  enableEisenhowerMatrix: true,
  enableProjects: true,
  enableWriting: true,
  enableChatbot: true,
  enableRecurrence: true,
  enableReminders: true,
  enableSubtasks: true,
  enableDeadlineTypes: true,
  // Task properties
  showMainEntry: true,
  showSessionLength: true,
  showEstimatedLength: true,
  showPriorityOrder: true,
  // Views
  showTaskListView: true,
  showMatrixView: true,
  showKanbanView: true,
  showCalendarView: true,
  showGanttView: true,
  showTimeLogView: true,
  // Quick add
  quickAddShowDeadlineToggle: true,
  quickAddShowMatrixPicker: true,
  quickAddShowProjectPicker: true,
  quickAddShowNotes: true,
  quickAddShowDragToPlace: true,
  // Interface
  showStatusFilters: true,
  showMatrixFilters: true,
  showDayFilters: true,
  showGroupingControls: true,
  showSortControls: true,
  showSearchBar: true,
  compactTaskRows: false
};

const widgetAPI = widgetBridge;
const settingsAPI = settingsBridge;

interface ControlCenterProps {
  initialSection?: Section;
}

const ControlCenter = ({ initialSection }: ControlCenterProps) => {
  const [activeSection, setActiveSection] = useState<Section>(initialSection ?? 'setup');
  
  // Settings state
  const [taskSettings, setTaskSettings] = useState<NotionSettings | null>(null);
  const [writingSettings, setWritingSettings] = useState<WritingSettings | null>(null);
  const [timeLogSettings, setTimeLogSettings] = useState<TimeLogSettings | null>(null);
  const [projectsSettings, setProjectsSettings] = useState<ProjectsSettings | null>(null);
  const [contactsSettings, setContactsSettings] = useState<ContactsSettings | null>(null);
  const [appPreferences, setAppPreferences] = useState<AppPreferences | null>(null);
  const [featureToggles, setFeatureToggles] = useState<FeatureToggles | null>(null);
  const [dockState, setDockState] = useState<DockState | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  
  // Loading states
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [taskSaving, setTaskSaving] = useState(false);
  const [writingSaving, setWritingSaving] = useState(false);
  const [timeLogSaving, setTimeLogSaving] = useState(false);
  const [projectsSaving, setProjectsSaving] = useState(false);
  const [contactsSaving, setContactsSaving] = useState(false);
  const [fetchingProjectStatuses, setFetchingProjectStatuses] = useState(false);
  
  // Feedback
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  
  // Update state
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string>('1.0.0');
  
  // Import state
  const [importProgress, setImportProgress] = useState<ImportProgress>({
    status: 'idle',
    tasksImported: 0,
    pagesProcessed: 0,
    currentPage: 0
  });
  const [isImporting, setIsImporting] = useState(false);
  
  // Modular import state
  const [importingProjects, setImportingProjects] = useState(false);
  const [importingTimeLogs, setImportingTimeLogs] = useState(false);
  const [syncTimestamps, setSyncTimestamps] = useState<{ tasks: string | null; projects: string | null; timeLogs: string | null } | null>(null);
  const [statusDiagnostics, setStatusDiagnostics] = useState<StatusDiagnostics | null>(null);
  const [statusDiagnosticsLoading, setStatusDiagnosticsLoading] = useState(false);
  
  // Connection status state
  const [connectionStatus, setConnectionStatus] = useState<{
    connected: boolean;
    hasApiKey: boolean;
    hasDatabaseId: boolean;
    mode: 'synced' | 'local-only';
  } | null>(null);
  const [connectionChecking, setConnectionChecking] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);
  const [statusDiagnosticsError, setStatusDiagnosticsError] = useState<string | null>(null);
  
  // Environment variable import
  const [envText, setEnvText] = useState('');
  const [envImportFeedback, setEnvImportFeedback] = useState<Feedback | null>(null);

  const loadStatusDiagnostics = useCallback(async () => {
    if (!isDesktopRuntime) return;
    try {
      setStatusDiagnosticsLoading(true);
      setStatusDiagnosticsError(null);
      const diagnostics = await widgetAPI.getStatusDiagnostics();
      setStatusDiagnostics(diagnostics);
    } catch (err) {
      setStatusDiagnosticsError(
        err instanceof Error ? err.message : 'Unable to load diagnostics'
      );
    } finally {
      setStatusDiagnosticsLoading(false);
    }
  }, []);

  const formatTimestamp = (iso?: string | null) => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return iso;
    }
    return date.toLocaleString();
  };

  const renderStatusSummaryCard = (
    label: string,
    summary?: StatusBreakdown | null
  ) => {
    const topStatuses = summary?.statuses.slice(0, 5) ?? [];
    return (
      <div
        key={label}
        className="status-diagnostics-card"
        style={{
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: 16,
          background: 'var(--layer-1)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        <div
          className="status-card-header"
          style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}
        >
          <span>{label}</span>
          <span>{summary ? `${summary.total} total` : '—'}</span>
        </div>
        {summary ? (
          <>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>
              {summary.withStatus} with status · {summary.withoutStatus} missing
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {topStatuses.length === 0 ? (
                <li style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  No statuses cached
                </li>
              ) : (
                topStatuses.map((entry) => (
                  <li
                    key={`${label}-${entry.name}`}
                    style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}
                  >
                    <span>{entry.name}</span>
                    <span>{entry.count}</span>
                  </li>
                ))
              )}
            </ul>
            {summary.lastUpdated && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                Updated {formatTimestamp(summary.lastUpdated)}
              </p>
            )}
          </>
        ) : (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>
            {statusDiagnosticsLoading ? 'Loading…' : 'No cached data yet'}
          </p>
        )}
      </div>
    );
  };

  // Load all settings on mount
  useEffect(() => {
    let cancelled = false;
    let unsubscribeDock: (() => void) | undefined;
    let unsubscribeUpdate: (() => void) | undefined;
    let unsubscribeImport: (() => void) | undefined;

    async function bootstrap() {
      // If not in desktop runtime (browser dev mode), show mock data
      if (!isDesktopRuntime) {
        setTaskSettings({
          apiKey: '',
          databaseId: '',
          titleProperty: 'Name',
          statusProperty: 'Status',
          dateProperty: 'Date',
          deadlineProperty: 'Hard Deadline?',
          deadlineHardValue: '⭕Hard',
          deadlineSoftValue: '🔵Soft',
          statusPresets: [],
          urgentProperty: 'Urgent',
          urgentStatusActive: '‼',
          urgentStatusInactive: '○',
          importantProperty: 'Important',
          importantStatusActive: '◉',
          importantStatusInactive: '○',
          completedStatus: '✅'
        });
        setWritingSettings({
          databaseId: '',
          titleProperty: 'Name'
        });
        setTimeLogSettings({
          databaseId: ''
        });
        setProjectsSettings({
          databaseId: ''
        });
        setAppPreferences(DEFAULT_PREFERENCES);
        setFeatureToggles(DEFAULT_FEATURE_TOGGLES);
        setDockState({ edge: 'top', collapsed: false });
        setLoading(false);
        return;
      }

      try {
        const [
          tasks,
          writing,
          timeLog,
          projects,
          contacts,
          prefs,
          features,
          dock,
          atop
        ] = await Promise.all([
          settingsAPI.getTaskSettings(),
          settingsAPI.getWritingSettings(),
          settingsAPI.getTimeLogSettings(),
          settingsAPI.getProjectsSettings(),
          settingsAPI.getContactsSettings(),
          widgetAPI.getAppPreferences(),
          settingsAPI.getFeatureToggles(),
          widgetAPI.getDockState(),
          widgetAPI.getAlwaysOnTop()
        ]);
        if (!cancelled) {
          setTaskSettings(tasks);
          setWritingSettings(writing);
          setTimeLogSettings(timeLog);
          setProjectsSettings(projects);
          setContactsSettings(contacts);
          setAppPreferences(prefs);
          setFeatureToggles(features);
          setDockState(dock ?? null);
          setAlwaysOnTop(atop);
          setLoading(false);
          loadStatusDiagnostics();
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : 'Unable to load settings'
          );
          setLoading(false);
        }
      }
    }
    bootstrap();

    // Only set up listeners in desktop mode
    if (isDesktopRuntime) {
      try {
        // Listen for state changes
        unsubscribeDock = widgetAPI.onDockStateChange((state) => {
          if (!cancelled) setDockState(state);
        });

        // Get app version
        widgetAPI.getAppVersion().then(setCurrentVersion).catch(() => {
          setCurrentVersion('1.0.0');
        });

        // Get sync timestamps
        widgetAPI.getSyncTimestamps().then(setSyncTimestamps).catch(() => {});

        // Get Notion connection status
        widgetAPI.getNotionConnectionStatus().then(setConnectionStatus).catch(() => {
          setConnectionStatus({ connected: false, hasApiKey: false, hasDatabaseId: false, mode: 'local-only' });
        });

        // Get update status
        widgetAPI.getUpdateStatus().then(({ status, info }) => {
          setUpdateStatus(status);
          setUpdateInfo(info);
        }).catch(() => {});

        unsubscribeUpdate = widgetAPI.onUpdateStatusChange(({ status, info }) => {
          setUpdateStatus(status);
          setUpdateInfo(info);
          if (status === 'downloading') {
            setIsDownloading(true);
            setIsChecking(false);
          } else if (status === 'ready' || status === 'error' || status === 'not-available') {
            setIsDownloading(false);
            setIsChecking(false);
          }
        });

        // Get import progress
        widgetAPI.getImportProgress().then(setImportProgress).catch(() => {});

        unsubscribeImport = widgetAPI.onImportProgress((progress) => {
          setImportProgress(progress);
          setIsImporting(progress.status === 'running');
        });
      } catch (err) {
        console.warn('Failed to set up desktop listeners:', err);
      }
    }

    return () => {
      cancelled = true;
      unsubscribeDock?.();
      unsubscribeUpdate?.();
      unsubscribeImport?.();
    };
  }, [loadStatusDiagnostics]);

  // Clear feedback after timeout
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  // ============ HANDLERS ============

  // Task settings handlers
  const handleTaskFieldChange = useCallback(
    (field: keyof NotionSettings, value: string) => {
      if (field === 'databaseId') {
        const extracted = extractDatabaseId(value);
        setTaskSettings((prev) => (prev ? { ...prev, [field]: extracted } : prev));
      } else {
        setTaskSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
      }
    },
    []
  );

  const handleStatusPresetsChange = useCallback((value: string) => {
    const entries = value.split('\n').map((line) => line.trim()).filter(Boolean);
    setTaskSettings((prev) => (prev ? { ...prev, statusPresets: entries } : prev));
  }, []);

  const handleProjectStatusPresetsChange = useCallback((value: string) => {
    const entries = value.split('\n').map((line) => line.trim()).filter(Boolean);
    setProjectsSettings((prev) => (prev ? { ...prev, statusPresets: entries } : prev));
  }, []);

  // Test Notion connection
  const handleTestConnection = useCallback(async () => {
    if (!isDesktopRuntime) {
      setConnectionTestResult({ success: true, message: 'Preview mode - no real connection' });
      return;
    }
    try {
      setTestingConnection(true);
      setConnectionTestResult(null);
      const result = await widgetAPI.testConnection();
      setConnectionTestResult(result);
      // Refresh connection status after test
      const status = await widgetAPI.getNotionConnectionStatus();
      setConnectionStatus(status);
    } catch (err) {
      setConnectionTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Connection test failed'
      });
    } finally {
      setTestingConnection(false);
    }
  }, []);

  const handleTaskSave = useCallback(async () => {
    if (!taskSettings) return;
    if (!isDesktopRuntime) {
      setFeedback({ kind: 'success', message: 'Task settings saved (preview mode)' });
      return;
    }
    try {
      setTaskSaving(true);
      const saved = await settingsAPI.updateTaskSettings(taskSettings);
      setTaskSettings(saved);
      setFeedback({ kind: 'success', message: 'Task settings saved' });
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unable to save task settings'
      });
    } finally {
      setTaskSaving(false);
    }
  }, [taskSettings]);

  // Writing settings handlers
  const handleWritingFieldChange = useCallback(
    (field: keyof WritingSettings, value: string) => {
      if (field === 'databaseId') {
        const extracted = extractDatabaseId(value);
        setWritingSettings((prev) => (prev ? { ...prev, [field]: extracted } : prev));
      } else {
        setWritingSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
      }
    },
    []
  );

  const handleWritingSave = useCallback(async () => {
    if (!writingSettings) return;
    if (!isDesktopRuntime) {
      setFeedback({ kind: 'success', message: 'Writing settings saved (preview mode)' });
      return;
    }
    try {
      setWritingSaving(true);
      const saved = await settingsAPI.updateWritingSettings(writingSettings);
      setWritingSettings(saved);
      setFeedback({ kind: 'success', message: 'Writing settings saved' });
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unable to save writing settings'
      });
    } finally {
      setWritingSaving(false);
    }
  }, [writingSettings]);

  // Time log settings handlers
  const handleTimeLogFieldChange = useCallback(
    (field: keyof TimeLogSettings, value: string) => {
      if (field === 'databaseId') {
        const extracted = extractDatabaseId(value);
        setTimeLogSettings((prev) => (prev ? { ...prev, [field]: extracted } : prev));
      } else {
        setTimeLogSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
      }
    },
    []
  );

  const handleTimeLogSave = useCallback(async () => {
    if (!timeLogSettings) return;
    if (!isDesktopRuntime) {
      setFeedback({ kind: 'success', message: 'Time tracking settings saved (preview mode)' });
      return;
    }
    try {
      setTimeLogSaving(true);
      const saved = await settingsAPI.updateTimeLogSettings(timeLogSettings);
      setTimeLogSettings(saved);
      setFeedback({ kind: 'success', message: 'Time tracking settings saved' });
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unable to save time tracking settings'
      });
    } finally {
      setTimeLogSaving(false);
    }
  }, [timeLogSettings]);

  // Projects settings handlers
  const handleProjectsFieldChange = useCallback(
    (field: keyof ProjectsSettings, value: string) => {
      if (field === 'databaseId') {
        const extracted = extractDatabaseId(value);
        setProjectsSettings((prev) => (prev ? { ...prev, [field]: extracted } : prev));
      } else {
        setProjectsSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
      }
    },
    []
  );

  const handleContactsFieldChange = useCallback(
    (field: keyof ContactsSettings, value: string) => {
      if (field === 'databaseId') {
        const extracted = extractDatabaseId(value);
        setContactsSettings((prev) => (prev ? { ...prev, [field]: extracted } : prev));
      } else {
        setContactsSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
      }
    },
    []
  );

  const handleProjectsSave = useCallback(async () => {
    if (!projectsSettings) return;
    if (!isDesktopRuntime) {
      setFeedback({ kind: 'success', message: 'Projects settings saved (preview mode)' });
      return;
    }
    try {
      setProjectsSaving(true);
      const saved = await settingsAPI.updateProjectsSettings(projectsSettings);
      setProjectsSettings(saved);
      setFeedback({ kind: 'success', message: 'Projects settings saved' });
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unable to save projects settings'
      });
    } finally {
      setProjectsSaving(false);
    }
  }, [projectsSettings]);

  const handleContactsSave = useCallback(async () => {
    if (!contactsSettings) return;
    if (!isDesktopRuntime) {
      setFeedback({ kind: 'success', message: 'Contacts settings saved (preview mode)' });
      return;
    }
    try {
      setContactsSaving(true);
      const saved = await settingsAPI.updateContactsSettings(contactsSettings);
      setContactsSettings(saved);
      setFeedback({ kind: 'success', message: 'Contacts settings saved' });
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unable to save contacts settings'
      });
    } finally {
      setContactsSaving(false);
    }
  }, [contactsSettings]);

  const handleFetchProjectStatusOptions = useCallback(async () => {
    if (!isDesktopRuntime) {
      setFeedback({ kind: 'error', message: 'Not available in preview mode' });
      return;
    }
    try {
      setFetchingProjectStatuses(true);
      const options = await widgetAPI.fetchAndSaveProjectStatusOptions();
      if (options.length > 0) {
        // Reload settings to get the cached options
        const updated = await widgetAPI.getProjectsSettings();
        setProjectsSettings(updated);
        setFeedback({ kind: 'success', message: `Fetched ${options.length} status options from Notion` });
      } else {
        setFeedback({ kind: 'error', message: 'No status options found. Check your Status Property setting.' });
      }
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to fetch status options'
      });
    } finally {
      setFetchingProjectStatuses(false);
    }
  }, []);

  const handleImportProjects = useCallback(async () => {
    if (!isDesktopRuntime) {
      setFeedback({ kind: 'error', message: 'Not available in preview mode' });
      return;
    }
    try {
      setImportingProjects(true);
      const result = await widgetAPI.importProjects();
      if (result.success) {
        setFeedback({ kind: 'success', message: `Imported ${result.count} projects from Notion` });
        // Refresh timestamps
        const timestamps = await widgetAPI.getSyncTimestamps();
        setSyncTimestamps(timestamps);
        await loadStatusDiagnostics();
      } else {
        setFeedback({ kind: 'error', message: result.error || 'Failed to import projects' });
      }
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to import projects'
      });
    } finally {
      setImportingProjects(false);
    }
  }, [loadStatusDiagnostics]);

  const handleImportTimeLogs = useCallback(async () => {
    if (!isDesktopRuntime) {
      setFeedback({ kind: 'error', message: 'Not available in preview mode' });
      return;
    }
    try {
      setImportingTimeLogs(true);
      const result = await widgetAPI.importTimeLogs();
      if (result.success) {
        setFeedback({ kind: 'success', message: `Imported ${result.count} time logs from Notion` });
        // Refresh timestamps
        const timestamps = await widgetAPI.getSyncTimestamps();
        setSyncTimestamps(timestamps);
      } else {
        setFeedback({ kind: 'error', message: result.error || 'Failed to import time logs' });
      }
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to import time logs'
      });
    } finally {
      setImportingTimeLogs(false);
    }
  }, []);

  const loadSyncTimestamps = useCallback(async () => {
    if (!isDesktopRuntime) return;
    try {
      const timestamps = await widgetAPI.getSyncTimestamps();
      setSyncTimestamps(timestamps);
    } catch {
      // Ignore errors
    }
  }, []);

  // App preferences handlers
  const handleAppPreferenceChange = useCallback(
    async (changes: Partial<AppPreferences>) => {
      const previous = appPreferences ?? DEFAULT_PREFERENCES;
      const next = { ...previous, ...changes };
      setAppPreferences(next);
      if (!isDesktopRuntime) {
        setFeedback({ kind: 'success', message: 'Preferences updated (preview mode)' });
        return;
      }
      try {
        const saved = await widgetAPI.updateAppPreferences(next);
        setAppPreferences(saved);
        setFeedback({ kind: 'success', message: 'Preferences updated' });
      } catch (err) {
        setAppPreferences(previous);
        setFeedback({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Unable to update preferences'
        });
      }
    },
    [appPreferences]
  );

  // Feature toggles handler
  const handleFeatureToggleChange = useCallback(
    async (changes: Partial<FeatureToggles>) => {
      const previous = featureToggles ?? DEFAULT_FEATURE_TOGGLES;
      const next = { ...previous, ...changes };
      setFeatureToggles(next);
      if (!isDesktopRuntime) {
        setFeedback({ kind: 'success', message: 'Feature settings updated (preview mode)' });
        return;
      }
      try {
        const saved = await settingsAPI.updateFeatureToggles(next);
        setFeatureToggles(saved);
        setFeedback({ kind: 'success', message: 'Feature settings updated' });
      } catch (err) {
        setFeatureToggles(previous);
        setFeedback({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Unable to update feature settings'
        });
      }
    },
    [featureToggles]
  );

  const handleLaunchOnStartupToggle = useCallback(
    async (next: boolean) => {
      const previous = appPreferences ?? DEFAULT_PREFERENCES;
      setAppPreferences({ ...previous, launchOnStartup: next });
      if (!isDesktopRuntime) {
        setFeedback({ kind: 'success', message: 'Startup preference saved (preview mode)' });
        return;
      }
      try {
        const saved = await widgetAPI.setLaunchOnStartup(next);
        setAppPreferences(saved);
        setFeedback({ kind: 'success', message: 'Startup preference saved' });
      } catch (err) {
        setAppPreferences(previous);
        setFeedback({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Unable to change startup preference'
        });
      }
    },
    [appPreferences]
  );

  const handleAlwaysOnTopToggle = useCallback(
    async (next: boolean) => {
      setAlwaysOnTop(next);
      if (!isDesktopRuntime) {
        setFeedback({ kind: 'success', message: 'Always on top updated (preview mode)' });
        return;
      }
      try {
        const result = await widgetAPI.setAlwaysOnTop(next);
        setAlwaysOnTop(result);
        await handleAppPreferenceChange({ alwaysOnTop: result });
      } catch (err) {
        setFeedback({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Unable to change always-on-top preference'
        });
      }
    },
    [handleAppPreferenceChange]
  );

  const handleDockEdgeChange = useCallback(async (edge: DockEdge) => {
    setDockState((prev) => prev ? { ...prev, edge } : { edge, collapsed: false });
    if (!isDesktopRuntime) {
      setFeedback({ kind: 'success', message: `Dock edge changed to ${edge} (preview mode)` });
      return;
    }
    try {
      await widgetAPI.requestExpand();
      await widgetAPI.setDockEdge(edge);
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unable to change dock edge'
      });
    }
  }, []);

  const handlePreviewNotification = useCallback(async () => {
    if (!isDesktopRuntime) {
      setFeedback({ kind: 'success', message: 'Notification preview (preview mode)' });
      return;
    }
    try {
      await settingsAPI.previewNotification({
        title: 'Notion Widgets',
        body: 'Notification preview sent from Control Center.'
      });
      setFeedback({ kind: 'success', message: 'Notification preview sent' });
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unable to preview notification'
      });
    }
  }, []);

  // Update handlers
  const handleCheckForUpdates = async () => {
    if (!isDesktopRuntime) {
      setFeedback({ kind: 'success', message: 'Check for updates (preview mode)' });
      return;
    }
    setIsChecking(true);
    try {
      const result = await widgetAPI.checkForUpdates();
      setUpdateStatus(result.status);
      setUpdateInfo(result.info);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setUpdateStatus('error');
      setUpdateInfo({ version: 'unknown', error: errorMessage });
    } finally {
      setIsChecking(false);
    }
  };

  const handleDownloadUpdate = async () => {
    if (!isDesktopRuntime) return;
    setIsDownloading(true);
    try {
      await widgetAPI.downloadUpdate();
    } catch (error) {
      setUpdateStatus('error');
      setUpdateInfo({
        version: updateInfo?.version || 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      setIsDownloading(false);
    }
  };

  const handleInstallUpdate = () => {
    if (!isDesktopRuntime) return;
    try {
      widgetAPI.installUpdate();
    } catch (error) {
      console.error('Failed to install update:', error);
    }
  };

  // Import handlers
  const handleStartImport = async () => {
    if (!isDesktopRuntime) {
      setFeedback({ kind: 'success', message: 'Import started (preview mode)' });
      return;
    }
    setIsImporting(true);
    try {
      await widgetAPI.performInitialImport();
    } catch (error) {
      console.error('Failed to start import:', error);
      setIsImporting(false);
    }
  };

  const handleResetImport = async () => {
    if (!isDesktopRuntime) {
      setImportProgress({
        status: 'idle',
        tasksImported: 0,
        pagesProcessed: 0,
        currentPage: 0
      });
      return;
    }
    try {
      await widgetAPI.resetImport();
      setImportProgress({
        status: 'idle',
        tasksImported: 0,
        pagesProcessed: 0,
        currentPage: 0
      });
    } catch (error) {
      console.error('Failed to reset import:', error);
    }
  };

  // Environment variable import handler
  const handleEnvImport = useCallback(() => {
    if (!envText.trim()) {
      setEnvImportFeedback({ kind: 'error', message: 'Please paste your environment variables first' });
      return;
    }

    const lines = envText.split('\n');
    const updates: Partial<{
      taskApiKey: string;
      taskDatabaseId: string;
      taskDataSourceId: string;
      writingApiKey: string;
      writingDatabaseId: string;
      timeLogApiKey: string;
      timeLogDatabaseId: string;
      projectsApiKey: string;
      projectsDatabaseId: string;
    }> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      
      switch (key) {
        case 'NOTION_API_KEY':
          updates.taskApiKey = value;
          break;
        case 'NOTION_DATABASE_ID':
          updates.taskDatabaseId = extractDatabaseId(value);
          break;
        case 'NOTION_DATA_SOURCE_ID':
          updates.taskDataSourceId = value;
          break;
        case 'NOTION_WRITING_API_KEY':
          updates.writingApiKey = value;
          break;
        case 'NOTION_WRITING_DATABASE_ID':
          updates.writingDatabaseId = extractDatabaseId(value);
          break;
        case 'NOTION_TIME_LOG_API_KEY':
          updates.timeLogApiKey = value;
          break;
        case 'NOTION_TIME_LOG_DATABASE_ID':
          updates.timeLogDatabaseId = extractDatabaseId(value);
          break;
        case 'NOTION_PROJECTS_API_KEY':
          updates.projectsApiKey = value;
          break;
        case 'NOTION_PROJECTS_DATABASE_ID':
          updates.projectsDatabaseId = extractDatabaseId(value);
          break;
      }
    }

    // Apply updates
    if (updates.taskApiKey || updates.taskDatabaseId || updates.taskDataSourceId) {
      setTaskSettings((prev) => prev ? {
        ...prev,
        apiKey: updates.taskApiKey ?? prev.apiKey,
        databaseId: updates.taskDatabaseId ?? prev.databaseId,
        dataSourceId: updates.taskDataSourceId ?? prev.dataSourceId
      } : prev);
    }

    if (updates.writingApiKey || updates.writingDatabaseId) {
      setWritingSettings((prev) => prev ? {
        ...prev,
        apiKey: updates.writingApiKey ?? prev.apiKey,
        databaseId: updates.writingDatabaseId ?? prev.databaseId
      } : prev);
    }

    if (updates.timeLogApiKey || updates.timeLogDatabaseId) {
      setTimeLogSettings((prev) => prev ? {
        ...prev,
        apiKey: updates.timeLogApiKey ?? prev.apiKey,
        databaseId: updates.timeLogDatabaseId ?? prev.databaseId
      } : prev);
    }

    if (updates.projectsApiKey || updates.projectsDatabaseId) {
      setProjectsSettings((prev) => prev ? {
        ...prev,
        apiKey: updates.projectsApiKey ?? prev.apiKey,
        databaseId: updates.projectsDatabaseId ?? prev.databaseId
      } : prev);
    }

    const count = Object.keys(updates).length;
    if (count > 0) {
      setEnvImportFeedback({ 
        kind: 'success', 
        message: `Imported ${count} value${count !== 1 ? 's' : ''}. Remember to save each section!` 
      });
      setEnvText('');
    } else {
      setEnvImportFeedback({ kind: 'error', message: 'No recognized environment variables found' });
    }
  }, [envText]);

  // Misc handlers
  const handleToggleWidget = useCallback(() => {
    if (!isDesktopRuntime) {
      setDockState((prev) => prev ? { ...prev, collapsed: !prev.collapsed } : null);
      return;
    }
    if (!dockState || dockState.collapsed) {
      widgetAPI.requestExpand();
    } else {
      widgetAPI.requestCollapse();
    }
  }, [dockState]);

  const handleClose = () => {
    if (!isDesktopRuntime) {
      setFeedback({ kind: 'success', message: 'Window close (preview mode)' });
      return;
    }
    widgetAPI.closeWindow();
  };

  const statusPresetsText = useMemo(() => {
    return (taskSettings?.statusPresets ?? []).join('\n');
  }, [taskSettings]);

  const projectStatusPresetsText = useMemo(() => {
    return (projectsSettings?.statusPresets ?? []).join('\n');
  }, [projectsSettings]);

  const preferences = appPreferences ?? DEFAULT_PREFERENCES;

  // ============ RENDER ============

  if (loading) {
    return (
      <div className="control-center">
        <div className="control-center-loading">
          <div className="spinner" />
          <p>Loading settings…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="control-center">
        <div className="control-center-error">
          <p>{loadError}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="control-center">
      <aside className="control-center-sidebar">
        <div className="sidebar-header">
          <h1>Control Center</h1>
          <p>Configure your widgets</p>
        </div>
        <nav className="sidebar-nav">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`nav-item ${activeSection === section.id ? 'active' : ''}`}
              onClick={() => setActiveSection(section.id)}
            >
              <span className="nav-icon">{section.icon}</span>
              <span className="nav-label">{section.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-action"
            onClick={handleToggleWidget}
          >
            {dockState?.collapsed ? '↗ Show Widget' : '↙ Hide Widget'}
          </button>
        </div>
      </aside>

      <main className="control-center-content">
        <header className="content-header">
          <div className="header-info">
            <h2>{SECTIONS.find((s) => s.id === activeSection)?.label}</h2>
          </div>
          <div className="header-actions">
            {feedback && (
              <span className={`header-feedback ${feedback.kind}`}>
                {feedback.message}
              </span>
            )}
            <button
              type="button"
              className="close-button"
              onClick={handleClose}
              aria-label="Close Control Center"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="content-body">
          {/* SETUP & STATUS SECTION */}
          {activeSection === 'setup' && (
            <section className="settings-section">
              <div className="section-group welcome-section">
                <h3>Welcome to Task Widget</h3>
                <p className="section-description">
                  Your personal productivity command center. The app works fully offline with local data, 
                  and optionally syncs with Notion for cloud storage.
                </p>
              </div>

              <div className="section-group">
                <h3>Connection Status</h3>
                <div className="connection-status-card">
                  <div className="status-indicator">
                    <span className={`status-dot ${connectionStatus?.connected ? 'connected' : 'disconnected'}`} />
                    <span className="status-label">
                      {connectionStatus?.connected ? 'Connected to Notion' : 'Local-Only Mode'}
                    </span>
                  </div>
                  <div className="status-details">
                    <div className="status-item">
                      <span className="status-check">{connectionStatus?.hasApiKey ? '✓' : '○'}</span>
                      <span>API Key configured</span>
                    </div>
                    <div className="status-item">
                      <span className="status-check">{connectionStatus?.hasDatabaseId ? '✓' : '○'}</span>
                      <span>Database ID configured</span>
                    </div>
                  </div>
                  {connectionTestResult && (
                    <div className={`connection-test-result ${connectionTestResult.success ? 'success' : 'error'}`}>
                      {connectionTestResult.message}
                      {connectionTestResult.latencyMs && ` (${connectionTestResult.latencyMs}ms)`}
                    </div>
                  )}
                  <div className="status-actions">
                    <button 
                      type="button" 
                      className="btn-secondary"
                      onClick={handleTestConnection}
                      disabled={testingConnection || !connectionStatus?.hasApiKey}
                    >
                      {testingConnection ? 'Testing...' : 'Test Connection'}
                    </button>
                    <button 
                      type="button" 
                      className="btn-primary"
                      onClick={() => setActiveSection('api')}
                    >
                      {connectionStatus?.hasApiKey ? 'Update Credentials' : 'Set Up Notion'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="section-group">
                <h3>Quick Actions</h3>
                <div className="quick-actions-grid">
                  <button 
                    type="button" 
                    className="quick-action-card"
                    onClick={() => setActiveSection('tasks')}
                  >
                    <span className="quick-action-icon">✓</span>
                    <span className="quick-action-label">Task Settings</span>
                    <span className="quick-action-desc">Configure task properties & status</span>
                  </button>
                  <button 
                    type="button" 
                    className="quick-action-card"
                    onClick={() => setActiveSection('projects')}
                  >
                    <span className="quick-action-icon">📁</span>
                    <span className="quick-action-label">Projects</span>
                    <span className="quick-action-desc">Set up project database</span>
                  </button>
                  <button 
                    type="button" 
                    className="quick-action-card"
                    onClick={() => setActiveSection('features')}
                  >
                    <span className="quick-action-icon">🎛️</span>
                    <span className="quick-action-label">Features</span>
                    <span className="quick-action-desc">Enable/disable widgets</span>
                  </button>
                  <button 
                    type="button" 
                    className="quick-action-card"
                    onClick={() => setActiveSection('import')}
                  >
                    <span className="quick-action-icon">📥</span>
                    <span className="quick-action-label">Import & Sync</span>
                    <span className="quick-action-desc">Sync data with Notion</span>
                  </button>
                </div>
              </div>

              {!connectionStatus?.connected && (
                <div className="section-group info-box">
                  <h3>💡 Running in Local-Only Mode</h3>
                  <p className="section-description">
                    Your tasks and data are stored locally on this device. To sync across devices and 
                    with Notion, add your API key in the <strong>API & Credentials</strong> section.
                  </p>
                  <p className="section-description">
                    Local mode is fully functional - you can add tasks, track time, and manage projects 
                    without any Notion connection.
                  </p>
                </div>
              )}

              {syncTimestamps && (
                <div className="section-group">
                  <h3>Last Sync</h3>
                  <div className="sync-timestamps">
                    <div className="sync-timestamp-item">
                      <span className="sync-label">Tasks:</span>
                      <span className="sync-time">{syncTimestamps.tasks ? new Date(syncTimestamps.tasks).toLocaleString() : 'Never'}</span>
                    </div>
                    <div className="sync-timestamp-item">
                      <span className="sync-label">Projects:</span>
                      <span className="sync-time">{syncTimestamps.projects ? new Date(syncTimestamps.projects).toLocaleString() : 'Never'}</span>
                    </div>
                    <div className="sync-timestamp-item">
                      <span className="sync-label">Time Logs:</span>
                      <span className="sync-time">{syncTimestamps.timeLogs ? new Date(syncTimestamps.timeLogs).toLocaleString() : 'Never'}</span>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* GENERAL SECTION */}
          {activeSection === 'general' && (
            <section className="settings-section">
              <div className="section-group">
                <h3>Startup & Background</h3>
                <p className="section-description">Control how the app behaves when you start your computer.</p>
                <div className="toggle-grid">
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={preferences.launchOnStartup}
                      onChange={(e) => handleLaunchOnStartupToggle(e.target.checked)}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Launch with Windows</span>
                      <span className="toggle-description">Start the widget automatically on boot.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={preferences.autoRefreshTasks}
                      onChange={(e) => handleAppPreferenceChange({ autoRefreshTasks: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Auto-refresh tasks</span>
                      <span className="toggle-description">Fetch new tasks every 5 minutes.</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="section-group">
                <h3>Notifications & Sounds</h3>
                <p className="section-description">Configure alerts and audio feedback.</p>
                <div className="toggle-grid">
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={preferences.enableNotifications}
                      onChange={(e) => handleAppPreferenceChange({ enableNotifications: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Desktop notifications</span>
                      <span className="toggle-description">Show confirmations on your desktop.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={preferences.enableSounds}
                      onChange={(e) => handleAppPreferenceChange({ enableSounds: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Sound cues</span>
                      <span className="toggle-description">Hear a chime when actions finish.</span>
                    </div>
                  </label>
                </div>
                <div className="section-actions">
                  <button type="button" className="btn-secondary" onClick={handlePreviewNotification}>
                    Preview notification
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* API & CREDENTIALS SECTION */}
          {activeSection === 'api' && (
            <section className="settings-section">
              <div className="section-group">
                <h3>Quick Import</h3>
                <p className="section-description">
                  Paste your <code>.env</code> file contents below to automatically fill in API keys and database IDs.
                </p>
                <div className="env-import">
                  <textarea
                    value={envText}
                    onChange={(e) => setEnvText(e.target.value)}
                    placeholder="NOTION_API_KEY=ntn_xxxxx&#10;NOTION_DATABASE_ID=xxxxx&#10;..."
                    rows={6}
                    className="env-textarea"
                  />
                  <div className="env-actions">
                    <button type="button" className="btn-primary" onClick={handleEnvImport}>
                      Import Environment Variables
                    </button>
                    {envImportFeedback && (
                      <span className={`env-feedback ${envImportFeedback.kind}`}>
                        {envImportFeedback.message}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="section-group">
                <h3>Primary Notion API Key</h3>
                <p className="section-description">
                  This key is used for Tasks. Other widgets can override with their own key.
                </p>
                <div className="field">
                  <label>API Key</label>
                  <input
                    type="password"
                    value={taskSettings?.apiKey ?? ''}
                    onChange={(e) => handleTaskFieldChange('apiKey', e.target.value)}
                    placeholder="ntn_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  />
                  <span className="field-hint">
                    Create an integration at <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer">notion.so/my-integrations</a>
                  </span>
                </div>
              </div>

              <div className="section-group">
                <h3>Database IDs</h3>
                <p className="section-description">
                  Configure which Notion databases power each widget. You can paste full URLs.
                </p>
                <div className="field-grid">
                  <div className="field">
                    <label>Tasks Database</label>
                    <input
                      type="text"
                      value={taskSettings?.databaseId ?? ''}
                      onChange={(e) => handleTaskFieldChange('databaseId', e.target.value)}
                      placeholder="Database ID or URL"
                    />
                  </div>
                  <div className="field">
                    <label>Writing Database</label>
                    <input
                      type="text"
                      value={writingSettings?.databaseId ?? ''}
                      onChange={(e) => handleWritingFieldChange('databaseId', e.target.value)}
                      placeholder="Database ID or URL"
                    />
                  </div>
                  <div className="field">
                    <label>Time Log Database</label>
                    <input
                      type="text"
                      value={timeLogSettings?.databaseId ?? ''}
                      onChange={(e) => handleTimeLogFieldChange('databaseId', e.target.value)}
                      placeholder="Database ID or URL"
                    />
                  </div>
                  <div className="field">
                    <label>Projects Database</label>
                    <input
                      type="text"
                      value={projectsSettings?.databaseId ?? ''}
                      onChange={(e) => handleProjectsFieldChange('databaseId', e.target.value)}
                      placeholder="Database ID or URL"
                    />
                  </div>
                  <div className="field">
                    <label>Contacts Database</label>
                    <input
                      type="text"
                      value={contactsSettings?.databaseId ?? ''}
                      onChange={(e) => handleContactsFieldChange('databaseId', e.target.value)}
                      placeholder="Database ID or URL"
                    />
                  </div>
                </div>
              </div>

              <div className="section-group">
                <h3>Widget-Specific API Keys</h3>
                <p className="section-description">
                  Optional. If left blank, the primary API key above will be used.
                </p>
                <div className="field-grid">
                  <div className="field">
                    <label>Writing API Key</label>
                    <input
                      type="password"
                      value={writingSettings?.apiKey ?? ''}
                      onChange={(e) => handleWritingFieldChange('apiKey', e.target.value)}
                      placeholder="Uses primary key if empty"
                    />
                  </div>
                  <div className="field">
                    <label>Time Log API Key</label>
                    <input
                      type="password"
                      value={timeLogSettings?.apiKey ?? ''}
                      onChange={(e) => handleTimeLogFieldChange('apiKey', e.target.value)}
                      placeholder="Uses primary key if empty"
                    />
                  </div>
                  <div className="field">
                    <label>Projects API Key</label>
                    <input
                      type="password"
                      value={projectsSettings?.apiKey ?? ''}
                      onChange={(e) => handleProjectsFieldChange('apiKey', e.target.value)}
                      placeholder="Uses primary key if empty"
                    />
                  </div>
                  <div className="field">
                    <label>Contacts API Key</label>
                    <input
                      type="password"
                      value={contactsSettings?.apiKey ?? ''}
                      onChange={(e) => handleContactsFieldChange('apiKey', e.target.value)}
                      placeholder="Uses primary key if empty"
                    />
                  </div>
                </div>
              </div>

              <div className="section-group">
                <h3>Verify All Connections</h3>
                <p className="section-description">
                  Test that all your configured databases are accessible and properly configured.
                </p>
                <VerifyAllDatabases />
              </div>

              <div className="section-actions sticky">
                <button 
                  type="button" 
                  className="btn-primary"
                  onClick={async () => {
                    await Promise.all([
                      handleTaskSave(),
                      handleWritingSave(),
                      handleTimeLogSave(),
                        handleProjectsSave(),
                        handleContactsSave()
                    ]);
                  }}
                  disabled={taskSaving || writingSaving || timeLogSaving || projectsSaving || contactsSaving}
                >
                  {(taskSaving || writingSaving || timeLogSaving || projectsSaving || contactsSaving) 
                    ? 'Saving…' 
                    : 'Save All Credentials'}
                </button>
              </div>
            </section>
          )}

          {/* FEATURES SECTION */}
          {activeSection === 'features' && featureToggles && (
            <section className="settings-section">
              <div className="section-group">
                <h3>Core Modules</h3>
                <p className="section-description">Enable or disable major feature areas. Disabling a module hides related UI elements throughout the app.</p>
                <div className="toggle-grid">
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.enableTimeTracking}
                      onChange={(e) => handleFeatureToggleChange({ enableTimeTracking: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">⏱️ Time Tracking</span>
                      <span className="toggle-description">Session timers and time log database integration.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.enableEisenhowerMatrix}
                      onChange={(e) => handleFeatureToggleChange({ enableEisenhowerMatrix: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">📊 Eisenhower Matrix</span>
                      <span className="toggle-description">Urgent/Important priority system with quadrant views.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.enableProjects}
                      onChange={(e) => handleFeatureToggleChange({ enableProjects: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">📁 Projects</span>
                      <span className="toggle-description">Project management with task relations and views.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.enableWriting}
                      onChange={(e) => handleFeatureToggleChange({ enableWriting: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">✍️ Writing</span>
                      <span className="toggle-description">Long-form capture and journaling widget.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.enableChatbot}
                      onChange={(e) => handleFeatureToggleChange({ enableChatbot: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">🤖 Chatbot (Beta)</span>
                      <span className="toggle-description">Voice + AI assistant for conversational task updates.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.enableDeadlineTypes}
                      onChange={(e) => handleFeatureToggleChange({ enableDeadlineTypes: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">🎯 Deadline Types</span>
                      <span className="toggle-description">Distinguish between hard and soft deadlines.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.enableRecurrence}
                      onChange={(e) => handleFeatureToggleChange({ enableRecurrence: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">🔄 Recurring Tasks</span>
                      <span className="toggle-description">Daily, weekly, and custom repeat patterns.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.enableReminders}
                      onChange={(e) => handleFeatureToggleChange({ enableReminders: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">🔔 Reminders</span>
                      <span className="toggle-description">Task reminder notifications.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.enableSubtasks}
                      onChange={(e) => handleFeatureToggleChange({ enableSubtasks: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">📋 Subtasks</span>
                      <span className="toggle-description">Parent-child task relationships.</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="section-group">
                <h3>Task Properties</h3>
                <p className="section-description">Show or hide specific task fields.</p>
                <div className="toggle-grid">
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.showMainEntry}
                      onChange={(e) => handleFeatureToggleChange({ showMainEntry: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Notes Field</span>
                      <span className="toggle-description">Main entry / notes area on tasks.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.showSessionLength}
                      onChange={(e) => handleFeatureToggleChange({ showSessionLength: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Session Length</span>
                      <span className="toggle-description">Display session duration on tasks.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.showEstimatedLength}
                      onChange={(e) => handleFeatureToggleChange({ showEstimatedLength: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Time Estimates</span>
                      <span className="toggle-description">Show estimated completion time.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.showPriorityOrder}
                      onChange={(e) => handleFeatureToggleChange({ showPriorityOrder: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Priority Order</span>
                      <span className="toggle-description">Show priority order badges.</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="section-group">
                <h3>Dashboard Views</h3>
                <p className="section-description">Choose which views appear in the fullscreen dashboard.</p>
                <div className="toggle-grid">
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.showTaskListView}
                      onChange={(e) => handleFeatureToggleChange({ showTaskListView: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">☰ Task List</span>
                      <span className="toggle-description">Standard filterable task list.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.showMatrixView}
                      onChange={(e) => handleFeatureToggleChange({ showMatrixView: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">⊞ Matrix View</span>
                      <span className="toggle-description">Eisenhower quadrant visualization.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.showKanbanView}
                      onChange={(e) => handleFeatureToggleChange({ showKanbanView: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">▥ Kanban Board</span>
                      <span className="toggle-description">Status-based workflow board.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.showCalendarView}
                      onChange={(e) => handleFeatureToggleChange({ showCalendarView: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">📅 Calendar View</span>
                      <span className="toggle-description">Calendar scheduling interface.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.showGanttView}
                      onChange={(e) => handleFeatureToggleChange({ showGanttView: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">📊 Gantt Chart</span>
                      <span className="toggle-description">Timeline project visualization.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.showTimeLogView}
                      onChange={(e) => handleFeatureToggleChange({ showTimeLogView: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">⏱️ Time Log View</span>
                      <span className="toggle-description">Time tracking history.</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="section-group">
                <h3>Quick Add Options</h3>
                <p className="section-description">Configure the task capture form.</p>
                <div className="toggle-grid">
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.quickAddShowDeadlineToggle}
                      onChange={(e) => handleFeatureToggleChange({ quickAddShowDeadlineToggle: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Deadline Toggle</span>
                      <span className="toggle-description">Hard/soft deadline selector.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.quickAddShowMatrixPicker}
                      onChange={(e) => handleFeatureToggleChange({ quickAddShowMatrixPicker: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Matrix Picker</span>
                      <span className="toggle-description">Eisenhower matrix selector.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.quickAddShowProjectPicker}
                      onChange={(e) => handleFeatureToggleChange({ quickAddShowProjectPicker: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Project Picker</span>
                      <span className="toggle-description">Project assignment dropdown.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.quickAddShowNotes}
                      onChange={(e) => handleFeatureToggleChange({ quickAddShowNotes: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Notes Field</span>
                      <span className="toggle-description">Expandable notes area.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.quickAddShowDragToPlace}
                      onChange={(e) => handleFeatureToggleChange({ quickAddShowDragToPlace: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Drag to Place</span>
                      <span className="toggle-description">Drag handle for calendar placement.</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="section-group">
                <h3>Interface Controls</h3>
                <p className="section-description">Show or hide filtering and organization tools.</p>
                <div className="toggle-grid">
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.showSearchBar}
                      onChange={(e) => handleFeatureToggleChange({ showSearchBar: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Search Bar</span>
                      <span className="toggle-description">Task search functionality.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.showStatusFilters}
                      onChange={(e) => handleFeatureToggleChange({ showStatusFilters: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Status Filters</span>
                      <span className="toggle-description">Filter by task status.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.showMatrixFilters}
                      onChange={(e) => handleFeatureToggleChange({ showMatrixFilters: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Priority Filters</span>
                      <span className="toggle-description">Filter by matrix quadrant.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.showDayFilters}
                      onChange={(e) => handleFeatureToggleChange({ showDayFilters: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Day Filters</span>
                      <span className="toggle-description">Today / Week / All filter.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.showGroupingControls}
                      onChange={(e) => handleFeatureToggleChange({ showGroupingControls: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Grouping</span>
                      <span className="toggle-description">Task grouping controls.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.showSortControls}
                      onChange={(e) => handleFeatureToggleChange({ showSortControls: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Sorting</span>
                      <span className="toggle-description">Task sorting controls.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={featureToggles.compactTaskRows}
                      onChange={(e) => handleFeatureToggleChange({ compactTaskRows: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Compact Mode</span>
                      <span className="toggle-description">Use condensed task rows.</span>
                    </div>
                  </label>
                </div>
              </div>
            </section>
          )}

          {/* TASKS SECTION */}
          {activeSection === 'tasks' && taskSettings && (
            <section className="settings-section">
              <div className="section-group">
                <h3>Core Properties</h3>
                <p className="section-description">Map your database columns to the widget's task fields.</p>
                <div className="field-grid">
                  <div className="field">
                    <label>Title Property</label>
                    <input
                      type="text"
                      value={taskSettings.titleProperty}
                      onChange={(e) => handleTaskFieldChange('titleProperty', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Status Property</label>
                    <input
                      type="text"
                      value={taskSettings.statusProperty}
                      onChange={(e) => handleTaskFieldChange('statusProperty', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Completed Status Value</label>
                    <input
                      type="text"
                      value={taskSettings.completedStatus}
                      onChange={(e) => handleTaskFieldChange('completedStatus', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Date Property</label>
                    <input
                      type="text"
                      value={taskSettings.dateProperty}
                      onChange={(e) => handleTaskFieldChange('dateProperty', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="section-group">
                <h3>Deadline Settings</h3>
                <p className="section-description">Configure how deadlines are detected and displayed.</p>
                <div className="field-grid">
                  <div className="field">
                    <label>Deadline Property</label>
                    <input
                      type="text"
                      value={taskSettings.deadlineProperty}
                      onChange={(e) => handleTaskFieldChange('deadlineProperty', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Hard Deadline Value</label>
                    <input
                      type="text"
                      value={taskSettings.deadlineHardValue}
                      onChange={(e) => handleTaskFieldChange('deadlineHardValue', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Soft Deadline Value</label>
                    <input
                      type="text"
                      value={taskSettings.deadlineSoftValue}
                      onChange={(e) => handleTaskFieldChange('deadlineSoftValue', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="section-group">
                <h3>Urgency & Importance</h3>
                <p className="section-description">Eisenhower matrix configuration.</p>
                <div className="field-grid">
                  <div className="field">
                    <label>Urgent Property</label>
                    <input
                      type="text"
                      value={taskSettings.urgentProperty}
                      onChange={(e) => handleTaskFieldChange('urgentProperty', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Urgent (active)</label>
                    <input
                      type="text"
                      value={taskSettings.urgentStatusActive}
                      onChange={(e) => handleTaskFieldChange('urgentStatusActive', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Urgent (inactive)</label>
                    <input
                      type="text"
                      value={taskSettings.urgentStatusInactive}
                      onChange={(e) => handleTaskFieldChange('urgentStatusInactive', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Important Property</label>
                    <input
                      type="text"
                      value={taskSettings.importantProperty}
                      onChange={(e) => handleTaskFieldChange('importantProperty', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Important (active)</label>
                    <input
                      type="text"
                      value={taskSettings.importantStatusActive}
                      onChange={(e) => handleTaskFieldChange('importantStatusActive', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Important (inactive)</label>
                    <input
                      type="text"
                      value={taskSettings.importantStatusInactive}
                      onChange={(e) => handleTaskFieldChange('importantStatusInactive', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="section-group">
                <h3>Advanced Properties</h3>
                <p className="section-description">Optional properties for time tracking and ordering.</p>
                <div className="field-grid">
                  <div className="field">
                    <label>Session Length Property</label>
                    <input
                      type="text"
                      value={taskSettings.sessionLengthProperty ?? ''}
                      onChange={(e) => handleTaskFieldChange('sessionLengthProperty', e.target.value)}
                      placeholder="Sess. Length"
                    />
                  </div>
                  <div className="field">
                    <label>Estimated Length Property</label>
                    <input
                      type="text"
                      value={taskSettings.estimatedLengthProperty ?? ''}
                      onChange={(e) => handleTaskFieldChange('estimatedLengthProperty', e.target.value)}
                      placeholder="Est. Length"
                    />
                  </div>
                  <div className="field">
                    <label>Priority Order Property</label>
                    <input
                      type="text"
                      value={taskSettings.orderProperty ?? ''}
                      onChange={(e) => handleTaskFieldChange('orderProperty', e.target.value)}
                      placeholder="Priority Order"
                    />
                    <span className="field-hint">Select property for drag-to-prioritize queue.</span>
                  </div>
                  <div className="field">
                    <label>Projects Relation Property</label>
                    <input
                      type="text"
                      value={taskSettings.projectRelationProperty ?? ''}
                      onChange={(e) => handleTaskFieldChange('projectRelationProperty', e.target.value)}
                      placeholder="Project"
                    />
                    <span className="field-hint">Required for project action counts and filters.</span>
                  </div>
                </div>
              </div>

              <div className="section-group">
                <h3>Status Presets</h3>
                <p className="section-description">Fallback status options when the database doesn't expose them.</p>
                <div className="field">
                  <label>Custom Status Options (one per line)</label>
                  <textarea
                    value={statusPresetsText}
                    onChange={(e) => handleStatusPresetsChange(e.target.value)}
                    placeholder="To-do&#10;In Progress&#10;Blocked"
                    rows={4}
                  />
                </div>
              </div>

              <div className="section-group">
                <h3>Verify Configuration</h3>
                <p className="section-description">
                  Click below to verify that all property names match your Notion database.
                </p>
                <DatabaseVerification databaseType="tasks" />
              </div>

              <div className="section-actions sticky">
                <button 
                  type="button" 
                  className="btn-primary"
                  onClick={handleTaskSave}
                  disabled={taskSaving}
                >
                  {taskSaving ? 'Saving…' : 'Save Task Settings'}
                </button>
              </div>
            </section>
          )}

          {/* WRITING SECTION */}
          {activeSection === 'writing' && writingSettings && (
            <section className="settings-section">
              <div className="section-group">
                <h3>Writing Widget Properties</h3>
                <p className="section-description">Configure the long-form capture widget.</p>
                <div className="field-grid">
                  <div className="field">
                    <label>Title Property</label>
                    <input
                      type="text"
                      value={writingSettings.titleProperty}
                      onChange={(e) => handleWritingFieldChange('titleProperty', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Summary Property</label>
                    <input
                      type="text"
                      value={writingSettings.summaryProperty ?? ''}
                      onChange={(e) => handleWritingFieldChange('summaryProperty', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Tags Property</label>
                    <input
                      type="text"
                      value={writingSettings.tagsProperty ?? ''}
                      onChange={(e) => handleWritingFieldChange('tagsProperty', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Status Property</label>
                    <input
                      type="text"
                      value={writingSettings.statusProperty ?? ''}
                      onChange={(e) => handleWritingFieldChange('statusProperty', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Draft Status Value</label>
                    <input
                      type="text"
                      value={writingSettings.draftStatus ?? ''}
                      onChange={(e) => handleWritingFieldChange('draftStatus', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Published Status Value</label>
                    <input
                      type="text"
                      value={writingSettings.publishedStatus ?? ''}
                      onChange={(e) => handleWritingFieldChange('publishedStatus', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="section-group">
                <h3>Verify Configuration</h3>
                <p className="section-description">
                  Click below to verify that all property names match your Notion database.
                </p>
                <DatabaseVerification databaseType="writing" />
              </div>

              <div className="section-actions sticky">
                <button 
                  type="button" 
                  className="btn-primary"
                  onClick={handleWritingSave}
                  disabled={writingSaving}
                >
                  {writingSaving ? 'Saving…' : 'Save Writing Settings'}
                </button>
              </div>
            </section>
          )}

          {/* TIME TRACKING SECTION */}
          {activeSection === 'timelog' && timeLogSettings && (
            <section className="settings-section">
              <div className="section-group">
                <h3>Time Log Properties</h3>
                <p className="section-description">Configure time tracking database mapping.</p>
                <div className="field-grid">
                  <div className="field">
                    <label>Title Property</label>
                    <input
                      type="text"
                      value={timeLogSettings.titleProperty ?? ''}
                      onChange={(e) => handleTimeLogFieldChange('titleProperty', e.target.value)}
                      placeholder="Name"
                    />
                  </div>
                  <div className="field">
                    <label>Task Relation Property</label>
                    <input
                      type="text"
                      value={timeLogSettings.taskProperty ?? ''}
                      onChange={(e) => handleTimeLogFieldChange('taskProperty', e.target.value)}
                      placeholder="Task"
                    />
                  </div>
                  <div className="field">
                    <label>Status Property</label>
                    <input
                      type="text"
                      value={timeLogSettings.statusProperty ?? ''}
                      onChange={(e) => handleTimeLogFieldChange('statusProperty', e.target.value)}
                      placeholder="Status"
                    />
                    <span className="field-hint">Select property with "start" and "completed" options</span>
                  </div>
                  <div className="field">
                    <label>Start Time Property</label>
                    <input
                      type="text"
                      value={timeLogSettings.startTimeProperty ?? ''}
                      onChange={(e) => handleTimeLogFieldChange('startTimeProperty', e.target.value)}
                      placeholder="Start Time"
                    />
                  </div>
                  <div className="field">
                    <label>End Time Property</label>
                    <input
                      type="text"
                      value={timeLogSettings.endTimeProperty ?? ''}
                      onChange={(e) => handleTimeLogFieldChange('endTimeProperty', e.target.value)}
                      placeholder="End Time"
                    />
                  </div>
                </div>
              </div>

              <div className="section-group">
                <h3>Verify Configuration</h3>
                <p className="section-description">
                  Click below to verify that all property names match your Notion database.
                </p>
                <DatabaseVerification databaseType="timeLogs" />
              </div>

              <div className="section-actions sticky">
                <button 
                  type="button" 
                  className="btn-primary"
                  onClick={handleTimeLogSave}
                  disabled={timeLogSaving}
                >
                  {timeLogSaving ? 'Saving…' : 'Save Time Tracking Settings'}
                </button>
              </div>
            </section>
          )}

          {/* PROJECTS SECTION */}
          {activeSection === 'projects' && projectsSettings && (
            <section className="settings-section">
              <div className="section-group">
                <h3>Projects Properties</h3>
                <p className="section-description">Configure the projects database mapping.</p>
                <div className="field-grid">
                  <div className="field">
                    <label>Title Property</label>
                    <input
                      type="text"
                      value={projectsSettings.titleProperty ?? ''}
                      onChange={(e) => handleProjectsFieldChange('titleProperty', e.target.value)}
                      placeholder="Name"
                    />
                  </div>
                  <div className="field">
                    <label>Status Property</label>
                    <input
                      type="text"
                      value={projectsSettings.statusProperty ?? ''}
                      onChange={(e) => handleProjectsFieldChange('statusProperty', e.target.value)}
                      placeholder="Status"
                    />
                  </div>
                  <div className="field">
                    <label>Description Property</label>
                    <input
                      type="text"
                      value={projectsSettings.descriptionProperty ?? ''}
                      onChange={(e) => handleProjectsFieldChange('descriptionProperty', e.target.value)}
                      placeholder="Description"
                    />
                  </div>
                  <div className="field">
                    <label>Start Date Property</label>
                    <input
                      type="text"
                      value={projectsSettings.startDateProperty ?? ''}
                      onChange={(e) => handleProjectsFieldChange('startDateProperty', e.target.value)}
                      placeholder="Start Date"
                    />
                  </div>
                  <div className="field">
                    <label>End Date Property</label>
                    <input
                      type="text"
                      value={projectsSettings.endDateProperty ?? ''}
                      onChange={(e) => handleProjectsFieldChange('endDateProperty', e.target.value)}
                      placeholder="End Date"
                    />
                  </div>
                  <div className="field">
                    <label>Tags Property</label>
                    <input
                      type="text"
                      value={projectsSettings.tagsProperty ?? ''}
                      onChange={(e) => handleProjectsFieldChange('tagsProperty', e.target.value)}
                      placeholder="Tags"
                    />
                  </div>
                  <div className="field">
                    <label>Actions Relation Property</label>
                    <input
                      type="text"
                      value={projectsSettings.actionsRelationProperty ?? ''}
                      onChange={(e) => handleProjectsFieldChange('actionsRelationProperty', e.target.value)}
                      placeholder="Actions"
                    />
                  </div>
                  <div className="field">
                    <label>Completed Status</label>
                    <input
                      type="text"
                      value={projectsSettings.completedStatus ?? ''}
                      onChange={(e) => handleProjectsFieldChange('completedStatus', e.target.value)}
                      placeholder="Done"
                    />
                  </div>
                </div>
              </div>

              {contactsSettings && (
                <div className="section-group">
                  <h3>Contacts Mapping</h3>
                  <p className="section-description">
                    Map the properties from your Contacts database so the workspace can display people and email addresses.
                  </p>
                  <div className="field-grid">
                    <div className="field">
                      <label>Name Property</label>
                      <input
                        type="text"
                        value={contactsSettings.nameProperty ?? ''}
                        onChange={(e) => handleContactsFieldChange('nameProperty', e.target.value)}
                        placeholder="Name"
                      />
                    </div>
                    <div className="field">
                      <label>Email Property</label>
                      <input
                        type="text"
                        value={contactsSettings.emailProperty ?? ''}
                        onChange={(e) => handleContactsFieldChange('emailProperty', e.target.value)}
                        placeholder="Email"
                      />
                    </div>
                    <div className="field">
                      <label>Phone Property</label>
                      <input
                        type="text"
                        value={contactsSettings.phoneProperty ?? ''}
                        onChange={(e) => handleContactsFieldChange('phoneProperty', e.target.value)}
                        placeholder="Phone"
                      />
                    </div>
                    <div className="field">
                      <label>Company Property</label>
                      <input
                        type="text"
                        value={contactsSettings.companyProperty ?? ''}
                        onChange={(e) => handleContactsFieldChange('companyProperty', e.target.value)}
                        placeholder="Company"
                      />
                    </div>
                    <div className="field">
                      <label>Role/Title Property</label>
                      <input
                        type="text"
                        value={contactsSettings.roleProperty ?? ''}
                        onChange={(e) => handleContactsFieldChange('roleProperty', e.target.value)}
                        placeholder="Role"
                      />
                    </div>
                    <div className="field">
                      <label>Notes Property</label>
                      <input
                        type="text"
                        value={contactsSettings.notesProperty ?? ''}
                        onChange={(e) => handleContactsFieldChange('notesProperty', e.target.value)}
                        placeholder="Notes"
                      />
                    </div>
                    <div className="field">
                      <label>Project Relation Property</label>
                      <input
                        type="text"
                        value={contactsSettings.projectsRelationProperty ?? ''}
                        onChange={(e) => handleContactsFieldChange('projectsRelationProperty', e.target.value)}
                        placeholder="Projects"
                      />
                      <span className="field-hint">Relation that links a contact to one or more projects.</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="section-group">
                <h3>Status Options</h3>
                <p className="section-description">Status options are cached locally to avoid repeated API calls.</p>
                <div className="field">
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleFetchProjectStatusOptions}
                      disabled={fetchingProjectStatuses}
                    >
                      {fetchingProjectStatuses ? 'Fetching...' : 'Fetch Status Options from Notion'}
                    </button>
                    {projectsSettings.cachedStatusOptions && projectsSettings.cachedStatusOptions.length > 0 && (
                      <span className="field-hint">
                        ✓ {projectsSettings.cachedStatusOptions.length} options cached
                      </span>
                    )}
                  </div>
                  <label>Fallback Status Options (one per line)</label>
                  <textarea
                    value={projectStatusPresetsText}
                    onChange={(e) => handleProjectStatusPresetsChange(e.target.value)}
                    placeholder="Not started&#10;In progress&#10;Done"
                    rows={4}
                  />
                </div>
              </div>

              <div className="section-group">
                <h3>Status Diagnostics (Local Cache)</h3>
                <p className="section-description">
                  Confirm which statuses are currently stored locally for both tasks and projects. Use this to verify
                  that imports captured the right values even when Notion is unavailable.
                </p>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: 16
                  }}
                >
                  {renderStatusSummaryCard('Projects', statusDiagnostics?.projects)}
                  {renderStatusSummaryCard('Tasks', statusDiagnostics?.tasks)}
                </div>
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={loadStatusDiagnostics}
                    disabled={statusDiagnosticsLoading}
                  >
                    {statusDiagnosticsLoading ? 'Refreshing…' : 'Refresh Diagnostics'}
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Last checked:{' '}
                    {statusDiagnostics?.projects?.lastUpdated || statusDiagnostics?.tasks?.lastUpdated
                      ? formatTimestamp(statusDiagnostics?.projects?.lastUpdated || statusDiagnostics?.tasks?.lastUpdated)
                      : 'Not yet'}
                  </span>
                  {statusDiagnosticsError && (
                    <span style={{ color: 'var(--text-danger)', fontSize: 12 }}>
                      {statusDiagnosticsError}
                    </span>
                  )}
                </div>
              </div>

              <div className="section-group">
                <h3>Data Import</h3>
                <p className="section-description">Import data from Notion on demand. This avoids API overload by letting you control when each data type syncs.</p>
                <div className="import-controls" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleImportProjects}
                      disabled={importingProjects}
                    >
                      {importingProjects ? 'Importing...' : '📁 Import Projects'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleImportTimeLogs}
                      disabled={importingTimeLogs}
                    >
                      {importingTimeLogs ? 'Importing...' : '⏱️ Import Time Logs'}
                    </button>
                  </div>
                  {syncTimestamps && (
                    <div className="sync-timestamps" style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span>Last synced:</span>
                      <span>• Tasks: {syncTimestamps.tasks ? new Date(syncTimestamps.tasks).toLocaleString() : 'Never'}</span>
                      <span>• Projects: {syncTimestamps.projects ? new Date(syncTimestamps.projects).toLocaleString() : 'Never'}</span>
                      <span>• Time Logs: {syncTimestamps.timeLogs ? new Date(syncTimestamps.timeLogs).toLocaleString() : 'Never'}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="section-group">
                <h3>Verify Projects Configuration</h3>
                <p className="section-description">
                  Click below to verify that all property names match your Notion Projects database.
                </p>
                <DatabaseVerification databaseType="projects" />
              </div>

              <div className="section-group">
                <h3>Verify Contacts Configuration</h3>
                <p className="section-description">
                  Click below to verify that all property names match your Notion Contacts database.
                </p>
                <DatabaseVerification databaseType="contacts" />
              </div>

              <div className="section-actions sticky">
                <button 
                  type="button" 
                  className="btn-primary"
                  onClick={async () => {
                    await Promise.all([handleProjectsSave(), handleContactsSave()]);
                  }}
                  disabled={projectsSaving || contactsSaving}
                >
                  {(projectsSaving || contactsSaving) ? 'Saving…' : 'Save Projects & Contacts Settings'}
                </button>
              </div>
            </section>
          )}

          {/* WIDGET SECTION */}
          {activeSection === 'widget' && (
            <section className="settings-section">
              <div className="section-group">
                <h3>Window Controls</h3>
                <p className="section-description">Keep Quick Capture visible where you need it most.</p>
                <div className="toggle-grid">
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={alwaysOnTop}
                      onChange={(e) => handleAlwaysOnTopToggle(e.target.checked)}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Always on top</span>
                      <span className="toggle-description">Keeps the widget floating over other apps.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={preferences.pinWidget}
                      onChange={(e) => handleAppPreferenceChange({ pinWidget: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Pin widget</span>
                      <span className="toggle-description">Prevents auto-collapse while you work.</span>
                    </div>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={preferences.preventMinimalDuringSession ?? true}
                      onChange={(e) => handleAppPreferenceChange({ preventMinimalDuringSession: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                    <div className="toggle-content">
                      <span className="toggle-title">Keep expanded during sessions</span>
                      <span className="toggle-description">Prevent widget from going minimal when a timer is active.</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="section-group">
                <h3>Dock Position</h3>
                <p className="section-description">Choose which edge of the screen the widget docks to.</p>
                <div className="dock-options">
                  {(['left', 'top', 'right'] as DockEdge[]).map((edge) => (
                    <button
                      key={edge}
                      type="button"
                      className={`dock-option ${dockState?.edge === edge ? 'active' : ''}`}
                      onClick={() => handleDockEdgeChange(edge)}
                    >
                      <span className="dock-icon">{edge === 'left' ? '◀' : edge === 'right' ? '▶' : '▲'}</span>
                      <span className="dock-label">{edge.charAt(0).toUpperCase() + edge.slice(1)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* IMPORT & SYNC SECTION */}
          {activeSection === 'import' && (
            <section className="settings-section">
              <div className="section-group">
                <h3>Data Import</h3>
                <p className="section-description">Import all your tasks from Notion for a complete local copy.</p>
                <div className="import-status">
                  {importProgress.status === 'idle' && (
                    <div className="status-box neutral">
                      Ready to import tasks from Notion.
                    </div>
                  )}
                  {importProgress.status === 'running' && (
                    <div className="status-box info">
                      <div className="status-title">Importing... {importProgress.tasksImported} tasks</div>
                      <div className="status-detail">
                        {importProgress.message || `Page ${importProgress.currentPage}`}
                      </div>
                      <div className="progress-bar">
                        <div className="progress-fill animate" />
                      </div>
                    </div>
                  )}
                  {importProgress.status === 'paused' && (
                    <div className="status-box warning">
                      <div className="status-title">Import paused</div>
                      <div className="status-detail">
                        {importProgress.message || 'Will retry automatically...'}
                      </div>
                      <div className="status-detail">
                        Progress: {importProgress.tasksImported} tasks ({importProgress.pagesProcessed} pages)
                      </div>
                    </div>
                  )}
                  {importProgress.status === 'completed' && (
                    <div className="status-box success">
                      <div className="status-title">✓ Import complete!</div>
                      <div className="status-detail">
                        {importProgress.tasksImported} tasks imported from {importProgress.pagesProcessed} pages
                      </div>
                    </div>
                  )}
                  {importProgress.status === 'error' && (
                    <div className="status-box error">
                      <div className="status-title">Import failed</div>
                      <div className="status-detail">{importProgress.error || 'Unknown error'}</div>
                    </div>
                  )}
                </div>
                <div className="section-actions">
                  {(importProgress.status === 'idle' || importProgress.status === 'completed' || importProgress.status === 'error') && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleStartImport}
                      disabled={isImporting}
                    >
                      {importProgress.status === 'completed' ? 'Re-import all tasks' : 'Import all tasks'}
                    </button>
                  )}
                  {importProgress.status === 'paused' && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleStartImport}
                      disabled={isImporting}
                    >
                      Resume import
                    </button>
                  )}
                  {importProgress.status === 'running' && (
                    <button type="button" className="btn-secondary" disabled>
                      Importing...
                    </button>
                  )}
                  {(importProgress.status === 'completed' || importProgress.status === 'paused' || importProgress.status === 'error') && (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={handleResetImport}
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* MCP SERVERS SECTION */}
          {activeSection === 'mcp' && (
            <section className="settings-section">
              <div className="section-group">
                <h3>Model Context Protocol (MCP)</h3>
                <p className="section-description">
                  MCP servers allow AI assistants to interact with your Notion data directly.
                  Configure servers to enable advanced AI integrations.
                </p>
                <div className="mcp-info-card">
                  <div className="mcp-icon">🤖</div>
                  <div className="mcp-content">
                    <h4>What is MCP?</h4>
                    <p>
                      The Model Context Protocol enables AI assistants like Claude to read and 
                      interact with your Notion databases. With MCP, you can ask your AI to 
                      search tasks, create entries, and manage your workflow using natural language.
                    </p>
                  </div>
                </div>
              </div>

              <div className="section-group">
                <h3>Notion MCP Server</h3>
                <p className="section-description">
                  The built-in Notion MCP server uses your configured API credentials to provide
                  Notion access to AI assistants.
                </p>
                <div className="mcp-server-card">
                  <div className="server-header">
                    <div className="server-icon">📝</div>
                    <div className="server-info">
                      <span className="server-name">notion-server</span>
                      <span className="server-status enabled">Ready</span>
                    </div>
                  </div>
                  <div className="server-details">
                    <div className="server-detail">
                      <span className="detail-label">Type</span>
                      <span className="detail-value">stdio</span>
                    </div>
                    <div className="server-detail">
                      <span className="detail-label">Databases</span>
                      <span className="detail-value">
                        {[
                          taskSettings?.databaseId ? 'Tasks' : null,
                          writingSettings?.databaseId ? 'Writing' : null,
                          timeLogSettings?.databaseId ? 'Time Log' : null,
                          projectsSettings?.databaseId ? 'Projects' : null
                        ].filter(Boolean).join(', ') || 'None configured'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="section-group">
                <h3>Using with Cursor / Claude Desktop</h3>
                <p className="section-description">
                  Add the following to your MCP configuration to enable Notion access:
                </p>
                <div className="mcp-config-block">
                  <pre className="mcp-code">{`{
  "mcpServers": {
    "notion": {
      "command": "node",
      "args": ["${typeof window !== 'undefined' ? window.location.origin : ''}/mcp/notionServer.js"],
      "env": {
        "NOTION_API_KEY": "${taskSettings?.apiKey ? '***' : '<your-api-key>'}",
        "NOTION_DATABASE_ID": "${taskSettings?.databaseId || '<your-database-id>'}"
      }
    }
  }
}`}</pre>
                  <button 
                    type="button" 
                    className="btn-secondary mcp-copy-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify({
                        mcpServers: {
                          notion: {
                            command: "node",
                            args: ["./mcp/notionServer.js"],
                            env: {
                              NOTION_API_KEY: taskSettings?.apiKey || '<your-api-key>',
                              NOTION_DATABASE_ID: taskSettings?.databaseId || '<your-database-id>'
                            }
                          }
                        }
                      }, null, 2));
                      setFeedback({ kind: 'success', message: 'Copied to clipboard' });
                    }}
                  >
                    Copy Config
                  </button>
                </div>
              </div>

              <div className="section-group">
                <h3>Available Tools</h3>
                <p className="section-description">
                  When connected, AI assistants can use these tools:
                </p>
                <div className="mcp-tools-list">
                  <div className="mcp-tool">
                    <span className="tool-name">search_pages</span>
                    <span className="tool-description">Search through Notion pages</span>
                  </div>
                  <div className="mcp-tool">
                    <span className="tool-name">read_page</span>
                    <span className="tool-description">Read page content and properties</span>
                  </div>
                  <div className="mcp-tool">
                    <span className="tool-name">create_page</span>
                    <span className="tool-description">Create new pages or database items</span>
                  </div>
                  <div className="mcp-tool">
                    <span className="tool-name">update_page</span>
                    <span className="tool-description">Update existing page content</span>
                  </div>
                  <div className="mcp-tool">
                    <span className="tool-name">query_database</span>
                    <span className="tool-description">Query and filter database entries</span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* SHORTCUTS SECTION */}
          {activeSection === 'shortcuts' && (
            <section className="settings-section">
              <div className="section-group">
                <h3>Task Widget Shortcuts</h3>
                <p className="section-description">These shortcuts work in the desktop task view.</p>
                <ul className="shortcut-list">
                  {TASK_SHORTCUTS.map((shortcut) => (
                    <li key={shortcut.keys} className="shortcut-row">
                      <span className="shortcut-keys">{shortcut.keys}</span>
                      <span className="shortcut-description">{shortcut.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="section-group">
                <h3>Fullscreen Dashboard Shortcuts</h3>
                <p className="section-description">These shortcuts work in the fullscreen dashboard view.</p>
                <ul className="shortcut-list">
                  {FULLSCREEN_SHORTCUTS.map((shortcut) => (
                    <li key={shortcut.keys} className="shortcut-row">
                      <span className="shortcut-keys">{shortcut.keys}</span>
                      <span className="shortcut-description">{shortcut.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {/* ABOUT SECTION */}
          {activeSection === 'about' && (
            <section className="settings-section">
              <div className="section-group">
                <h3>Notion Widgets</h3>
                <p className="section-description">Version {currentVersion}</p>
                <div className="about-info">
                  <p>
                    A desktop companion for your Notion workspace. Capture tasks, track time,
                    and stay organized without leaving your flow.
                  </p>
                </div>
              </div>

              <div className="section-group">
                <h3>Updates</h3>
                <p className="section-description">Keep your app up to date.</p>
                <div className="update-status">
                  {updateStatus === 'available' && updateInfo && (
                    <div className="status-box info">
                      Update available: v{updateInfo.version}
                      {updateInfo.releaseNotes && (
                        <div className="status-detail">{updateInfo.releaseNotes}</div>
                      )}
                    </div>
                  )}
                  {updateStatus === 'downloading' && updateInfo && (
                    <div className="status-box info">
                      Downloading update... {updateInfo.downloadProgress ? Math.round(updateInfo.downloadProgress) : 0}%
                      {updateInfo.downloadProgress !== undefined && (
                        <div className="progress-bar">
                          <div 
                            className="progress-fill" 
                            style={{ width: `${updateInfo.downloadProgress}%` }} 
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {updateStatus === 'ready' && (
                    <div className="status-box success">
                      Update ready to install. The app will restart after installation.
                    </div>
                  )}
                  {updateStatus === 'error' && updateInfo?.error && (
                    <div className="status-box error">
                      Error: {updateInfo.error}
                    </div>
                  )}
                  {updateStatus === 'not-available' && (
                    <div className="status-box neutral">
                      You're using the latest version.
                    </div>
                  )}
                </div>
                <div className="section-actions">
                  {(updateStatus === 'idle' || updateStatus === 'not-available' || updateStatus === 'error') && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleCheckForUpdates}
                      disabled={isChecking}
                    >
                      {isChecking ? 'Checking...' : 'Check for updates'}
                    </button>
                  )}
                  {updateStatus === 'available' && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleDownloadUpdate}
                      disabled={isDownloading}
                    >
                      {isDownloading ? 'Downloading...' : 'Download update'}
                    </button>
                  )}
                  {updateStatus === 'ready' && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleInstallUpdate}
                    >
                      Install and restart
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
};

export default ControlCenter;

