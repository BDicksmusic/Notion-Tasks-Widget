import { contextBridge, ipcRenderer } from 'electron';
import type { DockState, Task, UpdateInfo, UpdateStatus } from '../shared/types';
import type { SettingsAPI, WidgetAPI } from '../shared/ipc';

const widgetAPI: WidgetAPI = {
  getTasks() {
    return ipcRenderer.invoke('tasks:fetch');
  },
  addTask(payload) {
    return ipcRenderer.invoke('tasks:add', payload);
  },
  updateTask(taskId, updates) {
    return ipcRenderer.invoke('tasks:update', taskId, updates);
  },
  getStatusOptions() {
    return ipcRenderer.invoke('tasks:statusOptions');
  },
  openTaskWindow(taskId) {
    return ipcRenderer.invoke('taskWindow:open', taskId);
  },
  resizeWindow(direction, deltaX, deltaY) {
    return ipcRenderer.invoke('window:resize', direction, deltaX, deltaY);
  },
  getSettings() {
    return ipcRenderer.invoke('settings:get');
  },
  updateSettings(settings) {
    return ipcRenderer.invoke('settings:update', settings);
  },
  setAlwaysOnTop(flag: boolean) {
    return ipcRenderer.invoke('window:setAlwaysOnTop', flag);
  },
  getAlwaysOnTop() {
    return ipcRenderer.invoke('window:getAlwaysOnTop');
  },
  getWritingSettings() {
    return ipcRenderer.invoke('settings:writing:get');
  },
  createWritingEntry(payload) {
    return ipcRenderer.invoke('writing:createEntry', payload);
  },
  getTimeLogSettings() {
    return ipcRenderer.invoke('settings:timeLog:get');
  },
  createTimeLogEntry(payload) {
    return ipcRenderer.invoke('timeLog:createEntry', payload);
  },
  getActiveTimeLogEntry(taskId) {
    return ipcRenderer.invoke('timeLog:getActive', taskId);
  },
  getTotalLoggedTime(taskId) {
    return ipcRenderer.invoke('timeLog:getTotalLogged', taskId);
  },
  getAllTimeLogEntries(taskId) {
    return ipcRenderer.invoke('timeLog:getAllEntries', taskId);
  },
  getAllTimeLogs() {
    return ipcRenderer.invoke('timeLog:getAll');
  },
  updateTimeLogEntry(entryId, updates) {
    return ipcRenderer.invoke('timeLog:update', entryId, updates);
  },
  deleteTimeLogEntry(entryId) {
    return ipcRenderer.invoke('timeLog:delete', entryId);
  },
  getAppPreferences() {
    return ipcRenderer.invoke('settings:app:get');
  },
  updateAppPreferences(preferences) {
    return ipcRenderer.invoke('settings:app:update', preferences);
  },
  setLaunchOnStartup(enabled) {
    return ipcRenderer.invoke('settings:app:setStartup', enabled);
  },
  setDockEdge(edge) {
    return ipcRenderer.invoke('dock:setEdge', edge);
  },
  requestExpand() {
    return ipcRenderer.invoke('dock:expand');
  },
  requestCollapse() {
    return ipcRenderer.invoke('dock:collapse');
  },
  forceCollapse() {
    return ipcRenderer.invoke('dock:forceCollapse');
  },
  setThinState(thin: boolean) {
    return ipcRenderer.invoke('dock:setThin', thin);
  },
  setCaptureState(capture: boolean) {
    return ipcRenderer.invoke('dock:setCapture', capture);
  },
  onDockStateChange(callback: (state: DockState) => void) {
    const listener = (_event: Electron.IpcRendererEvent, state: DockState) =>
      callback(state);
    ipcRenderer.on('dock-state:update', listener);
    return () => {
      ipcRenderer.removeListener('dock-state:update', listener);
    };
  },
  onTaskUpdated(callback) {
    const listener = (_event: Electron.IpcRendererEvent, task: Task) =>
      callback(task);
    ipcRenderer.on('tasks:updated', listener);
    return () => {
      ipcRenderer.removeListener('tasks:updated', listener);
    };
  },
  openWidgetSettingsWindow() {
    return ipcRenderer.invoke('widgetSettings:window:open');
  },
  openSettingsWindow() {
    return ipcRenderer.invoke('settings:window:open');
  },
  getDockState() {
    return ipcRenderer.invoke('dock:getState');
  },
  closeWindow() {
    return ipcRenderer.invoke('window:close');
  },
  openFullScreenWindow() {
    return ipcRenderer.invoke('fullScreen:window:open');
  },
  closeFullScreenWindow() {
    return ipcRenderer.invoke('fullScreen:window:close');
  },
  checkForUpdates() {
    return ipcRenderer.invoke('updater:check');
  },
  downloadUpdate() {
    return ipcRenderer.invoke('updater:download');
  },
  installUpdate() {
    return ipcRenderer.invoke('updater:install');
  },
  getUpdateStatus() {
    return ipcRenderer.invoke('updater:getStatus');
  },
  onUpdateStatusChange(callback: (data: { status: UpdateStatus; info: UpdateInfo | null }) => void) {
    const listener = (_event: Electron.IpcRendererEvent, data: { status: UpdateStatus; info: UpdateInfo | null }) =>
      callback(data);
    ipcRenderer.on('updater:status-changed', listener);
    return () => {
      ipcRenderer.removeListener('updater:status-changed', listener);
    };
  },
  getAppVersion() {
    return ipcRenderer.invoke('app:getVersion');
  }
};

const settingsAPI: SettingsAPI = {
  getTaskSettings() {
    return ipcRenderer.invoke('settings:get');
  },
  updateTaskSettings(settings) {
    return ipcRenderer.invoke('settings:update', settings);
  },
  getWritingSettings() {
    return ipcRenderer.invoke('settings:writing:get');
  },
  updateWritingSettings(settings) {
    return ipcRenderer.invoke('settings:writing:update', settings);
  },
  getAppPreferences() {
    return ipcRenderer.invoke('settings:app:get');
  },
  updateAppPreferences(preferences) {
    return ipcRenderer.invoke('settings:app:update', preferences);
  },
  setLaunchOnStartup(enabled) {
    return ipcRenderer.invoke('settings:app:setStartup', enabled);
  },
  previewNotification(payload) {
    return ipcRenderer.invoke('notifications:preview', payload);
  },
  createWritingEntry(payload) {
    return ipcRenderer.invoke('writing:createEntry', payload);
  },
  getTimeLogSettings() {
    return ipcRenderer.invoke('settings:timeLog:get');
  },
  updateTimeLogSettings(settings) {
    return ipcRenderer.invoke('settings:timeLog:update', settings);
  },
  createTimeLogEntry(payload) {
    return ipcRenderer.invoke('timeLog:createEntry', payload);
  }
};

contextBridge.exposeInMainWorld('widgetAPI', widgetAPI);
contextBridge.exposeInMainWorld('settingsAPI', settingsAPI);

