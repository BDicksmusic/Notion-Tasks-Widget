import Database from 'better-sqlite3';
import { runMigrations } from '../src/main/db/schema';
import { ensureBackupDirectory, getBackupPath } from '../src/main/db/backupService';

async function main() {
  const backupPath = getBackupPath();
  ensureBackupDirectory(backupPath);

  const db = new Database(backupPath);
  runMigrations(db);
  db.close();

  console.log(`Backup database is ready at: ${backupPath}`);
}

main().catch((error) => {
  console.error('Failed to create backup database', error);
  process.exitCode = 1;
});


