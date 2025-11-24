import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react';
import type {
  AppPreferences,
  DockEdge,
  DockState,
  ResizeDirection
} from '@shared/types';
import { platformBridge, settingsBridge, widgetBridge } from '@shared/platform';
import SettingsDrawer, {
  type DrawerFeedback
} from '../components/SettingsDrawer';
import { PREFERENCE_DEFAULTS } from '../constants/preferences';

const DEFAULT_DOCK_STATE: DockState = { edge: 'top', collapsed: false };
const widgetAPI = widgetBridge;
const settingsAPI = settingsBridge;

const WidgetSettingsApp = () => {
  const [appPreferences, setAppPreferences] = useState<AppPreferences | null>(null);
  const [dockState, setDockState] = useState<DockState | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [feedback, setFeedback] = useState<DrawerFeedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadWidgetPreferences = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [prefs, dock, atop] = await Promise.all([
        widgetAPI.getAppPreferences(),
        widgetAPI.getDockState(),
        widgetAPI.getAlwaysOnTop()
      ]);
      setAppPreferences(prefs);
      setDockState(dock ?? null);
      setAlwaysOnTop(atop);
    } catch (err) {
      console.error('Unable to load widget preferences', err);
      setLoadError(
        err instanceof Error ? err.message : 'Unable to load widget preferences'
      );
      setFeedback({
        kind: 'error',
        message:
          err instanceof Error ? err.message : 'Unable to load widget preferences'
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWidgetPreferences();
  }, [loadWidgetPreferences]);

  useEffect(() => {
    const unsubscribe = widgetAPI.onDockStateChange((state) => {
      setDockState(state);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => {
      setFeedback(null);
    }, 4000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [feedback]);

  const handleAppPreferenceChange = useCallback(
    async (changes: Partial<AppPreferences>) => {
      const previous = appPreferences ?? PREFERENCE_DEFAULTS;
      const next = { ...previous, ...changes };
      setAppPreferences(next);
      try {
        const saved = await widgetAPI.updateAppPreferences(next);
        setAppPreferences(saved);
        setFeedback({ kind: 'success', message: 'Preferences updated' });
      } catch (err) {
        console.error('Unable to update app preferences', err);
        setAppPreferences(previous);
        setFeedback({
          kind: 'error',
          message:
            err instanceof Error ? err.message : 'Unable to update preferences'
        });
        throw err;
      }
    },
    [appPreferences]
  );

  const handleLaunchOnStartupToggle = useCallback(
    async (next: boolean) => {
      const previous = appPreferences ?? PREFERENCE_DEFAULTS;
      setAppPreferences({ ...previous, launchOnStartup: next });
      try {
        const saved = await widgetAPI.setLaunchOnStartup(next);
        setAppPreferences(saved);
        setFeedback({ kind: 'success', message: 'Startup preference saved' });
      } catch (err) {
        console.error('Unable to update startup preference', err);
        setAppPreferences(previous);
        setFeedback({
          kind: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Unable to change startup preference'
        });
        throw err;
      }
    },
    [appPreferences]
  );

  const handleNotificationsToggle = useCallback(
    (next: boolean) => handleAppPreferenceChange({ enableNotifications: next }),
    [handleAppPreferenceChange]
  );

  const handleSoundsToggle = useCallback(
    (next: boolean) => handleAppPreferenceChange({ enableSounds: next }),
    [handleAppPreferenceChange]
  );

  const handleAutoRefreshToggle = useCallback(
    (next: boolean) => handleAppPreferenceChange({ autoRefreshTasks: next }),
    [handleAppPreferenceChange]
  );

  const handlePreventMinimalDuringSessionToggle = useCallback(
    (next: boolean) => handleAppPreferenceChange({ preventMinimalDuringSession: next }),
    [handleAppPreferenceChange]
  );

  const handlePinToggle = useCallback(
    async (next: boolean) => {
      try {
        await handleAppPreferenceChange({ pinWidget: next });
        if (next) {
          await widgetAPI.requestExpand();
        }
      } catch {
        // Error feedback already handled inside helper.
      }
    },
    [handleAppPreferenceChange]
  );

  const handleAlwaysOnTopToggle = useCallback(
    async (next: boolean) => {
      try {
        const result = await widgetAPI.setAlwaysOnTop(next);
        setAlwaysOnTop(result);
        await handleAppPreferenceChange({ alwaysOnTop: result });
      } catch (err) {
        console.error('Unable to update always-on-top preference', err);
        setFeedback({
          kind: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Unable to change always-on-top preference'
        });
      }
    },
    [handleAppPreferenceChange]
  );

  const handleDockEdgeChange = useCallback(async (edge: DockEdge) => {
    try {
      await widgetAPI.requestExpand();
      await widgetAPI.setDockEdge(edge);
    } catch (err) {
      console.error('Unable to update dock edge', err);
      setFeedback({
        kind: 'error',
        message:
          err instanceof Error ? err.message : 'Unable to change dock edge'
      });
    }
  }, []);

  const handlePreviewNotification = useCallback(async () => {
    try {
      await settingsAPI.previewNotification({
        title: 'Notion Widgets',
        body: 'Notification preview sent from widget settings.'
      });
      setFeedback({ kind: 'success', message: 'Notification preview sent' });
    } catch (err) {
      console.error('Unable to preview notification', err);
      setFeedback({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Unable to preview notification'
      });
    }
  }, []);

  const handleClose = useCallback(() => {
    widgetAPI.closeWindow();
  }, []);

  const handleResizePointerDown = useCallback(
    (direction: ResizeDirection) => (event: ReactPointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      let lastX = event.screenX;
      let lastY = event.screenY;

      const handleMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.screenX - lastX;
        const deltaY = moveEvent.screenY - lastY;
        if (deltaX !== 0 || deltaY !== 0) {
          widgetAPI.resizeWindow(direction, deltaX, deltaY);
          lastX = moveEvent.screenX;
          lastY = moveEvent.screenY;
        }
      };

      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    []
  );

  const pinEnabled = appPreferences?.pinWidget ?? false;
  const resolvedDockState = dockState ?? DEFAULT_DOCK_STATE;

  const shellClassName = useMemo(() => {
    return ['widget-settings-window', loading ? 'is-loading' : '']
      .filter(Boolean)
      .join(' ');
  }, [loading]);

  if (loadError && !appPreferences) {
    return (
      <div className={shellClassName}>
        <div className="settings-panel loading-panel">
          <p className="panel-subtitle subtle">{loadError}</p>
          <button
            type="button"
            className="pill ghost"
            onClick={() => {
              void loadWidgetPreferences();
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={shellClassName}>
      <div className="widget-settings-surface">
        <div className="widget-settings-drag-strip" aria-hidden="true" />
        <SettingsDrawer
          onClose={handleClose}
          dockState={resolvedDockState}
          onToggleAlwaysOnTop={handleAlwaysOnTopToggle}
          onTogglePin={handlePinToggle}
          onSetDockEdge={handleDockEdgeChange}
          alwaysOnTop={alwaysOnTop}
          pinEnabled={pinEnabled}
          appPreferences={appPreferences}
          onToggleLaunchOnStartup={handleLaunchOnStartupToggle}
          onToggleNotifications={handleNotificationsToggle}
          onToggleSounds={handleSoundsToggle}
          onToggleAutoRefresh={handleAutoRefreshToggle}
          onTogglePreventMinimalDuringSession={handlePreventMinimalDuringSessionToggle}
          onPreviewNotification={handlePreviewNotification}
          feedback={feedback}
          showControlCenterButton={platformBridge.hasWindowControls}
        />
        <div
          className="resize-handle edge-left"
          onPointerDown={handleResizePointerDown('left')}
        />
        <div
          className="resize-handle edge-right"
          onPointerDown={handleResizePointerDown('right')}
        />
        <div
          className="resize-handle edge-top"
          onPointerDown={handleResizePointerDown('top')}
        />
        <div
          className="resize-handle edge-bottom"
          onPointerDown={handleResizePointerDown('bottom')}
        />
        <div
          className="resize-handle corner top-left"
          onPointerDown={handleResizePointerDown('top-left')}
        />
        <div
          className="resize-handle corner top-right"
          onPointerDown={handleResizePointerDown('top-right')}
        />
        <div
          className="resize-handle corner bottom-left"
          onPointerDown={handleResizePointerDown('bottom-left')}
        />
        <div
          className="resize-handle corner bottom-right"
          onPointerDown={handleResizePointerDown('bottom-right')}
        />
      </div>
    </div>
  );
};

export default WidgetSettingsApp;


