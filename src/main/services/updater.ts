import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow } from 'electron';
import type { UpdateInfo, UpdateStatus } from '../../shared/types';

// Configure from environment or use defaults
// Note: For GitHub releases, electron-updater reads from package.json build.publish config
// But we can override via environment variables if needed
const GITHUB_OWNER = process.env.GITHUB_OWNER || '';
const GITHUB_REPO = process.env.GITHUB_REPO || '';

let currentStatus: UpdateStatus = 'idle';
let updateInfo: UpdateInfo | null = null;
let downloadProgress = 0;
let statusListeners: Set<(status: UpdateStatus, info: UpdateInfo | null) => void> = new Set();

// Only check for updates in production
const isDev = process.env.NODE_ENV === 'development';

// Configure autoUpdater
// electron-updater will automatically use the publish config from package.json
// But we can override if environment variables are set
if (GITHUB_OWNER && GITHUB_REPO && !isDev) {
  // The feed URL is typically set via electron-builder config in package.json
  // This is just a fallback if needed
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO
  });
}

export function initializeUpdater(mainWindow: BrowserWindow | null): void {
  if (isDev) {
    console.log('Update checking disabled in development mode');
    return;
  }

  // electron-updater will use package.json build.publish config if available
  // Environment variables are optional overrides
  if (GITHUB_OWNER && GITHUB_REPO) {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO
    });
  } else {
    // Check if publish config exists in package.json (electron-updater reads this automatically)
    // If not configured, log a warning but don't fail - user can configure later
    console.log('Update checking will use package.json build.publish config if available');
  }

  // Set update check interval (optional - we'll do manual checks)
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // Event handlers
  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...');
    setStatus('checking', null);
    broadcastStatus();
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    updateInfo = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
    };
    setStatus('available', updateInfo);
    broadcastStatus();
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('Update not available. Current version is latest.');
    updateInfo = {
      version: info.version || 'unknown'
    };
    setStatus('not-available', updateInfo);
    broadcastStatus();
  });

  autoUpdater.on('error', (error) => {
    console.error('Update error:', error);
    updateInfo = {
      version: 'unknown',
      error: error.message
    };
    setStatus('error', updateInfo);
    broadcastStatus();
  });

  autoUpdater.on('download-progress', (progress) => {
    downloadProgress = progress.percent;
    if (updateInfo) {
      updateInfo.downloadProgress = downloadProgress;
    }
    setStatus('downloading', updateInfo);
    broadcastStatus();
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);
    updateInfo = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
    };
    setStatus('ready', updateInfo);
    broadcastStatus();
  });

  // Auto-check on startup (after a delay to let app initialize)
  setTimeout(() => {
    checkForUpdates();
  }, 5000);
}

function setStatus(status: UpdateStatus, info: UpdateInfo | null): void {
  currentStatus = status;
  updateInfo = info;
}

function broadcastStatus(): void {
  statusListeners.forEach((listener) => {
    try {
      listener(currentStatus, updateInfo);
    } catch (error) {
      console.error('Error in status listener:', error);
    }
  });
}

export async function checkForUpdates(): Promise<void> {
  if (isDev) {
    console.log('Update checking disabled in development mode');
    return;
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.error('Failed to check for updates:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // If it's a configuration error, provide helpful message
    if (errorMessage.includes('publish') || errorMessage.includes('repository')) {
      updateInfo = {
        version: 'unknown',
        error: 'GitHub repository not configured. Please set GITHUB_OWNER and GITHUB_REPO environment variables or configure publish settings in package.json.'
      };
    } else {
      updateInfo = {
        version: 'unknown',
        error: errorMessage
      };
    }
    
    setStatus('error', updateInfo);
    broadcastStatus();
    throw error;
  }
}

export async function downloadUpdate(): Promise<void> {
  if (currentStatus !== 'available') {
    throw new Error('No update available to download');
  }

  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    console.error('Failed to download update:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    updateInfo = {
      version: updateInfo?.version || 'unknown',
      error: errorMessage
    };
    setStatus('error', updateInfo);
    broadcastStatus();
    throw error;
  }
}

export function quitAndInstall(): void {
  if (currentStatus !== 'ready') {
    throw new Error('Update not ready to install');
  }

  autoUpdater.quitAndInstall(false, true);
}

export function getUpdateStatus(): { status: UpdateStatus; info: UpdateInfo | null } {
  return {
    status: currentStatus,
    info: updateInfo
  };
}

export function onUpdateStatusChange(
  callback: (status: UpdateStatus, info: UpdateInfo | null) => void
): () => void {
  statusListeners.add(callback);
  // Immediately call with current status
  callback(currentStatus, updateInfo);
  // Return unsubscribe function
  return () => {
    statusListeners.delete(callback);
  };
}

