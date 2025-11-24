import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, shell, screen, globalShortcut } from 'electron';
import dotenv from 'dotenv';
import { DockingController } from './docking';
import {
  addTask,
  createTimeLogEntry,
  createWritingEntry,
  getActiveTimeLogEntry,
  getTotalLoggedTime,
  getAllTimeLogEntries,
  getAllTimeLogs,
  updateTimeLogEntry,
  deleteTimeLogEntry,
  getTasks,
  getStatusOptions,
  setNotionSettings,
  setTimeLogSettings,
  setWritingSettings,
  updateTask
} from './services/notion';
import type {
  AppPreferences,
  DockEdge,
  NotionCreatePayload,
  NotionSettings,
  NotificationPreviewPayload,
  ResizeDirection,
  TaskUpdatePayload,
  TimeLogEntryPayload,
  TimeLogSettings,
  TimeLogUpdatePayload,
  WritingEntryPayload,
  WritingSettings
} from '../shared/types';
import {
  getAppPreferences,
  getSettings,
  getTimeLogSettings,
  getWritingSettings,
  initConfigStore,
  updateAppPreferences as persistAppPreferences,
  updateSettings as persistSettings,
  updateTimeLogSettings as persistTimeLogSettings,
  updateWritingSettings as persistWritingSettings
} from './configStore';
import {
  applyAppPreferences,
  notifyWritingEntryCaptured,
  previewDesktopNotification
} from './system/appPreferences';
import {
  initializeUpdater,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  getUpdateStatus,
  onUpdateStatusChange
} from './services/updater';

dotenv.config();
console.log('Notion env check', {
  key: process.env.NOTION_API_KEY ? 'set' : 'missing',
  db: process.env.NOTION_DATABASE_ID ? 'set' : 'missing'
});

const isDev = process.env.NODE_ENV === 'development';
const distMainRoot = path.resolve(__dirname, '..');
const rendererDist = path.resolve(distMainRoot, '../renderer');
const preloadPath = path.resolve(distMainRoot, 'main', 'preload.js');
const userDataRoot = path.join(app.getPath('appData'), 'NotionTasksWidget');
const runtimeCacheRoot = path.join(userDataRoot, 'RuntimeCache');

type AlwaysOnTopLevel = NonNullable<
  Parameters<BrowserWindow['setAlwaysOnTop']>[1]
>;

const MAIN_ALWAYS_ON_TOP_LEVEL: AlwaysOnTopLevel =
  process.platform === 'darwin'
    ? 'floating'
    : process.platform === 'win32'
      ? 'screen-saver'
      : 'pop-up-menu';

const AUX_ALWAYS_ON_TOP_LEVEL: AlwaysOnTopLevel =
  process.platform === 'darwin' ? 'floating' : 'pop-up-menu';

const resolvedCachePath = prepareStoragePaths();
console.log('Electron cache path set to', resolvedCachePath);

function prepareStoragePaths(): string {
  const ensureDir = (dir: string, label: string) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return true;
    } catch (error) {
      console.error(`Failed to prepare ${label} directory`, dir, error);
      return false;
    }
  };

  app.setPath('userData', userDataRoot);
  app.commandLine.appendSwitch('disable-http-cache');
  app.commandLine.appendSwitch('disable-gpu-program-cache');
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

  if (ensureDir(runtimeCacheRoot, 'cache')) {
    app.setPath('cache', runtimeCacheRoot);
    app.commandLine.appendSwitch('disk-cache-dir', runtimeCacheRoot);
    return runtimeCacheRoot;
  }

  const fallbackCache = path.join(app.getPath('temp'), 'NotionTasksWidgetCache');
  if (ensureDir(fallbackCache, 'fallback cache')) {
    app.setPath('cache', fallbackCache);
    app.commandLine.appendSwitch('disk-cache-dir', fallbackCache);
    return fallbackCache;
  }

  console.warn('Unable to configure custom Electron cache directory. The app may reuse the default cache path.');
  return '[Electron default cache]';
}

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let widgetSettingsWindow: BrowserWindow | null = null;
let fullScreenWindow: BrowserWindow | null = null;
// Docking disabled for now while we debug.
let docking: DockingController | null = null;
const taskWindows = new Set<BrowserWindow>();

function applyAlwaysOnTop(
  target: BrowserWindow | null,
  flag: boolean,
  options?: {
    level?: AlwaysOnTopLevel;
    manageWorkspaces?: boolean;
    forceFront?: boolean;
  }
) {
  if (!target) return;
  const level = options?.level ?? MAIN_ALWAYS_ON_TOP_LEVEL;
  target.setAlwaysOnTop(flag, level);
  if (flag && options?.forceFront !== false && typeof target.moveTop === 'function') {
    target.moveTop();
  }
  if (options?.manageWorkspaces && typeof target.setVisibleOnAllWorkspaces === 'function') {
    if (process.platform === 'darwin') {
      target.setVisibleOnAllWorkspaces(flag, { visibleOnFullScreen: true });
    } else {
      target.setVisibleOnAllWorkspaces(flag);
    }
  }
}

function syncWindowPreferences(preferences: AppPreferences) {
  applyAlwaysOnTop(mainWindow, preferences.alwaysOnTop, {
    manageWorkspaces: true
  });
  if (preferences.pinWidget) {
    docking?.expand();
  }
}

const createWindow = async () => {
  const initialPreferences = getAppPreferences();
  mainWindow = new BrowserWindow({
    width: 600,
    height: 760,
    minWidth: 440,
    minHeight: 600,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: initialPreferences.alwaysOnTop,
    skipTaskbar: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true
    }
  });

  console.log('Main window created');
  docking = new DockingController(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
    docking = null;
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('Main window failed to load', {
      errorCode,
      errorDescription,
      validatedURL
    });
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Main window renderer finished loading');
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    console.log('Loading main window from dev server', process.env.VITE_DEV_SERVER_URL);
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const entryFile = path.join(rendererDist, 'index.html');
    console.log('Loading main window file', entryFile);
    await mainWindow.loadFile(entryFile);
  }

  applyAlwaysOnTop(mainWindow, initialPreferences.alwaysOnTop, {
    manageWorkspaces: true
  });

  const forceShowTimeout = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.warn('Force showing main window after timeout');
      mainWindow.show();
      docking?.snapToEdge('top');
    }
  }, 2500);

  mainWindow.on('show', () => {
    clearTimeout(forceShowTimeout);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    docking?.snapToEdge('top');
    if (!initialPreferences.pinWidget) {
      setTimeout(() => docking?.collapse(), 900);
    }
  });
};

const createSettingsWindow = async () => {
  console.log('createSettingsWindow called');
  if (settingsWindow) {
    console.log('settingsWindow exists, restoring/focusing');
    if (settingsWindow.isMinimized()) {
      settingsWindow.restore();
    }
    settingsWindow.focus();
    return settingsWindow;
  }

  console.log('Creating new settingsWindow');
  settingsWindow = new BrowserWindow({
    width: 860,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    resizable: true,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0b0d17',
    alwaysOnTop: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true
    }
  });

  applyAlwaysOnTop(settingsWindow, true, {
    level: AUX_ALWAYS_ON_TOP_LEVEL,
    forceFront: false
  });

  settingsWindow.on('closed', () => {
    console.log('settingsWindow closed');
    settingsWindow = null;
  });

  try {
    if (isDev && process.env.VITE_DEV_SERVER_URL) {
      const url = `${process.env.VITE_DEV_SERVER_URL}/settings.html`;
      console.log('Loading settings URL:', url);
      await settingsWindow.loadURL(url);
    } else {
      const filePath = path.join(rendererDist, 'settings.html');
      console.log('Loading settings file:', filePath);
      await settingsWindow.loadFile(filePath);
    }
  } catch (err) {
    console.error('Failed to load settings window content:', err);
  }

  // Show immediately if ready-to-show takes too long, but prefer ready-to-show
  settingsWindow.once('ready-to-show', () => {
    console.log('settingsWindow ready-to-show');
    settingsWindow?.show();
  });
  
  // Fallback show
  setTimeout(() => {
    if (settingsWindow && !settingsWindow.isVisible()) {
        console.log('Force showing settingsWindow');
        settingsWindow.show();
    }
  }, 1000);

  return settingsWindow;
};

const createWidgetSettingsWindow = async () => {
  if (widgetSettingsWindow) {
    if (widgetSettingsWindow.isMinimized()) {
      widgetSettingsWindow.restore();
    }
    widgetSettingsWindow.focus();
    return widgetSettingsWindow;
  }

  widgetSettingsWindow = new BrowserWindow({
    width: 620,
    height: 720,
    minWidth: 520,
    minHeight: 520,
    resizable: true,
    frame: false,
    show: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0b0d17',
    alwaysOnTop: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true
    }
  });

  applyAlwaysOnTop(widgetSettingsWindow, true, {
    level: AUX_ALWAYS_ON_TOP_LEVEL,
    forceFront: false
  });

  widgetSettingsWindow.on('closed', () => {
    widgetSettingsWindow = null;
  });

  try {
    if (isDev && process.env.VITE_DEV_SERVER_URL) {
      const url = `${process.env.VITE_DEV_SERVER_URL}/widget-settings.html`;
      await widgetSettingsWindow.loadURL(url);
    } else {
      const filePath = path.join(rendererDist, 'widget-settings.html');
      await widgetSettingsWindow.loadFile(filePath);
    }
  } catch (error) {
    console.error('Failed to load widget settings window', error);
  }

  widgetSettingsWindow.once('ready-to-show', () => {
    widgetSettingsWindow?.show();
    widgetSettingsWindow?.focus();
  });

  setTimeout(() => {
    if (widgetSettingsWindow && !widgetSettingsWindow.isVisible()) {
      widgetSettingsWindow.show();
      widgetSettingsWindow.focus();
    }
  }, 1000);

  return widgetSettingsWindow;
};

const createTaskWindow = async (taskId: string) => {
  const referenceBounds = mainWindow?.getBounds();
  const defaultWidth = 520;
  const defaultHeight = 420;
  const padding = mainWindow ? 8 : 0;
  const targetDisplay =
    (referenceBounds && screen.getDisplayMatching(referenceBounds)) ??
    screen.getDisplayNearestPoint(
      referenceBounds
        ? { x: referenceBounds.x, y: referenceBounds.y }
        : screen.getCursorScreenPoint()
    );
  const workArea = targetDisplay.workArea;
  const workAreaRight = workArea.x + workArea.width;
  const workAreaBottom = workArea.y + workArea.height;

  const desiredX = referenceBounds
    ? referenceBounds.x + referenceBounds.width + 16
    : workArea.x + Math.round((workArea.width - defaultWidth) / 2);
  const desiredY = referenceBounds
    ? referenceBounds.y
    : workArea.y + Math.round((workArea.height - defaultHeight) / 2);

  const clampedX = Math.min(
    workAreaRight - defaultWidth - padding,
    Math.max(workArea.x + padding, desiredX)
  );
  const clampedY = Math.min(
    workAreaBottom - defaultHeight - padding,
    Math.max(workArea.y + padding, desiredY)
  );

  const taskWindow = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    minWidth: 360,
    minHeight: 280,
    frame: true,
    transparent: false,
    resizable: true,
    skipTaskbar: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#00000000',
    show: false,
    x: Math.round(clampedX),
    y: Math.round(clampedY),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true
    }
  });

  applyAlwaysOnTop(taskWindow, true, { level: AUX_ALWAYS_ON_TOP_LEVEL });

  taskWindows.add(taskWindow);

  taskWindow.on('closed', () => {
    taskWindows.delete(taskWindow);
  });

  taskWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error('Task window failed to load', {
        taskId,
        errorCode,
        errorDescription,
        validatedURL
      });
    }
  );

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(`${process.env.VITE_DEV_SERVER_URL}/task.html`);
    url.searchParams.set('taskId', taskId);
    await taskWindow.loadURL(url.toString());
  } else {
    const filePath = path.join(rendererDist, 'task.html');
    await taskWindow.loadFile(filePath, {
      query: { taskId }
    });
  }

  taskWindow.once('ready-to-show', () => {
    console.log('Task window ready', taskId);
    taskWindow.show();
    taskWindow.focus();
  });

  setTimeout(() => {
    if (!taskWindow.isDestroyed() && !taskWindow.isVisible()) {
      console.warn('Force showing task window', taskId);
      taskWindow.show();
      taskWindow.focus();
    }
  }, 1500);

  return taskWindow;
};

const createFullScreenWindow = async () => {
  if (fullScreenWindow) {
    if (fullScreenWindow.isMinimized()) {
      fullScreenWindow.restore();
    }
    fullScreenWindow.focus();
    return fullScreenWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  fullScreenWindow = new BrowserWindow({
    width: Math.floor(width * 0.9),
    height: Math.floor(height * 0.9),
    minWidth: 800,
    minHeight: 600,
    frame: true,
    transparent: false,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    backgroundColor: '#0b0d17',
    show: false,
    center: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true
    }
  });

  fullScreenWindow.on('closed', () => {
    fullScreenWindow = null;
  });

  fullScreenWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error('Full-screen window failed to load', {
        errorCode,
        errorDescription,
        validatedURL
      });
      // Show window even if load failed
      if (fullScreenWindow && !fullScreenWindow.isVisible()) {
        fullScreenWindow.show();
        fullScreenWindow.focus();
      }
    }
  );

  try {
    if (isDev && process.env.VITE_DEV_SERVER_URL) {
      const url = `${process.env.VITE_DEV_SERVER_URL}/fullscreen.html`;
      console.log('Loading full-screen URL:', url);
      await fullScreenWindow.loadURL(url);
    } else {
      const filePath = path.join(rendererDist, 'fullscreen.html');
      console.log('Loading full-screen file:', filePath);
      if (!fs.existsSync(filePath)) {
        console.error('Full-screen HTML file not found at:', filePath);
        throw new Error(`Full-screen HTML file not found at: ${filePath}`);
      }
      await fullScreenWindow.loadFile(filePath);
    }
  } catch (err) {
    console.error('Failed to load full-screen window content:', err);
    // Show window even if load failed so user can see the error
    if (fullScreenWindow && !fullScreenWindow.isVisible()) {
      fullScreenWindow.show();
      fullScreenWindow.focus();
    }
    throw err; // Re-throw so the handler can catch it
  }

  fullScreenWindow.once('ready-to-show', () => {
    console.log('Full-screen window ready-to-show');
    fullScreenWindow?.show();
    fullScreenWindow?.focus();
  });

  // Fallback: ensure window shows after a delay even if ready-to-show didn't fire
  setTimeout(() => {
    if (fullScreenWindow && !fullScreenWindow.isVisible()) {
      console.log('Force showing full-screen window (fallback)');
      fullScreenWindow.show();
      fullScreenWindow.focus();
    }
  }, 1000);

  return fullScreenWindow;
};

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  await initConfigStore(userData);

  const taskSettings = getSettings();
  let needsCredentialBootstrap = false;
  try {
    setNotionSettings(taskSettings);
  } catch (error) {
    needsCredentialBootstrap = true;
    console.warn(
      'Notion API credentials are missing or invalid. Opening Control Center for setup.',
      error
    );
  }

  setWritingSettings(getWritingSettings());
  setTimeLogSettings(getTimeLogSettings());
  applyAppPreferences(getAppPreferences());
  await createWindow();
  syncWindowPreferences(getAppPreferences());

  // Initialize updater after main window is created
  initializeUpdater(mainWindow);

  if (needsCredentialBootstrap) {
    try {
      await createSettingsWindow();
    } catch (windowError) {
      console.error(
        'Unable to launch Control Center automatically for credential setup',
        windowError
      );
    }
  }

  // Register global shortcut for full-screen window (Ctrl+F or Cmd+F)
  const shortcut = process.platform === 'darwin' ? 'Command+F' : 'Control+F';
  globalShortcut.register(shortcut, async () => {
    try {
      await createFullScreenWindow();
    } catch (error) {
      console.error('Error opening full-screen window via shortcut', error);
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('tasks:fetch', async () => getTasks());
ipcMain.handle('tasks:add', async (_event, payload: NotionCreatePayload) =>
  addTask(payload)
);
ipcMain.handle(
  'tasks:update',
  async (_event, taskId: string, updates: TaskUpdatePayload) => {
    const updated = await updateTask(taskId, updates);
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('tasks:updated', updated);
    });
    return updated;
  }
);
ipcMain.handle('tasks:statusOptions', () => getStatusOptions());
ipcMain.handle('taskWindow:open', async (_event, taskId: string) => {
  if (!taskId) {
    console.warn('taskWindow:open called without taskId');
    return;
  }
  try {
    console.log('Opening floating task window for', taskId);
    await createTaskWindow(taskId);
  } catch (error) {
    console.error('Unable to open task window', error);
    throw error;
  }
});
ipcMain.handle(
  'window:resize',
  (event, direction: ResizeDirection, deltaX: number, deltaY: number) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    performWindowResize(direction, deltaX, deltaY, targetWindow);
  }
);
ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:update', async (_event, next: NotionSettings) => {
  const saved = await persistSettings(next);
  setNotionSettings(saved);
  return saved;
});
ipcMain.handle('settings:writing:get', () => getWritingSettings());
ipcMain.handle(
  'settings:writing:update',
  async (_event, next: WritingSettings) => {
    const saved = await persistWritingSettings(next);
    setWritingSettings(saved);
    return saved;
  }
);
ipcMain.handle('settings:timeLog:get', () => getTimeLogSettings());
ipcMain.handle(
  'settings:timeLog:update',
  async (_event, next: TimeLogSettings) => {
    const saved = await persistTimeLogSettings(next);
    setTimeLogSettings(saved);
    return saved;
  }
);
ipcMain.handle('settings:app:get', () => getAppPreferences());
ipcMain.handle('settings:app:update', async (_event, prefs: AppPreferences) => {
  const saved = await persistAppPreferences(prefs);
  applyAppPreferences(saved);
  syncWindowPreferences(saved);
  return saved;
});
ipcMain.handle('settings:app:setStartup', async (_event, enabled: boolean) => {
  const current = getAppPreferences();
  const saved = await persistAppPreferences({
    ...current,
    launchOnStartup: enabled
  });
  applyAppPreferences(saved);
  syncWindowPreferences(saved);
  return saved;
});
ipcMain.handle(
  'writing:createEntry',
  async (_event, payload: WritingEntryPayload) => {
    await createWritingEntry(payload);
    notifyWritingEntryCaptured();
  }
);
ipcMain.handle(
  'timeLog:createEntry',
  async (_event, payload: TimeLogEntryPayload) => {
    await createTimeLogEntry(payload);
  }
);
ipcMain.handle(
  'timeLog:getActive',
  async (_event, taskId: string) => {
    try {
      return await getActiveTimeLogEntry(taskId);
    } catch (error) {
      console.error('Failed to fetch active time log entry', error);
      return null;
    }
  }
);
ipcMain.handle(
  'timeLog:getTotalLogged',
  async (_event, taskId: string) => {
    try {
      return await getTotalLoggedTime(taskId);
    } catch (error) {
      console.error('Failed to fetch total logged time', error);
      return 0;
    }
  }
);
ipcMain.handle(
  'timeLog:getAllEntries',
  async (_event, taskId: string) => {
    try {
      return await getAllTimeLogEntries(taskId);
    } catch (error) {
      console.error('Failed to fetch time log entries', error);
      return [];
    }
  }
);
ipcMain.handle(
  'timeLog:getAll',
  async () => {
    try {
      return await getAllTimeLogs();
    } catch (error) {
      console.error('Failed to fetch all time logs', error);
      return [];
    }
  }
);
ipcMain.handle(
  'timeLog:update',
  async (_event, entryId: string, updates: TimeLogUpdatePayload) => {
    try {
      return await updateTimeLogEntry(entryId, updates);
    } catch (error) {
      console.error('Failed to update time log entry', error);
      throw error;
    }
  }
);
ipcMain.handle(
  'timeLog:delete',
  async (_event, entryId: string) => {
    try {
      await deleteTimeLogEntry(entryId);
    } catch (error) {
      console.error('Failed to delete time log entry', error);
      throw error;
    }
  }
);
ipcMain.handle(
  'notifications:preview',
  (_event, payload: NotificationPreviewPayload) => {
    previewDesktopNotification(payload);
  }
);
ipcMain.handle('widgetSettings:window:open', async () => {
  if (!app.isReady()) {
    await app.whenReady();
  }
  try {
    await createWidgetSettingsWindow();
    if (widgetSettingsWindow) {
      widgetSettingsWindow.focus();
      applyAlwaysOnTop(widgetSettingsWindow, true, {
        level: AUX_ALWAYS_ON_TOP_LEVEL,
        forceFront: false
      });
    }
  } catch (error) {
    console.error('Error in widgetSettings:window:open handler', error);
  }
});
ipcMain.handle('settings:window:open', async () => {
  console.log('IPC settings:window:open received');
  if (!app.isReady()) {
    console.log('App not ready, waiting...');
    await app.whenReady();
  }
  try {
    await createSettingsWindow();
    if (settingsWindow) {
      console.log('Focusing settings window');
      settingsWindow.focus();
      // Ensure it's on top
      applyAlwaysOnTop(settingsWindow, true, {
        level: AUX_ALWAYS_ON_TOP_LEVEL,
        forceFront: false
      });
    }
  } catch (e) {
    console.error('Error in settings:window:open handler:', e);
  }
});

ipcMain.handle('window:setAlwaysOnTop', (event, flag: boolean) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  if (!targetWindow) return false;
  applyAlwaysOnTop(targetWindow, flag, {
    manageWorkspaces: targetWindow === mainWindow
  });
  return targetWindow.isAlwaysOnTop();
});

ipcMain.handle('window:getAlwaysOnTop', (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  return targetWindow?.isAlwaysOnTop() ?? false;
});

ipcMain.handle('dock:expand', () => {
  docking?.expand();
  return docking?.getState();
});

ipcMain.handle('dock:collapse', () => {
  const prefs = getAppPreferences();
  if (prefs.pinWidget) {
    docking?.expand();
    return docking?.getState();
  }
  docking?.collapse();
  return docking?.getState();
});

ipcMain.handle('dock:forceCollapse', () => {
  // Force collapse regardless of pin state - used by the Collapse Widget button
  if (!docking) {
    console.warn('Docking controller not available');
    return { edge: 'right', collapsed: true };
  }
  console.log('Force collapsing widget (bypassing pin check)');
  const currentState = docking.getState();
  console.log('Current state before collapse:', currentState);
  docking.collapse();
  const newState = docking.getState();
  console.log('New state after collapse:', newState);
  return newState;
});

ipcMain.handle('dock:setThin', (_event, thin: boolean) => {
  docking?.setThin(thin);
});

ipcMain.handle('dock:setCapture', (_event, capture: boolean) => {
  docking?.setCapture(capture);
});

ipcMain.handle('dock:setEdge', (_event, edge: DockEdge) => {
  docking?.snapToEdge(edge);
  return docking?.getState();
});

ipcMain.handle('dock:getState', () => docking?.getState());

ipcMain.handle('window:close', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.close();
});

// Handler for the correct channel name
ipcMain.handle('fullScreen:window:open', async () => {
  if (!app.isReady()) {
    await app.whenReady();
  }
  try {
    await createFullScreenWindow();
    if (fullScreenWindow) {
      fullScreenWindow.focus();
    }
  } catch (error) {
    console.error('Error in fullScreen:window:open handler', error);
    throw error;
  }
});

// Legacy handler for backward compatibility (in case old code is cached)
ipcMain.handle('window:openFullScreen', async () => {
  console.warn('Using legacy IPC channel window:openFullScreen, please update to fullScreen:window:open');
  if (!app.isReady()) {
    await app.whenReady();
  }
  try {
    await createFullScreenWindow();
    if (fullScreenWindow) {
      fullScreenWindow.focus();
    }
  } catch (error) {
    console.error('Error in window:openFullScreen handler', error);
    throw error;
  }
});

ipcMain.handle('fullScreen:window:close', () => {
  if (fullScreenWindow) {
    fullScreenWindow.close();
  }
});

// Update handlers
ipcMain.handle('updater:check', async () => {
  try {
    await checkForUpdates();
    return getUpdateStatus();
  } catch (error) {
    console.error('Update check failed:', error);
    return {
      status: 'error' as const,
      info: {
        version: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
});

ipcMain.handle('updater:download', async () => {
  try {
    await downloadUpdate();
    return getUpdateStatus();
  } catch (error) {
    console.error('Update download failed:', error);
    throw error;
  }
});

ipcMain.handle('updater:install', () => {
  try {
    quitAndInstall();
  } catch (error) {
    console.error('Update install failed:', error);
    throw error;
  }
});

ipcMain.handle('updater:getStatus', () => {
  return getUpdateStatus();
});

ipcMain.handle('app:getVersion', () => {
  return app.getVersion();
});

// Broadcast update status changes to all windows
onUpdateStatusChange((status, info) => {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('updater:status-changed', { status, info });
  });
});

function performWindowResize(
  direction: ResizeDirection,
  deltaX: number,
  deltaY: number,
  targetWindow: BrowserWindow | null = mainWindow
) {
  const window = targetWindow ?? mainWindow;
  if (!window) return;
  if (!deltaX && !deltaY) return;
  const bounds = window.getBounds();
  let { x, y, width, height } = bounds;
  const [minWidth, minHeight] = window.getMinimumSize();
  const minW = Math.max(minWidth || 320, 200);
  const minH = Math.max(minHeight || 420, 200);

  const segments = direction.split('-') as Array<'left' | 'right' | 'top' | 'bottom'>;
  const includes = (dir: 'left' | 'right' | 'top' | 'bottom') =>
    segments.includes(dir);

  if (includes('right')) {
    width = Math.max(minW, width + deltaX);
  }

  if (includes('left')) {
    let nextX = x + deltaX;
    let nextWidth = width - deltaX;
    if (nextWidth < minW) {
      const diff = minW - nextWidth;
      nextX -= diff;
      nextWidth = minW;
    }
    x = nextX;
    width = nextWidth;
  }

  if (includes('bottom')) {
    height = Math.max(minH, height + deltaY);
  }

  if (includes('top')) {
    let nextY = y + deltaY;
    let nextHeight = height - deltaY;
    if (nextHeight < minH) {
      const diff = minH - nextHeight;
      nextY -= diff;
      nextHeight = minH;
    }
    y = nextY;
    height = nextHeight;
  }

  window.setBounds({ x, y, width, height });
}
