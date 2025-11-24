import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  TimeLogEntry,
  TimeLogSettings,
  TimeLogUpdatePayload
} from '@shared/types';
import { widgetBridge } from '@shared/platform';

interface Props {
  settings: TimeLogSettings | null;
}

type ViewMode = 'gallery' | 'timeline';

const widgetAPI = widgetBridge;

const formatDuration = (minutes: number | null): string => {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

const formatTime = (timeString: string | null | undefined): string => {
  if (!timeString) return '—';
  const date = new Date(timeString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};

const formatDate = (timeString: string | null | undefined): string => {
  if (!timeString) return '—';
  const date = new Date(timeString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
  });
};

const TimeLogWidget = ({ settings }: Props) => {
  const [entries, setEntries] = useState<TimeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('gallery');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    startTime: string;
    endTime: string;
    title: string;
  } | null>(null);

  const fetchEntries = useCallback(async () => {
    if (!settings?.databaseId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await widgetAPI.getAllTimeLogs();
      setEntries(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load time logs'
      );
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleEdit = useCallback((entry: TimeLogEntry) => {
    setEditingId(entry.id);
    setEditForm({
      startTime: entry.startTime ? new Date(entry.startTime).toISOString().slice(0, 16) : '',
      endTime: entry.endTime ? new Date(entry.endTime).toISOString().slice(0, 16) : '',
      title: entry.title || ''
    });
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId || !editForm) return;

    try {
      const updates: TimeLogUpdatePayload = {
        startTime: editForm.startTime ? new Date(editForm.startTime).toISOString() : null,
        endTime: editForm.endTime ? new Date(editForm.endTime).toISOString() : null,
        title: editForm.title || null
      };
      
      await widgetAPI.updateTimeLogEntry(editingId, updates);
      setEditingId(null);
      setEditForm(null);
      await fetchEntries();
    } catch (err) {
      console.error('Failed to update time log entry', err);
      alert(err instanceof Error ? err.message : 'Failed to update entry');
    }
  }, [editingId, editForm, fetchEntries]);

  const handleDelete = useCallback(async (entryId: string) => {
    if (!confirm('Are you sure you want to delete this time log entry?')) {
      return;
    }

    try {
      await widgetAPI.deleteTimeLogEntry(entryId);
      await fetchEntries();
    } catch (err) {
      console.error('Failed to delete time log entry', err);
      alert(err instanceof Error ? err.message : 'Failed to delete entry');
    }
  }, [fetchEntries]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditForm(null);
  }, []);

  // Group entries by date for timeline view
  const groupedEntries = useMemo(() => {
    const groups: Record<string, TimeLogEntry[]> = {};
    entries.forEach((entry) => {
      if (!entry.startTime) return;
      const date = new Date(entry.startTime);
      const dateKey = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(entry);
    });
    // Sort entries within each group by start time
    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => {
        const timeA = a.startTime ? new Date(a.startTime).getTime() : 0;
        const timeB = b.startTime ? new Date(b.startTime).getTime() : 0;
        return timeA - timeB;
      });
    });
    return groups;
  }, [entries]);

  // Calculate timeline bounds
  const timelineBounds = useMemo(() => {
    if (viewMode !== 'timeline' || entries.length === 0) return null;
    
    const times = entries
      .filter((e) => e.startTime)
      .map((e) => new Date(e.startTime!).getTime());
    
    if (times.length === 0) return null;
    
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    
    // Add padding
    const padding = (maxTime - minTime) * 0.1 || 3600000; // 10% or 1 hour
    return {
      start: minTime - padding,
      end: maxTime + padding,
      range: maxTime - minTime + padding * 2
    };
  }, [viewMode, entries]);

  const getTimelinePosition = (timeString: string | null | undefined): number => {
    if (!timeString || !timelineBounds) return 0;
    const time = new Date(timeString).getTime();
    return ((time - timelineBounds.start) / timelineBounds.range) * 100;
  };

  const getTimelineWidth = (entry: TimeLogEntry): number => {
    if (!entry.startTime) return 0;
    if (!entry.endTime) {
      // Active session - show as extending to now
      const now = Date.now();
      const start = new Date(entry.startTime).getTime();
      return ((now - start) / timelineBounds!.range) * 100;
    }
    const start = new Date(entry.startTime).getTime();
    const end = new Date(entry.endTime).getTime();
    return ((end - start) / timelineBounds!.range) * 100;
  };

  if (!settings?.databaseId) {
    return (
      <section className="timelog-widget log-surface">
        <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>
          <p>Time log widget is not configured yet.</p>
          <p style={{ fontSize: '0.9em', marginTop: '0.5rem' }}>
            Please configure it in the settings.
          </p>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="timelog-widget log-surface">
        <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="timelog-widget log-surface">
        <div style={{ padding: '2rem', textAlign: 'center', color: '#f44336' }}>
          <p>Error: {error}</p>
          <button
            type="button"
            onClick={fetchEntries}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              background: '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="timelog-widget log-surface">
      <div style={{ padding: '1rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem'
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Time Logs</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => setViewMode('gallery')}
              className={viewMode === 'gallery' ? 'active' : ''}
              style={{
                padding: '0.5rem 1rem',
                background: viewMode === 'gallery' ? '#2196F3' : 'transparent',
                color: viewMode === 'gallery' ? 'white' : '#666',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Gallery
            </button>
            <button
              type="button"
              onClick={() => setViewMode('timeline')}
              className={viewMode === 'timeline' ? 'active' : ''}
              style={{
                padding: '0.5rem 1rem',
                background: viewMode === 'timeline' ? '#2196F3' : 'transparent',
                color: viewMode === 'timeline' ? 'white' : '#666',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Timeline
            </button>
            <button
              type="button"
              onClick={fetchEntries}
              style={{
                padding: '0.5rem 1rem',
                background: 'transparent',
                color: '#666',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Refresh
            </button>
          </div>
        </div>

        {viewMode === 'gallery' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '1rem'
            }}
          >
            {entries.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '2rem', color: '#888' }}>
                No time log entries found.
              </div>
            ) : (
              entries.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    padding: '1rem',
                    background: '#fff'
                  }}
                >
                  {editingId === entry.id && editForm ? (
                    <div>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9em' }}>
                          Title
                        </label>
                        <input
                          type="text"
                          value={editForm.title}
                          onChange={(e) =>
                            setEditForm({ ...editForm, title: e.target.value })
                          }
                          style={{
                            width: '100%',
                            padding: '0.5rem',
                            border: '1px solid #ddd',
                            borderRadius: '4px'
                          }}
                        />
                      </div>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9em' }}>
                          Start Time
                        </label>
                        <input
                          type="datetime-local"
                          value={editForm.startTime}
                          onChange={(e) =>
                            setEditForm({ ...editForm, startTime: e.target.value })
                          }
                          style={{
                            width: '100%',
                            padding: '0.5rem',
                            border: '1px solid #ddd',
                            borderRadius: '4px'
                          }}
                        />
                      </div>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9em' }}>
                          End Time
                        </label>
                        <input
                          type="datetime-local"
                          value={editForm.endTime}
                          onChange={(e) =>
                            setEditForm({ ...editForm, endTime: e.target.value })
                          }
                          style={{
                            width: '100%',
                            padding: '0.5rem',
                            border: '1px solid #ddd',
                            borderRadius: '4px'
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={handleSaveEdit}
                          style={{
                            padding: '0.5rem 1rem',
                            background: '#4CAF50',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          style={{
                            padding: '0.5rem 1rem',
                            background: '#f44336',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <strong style={{ fontSize: '1.1em' }}>
                          {entry.title || 'Untitled'}
                        </strong>
                      </div>
                      <div style={{ fontSize: '0.9em', color: '#666', marginBottom: '0.5rem' }}>
                        <div>Start: {formatTime(entry.startTime)}</div>
                        <div>End: {formatTime(entry.endTime)}</div>
                        <div>Duration: {formatDuration(entry.durationMinutes)}</div>
                        <div>Date: {formatDate(entry.startTime)}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={() => handleEdit(entry)}
                          style={{
                            padding: '0.25rem 0.5rem',
                            background: '#2196F3',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.9em'
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(entry.id)}
                          style={{
                            padding: '0.25rem 0.5rem',
                            background: '#f44336',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.9em'
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {viewMode === 'timeline' && (
          <div style={{ position: 'relative' }}>
            {Object.keys(groupedEntries).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
                No time log entries found.
              </div>
            ) : (
              Object.entries(groupedEntries).map(([dateKey, dateEntries]) => (
                <div key={dateKey} style={{ marginBottom: '3rem' }}>
                  <h3 style={{ marginBottom: '1rem', fontSize: '1.1em' }}>{dateKey}</h3>
                  <div
                    style={{
                      position: 'relative',
                      height: `${Math.max(200, dateEntries.length * 60)}px`,
                      background: '#f5f5f5',
                      borderRadius: '4px',
                      padding: '1rem',
                      border: '1px solid #ddd'
                    }}
                  >
                    {/* Current time indicator */}
                    {timelineBounds && (
                      <div
                        style={{
                          position: 'absolute',
                          left: `${getTimelinePosition(new Date().toISOString())}%`,
                          top: 0,
                          bottom: 0,
                          width: '2px',
                          background: '#f44336',
                          zIndex: 10,
                          pointerEvents: 'none'
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: '-8px',
                            left: '-4px',
                            width: '10px',
                            height: '10px',
                            background: '#f44336',
                            borderRadius: '50%'
                          }}
                        />
                      </div>
                    )}
                    
                    {/* Time markers */}
                    {timelineBounds && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          height: '30px',
                          borderBottom: '1px solid #ddd'
                        }}
                      >
                        {Array.from({ length: 13 }).map((_, i) => {
                          const hour = 8 + i * 0.5; // 8 AM to 2 PM in 30-min intervals
                          const time = new Date(timelineBounds.start);
                          time.setHours(Math.floor(hour), (hour % 1) * 60, 0, 0);
                          const position = getTimelinePosition(time.toISOString());
                          return (
                            <div
                              key={i}
                              style={{
                                position: 'absolute',
                                left: `${position}%`,
                                top: 0,
                                height: '100%',
                                borderLeft: '1px solid #ddd',
                                fontSize: '0.75em',
                                paddingLeft: '4px',
                                color: '#666'
                              }}
                            >
                              {time.toLocaleTimeString('en-US', {
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true
                              })}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Entries */}
                    {dateEntries.map((entry, index) => {
                      const position = getTimelinePosition(entry.startTime);
                      const width = getTimelineWidth(entry);
                      const isActive = !entry.endTime;
                      
                      return (
                        <div
                          key={entry.id}
                          style={{
                            position: 'absolute',
                            left: `${position}%`,
                            top: `${40 + index * 60}px`,
                            width: `${Math.max(width, 2)}%`,
                            minWidth: '100px',
                            height: '50px',
                            background: isActive ? '#4CAF50' : '#2196F3',
                            borderRadius: '4px',
                            padding: '0.5rem',
                            color: 'white',
                            cursor: 'pointer',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                            zIndex: 5
                          }}
                          title={`${entry.title || 'Untitled'} - ${formatTime(entry.startTime)} to ${formatTime(entry.endTime) || 'now'}`}
                          onClick={() => handleEdit(entry)}
                        >
                          <div style={{ fontSize: '0.9em', fontWeight: 'bold' }}>
                            {entry.title || 'Untitled'}
                          </div>
                          <div style={{ fontSize: '0.75em', opacity: 0.9 }}>
                            {formatTime(entry.startTime)} - {formatTime(entry.endTime) || 'now'}
                          </div>
                          <div style={{ fontSize: '0.75em', opacity: 0.9 }}>
                            {formatDuration(entry.durationMinutes)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default TimeLogWidget;

