import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from './schema';

let db: Database.Database | null = null;

export function initializeDatabase(userDataPath: string) {
  if (db) {
    return db;
  }

  const storageDir = path.join(userDataPath, 'data');
  try {
    fs.mkdirSync(storageDir, { recursive: true });
  } catch (error) {
    console.error('Failed to create SQLite data directory', { storageDir, error });
    throw error;
  }

  const dbPath = path.join(storageDir, 'notion-widget.sqlite');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  console.log('SQLite initialized', { dbPath });
  return db;
}

export function getDb() {
  if (!db) {
    throw new Error('Database has not been initialized yet');
  }
  return db;
}

