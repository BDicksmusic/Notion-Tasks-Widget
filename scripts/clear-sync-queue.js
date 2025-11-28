// Quick script to clear all sync queue entries
const Database = require('better-sqlite3');

const dbPath = './data/widget.db';
const db = new Database(dbPath);

// Show what's in the queue
const entries = db.prepare('SELECT * FROM sync_queue').all();
console.log(`Found ${entries.length} sync queue entries:`);
entries.forEach(e => {
  console.log(`  - ${e.entity_type} (${e.operation}): retries=${e.retry_count}, error=${e.last_error?.substring(0, 50)}...`);
});

// Clear all entries
const result = db.prepare('DELETE FROM sync_queue').run();
console.log(`\nCleared ${result.changes} entries from sync queue.`);

db.close();





