import React, { useState, useCallback } from 'react';
import type { 
  DatabaseVerificationResult, 
  FullVerificationResult,
  PropertyVerificationResult,
  VerifiableDatabaseType 
} from '../../shared/types';

const getWidgetAPI = () => (window as any).widgetAPI;

interface DatabaseVerificationProps {
  /** Which database type to verify */
  databaseType: VerifiableDatabaseType;
  /** Compact mode for inline display */
  compact?: boolean;
  /** Callback when verification completes */
  onVerificationComplete?: (result: DatabaseVerificationResult) => void;
}

function getStatusIcon(exists: boolean, isRequired: boolean): string {
  if (exists) return '✓';
  if (isRequired) return '✕';
  return '○';
}

function getStatusClass(exists: boolean, isRequired: boolean): string {
  if (exists) return 'success';
  if (isRequired) return 'error';
  return 'warning';
}

function getDatabaseLabel(type: VerifiableDatabaseType): string {
  switch (type) {
    case 'tasks': return 'Tasks';
    case 'projects': return 'Projects';
    case 'contacts': return 'Contacts';
    case 'timeLogs': return 'Time Logs';
    case 'writing': return 'Writing';
  }
}

export const DatabaseVerification: React.FC<DatabaseVerificationProps> = ({
  databaseType,
  compact = false,
  onVerificationComplete
}) => {
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<DatabaseVerificationResult | null>(null);
  const [expanded, setExpanded] = useState(false);

  const runVerification = useCallback(async () => {
    setVerifying(true);
    setResult(null);
    
    try {
      const widgetAPI = getWidgetAPI();
      let verificationResult: DatabaseVerificationResult;
      
      switch (databaseType) {
        case 'tasks':
          verificationResult = await widgetAPI.verifyTasksDatabase();
          break;
        case 'projects':
          verificationResult = await widgetAPI.verifyProjectsDatabase();
          break;
        case 'contacts':
          verificationResult = await widgetAPI.verifyContactsDatabase();
          break;
        case 'timeLogs':
          verificationResult = await widgetAPI.verifyTimeLogsDatabase();
          break;
        case 'writing':
          verificationResult = await widgetAPI.verifyWritingDatabase();
          break;
      }
      
      setResult(verificationResult);
      onVerificationComplete?.(verificationResult);
    } catch (error) {
      console.error('Verification failed:', error);
      setResult({
        databaseId: '',
        connected: false,
        error: error instanceof Error ? error.message : 'Verification failed',
        properties: [],
        availableProperties: []
      });
    } finally {
      setVerifying(false);
    }
  }, [databaseType, onVerificationComplete]);

  const hasErrors = result?.properties.some(p => !p.exists && p.isRequired);
  const hasWarnings = result?.properties.some(p => !p.exists && !p.isRequired && p.configuredValue);
  const allGood = result?.connected && !hasErrors && !hasWarnings;

  return (
    <div className={`database-verification ${compact ? 'compact' : ''}`}>
      <div className="verification-header">
        <button
          type="button"
          className={`verify-btn ${verifying ? 'verifying' : ''} ${result ? (allGood ? 'success' : hasErrors ? 'error' : 'warning') : ''}`}
          onClick={runVerification}
          disabled={verifying}
          title={`Verify ${getDatabaseLabel(databaseType)} configuration`}
        >
          {verifying ? (
            <>
              <span className="verify-spinner">⟳</span>
              Verifying...
            </>
          ) : result ? (
            <>
              <span className="verify-status-icon">
                {allGood ? '✓' : hasErrors ? '✕' : '⚠'}
              </span>
              {compact ? '' : (allGood ? 'Verified' : hasErrors ? 'Issues Found' : 'Warnings')}
            </>
          ) : (
            <>
              <span className="verify-icon">🔍</span>
              {compact ? '' : 'Verify Configuration'}
            </>
          )}
        </button>
        
        {result && !compact && (
          <button
            type="button"
            className="toggle-details-btn"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '▼ Hide Details' : '▶ Show Details'}
          </button>
        )}
      </div>

      {result && (compact ? expanded : true) && (
        <div className={`verification-result ${expanded || !compact ? 'expanded' : ''}`}>
          {/* Connection Status */}
          <div className={`connection-status ${result.connected ? 'connected' : 'disconnected'}`}>
            <span className="status-icon">{result.connected ? '🟢' : '🔴'}</span>
            <span className="status-text">
              {result.connected 
                ? `Connected to "${result.databaseName || 'Database'}"` 
                : result.error || 'Not connected'}
            </span>
          </div>

          {/* Property Verification Results */}
          {result.connected && result.properties.length > 0 && (
            <div className="property-results">
              <div className="property-header">
                <span>Property</span>
                <span>Status</span>
              </div>
              {result.properties.map((prop, idx) => (
                <div 
                  key={idx} 
                  className={`property-row ${getStatusClass(prop.exists, prop.isRequired)}`}
                >
                  <div className="property-info">
                    <span className="property-name">
                      {prop.configuredValue || '(not set)'}
                      {prop.isRequired && <span className="required-badge">*</span>}
                    </span>
                    {prop.actualType && (
                      <span className="property-type">{prop.actualType}</span>
                    )}
                    {prop.suggestion && (
                      <span className="property-suggestion">{prop.suggestion}</span>
                    )}
                  </div>
                  <div className="property-status">
                    <span className={`status-badge ${getStatusClass(prop.exists, prop.isRequired)}`}>
                      {getStatusIcon(prop.exists, prop.isRequired)}
                      {prop.exists ? 'OK' : prop.isRequired ? 'Missing' : 'Not Found'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Available Properties (collapsible) */}
          {result.connected && result.availableProperties.length > 0 && (
            <details className="available-properties">
              <summary>
                📋 Available Properties ({result.availableProperties.length})
              </summary>
              <div className="property-list">
                {result.availableProperties.map((prop, idx) => (
                  <div key={idx} className="available-property">
                    <span className="prop-name">{prop.name}</span>
                    <span className="prop-type">{prop.type}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <style>{`
        .database-verification {
          margin-top: 8px;
        }

        .database-verification.compact {
          display: inline-block;
        }

        .verification-header {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .verify-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border: 1px solid var(--notion-border);
          border-radius: 6px;
          background: var(--notion-bg);
          color: var(--notion-text);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .verify-btn:hover:not(:disabled) {
          background: var(--notion-bg-hover);
          border-color: var(--notion-blue);
        }

        .verify-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .verify-btn.verifying {
          background: var(--notion-bg-secondary);
        }

        .verify-btn.success {
          border-color: var(--notion-green, #2ecc71);
          background: rgba(46, 204, 113, 0.1);
        }

        .verify-btn.error {
          border-color: var(--notion-red, #e74c3c);
          background: rgba(231, 76, 60, 0.1);
        }

        .verify-btn.warning {
          border-color: var(--notion-orange, #f39c12);
          background: rgba(243, 156, 18, 0.1);
        }

        .verify-spinner {
          display: inline-block;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .toggle-details-btn {
          padding: 4px 8px;
          border: none;
          background: transparent;
          color: var(--notion-text-secondary);
          font-size: 11px;
          cursor: pointer;
        }

        .toggle-details-btn:hover {
          color: var(--notion-text);
        }

        .verification-result {
          margin-top: 12px;
          padding: 12px;
          background: var(--notion-bg-secondary);
          border-radius: 8px;
          border: 1px solid var(--notion-border);
        }

        .connection-status {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 6px;
          margin-bottom: 12px;
          font-size: 13px;
        }

        .connection-status.connected {
          background: rgba(46, 204, 113, 0.1);
          border: 1px solid rgba(46, 204, 113, 0.3);
        }

        .connection-status.disconnected {
          background: rgba(231, 76, 60, 0.1);
          border: 1px solid rgba(231, 76, 60, 0.3);
        }

        .property-results {
          border: 1px solid var(--notion-border);
          border-radius: 6px;
          overflow: hidden;
        }

        .property-header {
          display: flex;
          justify-content: space-between;
          padding: 8px 12px;
          background: var(--notion-bg);
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--notion-text-secondary);
          border-bottom: 1px solid var(--notion-border);
        }

        .property-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 10px 12px;
          border-bottom: 1px solid var(--notion-border);
          gap: 12px;
        }

        .property-row:last-child {
          border-bottom: none;
        }

        .property-row.success {
          background: rgba(46, 204, 113, 0.05);
        }

        .property-row.error {
          background: rgba(231, 76, 60, 0.08);
        }

        .property-row.warning {
          background: rgba(243, 156, 18, 0.05);
        }

        .property-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }

        .property-name {
          font-size: 13px;
          font-weight: 500;
          color: var(--notion-text);
        }

        .required-badge {
          color: var(--notion-red, #e74c3c);
          margin-left: 2px;
        }

        .property-type {
          font-size: 11px;
          color: var(--notion-text-secondary);
          font-family: monospace;
        }

        .property-suggestion {
          font-size: 11px;
          color: var(--notion-orange, #f39c12);
          margin-top: 2px;
        }

        .property-status {
          flex-shrink: 0;
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 500;
        }

        .status-badge.success {
          background: rgba(46, 204, 113, 0.2);
          color: var(--notion-green, #2ecc71);
        }

        .status-badge.error {
          background: rgba(231, 76, 60, 0.2);
          color: var(--notion-red, #e74c3c);
        }

        .status-badge.warning {
          background: rgba(243, 156, 18, 0.2);
          color: var(--notion-orange, #f39c12);
        }

        .available-properties {
          margin-top: 12px;
        }

        .available-properties summary {
          cursor: pointer;
          font-size: 12px;
          color: var(--notion-text-secondary);
          padding: 8px;
          border-radius: 4px;
        }

        .available-properties summary:hover {
          background: var(--notion-bg-hover);
        }

        .property-list {
          margin-top: 8px;
          max-height: 200px;
          overflow-y: auto;
          border: 1px solid var(--notion-border);
          border-radius: 4px;
        }

        .available-property {
          display: flex;
          justify-content: space-between;
          padding: 6px 10px;
          font-size: 12px;
          border-bottom: 1px solid var(--notion-border);
        }

        .available-property:last-child {
          border-bottom: none;
        }

        .available-property .prop-name {
          font-weight: 500;
        }

        .available-property .prop-type {
          color: var(--notion-text-secondary);
          font-family: monospace;
          font-size: 11px;
        }
      `}</style>
    </div>
  );
};

/**
 * Component to verify all databases at once
 */
export const VerifyAllDatabases: React.FC<{
  onComplete?: (result: FullVerificationResult) => void;
}> = ({ onComplete }) => {
  const [verifying, setVerifying] = useState(false);
  const [results, setResults] = useState<FullVerificationResult | null>(null);

  const verifyAll = useCallback(async () => {
    setVerifying(true);
    try {
      const widgetAPI = getWidgetAPI();
      const allResults = await widgetAPI.verifyAllDatabases();
      setResults(allResults);
      onComplete?.(allResults);
    } catch (error) {
      console.error('Verification failed:', error);
    } finally {
      setVerifying(false);
    }
  }, [onComplete]);

  const getOverallStatus = () => {
    if (!results) return null;
    
    const databases = [results.tasks, results.projects, results.contacts, results.timeLogs, results.writing].filter(Boolean);
    const connectedCount = databases.filter(d => d?.connected).length;
    const errorCount = databases.filter(d => d?.properties.some(p => !p.exists && p.isRequired)).length;
    
    return { total: databases.length, connected: connectedCount, errors: errorCount };
  };

  const status = getOverallStatus();

  return (
    <div className="verify-all-databases">
      <button
        type="button"
        className={`verify-all-btn ${verifying ? 'verifying' : ''} ${status ? (status.errors > 0 ? 'has-errors' : 'all-good') : ''}`}
        onClick={verifyAll}
        disabled={verifying}
      >
        {verifying ? (
          <>
            <span className="verify-spinner">⟳</span>
            Verifying All Databases...
          </>
        ) : (
          <>
            <span className="verify-icon">🔍</span>
            Verify All Database Configurations
          </>
        )}
      </button>

      {status && (
        <div className="verification-summary">
          <span className={`summary-badge ${status.errors > 0 ? 'error' : 'success'}`}>
            {status.connected}/{status.total} databases connected
            {status.errors > 0 && `, ${status.errors} with errors`}
          </span>
        </div>
      )}

      {results && (
        <div className="all-results">
          {results.tasks && (
            <DatabaseResultSummary label="Tasks" result={results.tasks} />
          )}
          {results.projects && (
            <DatabaseResultSummary label="Projects" result={results.projects} />
          )}
          {results.contacts && (
            <DatabaseResultSummary label="Contacts" result={results.contacts} />
          )}
          {results.timeLogs && (
            <DatabaseResultSummary label="Time Logs" result={results.timeLogs} />
          )}
          {results.writing && (
            <DatabaseResultSummary label="Writing" result={results.writing} />
          )}
        </div>
      )}

      <style>{`
        .verify-all-databases {
          padding: 16px;
          background: var(--notion-bg-secondary);
          border-radius: 8px;
          border: 1px solid var(--notion-border);
        }

        .verify-all-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          padding: 12px 16px;
          border: 2px solid var(--notion-border);
          border-radius: 8px;
          background: var(--notion-bg);
          color: var(--notion-text);
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .verify-all-btn:hover:not(:disabled) {
          background: var(--notion-bg-hover);
          border-color: var(--notion-blue);
        }

        .verify-all-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .verify-all-btn.has-errors {
          border-color: var(--notion-red, #e74c3c);
        }

        .verify-all-btn.all-good {
          border-color: var(--notion-green, #2ecc71);
        }

        .verification-summary {
          margin-top: 12px;
          text-align: center;
        }

        .summary-badge {
          display: inline-block;
          padding: 6px 12px;
          border-radius: 16px;
          font-size: 13px;
          font-weight: 500;
        }

        .summary-badge.success {
          background: rgba(46, 204, 113, 0.15);
          color: var(--notion-green, #2ecc71);
        }

        .summary-badge.error {
          background: rgba(231, 76, 60, 0.15);
          color: var(--notion-red, #e74c3c);
        }

        .all-results {
          margin-top: 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .verify-spinner {
          display: inline-block;
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
};

/**
 * Compact summary of a single database verification result
 */
const DatabaseResultSummary: React.FC<{
  label: string;
  result: DatabaseVerificationResult;
}> = ({ label, result }) => {
  const [expanded, setExpanded] = useState(false);
  
  const errorCount = result.properties.filter(p => !p.exists && p.isRequired).length;
  const warningCount = result.properties.filter(p => !p.exists && !p.isRequired && p.configuredValue).length;
  const okCount = result.properties.filter(p => p.exists).length;

  return (
    <div className={`db-result-summary ${result.connected ? 'connected' : 'disconnected'}`}>
      <div 
        className="result-header"
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer' }}
      >
        <div className="result-label">
          <span className="status-dot">{result.connected ? '🟢' : '🔴'}</span>
          <span className="db-name">{label}</span>
          {result.databaseName && (
            <span className="notion-name">({result.databaseName})</span>
          )}
        </div>
        <div className="result-badges">
          {result.connected ? (
            <>
              {okCount > 0 && <span className="badge ok">{okCount} ✓</span>}
              {errorCount > 0 && <span className="badge error">{errorCount} ✕</span>}
              {warningCount > 0 && <span className="badge warning">{warningCount} ⚠</span>}
            </>
          ) : (
            <span className="badge error">Not Connected</span>
          )}
          <span className="expand-icon">{expanded ? '▼' : '▶'}</span>
        </div>
      </div>
      
      {expanded && (
        <div className="result-details">
          {!result.connected && result.error && (
            <div className="error-message">{result.error}</div>
          )}
          {result.connected && result.properties.length > 0 && (
            <div className="property-mini-list">
              {result.properties.map((prop, idx) => (
                <div key={idx} className={`mini-prop ${getStatusClass(prop.exists, prop.isRequired)}`}>
                  <span className="mini-name">{prop.configuredValue || '(empty)'}</span>
                  <span className={`mini-status ${getStatusClass(prop.exists, prop.isRequired)}`}>
                    {getStatusIcon(prop.exists, prop.isRequired)}
                  </span>
                  {prop.suggestion && <span className="mini-suggestion">{prop.suggestion}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`
        .db-result-summary {
          background: var(--notion-bg);
          border: 1px solid var(--notion-border);
          border-radius: 6px;
          overflow: hidden;
        }

        .db-result-summary.connected {
          border-left: 3px solid var(--notion-green, #2ecc71);
        }

        .db-result-summary.disconnected {
          border-left: 3px solid var(--notion-red, #e74c3c);
        }

        .result-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 12px;
        }

        .result-header:hover {
          background: var(--notion-bg-hover);
        }

        .result-label {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .status-dot {
          font-size: 10px;
        }

        .db-name {
          font-weight: 600;
          font-size: 13px;
        }

        .notion-name {
          font-size: 11px;
          color: var(--notion-text-secondary);
        }

        .result-badges {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .badge {
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 500;
        }

        .badge.ok {
          background: rgba(46, 204, 113, 0.15);
          color: var(--notion-green, #2ecc71);
        }

        .badge.error {
          background: rgba(231, 76, 60, 0.15);
          color: var(--notion-red, #e74c3c);
        }

        .badge.warning {
          background: rgba(243, 156, 18, 0.15);
          color: var(--notion-orange, #f39c12);
        }

        .expand-icon {
          font-size: 10px;
          color: var(--notion-text-secondary);
          margin-left: 4px;
        }

        .result-details {
          padding: 0 12px 12px;
          border-top: 1px solid var(--notion-border);
        }

        .error-message {
          padding: 8px;
          margin-top: 8px;
          background: rgba(231, 76, 60, 0.1);
          border-radius: 4px;
          font-size: 12px;
          color: var(--notion-red, #e74c3c);
        }

        .property-mini-list {
          margin-top: 8px;
        }

        .mini-prop {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          font-size: 12px;
          border-radius: 4px;
          margin-bottom: 2px;
        }

        .mini-prop.success { background: rgba(46, 204, 113, 0.08); }
        .mini-prop.error { background: rgba(231, 76, 60, 0.08); }
        .mini-prop.warning { background: rgba(243, 156, 18, 0.08); }

        .mini-name {
          font-weight: 500;
        }

        .mini-status {
          font-size: 10px;
        }

        .mini-status.success { color: var(--notion-green, #2ecc71); }
        .mini-status.error { color: var(--notion-red, #e74c3c); }
        .mini-status.warning { color: var(--notion-orange, #f39c12); }

        .mini-suggestion {
          width: 100%;
          font-size: 11px;
          color: var(--notion-orange, #f39c12);
          font-style: italic;
        }
      `}</style>
    </div>
  );
};

export default DatabaseVerification;

