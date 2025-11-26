import { useEffect, useState } from 'react';
import { widgetBridge } from '@shared/platform';
import type { AppPreferences, DockEdge, DockState, ImportProgress, UpdateInfo, UpdateStatus } from '@shared/types';

export type DrawerFeedback = {
  kind: 'success' | 'error';
  message: string;
};

interface Props {
  onClose(): void;
  dockState: DockState | null;
  onToggleAlwaysOnTop: (next: boolean) => Promise<void> | void;
  onTogglePin: (next: boolean) => Promise<void> | void;
  onSetDockEdge: (edge: DockEdge) => void;
  alwaysOnTop: boolean;
  pinEnabled: boolean;
  appPreferences: AppPreferences | null;
  onToggleLaunchOnStartup: (next: boolean) => Promise<void> | void;
  onToggleNotifications: (next: boolean) => Promise<void> | void;
  onToggleSounds: (next: boolean) => Promise<void> | void;
  onToggleAutoRefresh: (next: boolean) => Promise<void> | void;
  onTogglePreventMinimalDuringSession?: (next: boolean) => Promise<void> | void;
  onPreviewNotification: () => Promise<void> | void;
  feedback: DrawerFeedback | null;
  showControlCenterButton?: boolean;
}

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

const SettingsDrawer = ({
  onClose,
  dockState,
  onToggleAlwaysOnTop,
  onTogglePin,
  onSetDockEdge,
  alwaysOnTop,
  pinEnabled,
  appPreferences,
  onToggleLaunchOnStartup,
  onToggleNotifications,
  onToggleSounds,
  onToggleAutoRefresh,
  onTogglePreventMinimalDuringSession,
  onPreviewNotification,
  feedback,
  showControlCenterButton = true
}: Props) => {
  const preferences = appPreferences ?? DEFAULT_PREFERENCES;
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

  useEffect(() => {
    // Get app version
    widgetBridge.getAppVersion().then(setCurrentVersion).catch(() => {
      // Fallback if not available
      setCurrentVersion('1.0.0');
    });

    // Get initial status
    widgetBridge.getUpdateStatus().then(({ status, info }) => {
      setUpdateStatus(status);
      setUpdateInfo(info);
    });

    // Listen for update status changes
    const unsubscribeUpdate = widgetBridge.onUpdateStatusChange(({ status, info }) => {
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

    // Get initial import progress
    widgetBridge.getImportProgress().then(setImportProgress).catch(() => {
      // Fallback
    });

    // Listen for import progress changes
    const unsubscribeImport = widgetBridge.onImportProgress((progress) => {
      setImportProgress(progress);
      setIsImporting(progress.status === 'running');
    });

    return () => {
      unsubscribeUpdate();
      unsubscribeImport();
    };
  }, []);

  const handleCheckForUpdates = async () => {
    setIsChecking(true);
    try {
      const result = await widgetBridge.checkForUpdates();
      setUpdateStatus(result.status);
      setUpdateInfo(result.info);
    } catch (error) {
      console.error('Failed to check for updates:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setUpdateStatus('error');
      setUpdateInfo({
        version: 'unknown',
        error: errorMessage || 'Failed to check for updates. Make sure you have an internet connection and the GitHub repository is configured correctly.'
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleDownloadUpdate = async () => {
    setIsDownloading(true);
    try {
      await widgetBridge.downloadUpdate();
    } catch (error) {
      console.error('Failed to download update:', error);
      setUpdateStatus('error');
      setUpdateInfo({
        version: updateInfo?.version || 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      setIsDownloading(false);
    }
  };

  const handleInstallUpdate = () => {
    try {
      widgetBridge.installUpdate();
    } catch (error) {
      console.error('Failed to install update:', error);
    }
  };

  const handleStartImport = async () => {
    setIsImporting(true);
    try {
      await widgetBridge.performInitialImport();
    } catch (error) {
      console.error('Failed to start import:', error);
      setIsImporting(false);
    }
  };

  const handleResetImport = async () => {
    try {
      await widgetBridge.resetImport();
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

  return (
    <div className="settings-drawer">
      <div className="settings-panel">
        <header>
          <div className="panel-heading">
            <h2>Widget Settings</h2>
            <p className="panel-subtitle">
              Quick window controls + notification behavior.
            </p>
          </div>
          <div className="panel-actions">
            {showControlCenterButton && (
              <button
                type="button"
                className="pill link"
                onClick={() => {
                  console.log('Requesting to open Control Center');
                  widgetBridge.openSettingsWindow().catch((err) => {
                    console.error('Failed to open settings window', err);
                  });
                }}
              >
                Open Control Center
              </button>
            )}
            <button type="button" onClick={onClose}>
              ✕
            </button>
          </div>
        </header>
        {feedback && (
          <p className={`drawer-feedback ${feedback.kind}`}>
            {feedback.message}
          </p>
        )}
        {!appPreferences && (
          <p className="panel-subtitle subtle">Loading preferences…</p>
        )}
        <div className="settings-panel-body">
          <section className="drawer-section">
            <div className="drawer-section-header">
              <h3>Window controls</h3>
              <p>Keep Quick Capture visible where you need it most.</p>
            </div>
            <div className="drawer-grid two-column">
              <label className="switch card">
                <input
                  type="checkbox"
                  checked={alwaysOnTop}
                  onChange={(event) =>
                    onToggleAlwaysOnTop(event.target.checked)
                  }
                />
                <span className="slider" />
                <span className="label">
                  Always on top
                  <small>Keeps the widget floating over other apps.</small>
                </span>
              </label>
              <label className="switch card">
                <input
                  type="checkbox"
                  checked={pinEnabled}
                  onChange={(event) => onTogglePin(event.target.checked)}
                />
                <span className="slider" />
                <span className="label">
                  Pin widget
                  <small>Prevents auto-collapse while you work.</small>
                </span>
              </label>
              <label className="full-span">
                Dock edge
                <select
                  value={dockState?.edge ?? 'top'}
                  onChange={(event) =>
                    onSetDockEdge(event.target.value as DockEdge)
                  }
                >
                  <option value="left">Left</option>
                  <option value="top">Top</option>
                  <option value="right">Right</option>
                </select>
              </label>
            </div>
          </section>
          <section className="drawer-section">
            <div className="drawer-section-header">
              <h3>App behavior</h3>
              <p>Startup, notifications, and refresh cadence.</p>
            </div>
            <div className="drawer-grid two-column">
              <label className="switch card">
                <input
                  type="checkbox"
                  checked={preferences.launchOnStartup}
                  disabled={!appPreferences}
                  onChange={(event) =>
                    onToggleLaunchOnStartup(event.target.checked)
                  }
                />
                <span className="slider" />
                <span className="label">
                  Launch with Windows
                  <small>Start the widget automatically on boot.</small>
                </span>
              </label>
              <label className="switch card">
                <input
                  type="checkbox"
                  checked={preferences.enableNotifications}
                  disabled={!appPreferences}
                  onChange={(event) =>
                    onToggleNotifications(event.target.checked)
                  }
                />
                <span className="slider" />
                <span className="label">
                  Desktop notifications
                  <small>Show capture confirmations on your desktop.</small>
                </span>
              </label>
              <label className="switch card">
                <input
                  type="checkbox"
                  checked={preferences.enableSounds}
                  disabled={!appPreferences}
                  onChange={(event) => onToggleSounds(event.target.checked)}
                />
                <span className="slider" />
                <span className="label">
                  Sound cues
                  <small>Hear a chime whenever an action finishes.</small>
                </span>
              </label>
              <label className="switch card">
                <input
                  type="checkbox"
                  checked={preferences.autoRefreshTasks}
                  disabled={!appPreferences}
                  onChange={(event) =>
                    onToggleAutoRefresh(event.target.checked)
                  }
                />
                <span className="slider" />
                <span className="label">
                  Auto-refresh tasks
                  <small>Fetch new tasks every 5 minutes.</small>
                </span>
              </label>
              <label className="switch card">
                <input
                  type="checkbox"
                  checked={preferences.preventMinimalDuringSession ?? true}
                  disabled={!appPreferences}
                  onChange={(event) =>
                    onTogglePreventMinimalDuringSession?.(event.target.checked)
                  }
                />
                <span className="slider" />
                <span className="label">
                  Keep expanded during sessions
                  <small>Prevent widget from going to minimal view when a timer is active.</small>
                </span>
              </label>
              <div className="drawer-actions full-span">
                <button
                  type="button"
                  className="pill ghost"
                  onClick={onPreviewNotification}
                >
                  Preview notification
                </button>
              </div>
            </div>
          </section>
          <section className="drawer-section">
            <div className="drawer-section-header">
              <h3>Data Import</h3>
              <p>Import all your tasks from Notion. This ensures you have a complete local copy.</p>
            </div>
            <div className="drawer-grid two-column">
              <div className="full-span">
                {importProgress.status === 'idle' && (
                  <div style={{ marginBottom: '12px', padding: '8px', background: 'rgba(107, 114, 128, 0.1)', borderRadius: '6px', fontSize: '13px' }}>
                    Ready to import tasks from Notion.
                  </div>
                )}
                {importProgress.status === 'running' && (
                  <div style={{ marginBottom: '12px', padding: '8px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '6px', fontSize: '13px' }}>
                    <div style={{ marginBottom: '4px', fontWeight: 500 }}>
                      Importing... {importProgress.tasksImported} tasks
                    </div>
                    <div style={{ fontSize: '12px', opacity: 0.8 }}>
                      {importProgress.message || `Page ${importProgress.currentPage}`}
                    </div>
                    <div style={{ marginTop: '8px', height: '4px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div 
                        style={{ 
                          height: '100%', 
                          width: '100%', 
                          background: 'var(--accent-color, #3b82f6)', 
                          animation: 'pulse 1.5s ease-in-out infinite'
                        }} 
                      />
                    </div>
                  </div>
                )}
                {importProgress.status === 'paused' && (
                  <div style={{ marginBottom: '12px', padding: '8px', background: 'rgba(234, 179, 8, 0.1)', borderRadius: '6px', fontSize: '13px' }}>
                    <div style={{ marginBottom: '4px', fontWeight: 500, color: 'var(--warning-color, #eab308)' }}>
                      Import paused
                    </div>
                    <div style={{ fontSize: '12px', opacity: 0.8 }}>
                      {importProgress.message || 'Will retry automatically...'}
                    </div>
                    <div style={{ marginTop: '4px', fontSize: '12px' }}>
                      Progress: {importProgress.tasksImported} tasks ({importProgress.pagesProcessed} pages)
                    </div>
                  </div>
                )}
                {importProgress.status === 'completed' && (
                  <div style={{ marginBottom: '12px', padding: '8px', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '6px', fontSize: '13px' }}>
                    <div style={{ marginBottom: '4px', fontWeight: 500, color: 'var(--success-color, #22c55e)' }}>
                      ✓ Import complete!
                    </div>
                    <div style={{ fontSize: '12px', opacity: 0.8 }}>
                      {importProgress.tasksImported} tasks imported from {importProgress.pagesProcessed} pages
                    </div>
                  </div>
                )}
                {importProgress.status === 'error' && (
                  <div style={{ marginBottom: '12px', padding: '8px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', fontSize: '13px' }}>
                    <div style={{ marginBottom: '4px', fontWeight: 500, color: 'var(--error-color, #ef4444)' }}>
                      Import failed
                    </div>
                    <div style={{ fontSize: '12px', opacity: 0.8 }}>
                      {importProgress.error || 'Unknown error'}
                    </div>
                  </div>
                )}
                <div className="drawer-actions full-span" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {(importProgress.status === 'idle' || importProgress.status === 'completed' || importProgress.status === 'error') && (
                    <button
                      type="button"
                      className="pill ghost"
                      onClick={handleStartImport}
                      disabled={isImporting}
                    >
                      {importProgress.status === 'completed' ? 'Re-import all tasks' : 'Import all tasks'}
                    </button>
                  )}
                  {importProgress.status === 'paused' && (
                    <button
                      type="button"
                      className="pill ghost"
                      onClick={handleStartImport}
                      disabled={isImporting}
                    >
                      Resume import
                    </button>
                  )}
                  {importProgress.status === 'running' && (
                    <button
                      type="button"
                      className="pill ghost"
                      disabled
                    >
                      Importing...
                    </button>
                  )}
                  {(importProgress.status === 'completed' || importProgress.status === 'paused' || importProgress.status === 'error') && (
                    <button
                      type="button"
                      className="pill ghost"
                      onClick={handleResetImport}
                      style={{ opacity: 0.7 }}
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
          <section className="drawer-section">
            <div className="drawer-section-header">
              <h3>Updates</h3>
              <p>Keep your app up to date with the latest features and fixes.</p>
            </div>
            <div className="drawer-grid two-column">
              <div className="full-span">
                <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--notion-text-muted)' }}>
                  Current version: {currentVersion}
                </div>
                {updateStatus === 'available' && updateInfo && (
                  <div style={{ marginBottom: '12px', padding: '8px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '6px', fontSize: '13px' }}>
                    Update available: v{updateInfo.version}
                    {updateInfo.releaseNotes && (
                      <div style={{ marginTop: '4px', fontSize: '12px', opacity: 0.8 }}>
                        {updateInfo.releaseNotes}
                      </div>
                    )}
                  </div>
                )}
                {updateStatus === 'downloading' && updateInfo && (
                  <div style={{ marginBottom: '12px', padding: '8px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '6px', fontSize: '13px' }}>
                    Downloading update... {updateInfo.downloadProgress ? Math.round(updateInfo.downloadProgress) : 0}%
                    {updateInfo.downloadProgress !== undefined && (
                      <div style={{ marginTop: '8px', height: '4px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${updateInfo.downloadProgress}%`, background: 'var(--accent-color, #3b82f6)', transition: 'width 0.3s' }} />
                      </div>
                    )}
                  </div>
                )}
                {updateStatus === 'ready' && (
                  <div style={{ marginBottom: '12px', padding: '8px', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '6px', fontSize: '13px' }}>
                    Update ready to install. The app will restart after installation.
                  </div>
                )}
                {updateStatus === 'error' && updateInfo?.error && (
                  <div style={{ marginBottom: '12px', padding: '8px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', fontSize: '13px', color: 'var(--error-color, #ef4444)' }}>
                    Error: {updateInfo.error}
                  </div>
                )}
                {updateStatus === 'not-available' && (
                  <div style={{ marginBottom: '12px', padding: '8px', background: 'rgba(107, 114, 128, 0.1)', borderRadius: '6px', fontSize: '13px' }}>
                    You're using the latest version.
                  </div>
                )}
                <div className="drawer-actions full-span" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {updateStatus === 'idle' || updateStatus === 'not-available' || updateStatus === 'error' ? (
                    <button
                      type="button"
                      className="pill ghost"
                      onClick={handleCheckForUpdates}
                      disabled={isChecking}
                    >
                      {isChecking ? 'Checking...' : 'Check for updates'}
                    </button>
                  ) : null}
                  {updateStatus === 'available' && (
                    <button
                      type="button"
                      className="pill ghost"
                      onClick={handleDownloadUpdate}
                      disabled={isDownloading}
                    >
                      {isDownloading ? 'Downloading...' : 'Download update'}
                    </button>
                  )}
                  {updateStatus === 'ready' && (
                    <button
                      type="button"
                      className="pill ghost"
                      onClick={handleInstallUpdate}
                    >
                      Install and restart
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
          <section className="drawer-note">
            <p>
              Need to change your Notion databases or properties? Open the
              Control Center for the full backend configuration.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default SettingsDrawer;


