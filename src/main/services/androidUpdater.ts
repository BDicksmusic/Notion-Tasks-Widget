/**
 * Android Update Service
 * 
 * This service provides update checking functionality for Android builds.
 * It checks GitHub Releases API for new APK versions and can download them.
 * 
 * Note: This is a basic implementation. For production use, you may want to:
 * - Use a proper update server/CDN
 * - Implement code signing verification
 * - Handle Android install permissions (unknown sources)
 * - Use Capacitor plugins for native Android update handling
 */

import type { UpdateInfo, UpdateStatus } from '../../shared/types';

// Configuration from environment
const GITHUB_OWNER = process.env.GITHUB_OWNER || '';
const GITHUB_REPO = process.env.GITHUB_REPO || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''; // Optional, for private repos

let currentStatus: UpdateStatus = 'idle';
let updateInfo: UpdateInfo | null = null;
let statusListeners: Set<(status: UpdateStatus, info: UpdateInfo | null) => void> = new Set();

function setStatus(status: UpdateStatus, info: UpdateInfo | null): void {
  currentStatus = status;
  updateInfo = info;
}

function broadcastStatus(): void {
  statusListeners.forEach((listener) => {
    try {
      listener(currentStatus, updateInfo);
    } catch (error) {
      console.error('Error in Android updater status listener:', error);
    }
  });
}

/**
 * Check GitHub Releases API for latest version
 */
export async function checkForAndroidUpdate(currentVersion: string): Promise<void> {
  if (!GITHUB_OWNER || !GITHUB_REPO) {
    throw new Error('GitHub repository not configured. Set GITHUB_OWNER and GITHUB_REPO environment variables.');
  }

  setStatus('checking', null);
  broadcastStatus();

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'NotionTasksWidget-Android'
    };

    if (GITHUB_TOKEN) {
      headers['Authorization'] = `token ${GITHUB_TOKEN}`;
    }

    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const release = await response.json() as {
      tag_name: string;
      published_at?: string;
      body?: string | null;
      assets?: Array<{ name: string; [key: string]: unknown }>;
    };
    const latestVersion = release.tag_name.replace(/^v/, ''); // Remove 'v' prefix if present

    // Simple version comparison (you may want to use a proper semver library)
    if (compareVersions(latestVersion, currentVersion) > 0) {
      // Find APK asset
      const apkAsset = release.assets?.find((asset) => 
        asset.name.endsWith('.apk')
      );

      if (!apkAsset) {
        throw new Error('No APK found in latest release');
      }

      updateInfo = {
        version: latestVersion,
        releaseDate: release.published_at,
        releaseNotes: release.body ?? undefined
      };

      setStatus('available', updateInfo);
    } else {
      updateInfo = {
        version: latestVersion
      };
      setStatus('not-available', updateInfo);
    }

    broadcastStatus();
  } catch (error) {
    console.error('Failed to check for Android update:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    updateInfo = {
      version: 'unknown',
      error: errorMessage
    };
    setStatus('error', updateInfo);
    broadcastStatus();
    throw error;
  }
}

/**
 * Simple version comparison
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  const maxLength = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLength; i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;
    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }

  return 0;
}

export function getAndroidUpdateStatus(): { status: UpdateStatus; info: UpdateInfo | null } {
  return {
    status: currentStatus,
    info: updateInfo
  };
}

export function onAndroidUpdateStatusChange(
  callback: (status: UpdateStatus, info: UpdateInfo | null) => void
): () => void {
  statusListeners.add(callback);
  callback(currentStatus, updateInfo);
  return () => {
    statusListeners.delete(callback);
  };
}

