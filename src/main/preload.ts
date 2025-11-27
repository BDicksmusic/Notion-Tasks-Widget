import { contextBridge, ipcRenderer } from 'electron';
import type {
  CrossWindowDragState,
  CrossWindowDropPayload,
  DatabaseVerificationResult,
  DockState,
  FullVerificationResult,
  ImportJobStatus,
  ImportProgress,
  ImportQueueStatus,
  ImportType,
  Project,
  SavedView,
  StatusDiagnostics,
  SyncStateSummary,
  Task,
  UpdateInfo,
  UpdateStatus,
  VerifiableDatabaseType
} from '../shared/types';
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
  getOrderOptions() {
    return ipcRenderer.invoke('tasks:orderOptions');
  },
  getSubtasks(parentTaskId: string) {
    return ipcRenderer.invoke('tasks:getSubtasks', parentTaskId);
  },
  
  // Trash Management API
  listTrashedTasks() {
    return ipcRenderer.invoke('trash:list');
  },
  countTrashedTasks() {
    return ipcRenderer.invoke('trash:count');
  },
  restoreTaskFromTrash(taskId: string) {
    return ipcRenderer.invoke('trash:restore', taskId);
  },
  permanentlyDeleteTask(taskId: string) {
    return ipcRenderer.invoke('trash:delete', taskId);
  },
  emptyTrash() {
    return ipcRenderer.invoke('trash:empty');
  },
  cleanupOldTrashedTasks(daysOld?: number) {
    return ipcRenderer.invoke('trash:cleanup', daysOld);
  },
  onTrashChanged(callback: () => void) {
    const listener = () => callback();
    ipcRenderer.on('trash:changed', listener);
    return () => ipcRenderer.removeListener('trash:changed', listener);
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
  getChatbotSettings() {
    return ipcRenderer.invoke('settings:chatbot:get');
  },
  updateChatbotSettings(settings) {
    return ipcRenderer.invoke('settings:chatbot:update', settings);
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
  getTodayLoggedTime(taskId) {
    return ipcRenderer.invoke('timeLog:getTodayLogged', taskId);
  },
  getAggregatedTimeData(taskId, subtaskIds = []) {
    return ipcRenderer.invoke('timeLog:getAggregated', taskId, subtaskIds);
  },
  transcribeSpeech(payload) {
    return ipcRenderer.invoke('speech:transcribe', payload);
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
  getProjectsSettings() {
    return ipcRenderer.invoke('settings:projects:get');
  },
  getProjects() {
    return ipcRenderer.invoke('projects:fetch');
  },
  refreshProjects() {
    return ipcRenderer.invoke('projects:refresh');
  },
  getProjectStatusOptions() {
    return ipcRenderer.invoke('projects:statusOptions');
  },
  fetchAndSaveProjectStatusOptions() {
    return ipcRenderer.invoke('projects:fetchAndSaveStatusOptions');
  },
  getContacts() {
    return ipcRenderer.invoke('contacts:fetch');
  },
  refreshContacts() {
    return ipcRenderer.invoke('contacts:refresh');
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
  onProjectsUpdated(callback) {
    const listener = (
      _event: Electron.IpcRendererEvent,
      projects: Project[]
    ) => callback(projects);
    ipcRenderer.on('projects:updated', listener);
    return () => {
      ipcRenderer.removeListener('projects:updated', listener);
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
  },
  getSyncStatus() {
    return ipcRenderer.invoke('sync:status');
  },
  forceSync() {
    return ipcRenderer.invoke('sync:force');
  },
  getSyncTimestamps() {
    return ipcRenderer.invoke('sync:timestamps');
  },
  getStatusDiagnostics() {
    return ipcRenderer.invoke('diagnostics:statusSummary') as Promise<StatusDiagnostics>;
  },
  getDetailedStatusDiagnostics() {
    return ipcRenderer.invoke('diagnostics:statusDetailed');
  },
  
  // Database Verification API
  verifyTasksDatabase(): Promise<DatabaseVerificationResult> {
    return ipcRenderer.invoke('verify:tasks');
  },
  verifyProjectsDatabase(): Promise<DatabaseVerificationResult> {
    return ipcRenderer.invoke('verify:projects');
  },
  verifyContactsDatabase(): Promise<DatabaseVerificationResult> {
    return ipcRenderer.invoke('verify:contacts');
  },
  verifyTimeLogsDatabase(): Promise<DatabaseVerificationResult> {
    return ipcRenderer.invoke('verify:timeLogs');
  },
  verifyWritingDatabase(): Promise<DatabaseVerificationResult> {
    return ipcRenderer.invoke('verify:writing');
  },
  verifyAllDatabases(): Promise<FullVerificationResult> {
    return ipcRenderer.invoke('verify:all');
  },
  
  // ============================================================================
  // LOCAL STATUS MANAGEMENT (LOCAL-FIRST)
  // Manage statuses independently of Notion
  // ============================================================================
  getLocalTaskStatuses() {
    return ipcRenderer.invoke('localStatus:listTaskStatuses');
  },
  getLocalProjectStatuses() {
    return ipcRenderer.invoke('localStatus:listProjectStatuses');
  },
  createLocalTaskStatus(options: { name: string; color?: string; sortOrder?: number; isCompleted?: boolean }) {
    return ipcRenderer.invoke('localStatus:createTaskStatus', options);
  },
  createLocalProjectStatus(options: { name: string; color?: string; sortOrder?: number; isCompleted?: boolean }) {
    return ipcRenderer.invoke('localStatus:createProjectStatus', options);
  },
  updateLocalTaskStatus(id: string, updates: { name?: string; color?: string | null; sortOrder?: number; isCompleted?: boolean }) {
    return ipcRenderer.invoke('localStatus:updateTaskStatus', id, updates);
  },
  deleteLocalTaskStatus(id: string) {
    return ipcRenderer.invoke('localStatus:deleteTaskStatus', id);
  },
  getCombinedStatuses() {
    return ipcRenderer.invoke('localStatus:getCombinedStatuses');
  },
  mergeNotionStatuses() {
    return ipcRenderer.invoke('localStatus:mergeNotionStatuses');
  },
  
  // ============================================================================
  // LOCAL PROJECT MANAGEMENT (LOCAL-FIRST)
  // Create and manage projects locally, sync to Notion later
  // ============================================================================
  createLocalProject(payload: { title: string; status?: string | null; description?: string | null; startDate?: string | null; endDate?: string | null; tags?: string[] | null }) {
    return ipcRenderer.invoke('localProject:create', payload);
  },
  updateLocalProject(projectId: string, updates: Partial<{ title: string; status?: string | null; description?: string | null; startDate?: string | null; endDate?: string | null; tags?: string[] | null }>) {
    return ipcRenderer.invoke('localProject:update', projectId, updates);
  },
  deleteLocalProject(projectId: string) {
    return ipcRenderer.invoke('localProject:delete', projectId);
  },
  getLocalProject(projectId: string) {
    return ipcRenderer.invoke('localProject:get', projectId);
  },
  
  importTasks() {
    return ipcRenderer.invoke('sync:importTasks');
  },
  importProjects() {
    return ipcRenderer.invoke('sync:importProjects');
  },
  importTimeLogs() {
    return ipcRenderer.invoke('sync:importTimeLogs');
  },
  importContacts() {
    return ipcRenderer.invoke('sync:importContacts');
  },
  importActiveTasksOnly() {
    return ipcRenderer.invoke('sync:importActiveTasksOnly');
  },
  importActiveProjectsOnly() {
    return ipcRenderer.invoke('sync:importActiveProjectsOnly');
  },
  testConnection() {
    return ipcRenderer.invoke('sync:testConnection');
  },
  
  // Import Queue Management
  getImportQueueStatus(): Promise<ImportQueueStatus> {
    return ipcRenderer.invoke('importQueue:getStatus');
  },
  cancelImport(type: ImportType): Promise<boolean> {
    return ipcRenderer.invoke('importQueue:cancel', type);
  },
  cancelAllImports(): Promise<void> {
    return ipcRenderer.invoke('importQueue:cancelAll');
  },
  getCurrentImport(): Promise<ImportType | null> {
    return ipcRenderer.invoke('importQueue:getCurrentImport');
  },
  onImportQueueStatusChange(callback: (statuses: ImportJobStatus[]) => void) {
    const listener = (
      _event: Electron.IpcRendererEvent,
      statuses: ImportJobStatus[]
    ) => callback(statuses);
    ipcRenderer.on('importQueue:status-changed', listener);
    return () => {
      ipcRenderer.removeListener('importQueue:status-changed', listener);
    };
  },
  isInitialImportDone() {
    return ipcRenderer.invoke('sync:isInitialImportDone');
  },
  
  // Notion connection status
  isNotionConnected() {
    return ipcRenderer.invoke('notion:isConnected');
  },
  getNotionConnectionStatus() {
    return ipcRenderer.invoke('notion:getConnectionStatus');
  },
  performInitialImport() {
    return ipcRenderer.invoke('sync:performInitialImport');
  },
  getImportProgress() {
    return ipcRenderer.invoke('sync:getImportProgress');
  },
  resetImport() {
    return ipcRenderer.invoke('sync:resetImport');
  },
  onSyncStatusChange(callback) {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: SyncStateSummary
    ) => callback(status);
    ipcRenderer.on('sync:status-changed', listener);
    return () => {
      ipcRenderer.removeListener('sync:status-changed', listener);
    };
  },
  onImportProgress(callback) {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: ImportProgress
    ) => callback(progress);
    ipcRenderer.on('import:progress', listener);
    return () => {
      ipcRenderer.removeListener('import:progress', listener);
    };
  },
  
  // Cross-window drag-and-drop APIs
  startCrossWindowDrag(task: Task, sourceWindow: 'widget' | 'fullscreen') {
    return ipcRenderer.invoke('crossWindowDrag:start', task, sourceWindow);
  },
  endCrossWindowDrag() {
    return ipcRenderer.invoke('crossWindowDrag:end');
  },
  getCrossWindowDragState() {
    return ipcRenderer.invoke('crossWindowDrag:getState');
  },
  handleCrossWindowDrop(payload: CrossWindowDropPayload) {
    return ipcRenderer.invoke('crossWindowDrag:drop', payload);
  },
  onCrossWindowDragChange(callback: (state: CrossWindowDragState) => void) {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: CrossWindowDragState
    ) => callback(state);
    ipcRenderer.on('crossWindowDrag:stateChanged', listener);
    return () => {
      ipcRenderer.removeListener('crossWindowDrag:stateChanged', listener);
    };
  },
  
  // Focus stack APIs
  getFocusStack() {
    return ipcRenderer.invoke('focusStack:get');
  },
  addToFocusStack(taskId: string) {
    return ipcRenderer.invoke('focusStack:add', taskId);
  },
  removeFromFocusStack(taskId: string) {
    return ipcRenderer.invoke('focusStack:remove', taskId);
  },
  clearFocusStack() {
    return ipcRenderer.invoke('focusStack:clear');
  },
  onFocusStackChange(callback: (taskIds: string[]) => void) {
    const listener = (
      _event: Electron.IpcRendererEvent,
      taskIds: string[]
    ) => callback(taskIds);
    ipcRenderer.on('focusStack:changed', listener);
    return () => {
      ipcRenderer.removeListener('focusStack:changed', listener);
    };
  },
  
  // Saved views APIs
  getSavedViews() {
    return ipcRenderer.invoke('views:getAll');
  },
  saveView(view: Omit<SavedView, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
    return ipcRenderer.invoke('views:save', view);
  },
  deleteView(viewId: string) {
    return ipcRenderer.invoke('views:delete', viewId);
  },
  openViewWindow(view: SavedView) {
    return ipcRenderer.invoke('views:openWindow', view);
  },
  
  // Calendar widget APIs
  openCalendarWindow() {
    return ipcRenderer.invoke('calendar:window:open');
  },
  closeCalendarWindow() {
    return ipcRenderer.invoke('calendar:window:close');
  },
  calendarExpand() {
    return ipcRenderer.invoke('calendar:dock:expand');
  },
  calendarCollapse() {
    return ipcRenderer.invoke('calendar:dock:collapse');
  },
  calendarSetEdge(edge: import('../shared/types').DockEdge) {
    return ipcRenderer.invoke('calendar:dock:setEdge', edge);
  },
  getCalendarDockState() {
    return ipcRenderer.invoke('calendar:dock:getState');
  },
  
  // Chatbot AI assistant APIs
  sendChatbotMessage(payload: {
    message: string;
    tasks: import('../shared/types').Task[];
    projects: import('../shared/types').Project[];
  }) {
    return ipcRenderer.invoke('chatbot:sendMessage', payload);
  },
  executeChatbotActions(payload: {
    actions: import('../shared/types').TaskAction[];
  }) {
    return ipcRenderer.invoke('chatbot:executeActions', payload);
  },
  getChatSummaries(limit?: number, offset?: number) {
    return ipcRenderer.invoke('chatbot:getSummaries', limit, offset);
  },
  getChatSummary(summaryId: string) {
    return ipcRenderer.invoke('chatbot:getSummary', summaryId);
  },
  deleteChatSummary(summaryId: string) {
    return ipcRenderer.invoke('chatbot:deleteSummary', summaryId);
  },
  
  // Data Management APIs
  getDataCounts() {
    return ipcRenderer.invoke('data:getCounts');
  },
  performFullReset() {
    return ipcRenderer.invoke('data:fullReset');
  },
  performSoftReset() {
    return ipcRenderer.invoke('data:softReset');
  },
  resetTasksOnly() {
    return ipcRenderer.invoke('data:resetTasks');
  },
  resetProjectsOnly() {
    return ipcRenderer.invoke('data:resetProjects');
  },
  resetTimeLogsOnly() {
    return ipcRenderer.invoke('data:resetTimeLogs');
  },
  performFullResetAndImport() {
    return ipcRenderer.invoke('data:fullResetAndImport');
  },
  onDataResetComplete(callback: (result: import('../shared/ipc').ResetResult) => void) {
    const listener = (
      _event: Electron.IpcRendererEvent,
      result: import('../shared/ipc').ResetResult
    ) => callback(result);
    ipcRenderer.on('data:reset-complete', listener);
    return () => {
      ipcRenderer.removeListener('data:reset-complete', listener);
    };
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
  },
  getProjectsSettings() {
    return ipcRenderer.invoke('settings:projects:get');
  },
  updateProjectsSettings(settings) {
    return ipcRenderer.invoke('settings:projects:update', settings);
  },
  getContactsSettings() {
    return ipcRenderer.invoke('settings:contacts:get');
  },
  updateContactsSettings(settings) {
    return ipcRenderer.invoke('settings:contacts:update', settings);
  },
  getFeatureToggles() {
    return ipcRenderer.invoke('settings:features:get');
  },
  updateFeatureToggles(toggles) {
    return ipcRenderer.invoke('settings:features:update', toggles);
  }
};

contextBridge.exposeInMainWorld('widgetAPI', widgetAPI);
contextBridge.exposeInMainWorld('settingsAPI', settingsAPI);

