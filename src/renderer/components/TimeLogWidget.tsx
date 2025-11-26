import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  TimeLogEntry,
  TimeLogSettings,
  TimeLogUpdatePayload
} from '@shared/types';
import { widgetBridge } from '@shared/platform';
import SearchInput from './SearchInput';

interface Props {
  settings: TimeLogSettings | null;
}

type ViewMode = 'gallery' | 'timeline';

const widgetAPI = widgetBridge;

// Helper function to search time log entries
const entryMatchesSearch = (entry: TimeLogEntry, query: string): boolean => {
  if (!query.trim()) return true;
  const lowerQuery = query.toLowerCase().trim();
  const searchFields = [
    entry.title,
    entry.taskTitle
  ].filter(Boolean);
  return searchFields.some((field) =>
    field!.toLowerCase().includes(lowerQuery)
  );
};

const formatDuration = (minutes: number | null): string => {
  if (minutes === null || minutes === undefined) return '—';
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
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const isToday = date.toDateString() === today.toDateString();
  const isYesterday = date.toDateString() === yesterday.toDateString();
  
  if (isToday) return 'Today';
  if (isYesterday) return 'Yesterday';
  
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
  });
};

const formatDateHeading = (timeString: string): string => {
  const date = new Date(timeString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const isToday = date.toDateString() === today.toDateString();
  const isYesterday = date.toDateString() === yesterday.toDateString();
  
  if (isToday) return 'Today';
  if (isYesterday) return 'Yesterday';
  
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });
};

const TimeLogWidget = ({ settings }: Props) => {
  const [entries, setEntries] = useState<TimeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('gallery');
  const [searchQuery, setSearchQuery] = useState('');
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
    if (!confirm('Delete this time log entry?')) {
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

  // Filter entries by search query
  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    return entries.filter((entry) => entryMatchesSearch(entry, searchQuery));
  }, [entries, searchQuery]);

  // Group entries by date for timeline view
  const groupedEntries = useMemo(() => {
    const groups: Record<string, TimeLogEntry[]> = {};
    
    // Sort entries by start time (newest first)
    const sorted = [...filteredEntries].sort((a, b) => {
      const timeA = a.startTime ? new Date(a.startTime).getTime() : 0;
      const timeB = b.startTime ? new Date(b.startTime).getTime() : 0;
      return timeB - timeA;
    });
    
    sorted.forEach((entry) => {
      if (!entry.startTime) return;
      const date = new Date(entry.startTime);
      const dateKey = date.toDateString();
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(entry);
    });
    
    // Sort entries within each group by start time (oldest first for timeline)
    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => {
        const timeA = a.startTime ? new Date(a.startTime).getTime() : 0;
        const timeB = b.startTime ? new Date(b.startTime).getTime() : 0;
        return timeA - timeB;
      });
    });
    
    return groups;
  }, [filteredEntries]);

  // Sort gallery entries (newest first)
  const sortedEntries = useMemo(() => {
    return [...filteredEntries].sort((a, b) => {
      const timeA = a.startTime ? new Date(a.startTime).getTime() : 0;
      const timeB = b.startTime ? new Date(b.startTime).getTime() : 0;
      return timeB - timeA;
    });
  }, [filteredEntries]);

  if (!settings?.databaseId) {
    return (
      <section className="timelog-widget-v2">
        <div className="timelog-empty-state">
          <div className="empty-icon">⏱</div>
          <h3>Time Log not configured</h3>
          <p>Add your Time Log database ID in settings to start tracking.</p>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="timelog-widget-v2">
        <div className="timelog-empty-state">
          <div className="loading-spinner" />
          <p>Loading time logs...</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="timelog-widget-v2">
        <div className="timelog-empty-state error">
          <div className="empty-icon">⚠️</div>
          <p>{error}</p>
          <button type="button" className="retry-button" onClick={fetchEntries}>
            Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="timelog-widget-v2">
      <header className="timelog-header-v2">
        <div className="timelog-header-left">
          <span className="timelog-title">
            {searchQuery ? `${filteredEntries.length} of ${entries.length}` : entries.length} entries
          </span>
        </div>
        <div className="timelog-header-right">
          <div className="timelog-view-toggle">
            <button
              type="button"
              className={`timelog-view-btn ${viewMode === 'gallery' ? 'active' : ''}`}
              onClick={() => setViewMode('gallery')}
            >
              List
            </button>
            <button
              type="button"
              className={`timelog-view-btn ${viewMode === 'timeline' ? 'active' : ''}`}
              onClick={() => setViewMode('timeline')}
            >
              Timeline
            </button>
          </div>
          <button
            type="button"
            className="timelog-refresh-btn"
            onClick={fetchEntries}
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </header>

      <div className="timelog-search-bar">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search time logs…"
          compact
        />
      </div>

      <div className="timelog-scroll-area">
        {filteredEntries.length === 0 ? (
          <div className="timelog-empty-state">
            <div className="empty-icon">{searchQuery ? '🔍' : '📋'}</div>
            <h3>{searchQuery ? `No results for "${searchQuery}"` : 'No time logs yet'}</h3>
            <p>
              {searchQuery
                ? 'Try a different search term'
                : 'Start a session on a task to begin tracking time.'}
            </p>
            {searchQuery && (
              <button
                type="button"
                className="retry-button"
                onClick={() => setSearchQuery('')}
              >
                Clear search
              </button>
            )}
          </div>
        ) : viewMode === 'gallery' ? (
          <div className="timelog-gallery">
            {sortedEntries.map((entry) => {
              const isEditing = editingId === entry.id;
              const isActive = !entry.endTime;
              
              if (isEditing && editForm) {
                return (
                  <div key={entry.id} className="timelog-edit-form">
                    <div className="timelog-edit-field">
                      <label>Title</label>
                      <input
                        type="text"
                        value={editForm.title}
                        onChange={(e) =>
                          setEditForm({ ...editForm, title: e.target.value })
                        }
                        placeholder="Session title"
                      />
                    </div>
                    <div className="timelog-edit-field">
                      <label>Start Time</label>
                      <input
                        type="datetime-local"
                        value={editForm.startTime}
                        onChange={(e) =>
                          setEditForm({ ...editForm, startTime: e.target.value })
                        }
                      />
                    </div>
                    <div className="timelog-edit-field">
                      <label>End Time</label>
                      <input
                        type="datetime-local"
                        value={editForm.endTime}
                        onChange={(e) =>
                          setEditForm({ ...editForm, endTime: e.target.value })
                        }
                      />
                    </div>
                    <div className="timelog-edit-actions">
                      <button
                        type="button"
                        className="timelog-edit-btn cancel"
                        onClick={handleCancelEdit}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="timelog-edit-btn save"
                        onClick={handleSaveEdit}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                );
              }
              
              return (
                <div
                  key={entry.id}
                  className={`timelog-entry-card ${isActive ? 'is-active' : ''}`}
                >
                  <div className="timelog-entry-time-block">
                    <span className="timelog-entry-duration">
                      {isActive ? 'Active' : formatDuration(entry.durationMinutes ?? null)}
                    </span>
                    <span className="timelog-entry-range">
                      {formatTime(entry.startTime)}
                      {' → '}
                      {isActive ? 'now' : formatTime(entry.endTime)}
                    </span>
                  </div>
                  
                  <div className="timelog-entry-main">
                    <div className="timelog-entry-title">
                      {entry.title || entry.taskTitle || 'Untitled session'}
                    </div>
                    <div className="timelog-entry-date">
                      {formatDate(entry.startTime)}
                    </div>
                  </div>
                  
                  <div className="timelog-entry-actions">
                    <button
                      type="button"
                      className="timelog-action-btn"
                      onClick={() => handleEdit(entry)}
                      title="Edit"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="timelog-action-btn danger"
                      onClick={() => handleDelete(entry.id)}
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="timelog-timeline">
            {Object.entries(groupedEntries).map(([dateKey, dateEntries]) => (
              <div key={dateKey} className="timelog-day-group">
                <div className="timelog-day-header">
                  {formatDateHeading(dateEntries[0]?.startTime ?? dateKey)}
                </div>
                <div className="timelog-day-entries">
                  {dateEntries.map((entry) => {
                    const isActive = !entry.endTime;
                    return (
                      <div
                        key={entry.id}
                        className={`timelog-timeline-entry ${isActive ? 'is-active' : ''}`}
                      >
                        <span className="timelog-timeline-time">
                          {formatTime(entry.startTime)} – {isActive ? 'now' : formatTime(entry.endTime)}
                        </span>
                        <span className="timelog-timeline-title">
                          {entry.title || entry.taskTitle || 'Untitled'}
                        </span>
                        <span className="timelog-timeline-duration">
                          {isActive ? '●' : formatDuration(entry.durationMinutes ?? null)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default TimeLogWidget;
