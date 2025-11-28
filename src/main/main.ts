// CRITICAL: Debug and fix startup issues
// Write to a log file IMMEDIATELY to debug double-click issues
const _fs = require('fs');
const _path = require('path');
const _logDir = _path.join(process.env.APPDATA || 'C:\\temp', 'NotionTasksWidget');
const _startupLog = _path.join(_logDir, 'startup.log');

try {
  _fs.mkdirSync(_logDir, { recursive: true });
  _fs.appendFileSync(_startupLog, `\n--- STARTUP ${new Date().toISOString()} ---\n`);
  _fs.appendFileSync(_startupLog, `argv: ${JSON.stringify(process.argv)}\n`);
  _fs.appendFileSync(_startupLog, `cwd: ${process.cwd()}\n`);
  _fs.appendFileSync(_startupLog, `stdout exists: ${!!process.stdout}\n`);
  _fs.appendFileSync(_startupLog, `stdout.isTTY: ${process.stdout?.isTTY}\n`);
  _fs.appendFileSync(_startupLog, `stderr exists: ${!!process.stderr}\n`);
} catch (e) {
  // Can't even write to log - really bad
}

// Suppress all stdout/stderr when not running in a terminal
if (!process.stdout?.isTTY) {
  // Create no-op write streams to prevent EPIPE errors
  const nullWrite = () => true;
  
  if (process.stdout) {
    process.stdout.write = nullWrite as typeof process.stdout.write;
  }
  if (process.stderr) {
    process.stderr.write = nullWrite as typeof process.stderr.write;
  }
  
  try {
    _fs.appendFileSync(_startupLog, `stdout/stderr suppressed\n`);
  } catch {}
}

// Handle any EPIPE errors that slip through
process.on('uncaughtException', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
  // For other errors, we should still crash but log to file if possible
  const fs = require('fs');
  const path = require('path');
  try {
    const logPath = path.join(process.env.APPDATA || '', 'NotionTasksWidget', 'crash.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${new Date().toISOString()} - UNCAUGHT: ${err.stack || err}\n`);
  } catch { /* ignore logging errors */ }
  throw err;
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  const fs = require('fs');
  const path = require('path');
  try {
    const logPath = path.join(process.env.APPDATA || '', 'NotionTasksWidget', 'crash.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${new Date().toISOString()} - UNHANDLED REJECTION: ${reason}\n`);
  } catch { /* ignore logging errors */ }
});

process.stdout?.on?.('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
});
process.stderr?.on?.('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
});

import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, shell, screen, globalShortcut } from 'electron';
import dotenv from 'dotenv';
import { DockingController } from './docking';
// New modular Notion services (replacing old monolithic notion.ts)
import {
  fetchActiveTasks,
  fetchTask,
  fetchStatusOptions,
  createTask as createNotionTask,
  updateTask as updateNotionTask,
  archiveTask as archiveNotionTask,
  testConnection,
  isConfigured as isNotionConfigured,
  getSettingsSnapshot as getNotionSettingsSnapshot
} from './services/notionTasks';
import { 
  fetchProjects as fetchNotionProjects, 
  fetchActiveProjects,
  createProject as createNotionProject,
  updateProject as updateNotionProject,
  isConfigured as isProjectsConfigured
} from './services/notionProjects';
import { 
  fetchContacts as fetchContactsFromNotion,
  createContact as createNotionContact,
  updateContact as updateNotionContact,
  isConfigured as isContactsConfigured
} from './services/notionContacts';
import { 
  fetchTimeLogs as fetchTimeLogsFromNotion,
  createTimeLog as createNotionTimeLog,
  updateTimeLog as updateNotionTimeLog,
  isConfigured as isTimeLogsConfigured
} from './services/notionTimeLogs';
import {
  createWritingEntry as createNotionWritingEntry,
  updateWritingEntry as updateNotionWritingEntry,
  isConfigured as isWritingConfigured
} from './services/notionWriting';
import {
  importActiveTasks,
  importActiveProjects,
  importActive,
  importSinceClose,
  importAll,
  markAppClose,
  isFirstTimeSetup,
  markSetupComplete,
  getSetupMode,
  getDatabaseCounts,
  isDatabaseEmpty
} from './services/importService';
import {
  updateTaskSettings as setNotionSettings,
  updateProjectsSettings as setProjectsSettings,
  updateContactsSettings as setContactsSettings,
  updateTimeLogSettings as setTimeLogSettings,
  updateWritingSettings as setWritingSettings
} from './configStore';
import { initializeDatabase } from './db/database';
import { startDatabaseBackupRoutine } from './db/backupService';

// Sync engine removed - using direct API calls now
// import { syncEngine, importQueueManager } from './services/syncEngine';
type ImportType = 'tasks' | 'projects' | 'timeLogs' | 'all';
import {
  getDataCounts,
  performFullReset,
  performSoftReset,
  resetTasksOnly,
  resetProjectsOnly,
  resetTimeLogsOnly,
  type DataCounts,
  type ResetResult
} from './services/dataManagement';
import {
  createLocalTask,
  listTasks as listStoredTasks,
  updateLocalTask,
  upsertRemoteTask,
  importTasksFromJson,
  getTaskCount,
  buildSubtaskRelationships,
  getSubtasks,
  // Trash management
  listTrashedTasks,
  countTrashedTasks,
  restoreTaskFromTrash,
  permanentlyDeleteTask,
  emptyTrash,
  cleanupOldTrashedTasks
} from './db/repositories/taskRepository';
import type {
  AppPreferences,
  ChatbotSettings,
  ContactsSettings,
  CrossWindowDragState,
  CrossWindowDropPayload,
  DockEdge,
  FeatureToggles,
  NotionCreatePayload,
  NotionSettings,
  NotificationPreviewPayload,
  Project,
  ProjectsSettings,
  ResizeDirection,
  SavedView,
  SpeechTranscriptionRequest,
  Task,
  TaskUpdatePayload,
  TimeLogEntry,
  TimeLogEntryPayload,
  TimeLogSettings,
  TimeLogUpdatePayload,
  WritingEntryPayload,
  WritingSettings
} from '../shared/types';
import {
  createLocalTimeLogEntry,
  deleteLocalTimeLogEntry,
  getActiveEntryForTask,
  getTotalLoggedMinutes,
  getTodayLoggedMinutes,
  getAggregatedTimeData,
  listTimeLogs,
  listTimeLogsForTask,
  updateLocalTimeLogEntry,
  upsertRemoteTimeLogEntry,
  type AggregatedTimeData
} from './db/repositories/timeLogRepository';
import { calculateNextOccurrence, isRecurringTask } from '../shared/utils/recurrence';
import { createLocalWritingEntry } from './db/repositories/writingRepository';
import { 
  listProjects as listCachedProjects, 
  upsertProject,
  createLocalProject,
  updateLocalProject,
  deleteLocalProject,
  getProject,
  type CreateLocalProjectPayload 
} from './db/repositories/projectRepository';
import {
  initializeAllDefaultStatuses,
  listLocalTaskStatuses,
  listLocalProjectStatuses,
  createLocalTaskStatus,
  createLocalProjectStatus,
  updateLocalTaskStatus,
  deleteLocalTaskStatus,
  mergeNotionTaskStatuses,
  mergeNotionProjectStatuses,
  getCombinedTaskStatuses
} from './db/repositories/localStatusRepository';
import {
  deleteView,
  getAppPreferences,
  getChatbotSettings,
  getFeatureToggles,
  getSavedViews,
  getSettings,
  getProjectsSettings,
  getContactsSettings,
  getTimeLogSettings,
  getWritingSettings,
  initConfigStore,
  saveView,
  updateAppPreferences as persistAppPreferences,
  updateChatbotSettings as persistChatbotSettings,
  updateFeatureToggles as persistFeatureToggles,
  updateProjectsSettings as persistProjectsSettings,
  updateContactsSettings as persistContactsSettingsConfig,
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
import { transcribeWithWhisper } from './services/speechService';
import { getStatusDiagnostics, getDetailedStatusDiagnostics } from './services/statusDiagnostics';
import {
  verifyTasksDatabase,
  verifyProjectsDatabase,
  verifyContactsDatabase,
  verifyTimeLogDatabase,
  verifyWritingDatabase,
  verifyAllDatabases
} from './services/databaseVerification';

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

let stopBackupRoutine: (() => void) | null = null;
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
let calendarWindow: BrowserWindow | null = null;
// Docking disabled for now while we debug.
let docking: DockingController | null = null;
let calendarDocking: DockingController | null = null;
const taskWindows = new Set<BrowserWindow>();

// Cross-window drag state management
let crossWindowDragState: CrossWindowDragState = {
  task: null,
  sourceWindow: null,
  isDragging: false
};

// Focus stack - allows multiple tasks in focus mode
let focusStack: string[] = [];

function broadcastCrossWindowDragState() {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('crossWindowDrag:stateChanged', crossWindowDragState);
  });
}

function broadcastFocusStack() {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('focusStack:changed', focusStack);
  });
}

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
  try {
    const fs = require('fs');
    const path = require('path');
    const logPath = path.join(process.env.APPDATA || '', 'NotionTasksWidget', 'startup.log');
    fs.appendFileSync(logPath, `Main window created at ${new Date().toISOString()}\n`);
  } catch {}
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
    // Always start expanded so user can see the widget
    // User can collapse it manually if desired
    docking?.expand();
    
    try {
      const fs = require('fs');
      const path = require('path');
      const logPath = path.join(process.env.APPDATA || '', 'NotionTasksWidget', 'startup.log');
      fs.appendFileSync(logPath, `Window shown and expanded at ${new Date().toISOString()}\n`);
    } catch {}
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
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    resizable: true,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0d1117',
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
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 520,
    resizable: true,
    frame: false,
    show: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0d1117',
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

  // Register ready-to-show handler BEFORE loading content to avoid race condition
  taskWindow.once('ready-to-show', () => {
    console.log('Task window ready', taskId);
    taskWindow.show();
    taskWindow.focus();
  });

  // Fallback: force show after timeout if ready-to-show doesn't fire
  setTimeout(() => {
    if (!taskWindow.isDestroyed() && !taskWindow.isVisible()) {
      console.warn('Force showing task window', taskId);
      taskWindow.show();
      taskWindow.focus();
    }
  }, 1500);

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
    backgroundColor: '#191919',
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
    }
  );

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    const url = `${process.env.VITE_DEV_SERVER_URL}/fullscreen.html`;
    console.log('Loading full-screen URL:', url);
    await fullScreenWindow.loadURL(url);
  } else {
    const filePath = path.join(rendererDist, 'fullscreen.html');
    console.log('Loading full-screen file:', filePath);
    await fullScreenWindow.loadFile(filePath);
  }

  fullScreenWindow.once('ready-to-show', () => {
    console.log('Full-screen window ready-to-show');
    fullScreenWindow?.show();
    fullScreenWindow?.focus();
  });

  setTimeout(() => {
    if (fullScreenWindow && !fullScreenWindow.isDestroyed() && !fullScreenWindow.isVisible()) {
      console.warn('Force showing full-screen window after timeout');
      fullScreenWindow.show();
      fullScreenWindow.focus();
    }
  }, 1500);

  return fullScreenWindow;
};

const createCalendarWindow = async () => {
  if (calendarWindow) {
    if (calendarWindow.isMinimized()) {
      calendarWindow.restore();
    }
    calendarWindow.focus();
    return calendarWindow;
  }

  const initialPreferences = getAppPreferences();
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Default size - larger for tasks + calendar layout
  const defaultWidth = 900;
  const defaultHeight = 700;

  // Position centered on screen
  const x = Math.round((screenWidth - defaultWidth) / 2);
  const y = Math.round((screenHeight - defaultHeight) / 2);

  calendarWindow = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    minWidth: 600,
    minHeight: 500,
    x,
    y,
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

  console.log('Calendar window created');
  calendarDocking = new DockingController(calendarWindow);

  calendarWindow.on('closed', () => {
    calendarWindow = null;
    calendarDocking = null;
  });

  calendarWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('Calendar window failed to load', {
      errorCode,
      errorDescription,
      validatedURL
    });
  });

  calendarWindow.webContents.on('did-finish-load', () => {
    console.log('Calendar window renderer finished loading');
    if (calendarWindow && !calendarWindow.isVisible()) {
      calendarWindow.show();
    }
  });

  calendarWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    console.log('Loading calendar window from dev server');
    await calendarWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}/calendar.html`);
  } else {
    const entryFile = path.join(rendererDist, 'calendar.html');
    console.log('Loading calendar window file', entryFile);
    await calendarWindow.loadFile(entryFile);
  }

  applyAlwaysOnTop(calendarWindow, initialPreferences.alwaysOnTop, {
    manageWorkspaces: true
  });

  const forceShowTimeout = setTimeout(() => {
    if (calendarWindow && !calendarWindow.isDestroyed() && !calendarWindow.isVisible()) {
      console.warn('Force showing calendar window after timeout');
      calendarWindow.show();
      calendarDocking?.snapToEdge('right');
    }
  }, 2500);

  calendarWindow.on('show', () => {
    clearTimeout(forceShowTimeout);
  });

  calendarWindow.once('ready-to-show', () => {
    calendarWindow?.show();
    calendarDocking?.snapToEdge('right');
    if (!initialPreferences.pinWidget) {
      setTimeout(() => calendarDocking?.collapse(), 900);
    }
  });

  return calendarWindow;
};

app.whenReady().then(async () => {
  try {
    _fs.appendFileSync(_startupLog, `[whenReady] Starting initialization...\n`);
  } catch {}
  
  const userData = app.getPath('userData');
  
  try {
    _fs.appendFileSync(_startupLog, `[whenReady] Initializing database...\n`);
  } catch {}
  const db = initializeDatabase(userData);
  
  try {
    _fs.appendFileSync(_startupLog, `[whenReady] Starting backup routine...\n`);
  } catch {}
  stopBackupRoutine = startDatabaseBackupRoutine(db);
  
  try {
    _fs.appendFileSync(_startupLog, `[whenReady] Initializing config store...\n`);
  } catch {}
  await initConfigStore(userData);
  
  try {
    _fs.appendFileSync(_startupLog, `[whenReady] Config store initialized\n`);
  } catch {}

  // Check for imported tasks JSON file and load into SQLite
  const importJsonPath = path.join(userData, 'imported-tasks.json');
  const taskCountBefore = getTaskCount();
  console.log(`[Startup] Current tasks in database: ${taskCountBefore}`);
  
  // Also log projects count
  const projectsCount = listCachedProjects().length;
  console.log(`[Startup] Current projects in database: ${projectsCount}`);

  // Initialize default statuses (LOCAL-FIRST: these are the primary source of truth)
  initializeAllDefaultStatuses();
  
  const statusDiagnostics = getStatusDiagnostics();
  console.log('[Startup] Task status summary:', statusDiagnostics.tasks);
  console.log('[Startup] Project status summary:', statusDiagnostics.projects);
  console.log('[Startup] Local task statuses:', listLocalTaskStatuses().map(s => s.name).join(', '));
  console.log('[Startup] Local project statuses:', listLocalProjectStatuses().map(s => s.name).join(', '));
  
  if (fs.existsSync(importJsonPath)) {
    console.log('[Startup] Found imported tasks file, loading into database...');
    const imported = importTasksFromJson(importJsonPath);
    if (imported > 0) {
      console.log(`[Startup] Imported ${imported} tasks from JSON file`);
    }
  }
  
  const taskCountAfter = getTaskCount();
  console.log(`[Startup] Tasks in database after import check: ${taskCountAfter}`);

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

  // Settings are now managed directly via configStore imports
  // setWritingSettings, setTimeLogSettings, etc. are update functions
  
  // Sync engine removed - no more automatic background sync
  // Tasks are now synced on-demand via direct API calls
  console.log('[Startup] Using direct API sync (no background sync engine)');
  
  // Auto-cleanup old trashed tasks (older than 30 days) on startup
  try {
    const cleaned = cleanupOldTrashedTasks(30);
    if (cleaned > 0) {
      console.log(`[Startup] Cleaned up ${cleaned} old trashed tasks`);
    }
  } catch (error) {
    console.error('[Startup] Failed to cleanup trashed tasks:', error);
  }
  
  // Event listeners removed - sync engine no longer exists
  // Updates will be pushed immediately when tasks are created/updated
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
  const fullscreenShortcut = process.platform === 'darwin' ? 'Command+F' : 'Control+F';
  globalShortcut.register(fullscreenShortcut, async () => {
    try {
      await createFullScreenWindow();
    } catch (error) {
      console.error('Error opening full-screen window via shortcut', error);
    }
  });
  
  try {
    _fs.appendFileSync(_startupLog, `[whenReady] Initialization complete!\n`);
  } catch {}
}).catch((err) => {
  // Catch any errors during app initialization
  try {
    _fs.appendFileSync(_startupLog, `[whenReady] FATAL ERROR: ${err?.stack || err}\n`);
  } catch {}
  console.error('Fatal error during app initialization:', err);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackupRoutine?.();
  stopBackupRoutine = null;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('tasks:fetch', async () => {
  // Return cached tasks IMMEDIATELY - this is why we have a local database!
  // The sync engine handles background updates, so tasks appear instantly
  const cached = listStoredTasks();
  const settings = getSettings();
  
  // Build subtask relationships to enrich parent tasks with subtaskIds and progress
  const { parentTasks, subtaskMap } = buildSubtaskRelationships(cached, settings.completedStatus);
  
  // Combine parent tasks with subtasks, keeping subtasks in the list for filtering
  // but with parentTaskId set so the UI can organize them
  const allTasks = [
    ...parentTasks,
    ...Array.from(subtaskMap.values()).flat()
  ];
  
  console.log(
    `[IPC] tasks:fetch returning ${allTasks.length} tasks (${parentTasks.length} parents, ${subtaskMap.size} parents with subtasks)`
  );
  
  // Return ALL tasks - filtering happens in the UI layer, not here
  // This ensures the local database is the single source of truth
  return allTasks;
});

ipcMain.handle('tasks:getSubtasks', async (_event, parentTaskId: string) => {
  return getSubtasks(parentTaskId);
});
ipcMain.handle('tasks:add', async (_event, payload: NotionCreatePayload) => {
  const task = createLocalTask(payload);
  // Immediately push to Notion using direct API
  if (isNotionConfigured()) {
    createNotionTask(payload).catch((err) => {
      console.error('[IPC] tasks:add - Notion push failed:', err);
    });
  }
  return task;
});
ipcMain.handle(
  'tasks:update',
  async (_event, taskId: string, updates: TaskUpdatePayload) => {
    // Get current task state before update to check for recurring completion
    const allTasks = listStoredTasks();
    const currentTask = allTasks.find(t => t.id === taskId);
    const settings = getSettings();
    const completedStatus = settings.completedStatus;
    const initialStatus = settings.initialStatus || '📋'; // Default to To-Do emoji
    
    // Check if this is a task being marked as complete
    const isBeingCompleted = updates.status === completedStatus && currentTask?.status !== completedStatus;
    const hasRecurrence = isRecurringTask(currentTask?.recurrence);
    
    let finalUpdates = { ...updates };
    
    // Auto-fill estimated time on completion (stipulation feature)
    if (isBeingCompleted && currentTask?.autoFillEstimatedTime && currentTask?.estimatedLengthMinutes) {
      const existingLogs = listTimeLogsForTask(taskId);
      // Check if there's any log from today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStart = today.getTime();
      
      const hasLogToday = existingLogs.some(log => {
        if (!log.startTime) return false;
        return new Date(log.startTime).getTime() >= todayStart;
      });
      
      // Only auto-fill if no time was logged today
      if (!hasLogToday) {
        console.log('[AutoFill] Auto-filling estimated time on completion:', currentTask.estimatedLengthMinutes, 'minutes');
        const now = new Date();
        const startTime = new Date(now.getTime() - (currentTask.estimatedLengthMinutes * 60 * 1000));
        
        // Create a time log entry with the estimated time
        const timeLogEntry = createLocalTimeLogEntry({
          taskId: taskId,
          taskTitle: currentTask.title,
          status: 'End',
          startTime: startTime.toISOString(),
          endTime: now.toISOString(),
          sessionLengthMinutes: currentTask.estimatedLengthMinutes
        });
        
        // Broadcast the time log entry
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send('timeLog:updated', timeLogEntry);
        });
      }
    }
    
    // Handle recurring task completion
    if (isBeingCompleted && hasRecurrence && currentTask) {
      console.log('[Recurring] Task is being completed with recurrence:', currentTask.recurrence);
      
      // Calculate the next occurrence date
      const nextDate = calculateNextOccurrence(currentTask.dueDate, currentTask.recurrence!);
      console.log('[Recurring] Next occurrence:', nextDate);
      
      if (nextDate) {
        // Override the status to reset to initial instead of completed
        // And set the new due date
        finalUpdates = {
          ...updates,
          status: initialStatus,
          dueDate: nextDate
        };
        console.log('[Recurring] Task will be reset with new date:', nextDate);
        
        // Reset all subtasks to initial status
        const subtasks = allTasks.filter(t => t.parentTaskId === taskId);
        if (subtasks.length > 0) {
          console.log(`[Recurring] Resetting ${subtasks.length} subtasks to initial status`);
          for (const subtask of subtasks) {
            const resetSubtask = updateLocalTask(subtask.id, { status: initialStatus });
            BrowserWindow.getAllWindows().forEach((window) => {
              window.webContents.send('tasks:updated', resetSubtask);
            });
          }
        }
      }
    }
    
    const updated = updateLocalTask(taskId, finalUpdates);
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('tasks:updated', updated);
    });
    // Immediately push to Notion using direct API
    if (isNotionConfigured() && !updated?.localOnly) {
      updateNotionTask(taskId, finalUpdates).catch((err) => {
        console.error('[IPC] tasks:update - Notion push failed:', err);
      });
    }
    return updated;
  }
);
ipcMain.handle('tasks:statusOptions', async () => {
  try {
    return await fetchStatusOptions();
  } catch (error) {
    console.error('[IPC] tasks:statusOptions failed:', error);
    return listLocalTaskStatuses(); // Fallback to local statuses
  }
});
ipcMain.handle('tasks:orderOptions', () => {
  // Order options are stored locally - no need to fetch from Notion
  return []; // TODO: Add local order options if needed
});

// ============================================================================
// TRASH MANAGEMENT
// View, restore, or permanently delete tasks that were deleted in Notion
// ============================================================================
ipcMain.handle('trash:list', () => {
  return listTrashedTasks();
});

ipcMain.handle('trash:count', () => {
  return countTrashedTasks();
});

ipcMain.handle('trash:restore', (_event, taskId: string) => {
  const restored = restoreTaskFromTrash(taskId);
  if (restored) {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('tasks:updated', restored);
      window.webContents.send('trash:changed');
    });
  }
  return restored;
});

ipcMain.handle('trash:delete', (_event, taskId: string) => {
  const deleted = permanentlyDeleteTask(taskId);
  if (deleted) {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('trash:changed');
    });
  }
  return deleted;
});

ipcMain.handle('trash:empty', () => {
  const count = emptyTrash();
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('trash:changed');
  });
  return count;
});

ipcMain.handle('trash:cleanup', (_event, daysOld?: number) => {
  const count = cleanupOldTrashedTasks(daysOld ?? 30);
  if (count > 0) {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('trash:changed');
    });
  }
  return count;
});

ipcMain.handle('projects:statusOptions', () => {
  // Return local project statuses
  return listLocalProjectStatuses();
});
ipcMain.handle('projects:fetchAndSaveStatusOptions', async () => {
  console.log('[IPC] projects:fetchAndSaveStatusOptions - Using local statuses');
  try {
    const options = listLocalProjectStatuses();
    if (options.length > 0) {
      // Save to settings for persistence
      const currentSettings = getProjectsSettings();
      const updatedSettings = await persistProjectsSettings({
        ...currentSettings,
        cachedStatusOptions: options
      });
      setProjectsSettings(updatedSettings);
      console.log(`[IPC] projects:fetchAndSaveStatusOptions - Saved ${options.length} status options`);
      return options;
    }
    return options;
  } catch (error) {
    console.error('[IPC] projects:fetchAndSaveStatusOptions - Failed:', error);
    throw error;
  }
});
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
ipcMain.handle('settings:projects:get', () => getProjectsSettings());
ipcMain.handle(
  'settings:projects:update',
  async (_event, next: ProjectsSettings) => {
    const saved = await persistProjectsSettings(next);
    setProjectsSettings(saved);
    return saved;
  }
);
ipcMain.handle('settings:contacts:get', () => getContactsSettings());
ipcMain.handle(
  'settings:contacts:update',
  async (_event, next: ContactsSettings) => {
    const saved = await persistContactsSettingsConfig(next);
    setContactsSettings(saved);
    return saved;
  }
);
ipcMain.handle('settings:chatbot:get', () => getChatbotSettings());
ipcMain.handle(
  'settings:chatbot:update',
  async (_event, next: ChatbotSettings) => {
    const saved = await persistChatbotSettings(next);
    return saved;
  }
);

// ============================================================================
// CHATBOT AI ASSISTANT
// Voice/text based task management assistant
// ============================================================================
ipcMain.handle('chatbot:sendMessage', async (_event, payload: {
  message: string;
  tasks: Task[];
  projects: Project[];
}) => {
  const { processChatMessage } = await import('./services/chatbotService');
  return processChatMessage(payload);
});

ipcMain.handle('chatbot:executeActions', async (_event, payload: {
  actions: import('../shared/types').TaskAction[];
}) => {
  const { executeChatbotActions } = await import('./services/chatbotActionExecutor');
  const actionResults = await executeChatbotActions(payload.actions);
  
  // Map ChatbotActionExecutionResult[] to ChatbotExecutionResult format
  const results: import('../shared/types').TaskActionResult[] = actionResults.map(r => ({
    action: r.action,
    success: r.status === 'applied',
    message: r.message,
    taskId: r.task?.id,
    error: r.status === 'failed' ? r.message : undefined
  }));
  
  const allSucceeded = results.every(r => r.success);
  
  return {
    success: allSucceeded,
    results,
    error: allSucceeded ? undefined : 'Some actions failed'
  } satisfies import('../shared/types').ChatbotExecutionResult;
});

ipcMain.handle('chatbot:getSummaries', async (_event, limit?: number, offset?: number) => {
  const { listChatSummaries } = await import('./db/repositories/chatSummaryRepository');
  return listChatSummaries(limit ?? 50, offset ?? 0);
});

ipcMain.handle('chatbot:getSummary', async (_event, summaryId: string) => {
  const { getChatSummary } = await import('./db/repositories/chatSummaryRepository');
  return getChatSummary(summaryId);
});

ipcMain.handle('chatbot:deleteSummary', async (_event, summaryId: string) => {
  const { deleteChatSummary } = await import('./db/repositories/chatSummaryRepository');
  return deleteChatSummary(summaryId);
});

ipcMain.handle('projects:fetch', async () => listCachedProjects());
ipcMain.handle('projects:refresh', async () => {
  console.log('[IPC] projects:refresh - Fetching projects from Notion');
  try {
    const projects = await fetchNotionProjects();
    const timestamp = new Date().toISOString();
    console.log(`[IPC] projects:refresh - Received ${projects.length} projects, storing...`);
    projects.forEach((project) => {
      upsertProject(project, timestamp);
    });
    // Return the freshly stored projects
    return listCachedProjects();
  } catch (error) {
    console.error('[IPC] projects:refresh - Failed:', error);
    throw error;
  }
});
ipcMain.handle('contacts:fetch', async () => {
  try {
    return await fetchContactsFromNotion();
  } catch (error) {
    console.error('[IPC] contacts:fetch - Failed:', error);
    throw error;
  }
});
ipcMain.handle('contacts:refresh', async () => {
  try {
    return await fetchContactsFromNotion();
  } catch (error) {
    console.error('[IPC] contacts:refresh - Failed:', error);
    throw error;
  }
});
ipcMain.handle('diagnostics:statusSummary', () => getStatusDiagnostics());
ipcMain.handle('diagnostics:statusDetailed', () => getDetailedStatusDiagnostics());

// ============================================================================
// DATABASE VERIFICATION
// Verify that configured property names exist in Notion databases
// ============================================================================
ipcMain.handle('verify:tasks', async () => {
  const settings = getSettings();
  return verifyTasksDatabase(settings);
});

ipcMain.handle('verify:projects', async () => {
  const taskSettings = getSettings();
  const projectSettings = getProjectsSettings();
  return verifyProjectsDatabase(projectSettings, taskSettings.apiKey);
});

ipcMain.handle('verify:contacts', async () => {
  const taskSettings = getSettings();
  const contactSettings = getContactsSettings();
  return verifyContactsDatabase(contactSettings, taskSettings.apiKey);
});

ipcMain.handle('verify:timeLogs', async () => {
  const taskSettings = getSettings();
  const timeLogSettings = getTimeLogSettings();
  return verifyTimeLogDatabase(timeLogSettings, taskSettings.apiKey);
});

ipcMain.handle('verify:writing', async () => {
  const taskSettings = getSettings();
  const writingSettings = getWritingSettings();
  return verifyWritingDatabase(writingSettings, taskSettings.apiKey);
});

ipcMain.handle('verify:all', async () => {
  return verifyAllDatabases({
    taskSettings: getSettings(),
    projectsSettings: getProjectsSettings(),
    contactsSettings: getContactsSettings(),
    timeLogSettings: getTimeLogSettings(),
    writingSettings: getWritingSettings()
  });
});

// ============================================================================
// LOCAL STATUS OPTIONS (LOCAL-FIRST)
// These allow managing statuses independently of Notion
// ============================================================================
ipcMain.handle('localStatus:listTaskStatuses', () => listLocalTaskStatuses());
ipcMain.handle('localStatus:listProjectStatuses', () => listLocalProjectStatuses());
ipcMain.handle('localStatus:createTaskStatus', (_event, options: { 
  name: string; 
  color?: string; 
  sortOrder?: number; 
  isCompleted?: boolean 
}) => {
  return createLocalTaskStatus(options);
});
ipcMain.handle('localStatus:createProjectStatus', (_event, options: { 
  name: string; 
  color?: string; 
  sortOrder?: number; 
  isCompleted?: boolean 
}) => {
  return createLocalProjectStatus(options);
});
ipcMain.handle('localStatus:updateTaskStatus', (_event, id: string, updates: { 
  name?: string; 
  color?: string | null; 
  sortOrder?: number; 
  isCompleted?: boolean 
}) => {
  updateLocalTaskStatus(id, updates);
});
ipcMain.handle('localStatus:deleteTaskStatus', (_event, id: string) => {
  deleteLocalTaskStatus(id);
});
ipcMain.handle('localStatus:getCombinedStatuses', async () => {
  // Get both local and Notion statuses, merge them
  try {
    const notionStatuses = await fetchStatusOptions();
    return getCombinedTaskStatuses(notionStatuses);
  } catch {
    // If Notion fails, return local only
    return listLocalTaskStatuses();
  }
});
ipcMain.handle('localStatus:mergeNotionStatuses', async () => {
  // Fetch from Notion and merge
  try {
    const notionTaskStatuses = await fetchStatusOptions();
    mergeNotionTaskStatuses(notionTaskStatuses);
    
    // For projects, use local statuses (could add Notion fetch later)
    const notionProjectStatuses = listLocalProjectStatuses();
    mergeNotionProjectStatuses(notionProjectStatuses);
    
    return { 
      success: true, 
      taskStatuses: listLocalTaskStatuses(),
      projectStatuses: listLocalProjectStatuses()
    };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
});

// ============================================================================
// LOCAL PROJECT MANAGEMENT (LOCAL-FIRST)
// Projects can be created locally and synced to Notion later
// ============================================================================
ipcMain.handle('localProject:create', (_event, payload: CreateLocalProjectPayload) => {
  const project = createLocalProject(payload);
  // Push to Notion if configured
  if (isProjectsConfigured()) {
    createNotionProject({
      title: payload.title,
      status: payload.status,
      description: payload.description,
      startDate: payload.startDate,
      endDate: payload.endDate,
      tags: payload.tags
    }).catch((err) => {
      console.error('[IPC] localProject:create - Notion push failed:', err);
    });
  }
  return project;
});
ipcMain.handle('localProject:update', (_event, projectId: string, updates: Partial<CreateLocalProjectPayload>) => {
  const project = updateLocalProject(projectId, updates);
  // Push to Notion if configured and project has a Notion ID
  if (isProjectsConfigured() && project && !project.localOnly) {
    updateNotionProject(projectId, {
      title: updates.title,
      status: updates.status,
      description: updates.description,
      startDate: updates.startDate,
      endDate: updates.endDate,
      tags: updates.tags
    }).catch((err) => {
      console.error('[IPC] localProject:update - Notion push failed:', err);
    });
  }
  return project;
});
ipcMain.handle('localProject:delete', (_event, projectId: string) => {
  const result = deleteLocalProject(projectId);
  // Note: Notion archive would need the Notion page ID, not local ID
  // For now, just delete locally
  return result;
});
ipcMain.handle('localProject:get', (_event, projectId: string) => {
  return getProject(projectId);
});

// === SYNC HANDLERS (Now using direct API calls) ===
ipcMain.handle('sync:status', () => ({
  state: 'idle',
  lastSync: null,
  error: null
}));

ipcMain.handle('sync:force', async () => {
  console.log('[IPC] sync:force - Fetching tasks from Notion');
  try {
    const tasks = await fetchActiveTasks();
    // Save to SQLite (local is primary, Notion is backup)
    for (const task of tasks) {
      upsertRemoteTask(task, task.id, task.lastEdited || new Date().toISOString());
    }
    return { state: 'idle', lastSync: new Date().toISOString(), error: null };
  } catch (error) {
    console.error('[IPC] sync:force failed:', error);
    return { state: 'error', lastSync: null, error: String(error) };
  }
});

ipcMain.handle('sync:timestamps', () => ({
  lastPush: null,
  lastPull: null,
  lastFullSync: null
}));

ipcMain.handle('sync:importTasks', async () => {
  console.log('[IPC] sync:importTasks - Fetching tasks from Notion');
  const tasks = await fetchActiveTasks();
  // Save to SQLite (local is primary, Notion is backup)
  for (const task of tasks) {
    upsertRemoteTask(task, task.id, task.lastEdited || new Date().toISOString());
  }
  return { success: true, count: tasks.length };
});

ipcMain.handle('sync:importProjects', async () => {
  console.log('[IPC] sync:importProjects - Fetching projects from Notion');
  const projects = await fetchNotionProjects();
  // Save to SQLite (local is primary, Notion is backup)
  for (const project of projects) {
    upsertProject(project, project.lastEdited || new Date().toISOString());
  }
  return { success: true, count: projects.length };
});

ipcMain.handle('sync:importTimeLogs', async () => {
  console.log('[IPC] sync:importTimeLogs - Fetching time logs from Notion');
  const timeLogs = await fetchTimeLogsFromNotion();
  // Save to SQLite (local is primary, Notion is backup)
  for (const log of timeLogs) {
    upsertRemoteTimeLogEntry(log, new Date().toISOString());
  }
  return { success: true, count: timeLogs.length };
});

ipcMain.handle('sync:importContacts', async () => {
  console.log('[IPC] sync:importContacts - Fetching contacts from Notion');
  const contacts = await fetchContactsFromNotion();
  // Store contacts locally if needed
  return { success: true, count: contacts.length };
});

ipcMain.handle('sync:importActiveTasksOnly', async () => {
  console.log('[IPC] sync:importActiveTasksOnly - Using new import service');
  try {
    const result = await importActiveTasks();
    return { success: true, count: result.inserted + result.updated, inserted: result.inserted, updated: result.updated };
  } catch (error) {
    console.error('[IPC] sync:importActiveTasksOnly failed:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('sync:importActiveProjectsOnly', async () => {
  console.log('[IPC] sync:importActiveProjectsOnly - Using new import service');
  try {
    const result = await importActiveProjects();
    return { success: true, count: result.inserted + result.updated, inserted: result.inserted, updated: result.updated };
  } catch (error) {
    console.error('[IPC] sync:importActiveProjectsOnly failed:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('sync:testConnection', async () => {
  return testConnection();
});

ipcMain.handle('sync:isInitialImportDone', () => {
  // With direct API, we don't track "initial import" - just return true
  return true;
});

// Notion connection status handlers
ipcMain.handle('notion:isConnected', () => {
  return isNotionConfigured();
});
ipcMain.handle('notion:getConnectionStatus', async () => {
  const configured = isNotionConfigured();
  const settings = getNotionSettingsSnapshot();
  return {
    connected: configured,
    hasApiKey: Boolean(settings?.databaseId), // We don't expose API key
    hasDatabaseId: Boolean(settings?.databaseId),
    mode: configured ? 'synced' : 'local-only'
  };
});
ipcMain.handle('sync:performInitialImport', async () => {
  console.log('[IPC] sync:performInitialImport - Fetching all tasks');
  const tasks = await fetchActiveTasks();
  for (const task of tasks) {
    upsertRemoteTask(task, task.id, task.lastEdited || new Date().toISOString());
  }
  return { state: 'idle', lastSync: new Date().toISOString(), error: null };
});
ipcMain.handle('sync:getImportProgress', () => {
  // No import queue anymore - return completed status
  return { phase: 'complete', current: 0, total: 0, type: null };
});
ipcMain.handle('sync:resetImport', () => {
  // No import state to reset with direct API
  console.log('[IPC] sync:resetImport - No-op with direct API');
});
ipcMain.handle('sync:importTaskById', async (_event, pageId: string) => {
  console.log('[IPC] sync:importTaskById - Fetching single task:', pageId);
  const { fetchTask } = await import('./services/notionTasks');
  const task = await fetchTask(pageId);
  if (task) {
    upsertRemoteTask(task, task.id, task.lastEdited || new Date().toISOString());
  }
  return task;
});

// ============================================================================
// IMPORT QUEUE MANAGEMENT (Simplified - no queue with direct API)
// ============================================================================
ipcMain.handle('importQueue:getStatus', () => {
  // Return format expected by ImportQueueMenu component
  return { 
    allStatuses: [
      { type: 'tasks', status: 'completed', message: 'Ready to import' },
      { type: 'projects', status: 'completed', message: 'Ready to import' },
      { type: 'contacts', status: 'completed', message: 'Ready to import' },
      { type: 'timeLogs', status: 'completed', message: 'Ready to import' }
    ], 
    currentImport: null 
  };
});

ipcMain.handle('importQueue:cancel', (_event, _type: ImportType) => {
  // No queue to cancel with direct API
  return { success: true };
});

ipcMain.handle('importQueue:cancelAll', () => {
  // No queue to cancel with direct API
});

ipcMain.handle('importQueue:getCurrentImport', () => {
  return null; // No queue with direct API
});

// Import queue removed - using direct API now
// No need to forward status changes

// ============================================================================
// DATA MANAGEMENT
// Full reset and data cleanup operations
// ============================================================================

ipcMain.handle('data:getCounts', () => {
  return getDataCounts();
});

ipcMain.handle('data:fullReset', async () => {
  console.log('[IPC] data:fullReset - Starting full data reset');
  const result = performFullReset();
  
  // No sync engine to reset with direct API
  
  // Notify all windows to refresh
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('data:reset-complete', result);
  });
  
  return result;
});

ipcMain.handle('data:softReset', async () => {
  console.log('[IPC] data:softReset - Starting soft data reset');
  const result = performSoftReset();
  
  // Notify all windows to refresh
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('data:reset-complete', result);
  });
  
  return result;
});

ipcMain.handle('data:resetTasks', async () => {
  console.log('[IPC] data:resetTasks - Resetting tasks only');
  const result = resetTasksOnly();
  
  // Notify all windows to refresh tasks
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('tasks:cache-invalidated');
  });
  
  return result;
});

ipcMain.handle('data:resetProjects', async () => {
  console.log('[IPC] data:resetProjects - Resetting projects only');
  const result = resetProjectsOnly();
  
  // Notify all windows to refresh projects
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('projects:cache-invalidated');
  });
  
  return result;
});

ipcMain.handle('data:resetTimeLogs', async () => {
  console.log('[IPC] data:resetTimeLogs - Resetting time logs only');
  return resetTimeLogsOnly();
});

ipcMain.handle('data:fullResetAndImport', async () => {
  console.log('[IPC] data:fullResetAndImport - Full reset followed by import');
  
  // First perform the full reset
  const resetResult = performFullReset();
  if (!resetResult.success) {
    return { 
      resetSuccess: false, 
      importSuccess: false, 
      resetResult, 
      error: resetResult.error 
    };
  }
  
  // Then trigger the import using direct API
  try {
    const tasks = await fetchActiveTasks();
    for (const task of tasks) {
      upsertRemoteTask(task, task.id, task.lastEdited || new Date().toISOString());
    }
    return { 
      resetSuccess: true, 
      importSuccess: true, 
      resetResult,
      syncStatus: { state: 'idle', lastSync: new Date().toISOString(), error: null }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { 
      resetSuccess: true, 
      importSuccess: false, 
      resetResult, 
      error: errorMessage 
    };
  }
});

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
ipcMain.handle('settings:features:get', () => getFeatureToggles());
ipcMain.handle('settings:features:update', async (_event, toggles: FeatureToggles) => {
  return persistFeatureToggles(toggles);
});
ipcMain.handle(
  'writing:createEntry',
  async (_event, payload: WritingEntryPayload) => {
    createLocalWritingEntry(payload);
    notifyWritingEntryCaptured();
    // Push to Notion if configured
    if (isWritingConfigured()) {
      createNotionWritingEntry(payload).catch((err) => {
        console.error('[IPC] writing:createEntry - Notion push failed:', err);
      });
    }
  }
);
ipcMain.handle(
  'timeLog:createEntry',
  async (_event, payload: TimeLogEntryPayload) => {
    const entry = createLocalTimeLogEntry(payload);
    // Push to Notion if configured
    if (isTimeLogsConfigured()) {
      createNotionTimeLog(payload).catch((err) => {
        console.error('[IPC] timeLog:createEntry - Notion push failed:', err);
      });
    }
    return entry;
  }
);
ipcMain.handle(
  'timeLog:getActive',
  async (_event, taskId: string) => {
    return getActiveEntryForTask(taskId);
  }
);
ipcMain.handle(
  'timeLog:getTotalLogged',
  async (_event, taskId: string) => {
    return getTotalLoggedMinutes(taskId);
  }
);
ipcMain.handle(
  'timeLog:getTodayLogged',
  async (_event, taskId: string) => {
    return getTodayLoggedMinutes(taskId);
  }
);
ipcMain.handle(
  'timeLog:getAggregated',
  async (_event, taskId: string, subtaskIds: string[] = []) => {
    return getAggregatedTimeData(taskId, subtaskIds);
  }
);
ipcMain.handle(
  'timeLog:getAllEntries',
  async (_event, taskId: string) => {
    return listTimeLogsForTask(taskId);
  }
);
ipcMain.handle(
  'timeLog:getAll',
  async () => {
    return listTimeLogs();
  }
);
ipcMain.handle(
  'timeLog:update',
  async (_event, entryId: string, updates: TimeLogUpdatePayload) => {
    const entry = updateLocalTimeLogEntry(entryId, updates);
    // Push to Notion if configured and entry has a Notion ID
    if (isTimeLogsConfigured() && entry && !entry.localOnly) {
      updateNotionTimeLog(entryId, {
        startTime: updates.startTime ?? undefined,
        endTime: updates.endTime ?? undefined
      }).catch((err) => {
        console.error('[IPC] timeLog:update - Notion push failed:', err);
      });
    }
    return entry;
  }
);
ipcMain.handle(
  'timeLog:delete',
  async (_event, entryId: string) => {
    deleteLocalTimeLogEntry(entryId);
    // Note: Notion delete would need the Notion page ID
    // For now, just delete locally
  }
);
ipcMain.handle(
  'speech:transcribe',
  async (_event, payload: SpeechTranscriptionRequest) => {
    if (payload.provider && payload.provider !== 'openai') {
      throw new Error(
        `Speech provider "${payload.provider}" is not supported yet.`
      );
    }
    const chatbotSettings = getChatbotSettings();
    const apiKey =
      payload.apiKey?.trim() ?? chatbotSettings.openaiApiKey?.trim();

    if (!apiKey) {
      throw new Error(
        'OpenAI API key is required for voice transcription. Please add it in Chatbot settings.'
      );
    }

    return transcribeWithWhisper({
      ...payload,
      apiKey
    });
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
    return { edge: 'top', collapsed: true };
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

// Calendar widget handlers
ipcMain.handle('calendar:window:open', async () => {
  if (!app.isReady()) {
    await app.whenReady();
  }
  try {
    await createCalendarWindow();
    if (calendarWindow) {
      calendarWindow.focus();
    }
  } catch (error) {
    console.error('Error in calendar:window:open handler', error);
    throw error;
  }
});

ipcMain.handle('calendar:window:close', () => {
  if (calendarWindow) {
    calendarWindow.close();
  }
});

ipcMain.handle('calendar:dock:expand', () => {
  calendarDocking?.expand();
  return calendarDocking?.getState();
});

ipcMain.handle('calendar:dock:collapse', () => {
  const prefs = getAppPreferences();
  if (prefs.pinWidget) {
    calendarDocking?.expand();
    return calendarDocking?.getState();
  }
  calendarDocking?.collapse();
  return calendarDocking?.getState();
});

ipcMain.handle('calendar:dock:setEdge', (_event, edge: DockEdge) => {
  calendarDocking?.snapToEdge(edge);
  return calendarDocking?.getState();
});

ipcMain.handle('calendar:dock:getState', () => calendarDocking?.getState());

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

// Cross-window drag-and-drop handlers
ipcMain.handle('crossWindowDrag:start', (_event, task: Task, sourceWindow: 'widget' | 'fullscreen') => {
  console.log('[CrossWindowDrag] Start drag from', sourceWindow, '- task:', task.title);
  crossWindowDragState = {
    task,
    sourceWindow,
    isDragging: true
  };
  console.log('[CrossWindowDrag] Started drag from', sourceWindow, 'with task', task.id);
  broadcastCrossWindowDragState();
});

ipcMain.handle('crossWindowDrag:end', () => {
  console.log('[CrossWindowDrag] Drag ended');
  crossWindowDragState = {
    task: null,
    sourceWindow: null,
    isDragging: false
  };
  broadcastCrossWindowDragState();
});

ipcMain.handle('crossWindowDrag:getState', () => {
  return crossWindowDragState;
});

ipcMain.handle('crossWindowDrag:drop', async (_event, payload: CrossWindowDropPayload) => {
  const task = crossWindowDragState.task;
  if (!task) {
    console.warn('[CrossWindowDrag] Drop called with no active drag');
    return null;
  }

  console.log('[CrossWindowDrag] Processing drop', payload.zoneType, payload);

  let updates: Record<string, unknown> = {};

  switch (payload.zoneType) {
    case 'calendar':
      if (payload.date) {
        // Convert date string to ISO format at midday (local time)
        const parts = payload.date.split('-').map(Number);
        const dropDate = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
        updates.dueDate = dropDate.toISOString();
        updates.dueDateEnd = null;
      }
      break;

    case 'project':
      updates.projectIds = payload.projectId ? [payload.projectId] : [];
      break;

    case 'status-filter':
      if (payload.status) {
        updates.status = payload.status;
      }
      break;

    case 'focus-stack':
      // Add to focus stack instead of updating task properties
      if (!focusStack.includes(task.id)) {
        focusStack.push(task.id);
        broadcastFocusStack();
      }
      // Clear drag state
      crossWindowDragState = { task: null, sourceWindow: null, isDragging: false };
      broadcastCrossWindowDragState();
      return task;

    case 'task-list':
      // Apply multiple filter-based updates
      if (payload.filters) {
        if (payload.filters.status !== undefined) {
          updates.status = payload.filters.status;
        }
        if (payload.filters.projectId !== undefined) {
          updates.projectIds = payload.filters.projectId ? [payload.filters.projectId] : [];
        }
        if (payload.filters.urgent !== undefined) {
          updates.urgent = payload.filters.urgent;
        }
        if (payload.filters.important !== undefined) {
          updates.important = payload.filters.important;
        }
      }
      break;
  }

  // Clear drag state
  crossWindowDragState = { task: null, sourceWindow: null, isDragging: false };
  broadcastCrossWindowDragState();

  // Update the task if we have changes
  if (Object.keys(updates).length > 0) {
    try {
      const updated = updateLocalTask(task.id, updates);
      BrowserWindow.getAllWindows().forEach((window) => {
        window.webContents.send('tasks:updated', updated);
      });
      return updated;
    } catch (error) {
      console.error('[CrossWindowDrag] Failed to update task on drop', error);
      return null;
    }
  }

  return task;
});

// Focus stack handlers
ipcMain.handle('focusStack:get', () => {
  return focusStack;
});

ipcMain.handle('focusStack:add', (_event, taskId: string) => {
  if (!focusStack.includes(taskId)) {
    focusStack.push(taskId);
    broadcastFocusStack();
  }
  return focusStack;
});

ipcMain.handle('focusStack:remove', (_event, taskId: string) => {
  focusStack = focusStack.filter((id) => id !== taskId);
  broadcastFocusStack();
  return focusStack;
});

ipcMain.handle('focusStack:clear', () => {
  focusStack = [];
  broadcastFocusStack();
});

// Saved views handlers
ipcMain.handle('views:getAll', () => {
  return getSavedViews();
});

ipcMain.handle('views:save', async (_event, view: Omit<SavedView, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => {
  return saveView(view);
});

ipcMain.handle('views:delete', async (_event, viewId: string) => {
  return deleteView(viewId);
});

ipcMain.handle('views:openWindow', async (_event, view: SavedView) => {
  return createViewWindow(view);
});

// View windows - multiple widget windows with specific views
const viewWindows = new Map<string, BrowserWindow>();

async function createViewWindow(view: SavedView) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const initialPreferences = getAppPreferences();
  
  const viewWindow = new BrowserWindow({
    width: 600,
    height: 760,
    minWidth: 440,
    minHeight: 600,
    x: Math.floor(width / 2 - 300 + Math.random() * 100),
    y: Math.floor(height / 2 - 380 + Math.random() * 100),
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
  
  viewWindows.set(view.id, viewWindow);
  
  viewWindow.on('closed', () => {
    viewWindows.delete(view.id);
  });
  
  // Pass view settings via URL hash
  const viewParams = encodeURIComponent(JSON.stringify(view));
  
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await viewWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#view=${viewParams}`);
  } else {
    await viewWindow.loadFile(path.join(rendererDist, 'index.html'), {
      hash: `view=${viewParams}`
    });
  }
  
  viewWindow.once('ready-to-show', () => {
    viewWindow.show();
    viewWindow.focus();
  });
  
  return view;
}

// Hardcoded minimum sizes - don't use window.getMinimumSize() as it can return incorrect values
const WIDGET_MIN_WIDTH = 440;
const WIDGET_MIN_HEIGHT = 600;

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
  const originalBounds = { ...bounds };
  let { x, y, width, height } = bounds;
  
  // Use hardcoded minimums - window.getMinimumSize() returns wrong values on Windows
  const minW = WIDGET_MIN_WIDTH;
  const minH = WIDGET_MIN_HEIGHT;

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

  const newBounds = { x, y, width, height };
  console.log('[Resize]', direction, {
    delta: { deltaX, deltaY },
    mins: { minW, minH },
    before: originalBounds,
    after: newBounds,
    changed: originalBounds.width !== width || originalBounds.height !== height
  });
  
  window.setBounds(newBounds);
}
