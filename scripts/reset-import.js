/**
 * Reset all import state to start fresh
 */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'NotionTasksWidget', 'data', 'notion-widget.sqlite');
console.log('Opening database:', dbPath);

const db = new Database(dbPath);

// Clear all sync state related to imports
const syncKeys = [
  'tasks_next_cursor',
  'tasks_last_sync', 
  'initial_import_complete',
  'import_current_partition',
  'import_partition_cursor'
];

console.log('Clearing sync state keys...');
for (const key of syncKeys) {
  db.prepare('DELETE FROM sync_state WHERE key = ?').run(key);
  console.log(`  ✓ Cleared: ${key}`);
}

// Show current task count
const count = db.prepare('SELECT COUNT(*) as count FROM tasks').get();
console.log(`\nTasks in database: ${count.count}`);

// Optionally clear all tasks too (for completely fresh start)
const args = process.argv.slice(2);
if (args.includes('--clear-tasks')) {
  console.log('\n⚠️  Clearing all tasks...');
  db.prepare('DELETE FROM tasks').run();
  console.log('✓ All tasks cleared');
}

db.close();
console.log('\n✅ Import state reset complete!');
console.log('Restart the app to begin fresh import.');




