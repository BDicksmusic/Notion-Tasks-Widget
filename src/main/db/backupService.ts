import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

const BACKUP_DIR_NAME = 'backups';
const BACKUP_FILE_NAME = 'notion-backup.sqlite';
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

const isSqliteFile = (candidate: string) => path.extname(candidate).toLowerCase() === '.sqlite';

function coerceBackupPath(target?: string) {
  if (!target) return null;
  const absolute = path.resolve(target);
  return isSqliteFile(absolute) ? absolute : path.join(absolute, BACKUP_FILE_NAME);
}

export function getBackupPath(targetOverride?: string) {
  return (
    coerceBackupPath(targetOverride) ??
    coerceBackupPath(process.env.NOTION_WIDGET_BACKUP_PATH) ??
    path.join(process.cwd(), BACKUP_DIR_NAME, BACKUP_FILE_NAME)
  );
}

export function ensureBackupDirectory(filePath: string) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

export async function createBackupSnapshot(db: Database.Database, targetPath?: string) {
  const backupPath = getBackupPath(targetPath);
  ensureBackupDirectory(backupPath);
  await db.backup(backupPath);
  console.log('[DB Backup] Snapshot created at', backupPath);
  return backupPath;
}

type BackupRoutineOptions = {
  intervalMs?: number;
  targetPath?: string;
};

export function startDatabaseBackupRoutine(
  db: Database.Database,
  options: BackupRoutineOptions = {}
) {
  const backupPath = getBackupPath(options.targetPath);
  ensureBackupDirectory(backupPath);

  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let activeBackup: Promise<void> | null = null;
  let stopped = false;

  const runBackup = (reason: string) => {
    if (stopped || activeBackup) {
      return activeBackup;
    }
    activeBackup = db
      .backup(backupPath)
      .then(() => {
        console.log(`[DB Backup] ${reason} backup saved to ${backupPath}`);
      })
      .catch((error: unknown) => {
        console.error('[DB Backup] Failed to create backup', { error, backupPath });
      })
      .finally(() => {
        activeBackup = null;
      });
    return activeBackup;
  };

  void runBackup('initial');

  const timer = setInterval(() => {
    void runBackup('scheduled');
  }, intervalMs);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}






