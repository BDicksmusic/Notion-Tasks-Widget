import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { ImportJobStatus, ImportType, ImportQueueStatus } from '../../shared/types';

const getWidgetAPI = () => (window as any).widgetAPI;

interface ImportOption {
  type: ImportType;
  label: string;
  icon: string;
}

interface SyncLogEntry {
  id: number;
  timestamp: Date;
  type: ImportType;
  message: string;
  level: 'info' | 'success' | 'error' | 'progress';
}

const IMPORT_OPTIONS: ImportOption[] = [
  { type: 'tasks', label: 'Tasks', icon: '☰' },
  { type: 'projects', label: 'Projects', icon: '📁' },
  { type: 'contacts', label: 'Contacts', icon: '👤' },
  { type: 'timeLogs', label: 'Time Logs', icon: '⏱' },
];

function getStatusIcon(status: ImportJobStatus['status']): string {
  switch (status) {
    case 'running': return '⟳';
    case 'completed': return '✓';
    case 'cancelled': return '⏹';
    case 'error': return '✕';
    case 'queued': return '⏳';
    default: return '○';
  }
}

function getStatusColor(status: ImportJobStatus['status']): string {
  switch (status) {
    case 'running': return 'var(--notion-blue)';
    case 'completed': return 'var(--notion-green, #2ecc71)';
    case 'cancelled': return 'var(--notion-orange, #f39c12)';
    case 'error': return 'var(--notion-red, #e74c3c)';
    case 'queued': return 'var(--notion-yellow, #f1c40f)';
    default: return 'var(--notion-text-secondary)';
  }
}

interface ImportQueueMenuProps {
  onImportStarted?: (type: ImportType) => void;
  className?: string;
}

export const ImportQueueMenu: React.FC<ImportQueueMenuProps> = ({
  onImportStarted,
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [statuses, setStatuses] = useState<ImportJobStatus[]>([]);
  const [currentImport, setCurrentImport] = useState<ImportType | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; right: number } | null>(null);
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);
  const [syncProgress, setSyncProgress] = useState<Record<ImportType, { count: number; status: string }>>({
    tasks: { count: 0, status: 'Ready to sync' },
    projects: { count: 0, status: 'Ready to sync' },
    contacts: { count: 0, status: 'Ready to sync' },
    timeLogs: { count: 0, status: 'Ready to sync' },
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const logIdRef = useRef(0);

  const addLogEntry = useCallback((type: ImportType, message: string, level: SyncLogEntry['level'] = 'info') => {
    const entry: SyncLogEntry = {
      id: ++logIdRef.current,
      timestamp: new Date(),
      type,
      message,
      level
    };
    setSyncLog(prev => [...prev.slice(-50), entry]); // Keep last 50 entries
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const widgetAPI = getWidgetAPI();
      const queueStatus: ImportQueueStatus = await widgetAPI.getImportQueueStatus();
      setStatuses(queueStatus.allStatuses);
      setCurrentImport(queueStatus.currentImport);
    } catch (error) {
      console.error('Failed to load import queue status:', error);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    
    const widgetAPI = getWidgetAPI();
    const unsubscribe = widgetAPI.onImportQueueStatusChange?.((newStatuses: ImportJobStatus[]) => {
      setStatuses(newStatuses);
      const running = newStatuses.find(s => s.status === 'running');
      setCurrentImport(running?.type ?? null);
    });
    
    return () => {
      unsubscribe?.();
    };
  }, [loadStatus]);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [syncLog]);

  useEffect(() => {
    if (!isOpen) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleSync = async (type: ImportType) => {
    const widgetAPI = getWidgetAPI();
    
    setSyncProgress(prev => ({
      ...prev,
      [type]: { count: 0, status: 'Starting sync...' }
    }));
    setCurrentImport(type);
    addLogEntry(type, `Starting ${type} sync...`, 'info');
    
    try {
      onImportStarted?.(type);
      
      let result: any;
      
      switch (type) {
        case 'tasks':
          setSyncProgress(prev => ({ ...prev, tasks: { count: 0, status: 'Fetching from Notion...' } }));
          addLogEntry(type, 'Connecting to Notion API...', 'info');
          result = await widgetAPI.syncActiveTasksOnly();
          break;
        case 'projects':
          setSyncProgress(prev => ({ ...prev, projects: { count: 0, status: 'Fetching from Notion...' } }));
          addLogEntry(type, 'Connecting to Notion API...', 'info');
          result = await widgetAPI.syncActiveProjectsOnly();
          break;
        case 'contacts':
          setSyncProgress(prev => ({ ...prev, contacts: { count: 0, status: 'Fetching from Notion...' } }));
          addLogEntry(type, 'Connecting to Notion API...', 'info');
          result = await widgetAPI.importContacts();
          break;
        case 'timeLogs':
          setSyncProgress(prev => ({ ...prev, timeLogs: { count: 0, status: 'Fetching from Notion...' } }));
          addLogEntry(type, 'Connecting to Notion API...', 'info');
          result = await widgetAPI.importTimeLogs();
          break;
      }
      
      const count = result?.count || result?.inserted || result?.updated || 0;
      const links = result?.links || 0;
      
      setSyncProgress(prev => ({
        ...prev,
        [type]: { count, status: `✓ ${count} synced` }
      }));
      
      addLogEntry(type, `Synced ${count} ${type}${links > 0 ? ` (${links} links)` : ''}`, 'success');
      
      // Reset status after 3 seconds
      setTimeout(() => {
        setSyncProgress(prev => ({
          ...prev,
          [type]: { count, status: 'Ready to sync' }
        }));
      }, 3000);
      
      await loadStatus();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setSyncProgress(prev => ({
        ...prev,
        [type]: { count: 0, status: `✕ Error` }
      }));
      addLogEntry(type, `Error: ${errorMsg}`, 'error');
      console.error(`Failed to sync ${type}:`, error);
      
      // Reset status after 5 seconds
      setTimeout(() => {
        setSyncProgress(prev => ({
          ...prev,
          [type]: { count: 0, status: 'Ready to sync' }
        }));
      }, 5000);
    } finally {
      setCurrentImport(null);
    }
  };

  const handleCancel = async (type: ImportType) => {
    const widgetAPI = getWidgetAPI();
    try {
      await widgetAPI.cancelImport(type);
      addLogEntry(type, 'Sync cancelled', 'info');
      setSyncProgress(prev => ({
        ...prev,
        [type]: { count: 0, status: 'Cancelled' }
      }));
      await loadStatus();
    } catch (error) {
      console.error(`Failed to cancel ${type} sync:`, error);
    }
  };

  const getJobStatus = (type: ImportType): ImportJobStatus | undefined => {
    return statuses.find(s => s.type === type);
  };

  const isAnyRunning = currentImport !== null;

  const handleToggle = () => {
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right
      });
    }
    setIsOpen(!isOpen);
  };

  const clearLog = () => {
    setSyncLog([]);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className={`import-queue-menu-container ${className}`} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        type="button"
        className={`icon-button import-queue-button ${isAnyRunning ? 'importing' : ''}`}
        onClick={handleToggle}
        title={isAnyRunning ? `Syncing ${currentImport}...` : 'Sync from Notion'}
        aria-label="Sync menu"
        aria-expanded={isOpen}
      >
        <span className={`import-icon ${isAnyRunning ? 'spinning' : ''}`}>⟳</span>
        {isAnyRunning && <span className="import-badge" />}
      </button>

      {isOpen && dropdownPosition && (
        <div 
          ref={menuRef}
          className="import-queue-dropdown"
          role="menu"
          style={{ top: dropdownPosition.top, right: dropdownPosition.right }}
        >
          <div className="import-queue-header">
            <span className="import-queue-title">Sync from Notion</span>
            {isAnyRunning && (
              <span className="import-queue-status running">
                Syncing {currentImport}...
              </span>
            )}
          </div>
          
          <div className="import-queue-items">
            {IMPORT_OPTIONS.map((option) => {
              const jobStatus = getJobStatus(option.type);
              const isRunning = currentImport === option.type;
              const hasError = jobStatus?.status === 'error';
              const progress = syncProgress[option.type];
              
              return (
                <div 
                  key={option.type}
                  className={`import-queue-item ${isRunning ? 'running' : ''} ${hasError ? 'error' : ''}`}
                  role="menuitem"
                >
                  <div className="import-item-main">
                    <span className="import-item-icon">{option.icon}</span>
                    <div className="import-item-info">
                      <span className="import-item-label">{option.label}</span>
                      <span className={`import-item-status ${isRunning ? 'syncing' : progress.status.startsWith('✓') ? 'success' : progress.status.startsWith('✕') ? 'error' : ''}`}>
                        {progress.status}
                      </span>
                    </div>
                  </div>
                  
                  <div className="import-item-actions">
                    {isRunning ? (
                      <>
                        <span className="sync-spinner">⟳</span>
                        <button
                          type="button"
                          className="import-action-btn cancel"
                          onClick={() => handleCancel(option.type)}
                          title="Cancel sync"
                        >
                          ⏹
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="import-action-btn start"
                        onClick={() => handleSync(option.type)}
                        title={`Sync ${option.label}`}
                        disabled={isAnyRunning}
                      >
                        <span 
                          className="status-indicator"
                          style={{ color: getStatusColor(jobStatus?.status ?? 'completed') }}
                        >
                          {getStatusIcon(jobStatus?.status ?? 'completed')}
                        </span>
                        Sync
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Sync Log Section */}
          <div className="sync-log-section">
            <div className="sync-log-header">
              <span className="sync-log-title">Sync Log</span>
              {syncLog.length > 0 && (
                <button className="clear-log-btn" onClick={clearLog} title="Clear log">
                  Clear
                </button>
              )}
            </div>
            <div className="sync-log" ref={logRef}>
              {syncLog.length === 0 ? (
                <div className="sync-log-empty">No sync activity yet. Click Sync to start.</div>
              ) : (
                syncLog.map(entry => (
                  <div key={entry.id} className={`sync-log-entry ${entry.level}`}>
                    <span className="log-time">{formatTime(entry.timestamp)}</span>
                    <span className="log-type">[{entry.type}]</span>
                    <span className="log-message">{entry.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          
          <div className="import-queue-footer">
            <div className="import-queue-footer-actions">
              <button
                type="button"
                className="quick-sync-btn"
                onClick={async () => {
                  addLogEntry('tasks', 'Running quick sync (all active)...', 'info');
                  const widgetAPI = getWidgetAPI();
                  try {
                    // Sync tasks first
                    setCurrentImport('tasks');
                    setSyncProgress(prev => ({ ...prev, tasks: { count: 0, status: 'Syncing...' } }));
                    const taskResult = await widgetAPI.syncActiveTasksOnly();
                    addLogEntry('tasks', `Synced ${taskResult?.count || 0} tasks`, 'success');
                    setSyncProgress(prev => ({ ...prev, tasks: { count: taskResult?.count || 0, status: `✓ ${taskResult?.count || 0} synced` } }));
                    
                    // Then projects
                    setCurrentImport('projects');
                    setSyncProgress(prev => ({ ...prev, projects: { count: 0, status: 'Syncing...' } }));
                    const projResult = await widgetAPI.syncActiveProjectsOnly();
                    addLogEntry('projects', `Synced ${projResult?.count || 0} projects`, 'success');
                    setSyncProgress(prev => ({ ...prev, projects: { count: projResult?.count || 0, status: `✓ ${projResult?.count || 0} synced` } }));
                    
                    addLogEntry('tasks', 'Quick sync complete!', 'success');
                    onImportStarted?.('tasks');
                  } catch (error) {
                    addLogEntry('tasks', `Quick sync failed: ${error}`, 'error');
                    console.error('Quick sync failed:', error);
                  } finally {
                    setCurrentImport(null);
                    // Reset statuses after delay
                    setTimeout(() => {
                      setSyncProgress({
                        tasks: { count: 0, status: 'Ready to sync' },
                        projects: { count: 0, status: 'Ready to sync' },
                        contacts: { count: 0, status: 'Ready to sync' },
                        timeLogs: { count: 0, status: 'Ready to sync' },
                      });
                    }, 3000);
                  }
                }}
                disabled={isAnyRunning}
                title="Sync all active tasks and projects"
              >
                ↻ Quick Sync All
              </button>
            </div>
            <span className="import-queue-hint">
              Syncs active items from Notion to local database
            </span>
          </div>
        </div>
      )}

      <style>{`
        .import-queue-menu-container {
          display: inline-block;
        }

        .import-queue-button {
          position: relative;
        }

        .import-queue-button .import-icon {
          display: inline-block;
          transition: transform 0.3s ease;
        }

        .import-queue-button .import-icon.spinning {
          animation: spin 1s linear infinite;
        }

        .sync-spinner {
          display: inline-block;
          animation: spin 1s linear infinite;
          color: var(--notion-blue);
          font-size: 14px;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .import-queue-button .import-badge {
          position: absolute;
          top: 2px;
          right: 2px;
          width: 8px;
          height: 8px;
          background: var(--notion-blue);
          border-radius: 50%;
          animation: pulse 1.5s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.9); }
        }

        .import-queue-dropdown {
          position: fixed;
          min-width: 360px;
          max-width: 420px;
          background: var(--notion-bg-secondary);
          border: 1px solid var(--notion-border);
          border-radius: var(--radius-lg, 12px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
          z-index: 100000;
          animation: dropdownSlideIn 150ms ease-out;
          overflow: hidden;
        }

        @keyframes dropdownSlideIn {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .import-queue-header {
          padding: 12px 16px;
          border-bottom: 1px solid var(--notion-border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .import-queue-title {
          font-weight: 600;
          font-size: 14px;
          color: var(--notion-text);
        }

        .import-queue-status {
          font-size: 12px;
          padding: 2px 8px;
          border-radius: 4px;
          background: var(--notion-blue);
          color: white;
          opacity: 0.9;
        }

        .import-queue-items {
          padding: 8px 0;
        }

        .import-queue-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 16px;
          gap: 12px;
          transition: background 0.15s ease;
        }

        .import-queue-item:hover {
          background: var(--notion-bg-hover);
        }

        .import-queue-item.running {
          background: rgba(37, 99, 235, 0.1);
        }

        .import-queue-item.error {
          background: rgba(239, 68, 68, 0.08);
        }

        .import-item-main {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
          min-width: 0;
        }

        .import-item-icon {
          font-size: 18px;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--notion-bg);
          border-radius: 6px;
          flex-shrink: 0;
        }

        .import-item-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
          flex: 1;
        }

        .import-item-label {
          font-weight: 500;
          font-size: 13px;
          color: var(--notion-text);
        }

        .import-item-status {
          font-size: 11px;
          color: var(--notion-text-secondary);
        }

        .import-item-status.syncing {
          color: var(--notion-blue);
        }

        .import-item-status.success {
          color: var(--notion-green, #2ecc71);
        }

        .import-item-status.error {
          color: var(--notion-red, #e74c3c);
        }

        .import-item-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        .import-action-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 6px 12px;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .import-action-btn.start {
          background: var(--notion-bg);
          color: var(--notion-text);
          border: 1px solid var(--notion-border);
        }

        .import-action-btn.start:hover:not(:disabled) {
          background: var(--notion-blue);
          color: white;
          border-color: var(--notion-blue);
        }

        .import-action-btn.start:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .import-action-btn.cancel {
          background: transparent;
          color: var(--notion-red, #e74c3c);
          padding: 6px 8px;
        }

        .import-action-btn.cancel:hover {
          background: rgba(239, 68, 68, 0.1);
        }

        .status-indicator {
          font-size: 12px;
        }

        /* Sync Log Section */
        .sync-log-section {
          border-top: 1px solid var(--notion-border);
          background: var(--notion-bg);
        }

        .sync-log-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          border-bottom: 1px solid var(--notion-border);
        }

        .sync-log-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--notion-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .clear-log-btn {
          font-size: 11px;
          color: var(--notion-text-secondary);
          background: none;
          border: none;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 4px;
        }

        .clear-log-btn:hover {
          background: var(--notion-bg-hover);
          color: var(--notion-text);
        }

        .sync-log {
          max-height: 120px;
          overflow-y: auto;
          padding: 8px 12px;
          font-family: 'SF Mono', 'Consolas', monospace;
          font-size: 11px;
        }

        .sync-log-empty {
          color: var(--notion-text-secondary);
          font-style: italic;
          text-align: center;
          padding: 12px;
        }

        .sync-log-entry {
          display: flex;
          gap: 8px;
          padding: 3px 0;
          line-height: 1.4;
        }

        .sync-log-entry.info {
          color: var(--notion-text-secondary);
        }

        .sync-log-entry.success {
          color: var(--notion-green, #2ecc71);
        }

        .sync-log-entry.error {
          color: var(--notion-red, #e74c3c);
        }

        .sync-log-entry.progress {
          color: var(--notion-blue);
        }

        .log-time {
          color: var(--notion-text-secondary);
          opacity: 0.7;
          flex-shrink: 0;
        }

        .log-type {
          color: var(--notion-blue);
          flex-shrink: 0;
          min-width: 70px;
        }

        .log-message {
          flex: 1;
          word-break: break-word;
        }

        .import-queue-footer {
          padding: 10px 16px;
          border-top: 1px solid var(--notion-border);
          background: var(--notion-bg-secondary);
        }

        .import-queue-footer-actions {
          display: flex;
          justify-content: center;
          margin-bottom: 8px;
        }

        .quick-sync-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px 16px;
          border: 1px solid var(--notion-border);
          border-radius: 6px;
          background: var(--notion-bg);
          color: var(--notion-text);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
          width: 100%;
        }

        .quick-sync-btn:hover:not(:disabled) {
          background: var(--notion-blue);
          border-color: var(--notion-blue);
          color: white;
        }

        .quick-sync-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .import-queue-hint {
          font-size: 11px;
          color: var(--notion-text-secondary);
          line-height: 1.4;
          text-align: center;
          display: block;
        }
      `}</style>
    </div>
  );
};

export default ImportQueueMenu;
