/**
 * Fix Duplicate Notion IDs
 * 
 * This script finds and removes duplicate entries that have the same notion_id.
 * It keeps the most recently modified entry and removes older duplicates.
 * 
 * Run: npx ts-node scripts/fix-duplicates.ts
 */

import * as path from 'path';
import * as os from 'os';

// Use the backup database path (or app database)
const BACKUP_PATH = path.join(__dirname, '..', 'backups', 'notion-backup.sqlite');
const APP_PATH = path.join(
  os.homedir(),
  'AppData', 'Roaming', 'notion-tasks-widget', 'notion-tasks.sqlite'
);

// Try backup first, then app path
const DB_PATH = require('fs').existsSync(BACKUP_PATH) ? BACKUP_PATH : APP_PATH;

console.log('='.repeat(60));
console.log('FIX DUPLICATE NOTION IDs');
console.log('='.repeat(60));
console.log(`Database: ${DB_PATH}`);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require('better-sqlite3');
const db = new Database(DB_PATH);

const tables = ['tasks', 'projects', 'time_logs', 'writing_entries'];
let totalDuplicatesRemoved = 0;

for (const table of tables) {
  console.log(`\n--- Checking ${table} ---`);
  
  // Find duplicates
  const duplicates = db.prepare(`
    SELECT notion_id, COUNT(*) as cnt 
    FROM ${table} 
    WHERE notion_id IS NOT NULL 
    GROUP BY notion_id 
    HAVING cnt > 1
  `).all() as { notion_id: string; cnt: number }[];
  
  if (duplicates.length === 0) {
    console.log(`  ✓ No duplicates found`);
    continue;
  }
  
  console.log(`  Found ${duplicates.length} duplicate notion_ids:`);
  
  for (const dup of duplicates) {
    // Get all rows with this notion_id
    const rows = db.prepare(`
      SELECT client_id, notion_id, title, last_modified_local 
      FROM ${table} 
      WHERE notion_id = ? 
      ORDER BY last_modified_local DESC
    `).all(dup.notion_id) as { client_id: string; notion_id: string; title: string; last_modified_local: number }[];
    
    console.log(`\n  notion_id: ${dup.notion_id} (${dup.cnt} copies)`);
    
    // Keep the first (most recent), delete the rest
    const keep = rows[0];
    console.log(`    KEEPING: ${keep.client_id} - "${keep.title || 'Untitled'}"`);
    
    for (let i = 1; i < rows.length; i++) {
      const toDelete = rows[i];
      console.log(`    DELETING: ${toDelete.client_id} - "${toDelete.title || 'Untitled'}"`);
      db.prepare(`DELETE FROM ${table} WHERE client_id = ?`).run(toDelete.client_id);
      totalDuplicatesRemoved++;
    }
  }
}

// Now create unique indexes if they don't exist
console.log('\n--- Creating unique indexes ---');
for (const table of tables) {
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_notion_unique ON ${table}(notion_id) WHERE notion_id IS NOT NULL`);
    console.log(`  ✓ Created unique index on ${table}.notion_id`);
  } catch (e: any) {
    console.log(`  ✗ Failed on ${table}: ${e.message}`);
  }
}

db.close();

console.log('\n' + '='.repeat(60));
console.log(`DONE! Removed ${totalDuplicatesRemoved} duplicate entries.`);
console.log('='.repeat(60));

