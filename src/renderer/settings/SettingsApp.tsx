import { useCallback, useEffect, useMemo, useState } from 'react';
import { settingsBridge, widgetBridge } from '@shared/platform';
import type { DockState, NotionSettings, WritingSettings, TimeLogSettings } from '@shared/types';

type Feedback = {
  kind: 'success' | 'error';
  message: string;
};

const widgetAPI = widgetBridge;
const settingsAPI = settingsBridge;

const SettingsApp = () => {
  const [taskSettings, setTaskSettings] = useState<NotionSettings | null>(null);
  const [writingSettings, setWritingSettings] = useState<WritingSettings | null>(
    null
  );
  const [timeLogSettings, setTimeLogSettings] = useState<TimeLogSettings | null>(null);
  const [dockState, setDockState] = useState<DockState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [taskSaving, setTaskSaving] = useState(false);
  const [writingSaving, setWritingSaving] = useState(false);
  const [timeLogSaving, setTimeLogSaving] = useState(false);
  const [taskFeedback, setTaskFeedback] = useState<Feedback | null>(null);
  const [writingFeedback, setWritingFeedback] = useState<Feedback | null>(null);
  const [timeLogFeedback, setTimeLogFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const [tasks, writing, timeLog, dock] = await Promise.all([
          settingsAPI.getTaskSettings(),
          settingsAPI.getWritingSettings(),
          settingsAPI.getTimeLogSettings(),
          widgetAPI.getDockState()
        ]);
        if (!cancelled) {
          setTaskSettings(tasks);
          setWritingSettings(writing);
          setTimeLogSettings(timeLog);
          setDockState(dock ?? null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error
              ? err.message
              : 'Unable to load global settings'
          );
          setLoading(false);
        }
      }
    }
    bootstrap();

    const unsubscribe = widgetAPI.onDockStateChange((state) => {
      if (!cancelled) {
        setDockState(state);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const handleTaskFieldChange = useCallback(
    (field: keyof NotionSettings, value: string) => {
      setTaskSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
    },
    []
  );

  const handleStatusPresetsChange = useCallback((value: string) => {
    const entries = value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    setTaskSettings((prev) => (prev ? { ...prev, statusPresets: entries } : prev));
  }, []);

  const handleTaskSave = useCallback(async () => {
    if (!taskSettings) return;
    try {
      setTaskSaving(true);
      setTaskFeedback(null);
      const saved = await settingsAPI.updateTaskSettings(taskSettings);
      setTaskSettings(saved);
      setTaskFeedback({ kind: 'success', message: 'Task settings saved' });
    } catch (err) {
      setTaskFeedback({
        kind: 'error',
        message:
          err instanceof Error ? err.message : 'Unable to save task settings'
      });
    } finally {
      setTaskSaving(false);
    }
  }, [taskSettings]);

  const handleWritingFieldChange = useCallback(
    (field: keyof WritingSettings, value: string) => {
      setWritingSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
    },
    []
  );

  const handleWritingSave = useCallback(async () => {
    if (!writingSettings) return;
    try {
      setWritingSaving(true);
      setWritingFeedback(null);
      const saved = await settingsAPI.updateWritingSettings(
        writingSettings
      );
      setWritingSettings(saved);
      setWritingFeedback({
        kind: 'success',
        message: 'Writing widget settings saved'
      });
    } catch (err) {
      setWritingFeedback({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Unable to save writing settings'
      });
    } finally {
      setWritingSaving(false);
    }
  }, [writingSettings]);

  const handleTimeLogFieldChange = useCallback(
    (field: keyof TimeLogSettings, value: string) => {
      setTimeLogSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
    },
    []
  );

  const handleTimeLogSave = useCallback(async () => {
    if (!timeLogSettings) return;
    try {
      setTimeLogSaving(true);
      setTimeLogFeedback(null);
      const saved = await settingsAPI.updateTimeLogSettings(timeLogSettings);
      setTimeLogSettings(saved);
      setTimeLogFeedback({
        kind: 'success',
        message: 'Time tracking settings saved'
      });
    } catch (err) {
      setTimeLogFeedback({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Unable to save time tracking settings'
      });
    } finally {
      setTimeLogSaving(false);
    }
  }, [timeLogSettings]);

  const handleToggleWidget = useCallback(() => {
    if (!dockState) {
      widgetAPI.requestExpand();
      return;
    }
    if (dockState.collapsed) {
      widgetAPI.requestExpand();
    } else {
      widgetAPI.requestCollapse();
    }
  }, [dockState]);

  const handleClose = () => {
    widgetAPI.closeWindow();
  };

  const statusPresetsText = useMemo(() => {
    return (taskSettings?.statusPresets ?? []).join('\n');
  }, [taskSettings]);

  if (loading) {
    return (
      <div className="settings-shell">
        <div className="settings-loading">Loading settings…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="settings-shell">
        <div className="settings-error">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="settings-shell">
      <header className="settings-header">
        <div className="settings-header-info">
          <p className="eyebrow">Notion Widgets</p>
          <h1>Control Center</h1>
          <p className="subtitle">
            Manage every widget, credential, and desktop preference from a
            single place.
          </p>
        </div>
        <div className="settings-header-actions">
          <button
            type="button"
            className="pill ghost"
            onClick={handleToggleWidget}
          >
            {dockState?.collapsed ? 'Show Widget' : 'Hide Widget'}
          </button>
          <button
            type="button"
            className="icon-button close-button"
            onClick={handleClose}
            aria-label="Close Control Center"
          >
            ✕
          </button>
        </div>
      </header>
      <main className="settings-content">
        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h2>Tasks widget</h2>
              <p>Configure the database and properties used by Quick Capture.</p>
            </div>
            {taskFeedback && (
              <p className={`feedback ${taskFeedback.kind}`}>
                {taskFeedback.message}
              </p>
            )}
          </div>
          {taskSettings && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleTaskSave();
              }}
              className="settings-form"
            >
              <div className="field-grid">
                <label className="field">
                  API key
                  <input
                    type="password"
                    value={taskSettings.apiKey}
                    onChange={(event) =>
                      handleTaskFieldChange('apiKey', event.target.value)
                    }
                    required
                  />
                </label>
                <label className="field">
                  Database ID
                  <input
                    type="text"
                    value={taskSettings.databaseId}
                    onChange={(event) =>
                      handleTaskFieldChange('databaseId', event.target.value)
                    }
                    required
                  />
                </label>
                <label className="field">
                  Data source ID
                  <input
                    type="text"
                    value={taskSettings.dataSourceId ?? ''}
                    onChange={(event) =>
                      handleTaskFieldChange('dataSourceId', event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  Title property
                  <input
                    type="text"
                    value={taskSettings.titleProperty}
                    onChange={(event) =>
                      handleTaskFieldChange('titleProperty', event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  Status property
                  <input
                    type="text"
                    value={taskSettings.statusProperty}
                    onChange={(event) =>
                      handleTaskFieldChange('statusProperty', event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  Completed status value
                  <input
                    type="text"
                    value={taskSettings.completedStatus}
                    onChange={(event) =>
                      handleTaskFieldChange(
                        'completedStatus',
                        event.target.value
                      )
                    }
                  />
                </label>
                <label className="field">
                  Date property
                  <input
                    type="text"
                    value={taskSettings.dateProperty}
                    onChange={(event) =>
                      handleTaskFieldChange('dateProperty', event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  Deadline property
                  <input
                    type="text"
                    value={taskSettings.deadlineProperty}
                    onChange={(event) =>
                      handleTaskFieldChange(
                        'deadlineProperty',
                        event.target.value
                      )
                    }
                  />
                </label>
                <label className="field">
                  Hard deadline value
                  <input
                    type="text"
                    value={taskSettings.deadlineHardValue}
                    onChange={(event) =>
                      handleTaskFieldChange(
                        'deadlineHardValue',
                        event.target.value
                      )
                    }
                  />
                </label>
                <label className="field">
                  Soft deadline value
                  <input
                    type="text"
                    value={taskSettings.deadlineSoftValue}
                    onChange={(event) =>
                      handleTaskFieldChange(
                        'deadlineSoftValue',
                        event.target.value
                      )
                    }
                  />
                </label>
                <label className="field">
                  Urgent property
                  <input
                    type="text"
                    value={taskSettings.urgentProperty}
                    onChange={(event) =>
                      handleTaskFieldChange('urgentProperty', event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  Urgent (active)
                  <input
                    type="text"
                    value={taskSettings.urgentStatusActive}
                    onChange={(event) =>
                      handleTaskFieldChange(
                        'urgentStatusActive',
                        event.target.value
                      )
                    }
                  />
                </label>
                <label className="field">
                  Urgent (inactive)
                  <input
                    type="text"
                    value={taskSettings.urgentStatusInactive}
                    onChange={(event) =>
                      handleTaskFieldChange(
                        'urgentStatusInactive',
                        event.target.value
                      )
                    }
                  />
                </label>
                <label className="field">
                  Important property
                  <input
                    type="text"
                    value={taskSettings.importantProperty}
                    onChange={(event) =>
                      handleTaskFieldChange(
                        'importantProperty',
                        event.target.value
                      )
                    }
                  />
                </label>
                <label className="field">
                  Important (active)
                  <input
                    type="text"
                    value={taskSettings.importantStatusActive}
                    onChange={(event) =>
                      handleTaskFieldChange(
                        'importantStatusActive',
                        event.target.value
                      )
                    }
                  />
                </label>
                <label className="field">
                  Important (inactive)
                  <input
                    type="text"
                    value={taskSettings.importantStatusInactive}
                    onChange={(event) =>
                      handleTaskFieldChange(
                        'importantStatusInactive',
                        event.target.value
                      )
                    }
                  />
                </label>
              </div>
              <label className="field">
                Custom status options (fallback)
                <textarea
                  value={statusPresetsText}
                  onChange={(event) =>
                    handleStatusPresetsChange(event.target.value)
                  }
                  placeholder="To-do&#10;In Progress&#10;Blocked"
                  rows={4}
                />
                <span className="field-hint">
                  One per line. Used when the database field does not exposes its
                  options.
                </span>
              </label>
              <div className="form-actions">
                <button type="submit" disabled={taskSaving}>
                  {taskSaving ? 'Saving…' : 'Save tasks settings'}
                </button>
              </div>
            </form>
          )}
        </section>
        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h2>Writing widget</h2>
              <p>Configure the long-form capture widget inputs.</p>
            </div>
            {writingFeedback && (
              <p className={`feedback ${writingFeedback.kind}`}>
                {writingFeedback.message}
              </p>
            )}
          </div>
          {writingSettings && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleWritingSave();
              }}
              className="settings-form"
            >
              <div className="field-grid">
                <label className="field">
                  API key (optional)
                  <input
                    type="password"
                    value={writingSettings.apiKey ?? ''}
                    onChange={(event) =>
                      handleWritingFieldChange('apiKey', event.target.value)
                    }
                    placeholder="Defaults to task API key"
                  />
                </label>
                <label className="field">
                  Database ID
                  <input
                    type="text"
                    value={writingSettings.databaseId}
                    onChange={(event) =>
                      handleWritingFieldChange('databaseId', event.target.value)
                    }
                    required
                  />
                </label>
                <label className="field">
                  Title property
                  <input
                    type="text"
                    value={writingSettings.titleProperty}
                    onChange={(event) =>
                      handleWritingFieldChange('titleProperty', event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  Summary property
                  <input
                    type="text"
                    value={writingSettings.summaryProperty ?? ''}
                    onChange={(event) =>
                      handleWritingFieldChange(
                        'summaryProperty',
                        event.target.value
                      )
                    }
                  />
                </label>
                <label className="field">
                  Tags property
                  <input
                    type="text"
                    value={writingSettings.tagsProperty ?? ''}
                    onChange={(event) =>
                      handleWritingFieldChange('tagsProperty', event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  Status property
                  <input
                    type="text"
                    value={writingSettings.statusProperty ?? ''}
                    onChange={(event) =>
                      handleWritingFieldChange(
                        'statusProperty',
                        event.target.value
                      )
                    }
                  />
                </label>
                <label className="field">
                  Draft status value
                  <input
                    type="text"
                    value={writingSettings.draftStatus ?? ''}
                    onChange={(event) =>
                      handleWritingFieldChange('draftStatus', event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  Published status value
                  <input
                    type="text"
                    value={writingSettings.publishedStatus ?? ''}
                    onChange={(event) =>
                      handleWritingFieldChange(
                        'publishedStatus',
                        event.target.value
                      )
                    }
                  />
                </label>
              </div>
              <div className="form-actions">
                <button type="submit" disabled={writingSaving}>
                  {writingSaving ? 'Saving…' : 'Save writing settings'}
                </button>
              </div>
            </form>
          )}
        </section>
        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h2>Time Tracking</h2>
              <p>Configure the time log database and properties for session tracking.</p>
            </div>
            {timeLogFeedback && (
              <p className={`feedback ${timeLogFeedback.kind}`}>
                {timeLogFeedback.message}
              </p>
            )}
          </div>
          {timeLogSettings && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleTimeLogSave();
              }}
              className="settings-form"
            >
              <div className="field-grid">
                <label className="field">
                  API key (optional)
                  <input
                    type="password"
                    value={timeLogSettings.apiKey ?? ''}
                    onChange={(event) =>
                      handleTimeLogFieldChange('apiKey', event.target.value)
                    }
                    placeholder="Defaults to task API key"
                  />
                </label>
                <label className="field">
                  Database ID
                  <input
                    type="text"
                    value={timeLogSettings.databaseId}
                    onChange={(event) =>
                      handleTimeLogFieldChange('databaseId', event.target.value)
                    }
                    required
                  />
                </label>
                <label className="field">
                  Title property
                  <input
                    type="text"
                    value={timeLogSettings.titleProperty ?? ''}
                    onChange={(event) =>
                      handleTimeLogFieldChange('titleProperty', event.target.value)
                    }
                    placeholder="Name"
                  />
                </label>
                <label className="field">
                  Task relation property
                  <input
                    type="text"
                    value={timeLogSettings.taskProperty ?? ''}
                    onChange={(event) =>
                      handleTimeLogFieldChange('taskProperty', event.target.value)
                    }
                    placeholder="Task"
                    required
                  />
                </label>
                <label className="field">
                  Status property
                  <input
                    type="text"
                    value={timeLogSettings.statusProperty ?? ''}
                    onChange={(event) =>
                      handleTimeLogFieldChange('statusProperty', event.target.value)
                    }
                    placeholder="Status"
                    required
                  />
                  <span className="field-hint">
                    Select property with "start" and "completed" options
                  </span>
                </label>
                <label className="field">
                  Start time property
                  <input
                    type="text"
                    value={timeLogSettings.startTimeProperty ?? ''}
                    onChange={(event) =>
                      handleTimeLogFieldChange('startTimeProperty', event.target.value)
                    }
                    placeholder="Start Time"
                  />
                </label>
                <label className="field">
                  End time property
                  <input
                    type="text"
                    value={timeLogSettings.endTimeProperty ?? ''}
                    onChange={(event) =>
                      handleTimeLogFieldChange('endTimeProperty', event.target.value)
                    }
                    placeholder="End Time"
                  />
                </label>
              </div>
              <div className="form-actions">
                <button type="submit" disabled={timeLogSaving}>
                  {timeLogSaving ? 'Saving…' : 'Save time tracking settings'}
                </button>
              </div>
            </form>
          )}
        </section>
      </main>
    </div>
  );
};

export default SettingsApp;
