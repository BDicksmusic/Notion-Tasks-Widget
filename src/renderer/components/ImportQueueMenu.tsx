import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { ImportJobStatus, ImportType, ImportQueueStatus } from '../../shared/types';

const getWidgetAPI = () => (window as any).widgetAPI;

interface ImportOption {
  type: ImportType;
  label: string;
  icon: string;
  description: string;
}

const IMPORT_OPTIONS: ImportOption[] = [
  { type: 'tasks', label: 'Tasks', icon: '☰', description: 'Import tasks from Notion' },
  { type: 'projects', label: 'Projects', icon: '📁', description: 'Import projects from Notion' },
  { type: 'contacts', label: 'Contacts', icon: '👤', description: 'Import contacts from Notion' },
  { type: 'timeLogs', label: 'Time Logs', icon: '⏱', description: 'Import time log entries' },
];

// Helper to get human-readable database names
function getDatabaseSettingsHint(type: ImportType): string {
  switch (type) {
    case 'tasks': return 'Tasks Database';
    case 'projects': return 'Projects Settings';
    case 'contacts': return 'Contacts Settings';
    case 'timeLogs': return 'Time Log Settings';
    default: return 'Settings';
  }
}

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
  /** Optional callback when an import is triggered */
  onImportStarted?: (type: ImportType) => void;
  /** Optional custom className */
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
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Load initial status
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

  // Subscribe to status updates
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

  // Close menu when clicking outside
  useEffect(() => {
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

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleImport = async (type: ImportType) => {
    const widgetAPI = getWidgetAPI();
    
    try {
      onImportStarted?.(type);
      
      switch (type) {
        case 'tasks':
          await widgetAPI.performInitialImport();
          break;
        case 'projects':
          await widgetAPI.importProjects();
          break;
        case 'contacts':
          await widgetAPI.importContacts();
          break;
        case 'timeLogs':
          await widgetAPI.importTimeLogs();
          break;
      }
      
      // Refresh status after import completes
      await loadStatus();
    } catch (error) {
      console.error(`Failed to import ${type}:`, error);
    }
  };

  const handleCancel = async (type: ImportType) => {
    const widgetAPI = getWidgetAPI();
    try {
      await widgetAPI.cancelImport(type);
      await loadStatus();
    } catch (error) {
      console.error(`Failed to cancel ${type} import:`, error);
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

  return (
    <div className={`import-queue-menu-container ${className}`} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        type="button"
        className={`icon-button import-queue-button ${isAnyRunning ? 'importing' : ''}`}
        onClick={handleToggle}
        title={isAnyRunning ? `Importing ${currentImport}...` : 'Import from Notion'}
        aria-label="Import menu"
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
            <span className="import-queue-title">Import from Notion</span>
            {isAnyRunning && (
              <span className="import-queue-status running">
                Importing {currentImport}...
              </span>
            )}
          </div>
          
          <div className="import-queue-items">
            {IMPORT_OPTIONS.map((option) => {
              const jobStatus = getJobStatus(option.type);
              const isRunning = jobStatus?.status === 'running';
              const hasError = jobStatus?.status === 'error';
              
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
                      {jobStatus?.message && (
                        <span className="import-item-message" title={jobStatus.message}>
                          {jobStatus.message.length > 40 
                            ? jobStatus.message.substring(0, 40) + '...' 
                            : jobStatus.message}
                        </span>
                      )}
                      {jobStatus?.error && (
                        <span className="import-item-error" title={jobStatus.error}>
                          {jobStatus.error.length > 40 
                            ? jobStatus.error.substring(0, 40) + '...' 
                            : jobStatus.error}
                        </span>
                      )}
                      {jobStatus?.message?.includes('No ') && jobStatus?.message?.includes('found') && (
                        <span className="import-item-hint">
                          Check {getDatabaseSettingsHint(option.type)} in Control Center
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="import-item-actions">
                    {isRunning ? (
                      <>
                        {jobStatus?.progress !== undefined && (
                          <span className="import-progress">{jobStatus.progress}%</span>
                        )}
                        <button
                          type="button"
                          className="import-action-btn cancel"
                          onClick={() => handleCancel(option.type)}
                          title="Cancel import"
                        >
                          ⏹
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="import-action-btn start"
                        onClick={() => handleImport(option.type)}
                        title={`Import ${option.label}`}
                        disabled={isAnyRunning}
                      >
                        <span 
                          className="status-indicator"
                          style={{ color: getStatusColor(jobStatus?.status ?? 'completed') }}
                        >
                          {getStatusIcon(jobStatus?.status ?? 'completed')}
                        </span>
                        Import
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          
          <div className="import-queue-footer">
            <div className="import-queue-footer-actions">
              <button
                type="button"
                className="quick-sync-btn"
                onClick={async () => {
                  const widgetAPI = getWidgetAPI();
                  try {
                    await widgetAPI.forceSync();
                    const tasks = await widgetAPI.getTasks();
                    onImportStarted?.('tasks');
                  } catch (error) {
                    console.error('Quick sync failed:', error);
                  }
                }}
                disabled={isAnyRunning}
                title="Quick sync - refreshes local data from cache"
              >
                ↻ Quick Sync
              </button>
            </div>
            <span className="import-queue-hint">
              Only one import runs at a time. Starting a new import will cancel the current one.
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
          min-width: 320px;
          max-width: 400px;
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
          max-height: 320px;
          overflow-y: auto;
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

        .import-item-message {
          font-size: 11px;
          color: var(--notion-text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .import-item-error {
          font-size: 11px;
          color: var(--notion-red, #e74c3c);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .import-item-hint {
          font-size: 10px;
          color: var(--notion-orange, #f39c12);
          font-style: italic;
        }

        .import-item-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        .import-progress {
          font-size: 12px;
          font-weight: 600;
          color: var(--notion-blue);
          min-width: 36px;
          text-align: right;
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

        .import-queue-footer {
          padding: 10px 16px;
          border-top: 1px solid var(--notion-border);
          background: var(--notion-bg);
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
          background: var(--notion-bg-secondary);
          color: var(--notion-text);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
          width: 100%;
        }

        .quick-sync-btn:hover:not(:disabled) {
          background: var(--notion-bg-hover);
          border-color: var(--notion-blue);
          color: var(--notion-blue);
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

