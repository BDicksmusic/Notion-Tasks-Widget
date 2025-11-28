import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from './schema';

let db: Database.Database | null = null;

// Debug logging to file
function dbLog(msg: string) {
  const logDir = path.join(process.env.APPDATA || 'C:\\temp', 'NotionTasksWidget');
  const logFile = path.join(logDir, 'startup.log');
  try {
    fs.appendFileSync(logFile, `[DB] ${msg}\n`);
  } catch {}
}

export function initializeDatabase(userDataPath: string) {
  dbLog(`initializeDatabase called with: ${userDataPath}`);
  
  if (db) {
    dbLog('Database already initialized, returning existing instance');
    return db;
  }

  const storageDir = path.join(userDataPath, 'data');
  dbLog(`Creating storage dir: ${storageDir}`);
  
  try {
    fs.mkdirSync(storageDir, { recursive: true });
    dbLog(`Storage dir created successfully`);
  } catch (error) {
    dbLog(`Failed to create storage dir: ${error}`);
    console.error('Failed to create SQLite data directory', { storageDir, error });
    throw error;
  }

  const dbPath = path.join(storageDir, 'notion-widget.sqlite');
  dbLog(`Opening database at: ${dbPath}`);
  
  try {
    db = new Database(dbPath);
    dbLog(`Database opened successfully`);
  } catch (error) {
    dbLog(`Failed to open database: ${error}`);
    throw error;
  }
  
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  
  dbLog(`Running migrations...`);
  runMigrations(db);
  dbLog(`Migrations complete`);
  
  console.log('SQLite initialized', { dbPath });
  return db;
}

export function getDb() {
  if (!db) {
    throw new Error('Database has not been initialized yet');
  }
  return db;
}

